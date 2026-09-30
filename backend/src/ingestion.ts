import { db, transaction, audit, uuid } from './db.js';
import { gmailClient } from './gmail.js';
import { createHash } from 'node:crypto';
import { hash } from './security.js';
import {
  parsePayload,
  extractIdentities,
  validate,
  type Row,
} from './parsers.js';
import type pg from 'pg';
export function senderAddress(header: string) {
  return (header.match(/<([^<>]+)>\s*$/)?.[1] || header).trim().toLowerCase();
}
export function trusted(source: any, message: any) {
  const sender = senderAddress(message.sender || '');
  const domain = sender.split('@')[1];
  return Boolean(
    (source.require_authentication !== true ||
      message.authenticated === true) &&
    source.enabled &&
    (source.sender || source.domain) &&
    (!source.sender || sender === source.sender.toLowerCase()) &&
    (!source.domain || domain === source.domain.toLowerCase()) &&
    (!source.subject_contains ||
      (message.subject || '')
        .toLowerCase()
        .includes(source.subject_contains.toLowerCase())) &&
    (!source.label || message.labels?.includes(source.label)) &&
    (!source.keyword || message.text?.includes(source.keyword)) &&
    (!source.vendor_identifier ||
      message.text?.includes(source.vendor_identifier)) &&
    (!source.filename_contains ||
      message.files?.some((f: any) =>
        f.filename.includes(source.filename_contains),
      )) &&
    (!source.attachment_type ||
      message.files?.some((f: any) => f.mimeType === source.attachment_type)),
  );
}
async function quality(
  c: pg.PoolClient,
  meter: string | null,
  message: string,
  code: string,
  severity: string,
  reading: string | null = null,
) {
  await c.query(
    'INSERT INTO data_quality_events(id,meter_id,message_id,reading_id,code,severity) VALUES($1,$2,$3,$4,$5,$6)',
    [uuid(), meter, message, reading, code, severity],
  );
}
async function normalize(
  c: pg.PoolClient,
  message: any,
  parser: any,
  raw: Row,
  row: Row,
) {
  const ids = extractIdentities(row);
  if (!ids.length) {
    await quality(c, null, message.id, 'Missing meter identity', 'Rejected');
    return 'Failed';
  }
  const candidates = new Set<string>();
  const unknown = [];
  for (const id of ids) {
    const matches = await c.query(
      'SELECT DISTINCT meter_id FROM meter_identifiers WHERE namespace=$1 AND kind=$2 AND normalized=$3',
      [parser.namespace, id.kind, id.normalized],
    );
    matches.rows.forEach((x) => candidates.add(x.meter_id));
    if (!matches.rowCount) unknown.push(id);
  }
  if (candidates.size !== 1) {
    for (const id of ids) {
      const result = await c.query(
        `INSERT INTO unidentified_meters(id,namespace,kind,detected_id,first_seen,last_seen,status,sample) VALUES($1,$2,$3,$4,$5,$5,$6,$7) ON CONFLICT(namespace,kind,detected_id) DO UPDATE SET first_seen=LEAST(unidentified_meters.first_seen,EXCLUDED.first_seen),last_seen=GREATEST(unidentified_meters.last_seen,EXCLUDED.last_seen),sample=EXCLUDED.sample RETURNING id`,
        [
          uuid(),
          parser.namespace,
          id.kind,
          id.normalized,
          message.received_at,
          candidates.size > 1 ? 'Conflict' : 'Review',
          JSON.stringify({ normalized: row, raw }),
        ],
      );
      await c.query(
        'INSERT INTO discovered_transmissions VALUES($1,$2) ON CONFLICT DO NOTHING',
        [result.rows[0].id, message.id],
      );
    }
    if (candidates.size > 1)
      await quality(c, null, message.id, 'Identity conflict', 'Rejected');
    return 'Unknown Meter';
  }
  const meter = [...candidates][0];
  await c.query(
    'INSERT INTO meter_transmissions VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [meter, message.id, message.received_at],
  );
  const asset = (
    await c.query('SELECT * FROM meters WHERE id=$1 FOR UPDATE', [meter])
  ).rows[0];
  const previous = (
    await c.query(
      'SELECT reading_at,cumulative_volume FROM meter_readings WHERE meter_id=$1 ORDER BY reading_at DESC LIMIT 1',
      [meter],
    )
  ).rows[0];
  const q = validate(row, previous);
  if (
    asset.max_volume_jump &&
    previous?.cumulative_volume !== null &&
    q.values.cumulative_volume - Number(previous?.cumulative_volume) >
      Number(asset.max_volume_jump)
  ) {
    q.events.push('Excessive reading jump');
    if (q.status !== 'Rejected') q.status = 'Suspect';
  }
  for (const event of q.events)
    await quality(c, meter, message.id, event, q.status);
  if (q.status === 'Rejected' || !q.timestamp) return 'Failed';
  const installation = (
    await c.query(
      'SELECT id,point_id FROM meter_installations WHERE meter_id=$1 AND installed_at<=$2 AND (removed_at IS NULL OR removed_at>$2)',
      [meter, q.timestamp],
    )
  ).rows;
  if (installation.length > 1) {
    await quality(
      c,
      meter,
      message.id,
      'Ambiguous installation period',
      'Rejected',
    );
    return 'Failed';
  }
  const id = uuid();
  const v = q.values;
  const reading = await c.query(
    `INSERT INTO meter_readings(id,meter_id,installation_id,point_id,reading_at,received_at,original_timestamp,original_timezone,sequence,cumulative_volume,flow_rate,forward_volume,reverse_volume,pressure,temperature,battery,signal_strength,device_status,alarm_codes,error_codes,communication_status,unit,source_message_id,parser_id,quality,raw_value) VALUES(${Array.from({ length: 26 }, (_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT(meter_id,reading_at,sequence) DO NOTHING RETURNING id`,
    [
      id,
      meter,
      installation[0]?.id || null,
      installation[0]?.point_id || null,
      q.timestamp,
      message.received_at,
      String(row.reading_timestamp),
      row.timezone || null,
      String(row.sequence || ''),
      v.cumulative_volume ?? null,
      v.flow_rate ?? null,
      v.forward_volume ?? null,
      v.reverse_volume ?? null,
      v.pressure ?? null,
      v.temperature ?? null,
      v.battery ?? null,
      v.signal_strength ?? null,
      row.device_status || null,
      row.alarm_codes || null,
      row.error_codes || null,
      row.communication_status || null,
      row.unit || null,
      message.id,
      parser.id,
      q.status,
      JSON.stringify(raw),
    ],
  );
  if (!reading.rowCount) {
    await c.query('INSERT INTO duplicate_events VALUES($1,$2,$3,now())', [
      uuid(),
      message.id,
      'Duplicate meter/timestamp/sequence',
    ]);
    return 'Duplicate';
  }
  if (row.alarm_codes)
    await c.query(
      'INSERT INTO meter_alarms(id,meter_id,reading_id,code) VALUES($1,$2,$3,$4)',
      [uuid(), meter, id, String(row.alarm_codes)],
    );
  return 'Processed';
}
export async function processMessage(id: string, retry = false) {
  const message = (
    await db.query('SELECT * FROM email_messages WHERE id=$1', [id])
  ).rows[0];
  if (!message) throw new Error('Message not found');
  if (
    (
      await db.query(
        "SELECT 1 FROM email_processing_logs WHERE message_id=$1 AND action='Acquisition failed' LIMIT 1",
        [id],
      )
    ).rowCount
  ) {
    throw new Error(
      'Source acquisition is incomplete. Recover the referenced attachment before parsing; partial transmissions are not accepted.',
    );
  }
  const sources = (
    await db.query(
      'SELECT s.*,p.format,p.namespace,p.record_path,p.enabled AS parser_enabled FROM email_sources s JOIN parser_configurations p ON p.id=s.parser_id WHERE s.enabled AND p.enabled',
    )
  ).rows;
  const payload = message.raw_payload;
  const files = (
    await db.query('SELECT * FROM email_attachments WHERE message_id=$1', [id])
  ).rows;
  let texts: string[] = [];
  function walk(part: any) {
    if (part?.body?.data && !part.filename)
      texts.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
    for (const child of part?.parts || []) walk(child);
  }
  walk(payload.payload);
  const matching = sources.filter((s) =>
    trusted(s, {
      ...message,
      authenticated: /(?:^|;)\s*dmarc=pass\b/i.test(
        (payload.payload?.headers || []).find(
          (h: any) =>
            h.name?.toLowerCase() === 'authentication-results' &&
            /^mx\.google\.com;/i.test(h.value || ''),
        )?.value || '',
      ),
      labels: payload.labelIds,
      text: texts.join('\n'),
      files: files.map((f) => ({
        filename: f.filename,
        mimeType: f.mime_type,
      })),
    }),
  );
  if (matching.length !== 1) {
    await db.query(
      'UPDATE email_messages SET status=$2,error=$3,processed_at=now() WHERE id=$1',
      [
        id,
        matching.length ? 'Failed' : 'Rejected',
        matching.length
          ? 'Multiple source rules matched'
          : 'No enabled trusted source matched',
      ],
    );
    return;
  }
  const source = matching[0];
  const mappings = (
    await db.query(
      'SELECT source,target FROM field_mappings WHERE parser_id=$1',
      [source.parser_id],
    )
  ).rows;
  const parser = {
    id: source.parser_id,
    format: source.format,
    namespace: source.namespace,
    record_path: source.record_path,
    mappings,
  };
  try {
    const ext: Record<string, string> = {
      json: '.json',
      csv: '.csv',
      xlsx: '.xlsx',
      xml: '.xml',
      txt: '.txt',
      html: '.html',
    };
    const selected = files.filter(
      (f) =>
        f.filename.toLowerCase().endsWith(ext[parser.format]) &&
        (!source.filename_contains ||
          f.filename.includes(source.filename_contains)) &&
        (!source.attachment_type || f.mime_type === source.attachment_type),
    );
    const inputs = selected.length
      ? selected.map((f) => Buffer.from(f.payload))
      : ['txt', 'html'].includes(parser.format) &&
          !source.filename_contains &&
          !source.attachment_type
        ? [Buffer.from(texts.join('\n'))]
        : [];
    if (!inputs.length)
      throw new Error('No payload matches the configured parser format');
    const parsed = (
      await Promise.all(inputs.map((data) => parsePayload(data, parser)))
    ).flat();
    if (!parsed.length) throw new Error('Parser produced no records');
    await transaction(async (c) => {
      const locked = (
        await c.query(
          'SELECT status FROM email_messages WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      if (!retry && locked.status !== 'Pending') return;
      const states = [];
      for (const row of parsed)
        states.push(
          await normalize(c, message, parser, row.raw, row.normalized),
        );
      const status = states.includes('Failed')
        ? 'Failed'
        : states.includes('Unknown Meter')
          ? 'Unknown Meter'
          : states.every((s) => s === 'Duplicate')
            ? 'Duplicate'
            : 'Processed';
      await c.query(
        'UPDATE email_messages SET status=$2,parser_id=$3,processed_at=now(),error=$4,retry_count=retry_count+$5 WHERE id=$1',
        [
          id,
          status,
          parser.id,
          status === 'Failed'
            ? 'One or more rows failed validation; inspect data quality events'
            : null,
          retry ? 1 : 0,
        ],
      );
      await c.query(
        'INSERT INTO email_processing_logs(id,message_id,action,detail) VALUES($1,$2,$3,$4)',
        [
          uuid(),
          id,
          retry ? 'Reprocessed' : 'Processed',
          JSON.stringify({ rows: parsed.length, states }),
        ],
      );
      await audit(
        c,
        null,
        retry ? 'Message reprocessed' : 'Email processed',
        id,
        null,
        { status },
      );
    });
  } catch (e) {
    await db.query(
      'UPDATE email_messages SET status=$2,error=$3,parser_id=$4,retry_count=retry_count+$5 WHERE id=$1',
      [
        id,
        'Failed',
        e instanceof Error ? e.message : 'Parsing failed',
        parser.id,
        retry ? 1 : 0,
      ],
    );
    await audit(db, null, 'Parsing failed', id);
  }
}
export async function sync() {
  const lock = await db.connect();
  let acquired = false;
  try {
    if (
      !(await lock.query('SELECT pg_try_advisory_lock(918223) AS locked'))
        .rows[0].locked
    )
      throw new Error('A synchronization is already running');
    acquired = true;
    const gmail = await gmailClient();
    await db.query(
      `UPDATE system_settings SET value=value || '{"running":true,"last_error":null}'::jsonb WHERE name='sync'`,
    );
    const configured = (
      await db.query(
        'SELECT 1 FROM email_sources s JOIN parser_configurations p ON p.id=s.parser_id WHERE s.enabled AND p.enabled LIMIT 1',
      )
    ).rowCount;
    if (!configured)
      throw new Error(
        'Enable a trusted source and mapped parser before synchronization',
      );
    const settings = (
      await db.query("SELECT value FROM system_settings WHERE name='ingestion'")
    ).rows[0]?.value;
    const days = Number(
      settings?.discovery_days || process.env.DISCOVERY_DAYS || 30,
    );
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Invalid discovery period');
    let pageToken: string | undefined;
    let discovered = 0;
    do {
      const list = await gmail.users.messages.list({
        userId: 'me',
        q: `newer_than:${days}d`,
        maxResults: 100,
        pageToken,
      });
      for (const item of list.data.messages || []) {
        if (!item.id) continue;
        const exists = (
          await db.query('SELECT status FROM email_messages WHERE id=$1', [
            item.id,
          ])
        ).rows[0];
        if (exists) {
          if (exists.status === 'Pending') await processMessage(item.id);
          continue;
        }
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: item.id,
          format: 'full',
        });
        const raw = response.data;
        let acquisitionError: string | null =
          (raw.sizeEstimate || 0) > 15 * 1024 * 1024
            ? 'Message exceeds 15 MiB; original Gmail payload references preserved for administrator review'
            : null;
        const headers = Object.fromEntries(
          (raw.payload?.headers || []).map((h) => [
            (h.name || '').toLowerCase(),
            h.value,
          ]),
        );
        const attachments: any[] = [];
        async function walk(part: any) {
          if (part.filename) {
            let data = part.body?.data;
            if (!data && part.body?.attachmentId) {
              if ((part.body.size || 0) > 10 * 1024 * 1024)
                throw new Error('Attachment exceeds 10 MiB');
              data = (
                await gmail.users.messages.attachments.get({
                  userId: 'me',
                  messageId: item.id!,
                  id: part.body.attachmentId,
                })
              ).data.data;
            }
            if (data) {
              const buffer = Buffer.from(data, 'base64url');
              attachments.push({
                name: part.filename,
                mime: part.mimeType,
                buffer,
                checksum: createHash('sha256').update(buffer).digest('hex'),
              });
            }
          }
          for (const child of part.parts || []) await walk(child);
        }
        if (!acquisitionError) {
          try {
            await walk(raw.payload || {});
          } catch (e) {
            acquisitionError =
              e instanceof Error ? e.message : 'Attachment retrieval failed';
          }
        }
        await transaction(async (c) => {
          const added = await c.query(
            'INSERT INTO email_messages(id,thread_id,sender,recipient,subject,received_at,raw_payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
            [
              item.id,
              raw.threadId || item.id,
              headers.from || '',
              headers.to || '',
              headers.subject || '',
              new Date(Number(raw.internalDate)).toISOString(),
              JSON.stringify(raw),
            ],
          );
          if (added.rowCount)
            for (const a of attachments)
              await c.query(
                'INSERT INTO email_attachments VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
                [uuid(), item.id, a.name, a.mime, a.checksum, a.buffer],
              );
          if (acquisitionError) {
            await c.query(
              "UPDATE email_messages SET status='Failed',error=$2 WHERE id=$1",
              [item.id, acquisitionError],
            );
            await c.query(
              'INSERT INTO email_processing_logs(id,message_id,action,detail) VALUES($1,$2,$3,$4)',
              [uuid(), item.id, 'Acquisition failed', acquisitionError],
            );
          }
        });
        discovered++;
        if (!acquisitionError) await processMessage(item.id);
      }
      pageToken = list.data.nextPageToken || undefined;
    } while (pageToken);
    await db.query(
      `UPDATE system_settings SET value=jsonb_build_object('running',false,'last_success',now(),'last_error',null,'discovered',$1::int) WHERE name='sync'`,
      [discovered],
    );
    return { discovered };
  } catch (e) {
    if (acquired)
      await db.query(
        `UPDATE system_settings SET value=value || jsonb_build_object('running',false,'last_error',$1::text) WHERE name='sync'`,
        [e instanceof Error ? e.message : 'Synchronization failed'],
      );
    throw e;
  } finally {
    if (acquired) await lock.query('SELECT pg_advisory_unlock(918223)');
    lock.release();
  }
}
