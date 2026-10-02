import fs from "fs";
import path from "path";
import { google } from "googleapis";

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");
const TOKEN_PATH = path.join(process.cwd(), "token.json");

async function main() {
  console.log("Connecting to Gmail...");

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("credentials.json not found.");
  }

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("token.json not found.");
  }

  const credentials = JSON.parse(
    fs.readFileSync(CREDENTIALS_PATH, "utf8")
  );

  const token = JSON.parse(
    fs.readFileSync(TOKEN_PATH, "utf8")
  );

  const config = credentials.installed;

  const oauth2Client = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    config.redirect_uris[0]
  );

  oauth2Client.setCredentials(token);

  const gmail = google.gmail({
    version: "v1",
    auth: oauth2Client,
  });

  // Confirm which Gmail account we are connected to
  const profile = await gmail.users.getProfile({
    userId: "me",
  });

  console.log("");
  console.log("====================================");
  console.log("GMAIL CONNECTION SUCCESSFUL");
  console.log("====================================");
  console.log(`Account: ${profile.data.emailAddress}`);
  console.log(`Total messages: ${profile.data.messagesTotal}`);
  console.log("");

  // Get latest 10 messages
  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: 10,
  });

  const messages = list.data.messages ?? [];

  console.log(`Latest messages found: ${messages.length}`);
  console.log("");

  for (const message of messages) {
    if (!message.id) continue;

    const result = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: [
        "From",
        "To",
        "Subject",
        "Date",
      ],
    });

    const headers = result.data.payload?.headers ?? [];

    const getHeader = (name: string) =>
      headers.find(
        (header) =>
          header.name?.toLowerCase() === name.toLowerCase()
      )?.value ?? "";

    console.log("------------------------------------");
    console.log(`Message ID: ${message.id}`);
    console.log(`Date:       ${getHeader("Date")}`);
    console.log(`From:       ${getHeader("From")}`);
    console.log(`Subject:    ${getHeader("Subject")}`);
  }

  console.log("");
  console.log("Gmail test completed successfully.");
}

main().catch((error) => {
  console.error("");
  console.error("GMAIL TEST FAILED");
  console.error(error);
  process.exit(1);
});