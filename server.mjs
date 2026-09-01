// Local web app for the Shorts Engine: form UI -> render -> gallery.
// Run: npm start   (opens http://localhost:4321)
import express from "express";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const PORT = 4321;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT, "web")));
app.use("/out", express.static(OUT));

// ---- curated voices ----
const VOICES = [
  { id: "en-US-AriaNeural", label: "Aria — US Female (warm)" },
  { id: "en-US-JennyNeural", label: "Jenny — US Female (friendly)" },
  { id: "en-IN-NeerjaNeural", label: "Neerja — Indian Female" },
  { id: "en-GB-SoniaNeural", label: "Sonia — British Female" },
  { id: "en-AU-NatashaNeural", label: "Natasha — Australian Female" },
  { id: "en-US-GuyNeural", label: "Guy — US Male" },
  { id: "en-US-ChristopherNeural", label: "Christopher — US Male (deep)" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat — Indian Male" },
  { id: "en-GB-RyanNeural", label: "Ryan — British Male (gravitas)" },
];

// aspect ratios + quality -> pixel dimensions (even numbers, short side = quality)
const ASPECTS = [
  { id: "9:16", label: "9:16 Vertical — Shorts / Reels / TikTok" },
  { id: "16:9", label: "16:9 Landscape — YouTube" },
  { id: "1:1", label: "1:1 Square — Instagram feed" },
  { id: "4:5", label: "4:5 Portrait — Instagram / Facebook" },
];
const QUALITIES = [
  { id: "720", label: "720p (fast)" },
  { id: "1080", label: "1080p (recommended)" },
  { id: "1440", label: "2K (slow, sharpest)" },
];
function dims(aspect, quality) {
  const [aw, ah] = String(aspect).split(":").map(Number);
  const short = Number(quality) || 1080;
  let w, h;
  if (aw <= ah) {
    w = short;
    h = Math.round((short * ah) / aw);
  } else {
    h = short;
    w = Math.round((short * aw) / ah);
  }
  const even = (n) => n + (n % 2); // h264 needs even dims
  return { width: even(w), height: even(h) };
}

// ---- single-render lock + job tracking ----
let busy = false;
const jobs = new Map();
let seq = 0;

app.get("/api/config", (_req, res) => res.json({ voices: VOICES, aspects: ASPECTS, qualities: QUALITIES }));

app.get("/api/videos", (_req, res) => {
  const list = readdirSync(OUT)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => {
      const s = statSync(join(OUT, f));
      return { file: f, size: s.size, mtime: s.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(list);
});

app.post("/api/render", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const scenes = Array.isArray(b.scenes) ? b.scenes.filter((s) => s.text && s.query) : [];
  if (!b.title || scenes.length < 2)
    return res.status(400).json({ error: "Need a title and at least 2 scenes (text + search term)." });

  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const config = {
    title: String(b.title).slice(0, 100),
    description: b.description || "",
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
    voice: b.voice || "en-US-AriaNeural",
    rate: b.rate || "0%",
    music: "",
    width,
    height,
    scenes: scenes.map((s) => ({ text: String(s.text), query: String(s.query) })),
  };
  writeFileSync(join(ROOT, "scenes.json"), JSON.stringify(config, null, 2));

  busy = true;
  const id = String(++seq);
  const job = { id, status: "running", log: [], file: null, title: config.title, w: width, h: height };
  jobs.set(id, job);

  const child = spawn(process.execPath, [join(ROOT, "scripts", "make.mjs")], { cwd: ROOT });
  const onData = (d) => {
    for (const line of d.toString().split("\n")) {
      if (line.trim()) job.log.push(line.trim());
    }
    if (job.log.length > 200) job.log = job.log.slice(-200);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    busy = false;
    if (code === 0) {
      const slug = config.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      job.file = `${slug}.mp4`;
      job.status = existsSync(join(OUT, job.file)) ? "done" : "error";
    } else {
      job.status = "error";
    }
  });

  res.json({ jobId: id, width, height });
});

app.get("/api/status/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "unknown job" });
  res.json({
    status: job.status,
    title: job.title,
    file: job.file,
    dims: `${job.w}x${job.h}`,
    log: job.log.slice(-24),
  });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🎬 Shorts Studio running at ${url}\n`);
  open(url).catch(() => {});
});
