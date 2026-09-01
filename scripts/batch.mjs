// Render every script in batch/*.json sequentially to out/<title-slug>.mp4
import { execFileSync } from "node:child_process";
import { readdirSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BATCH = join(ROOT, "batch");
if (!existsSync(BATCH)) mkdirSync(BATCH, { recursive: true });

const slug = (s) =>
  (s || "short").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const outExists = (f) => {
  try {
    const t = JSON.parse(readFileSync(join(BATCH, f), "utf8")).title;
    return existsSync(join(ROOT, "out", `${slug(t)}.mp4`));
  } catch {
    return false;
  }
};

const force = process.argv.includes("--force");
const files = readdirSync(BATCH)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => force || !outExists(f)) // skip already-rendered unless --force
  .sort();
if (!files.length) {
  console.log("No .json files in batch/ — nothing to render.");
  process.exit(0);
}
console.log(`🎬 Batch: ${files.length} videos to render\n`);

const done = [], failed = [];
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  console.log(`\n===== [${i + 1}/${files.length}] ${f} =====`);
  copyFileSync(join(BATCH, f), join(ROOT, "scenes.json"));
  try {
    execFileSync("node", [join(__dirname, "make.mjs")], { stdio: "inherit", cwd: ROOT });
    done.push(f);
  } catch {
    console.error(`❌ FAILED: ${f}`);
    failed.push(f);
  }
}
console.log(`\n\n===== BATCH DONE: ${done.length} ok, ${failed.length} failed =====`);
if (failed.length) console.log("Failed:", failed.join(", "));
