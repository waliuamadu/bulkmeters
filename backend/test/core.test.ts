import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePayload,
  normalizeIdentity,
  extractIdentities,
  validate,
  reportingStatus,
  csvCell,
} from '../src/parsers.js';
import { trusted } from '../src/ingestion.js';
import {
  roles,
  scope,
  passwordHash,
  verifyPassword,
  encrypt,
  decrypt,
} from '../src/security.js';
const config = {
  format: 'json',
  namespace: 'test',
  record_path: '',
  mappings: [
    { source: 'id', target: 'device_id' },
    { source: 'at', target: 'reading_timestamp' },
    { source: 'volume', target: 'cumulative_volume' },
  ],
};
test('JSON requires explicit mapping; does not invent serial number', async () => {
  const [row] = await parsePayload(
    Buffer.from('{"id":"001-Ab","at":"2026-09-30T00:00:00Z","volume":0}'),
    config,
  );
  assert.equal(row.normalized.cumulative_volume, 0);
  assert.equal(row.normalized.meter_serial_number, undefined);
  assert.equal(extractIdentities(row.normalized)[0].normalized, '001-AB');
});
test('normalization preserves punctuation and leading zeroes', () => {
  assert.equal(normalizeIdentity(' 001-ab '), '001-AB');
  assert.notEqual(normalizeIdentity('a-b'), normalizeIdentity('ab'));
});
test('numeric identities are not silently accepted after leading-zero loss', () =>
  assert.deepEqual(extractIdentities({ device_id: 12 }), []));
test('unmapped source rejected', async () =>
  assert.rejects(() =>
    parsePayload(Buffer.from('{}'), { ...config, mappings: [] }),
  ));
test('CSV quoted fields and TXT identifiers', async () => {
  const c = await parsePayload(Buffer.from('id,volume\n"a,b",12\n'), {
    ...config,
    format: 'csv',
  });
  assert.equal(c[0].normalized.device_id, 'a,b');
  const t = await parsePayload(Buffer.from('id: 001\nvolume=23'), {
    ...config,
    format: 'txt',
  });
  assert.equal(t[0].normalized.device_id, '001');
});
test('XML entity declaration rejected', async () =>
  assert.rejects(() =>
    parsePayload(
      Buffer.from('<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///secret">]><x/>'),
      { ...config, format: 'xml' },
    ),
  ));
test('timestamps require explicit offset and never use received time', () => {
  const q = validate({
    device_id: 'a',
    reading_timestamp: '2026-09-30T10:00:00',
    flow_rate: 4,
    unit: 'm3/h',
  });
  assert.equal(q.status, 'Rejected');
  assert.equal(q.timestamp, null);
});
test('zero volume is valid and original reading time converted to UTC', () => {
  const q = validate(
    {
      device_id: 'a',
      reading_timestamp: '2026-09-30T12:00:00+02:00',
      cumulative_volume: 0,
      unit: 'm3',
    },
    undefined,
    Date.parse('2026-09-30T10:00:00Z'),
  );
  assert.equal(q.status, 'Valid');
  assert.equal(q.timestamp, '2026-09-30T10:00:00.000Z');
});
test('rollback suspect and invalid measurements rejected', () => {
  assert.equal(
    validate(
      {
        device_id: 'a',
        reading_timestamp: '2026-09-30T10:00:00Z',
        cumulative_volume: 4,
        unit: 'm3',
      },
      { reading_at: '2026-09-30T09:00:00Z', cumulative_volume: 5 },
      Date.parse('2026-09-30T10:00:00Z'),
    ).status,
    'Suspect',
  );
  assert.equal(
    validate({
      device_id: 'a',
      reading_timestamp: '2026-09-30T10:00:00Z',
      flow_rate: 'broken',
      unit: 'm3/h',
    }).status,
    'Rejected',
  );
});
test('reporting thresholds', () => {
  const now = Date.parse('2026-09-30T10:00:00Z');
  assert.equal(reportingStatus(null, 60, 180, now), 'Never Reported');
  assert.equal(reportingStatus('2026-09-30T09:00:00Z', 60, 180, now), 'Online');
  assert.equal(
    reportingStatus('2026-09-30T08:59:00Z', 60, 180, now),
    'Delayed',
  );
  assert.equal(
    reportingStatus('2026-09-30T07:00:00Z', 60, 180, now),
    'Offline',
  );
});
test('sender and domain filters use exact matches', () => {
  assert.equal(
    trusted(
      { enabled: true, domain: 'vendor.test' },
      { sender: 'Meter <x@vendor.test>' },
    ),
    true,
  );
  assert.equal(
    trusted(
      { enabled: true, domain: 'vendor.test' },
      { sender: 'x@evilvendor.test' },
    ),
    false,
  );
  assert.equal(trusted({ enabled: true }, { sender: 'x@vendor.test' }), false);
});
test('regional roles fail closed without assignment', () => {
  assert.equal(
    scope({ roles: ['Regional Manager'], region_id: null } as any).sql,
    'FALSE',
  );
  assert.equal(
    scope({
      roles: ['Super Administrator', 'Regional Manager'],
      region_id: 'r',
    } as any).sql,
    'f.region_id=$1',
  );
  assert.ok(!roles['Executive Viewer'].includes('raw'));
  assert.ok(!roles['Analyst'].includes('registry'));
});
test('password and encrypted token tamper detection', () => {
  const h = passwordHash('correct test password');
  assert.equal(verifyPassword('correct test password', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  const encrypted = encrypt('secret');
  assert.equal(decrypt(encrypted), 'secret');
  assert.throws(() => decrypt(encrypted.slice(0, -2) + '00'));
});
test('CSV export prevents formula injection and quotes text', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('a"b'), '"a""b"');
});
import ExcelJS from 'exceljs';
test('XLSX adapter preserves text IDs and rejects formulas and timezone-less dates', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fixture');
  sheet.addRow(['id', 'volume']);
  sheet.addRow(['0007', 24]);
  const payload = Buffer.from(await workbook.xlsx.writeBuffer());
  const rows = await parsePayload(payload, { ...config, format: 'xlsx' });
  assert.equal(rows[0].normalized.device_id, '0007');
  sheet.getCell('B2').value = { formula: '12+12', result: 24 };
  await assert.rejects(
    () =>
      workbook.xlsx
        .writeBuffer()
        .then((b) =>
          parsePayload(Buffer.from(b), { ...config, format: 'xlsx' }),
        ),
    /Formula/,
  );
  sheet.getCell('B2').value = new Date();
  await assert.rejects(
    () =>
      workbook.xlsx
        .writeBuffer()
        .then((b) =>
          parsePayload(Buffer.from(b), { ...config, format: 'xlsx' }),
        ),
    /timezone/,
  );
});
test('HTML and XML adapters map only explicit fields', async () => {
  const html = await parsePayload(
    Buffer.from('<p>id: 001</p><p>volume: 4</p>'),
    { ...config, format: 'html' },
  );
  assert.equal(html[0].normalized.device_id, '001');
  const xml = await parsePayload(
    Buffer.from('<record><id>ABC</id><volume>4</volume></record>'),
    { ...config, format: 'xml', record_path: 'record' },
  );
  assert.equal(xml[0].normalized.device_id, 'ABC');
});
test('booleans and arrays cannot become numeric meter values', () => {
  for (const value of [true, false, [], [1]])
    assert.equal(
      validate({
        device_id: 'id',
        reading_timestamp: '2026-09-30T12:00:00Z',
        flow_rate: value,
        unit: 'm3/h',
      }).status,
      'Rejected',
    );
});
