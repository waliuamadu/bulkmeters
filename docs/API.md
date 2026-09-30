# REST API

All `/api` endpoints require a server-side session except `POST /api/auth/login`. The OAuth callback additionally requires the same administrator session and a valid one-time state. `/health` only reports database availability.

Login: `POST /api/auth/login` with `{ "email": "...", "password": "..." }` and the configured `Origin`. The server sets an HttpOnly, SameSite=Lax cookie and returns a CSRF token. Every other mutation requires this cookie, `X-CSRF-Token`, and the exact configured `Origin`. `GET /api/auth/me` returns role/scope/permissions and CSRF token; logout is `POST /api/auth/logout`.

| Endpoint | Permission / purpose |
|---|---|
| `GET /api/dashboard` | Dashboard/read; scoped KPIs and 7-day trend |
| `GET /api/meters?search=&status=` | Read; searchable current registry |
| `POST /api/meters` | Registry; register verified asset, optional installation |
| `GET /api/meters/:id` | Read; profile, verified identifiers, installation history |
| `POST /api/meters/:id` | Registry; update asset and reporting thresholds |
| `POST /api/meters/:id/identifiers` | Registry; add explicitly verified namespace/kind/value |
| `POST /api/meters/:id/devices` | Registry; separate communication-device metadata |
| `GET /api/meters/:id/readings` | Read; up to 1,000 latest readings, scoped by historical point |
| `GET /api/meters/:id/transmissions` | Read; source summaries for readings |
| `GET /api/meters/:id/alarms` | Read; recorded alarms |
| `POST /api/meters/:id/replace` | Registry; `{replacement_id,at}`; atomic close/open periods |
| `GET/POST /api/installation-points` | Read/registry |
| `GET /api/lookups` | Read; scoped regions/facilities |
| `POST /api/regions`, `/api/facilities` | Registry; create locations |
| `GET /api/unidentified-meters` | Registry; grouped discovery candidates, transmission count |
| `POST /api/unidentified-meters/:id/register` | Registry; verified physical fields, `point_id`, ISO `installed_at` |
| `POST /api/unidentified-meters/:id/match` | Registry; `{meter_id}` |
| `POST /api/unidentified-meters/:id/ignore` or `/invalid` | Registry; reviewed disposition |
| `GET /api/email/status` | Ingestion; sync status and queue counts |
| `GET /api/email/messages` | Ingestion; metadata only, up to 1,000 |
| `GET /api/email/messages/:id` | Raw permission; raw payload, attachment hashes, processing log; access audited |
| `POST /api/email/sync` | Ingestion; synchronous manual run, advisory lock prevents overlapping runs |
| `POST /api/email/messages/:id/retry` or `/ignore` | Ingestion; audited handling |
| `GET /api/configuration` | Ingestion; parsers, mappings, trusted sources |
| `POST /api/parsers` | Ingestion; format, namespace, record path, mappings and enabled flag |
| `POST /api/parsers/:id` | Ingestion; replace mappings and enabled flag; original payload retained |
| `POST /api/sources` | Ingestion; exact sender/domain plus optional conjunctive conditions |
| `POST /api/sources/:id` | Ingestion; change enabled state |
| `GET/POST /api/settings` | Settings; poll_minutes, discovery_days, enabled |
| `GET /api/data-quality` | Read; scoped exceptions |
| `POST /api/readings/:id/correct` | Registry; flow/volume correction plus a reason; original preserved in correction ledger and audit |
| `GET /api/notifications` | Read; scoped in-app reporting notifications |
| `GET /api/alarms` | Read; scoped meter alarms |
| `GET /api/audit` | Audit permission; latest 500 immutable audit records |
| `GET/POST /api/users` | Super Administrator; initial least-privilege account creation |
| `GET /api/export` | Export; CSV/XLSX datasets and authorization checks |
| `GET /api/oauth/start` | Ingestion; OAuth URL, never token disclosure |

## Exports and bounds

`GET /api/export?dataset=history&format=csv&from=2026-09-01T00:00:00Z&to=2026-09-30T23:59:59Z`

Datasets: `registry`, `latest`, `offline`, `history`, `transmissions`, `unidentified`, `quality`. `from`/`to` apply to historical datasets. Registry exports support `status` and `search`. Unidentified exports also require registry permission. XLSX cells are explicit strings, and CSV spreadsheet formula prefixes are escaped. Exports above 100,000 rows fail explicitly; narrow the range. Listing endpoints are intentionally bounded, not silently advertised as full historical exports.

Errors use `{error:string}`: 400 validation, 401 unauthenticated, 403 forbidden/CSRF/origin, 404 absent or out-of-scope meter, 409 integrity conflict, 413 oversized export, 429 rate limit. Unexpected server errors expose no SQL or secrets; inspect service logs. Business workflow errors currently fall back to generic 500 plus a detailed internal log; refine error taxonomy before external integrator onboarding.

## Parser configuration example (synthetic, not a vendor schema)

```json
{
  "name": "Validated fixture adapter",
  "format": "json",
  "namespace": "test-fixture",
  "record_path": "records",
  "enabled": false,
  "mappings": [
    {"source": "identifier_from_fixture", "target": "device_id"},
    {"source": "time_from_fixture", "target": "reading_timestamp"},
    {"source": "volume_from_fixture", "target": "cumulative_volume"},
    {"source": "unit_from_fixture", "target": "unit"}
  ]
}
```

The `targets` array from `/api/configuration` is the authoritative list of canonical fields. No source field is interpreted without an explicit mapping.
