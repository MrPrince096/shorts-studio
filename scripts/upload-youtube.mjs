// Upload the last rendered Short to YouTube using out/last-render.json metadata.
// Prereq: token.json (run scripts/auth-youtube.mjs once first)
// Usage: node scripts/upload-youtube.mjs [--public]
import { google } from "googleapis";
import { readFileSync, createReadStream, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_PATH = join(ROOT, "token.json");
const RESULT_PATH = join(ROOT, "out", "last-render.json");

if (!existsSync(TOKEN_PATH)) {
  console.error("❌ No token.json — run: node scripts/auth-youtube.mjs");
  process.exit(1);
}
if (!existsSync(RESULT_PATH)) {
  console.error("❌ No out/last-render.json — run the autopilot first.");
  process.exit(1);
}

const meta = JSON.parse(readFileSync(RESULT_PATH, "utf8"));
if (meta.uploaded) {
  console.log(`SKIP: "${meta.title}" already uploaded (${meta.videoUrl})`);
  process.exit(0);
}
if (!existsSync(meta.file)) {
  console.error(`❌ Video file missing: ${meta.file}`);
  process.exit(1);
}

const privacy = process.argv.includes("--public") ? "public" : "private";

const auth = google.auth.fromJSON(JSON.parse(readFileSync(TOKEN_PATH, "utf8")));
const youtube = google.youtube({ version: "v3", auth });

console.log(`⬆️  Uploading "${meta.title}" (${privacy})...`);
const res = await youtube.videos.insert({
  part: ["snippet", "status"],
  requestBody: {
    snippet: {
      title: `${meta.title} #shorts`,
      description: meta.description || "",
      tags: meta.tags || [],
      categoryId: "22",
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
  },
  media: { body: createReadStream(meta.file) },
});

const videoId = res.data.id;
const url = `https://youtube.com/shorts/${videoId}`;
meta.uploaded = true;
meta.videoId = videoId;
meta.videoUrl = url;
meta.privacy = privacy;
writeFileSync(RESULT_PATH, JSON.stringify(meta, null, 2));
console.log(`✅ Uploaded: ${url} (${privacy})`);
