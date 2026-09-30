# Delivery and remaining acceptance work

This repository implements the core discovery and registry application, with a private setup-mode interface. It is not connected to production Gmail or a deployed PostgreSQL service.

## Implemented

- Responsive React/TypeScript dashboard, registry, map, installation-point, identity-review, email-monitor, parsing-exception, quality, notification, alarm, report, configuration, user and audit views.
- Separate Express/TypeScript REST service and PostgreSQL schema, migrations, role/admin seed, container configuration and CI validation.
- Read-only Gmail OAuth, token refresh/encryption, account verification, configurable historical discovery/polling, manual sync, trusted sources, source metadata/raw payloads and attachment checksums.
- Generic JSON, XML, CSV, XLSX, TXT and HTML adapter framework and explicitly configured mappings; no fabricated vendor schema.
- Namespace/kind-aware identity extraction and matching, unidentified/conflict review, verified registration, match/ignore/invalid decisions, preserved source data and idempotent reading replay.
- Physical meter assets, separate communication devices and installation points, period-based meter replacement history and upstream-point reference for future topology.
- Historical readings, alarms, quality flags, reporting thresholds, transmission ledger, CSV/XLSX reports, manual correction ledger/API, and in-app delayed/offline notifications.
- Session authentication, initial role matrix, regional/facility scoping, CSRF/origin checks, parameterized SQL, rate limiting and immutable user/system audit events.

## Requires the account owner / deployment environment

- Deploy and validate PostgreSQL and the Node API; configure site API origin and HTTPS.
- Configure Google Cloud OAuth credentials and have the mailbox owner consent normally with 2FA.
- Supply representative source messages through the authorized ingestion/review process. Validate actual vendor-specific identity/timezone/unit rules before enabling production parsers.
- Confirm discovered IDs represent distinct physical meters/devices; input verified locations, inventory data and commissioning/install dates.
- Run Google consent/verification, GWL access/security review, real PostgreSQL concurrency/load tests, backup restore rehearsal and operational acceptance.

## Deliberately deferred / not represented as complete

- Vendor-specific MAG8000 adapter and verified live identity inventory: requires actual source messages.
- Enterprise SSO/MFA and full account lifecycle (reset/deactivation/role-change UI), organization-wide immutable audit archiving, shared rate limiter, production job queue, and large-scale ingestion/load tuning.
- Full administration UI for every optional asset/device/plant attribute; communication-device and reading-correction operations currently have APIs, while basic meter edits and replacement are exposed in the UI.
- Dedicated advanced analytics and configurable report designer; current charts cover transmission counts and per-meter flow history, with dataset exports.
- In-app unknown/parse/abnormal-flow push notices beyond their review queues and data-quality/alarms screens; current notification feed handles delayed/offline meters.
- SCADA, AMI/HES, ERP/billing, external GIS, SMS/Teams/email notification connectors. The backend and normalized schema provide extension points.
- Water-balance calculations and financial NRW assumptions: intentionally not implemented without validated topology and business rules.

The first production success milestone can only be signed off after real OAuth, message parsing, identity validation, and continuous-ingestion verification. Fixture tests establish implementation behavior, not the count or identity of GWL's actual transmitting meters.
