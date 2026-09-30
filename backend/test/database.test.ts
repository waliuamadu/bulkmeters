import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
test('PostgreSQL migration, identity separation, uniqueness and immutable audit', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../../database/migrations/001_initial.sql', import.meta.url),
        'utf8',
      ),
    );
    const meter = (
      await db.query<{ id: string }>(
        'INSERT INTO meters DEFAULT VALUES RETURNING id',
      )
    ).rows[0].id;
    assert.equal(meter, 'GWL-PM-000001');
    await db.query(
      "INSERT INTO email_messages(id,thread_id,received_at,raw_payload) VALUES('mail-1','thread-1',now(),'{}')",
    );
    const values = [randomUUID(), meter, '2026-09-30T10:00:00Z', 'mail-1'];
    const sql =
      "INSERT INTO meter_readings(id,meter_id,reading_at,received_at,original_timestamp,source_message_id,quality,raw_value) VALUES($1,$2,$3::timestamptz,now(),$3::text,$4,'Valid','{}')";
    await db.query(sql, values);
    await assert.rejects(
      () => db.query(sql, [randomUUID(), ...values.slice(1)]),
      /unique/i,
    );
    await db.query('INSERT INTO audit_logs(id,action) VALUES($1,$2)', [
      randomUUID(),
      'test',
    ]);
    await assert.rejects(() => db.query('DELETE FROM audit_logs'), /immutable/);
    const namespace1 = randomUUID(),
      namespace2 = randomUUID();
    await db.query(
      'INSERT INTO meter_identifiers VALUES($1,$2,$3,$4,$5,$5,now()),($6,$2,$7,$4,$5,$5,now())',
      [
        namespace1,
        meter,
        'vendor-a',
        'device_id',
        '001',
        namespace2,
        'vendor-b',
      ],
    );
    assert.equal(
      (await db.query('SELECT * FROM meter_identifiers')).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
