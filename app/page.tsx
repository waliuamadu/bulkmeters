'use client';
import { useState, useEffect, type FormEvent } from 'react';
import {
  Droplets,
  LayoutDashboard,
  Gauge,
  Mail,
  Fingerprint,
  Settings,
  MapPin,
  ShieldCheck,
  ArrowRight,
  RefreshCw,
  Activity,
  Database,
  Search,
  LogOut,
  Users,
  History,
  AlertTriangle,
  Map,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { MeterMap } from '@/components/meter-map';
import { Reports } from '@/components/reports';
import { RecordForms } from '@/components/record-forms';
type Row = Record<string, any>;
const nav = [
  ['Overview', LayoutDashboard, 'dashboard'],
  ['Meter registry', Gauge, 'read'],
  ['Meter map', Map, 'read'],
  ['Installation points', MapPin, 'read'],
  ['Email monitor', Mail, 'ingestion'],
  ['Identity discovery', Fingerprint, 'registry'],
  ['Parsing exceptions', AlertTriangle, 'ingestion'],
  ['Data quality', ShieldCheck, 'read'],
  ['Configuration', Settings, 'ingestion'],
  ['Users', Users, 'users'],
  ['Reports', Database, 'export'],
  ['Notifications', AlertTriangle, 'read'],
  ['Meter alarms', Activity, 'read'],
  ['Audit trail', History, 'audit'],
] as const;
const date = (v: any) =>
  v
    ? new Date(v).toLocaleString('en-GB', {
        timeZone: 'Africa/Accra',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';
function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Database size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Table({
  rows,
  columns,
  onSelect,
}: {
  rows: Row[];
  columns: [string, string][];
  onSelect?: (r: Row) => void;
}) {
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {columns.map(([k, t]) => (
              <th key={k}>{t}</th>
            ))}
            {onSelect && <th>DETAILS</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map(([k]) => (
                <td key={k}>
                  {k.includes('_at') ||
                  k.endsWith('_seen') ||
                  k === 'last_transmission' ? (
                    date(r[k])
                  ) : k.includes('status') || k === 'quality' ? (
                    <span className="status neutral">{r[k] || '—'}</span>
                  ) : (
                    String(r[k] ?? '—')
                  )}
                </td>
              ))}
              {onSelect && (
                <td>
                  <Button variant="ghost" onClick={() => onSelect(r)}>
                    Review <ArrowRight />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty title="No records to display">
          Records appear after setup and ingestion, or when your filters match.
        </Empty>
      )}
    </div>
  );
}
export default function Home() {
  const [page, setPage] = useState('Overview'),
    [actor, setActor] = useState<Row | null>(null),
    [csrf, setCsrf] = useState(''),
    [data, setData] = useState<Row>({}),
    [rows, setRows] = useState<Row[]>([]),
    [lookups, setLookups] = useState<Row>({
      regions: [],
      facilities: [],
      meters: [],
      points: [],
    }),
    [config, setConfig] = useState<Row>({
      sources: [],
      parsers: [],
      targets: [],
    }),
    [connection, setConnection] = useState<Row>({}),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [selected, setSelected] = useState<Row | null>(null),
    [modal, setModal] = useState(''),
    [tab, setTab] = useState('Connection'),
    [detailTab, setDetailTab] = useState('Identity'),
    [details, setDetails] = useState<Row[]>([]);
  const can = (p: string) => !!actor?.permissions?.includes(p);
  async function api(path: string, body?: unknown): Promise<any> {
    const r = await fetch('/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json: any = await r
      .json()
      .catch(() => ({ error: 'Unexpected service response' }));
    if (!r.ok) throw new Error(json.error || 'Request failed');
    return json;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!actor) return;
    await run(async () => {
      if (page === 'Overview') setData(await api('/dashboard'));
      const endpoint: Row = {
        'Meter registry': '/meters',
        'Meter map': '/meters',
        'Installation points': '/installation-points',
        'Email monitor': '/email/messages',
        'Parsing exceptions': '/email/messages',
        'Identity discovery': '/unidentified-meters',
        'Data quality': '/data-quality',
        Users: '/users',
        'Audit trail': '/audit',
        Notifications: '/notifications',
        'Meter alarms': '/alarms',
      };
      if (endpoint[page]) setRows(await api(endpoint[page]));
      if (['Installation points', 'Users'].includes(page))
        setLookups({ ...lookups, ...(await api('/lookups')) });
      if (['Identity discovery', 'Meter registry'].includes(page))
        setLookups({
          ...lookups,
          meters: await api('/meters'),
          points: await api('/installation-points'),
        });
      if (page === 'Configuration') {
        setConfig({
          ...(await api('/configuration')),
          settings: await api('/settings'),
        });
        setConnection(await api('/email/status'));
      }
    });
  }
  useEffect(() => {
    fetch('/api/auth/me')
      .then(async (r) => {
        if (r.ok) {
          const a: any = await r.json();
          setActor(a);
          setCsrf(a.csrf);
        } else if (r.status === 503)
          setNotice(
            'Setup mode — connect the API service to enable secure sign-in and live data.',
          );
      })
      .catch(() => setNotice('API service unavailable.'));
    const view = new URLSearchParams(window.location.search).get('view');
    if (view) setPage(view);
  }, []);
  useEffect(() => {
    setRows([]);
    setSearch('');
    setFilter('');
    void refresh();
  }, [page, actor]);
  async function submit(
    e: FormEvent<HTMLFormElement>,
    path: string,
    transform?: (v: Row) => Row,
  ) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await run(async () => {
      await api(path, transform ? transform(values) : values);
      if (path === '/auth/login') {
        const a = await api('/auth/me');
        setActor(a);
        setCsrf(a.csrf);
      }
      setModal('');
      setNotice('Saved successfully.');
      await refresh();
    });
  }
  async function review(r: Row) {
    await run(async () => {
      if (['Meter registry', 'Meter map'].includes(page)) {
        setSelected(await api('/meters/' + r.id));
        setDetailTab('Identity');
        setModal('meter');
      } else if (['Email monitor', 'Parsing exceptions'].includes(page)) {
        setSelected(await api('/email/messages/' + r.id));
        setModal('message');
      } else {
        setSelected(r);
        setModal('identity');
      }
    });
  }
  const filtered = rows.filter(
    (r) =>
      (!search ||
        JSON.stringify(r).toLowerCase().includes(search.toLowerCase())) &&
      (!filter ||
        [r.status, r.reporting_status, r.quality, r.severity].includes(
          filter,
        )) &&
      (page !== 'Parsing exceptions' || r.status === 'Failed'),
  );
  const cols: Record<string, [string, string][]> = {
    'Meter registry': [
      ['id', 'METER ID'],
      ['serial_number', 'SERIAL'],
      ['facility', 'FACILITY'],
      ['last_transmission', 'LAST TRANSMISSION'],
      ['flow_rate', 'FLOW'],
      ['cumulative_volume', 'VOLUME'],
      ['reporting_status', 'STATUS'],
    ],
    'Installation points': [
      ['name', 'INSTALLATION POINT'],
      ['facility', 'FACILITY'],
      ['region', 'REGION'],
      ['classification', 'CLASSIFICATION'],
    ],
    'Email monitor': [
      ['received_at', 'RECEIVED'],
      ['sender', 'SENDER'],
      ['subject', 'SUBJECT'],
      ['parser', 'PARSER'],
      ['readings', 'READINGS'],
      ['status', 'STATUS'],
    ],
    'Identity discovery': [
      ['detected_id', 'DETECTED ID'],
      ['kind', 'TYPE'],
      ['namespace', 'NAMESPACE'],
      ['first_seen', 'FIRST SEEN'],
      ['last_seen', 'LAST SEEN'],
      ['transmissions', 'MESSAGES'],
      ['status', 'STATUS'],
    ],
    'Data quality': [
      ['created_at', 'DETECTED'],
      ['meter_id', 'METER'],
      ['code', 'EXCEPTION'],
      ['severity', 'SEVERITY'],
      ['message_id', 'SOURCE'],
    ],
    Users: [
      ['email', 'EMAIL'],
      ['roles', 'ROLE'],
      ['region_id', 'REGION'],
      ['facility_id', 'FACILITY'],
      ['active', 'ACTIVE'],
    ],
    Notifications: [
      ['created_at', 'TIME'],
      ['meter_id', 'METER'],
      ['kind', 'TYPE'],
      ['detail', 'DETAIL'],
    ],
    'Meter alarms': [
      ['created_at', 'TIME'],
      ['meter_id', 'METER'],
      ['code', 'ALARM'],
    ],
    'Audit trail': [
      ['created_at', 'TIME'],
      ['email', 'ACTOR'],
      ['action', 'ACTION'],
      ['entity_id', 'RECORD'],
    ],
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandmark">
            <Droplets />
          </span>
          <div>
            GWL <b>Bulk Metering</b>
            <small>GHANA WATER LIMITED</small>
          </div>
        </div>
        <div className="workspace">PRODUCTION INTELLIGENCE</div>
        <nav>
          {nav
            .filter(
              ([, , p]) =>
                !actor || can(p) || (p === 'dashboard' && can('read')),
            )
            .map(([name, Icon]) => (
              <button
                key={name}
                className={page === name ? 'selected' : ''}
                onClick={() => {
                  setPage(name);
                  setError('');
                  setNotice('');
                }}
              >
                <Icon size={17} />
                {name}
                {name === 'Identity discovery' && (
                  <span className="navtag">NEW</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebottom">
          <ShieldCheck size={20} />
          <div>
            Controlled data. Trusted decisions.
            <small>Tier-1 metering platform</small>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <div>
            <span className="muted">Workspace</span>
            <span className="divider">/</span>Production & bulk meters
          </div>
          <div className="headerend">
            <span className="timezone">Africa / Accra · UTC</span>
            {actor ? (
              <Button
                variant="ghost"
                onClick={() =>
                  run(async () => {
                    await api('/auth/logout', {});
                    setActor(null);
                    setData({});
                    setRows([]);
                    setNotice('Signed out.');
                  })
                }
              >
                <LogOut />
                Sign out
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setModal('login')}>
                Sign in
              </Button>
            )}
            <span className="avatar">GW</span>
          </div>
        </header>
        <main>
          <div className="pagetop">
            <div>
              <div className="eyebrow">NETWORK OPERATIONS</div>
              <h1>{page === 'Overview' ? 'Production overview' : page}</h1>
              <p className="muted">
                {page === 'Overview'
                  ? 'A single view of your production meters, transmissions, and data health.'
                  : 'Traceable records. Validated identities. Reliable production intelligence.'}
              </p>
            </div>
            <div className="actions">
              {actor && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  <RefreshCw />
                  Refresh
                </Button>
              )}
              {page === 'Overview' && (
                <Button
                  variant="outline"
                  onClick={() => setPage('Configuration')}
                >
                  <Settings />
                  Set up connection
                </Button>
              )}
              {page === 'Meter registry' && can('registry') && (
                <Button onClick={() => setModal('register')}>
                  Register meter
                </Button>
              )}
              {page === 'Meter registry' && can('export') && (
                <>
                  <a
                    className="download"
                    href={
                      '/api/export?format=csv&status=' +
                      encodeURIComponent(filter)
                    }
                  >
                    Export CSV
                  </a>
                  <a
                    className="download"
                    href={
                      '/api/export?format=xlsx&status=' +
                      encodeURIComponent(filter)
                    }
                  >
                    Excel
                  </a>
                </>
              )}
              {page === 'Installation points' && can('registry') && (
                <Button onClick={() => setModal('point')}>
                  <Plus />
                  Installation point
                </Button>
              )}
              {page === 'Users' &&
                actor?.roles.includes('Super Administrator') && (
                  <Button onClick={() => setModal('user')}>
                    <Plus />
                    Add user
                  </Button>
                )}
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="success" role="status">
              {notice}
            </div>
          )}
          {page === 'Overview' ? (
            <>
              <div className="notice">
                <span className="noticeicon">
                  <Fingerprint />
                </span>
                <div>
                  <strong>Your meter network starts with discovery</strong>
                  <p>
                    Connect your mailbox, configure trusted sources, and review
                    the identities already transmitting.
                  </p>
                </div>
                <Button
                  onClick={() =>
                    setPage(actor ? 'Identity discovery' : 'Configuration')
                  }
                >
                  {actor ? 'Review identities' : 'Get started'}
                  <ArrowRight />
                </Button>
              </div>
              <div className="kpis">
                {[
                  [
                    'Registered meters',
                    data.total ?? 0,
                    'Validated physical assets',
                    Gauge,
                  ],
                  [
                    'Reporting now',
                    data.statuses?.Online ?? '—',
                    'Latest reporting health',
                    Activity,
                  ],
                  [
                    'Unidentified meters',
                    data.unidentified ?? 0,
                    'Identities awaiting review',
                    Fingerprint,
                  ],
                  [
                    'Quality exceptions',
                    data.quality_exceptions ?? 0,
                    'Flagged telemetry events',
                    ShieldCheck,
                  ],
                ].map(([label, value, caption, Icon]: any) => (
                  <section className="card kpi" key={label}>
                    <div>
                      {label}
                      <Icon size={18} />
                    </div>
                    <strong>{value}</strong>
                    <small>{caption}</small>
                  </section>
                ))}
              </div>
              <div className="panels">
                <section className="card">
                  <div className="cardtitle">
                    <h2>Transmission activity</h2>
                    <span className="pill">Last 7 days · UTC</span>
                  </div>
                  {data.trend?.length ? (
                    <div style={{ height: 230, padding: 15 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.trend}>
                          <XAxis
                            dataKey="day"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString('en-GB')
                            }
                          />
                          <YAxis />
                          <Tooltip />
                          <Area
                            dataKey="count"
                            stroke="#087c87"
                            fill="#d3eeed"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <>
                      <div className="chartempty">
                        <Activity size={30} />
                        <strong>Waiting for your first transmission</strong>
                        <p>
                          Readings will appear here after a successful mailbox
                          sync.
                        </p>
                      </div>
                      <div className="chartlabels">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                          (d) => (
                            <span key={d}>{d}</span>
                          ),
                        )}
                      </div>
                    </>
                  )}
                </section>
                <section className="card">
                  <div className="cardtitle">
                    <h2>
                      {actor ? 'Meter reporting status' : 'Ingestion health'}
                    </h2>
                    <span className="status neutral">
                      {actor ? 'Live database' : 'Not connected'}
                    </span>
                  </div>
                  <div className="pipeline">
                    {(actor
                      ? ['Online', 'Delayed', 'Offline', 'Never Reported']
                      : [
                          'Gmail connection',
                          'Trusted email sources',
                          'Parser field mappings',
                          'Identity review',
                        ]
                    ).map((x, i) => (
                      <div key={x}>
                        <span>{i + 1}</span>
                        <div>
                          <strong>{x}</strong>
                          <small>
                            {actor
                              ? 'Reporting health'
                              : i === 0
                                ? 'Secure OAuth 2.0 authorization'
                                : 'Configuration required'}
                          </small>
                        </div>
                        <span className="muted">
                          {actor ? (data.statuses?.[x] ?? 0) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              {actor && (
                <div className="statsline">
                  <span>Messages today: {data.messages_today ?? 'Scoped'}</span>
                  <span>Readings today: {data.readings_today ?? 0}</span>
                  <span>
                    Parsing failures: {data.parsing_failures ?? 'Scoped'}
                  </span>
                </div>
              )}
              <section className="card">
                <div className="cardtitle">
                  <div>
                    <h2>Production meter network</h2>
                    <p className="muted">
                      Validated meters and their latest reporting status
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setPage('Meter registry')}
                  >
                    View registry <ArrowRight />
                  </Button>
                </div>
                {!data.total ? (
                  <Empty title="No production meters registered yet">
                    Discover transmitting identities, then validate their asset
                    and installation details.
                  </Empty>
                ) : (
                  <div className="distribution">
                    {Object.entries(data.distribution || {}).map(([r, n]) => (
                      <div key={r}>
                        <span>{r}</span>
                        <b>{String(n)} meters</b>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : !actor ? (
            <section className="card">
              <Empty title="Sign in to access this workspace">
                Operational records and configuration are protected by
                role-based access. No mailbox data is loaded in setup mode.
              </Empty>
              <div className="center">
                <Button onClick={() => setModal('login')}>
                  Sign in securely <ArrowRight />
                </Button>
              </div>
            </section>
          ) : page === 'Reports' ? (
            <Reports />
          ) : page === 'Configuration' ? (
            <>
              <div className="tabs">
                {['Connection', 'Parsers & mappings', 'Trusted sources'].map(
                  (t) => (
                    <Button
                      key={t}
                      variant={tab === t ? 'default' : 'outline'}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </Button>
                  ),
                )}
              </div>
              {tab === 'Connection' ? (
                <section className="card">
                  <div className="cardtitle">
                    <div>
                      <h2>Gmail ingestion channel</h2>
                      <p className="muted">mag8000bulkmeters@gmail.com</p>
                    </div>
                    <span className="status neutral">
                      {connection.connected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <div className="details">
                    <p>
                      Google OAuth 2.0 · Read-only mailbox access · Automatic
                      token refresh
                    </p>
                    <p className="muted">
                      Your account owner completes Google's sign-in and
                      two-factor authentication. Gmail passwords are never
                      collected.
                    </p>
                    <div className="connectiongrid">
                      {[
                        [
                          'Last successful sync',
                          date(connection.settings?.last_success),
                        ],
                        [
                          'Polling interval',
                          (connection.poll_minutes ?? 5) + ' minutes',
                        ],
                        [
                          'Discovery window',
                          (connection.discovery_days ?? 30) + ' days',
                        ],
                        ['Next scheduled sync', date(connection.next_sync)],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <small>{k}</small>
                          <strong>{v}</strong>
                        </div>
                      ))}
                    </div>
                    {connection.settings?.last_error && (
                      <div className="error">
                        {connection.settings.last_error}
                      </div>
                    )}
                    <div className="actions">
                      <Button
                        variant="outline"
                        onClick={() => setModal('schedule')}
                      >
                        Polling settings
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api('/oauth/start');
                            window.location.assign(r.url);
                          })
                        }
                      >
                        {connection.connected
                          ? 'Reconnect Gmail'
                          : 'Connect Gmail'}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!connection.connected || busy}
                        onClick={() =>
                          run(async () => {
                            const r = await api('/email/sync', {});
                            setNotice(
                              `Sync finished. ${r.discovered} new messages discovered.`,
                            );
                            setConnection(await api('/email/status'));
                          })
                        }
                      >
                        <RefreshCw />
                        Sync now
                      </Button>
                    </div>
                  </div>
                </section>
              ) : tab === 'Parsers & mappings' ? (
                <section className="card">
                  <div className="cardtitle">
                    <div>
                      <h2>Parser adapters</h2>
                      <p className="muted">
                        Map fields only after examining representative messages.
                      </p>
                    </div>
                    <Button onClick={() => setModal('parser')}>
                      <Plus />
                      Add parser
                    </Button>
                  </div>
                  <Table
                    rows={config.parsers}
                    columns={[
                      ['name', 'PARSER'],
                      ['format', 'FORMAT'],
                      ['namespace', 'IDENTITY NAMESPACE'],
                      ['enabled', 'ENABLED'],
                    ]}
                    onSelect={(p) => {
                      setSelected(p);
                      setModal('parser-edit');
                    }}
                  />
                  {config.parsers.map((p: Row) => (
                    <div className="details" key={p.id}>
                      <strong>{p.name}</strong>
                      <p>
                        {p.mappings
                          .map((m: Row) => `${m.source} → ${m.target}`)
                          .join(' · ')}
                      </p>
                    </div>
                  ))}
                </section>
              ) : (
                <section className="card">
                  <div className="cardtitle">
                    <div>
                      <h2>Email source configuration</h2>
                      <p className="muted">
                        Only messages matching one enabled trusted source are
                        parsed.
                      </p>
                    </div>
                    <Button
                      disabled={!config.parsers.length}
                      onClick={() => setModal('source')}
                    >
                      <Plus />
                      Add source
                    </Button>
                  </div>
                  <Table
                    rows={config.sources}
                    columns={[
                      ['name', 'SOURCE'],
                      ['sender', 'SENDER'],
                      ['domain', 'DOMAIN'],
                      ['subject_contains', 'SUBJECT CONTAINS'],
                      ['enabled', 'ENABLED'],
                    ]}
                    onSelect={(p) => {
                      setSelected(p);
                      setModal('source-edit');
                    }}
                  />
                </section>
              )}
            </>
          ) : (
            <section className="card">
              <div className="toolbar">
                <div className="searchbox">
                  <Search size={16} />
                  <Input
                    aria-label="Search records"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search this view…"
                  />
                </div>
                <select
                  aria-label="Filter status"
                  className="filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {[
                    ...new Set(
                      rows
                        .map(
                          (r) => r.reporting_status || r.status || r.severity,
                        )
                        .filter(Boolean),
                    ),
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <span className="muted rowcount">
                  {filtered.length} records
                </span>
              </div>
              {page === 'Installation points' && can('registry') && (
                <div className="details actions">
                  <Button variant="outline" onClick={() => setModal('region')}>
                    Add region
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setModal('facility')}
                  >
                    Add facility
                  </Button>
                </div>
              )}
              {page === 'Meter map' ? (
                <>
                  <MeterMap meters={filtered as any} onSelect={review} />
                  <Table
                    rows={filtered.filter(
                      (r) => r.latitude !== null && r.longitude !== null,
                    )}
                    columns={[
                      ['id', 'METER'],
                      ['facility', 'FACILITY'],
                      ['latitude', 'LATITUDE'],
                      ['longitude', 'LONGITUDE'],
                      ['reporting_status', 'STATUS'],
                    ]}
                    onSelect={review}
                  />
                  {filtered
                    .filter((r) => r.latitude !== null && r.longitude !== null)
                    .map((r) => (
                      <p className="maplink" key={r.id}>
                        <a
                          href={`https://www.openstreetmap.org/?mlat=${Number(r.latitude)}&mlon=${Number(r.longitude)}#map=14/${Number(r.latitude)}/${Number(r.longitude)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open {r.id} on OpenStreetMap ↗
                        </a>
                      </p>
                    ))}
                </>
              ) : (
                <Table
                  rows={filtered}
                  columns={
                    cols[
                      page === 'Parsing exceptions' ? 'Email monitor' : page
                    ] || []
                  }
                  onSelect={
                    ['Meter registry', 'Identity discovery'].includes(page) ||
                    (['Email monitor', 'Parsing exceptions'].includes(page) &&
                      can('raw'))
                      ? review
                      : undefined
                  }
                />
              )}
            </section>
          )}
          <footer>
            <span>
              <span className="dot" />
              {actor
                ? `${actor.email} · ${actor.roles.join(', ')}`
                : 'Setup mode · No live data connected'}
            </span>
            <span>Ghana Water Limited · Production Meter Intelligence</span>
          </footer>
        </main>
      </div>
      <Dialog
        open={!!modal}
        onOpenChange={(open) => {
          if (!open) {
            setModal('');
            setError('');
          }
        }}
      >
        <DialogContent className="productdialog">
          <DialogTitle>
            {(
              {
                login: 'Secure sign-in',
                identity: 'Review discovered identity',
                meter: 'Production meter profile',
                message: 'Source message & processing history',
                parser: 'Configure a parser',
                source: 'Trusted email source',
                point: 'Create installation point',
                region: 'Create region',
                facility: 'Create facility',
                user: 'Create user',
              } as Row
            )[modal] || modal}
          </DialogTitle>
          <DialogDescription>
            {modal === 'login'
              ? 'Use the administrator account created during setup.'
              : 'Changes are permission-checked and recorded in the audit trail.'}
          </DialogDescription>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {modal === 'identity' && selected ? (
            <>
              <div className="details">
                <strong>{selected.detected_id}</strong>
                <p>
                  {selected.kind} · {selected.namespace} ·{' '}
                  {selected.transmissions} messages
                </p>
                <p className="muted">
                  First: {date(selected.first_seen)} · Last:{' '}
                  {date(selected.last_seen)}
                </p>
                <pre>{JSON.stringify(selected.sample, null, 2)}</pre>
              </div>
              {['Review', 'Conflict'].includes(selected.status) && (
                <>
                  <RecordForms
                    modal="identity"
                    submit={submit}
                    busy={busy}
                    config={config}
                    lookups={lookups}
                    selected={selected}
                  />
                  <div className="actions">
                    {['ignore', 'invalid'].map((a) => (
                      <Button
                        variant="outline"
                        key={a}
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/unidentified-meters/${selected.id}/${a}`,
                              {},
                            );
                            setModal('');
                            await refresh();
                          })
                        }
                      >
                        {a === 'ignore' ? 'Ignore' : 'Mark invalid'}
                      </Button>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : modal === 'message' && selected ? (
            <div className="details">
              <strong>{selected.subject}</strong>
              <p>
                {selected.sender} · {date(selected.received_at)}
              </p>
              <p>
                {selected.status} · Retries: {selected.retry_count}
              </p>
              {selected.error && <div className="error">{selected.error}</div>}
              <Table
                rows={selected.attachments || []}
                columns={[
                  ['filename', 'ATTACHMENT'],
                  ['mime_type', 'FORMAT'],
                  ['checksum', 'CHECKSUM'],
                ]}
              />
              <pre>
                {JSON.stringify(
                  { logs: selected.logs, source: selected.raw_payload },
                  null,
                  2,
                )}
              </pre>
              <div className="actions">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/email/messages/${selected.id}/retry`, {});
                      setSelected(await api('/email/messages/' + selected.id));
                      await refresh();
                    })
                  }
                >
                  Retry processing
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setModal('');
                    setPage('Configuration');
                    setTab('Parsers & mappings');
                  }}
                >
                  Map fields
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/email/messages/${selected.id}/ignore`, {});
                      setModal('');
                      await refresh();
                    })
                  }
                >
                  Ignore
                </Button>
              </div>
            </div>
          ) : modal === 'meter' && selected ? (
            <div className="details">
              <div className="actions">
                {can('registry') && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setModal('meter-edit')}
                    >
                      Edit meter
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setModal('identifier')}
                    >
                      Add identifier
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setModal('replace')}
                    >
                      Replace meter
                    </Button>
                  </>
                )}
              </div>
              <h3>
                {selected.id} ·{' '}
                {selected.serial_number || 'Serial not supplied'}
              </h3>
              <p>
                {selected.facility || 'Unassigned'} /{' '}
                {selected.installation_point || 'Unassigned installation'}
              </p>
              <div className="tabs">
                {[
                  'Identity',
                  'Readings',
                  'Transmissions',
                  'Alarms',
                  'Asset history',
                ].map((t) => (
                  <Button
                    key={t}
                    variant={detailTab === t ? 'default' : 'outline'}
                    onClick={() =>
                      run(async () => {
                        setDetailTab(t);
                        if (['Readings', 'Transmissions', 'Alarms'].includes(t))
                          setDetails(
                            await api(
                              `/meters/${selected.id}/${t.toLowerCase()}`,
                            ),
                          );
                      })
                    }
                  >
                    {t}
                  </Button>
                ))}
              </div>
              {detailTab === 'Identity' ? (
                <>
                  <div className="connectiongrid">
                    {[
                      ['Manufacturer', selected.manufacturer],
                      ['Model', selected.model],
                      ['Reporting', selected.reporting_status],
                      ['Flow', selected.flow_rate],
                      ['Volume', selected.cumulative_volume],
                      ['Last reading', date(selected.reading_at)],
                      ['Last transmission', date(selected.received_at)],
                      ['Unit', selected.unit],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <small>{k}</small>
                        <strong>{v ?? '—'}</strong>
                      </div>
                    ))}
                  </div>
                  <Table
                    rows={selected.identifiers || []}
                    columns={[
                      ['kind', 'IDENTIFIER TYPE'],
                      ['value', 'VALUE'],
                      ['namespace', 'NAMESPACE'],
                    ]}
                  />
                </>
              ) : detailTab === 'Asset history' ? (
                <Table
                  rows={selected.installations || []}
                  columns={[
                    ['installation_point', 'POINT'],
                    ['facility', 'FACILITY'],
                    ['installed_at', 'INSTALLED'],
                    ['removed_at', 'REMOVED'],
                  ]}
                />
              ) : detailTab === 'Readings' ? (
                <>
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[...details].reverse()}>
                        <XAxis dataKey="reading_at" hide />
                        <YAxis />
                        <Tooltip />
                        <Area
                          dataKey="flow_rate"
                          stroke="#087c87"
                          fill="#d3eeed"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <Table
                    rows={details}
                    columns={[
                      ['reading_at', 'READING TIME'],
                      ['flow_rate', 'FLOW'],
                      ['cumulative_volume', 'VOLUME'],
                      ['quality', 'QUALITY'],
                    ]}
                  />
                </>
              ) : (
                <Table
                  rows={details}
                  columns={
                    detailTab === 'Alarms'
                      ? [
                          ['created_at', 'TIME'],
                          ['code', 'ALARM'],
                        ]
                      : [
                          ['received_at', 'RECEIVED'],
                          ['source_message_id', 'SOURCE MESSAGE'],
                          ['quality', 'QUALITY'],
                        ]
                  }
                />
              )}
            </div>
          ) : (
            <RecordForms
              modal={modal}
              submit={submit}
              busy={busy}
              config={config}
              lookups={lookups}
              selected={selected || undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
