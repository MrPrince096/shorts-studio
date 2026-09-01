// Local web app for the Shorts Engine: topic -> AI scripts -> render, or manual scenes.
// Run: npm start   (opens http://localhost:4321)
import express from "express";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
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
const GENRES = [
  "Motivation", "Discipline", "Stoicism & Philosophy", "Success & Money Mindset",
  "Deep Thoughts", "Health & Nutrition", "Foods for the Body", "Fitness & Muscle",
  "Psychology Facts", "Did You Know / Fun Facts", "Science", "Space & Universe",
  "History", "Nature & Wildlife", "Technology & AI", "Productivity",
  "Relationships & Love", "Self Improvement", "Mystery & Unsolved", "Travel & Places",
].map((g) => ({ id: g, label: g }));
const COUNTRIES = [
  "India", "United States", "Japan", "China", "United Kingdom", "France", "Germany",
  "Italy", "Spain", "Russia", "Canada", "Australia", "Brazil", "Mexico", "Argentina",
  "Egypt", "South Africa", "Nigeria", "Kenya", "Morocco", "Saudi Arabia", "UAE",
  "Turkey", "Greece", "Netherlands", "Sweden", "Norway", "Switzerland", "Portugal",
  "Ireland", "Poland", "Indonesia", "Thailand", "Vietnam", "Philippines", "Malaysia",
  "Singapore", "South Korea", "Nepal", "Sri Lanka", "Bangladesh", "Pakistan", "Iran",
  "Israel", "New Zealand", "Peru", "Colombia", "Chile", "Iceland",
].map((c) => ({ id: c, label: c }));

const LLM_PROVIDERS = [
  { id: "gemini", label: "Gemini (Google) — free" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "ollama", label: "Ollama (local / offline)" },
];
const VIDEO_SOURCES = [
  { id: "pexels", label: "Pexels stock footage — free, unlimited" },
  { id: "fal", label: "AI video via fal.ai — paid (Seedance / Veo / Kling)" },
];
const FAL_MODELS = [
  { id: "fal-ai/bytedance/seedance/v1/lite/text-to-video", label: "Seedance 1.0 Lite (cheapest)" },
  { id: "fal-ai/bytedance/seedance/v1/pro/text-to-video", label: "Seedance 1.0 Pro" },
  { id: "fal-ai/kling-video/v1.6/standard/text-to-video", label: "Kling 1.6" },
  { id: "fal-ai/veo3/fast", label: "Veo 3 Fast" },
  { id: "fal-ai/veo3", label: "Veo 3 (best, priciest)" },
];

// language -> label, caption font (Google Noto for the script), rtl, and voices
const LANGUAGES = [
  { id: "en", label: "English", voices: VOICES },
  { id: "hi", label: "Hindi", font: "Noto Sans Devanagari", voices: [
    { id: "hi-IN-SwaraNeural", label: "Swara — Female" }, { id: "hi-IN-MadhurNeural", label: "Madhur — Male" }] },
  { id: "te", label: "Telugu", font: "Noto Sans Telugu", voices: [
    { id: "te-IN-ShrutiNeural", label: "Shruti — Female" }, { id: "te-IN-MohanNeural", label: "Mohan — Male" }] },
  { id: "ta", label: "Tamil", font: "Noto Sans Tamil", voices: [
    { id: "ta-IN-PallaviNeural", label: "Pallavi — Female" }, { id: "ta-IN-ValluvarNeural", label: "Valluvar — Male" }] },
  { id: "kn", label: "Kannada", font: "Noto Sans Kannada", voices: [
    { id: "kn-IN-SapnaNeural", label: "Sapna — Female" }, { id: "kn-IN-GaganNeural", label: "Gagan — Male" }] },
  { id: "ml", label: "Malayalam", font: "Noto Sans Malayalam", voices: [
    { id: "ml-IN-SobhanaNeural", label: "Sobhana — Female" }, { id: "ml-IN-MidhunNeural", label: "Midhun — Male" }] },
  { id: "mr", label: "Marathi", font: "Noto Sans Devanagari", voices: [
    { id: "mr-IN-AarohiNeural", label: "Aarohi — Female" }, { id: "mr-IN-ManoharNeural", label: "Manohar — Male" }] },
  { id: "bn", label: "Bengali", font: "Noto Sans Bengali", voices: [
    { id: "bn-IN-TanishaaNeural", label: "Tanishaa — Female" }, { id: "bn-IN-BashkarNeural", label: "Bashkar — Male" }] },
  { id: "gu", label: "Gujarati", font: "Noto Sans Gujarati", voices: [
    { id: "gu-IN-DhwaniNeural", label: "Dhwani — Female" }, { id: "gu-IN-NiranjanNeural", label: "Niranjan — Male" }] },
  { id: "ur", label: "Urdu", font: "Noto Sans Arabic", rtl: true, voices: [
    { id: "ur-PK-UzmaNeural", label: "Uzma — Female" }, { id: "ur-PK-AsadNeural", label: "Asad — Male" }] },
  { id: "ar", label: "Arabic", font: "Noto Sans Arabic", rtl: true, voices: [
    { id: "ar-EG-SalmaNeural", label: "Salma — Female" }, { id: "ar-SA-HamedNeural", label: "Hamed — Male" }] },
  { id: "es", label: "Spanish", voices: [
    { id: "es-ES-ElviraNeural", label: "Elvira — Female" }, { id: "es-MX-JorgeNeural", label: "Jorge — Male" }] },
  { id: "fr", label: "French", voices: [
    { id: "fr-FR-DeniseNeural", label: "Denise — Female" }, { id: "fr-FR-HenriNeural", label: "Henri — Male" }] },
  { id: "de", label: "German", voices: [
    { id: "de-DE-KatjaNeural", label: "Katja — Female" }, { id: "de-DE-ConradNeural", label: "Conrad — Male" }] },
  { id: "pt", label: "Portuguese", voices: [
    { id: "pt-BR-FranciscaNeural", label: "Francisca — Female" }, { id: "pt-BR-AntonioNeural", label: "Antonio — Male" }] },
  { id: "ru", label: "Russian", font: "Noto Sans", voices: [
    { id: "ru-RU-SvetlanaNeural", label: "Svetlana — Female" }, { id: "ru-RU-DmitryNeural", label: "Dmitry — Male" }] },
  { id: "ja", label: "Japanese", font: "Noto Sans JP", voices: [
    { id: "ja-JP-NanamiNeural", label: "Nanami — Female" }, { id: "ja-JP-KeitaNeural", label: "Keita — Male" }] },
  { id: "ko", label: "Korean", font: "Noto Sans KR", voices: [
    { id: "ko-KR-SunHiNeural", label: "SunHi — Female" }, { id: "ko-KR-InJoonNeural", label: "InJoon — Male" }] },
  { id: "zh", label: "Chinese", font: "Noto Sans SC", voices: [
    { id: "zh-CN-XiaoxiaoNeural", label: "Xiaoxiao — Female" }, { id: "zh-CN-YunxiNeural", label: "Yunxi — Male" }] },
  { id: "id", label: "Indonesian", voices: [
    { id: "id-ID-GadisNeural", label: "Gadis — Female" }, { id: "id-ID-ArdiNeural", label: "Ardi — Male" }] },
];
function resolveLang(id) {
  const L = LANGUAGES.find((x) => x.id === id) || LANGUAGES[0];
  const font = L.font || "Arial Black";
  const fontCss = L.font ? `https://fonts.googleapis.com/css2?family=${L.font.replace(/ /g, "+")}:wght@700&display=swap` : "";
  return { label: L.label, font, fontCss, rtl: !!L.rtl };
}

// ---- .env helpers for the Settings panel ----
const ENV_PATH = join(ROOT, ".env");
function readEnvRaw() {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
}
function getEnvValue(key) {
  for (const line of readEnvRaw().split("\n")) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`));
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  return "";
}
function setEnvValue(key, value) {
  const lines = readEnvRaw().split("\n");
  let found = false;
  const out = lines.map((l) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(l)) { found = true; return `${key}=${value}`; }
    return l;
  });
  if (!found) out.push(`${key}=${value}`);
  writeFileSync(ENV_PATH, out.filter((l, i) => !(l === "" && i === out.length - 1)).join("\n") + "\n");
  process.env[key] = value; // live for this process
}
function maskKey(v) {
  if (!v) return "";
  return v.length <= 4 ? "••••" : "••••••" + v.slice(-4);
}

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
        // read the actual output filename from make.mjs's "Saved:" line (robust for any language)
        const m = job.log.join("\n").match(/Saved:\s*.*\/out\/([^\s]+\.mp4)/);
        const f = m ? m[1] : `${slugify(config.title)}.mp4`;
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
  res.json({
    voices: VOICES, aspects: ASPECTS, qualities: QUALITIES, durations: DURATIONS,
    genres: GENRES, countries: COUNTRIES, llmProviders: LLM_PROVIDERS,
    videoSources: VIDEO_SOURCES, falModels: FAL_MODELS,
    languages: LANGUAGES.map((l) => ({ id: l.id, label: l.label, voices: l.voices })),
  })
);

// ---- Settings: providers + API keys ----
const km = (k) => ({ set: !!getEnvValue(k), masked: maskKey(getEnvValue(k)) });
app.get("/api/settings", (_req, res) => {
  res.json({
    llmProvider: getEnvValue("LLM_PROVIDER") || "gemini",
    openaiModel: getEnvValue("OPENAI_MODEL") || "gpt-4o-mini",
    ollamaUrl: getEnvValue("OLLAMA_URL") || "http://localhost:11434",
    ollamaModel: getEnvValue("OLLAMA_MODEL") || "llama3.1",
    keys: { pexels: km("PEXELS_API_KEY"), gemini: km("GEMINI_API_KEY"), openai: km("OPENAI_API_KEY"), fal: km("FAL_KEY") },
  });
});
app.post("/api/settings", (req, res) => {
  const b = req.body || {};
  const saved = [];
  const setIf = (field, envKey, label) => {
    if (typeof b[field] === "string" && b[field].trim()) { setEnvValue(envKey, b[field].trim()); saved.push(label); }
  };
  if (b.llmProvider) { setEnvValue("LLM_PROVIDER", String(b.llmProvider)); saved.push("LLM provider"); }
  setIf("pexels", "PEXELS_API_KEY", "Pexels key");
  setIf("gemini", "GEMINI_API_KEY", "Gemini key");
  setIf("openai", "OPENAI_API_KEY", "OpenAI key");
  setIf("openaiModel", "OPENAI_MODEL", "OpenAI model");
  setIf("ollamaUrl", "OLLAMA_URL", "Ollama URL");
  setIf("ollamaModel", "OLLAMA_MODEL", "Ollama model");
  setIf("fal", "FAL_KEY", "fal.ai key");
  res.json({ ok: true, saved });
});

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
  const topic = String(b.topic || "").trim();
  const genre = String(b.genre || "").trim();
  const country = String(b.country || "").trim();
  const random = !!b.random;
  if (!topic && !genre && !country && !random)
    return res.status(400).json({ error: "Pick a topic, a genre, a country, or turn on Random." });
  const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 10);
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const lang = resolveLang(b.language || "en");

  busy = true;
  const job = newJob(count);
  res.json({ jobId: job.id, count, dims: `${width}x${height}` });

  (async () => {
    try {
      const what = random ? "random topics" : (topic || [genre, country].filter(Boolean).join(" / ") || "your idea");
      pushLog(job, `🤖 Writing ${count} script(s) in ${lang.label} — ${what} …`);
      const configs = await generateScripts({
        topic, genre, country, random,
        count,
        duration: b.duration || "medium",
        voice: b.voice || "en-US-AriaNeural",
        rate: b.rate || "0%",
        width, height,
        source: b.source || "pexels",
        videoModel: b.videoModel || "",
        language: lang.label, font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
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
  const lang = resolveLang(b.language || "en");
  const config = {
    title: String(b.title).slice(0, 100),
    description: b.description || "",
    tags: Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
    voice: b.voice || "en-US-AriaNeural",
    rate: b.rate || "0%",
    music: "", width, height,
    source: b.source || "pexels",
    videoModel: b.videoModel || "",
    font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
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
