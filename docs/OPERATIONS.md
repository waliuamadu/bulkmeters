# Deployment, backups, and recovery

## Containerized backend

Create `.env` from `.env.example`; choose the environment values before starting. Use a random hexadecimal database password to avoid URL-encoding ambiguity in Compose's database URL. The Compose API binds to loopback; expose it only through your controlled HTTPS reverse proxy.

```powershell
docker compose up -d db
docker compose build api
docker compose run --rm api node dist/migrate.js
docker compose run --rm api node dist/seed.js
docker compose up -d api
```

For production set `NODE_ENV=production`, HTTPS `APP_ORIGIN`, production callback URI, and token encryption key through approved secret injection. Do not leave seed password variables configured after account creation. The backend image runs as a non-root user and includes compiled migration/seed scripts. Migrations are tracked and run transactionally under an advisory lock. Roll back a release by deploying its prior image only if its schema is backward-compatible; otherwise restore a tested backup to a new database and switch the connection after validation.

The frontend is a Cloudflare-compatible Worker built with the Sites Vite plugin. A Sites publication contains the interface and API proxy, **not the Node/PostgreSQL service**. Configure a trusted HTTPS `API_ORIGIN` on the site after deploying the API; otherwise the interface intentionally returns a setup-mode 503 for live operations. Set API `APP_ORIGIN` and Google redirect URI to the actual published frontend URL. Site owner-only access is an additional gate, not a replacement for application RBAC.

## Backup and restore

Use encrypted daily PostgreSQL custom-format backups plus WAL/PITR where recovery objectives require it. PostgreSQL contains raw attachments, readings, metadata, audit and encrypted OAuth tokens; back up all schemas. Keep the encryption key in a separate secured backup with a tested recovery process. Define GWL retention/RPO/RTO before production, and rehearse restore at least quarterly.

Use `pg_dump --format=custom --file=<approved-backup-path> <database-url>` with credentials supplied by `PGPASSFILE`/environment/secrets tooling rather than shell history. Restrict backup permissions, encrypt at rest, retain off-host copies, and verify hashes.

Restore into a **new empty database** using `pg_restore --no-owner --dbname=<new-database> <backup-file>`. Apply the appropriate owner/runtime grants, verify row counts and source hashes, validate installation periods and audit continuity, and run a duplicate-message replay test. Never overwrite the live database as an unreviewed recovery experiment. Restore the token encryption key or reconnect Gmail through normal OAuth.

## Operations

- Health: `GET /health` checks PostgreSQL without exposing configuration.
- Sync status: Configuration shows last successful run, polling interval, discovery window, queue counts and error. The scheduler checks persisted settings every minute; a database advisory lock prevents simultaneous sync runs across processes.
- Logging: the API emits structured unexpected-error records. Application audit events are separately stored in PostgreSQL.
- Duplicate handling: Gmail IDs are unique; readings use meter/timestamp/sequence uniqueness; attachment SHA-256 hashes and duplicate-event logs preserve traceability.
- Failed attachments/messages remain in the queue with original Gmail payload references. Oversized source bytes may need an approved out-of-band archival process; the app preserves references and errors rather than silently pretending to have parsed them.
- Watch database growth, queue backlog, token failures, parse rejection rate, invalid timestamps, and never-reported assets. Configure infrastructure alerts for process/DB failures; in-app reporting notices are not an external paging service.
- Before high-volume rollout, replace synchronous manual HTTP sync with a durable background job queue and add bounded concurrency/backoff with operationally tested retry policies.

## Current environment validation

The local frontend responded over HTTP and its production Worker build passed. Backend schema and HTTP flows were tested with embedded PostgreSQL (PGlite). Docker was present but its engine was not running, so the Compose image/startup and a real PostgreSQL server were not exercised here. The in-app browser was unavailable; no browser automation or visual-layout verification is claimed.
