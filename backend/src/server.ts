import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { google } from 'googleapis';
import ExcelJS from 'exceljs';
import { db, transaction, audit, uuid } from './db.js';
import {
  authenticate,
  allow,
  hash,
  passwordHash,
  verifyPassword,
  scope,
  roles,
} from './security.js';
import { oauthClient, saveTokens } from './gmail.js';
import { refreshNotifications } from './notifications.js';
import { management } from './management.js';
import { sync, processMessage } from './ingestion.js';
import { reportingStatus, csvCell, targets } from './parsers.js';
export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
);
const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'test')
  throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://'))
  throw new Error('Production APP_ORIGIN must use HTTPS');
const cookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
  maxAge: 8 * 3600000,
};
app.get('/health', async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ status: 'ok' });
});
app.post(
  '/api/auth/login',
  rateLimit({ windowMs: 900000, limit: 10 }),
  async (req, res) => {
    if (req.get('origin') !== origin)
      return res.status(403).json({ error: 'Invalid origin' });
    const body = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(1024),
      })
      .parse(req.body);
    const user = (
      await db.query('SELECT * FROM users WHERE email=$1 AND active', [
        body.email.toLowerCase(),
      ])
    ).rows[0];
    const dummy = '01234567890123456789012345678901:' + '0'.repeat(128);
    if (!verifyPassword(body.password, user?.password_hash || dummy) || !user)
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '8 hours')",
      [hash(token), user.id, csrf],
    );
    await audit(db, user.id, 'Signed in', user.id, null, null, req.ip || null);
    res.cookie('gwl_session', token, cookie).json({ csrf });
  },
);
app.use('/api', authenticate);
app.use('/api', management);
app.get('/api/auth/me', (req, res) => res.json(req.actor));
app.post('/api/auth/logout', async (req, res) => {
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [
    hash(req.cookies.gwl_session),
  ]);
  res.clearCookie('gwl_session', cookie).json({ ok: true });
});
app.get('/api/oauth/start', allow('ingestion'), async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    return res.status(409).json({
      error:
        'Configure Google OAuth client credentials on the API server first',
    });
  const state = randomBytes(32).toString('hex');
  await db.query(
    'INSERT INTO system_settings(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value',
    [
      'oauth:' + req.actor!.id,
      JSON.stringify({ hash: hash(state), expires: Date.now() + 600000 }),
    ],
  );
  const client = oauthClient();
  res.json({
    url: client.generateAuthUrl({
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
      access_type: 'offline',
      prompt: 'consent',
      state,
      login_hint: process.env.GMAIL_ACCOUNT,
    }),
  });
});
app.get('/api/oauth/callback', allow('ingestion'), async (req, res) => {
  const state = z.string().parse(req.query.state),
    code = z.string().parse(req.query.code);
  const valid = await transaction(async (c) => {
    const key = 'oauth:' + req.actor!.id;
    const saved = (
      await c.query(
        'SELECT value FROM system_settings WHERE name=$1 FOR UPDATE',
        [key],
      )
    ).rows[0]?.value;
    await c.query('DELETE FROM system_settings WHERE name=$1', [key]);
    return saved && saved.expires > Date.now() && saved.hash === hash(state);
  });
  if (!valid) return res.status(403).send('OAuth state expired or invalid');
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const profile = await google
    .gmail({ version: 'v1', auth: client })
    .users.getProfile({ userId: 'me' });
  if (
    profile.data.emailAddress?.toLowerCase() !==
    (process.env.GMAIL_ACCOUNT || 'mag8000bulkmeters@gmail.com').toLowerCase()
  )
    return res.status(403).send('Authorize the configured GWL mailbox');
  if (!tokens.refresh_token)
    return res
      .status(400)
      .send('Offline access was not granted; reconnect with consent');
  await saveTokens(tokens);
  res.redirect(origin + '/?view=Configuration&connected=1');
});
const baseMeters = `FROM meters m LEFT JOIN meter_installations mi ON mi.meter_id=m.id AND mi.removed_at IS NULL LEFT JOIN installation_points p ON p.id=mi.point_id LEFT JOIN facilities f ON f.id=p.facility_id LEFT JOIN regions r ON r.id=f.region_id LEFT JOIN LATERAL (SELECT * FROM meter_readings mr WHERE mr.meter_id=m.id AND (mi.id IS NULL OR mr.installation_id=mi.id) ORDER BY reading_at DESC LIMIT 1) latest ON TRUE`;
async function meterRows(actor: any) {
  const sc = scope(actor);
  const result = await db.query(
    `SELECT m.*,p.id AS point_id,p.name AS installation_point,p.classification,p.latitude,p.longitude,f.name AS facility,r.name AS region,latest.reading_at,latest.received_at,(SELECT max(mt.received_at) FROM meter_transmissions mt WHERE mt.meter_id=m.id AND (mi.id IS NULL OR mt.received_at>=mi.installed_at)) AS last_transmission,latest.flow_rate,latest.cumulative_volume,latest.quality,latest.unit ${baseMeters} WHERE ${sc.sql} ORDER BY m.id`,
    sc.values,
  );
  return result.rows.map((m) => ({
    ...m,
    reporting_status: reportingStatus(
      m.last_transmission,
      m.expected_minutes,
      m.offline_minutes,
    ),
  }));
}
async function hasMeter(req: express.Request, id: string) {
  return (await meterRows(req.actor)).some((m) => m.id === id);
}
app.get('/api/dashboard', async (req, res) => {
  if (!req.actor!.permissions.some((p) => p === 'read' || p === 'dashboard'))
    return res.sendStatus(403);
  const meters = await meterRows(req.actor);
  const scoped = req.actor!.roles.some((r) =>
    ['Regional Manager', 'Plant Operator'].includes(r),
  );
  const sc = scope(req.actor!);
  const visibleReadings = `FROM meter_readings mr LEFT JOIN installation_points p ON p.id=mr.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE ${sc.sql}`;
  const visibleQuality = scoped
    ? `EXISTS(SELECT 1 ${visibleReadings} AND mr.meter_id=q.meter_id AND mr.source_message_id=q.message_id)`
    : 'TRUE';
  const counts = (
    await db.query(
      `SELECT (SELECT count(*)::int ${visibleReadings} AND mr.received_at>=date_trunc('day',now())) readings_today,(SELECT count(*)::int FROM data_quality_events q WHERE ${visibleQuality}) quality_exceptions`,
      sc.values,
    )
  ).rows[0];
  const global = scoped
    ? { messages_today: null, unidentified: null, parsing_failures: null }
    : (
        await db.query(
          `SELECT (SELECT count(*)::int FROM email_messages WHERE received_at>=date_trunc('day',now())) messages_today,(SELECT count(*)::int FROM unidentified_meters WHERE status IN ('Review','Conflict')) unidentified,(SELECT count(*)::int FROM email_messages WHERE status='Failed') parsing_failures`,
        )
      ).rows[0];
  const trend = (
    await db.query(
      `SELECT date_trunc('day',mr.received_at) AS day,count(*)::int count ${visibleReadings} AND mr.received_at>now()-interval '7 days' GROUP BY 1 ORDER BY 1`,
      sc.values,
    )
  ).rows;
  res.json({
    ...counts,
    ...global,
    total: meters.length,
    statuses: Object.fromEntries(
      ['Online', 'Delayed', 'Offline', 'Never Reported'].map((s) => [
        s,
        meters.filter((m) => m.reporting_status === s).length,
      ]),
    ),
    trend,
    distribution: meters.reduce((a: any, m) => {
      const key = m.region || 'Unassigned';
      a[key] = (a[key] || 0) + 1;
      return a;
    }, {}),
  });
});
app.get('/api/meters', allow('read'), async (req, res) => {
  let rows = await meterRows(req.actor);
  const search = String(req.query.search || '').toLowerCase();
  if (search)
    rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search));
  if (req.query.status)
    rows = rows.filter((r) => r.reporting_status === req.query.status);
  res.json(rows);
});
app.get('/api/meters/:id', allow('read'), async (req, res) => {
  const m = (await meterRows(req.actor)).find((x) => x.id === req.params.id);
  if (!m) return res.sendStatus(404);
  const identifiers = (
    await db.query('SELECT * FROM meter_identifiers WHERE meter_id=$1', [m.id])
  ).rows;
  const sc = scope(req.actor!, 2);
  const installations = (
    await db.query(
      `SELECT mi.*,p.name AS installation_point,f.name AS facility FROM meter_installations mi JOIN installation_points p ON p.id=mi.point_id JOIN facilities f ON f.id=p.facility_id WHERE mi.meter_id=$1 AND ${sc.sql} ORDER BY installed_at DESC`,
      [m.id, ...sc.values],
    )
  ).rows;
  res.json({ ...m, identifiers, installations });
});
for (const kind of ['readings', 'transmissions', 'alarms'] as const)
  app.get('/api/meters/:id/' + kind, allow('read'), async (req, res) => {
    const id = String(req.params.id);
    if (!(await hasMeter(req, id))) return res.sendStatus(404);
    const sc = scope(req.actor!, 2);
    let sql =
      kind === 'alarms'
        ? `SELECT a.* FROM meter_alarms a JOIN meter_readings mr ON mr.id=a.reading_id LEFT JOIN installation_points p ON p.id=mr.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE a.meter_id=$1 AND ${sc.sql} ORDER BY a.created_at DESC LIMIT 1000`
        : `SELECT mr.* FROM meter_readings mr LEFT JOIN installation_points p ON p.id=mr.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE mr.meter_id=$1 AND ${sc.sql} ORDER BY mr.reading_at DESC LIMIT 1000`;
    const data = (await db.query(sql, [id, ...sc.values])).rows;
    res.json(
      kind === 'transmissions'
        ? data.map((x) => ({
            source_message_id: x.source_message_id,
            received_at: x.received_at,
            quality: x.quality,
          }))
        : data,
    );
  });
app.get('/api/installation-points', allow('read'), async (req, res) => {
  const s = scope(req.actor!);
  res.json(
    (
      await db.query(
        `SELECT p.*,f.name AS facility,r.name AS region FROM installation_points p JOIN facilities f ON f.id=p.facility_id JOIN regions r ON r.id=f.region_id WHERE ${s.sql} ORDER BY p.name`,
        s.values,
      )
    ).rows,
  );
});
app.get('/api/lookups', allow('read'), async (req, res) => {
  const sc = scope(req.actor!);
  const facilities = (
    await db.query(
      `SELECT f.* FROM facilities f WHERE ${sc.sql} ORDER BY name`,
      sc.values,
    )
  ).rows;
  const scoped = req.actor!.roles.some((r) =>
    ['Regional Manager', 'Plant Operator'].includes(r),
  );
  res.json({
    facilities,
    regions: (
      await db.query(
        'SELECT * FROM regions WHERE $1::boolean=false OR id=ANY($2::uuid[]) ORDER BY name',
        [scoped, facilities.map((f) => f.region_id)],
      )
    ).rows,
  });
});
const classifications = [
  'Raw Water Intake',
  'Treatment Inlet',
  'Treatment Outlet',
  'Transmission',
  'Booster Station',
  'Reservoir Inlet',
  'Reservoir Outlet',
  'Regional Boundary',
  'District Boundary',
  'Distribution',
  'Other',
] as const;
app.post('/api/regions', allow('registry'), async (req, res) => {
  const b = z
    .object({ name: z.string().trim().min(1).max(100) })
    .parse(req.body);
  const id = uuid();
  await transaction(async (c) => {
    await c.query('INSERT INTO regions VALUES($1,$2)', [id, b.name]);
    await audit(c, req.actor!.id, 'Region created', id, null, b);
  });
  res.status(201).json({ id });
});
app.post('/api/facilities', allow('registry'), async (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(1).max(100),
      region_id: z.string().uuid(),
    })
    .parse(req.body);
  const id = uuid();
  await transaction(async (c) => {
    await c.query('INSERT INTO facilities VALUES($1,$2,$3)', [
      id,
      b.region_id,
      b.name,
    ]);
    await audit(c, req.actor!.id, 'Facility created', id, null, b);
  });
  res.status(201).json({ id });
});
app.post('/api/installation-points', allow('registry'), async (req, res) => {
  const b = z
    .object({
      name: z.string().min(1).max(100),
      facility_id: z.string().uuid(),
      classification: z.enum(classifications),
      station: z.string().max(100).optional(),
      pipeline: z.string().max(100).optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
    })
    .parse(req.body);
  const id = uuid();
  await transaction(async (c) => {
    await c.query(
      'INSERT INTO installation_points(id,facility_id,name,classification,station,pipeline,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        b.facility_id,
        b.name,
        b.classification,
        b.station,
        b.pipeline,
        b.latitude,
        b.longitude,
      ],
    );
    await audit(c, req.actor!.id, 'Installation point created', id, null, b);
  });
  res.status(201).json({ id });
});
const registration = z.object({
  serial_number: z.string().max(100).optional(),
  manufacturer: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  meter_type: z.string().max(100).optional(),
  point_id: z.string().uuid(),
  installed_at: z.string().datetime({ offset: true }),
});
app.get('/api/unidentified-meters', allow('registry'), async (_req, res) =>
  res.json(
    (
      await db.query(
        `SELECT u.*,(SELECT count(*)::int FROM discovered_transmissions d WHERE d.discovery_id=u.id) transmissions FROM unidentified_meters u ORDER BY last_seen DESC LIMIT 1000`,
      )
    ).rows,
  ),
);
app.post(
  '/api/unidentified-meters/:id/:action',
  allow('registry'),
  async (req, res) => {
    const id = z.string().uuid().parse(req.params.id),
      action = z
        .enum(['register', 'match', 'ignore', 'invalid'])
        .parse(req.params.action);
    const result = await transaction(async (c) => {
      const found = (
        await c.query(
          'SELECT * FROM unidentified_meters WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!found) throw new Error('Identity not found');
      if (!['Review', 'Conflict'].includes(found.status))
        throw new Error('Identity has already been reviewed');
      let meter: string | null = null;
      if (action === 'register') {
        const b = registration.parse(req.body);
        await c.query(
          'SELECT id FROM installation_points WHERE id=$1 FOR UPDATE',
          [b.point_id],
        );
        meter = (
          await c.query(
            'INSERT INTO meters(serial_number,manufacturer,model,meter_type) VALUES($1,$2,$3,$4) RETURNING id',
            [
              b.serial_number || null,
              b.manufacturer || null,
              b.model || null,
              b.meter_type || null,
            ],
          )
        ).rows[0].id;
        await c.query(
          'INSERT INTO meter_installations(id,meter_id,point_id,installed_at) VALUES($1,$2,$3,$4)',
          [uuid(), meter, b.point_id, b.installed_at],
        );
      }
      if (action === 'match') {
        meter = z
          .string()
          .regex(/^GWL-PM-\d+$/)
          .parse(req.body.meter_id);
        if (
          !(await c.query('SELECT 1 FROM meters WHERE id=$1', [meter])).rowCount
        )
          throw new Error('Meter not found');
      }
      if (meter) {
        await c.query(
          'INSERT INTO meter_identifiers(id,meter_id,namespace,kind,value,normalized) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING',
          [uuid(), meter, found.namespace, found.kind, found.detected_id],
        );
      }
      const status = meter
        ? 'Validated'
        : action === 'ignore'
          ? 'Ignored'
          : 'Invalid';
      await c.query(
        'UPDATE unidentified_meters SET status=$2,meter_id=$3 WHERE id=$1',
        [id, status, meter],
      );
      await c.query(
        'INSERT INTO identity_matches(id,discovery_id,meter_id,decision,user_id) VALUES($1,$2,$3,$4,$5)',
        [uuid(), id, meter, action, req.actor!.id],
      );
      await audit(c, req.actor!.id, 'Identity ' + action, id, found, {
        meter,
        status,
      });
      return { meter, status };
    });
    res.json({
      ...result,
      note: 'Retry associated messages to backfill readings after validation.',
    });
  },
);
app.post('/api/meters/:id/replace', allow('registry'), async (req, res) => {
  const b = z
    .object({
      replacement_id: z.string().regex(/^GWL-PM-\d+$/),
      at: z.string().datetime({ offset: true }),
    })
    .parse(req.body);
  if (req.params.id === b.replacement_id)
    return res
      .status(400)
      .json({ error: 'Replacement must be a different meter' });
  await transaction(async (c) => {
    const current = (
      await c.query(
        'SELECT * FROM meter_installations WHERE meter_id=$1 AND removed_at IS NULL FOR UPDATE',
        [req.params.id],
      )
    ).rows[0];
    if (!current) throw new Error('No active installation');
    if (
      Date.parse(b.at) <= new Date(current.installed_at).getTime() ||
      Date.parse(b.at) > Date.now()
    )
      throw new Error(
        'Replacement date must follow installation and cannot be future',
      );
    if (
      (
        await c.query(
          'SELECT 1 FROM meter_readings WHERE installation_id=$1 AND reading_at>=$2 LIMIT 1',
          [current.id, b.at],
        )
      ).rowCount
    )
      throw new Error(
        'Replacement would contradict existing readings; resolve historical readings first',
      );
    await c.query('UPDATE meter_installations SET removed_at=$2 WHERE id=$1', [
      current.id,
      b.at,
    ]);
    await c.query(
      'INSERT INTO meter_installations(id,meter_id,point_id,installed_at) VALUES($1,$2,$3,$4)',
      [uuid(), b.replacement_id, current.point_id, b.at],
    );
    await c.query("UPDATE meters SET status='Replaced' WHERE id=$1", [
      req.params.id,
    ]);
    await audit(
      c,
      req.actor!.id,
      'Meter replaced',
      String(req.params.id),
      current,
      b,
    );
  });
  res.json({ ok: true });
});
app.get('/api/email/status', allow('ingestion'), async (_req, res) => {
  const schedule = (
    await db.query("SELECT value FROM system_settings WHERE name='ingestion'")
  ).rows[0]?.value;
  const settings = (
    await db.query("SELECT value FROM system_settings WHERE name='sync'")
  ).rows[0]?.value;
  const connected = Boolean(
    (await db.query("SELECT 1 FROM integration_secrets WHERE name='gmail'"))
      .rowCount,
  );
  const counts = (
    await db.query(
      'SELECT status,count(*)::int count FROM email_messages GROUP BY status',
    )
  ).rows;
  res.json({
    connected,
    settings,
    counts,
    poll_minutes: schedule?.poll_minutes || 5,
    discovery_days: schedule?.discovery_days || 30,
    next_sync:
      settings?.last_success && schedule?.enabled
        ? new Date(
            Date.parse(settings.last_success) +
              Number(schedule.poll_minutes) * 60000,
          ).toISOString()
        : null,
  });
});
app.get('/api/email/messages', allow('ingestion'), async (_req, res) =>
  res.json(
    (
      await db.query(
        `SELECT e.id,e.sender,e.subject,e.received_at,e.processed_at,e.status,e.error,e.retry_count,p.name AS parser,(SELECT count(*)::int FROM meter_readings r WHERE r.source_message_id=e.id) readings,(SELECT string_agg(filename,', ') FROM email_attachments a WHERE a.message_id=e.id) attachments FROM email_messages e LEFT JOIN parser_configurations p ON p.id=e.parser_id ORDER BY received_at DESC LIMIT 1000`,
      )
    ).rows,
  ),
);
app.get('/api/email/messages/:id', allow('raw'), async (req, res) => {
  const m = (
    await db.query('SELECT * FROM email_messages WHERE id=$1', [req.params.id])
  ).rows[0];
  if (!m) return res.sendStatus(404);
  await audit(
    db,
    req.actor!.id,
    'Raw message inspected',
    String(req.params.id),
  );
  res.json({
    ...m,
    attachments: (
      await db.query(
        'SELECT id,filename,mime_type,checksum FROM email_attachments WHERE message_id=$1',
        [req.params.id],
      )
    ).rows,
    logs: (
      await db.query(
        'SELECT * FROM email_processing_logs WHERE message_id=$1 ORDER BY created_at',
        [req.params.id],
      )
    ).rows,
  });
});
app.post('/api/email/sync', allow('ingestion'), async (_req, res) =>
  res.json(await sync()),
);
app.post(
  '/api/email/messages/:id/retry',
  allow('ingestion'),
  async (req, res) => {
    await processMessage(String(req.params.id), true);
    res.json({ ok: true });
  },
);
app.post(
  '/api/email/messages/:id/ignore',
  allow('ingestion'),
  async (req, res) => {
    await transaction(async (c) => {
      await c.query("UPDATE email_messages SET status='Ignored' WHERE id=$1", [
        req.params.id,
      ]);
      await audit(c, req.actor!.id, 'Message ignored', String(req.params.id));
    });
    res.json({ ok: true });
  },
);
app.get('/api/data-quality', allow('read'), async (req, res) => {
  const sc = scope(req.actor!);
  const scoped = req.actor!.roles.some((r) =>
    ['Regional Manager', 'Plant Operator'].includes(r),
  );
  res.json(
    (
      await db.query(
        `SELECT q.* FROM data_quality_events q WHERE ${scoped ? `EXISTS(SELECT 1 FROM meter_readings mr JOIN installation_points p ON p.id=mr.point_id JOIN facilities f ON f.id=p.facility_id WHERE mr.meter_id=q.meter_id AND mr.source_message_id=q.message_id AND ${sc.sql})` : 'TRUE'} ORDER BY created_at DESC LIMIT 1000`,
        sc.values,
      )
    ).rows,
  );
});
app.get('/api/configuration', allow('ingestion'), async (_req, res) =>
  res.json({
    sources: (await db.query('SELECT * FROM email_sources')).rows,
    parsers: (
      await db.query(
        "SELECT p.*,(SELECT coalesce(json_agg(m),'[]'::json) FROM field_mappings m WHERE m.parser_id=p.id) mappings FROM parser_configurations p",
      )
    ).rows,
    targets,
  }),
);
app.post('/api/parsers', allow('ingestion'), async (req, res) => {
  const b = z
    .object({
      name: z.string().min(1).max(100),
      format: z.enum(['json', 'csv', 'xlsx', 'xml', 'txt', 'html']),
      namespace: z.string().min(1).max(100),
      record_path: z.string().max(100).default(''),
      enabled: z.boolean().default(false),
      mappings: z
        .array(
          z.object({
            source: z.string().min(1).max(100),
            target: z.string().refine((x) => targets.includes(x)),
          }),
        )
        .min(1)
        .max(100),
    })
    .parse(req.body);
  const id = uuid();
  await transaction(async (c) => {
    await c.query(
      'INSERT INTO parser_configurations VALUES($1,$2,$3,$4,$5,$6)',
      [id, b.name, b.format, b.namespace, b.record_path, b.enabled],
    );
    for (const m of b.mappings)
      await c.query('INSERT INTO field_mappings VALUES($1,$2,$3,$4)', [
        uuid(),
        id,
        m.source,
        m.target,
      ]);
    await audit(c, req.actor!.id, 'Parser configured', id, null, b);
  });
  res.status(201).json({ id });
});
app.post('/api/sources', allow('ingestion'), async (req, res) => {
  const b = z
    .object({
      name: z.string().min(1).max(100),
      sender: z.string().email().optional(),
      domain: z
        .string()
        .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
        .optional(),
      subject_contains: z.string().max(100).optional(),
      label: z.string().max(100).optional(),
      keyword: z.string().max(100).optional(),
      filename_contains: z.string().max(100).optional(),
      attachment_type: z.string().max(100).optional(),
      vendor_identifier: z.string().max(100).optional(),
      parser_id: z.string().uuid(),
      enabled: z.boolean().default(false),
    })
    .refine((x) => x.sender || x.domain, 'Provide an exact sender or domain')
    .parse(req.body);
  const id = uuid();
  await transaction(async (c) => {
    await c.query(
      'INSERT INTO email_sources(id,name,sender,domain,subject_contains,label,keyword,filename_contains,attachment_type,vendor_identifier,parser_id,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        id,
        b.name,
        b.sender || null,
        b.domain || null,
        b.subject_contains || null,
        b.label || null,
        b.keyword || null,
        b.filename_contains || null,
        b.attachment_type || null,
        b.vendor_identifier || null,
        b.parser_id,
        b.enabled,
      ],
    );
    await audit(c, req.actor!.id, 'Email source configured', id, null, b);
  });
  res.status(201).json({ id });
});
app.get('/api/audit', allow('audit'), async (_req, res) =>
  res.json(
    (
      await db.query(
        'SELECT a.*,u.email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY created_at DESC LIMIT 500',
      )
    ).rows,
  ),
);
app.get('/api/users', allow('users'), async (req, res) => {
  if (!req.actor!.roles.includes('Super Administrator'))
    return res.status(403).json({
      error: 'User administration currently requires Super Administrator',
    });
  res.json(
    (
      await db.query(
        'SELECT u.id,u.email,u.region_id,u.facility_id,u.active,array_agg(ur.role) roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id GROUP BY u.id',
      )
    ).rows,
  );
});
app.post('/api/users', allow('users'), async (req, res) => {
  if (!req.actor!.roles.includes('Super Administrator'))
    return res.sendStatus(403);
  const b = z
    .object({
      email: z.string().email(),
      password: z.string().min(14).max(1024),
      role: z.string().refine((x) => Object.hasOwn(roles, x)),
      region_id: z.string().uuid().nullable().optional(),
      facility_id: z.string().uuid().nullable().optional(),
    })
    .parse(req.body);
  if (
    (b.role === 'Regional Manager' && !b.region_id) ||
    (b.role === 'Plant Operator' && !b.facility_id)
  )
    return res
      .status(400)
      .json({ error: 'The role requires an assigned region or facility' });
  const id = uuid();
  await transaction(async (c) => {
    await c.query(
      'INSERT INTO users(id,email,password_hash,region_id,facility_id) VALUES($1,$2,$3,$4,$5)',
      [
        id,
        b.email.toLowerCase(),
        passwordHash(b.password),
        b.region_id || null,
        b.facility_id || null,
      ],
    );
    await c.query('INSERT INTO user_roles VALUES($1,$2)', [id, b.role]);
    await audit(c, req.actor!.id, 'User created', id, null, {
      email: b.email,
      role: b.role,
    });
  });
  res.status(201).json({ id });
});
app.get('/api/export', allow('export'), async (req, res) => {
  const dataset = z
    .enum([
      'registry',
      'latest',
      'offline',
      'history',
      'transmissions',
      'unidentified',
      'quality',
    ])
    .parse(req.query.dataset || 'registry');
  let rows = await meterRows(req.actor);
  if (dataset === 'offline')
    rows = rows.filter((r) => r.reporting_status === 'Offline');
  if (dataset === 'unidentified') {
    if (!req.actor!.permissions.includes('registry'))
      return res.sendStatus(403);
    rows = (
      await db.query(
        'SELECT namespace,kind,detected_id,first_seen,last_seen,status FROM unidentified_meters LIMIT 100001',
      )
    ).rows;
  }
  if (['history', 'transmissions', 'quality'].includes(dataset)) {
    const sc = scope(req.actor!);
    const from = z
      .string()
      .datetime({ offset: true })
      .parse(req.query.from || '1970-01-01T00:00:00Z');
    const to = z
      .string()
      .datetime({ offset: true })
      .parse(req.query.to || new Date().toISOString());
    if (Date.parse(from) > Date.parse(to))
      return res
        .status(400)
        .json({ error: 'Start date must precede end date' });
    const a = sc.values.length + 1,
      b = a + 1;
    if (dataset === 'quality') {
      rows = (
        await db.query(
          `SELECT q.id,q.meter_id,q.message_id,q.code,q.severity,q.created_at FROM data_quality_events q WHERE q.created_at BETWEEN $${a} AND $${b} AND EXISTS(SELECT 1 FROM meter_readings mr LEFT JOIN installation_points p ON p.id=mr.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE mr.meter_id=q.meter_id AND mr.source_message_id=q.message_id AND ${sc.sql}) ORDER BY q.created_at LIMIT 100001`,
          [...sc.values, from, to],
        )
      ).rows;
    } else if (dataset === 'history') {
      rows = (
        await db.query(
          `SELECT mr.meter_id,mr.point_id,mr.reading_at,mr.received_at,mr.cumulative_volume,mr.flow_rate,mr.pressure,mr.temperature,mr.battery,mr.unit,mr.quality,mr.source_message_id FROM meter_readings mr LEFT JOIN installation_points p ON p.id=mr.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE ${sc.sql} AND mr.reading_at BETWEEN $${a} AND $${b} ORDER BY mr.reading_at LIMIT 100001`,
          [...sc.values, from, to],
        )
      ).rows;
    } else {
      rows = (
        await db.query(
          `SELECT t.meter_id,t.message_id,t.received_at FROM meter_transmissions t LEFT JOIN meter_installations mi ON mi.meter_id=t.meter_id AND mi.installed_at<=t.received_at AND (mi.removed_at IS NULL OR mi.removed_at>t.received_at) LEFT JOIN installation_points p ON p.id=mi.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE ${sc.sql} AND t.received_at BETWEEN $${a} AND $${b} ORDER BY t.received_at LIMIT 100001`,
          [...sc.values, from, to],
        )
      ).rows;
    }
  }
  if (rows.length > 100000)
    return res
      .status(413)
      .json({ error: 'Export exceeds 100,000 rows. Narrow the date range.' });
  let filtered = req.query.status
    ? rows.filter((r) => r.reporting_status === req.query.status)
    : rows;
  if (req.query.search)
    filtered = filtered.filter((r) =>
      JSON.stringify(r)
        .toLowerCase()
        .includes(String(req.query.search).toLowerCase()),
    );
  const columns = ['registry', 'latest', 'offline'].includes(dataset)
    ? [
        'id',
        'serial_number',
        'manufacturer',
        'facility',
        'region',
        'installation_point',
        'reporting_status',
        'reading_at',
        'flow_rate',
        'cumulative_volume',
      ]
    : Object.keys(filtered[0] || { message: 'No records match this report' });
  await audit(db, req.actor!.id, 'Dataset exported', dataset, null, {
    rows: filtered.length,
    format: req.query.format || 'csv',
  });
  if (req.query.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(dataset);
    sheet.columns = columns.map((k) => ({ header: k, key: k, width: 24 }));
    filtered.forEach((r) =>
      sheet.addRow(
        Object.fromEntries(columns.map((k) => [k, String(r[k] ?? '')])),
      ),
    );
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(dataset + '.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } else {
    res
      .type('text/csv')
      .attachment(dataset + '.csv')
      .send(
        [
          columns.map(csvCell).join(','),
          ...filtered.map((r) => columns.map((k) => csvCell(r[k])).join(',')),
        ].join('\r\n'),
      );
  }
});
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
    if (err.code === '23505' || err.code === '23503' || err.code === '23514')
      return res.status(409).json({
        error:
          'The change conflicts with existing records or an integrity constraint',
      });
    console.error(
      JSON.stringify({
        level: 'error',
        message: err.message,
        time: new Date().toISOString(),
      }),
    );
    res.status(500).json({
      error: 'The request could not be completed. Check the service logs.',
    });
  },
);
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 4000);
  const server = app.listen(port, process.env.LISTEN_HOST || '127.0.0.1', () =>
    console.log(`GWL API listening on ${port}`),
  );
  const minutes = Number(process.env.POLL_MINUTES || 5);
  if (!Number.isFinite(minutes) || minutes < 1)
    throw new Error('POLL_MINUTES must be at least 1');
  let lastAttempt = 0;
  const timer = setInterval(() => {
    void refreshNotifications().catch((e) =>
      console.error('Notification refresh failed:', e.message),
    );
    void db
      .query("SELECT value FROM system_settings WHERE name='ingestion'")
      .then(async (r) => {
        const settings = r.rows[0]?.value;
        if (
          !settings?.enabled ||
          Date.now() - lastAttempt < settings.poll_minutes * 60000
        )
          return;
        lastAttempt = Date.now();
        if (
          (
            await db.query(
              "SELECT 1 FROM integration_secrets WHERE name='gmail'",
            )
          ).rowCount
        )
          await sync();
      })
      .catch((e) => console.error('Scheduled sync failed:', e.message));
  }, 60000);
  process.on('SIGTERM', () => {
    clearInterval(timer);
    server.close(() => void db.end());
  });
}
