import { google } from 'googleapis';
import { db, audit } from './db.js';
import { encrypt, decrypt } from './security.js';
export function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}
export async function gmailClient() {
  const result = await db.query(
    "SELECT encrypted_value FROM integration_secrets WHERE name='gmail'",
  );
  if (!result.rowCount) throw new Error('Gmail is not connected');
  const client = oauthClient();
  client.setCredentials(JSON.parse(decrypt(result.rows[0].encrypted_value)));
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token)
      void db
        .query(
          "UPDATE integration_secrets SET encrypted_value=$1 WHERE name='gmail'",
          [encrypt(JSON.stringify({ ...client.credentials, ...tokens }))],
        )
        .catch(() => console.error('Token persistence failed'));
  });
  return google.gmail({ version: 'v1', auth: client });
}
export async function saveTokens(tokens: object) {
  await db.query(
    "INSERT INTO integration_secrets VALUES('gmail',$1) ON CONFLICT(name) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value",
    [encrypt(JSON.stringify(tokens))],
  );
  await audit(db, null, 'Gmail connected', null);
}
