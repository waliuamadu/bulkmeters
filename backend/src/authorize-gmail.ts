import path from "path";
import fs from "fs";
import { authenticate } from "@google-cloud/local-auth";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

async function main() {
  console.log("Starting Google Gmail authorization...");

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${CREDENTIALS_PATH}`);
  }

  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  if (!client.credentials) {
    throw new Error("Google did not return OAuth credentials.");
  }

  fs.writeFileSync(
    TOKEN_PATH,
    JSON.stringify(client.credentials, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );

  console.log("");
  console.log("Gmail authorization successful.");
  console.log(`Token saved to: ${TOKEN_PATH}`);
  console.log("Do not commit token.json to GitHub.");
}

main().catch((error) => {
  console.error("Gmail authorization failed:");
  console.error(error);
  process.exit(1);
});