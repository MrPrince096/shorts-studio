// Local web app for the Shorts Engine: topic -> AI scripts -> render, or manual scenes.
// Run: npm start   (opens http://localhost:4321)
import express from "express";
import { spawn } from "node:child_process";
import { writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";
import { generateScripts } from "./scripts/generate.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const PORT = 4321;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(ROOT, "web")));
app.use("/out", express.static(OUT));

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
const DURATIONS = [
  { id: "short", label: "Short — ~20s (5 scenes)" },
  { id: "medium", label: "Medium — ~35s (7 scenes)" },
  { id: "long", label: "Long — ~50s (9 scenes)" },
];

function dims(aspect, quality) {
  const [aw, ah] = String(aspect).split(":").map(Number);
  const short = Number(quality) || 1080;
  let w, h;
  if (aw <= ah) { w = short; h = Math.round((short * ah) / aw); }
  else { h = short; w = Math.round((short * aw) / ah); }
  const even = (n) => n + (n % 2);
  return { width: even(w), height: even(h) };
}

// ---- job model (supports multi-video) ----
let busy = false;
const jobs = new Map();
let seq = 0;
function newJob(total) {
  const id = String(++seq);
  const job = { id, status: "running", log: [], files: [], total, current: 0, title: "" };
  jobs.set(id, job);
  return job;
}
function pushLog(job, s) {
  for (const line of String(s).split("\n")) if (line.trim()) job.log.push(line.trim());
  if (job.log.length > 400) job.log = job.log.slice(-400);
}
function slugify(t) {
  return (t || "short").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function renderOne(config, job) {
  return new Promise((resolve) => {
    writeFileSync(join(ROOT, "scenes.json"), JSON.stringify(config, null, 2));
    job.title = config.title;
    const child = spawn(process.execPath, [join(ROOT, "scripts", "make.mjs")], { cwd: ROOT });
    const onData = (d) => pushLog(job, d.toString());
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      if (code === 0) {
        const f = `${slugify(config.title)}.mp4`;
        if (existsSync(join(OUT, f))) job.files.push(f);
      }
      resolve(code);
    });
  });
}
async function runAll(configs, job) {
  for (let i = 0; i < configs.length; i++) {
    job.current = i + 1;
    pushLog(job, `\n===== Video ${i + 1}/${configs.length}: ${configs[i].title} =====`);
    await renderOne(configs[i], job);
  }
  job.status = job.files.length ? "done" : "error";
  busy = false;
}

app.get("/api/config", (_req, res) =>
  res.json({ voices: VOICES, aspects: ASPECTS, qualities: QUALITIES, durations: DURATIONS })
);

app.get("/api/videos", (_req, res) => {
  const list = readdirSync(OUT)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => { const s = statSync(join(OUT, f)); return { file: f, size: s.size, mtime: s.mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(list);
});

// ---- AI: topic -> scripts -> render N videos ----
app.post("/api/generate", async (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  if (!b.topic || !String(b.topic).trim()) return res.status(400).json({ error: "Enter a topic." });
  const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 10);
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");

  busy = true;
  const job = newJob(count);
  res.json({ jobId: job.id, count, dims: `${width}x${height}` });

  (async () => {
    try {
      pushLog(job, `🤖 Writing ${count} script(s) about "${b.topic}" with AI…`);
      const configs = await generateScripts({
        topic: String(b.topic).trim(),
        count,
        duration: b.duration || "medium",
        voice: b.voice || "en-US-AriaNeural",
        rate: b.rate || "0%",
        width, height,
      });
      job.total = configs.length;
      pushLog(job, `✅ ${configs.length} script(s) ready. Rendering…`);
      await runAll(configs, job);
    } catch (e) {
      if (e.message === "NO_GEMINI_KEY") {
        pushLog(job, "❌ No AI key set. Add a FREE Gemini key as GEMINI_API_KEY in the .env file.");
        pushLog(job, "   Get one free at: https://aistudio.google.com/app/apikey");
      } else {
        pushLog(job, "❌ " + e.message);
      }
      job.status = "error";
      busy = false;
    }
  })();
});

// ---- manual: explicit scenes -> render one ----
app.post("/api/render", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const scenes = Array.isArray(b.scenes) ? b.scenes.filter((s) => s.text && s.query) : [];
  if (!b.title || scenes.length < 2)
    return res.status(400).json({ error: "Need a title and at least 2 scenes." });
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const config = {
    title: String(b.title).slice(0, 100),
    description: b.description || "",
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
    voice: b.voice || "en-US-AriaNeural",
    rate: b.rate || "0%",
    music: "", width, height,
    scenes: scenes.map((s) => ({ text: String(s.text), query: String(s.query) })),
  };
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id, dims: `${width}x${height}` });
  runAll([config], job);
});

app.get("/api/status/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "unknown job" });
  res.json({
    status: job.status, title: job.title, total: job.total, current: job.current,
    files: job.files, log: job.log.slice(-26),
  });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🎬 Shorts Studio running at ${url}\n`);
  open(url).catch(() => {});
});
