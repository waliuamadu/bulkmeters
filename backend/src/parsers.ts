import { parse as csv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import { convert } from 'html-to-text';
export type Mapping = { source: string; target: string };
export type ParserConfig = {
  format: string;
  namespace: string;
  record_path: string;
  mappings: Mapping[];
};
export type Row = Record<string, unknown>;
export type Adapter = (data: Buffer, config: ParserConfig) => Promise<Row[]>;
// Bound advertised decompressed XLSX size before ExcelJS inflates the ZIP.
export function validateWorkbookArchive(data: Buffer) {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Invalid XLSX archive');
  const entries = data.readUInt16LE(end + 10);
  let pos = data.readUInt32LE(end + 16),
    total = 0;
  if (entries > 2000 || entries === 65535)
    throw new Error('Workbook entry limit exceeded');
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > data.length || data.readUInt32LE(pos) !== 0x02014b50)
      throw new Error('Invalid ZIP directory');
    const expanded = data.readUInt32LE(pos + 24),
      compressed = data.readUInt32LE(pos + 20);
    total += expanded;
    if (
      data.readUInt16LE(pos + 8) & 1 ||
      expanded === 0xffffffff ||
      total > 50 * 1024 * 1024 ||
      expanded / Math.max(1, compressed) > 1000
    )
      throw new Error('Unsafe or oversized workbook');
    pos +=
      46 +
      data.readUInt16LE(pos + 28) +
      data.readUInt16LE(pos + 30) +
      data.readUInt16LE(pos + 32);
  }
}
const MAX_BYTES = 10 * 1024 * 1024,
  MAX_ROWS = 50000;
export const identities = [
  'meter_serial_number',
  'meter_id',
  'device_id',
  'smart_meter_id',
  'communication_id',
  'transmitter_id',
  'logger_id',
  'gateway_id',
  'station_id',
  'sensor_id',
  'imei',
  'sim_identifier',
  'vendor_identifier',
];
export const measurements = [
  'cumulative_volume',
  'flow_rate',
  'forward_volume',
  'reverse_volume',
  'pressure',
  'temperature',
  'battery',
  'signal_strength',
];
export const targets = [
  ...identities,
  ...measurements,
  'reading_timestamp',
  'timezone',
  'sequence',
  'unit',
  'device_status',
  'alarm_codes',
  'error_codes',
  'communication_status',
];
export function at(value: any, path: string): any {
  return path
    ? path
        .split('.')
        .reduce(
          (v, k) =>
            v && typeof v === 'object' && Object.hasOwn(v, k)
              ? v[k]
              : undefined,
          value,
        )
    : value;
}
function rows(value: unknown): Row[] {
  const arr = Array.isArray(value) ? value : [value];
  if (arr.length > MAX_ROWS) throw new Error('Row limit exceeded');
  if (arr.some((x) => !x || typeof x !== 'object' || Array.isArray(x)))
    throw new Error('Expected records; configure record_path for nested data');
  return arr as Row[];
}
const textRows = (data: Buffer) => {
  const row: Row = {};
  for (const line of data.toString('utf8').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    const eq = line.indexOf('=');
    const split = eq >= 0 && (idx < 0 || eq < idx) ? eq : idx;
    if (split > 0)
      row[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return rows(row);
};
export const adapters: Record<string, Adapter> = {
  json: async (d, c) => rows(at(JSON.parse(d.toString('utf8')), c.record_path)),
  csv: async (d) =>
    rows(
      csv(d, {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 100000,
      }),
    ),
  txt: async (d) => textRows(d),
  html: async (d) =>
    textRows(Buffer.from(convert(d.toString('utf8'), { wordwrap: false }))),
  xml: async (d, c) => {
    const s = d.toString('utf8');
    if (/<!DOCTYPE|<!ENTITY/i.test(s))
      throw new Error('XML declarations and entities are forbidden');
    return rows(
      at(
        new XMLParser({
          ignoreAttributes: false,
          processEntities: false,
          parseTagValue: false,
          parseAttributeValue: false,
        }).parse(s),
        c.record_path,
      ),
    );
  },
  xlsx: async (d) => {
    validateWorkbookArchive(d);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(d as any);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > MAX_ROWS + 1)
      throw new Error('Invalid worksheet or row limit exceeded');
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    const result: Row[] = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const record: Row = {};
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1);
        if (cell.type === ExcelJS.ValueType.Formula)
          throw new Error('Formula cells are not accepted');
        // Excel dates have no source timezone; require an explicit vendor adapter.
        if (cell.value instanceof Date)
          throw new Error(
            'Excel date cells require a validated timezone adapter; provide ISO 8601 text with offset',
          );
        record[h] = cell.value;
      });
      result.push(record);
    });
    return result;
  },
};
export async function parsePayload(data: Buffer, config: ParserConfig) {
  if (data.length > MAX_BYTES) throw new Error('Payload exceeds 10 MiB');
  const adapter = adapters[config.format];
  if (!adapter) throw new Error('Unsupported parser');
  if (!config.mappings.length)
    throw new Error(
      'Field mappings must be configured from representative source data',
    );
  const raw = await adapter(data, config);
  return raw.map((record) => {
    const normalized: Row = {};
    for (const m of config.mappings) {
      if (!targets.includes(m.target))
        throw new Error('Unknown mapping target');
      const value = at(record, m.source);
      if (value !== undefined && value !== null) normalized[m.target] = value;
    }
    return { raw: record, normalized };
  });
}
// Preserve punctuation and leading zeroes. Never conflate vendor namespaces or identifier kinds.
export const normalizeIdentity = (value: unknown) =>
  String(value).normalize('NFKC').trim().toUpperCase();
export function extractIdentities(row: Row) {
  return identities
    .filter((k) => typeof row[k] === 'string' && String(row[k]).trim())
    .map((kind) => ({
      kind,
      value: String(row[kind]),
      normalized: normalizeIdentity(row[kind]),
    }));
}
export type Quality = {
  status: 'Valid' | 'Warning' | 'Suspect' | 'Rejected';
  events: string[];
  timestamp: string | null;
  values: Record<string, number>;
};
export function validate(
  row: Row,
  previous?: {
    reading_at: Date | string;
    cumulative_volume: string | number | null;
  },
  now = Date.now(),
): Quality {
  const events: string[] = [];
  let status: Quality['status'] = 'Valid';
  const warn = (e: string, s: Quality['status']) => {
    events.push(e);
    if (
      ['Valid', 'Warning', 'Suspect', 'Rejected'].indexOf(s) >
      ['Valid', 'Warning', 'Suspect', 'Rejected'].indexOf(status)
    )
      status = s;
  };
  const ts = String(row.reading_timestamp || '');
  let timestamp: string | null = null;
  if (!ts) warn('Missing timestamp', 'Rejected');
  else if (!/(Z|[+-]\d\d:\d\d)$/i.test(ts) || Number.isNaN(Date.parse(ts)))
    warn('Timestamp requires valid ISO 8601 and explicit timezone', 'Rejected');
  else {
    timestamp = new Date(ts).toISOString();
    if (Date.parse(ts) > now + 300000) warn('Future timestamp', 'Suspect');
    if (now - Date.parse(ts) > 86400000) warn('Stale data', 'Warning');
  }
  const values: Record<string, number> = {};
  for (const k of measurements) {
    if (row[k] === undefined || row[k] === null || row[k] === '') continue;
    const n =
      typeof row[k] === 'number' ||
      (typeof row[k] === 'string' &&
        /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(String(row[k]).trim()))
        ? Number(row[k])
        : NaN;
    if (!Number.isFinite(n)) warn('Invalid ' + k, 'Rejected');
    else values[k] = n;
  }
  if (!Object.keys(values).length) warn('Missing reading', 'Rejected');
  if (!extractIdentities(row).length)
    warn('Missing meter identity', 'Rejected');
  if (values.flow_rate < 0) warn('Negative flow', 'Warning');
  if (values.cumulative_volume < 0)
    warn('Impossible cumulative volume', 'Rejected');
  if (!['m3', 'm3/h', 'L', 'L/s', 'bar', 'C', '%'].includes(String(row.unit)))
    warn('Unknown unit', 'Suspect');
  if (previous && timestamp) {
    if (Date.parse(timestamp) < new Date(previous.reading_at).getTime())
      warn('Out-of-order timestamp', 'Warning');
    if (
      previous.cumulative_volume !== null &&
      values.cumulative_volume < Number(previous.cumulative_volume)
    )
      warn('Cumulative rollback', 'Suspect');
  }
  return { status, events, timestamp, values };
}
export function reportingStatus(
  last: string | Date | null,
  expected: number,
  offline: number,
  now = Date.now(),
) {
  if (!last) return 'Never Reported';
  const age = (now - new Date(last).getTime()) / 60000;
  return age <= expected ? 'Online' : age < offline ? 'Delayed' : 'Offline';
}
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
