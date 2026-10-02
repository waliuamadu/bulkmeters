import fs from "fs";
import path from "path";
import { google } from "googleapis";

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

async function main() {
  const credentials = JSON.parse(
    fs.readFileSync(CREDENTIALS_PATH, "utf8")
  );

  const token = JSON.parse(
    fs.readFileSync(TOKEN_PATH, "utf8")
  );

  const config = credentials.installed;

  const auth = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    config.redirect_uris[0]
  );

  auth.setCredentials(token);

  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  console.log("Searching for latest MAG8000 email...");

  const list = await gmail.users.messages.list({
    userId: "me",
    q: 'subject:"MAG8000:"',
    maxResults: 1,
  });

  const message = list.data.messages?.[0];

  if (!message?.id) {
    throw new Error("No MAG8000 messages found.");
  }

  const result = await gmail.users.messages.get({
    userId: "me",
    id: message.id,
    format: "full",
  });

  const payload = result.data.payload;

  const headers = payload?.headers ?? [];

  const getHeader = (name: string) =>
    headers.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? "";

  console.log("");
  console.log("====================================");
  console.log("MAG8000 MESSAGE");
  console.log("====================================");

  console.log(`Message ID: ${message.id}`);
  console.log(`Subject:    ${getHeader("Subject")}`);
  console.log(`From:       ${getHeader("From")}`);
  console.log(`Date:       ${getHeader("Date")}`);
  console.log(`MIME Type:  ${payload?.mimeType}`);

  console.log("");
  console.log("====================================");
  console.log("MIME STRUCTURE");
  console.log("====================================");

  function inspectPart(part: any, level = 0) {
    const indent = " ".repeat(level * 2);

    console.log(`${indent}Part ID: ${part.partId ?? "(root)"}`);
    console.log(`${indent}MIME: ${part.mimeType ?? ""}`);
    console.log(`${indent}Filename: ${part.filename || "(none)"}`);
    console.log(
      `${indent}Body size: ${part.body?.size ?? 0}`
    );
    console.log(
      `${indent}Has inline data: ${Boolean(part.body?.data)}`
    );
    console.log(
      `${indent}Attachment ID: ${
        part.body?.attachmentId ?? "(none)"
      }`
    );

    console.log("");

    if (part.parts) {
      for (const child of part.parts) {
        inspectPart(child, level + 1);
      }
    }
  }

  inspectPart(payload);

  console.log("====================================");
  console.log("GMAIL SNIPPET");
  console.log("====================================");

  console.log(result.data.snippet ?? "(empty)");

  console.log("");
  console.log("Inspection completed.");
}

main().catch((error) => {
  console.error("");
  console.error("MAG8000 inspection failed:");
  console.error(error);
  process.exit(1);
});