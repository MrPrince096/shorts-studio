// One-time YouTube OAuth: opens browser, saves token.json for the uploader.
// Prereq: client_secret.json in project root (from Google Cloud Console, "Desktop app" OAuth client)
import { authenticate } from "@google-cloud/local-auth";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT_SECRET = join(ROOT, "client_secret.json");
const TOKEN_PATH = join(ROOT, "token.json");

if (!existsSync(CLIENT_SECRET)) {
  console.error("❌ Missing client_secret.json in project root.");
  console.error("   Download it from Google Cloud Console → Credentials → your OAuth client (Desktop app).");
  process.exit(1);
}

console.log("🔐 Opening browser for Google sign-in...");
const client = await authenticate({
  scopes: ["https://www.googleapis.com/auth/youtube.upload"],
  keyfilePath: CLIENT_SECRET,
});

const keys = JSON.parse(readFileSync(CLIENT_SECRET, "utf8"));
const key = keys.installed || keys.web;
writeFileSync(
  TOKEN_PATH,
  JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  })
);
console.log("✅ Saved token.json — YouTube uploads are now authorized.");
