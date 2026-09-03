// Local web app for the Shorts Engine: topic -> AI scripts -> render, or manual scenes.
// Run: npm start   (opens http://localhost:4321)
import express from "express";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";
import { generateScripts, generateIdeas, generateAdIdeas } from "./scripts/generate.mjs";
import { createOutline, episodeConfig } from "./scripts/series.mjs";
import { visionScript, describeImage } from "./scripts/vision.mjs";

// re-encode any image (HEIC, tiff, cmyk jpg, etc.) into a Chromium-decodable JPEG.
function toJpeg(srcPath, dstPath) {
  try { execFileSync("sips", ["-s", "format", "jpeg", srcPath, "--out", dstPath], { stdio: "ignore" }); if (existsSync(dstPath)) return true; } catch {}
  try { execFileSync("ffmpeg", ["-y", "-i", srcPath, "-frames:v", "1", dstPath], { stdio: "ignore" }); if (existsSync(dstPath)) return true; } catch {}
  return false;
}

// decode a base64 data URL, save under public/, return { uploadPath, uploadIsImage, analyzeB64, analyzeMime }
function saveUploadFromDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const isVideo = mime.startsWith("video");
  const buf = Buffer.from(m[2], "base64");
  const pub = join(dirname(fileURLToPath(import.meta.url)), "public");
  if (isVideo) {
    const uploadPath = join(pub, "upload.mp4");
    writeFileSync(uploadPath, buf);
    const fr = join(pub, "upload_frame.jpg");
    execFileSync("ffmpeg", ["-y", "-ss", "0.5", "-i", uploadPath, "-frames:v", "1", "-q:v", "2", fr], { stdio: "ignore" });
    return { uploadPath, uploadIsImage: false, analyzeB64: readFileSync(fr).toString("base64"), analyzeMime: "image/jpeg" };
  }
  // image: write the raw upload, then ALWAYS normalize to a real JPEG so the
  // renderer (and vision) can decode it — phones often send HEIC as .jpg.
  const rawExt = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
  const rawPath = join(pub, "upload_raw." + rawExt);
  writeFileSync(rawPath, buf);
  const jpgPath = join(pub, "upload.jpg");
  let ok = toJpeg(rawPath, jpgPath);
  if (!ok) { try { copyFileSync(rawPath, jpgPath); ok = true; } catch {} } // last resort: hope it was already jpeg
  const finalPath = existsSync(jpgPath) ? jpgPath : rawPath;
  return { uploadPath: finalPath, uploadIsImage: true, analyzeB64: readFileSync(finalPath).toString("base64"), analyzeMime: "image/jpeg" };
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "out");
const PUBLIC = join(ROOT, "public");
function watermarkFile() {
  if (!existsSync(PUBLIC)) return "";
  return readdirSync(PUBLIC).find((f) => /^watermark\./i.test(f)) || "";
}
const PORT = 4321;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "80mb" })); // large limit for base64 media uploads
app.use(express.static(join(ROOT, "web")));
app.use("/out", express.static(OUT));
const DRAFTS_DIR = join(ROOT, "drafts");
const ASSETS_DIR = join(ROOT, "assets");
app.use("/assets", express.static(ASSETS_DIR));

// ---- Drafts (save/load create-form setups) ----
app.post("/api/drafts", (req, res) => {
  const b = req.body || {};
  if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
  const id = (b.id && String(b.id).replace(/[^a-z0-9]/gi, "")) || "d" + Date.now().toString(36);
  writeFileSync(join(DRAFTS_DIR, id + ".json"), JSON.stringify({ id, name: String(b.name || "Untitled").slice(0, 80), data: b.data || {}, mtime: Date.now() }));
  res.json({ ok: true, id });
});
app.get("/api/drafts", (_req, res) => {
  const list = existsSync(DRAFTS_DIR)
    ? readdirSync(DRAFTS_DIR).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(DRAFTS_DIR, f), "utf8")); } catch { return null; } }).filter(Boolean).sort((a, b) => b.mtime - a.mtime)
    : [];
  res.json(list);
});
app.delete("/api/drafts/:id", (req, res) => {
  const p = join(DRAFTS_DIR, req.params.id.replace(/[^a-z0-9]/gi, "") + ".json");
  if (existsSync(p)) unlinkSync(p);
  res.json({ ok: true });
});

// ---- Assets (image library) ----
app.post("/api/assets", (req, res) => {
  const m = String((req.body || {}).dataUrl || "").match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Attach an image." });
  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true });
  const ext = (m[1].split("/")[1] || "jpg").replace("jpeg", "jpg");
  const file = "a" + Date.now().toString(36) + "." + ext;
  writeFileSync(join(ASSETS_DIR, file), Buffer.from(m[2], "base64"));
  res.json({ ok: true, file });
});
app.get("/api/assets", (_req, res) => {
  const list = existsSync(ASSETS_DIR)
    ? readdirSync(ASSETS_DIR).filter((f) => /\.(jpg|png|webp|gif)$/i.test(f)).map((f) => { const s = statSync(join(ASSETS_DIR, f)); return { file: f, size: s.size, mtime: s.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime)
    : [];
  res.json(list);
});
app.delete("/api/assets/:file", (req, res) => {
  const f = req.params.file.replace(/[^a-z0-9.]/gi, "");
  const p = join(ASSETS_DIR, f);
  if (existsSync(p) && p.startsWith(ASSETS_DIR)) unlinkSync(p);
  res.json({ ok: true });
});

// ---- Watermark logo (saved to public/watermark.<ext>, used by renders) ----
app.post("/api/watermark", (req, res) => {
  const m = String((req.body || {}).dataUrl || "").match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Attach an image." });
  const old = watermarkFile(); if (old) unlinkSync(join(PUBLIC, old));
  const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
  writeFileSync(join(PUBLIC, "watermark." + ext), Buffer.from(m[2], "base64"));
  res.json({ ok: true, file: "watermark." + ext });
});
app.delete("/api/watermark", (_req, res) => {
  const old = watermarkFile(); if (old) unlinkSync(join(PUBLIC, old));
  res.json({ ok: true });
});

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
  { id: "xlong", label: "Extra long — ~80s (14 scenes)" },
  { id: "xxlong", label: "Very long — ~2 min (20 scenes)" },
  { id: "huge", label: "Max — ~3 min (30 scenes)" },
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
  { id: "image", label: "AI images: Pollinations — free, no key" },
  { id: "hf", label: "AI images: Hugging Face FLUX — free credits, then paid" },
  { id: "local", label: "AI images: Local server — free & unlimited (you run it)" },
  { id: "fal-image", label: "AI images: fal.ai FLUX — paid, best quality" },
  { id: "fal", label: "AI video: fal.ai — paid (Seedance / Veo / Kling)" },
];
const FAL_MODELS = [
  { id: "fal-ai/bytedance/seedance/v1/lite/text-to-video", label: "Seedance 1.0 Lite (cheapest)" },
  { id: "fal-ai/bytedance/seedance/v1/pro/text-to-video", label: "Seedance 1.0 Pro" },
  { id: "fal-ai/kling-video/v1.6/standard/text-to-video", label: "Kling 1.6" },
  { id: "fal-ai/veo3/fast", label: "Veo 3 Fast" },
  { id: "fal-ai/veo3", label: "Veo 3 (best, priciest)" },
];

// art styles for AI images / video (the id IS the style phrase appended to the prompt)
const IMAGE_STYLES = [
  { id: "cinematic film still, dramatic lighting, highly detailed, 8k", label: "Cinematic (default)" },
  { id: "traditional Indian mythological painting, Raja Ravi Varma style, ornate, divine, highly detailed", label: "Indian mythological art" },
  { id: "photorealistic, natural lighting, ultra detailed, sharp focus", label: "Realistic photo" },
  { id: "epic fantasy digital painting, dramatic, artstation, highly detailed", label: "Epic fantasy" },
  { id: "classical oil painting, rich colors, textured brushstrokes", label: "Oil painting" },
  { id: "vibrant anime style, detailed, studio quality", label: "Anime" },
  { id: "3D render, Pixar animation style, soft lighting", label: "3D animation" },
  { id: "bold comic book art, ink outlines, dynamic, vivid", label: "Comic book" },
  { id: "soft vintage watercolor painting, artistic", label: "Watercolor" },
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
  { id: "ne", label: "Nepali", font: "Noto Sans Devanagari", voices: [
    { id: "ne-NP-HemkalaNeural", label: "Hemkala — Female" }, { id: "ne-NP-SagarNeural", label: "Sagar — Male" }] },
  { id: "si", label: "Sinhala", font: "Noto Sans Sinhala", voices: [
    { id: "si-LK-ThiliniNeural", label: "Thilini — Female" }, { id: "si-LK-SameeraNeural", label: "Sameera — Male" }] },
  { id: "fa", label: "Persian", font: "Noto Sans Arabic", rtl: true, voices: [
    { id: "fa-IR-DilaraNeural", label: "Dilara — Female" }, { id: "fa-IR-FaridNeural", label: "Farid — Male" }] },
  { id: "he", label: "Hebrew", font: "Noto Sans Hebrew", rtl: true, voices: [
    { id: "he-IL-HilaNeural", label: "Hila — Female" }, { id: "he-IL-AvriNeural", label: "Avri — Male" }] },
  { id: "th", label: "Thai", font: "Noto Sans Thai", voices: [
    { id: "th-TH-PremwadeeNeural", label: "Premwadee — Female" }, { id: "th-TH-NiwatNeural", label: "Niwat — Male" }] },
  { id: "vi", label: "Vietnamese", font: "Noto Sans", voices: [
    { id: "vi-VN-HoaiMyNeural", label: "Hoai My — Female" }, { id: "vi-VN-NamMinhNeural", label: "Nam Minh — Male" }] },
  { id: "tr", label: "Turkish", font: "Noto Sans", voices: [
    { id: "tr-TR-EmelNeural", label: "Emel — Female" }, { id: "tr-TR-AhmetNeural", label: "Ahmet — Male" }] },
  { id: "it", label: "Italian", voices: [
    { id: "it-IT-ElsaNeural", label: "Elsa — Female" }, { id: "it-IT-DiegoNeural", label: "Diego — Male" }] },
  { id: "pl", label: "Polish", font: "Noto Sans", voices: [
    { id: "pl-PL-ZofiaNeural", label: "Zofia — Female" }, { id: "pl-PL-MarekNeural", label: "Marek — Male" }] },
  { id: "nl", label: "Dutch", voices: [
    { id: "nl-NL-ColetteNeural", label: "Colette — Female" }, { id: "nl-NL-MaartenNeural", label: "Maarten — Male" }] },
  { id: "uk", label: "Ukrainian", font: "Noto Sans", voices: [
    { id: "uk-UA-PolinaNeural", label: "Polina — Female" }, { id: "uk-UA-OstapNeural", label: "Ostap — Male" }] },
  { id: "el", label: "Greek", font: "Noto Sans", voices: [
    { id: "el-GR-AthinaNeural", label: "Athina — Female" }, { id: "el-GR-NestorasNeural", label: "Nestoras — Male" }] },
  { id: "fil", label: "Filipino", voices: [
    { id: "fil-PH-BlessicaNeural", label: "Blessica — Female" }, { id: "fil-PH-AngeloNeural", label: "Angelo — Male" }] },
  { id: "sw", label: "Swahili", voices: [
    { id: "sw-KE-ZuriNeural", label: "Zuri — Female" }, { id: "sw-KE-RafikiNeural", label: "Rafiki — Male" }] },
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
    let local = "";
    const child = spawn(process.execPath, [join(ROOT, "scripts", "make.mjs")], { cwd: ROOT });
    const onData = (d) => { const s = d.toString(); local += s; pushLog(job, s); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      if (code === 0) {
        // read THIS render's output filename from its own "Saved:" line
        const m = local.match(/Saved:\s*.*\/out\/([^\s]+\.mp4)/);
        const f = m ? m[1] : `${slugify(config.title)}.mp4`;
        if (existsSync(join(OUT, f)) && !job.files.includes(f)) job.files.push(f);
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

// ---- Storyteller series (persistent, resumable) ----
const SERIES_DIR = join(ROOT, "series");
const clamp = (n, lo, hi) => Math.min(Math.max(parseInt(n) || lo, lo), hi);
function saveSeries(s) {
  if (!existsSync(SERIES_DIR)) mkdirSync(SERIES_DIR, { recursive: true });
  writeFileSync(join(SERIES_DIR, s.id + ".json"), JSON.stringify(s, null, 2));
}
function loadSeries(id) {
  const p = join(SERIES_DIR, (id || "").replace(/[^a-z0-9]/gi, "") + ".json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
async function runSeries(series, batch, job) {
  const startDone = series.done;
  const end = Math.min(series.total, series.done + batch);
  job.total = end - startDone;
  for (let part = startDone + 1; part <= end; part++) {
    job.current = part - startDone;
    pushLog(job, `\n===== ${series.seriesTitle} — Part ${part}/${series.total} =====`);
    series.summary = series.recaps.slice(-12).join(" ");
    let ep;
    try { ep = await episodeConfig(series, part); }
    catch (e) { pushLog(job, "❌ script: " + e.message); break; }
    const code = await renderOne(ep.config, job);
    if (code !== 0) { pushLog(job, `❌ Part ${part} render failed — stopping.`); break; }
    series.done = part;
    const f = job.files[job.files.length - 1];
    if (f && !series.files.includes(f)) series.files.push(f);
    series.recaps.push(ep.recap);
    saveSeries(series);
  }
  job.status = job.files.length ? "done" : "error";
  busy = false;
}

app.get("/api/config", (_req, res) =>
  res.json({
    voices: VOICES, aspects: ASPECTS, qualities: QUALITIES, durations: DURATIONS,
    genres: GENRES, countries: COUNTRIES, llmProviders: LLM_PROVIDERS,
    videoSources: VIDEO_SOURCES, falModels: FAL_MODELS, imageStyles: IMAGE_STYLES,
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
    localImageUrl: getEnvValue("LOCAL_IMAGE_URL") || "http://localhost:7801/generate",
    localAvatarUrl: getEnvValue("LOCAL_AVATAR_URL") || "",
    piperModel: getEnvValue("PIPER_MODEL") || "",
    piperPython: getEnvValue("PIPER_PYTHON") || "",
    piperReady: !!(getEnvValue("PIPER_MODEL") && getEnvValue("PIPER_PYTHON")),
    avatarProvider: avatarProvider(),
    keys: { pexels: km("PEXELS_API_KEY"), gemini: km("GEMINI_API_KEY"), openai: km("OPENAI_API_KEY"), fal: km("FAL_KEY"), hf: km("HF_TOKEN"), did: km("DID_API_KEY"), heygen: km("HEYGEN_API_KEY") },
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
  setIf("hf", "HF_TOKEN", "Hugging Face token");
  setIf("did", "DID_API_KEY", "D-ID key");
  setIf("heygen", "HEYGEN_API_KEY", "HeyGen key");
  setIf("localImageUrl", "LOCAL_IMAGE_URL", "Local image URL");
  setIf("localAvatarUrl", "LOCAL_AVATAR_URL", "Local avatar URL");
  setIf("piperModel", "PIPER_MODEL", "Piper voice model");
  setIf("piperPython", "PIPER_PYTHON", "Piper Python");
  res.json({ ok: true, saved });
});

app.get("/api/videos", (_req, res) => {
  const list = readdirSync(OUT)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => {
      const s = statSync(join(OUT, f));
      let meta = {};
      const base = f.replace(/\.mp4$/, "");
      const metaPath = join(OUT, base + ".json");
      if (existsSync(metaPath)) { try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {} }
      // lazy thumbnail (first ~1s frame)
      const thumb = base + ".thumb.jpg";
      if (!existsSync(join(OUT, thumb))) {
        try { execFileSync("ffmpeg", ["-y", "-ss", "1", "-i", join(OUT, f), "-frames:v", "1", "-vf", "scale=320:-1", join(OUT, thumb)], { stdio: "ignore" }); } catch {}
      }
      return { file: f, size: s.size, mtime: s.mtimeMs, title: meta.title || "", description: meta.description || "", hashtags: meta.hashtags || "", thumb: existsSync(join(OUT, thumb)) ? thumb : "" };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(list);
});

// stats for the dashboard
app.get("/api/stats", (_req, res) => {
  const videosCreated = readdirSync(OUT).filter((f) => f.endsWith(".mp4")).length;
  let seriesParts = 0, seriesCount = 0;
  if (existsSync(SERIES_DIR)) {
    for (const f of readdirSync(SERIES_DIR).filter((f) => f.endsWith(".json"))) {
      try { const s = JSON.parse(readFileSync(join(SERIES_DIR, f), "utf8")); seriesParts += s.done || 0; seriesCount++; } catch {}
    }
  }
  let ideasGenerated = 0;
  const sp = join(OUT, ".stats.json");
  if (existsSync(sp)) { try { ideasGenerated = JSON.parse(readFileSync(sp, "utf8")).ideasGenerated || 0; } catch {} }
  res.json({ videosCreated, seriesParts, seriesCount, ideasGenerated });
});

// ---- AI: topic -> scripts -> render N videos ----
app.post("/api/generate", async (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const topic = String(b.topic || "").trim();
  const genre = String(b.genre || "").trim();
  const country = String(b.country || "").trim();
  const random = !!b.random;
  if (b.ad && !String(b.product || "").trim())
    return res.status(400).json({ error: "Enter the product / service to advertise." });
  if (!b.ad && !topic && !genre && !country && !random)
    return res.status(400).json({ error: "Pick a topic, a genre, a country, or turn on Random." });
  const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 10);
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const lang = resolveLang(b.language || "en");

  busy = true;
  const job = newJob(count);
  res.json({ jobId: job.id, count, dims: `${width}x${height}` });

  (async () => {
    try {
      // optional product image for ads: analyze it, and use it as the visual
      let productImageDesc = "", upload = null;
      if (b.ad && b.imageDataUrl) {
        upload = saveUploadFromDataUrl(b.imageDataUrl);
        if (upload) {
          pushLog(job, "🔍 Analyzing your product image…");
          try { productImageDesc = await describeImage({ imageB64: upload.analyzeB64, mime: upload.analyzeMime }); } catch (e) { pushLog(job, "(image analysis skipped: " + e.message + ")"); }
        }
      }
      const what = b.ad ? `ad for "${b.product}"` : (random ? "random topics" : (topic || [genre, country].filter(Boolean).join(" / ") || "your idea"));
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
        ad: !!b.ad, product: b.product || "", benefits: b.benefits || "", cta: b.cta || "", tone: b.tone || "", productImageDesc,
        instructions: b.instructions || "",
        llmProvider: b.llmProvider || "",
      });
      configs.forEach((c) => {
        c.imageStyle = b.imageStyle || "";
        c.watermark = b.watermark || "";
        c.captionPos = b.captionPos || "bottom";
        c.motion = b.motion || "in";
        c.watermarkImage = b.watermarkImage ? watermarkFile() : "";
        c.talkingAvatar = !!b.talkingAvatar; // bring the creator photo to life (needs an avatar API key)
        c.voiceEngine = b.voiceEngine || "edge"; // "edge" (cloud) or "piper" (offline)
        // keep the chosen source for hook/problem scenes; the product image is used only on product scenes
        if (upload) { c.uploadFile = upload.uploadPath; c.uploadIsImage = upload.uploadIsImage; }
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
    imageStyle: b.imageStyle || "",
    watermark: b.watermark || "",
    captionPos: b.captionPos || "bottom",
    motion: b.motion || "in",
    watermarkImage: b.watermarkImage ? watermarkFile() : "",
    voiceEngine: b.voiceEngine || "edge",
    font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
    scenes: scenes.map((s) => ({ text: String(s.text), query: String(s.query) })),
  };
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id, dims: `${width}x${height}` });
  runAll([config], job);
});

// ---- Ideas (VidIQ-style: niche -> viral ideas + titles + tags) ----
app.post("/api/ideas", async (req, res) => {
  const b = req.body || {};
  try {
    const ideas = await generateIdeas({
      niche: String(b.niche || "").trim(),
      count: Math.min(Math.max(parseInt(b.count) || 8, 1), 20),
      language: resolveLang(b.language || "en").label,
      genre: String(b.genre || "").trim(), country: String(b.country || "").trim(),
      llmProvider: b.llmProvider || "",
    });
    // bump the ideas counter for the dashboard stat
    try {
      const sp = join(OUT, ".stats.json");
      const cur = existsSync(sp) ? JSON.parse(readFileSync(sp, "utf8")) : {};
      cur.ideasGenerated = (cur.ideasGenerated || 0) + ideas.length;
      writeFileSync(sp, JSON.stringify(cur));
    } catch {}
    res.json({ ideas });
  } catch (e) {
    res.status(e.message === "NO_LLM_KEY" ? 400 : 500).json({
      error: e.message === "NO_LLM_KEY" ? "Add a Gemini key in Settings to generate ideas." : e.message,
    });
  }
});

// ---- UGC Ads: image -> product understanding -> 5 ad ideas ----
app.post("/api/ads/ideas", async (req, res) => {
  const b = req.body || {};
  try {
    let productDesc = "";
    if (b.imageDataUrl) {
      const upload = saveUploadFromDataUrl(b.imageDataUrl);
      if (upload) {
        try { productDesc = await describeImage({ imageB64: upload.analyzeB64, mime: upload.analyzeMime }); }
        catch (e) { /* vision optional — fall back to text context */ }
      }
    }
    if (!productDesc && !String(b.product || "").trim())
      return res.status(400).json({ error: "Upload a product image or type the product name." });
    const ideas = await generateAdIdeas({
      productDesc,
      product: String(b.product || "").trim(),
      audience: String(b.audience || "").trim(),
      sellingPoint: String(b.sellingPoint || "").trim(),
      offer: String(b.offer || "").trim(),
      count: Math.min(Math.max(parseInt(b.count) || 5, 3), 8),
      language: resolveLang(b.language || "en").label,
      llmProvider: b.llmProvider || "",
    });
    res.json({ productDesc, ideas });
  } catch (e) {
    res.status(String(e.message).startsWith("NO_LLM_KEY") ? 400 : 500).json({
      error: String(e.message).startsWith("NO_LLM_KEY") ? "Add a Gemini key in Settings to generate ad ideas." : e.message,
    });
  }
});

// ---- Personal AI Creators (Track B scaffold: store profiles; avatar animation needs a provider) ----
const CREATORS_DIR = join(ROOT, "creators");
app.use("/creators", express.static(CREATORS_DIR));
function avatarProvider() {
  // which talking-avatar backend is configured (reads the .env file, like the rest
  // of the server). Mirrors scripts/avatar.mjs — local (free/offline) is preferred.
  if (getEnvValue("LOCAL_AVATAR_URL")) return "local";
  if (getEnvValue("FAL_KEY")) return "fal";
  if (getEnvValue("DID_API_KEY")) return "did";
  if (getEnvValue("HEYGEN_API_KEY")) return "heygen";
  return "";
}
app.get("/api/creators", (_req, res) => {
  const list = existsSync(CREATORS_DIR)
    ? readdirSync(CREATORS_DIR).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(CREATORS_DIR, f), "utf8")); } catch { return null; } }).filter(Boolean).sort((a, b) => b.mtime - a.mtime)
    : [];
  res.json({ creators: list, avatarProvider: avatarProvider() });
});
app.post("/api/creators", (req, res) => {
  const b = req.body || {};
  const m = String(b.photo || "").match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Attach a clear front-facing photo." });
  if (!existsSync(CREATORS_DIR)) mkdirSync(CREATORS_DIR, { recursive: true });
  const id = "c" + Date.now().toString(36);
  const ext = (m[1].split("/")[1] || "jpg").replace("jpeg", "jpg");
  writeFileSync(join(CREATORS_DIR, id + "." + ext), Buffer.from(m[2], "base64"));
  const creator = {
    id, name: String(b.name || "My Creator").slice(0, 60), photo: id + "." + ext,
    voice: b.voice || "en-US-AriaNeural", language: b.language || "en",
    personality: String(b.personality || "").slice(0, 200), mtime: Date.now(),
  };
  writeFileSync(join(CREATORS_DIR, id + ".json"), JSON.stringify(creator));
  res.json({ ok: true, creator });
});
app.delete("/api/creators/:id", (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9]/gi, "");
  const meta = join(CREATORS_DIR, id + ".json");
  if (existsSync(meta)) { try { const c = JSON.parse(readFileSync(meta, "utf8")); if (c.photo) { const p = join(CREATORS_DIR, c.photo); if (existsSync(p)) unlinkSync(p); } } catch {} unlinkSync(meta); }
  res.json({ ok: true });
});

// ---- Series: start / continue / list ----
app.get("/api/series", (_req, res) => {
  const list = existsSync(SERIES_DIR)
    ? readdirSync(SERIES_DIR).filter((f) => f.endsWith(".json")).map((f) => {
        try { const s = JSON.parse(readFileSync(join(SERIES_DIR, f), "utf8"));
          return { id: s.id, title: s.seriesTitle, total: s.total, done: s.done, language: s.language }; }
        catch { return null; }
      }).filter(Boolean).sort((a, b) => (a.id < b.id ? 1 : -1))
    : [];
  res.json(list);
});

app.post("/api/series/start", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  if (!b.topic || !String(b.topic).trim()) return res.status(400).json({ error: "Enter a story topic." });
  const total = clamp(b.total, 2, 100);
  const batch = clamp(b.batch, 1, 20);
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const lang = resolveLang(b.language || "en");
  busy = true;
  const job = newJob(batch);
  res.json({ jobId: job.id });
  (async () => {
    try {
      pushLog(job, `📖 Planning "${b.topic}" as a ${total}-part series…`);
      const o = await createOutline({ topic: String(b.topic).trim(), total, genre: b.genre || "", country: b.country || "", llmProvider: b.llmProvider || "" });
      const series = {
        id: "s" + Date.now().toString(36),
        seriesTitle: o.seriesTitle, slug: o.slug, topic: String(b.topic).trim(),
        language: lang.label, voice: b.voice || "en-US-AriaNeural", rate: b.rate || "0%",
        aspect: b.aspect || "9:16", quality: b.quality || "1080", duration: b.duration || "medium",
        source: b.source || "pexels", videoModel: b.videoModel || "", imageStyle: b.imageStyle || "",
        llmProvider: b.llmProvider || "", watermark: b.watermark || "",
        captionPos: b.captionPos || "bottom", motion: b.motion || "in", watermarkImage: b.watermarkImage ? watermarkFile() : "",
        width, height, font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
        outline: o.outline, total, done: 0, files: [], recaps: [],
      };
      saveSeries(series);
      job.seriesId = series.id;
      pushLog(job, `✅ "${series.seriesTitle}" outlined in ${total} parts. Rendering first ${batch}…`);
      await runSeries(series, batch, job);
    } catch (e) {
      pushLog(job, "❌ " + (e.message === "NO_LLM_KEY" ? "No AI key set — add a Gemini key in Settings." : e.message));
      job.status = "error"; busy = false;
    }
  })();
});

app.post("/api/series/continue", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const series = loadSeries((req.body || {}).id);
  if (!series) return res.status(404).json({ error: "Series not found." });
  if (series.done >= series.total) return res.status(400).json({ error: "This series is already complete." });
  const batch = clamp((req.body || {}).batch, 1, 20);
  busy = true;
  const job = newJob(batch);
  job.seriesId = series.id;
  res.json({ jobId: job.id });
  (async () => {
    try {
      pushLog(job, `▶️ Continuing "${series.seriesTitle}" from Part ${series.done + 1}…`);
      await runSeries(series, batch, job);
    } catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; busy = false; }
  })();
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
