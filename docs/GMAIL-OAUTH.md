# Gmail OAuth and vendor validation

The application uses Google's server-side OAuth 2.0 flow with only `https://www.googleapis.com/auth/gmail.readonly`. It does not use Gmail passwords, IMAP passwords, app passwords, or disable two-factor authentication.

1. Create a Google Cloud project owned by GWL and enable Gmail API.
2. Configure the OAuth consent screen. Since the mailbox is a consumer Gmail address, configure an external application and add the mailbox owner as an allowed test user during development.
3. Create a **Web application** OAuth client. Register the exact callback URL: locally `http://localhost:3000/api/oauth/callback`; production `https://<frontend-host>/api/oauth/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_ACCOUNT`, and `TOKEN_ENCRYPTION_KEY` only in the API environment/secrets manager. The frontend receives none of these values.
5. Set backend `APP_ORIGIN` to the exact frontend origin, and frontend `API_ORIGIN` to the API origin. The callback passes through the frontend's same-origin proxy so the application session cookie remains available.
6. Sign in as Super Administrator or ICT Administrator and use Configuration → Connect Gmail. The account owner completes Google's normal sign-in, consent, and 2FA.
7. The callback validates a single-use, expiring OAuth state bound to the administrator session, verifies the authorized Gmail profile equals `mag8000bulkmeters@gmail.com`, and requires a refresh token. Tokens are AES-256-GCM encrypted in PostgreSQL with a separately supplied key.
8. Retain the read-only scope. Production use of restricted Gmail scopes may require Google verification/security assessment depending on the deployment. External apps left in testing can have short-lived refresh tokens; plan the appropriate Google production consent/verification process.

Google references: [server-side Gmail authorization](https://developers.google.com/workspace/gmail/api/auth/web-server), [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## Representative message review

No supplied data established an actual MAG8000 email schema. Do not enable a guessed vendor parser. Review representative messages from each sender and firmware/vendor variant, including normal readings, alarms, empty attachments, and multi-meter messages. Record:

- Authenticated sender/domain and Gmail label identifiers. Exact sender/domain conditions are required; content, subject, filename and MIME conditions further restrict matches.
- The identity's actual meaning. A device ID is not automatically a physical meter serial. Namespace and identifier kind remain separate.
- Whether leading zeroes, case and punctuation are significant. Current normalization trims, applies Unicode NFKC and uppercases. Validate that rule before onboarding a case-sensitive vendor; add a vendor adapter where needed.
- Exact timestamp representation and timezone. Generic adapters require ISO 8601 strings with `Z` or an explicit offset. Naive Excel date cells are rejected until a timezone adapter is validated.
- Units and cumulative counter rollover/reset rules. No inferred unit conversion or business water-balance formula is applied.

JSON/XML support a configurable dot-separated record path. CSV/XLSX expect a header row; the generic XLSX adapter reads the first worksheet and rejects formulas and timezone-less date cells. Text/HTML support explicit key/value lines separated by `:` or `=`. Other layouts need a vendor-specific adapter.

Configure source-field-to-canonical-field mappings in Configuration. Use an isolated test mailbox or fixture database first, compare extracted values to original messages, and only then enable the trusted source and scheduled ingestion. Gmail DMARC authentication results are required by default; forwarded/non-DMARC legacy feeds need an explicitly reviewed authentication adapter, not a broad mailbox allow rule.
