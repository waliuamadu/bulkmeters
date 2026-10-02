import fs from "fs";
import path from "path";
import { google } from "googleapis";

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

function decodeBase64Url(data: string): Buffer {
  const normalized = data
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return Buffer.from(normalized, "base64");
}

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
    q: 'subject:"MAG8000:" has:attachment',
    maxResults: 1,
  });

  const message = list.data.messages?.[0];

  if (!message?.id) {
    throw new Error("No MAG8000 message with attachment found.");
  }

  const result = await gmail.users.messages.get({
    userId: "me",
    id: message.id,
    format: "full",
  });

  const payload = result.data.payload;

  if (!payload) {
    throw new Error("Message has no payload.");
  }

  const headers = payload.headers ?? [];

  const getHeader = (name: string) =>
    headers.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? "";

  const subject = getHeader("Subject");

  const meterMatch = subject.match(
    /^MAG8000:\s*([A-Za-z0-9_-]+)\s*$/i
  );

  const meterId = meterMatch?.[1] ?? "UNKNOWN";

  const attachmentPart = payload.parts?.find(
    (part) =>
      part.filename?.toLowerCase().endsWith(".csv") &&
      part.body?.attachmentId
  );

  if (!attachmentPart?.body?.attachmentId) {
    throw new Error("CSV attachment not found.");
  }

  const attachmentId = attachmentPart.body.attachmentId;

  console.log("");
  console.log("====================================");
  console.log("MAG8000 CSV ATTACHMENT");
  console.log("====================================");
  console.log(`Meter ID: ${meterId}`);
  console.log(`Subject:  ${subject}`);
  console.log(`Filename: ${attachmentPart.filename}`);
  console.log("");

  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: message.id,
    id: attachmentId,
  });

  if (!attachment.data.data) {
    throw new Error("Attachment contained no data.");
  }

  const csvBuffer = decodeBase64Url(
    attachment.data.data
  );

  const csvText = csvBuffer.toString("utf8");

  console.log("============== CSV =================");
  console.log(csvText);
  console.log("====================================");
  console.log("");
  console.log(`CSV size: ${csvBuffer.length} bytes`);
  console.log("Inspection completed.");
}

main().catch((error) => {
  console.error("");
  console.error("MAG8000 CSV inspection failed:");
  console.error(error);
  process.exit(1);
});