import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://localhost:3000';
test('End-to-end discovery, registration, replay, API authorization, and source preservation', async () => {
  const pg = new PGlite();
  const { db } = await import('../src/db.js');
  const { passwordHash, hash } = await import('../src/security.js');
  const { processMessage } = await import('../src/ingestion.js');
  const query = async (sql: string, params: any[] = []) => {
    const r = await pg.query(sql, params);
    return { ...r, rowCount: r.affectedRows || r.rows.length };
  };
  (db as any).query = query;
  (db as any).connect = async () => ({ query, release() {} });
  for (const f of [
    '001_initial.sql',
    '002_integrity.sql',
    '003_transmissions.sql',
  ])
    await pg.exec(
      (
        await readFile(
          new URL('../../database/migrations/' + f, import.meta.url),
          'utf8',
        )
      ).replace(/^\uFEFF/, ''),
    );
  const user = randomUUID(),
    parser = randomUUID(),
    source = randomUUID(),
    region = randomUUID(),
    facility = randomUUID(),
    point = randomUUID();
  await query(
    "INSERT INTO roles VALUES('Super Administrator'),('Regional Manager')",
  );
  await query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    user,
    'admin@test.invalid',
    passwordHash('test-only-password-123'),
  ]);
  await query("INSERT INTO user_roles VALUES($1,'Super Administrator')", [
    user,
  ]);
  await query('INSERT INTO regions VALUES($1,$2)', [region, 'Test region']);
  await query('INSERT INTO facilities VALUES($1,$2,$3)', [
    facility,
    region,
    'Test facility',
  ]);
  await query(
    "INSERT INTO installation_points(id,facility_id,name,classification) VALUES($1,$2,'Test point','Treatment Outlet')",
    [point, facility],
  );
  await query(
    "INSERT INTO parser_configurations VALUES($1,'Test parser','json','fixture-vendor','',true)",
    [parser],
  );
  for (const [from, to] of [
    ['device', 'device_id'],
    ['at', 'reading_timestamp'],
    ['total', 'cumulative_volume'],
    ['unit', 'unit'],
  ])
    await query('INSERT INTO field_mappings VALUES($1,$2,$3,$4)', [
      randomUUID(),
      parser,
      from,
      to,
    ]);
  await query(
    "INSERT INTO email_sources(id,name,sender,parser_id,enabled,require_authentication) VALUES($1,'Test source','meter@vendor.invalid',$2,true,true)",
    [source, parser],
  );
  const payload = {
    payload: {
      headers: [
        {
          name: 'Authentication-Results',
          value: 'mx.google.com; dmarc=pass header.from=vendor.invalid',
        },
      ],
    },
  };
  await query(
    "INSERT INTO email_messages(id,thread_id,sender,subject,received_at,raw_payload) VALUES('m1','t1','Meter <meter@vendor.invalid>','Test',now(),$1)",
    [JSON.stringify(payload)],
  );
  await query(
    "INSERT INTO email_attachments VALUES($1,'m1','reading.json','application/json','test-checksum',$2)",
    [
      randomUUID(),
      Buffer.from(
        JSON.stringify({
          device: '0007-AB',
          at: new Date().toISOString(),
          total: 15,
          unit: 'm3',
        }),
      ),
    ],
  );
  await processMessage('m1');
  assert.equal(
    (await query("SELECT status FROM email_messages WHERE id='m1'")).rows[0]
      .status,
    'Unknown Meter',
    JSON.stringify(
      (await query("SELECT error FROM email_messages WHERE id='m1'")).rows,
    ),
  );
  assert.equal((await query('SELECT * FROM meters')).rows.length, 0);
  const unknown = (await query('SELECT * FROM unidentified_meters')).rows[0];
  assert.equal(unknown.detected_id, '0007-AB');
  await processMessage('m1', true);
  assert.equal(
    (await query('SELECT * FROM discovered_transmissions')).rows.length,
    1,
  );
  const { app } = await import('../src/server.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const address = server.address() as any;
  const base = `http://127.0.0.1:${address.port}/api`;
  try {
    assert.equal((await fetch(base + '/meters')).status, 401);
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: process.env.APP_ORIGIN!,
      },
      body: JSON.stringify({
        email: 'admin@test.invalid',
        password: 'test-only-password-123',
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const { csrf } = (await login.json()) as any;
    const headers = {
      cookie,
      origin: process.env.APP_ORIGIN!,
      'content-type': 'application/json',
      'x-csrf-token': csrf,
    };
    assert.equal(
      (
        await fetch(base + '/regions', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: '{"name":"forbidden"}',
        })
      ).status,
      403,
    );
    const register = await fetch(
      base + `/unidentified-meters/${unknown.id}/register`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          point_id: point,
          installed_at: '2020-01-01T00:00:00Z',
          manufacturer: 'Fixture maker',
        }),
      },
    );
    assert.equal(register.status, 200, await register.text());
    await processMessage('m1', true);
    assert.equal((await query('SELECT * FROM meter_readings')).rows.length, 1);
    await processMessage('m1', true);
    assert.equal((await query('SELECT * FROM meter_readings')).rows.length, 1);
    assert.equal(
      (await query('SELECT * FROM duplicate_events')).rows.length,
      1,
    );
    assert.equal(
      (await query('SELECT raw_payload FROM email_messages')).rows.length,
      1,
    );
    assert.ok((await query('SELECT * FROM audit_logs')).rows.length > 0);
    const meters = await fetch(base + '/meters', { headers });
    assert.equal(meters.status, 200);
    assert.equal(((await meters.json()) as any[]).length, 1);
    const dashboard = await fetch(base + '/dashboard', { headers });
    assert.equal(dashboard.status, 200, await dashboard.text());
    for (const path of [
      '/configuration',
      '/settings',
      '/email/status',
      '/lookups',
      '/data-quality',
      '/notifications',
      '/alarms',
      '/audit',
    ]) {
      const response = await fetch(base + path, { headers });
      assert.equal(response.status, 200, path + ': ' + (await response.text()));
    }
    for (const dataset of [
      'registry',
      'latest',
      'offline',
      'history',
      'transmissions',
      'quality',
      'unidentified',
    ]) {
      const response = await fetch(
        base + '/export?dataset=' + dataset + '&format=csv',
        { headers },
      );
      assert.equal(
        response.status,
        200,
        dataset + ': ' + (await response.text()),
      );
      assert.match(response.headers.get('content-type') || '', /text\/csv/);
    }
    const xlsx = await fetch(base + '/export?format=xlsx', { headers });
    assert.equal(xlsx.status, 200);
    assert.ok((await xlsx.arrayBuffer()).byteLength > 100);
    const limited = randomUUID();
    await query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      limited,
      'regional@test.invalid',
      passwordHash('not-used-password'),
    ]);
    await query("INSERT INTO user_roles VALUES($1,'Regional Manager')", [
      limited,
    ]);
    await query(
      "INSERT INTO sessions VALUES($1,$2,'csrf',now()+interval '1 hour')",
      [hash('restricted'), limited],
    );
    assert.deepEqual(
      await (
        await fetch(base + '/meters', {
          headers: { cookie: 'gwl_session=restricted' },
        })
      ).json(),
      [],
    );
    assert.equal(
      (
        await fetch(base + '/email/messages', {
          headers: { cookie: 'gwl_session=restricted' },
        })
      ).status,
      403,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pg.close();
  }
});
