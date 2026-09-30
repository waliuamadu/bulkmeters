# Security and operational controls

Implemented controls: server-side sessions stored as SHA-256 token hashes; scrypt password hashes with unique salts; eight-hour expiry; production Secure/HttpOnly/SameSite cookies; exact-origin and CSRF checks on mutations; role/region/facility authorization; parameterized SQL; Zod input validation; Helmet headers on the API; API/login rate limits; minimal read-only Gmail scope; single-use session-bound OAuth state; encrypted tokens; source allow rules and Gmail DMARC-pass requirement; bounded payload/row counts; ZIP directory size checks; XML DTD/entity and XLSX formula rejection; React-escaped rendering; spreadsheet formula-safe CSV; immutable audit trigger; historical installation overlap protection; transaction/advisory locks and uniqueness constraints for idempotency.

Raw payload previews are restricted to integration administrators, text-rendered, and audited. The public-facing API proxy accepts only a configured upstream origin; callers cannot select another host. It forwards only the session, CSRF, content-type and Origin headers. It never forwards API credentials to browser JavaScript.

## Production deployment requirements

- Use HTTPS for both frontend and API. Set `NODE_ENV=production`, the exact `APP_ORIGIN`, a private/API network binding, and a verified TLS database connection. Never disable certificate checks.
- Keep database credentials, OAuth client secret and the token encryption key in an approved secrets manager. Rotate credentials and test token key recovery separately from database backups.
- Run migrations as a schema owner; use a separate non-owner runtime PostgreSQL role. Grant only needed table/sequence operations and no DDL, superuser, audit UPDATE/DELETE/TRUNCATE, or role-management powers. Audit triggers cannot protect against the database owner; control owner access and replicate audit data to immutable storage for higher assurance.
- Place the API behind a controlled reverse proxy. The built-in rate limiter is process-local. Use a shared limiter/queue and correct trusted-proxy configuration before horizontally scaling. Never blindly trust `X-Forwarded-For`.
- The initial local identity system has no organization SSO/MFA/password-reset UI. GWL production acceptance should select enterprise SSO/MFA and account lifecycle controls. Gmail's own 2FA remains intact.
- Treat sender filtering plus Gmail authentication as a transport control, not proof of meter correctness. Validate meter identities and payload semantics independently.
- Parser payload limits reduce risk but are not a hardened document sandbox. Run ingestion in a separate resource-limited process/container before opening it to additional vendors or large volumes. Do not execute attachments.
- Review data retention, raw-mail confidentiality, access roles, recovery targets, monitoring and Google restricted-scope obligations with the responsible GWL teams.

## Roles

Super Administrator has all capabilities. ICT Administrator manages ingestion/settings and reads the audit trail; user creation currently remains Super Administrator-only to avoid privilege escalation. Production Administrator manages registry and installation history. Operations Manager and Analyst read/export. Regional Manager reads/exports only assigned-region data; Plant Operator reads only assigned-facility data. Executive Viewer receives aggregate dashboard access only. Scoped roles fail closed if an assignment is missing, and combining a scoped role with an administrator role still removes global administration permissions.

## Dependency review

Both lockfiles are retained. Patched framework/parser versions and targeted `fflate`/ExcelJS `uuid` overrides eliminate the findings detected during this development run. `npm audit` is time-sensitive; re-run it in CI and before release. Overrides require review when their parent packages are upgraded. No `--force` or legacy peer-dependency bypass is required.

## Known acceptance limitations

There has been no real-mailbox OAuth, production PostgreSQL load/concurrency, restore rehearsal, penetration test or browser-driven visual QA in this session. The app must not be represented as operationally certified solely because compilation and fixture tests pass. See DELIVERY.md.
