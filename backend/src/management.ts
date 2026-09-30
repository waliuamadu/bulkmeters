import { Router } from 'express';
import { z } from 'zod';
import { db, transaction, audit, uuid } from './db.js';
import { allow, scope } from './security.js';
import { targets } from './parsers.js';
export const management = Router();
management.get('/settings', allow('settings'), async (_req, res) =>
  res.json(
    (await db.query("SELECT value FROM system_settings WHERE name='ingestion'"))
      .rows[0]?.value,
  ),
);
management.post('/settings', allow('settings'), async (req, res) => {
  const b = z
    .object({
      poll_minutes: z.number().int().min(1).max(1440),
      discovery_days: z.number().int().min(1).max(3650),
      enabled: z.boolean(),
    })
    .parse(req.body);
  await transaction(async (c) => {
    const before = (
      await c.query(
        "SELECT value FROM system_settings WHERE name='ingestion' FOR UPDATE",
      )
    ).rows[0]?.value;
    await c.query(
      "UPDATE system_settings SET value=$1 WHERE name='ingestion'",
      [JSON.stringify(b)],
    );
    await audit(
      c,
      req.actor!.id,
      'Ingestion settings changed',
      null,
      before,
      b,
    );
  });
  res.json(b);
});
management.post('/parsers/:id', allow('ingestion'), async (req, res) => {
  const b = z
    .object({
      enabled: z.boolean(),
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
  await transaction(async (c) => {
    const previous = (
      await c.query(
        'SELECT * FROM parser_configurations WHERE id=$1 FOR UPDATE',
        [req.params.id],
      )
    ).rows[0];
    if (!previous) throw new Error('Parser not found');
    await c.query('UPDATE parser_configurations SET enabled=$2 WHERE id=$1', [
      req.params.id,
      b.enabled,
    ]);
    await c.query('DELETE FROM field_mappings WHERE parser_id=$1', [
      req.params.id,
    ]);
    for (const m of b.mappings)
      await c.query('INSERT INTO field_mappings VALUES($1,$2,$3,$4)', [
        uuid(),
        req.params.id,
        m.source,
        m.target,
      ]);
    await audit(
      c,
      req.actor!.id,
      'Parser mapping changed',
      String(req.params.id),
      previous,
      b,
    );
  });
  res.json({ ok: true });
});
management.post('/sources/:id', allow('ingestion'), async (req, res) => {
  const b = z.object({ enabled: z.boolean() }).parse(req.body);
  await transaction(async (c) => {
    const previous = (
      await c.query('SELECT * FROM email_sources WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ])
    ).rows[0];
    if (!previous) throw new Error('Source not found');
    await c.query('UPDATE email_sources SET enabled=$2 WHERE id=$1', [
      req.params.id,
      b.enabled,
    ]);
    await audit(
      c,
      req.actor!.id,
      'Source enabled state changed',
      String(req.params.id),
      previous,
      b,
    );
  });
  res.json({ ok: true });
});
management.post('/meters/:id', allow('registry'), async (req, res) => {
  const b = z
    .object({
      serial_number: z.string().max(100).nullable(),
      manufacturer: z.string().max(100).nullable(),
      model: z.string().max(100).nullable(),
      status: z.enum([
        'Active',
        'Inactive',
        'Offline',
        'Faulty',
        'Removed',
        'Replaced',
        'Under Maintenance',
      ]),
      expected_minutes: z.number().int().positive(),
      offline_minutes: z.number().int().positive(),
      max_volume_jump: z.number().positive().nullable(),
    })
    .refine((v) => v.offline_minutes > v.expected_minutes)
    .parse(req.body);
  await transaction(async (c) => {
    const before = (
      await c.query('SELECT * FROM meters WHERE id=$1 FOR UPDATE', [
        req.params.id,
      ])
    ).rows[0];
    if (!before) throw new Error('Meter not found');
    await c.query(
      'UPDATE meters SET serial_number=$2,manufacturer=$3,model=$4,status=$5,expected_minutes=$6,offline_minutes=$7,max_volume_jump=$8 WHERE id=$1',
      [
        req.params.id,
        b.serial_number,
        b.manufacturer,
        b.model,
        b.status,
        b.expected_minutes,
        b.offline_minutes,
        b.max_volume_jump,
      ],
    );
    await audit(
      c,
      req.actor!.id,
      'Meter edited',
      String(req.params.id),
      before,
      b,
    );
  });
  res.json({ ok: true });
});
management.get('/notifications', allow('read'), async (req, res) => {
  const sc = scope(req.actor!);
  res.json(
    (
      await db.query(
        `SELECT n.* FROM notifications n LEFT JOIN meter_installations mi ON mi.meter_id=n.meter_id AND mi.removed_at IS NULL LEFT JOIN installation_points p ON p.id=mi.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE ${sc.sql} AND (n.meter_id IS NOT NULL OR $${sc.values.length + 1}) ORDER BY created_at DESC LIMIT 200`,
        [...sc.values, req.actor!.permissions.includes('ingestion')],
      )
    ).rows,
  );
});
management.get('/alarms', allow('read'), async (req, res) => {
  const sc = scope(req.actor!);
  res.json(
    (
      await db.query(
        `SELECT a.* FROM meter_alarms a JOIN meter_readings mr ON mr.id=a.reading_id LEFT JOIN installation_points p ON p.id=mr.point_id LEFT JOIN facilities f ON f.id=p.facility_id WHERE ${sc.sql} ORDER BY created_at DESC LIMIT 1000`,
        sc.values,
      )
    ).rows,
  );
});
management.post(
  '/readings/:id/correct',
  allow('registry'),
  async (req, res) => {
    const b = z
      .object({
        reason: z.string().min(10).max(1000),
        flow_rate: z.number().nullable(),
        cumulative_volume: z.number().nonnegative().nullable(),
      })
      .parse(req.body);
    await transaction(async (c) => {
      const previous = (
        await c.query('SELECT * FROM meter_readings WHERE id=$1 FOR UPDATE', [
          req.params.id,
        ])
      ).rows[0];
      if (!previous) throw new Error('Reading not found');
      await c.query(
        'INSERT INTO reading_corrections(id,reading_id,user_id,reason,previous_value,new_value) VALUES($1,$2,$3,$4,$5,$6)',
        [
          uuid(),
          req.params.id,
          req.actor!.id,
          b.reason,
          JSON.stringify(previous),
          JSON.stringify(b),
        ],
      );
      await c.query(
        "UPDATE meter_readings SET flow_rate=$2,cumulative_volume=$3,quality='Warning' WHERE id=$1",
        [req.params.id, b.flow_rate, b.cumulative_volume],
      );
      await audit(
        c,
        req.actor!.id,
        'Reading manually corrected',
        String(req.params.id),
        previous,
        b,
      );
    });
    res.json({ ok: true });
  },
);
management.post('/meters', allow('registry'), async (req, res) => {
  const b = z
    .object({
      serial_number: z.string().max(100).nullable().optional(),
      manufacturer: z.string().max(100).nullable().optional(),
      model: z.string().max(100).nullable().optional(),
      meter_type: z.string().max(100).nullable().optional(),
      point_id: z.string().uuid().nullable().optional(),
      installed_at: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .refine((x) => !x.point_id || x.installed_at, 'Installation date required')
    .parse(req.body);
  const id = await transaction(async (c) => {
    const m = (
      await c.query(
        'INSERT INTO meters(serial_number,manufacturer,model,meter_type) VALUES($1,$2,$3,$4) RETURNING id',
        [b.serial_number, b.manufacturer, b.model, b.meter_type],
      )
    ).rows[0].id;
    if (b.point_id)
      await c.query(
        'INSERT INTO meter_installations(id,meter_id,point_id,installed_at) VALUES($1,$2,$3,$4)',
        [uuid(), m, b.point_id, b.installed_at],
      );
    await audit(c, req.actor!.id, 'Meter registered', m, null, b);
    return m;
  });
  res.status(201).json({ id });
});
management.post(
  '/meters/:id/identifiers',
  allow('registry'),
  async (req, res) => {
    const { normalizeIdentity, identities } = await import('./parsers.js');
    const b = z
      .object({
        namespace: z.string().min(1).max(100),
        kind: z.string().refine((k) => identities.includes(k)),
        value: z.string().min(1).max(200),
      })
      .parse(req.body);
    await transaction(async (c) => {
      await c.query(
        'INSERT INTO meter_identifiers(id,meter_id,namespace,kind,value,normalized) VALUES($1,$2,$3,$4,$5,$6)',
        [
          uuid(),
          req.params.id,
          b.namespace,
          b.kind,
          b.value,
          normalizeIdentity(b.value),
        ],
      );
      await audit(
        c,
        req.actor!.id,
        'Verified identifier added',
        String(req.params.id),
        null,
        b,
      );
    });
    res.status(201).json({ ok: true });
  },
);
management.post('/meters/:id/devices', allow('registry'), async (req, res) => {
  const b = z
    .object({
      technology: z.string().max(100).optional(),
      device_id: z.string().max(100).optional(),
      logger_id: z.string().max(100).optional(),
      communication_id: z.string().max(100).optional(),
      imei: z.string().max(100).optional(),
      sim_identifier: z.string().max(100).optional(),
      gateway_id: z.string().max(100).optional(),
      vendor_platform_id: z.string().max(100).optional(),
    })
    .parse(req.body);
  await transaction(async (c) => {
    await c.query(
      'INSERT INTO communication_devices VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        uuid(),
        req.params.id,
        b.technology,
        b.device_id,
        b.logger_id,
        b.communication_id,
        b.imei,
        b.sim_identifier,
        b.gateway_id,
        b.vendor_platform_id,
      ],
    );
    await audit(
      c,
      req.actor!.id,
      'Communication device added',
      String(req.params.id),
      null,
      b,
    );
  });
  res.status(201).json({ ok: true });
});
