// Autopilot runner: pull the oldest script from queue/, render it, archive it.
// Called by n8n daily (or run manually: node scripts/autopilot.mjs)
// Exit codes: 0 = rendered, 2 = queue empty, 1 = error
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const QUEUE = join(ROOT, "queue");
const DONE = join(ROOT, "queue", "done");

for (const d of [QUEUE, DONE]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

// oldest pending .json in queue/
const pending = readdirSync(QUEUE)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (!pending.length) {
  console.log("QUEUE_EMPTY: no scripts left in queue/. Add more!");
  process.exit(2);
}

const next = pending[0];
console.log(`🎬 Autopilot: rendering "${next}" (${pending.length - 1} left in queue after this)`);

// stage it as the active script
copyFileSync(join(QUEUE, next), join(ROOT, "scenes.json"));

// build + render (make.mjs saves to out/<title-slug>.mp4)
execFileSync("node", [join(__dirname, "make.mjs")], { stdio: "inherit", cwd: ROOT });

// read title for reporting, then archive the queue file
const cfg = JSON.parse(readFileSync(join(ROOT, "scenes.json"), "utf8"));
const slug = (cfg.title || "short")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);
renameSync(join(QUEUE, next), join(DONE, next));

// machine-readable result line for n8n to parse
const result = {
  status: "rendered",
  title: cfg.title,
  file: join(ROOT, "out", `${slug}.mp4`),
  description: cfg.description || "",
  tags: cfg.tags || [],
  remaining: pending.length - 1,
};
writeFileSync(join(ROOT, "out", "last-render.json"), JSON.stringify(result, null, 2));
console.log("RESULT:" + JSON.stringify(result));
