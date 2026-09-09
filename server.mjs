// Local web app for the Shorts Engine: topic -> AI scripts -> render, or manual scenes.
// Run: npm start   (opens http://localhost:4321)
import express from "express";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync, copyFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import open from "open";
import { generateScripts, generateIdeas, generateAdIdeas, generateStory, generateTopic, generateLyrics, generateComparison } from "./scripts/generate.mjs";
import { createOutline, episodeConfig } from "./scripts/series.mjs";
import { detectHardware, tierConfig, downloadPlan, installPlan, installCommand } from "./scripts/hardware.mjs";
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
const PORT = parseInt(process.env.PORT, 10) || 4321;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const app = express();
app.use(express.json({ limit: "80mb" })); // large limit for base64 media uploads
app.use(express.static(join(ROOT, "web")));
app.use("/out", express.static(OUT));
// keep the final videos (out/*.mp4) separate from their supporting files
// (thumbnails, voice tracks, configs, metadata) which live in out/data/
const DATA = join(OUT, "data");
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
app.use("/data", express.static(DATA));
// one-time migration: move loose sidecars out of out/ into out/data/
(function migrateData() {
  try {
    for (const f of readdirSync(OUT)) {
      if (/\.(thumb\.jpg|voice\.mp3|config\.json)$/i.test(f) || (/\.json$/i.test(f) && f !== ".stats.json" && existsSync(join(OUT, f.replace(/\.json$/i, ".mp4"))))) {
        try { renameSync(join(OUT, f), join(DATA, f)); } catch {}
      }
    }
  } catch {}
})();
const DRAFTS_DIR = join(ROOT, "drafts");
const ASSETS_DIR = join(ROOT, "assets");
app.use("/assets", express.static(ASSETS_DIR));
const MUSIC_DIR = join(ROOT, "music");
app.use("/music", express.static(MUSIC_DIR));

// ---- Music library (upload your own tracks) + built-in ambient beds + Editor ----
const BED_FILTERS = {
  scary: { inputs: ["sine=frequency=110:duration=30", "sine=frequency=146.83:duration=30", "sine=frequency=220:duration=30", "anoisesrc=d=30:c=pink:a=0.05"], filter: "amix=inputs=4:normalize=0,tremolo=f=0.12:d=0.5,aecho=0.8:0.85:800:0.3,highpass=f=90,lowpass=f=2200,volume=2.0" },
  calm: { inputs: ["sine=frequency=196:duration=30", "sine=frequency=261.63:duration=30", "sine=frequency=349.23:duration=30", "anoisesrc=d=30:c=pink:a=0.03"], filter: "amix=inputs=4:normalize=0,tremolo=f=0.1:d=0.5,aecho=0.8:0.85:800:0.3,highpass=f=90,lowpass=f=1800,volume=1.7" },
  uplifting: { inputs: ["sine=frequency=261.63:duration=30", "sine=frequency=329.63:duration=30", "sine=frequency=392:duration=30", "anoisesrc=d=30:c=pink:a=0.03"], filter: "amix=inputs=4:normalize=0,tremolo=f=0.1:d=0.4,aecho=0.8:0.85:600:0.25,highpass=f=110,lowpass=f=3200,volume=1.7" },
  // nature soundscapes (noise-shaped — realistic ambience)
  rain: { inputs: ["anoisesrc=d=30:c=pink:a=0.5"], filter: "highpass=f=400,lowpass=f=9000,tremolo=f=8:d=0.15,volume=2.5,alimiter=limit=0.9" },
  ocean: { inputs: ["anoisesrc=d=30:c=brown:a=0.7"], filter: "lowpass=f=1600,tremolo=f=0.12:d=0.85,volume=2.2,alimiter=limit=0.9" },
  wind: { inputs: ["anoisesrc=d=30:c=pink:a=0.5"], filter: "highpass=f=200,lowpass=f=1400,tremolo=f=0.25:d=0.7,volume=2.2,alimiter=limit=0.9" },
  stream: { inputs: ["anoisesrc=d=30:c=white:a=0.4"], filter: "highpass=f=800,lowpass=f=6000,tremolo=f=5:d=0.1,volume=2.2,alimiter=limit=0.9" },
  fire: { inputs: ["anoisesrc=d=30:c=brown:a=0.6", "anoisesrc=d=30:c=white:a=0.08"], filter: "amix=inputs=2:normalize=0,lowpass=f=2000,tremolo=f=11:d=0.4,volume=2.2,alimiter=limit=0.9" },
  forest: { inputs: ["anoisesrc=d=30:c=pink:a=0.28"], filter: "highpass=f=300,lowpass=f=5000,tremolo=f=0.3:d=0.5,volume=2.0,alimiter=limit=0.9" },
};
function ensureBeds() {
  if (!existsSync(MUSIC_DIR)) mkdirSync(MUSIC_DIR, { recursive: true });
  for (const [mood, m] of Object.entries(BED_FILTERS)) {
    const out = join(MUSIC_DIR, `bed_${mood}.mp3`);
    if (existsSync(out)) continue;
    const args = ["-y"];
    m.inputs.forEach((i) => args.push("-f", "lavfi", "-i", i));
    args.push("-filter_complex", m.inputs.map((_, k) => `[${k}]`).join("") + m.filter, "-ac", "2", "-q:a", "4", out);
    try { execFileSync("ffmpeg", args, { stdio: "ignore" }); } catch {}
  }
}
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const BED_LABEL = { scary: "Suspense", calm: "Calm", uplifting: "Uplifting", neutral: "Neutral", rain: "🌧️ Rain", ocean: "🌊 Ocean waves", wind: "🍃 Wind", stream: "💧 Stream", fire: "🔥 Fire crackle", forest: "🌲 Forest" };
app.get("/api/music", (_req, res) => {
  ensureBeds();
  const list = readdirSync(MUSIC_DIR).filter((f) => AUDIO_RE.test(f)).map((f) => {
    const bed = f.match(/^bed_(\w+)\.mp3$/i);
    return { file: f, url: "/music/" + encodeURIComponent(f), label: bed ? (BED_LABEL[bed[1]] || bed[1]) : f.replace(AUDIO_RE, ""), kind: bed ? "bed" : "upload" };
  }).sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "bed" ? -1 : 1));
  res.json(list);
});
app.post("/api/music", (req, res) => {
  const m = String((req.body || {}).dataUrl || "").match(/^data:audio\/[^;]+;base64,(.+)$/);
  const nm = String((req.body || {}).name || "track").replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 50) || "track";
  if (!m) return res.status(400).json({ error: "Attach an audio file (mp3/wav/m4a)." });
  if (!existsSync(MUSIC_DIR)) mkdirSync(MUSIC_DIR, { recursive: true });
  const file = nm.replace(/\s+/g, "_") + "_" + Date.now().toString(36) + ".mp3";
  writeFileSync(join(MUSIC_DIR, file), Buffer.from(m[1], "base64"));
  res.json({ ok: true, file });
});
app.delete("/api/music/:file", (req, res) => {
  const f = req.params.file.replace(/[^a-z0-9._-]/gi, "");
  const p = join(MUSIC_DIR, f);
  if (existsSync(p) && p.startsWith(MUSIC_DIR)) unlinkSync(p);
  res.json({ ok: true });
});

// Editor: swap background music / adjust voice & music volume on a rendered video —
// fast ffmpeg remux (no re-render) using the saved voice-only track.
app.post("/api/edit/remix", (req, res) => {
  const b = req.body || {};
  const file = String(b.file || "").replace(/[^a-z0-9._-]/gi, "");
  const videoPath = join(OUT, file);
  if (!file.endsWith(".mp4") || !existsSync(videoPath)) return res.status(404).json({ error: "Video not found." });
  const base = file.replace(/\.mp4$/, "");
  const voicePath = join(DATA, base + ".voice.mp3");
  if (!existsSync(voicePath)) return res.status(400).json({ error: "This video was made before the Editor existed — re-render it once to enable music editing." });
  const voiceVol = Math.max(0, Math.min(2, parseFloat(b.voiceVol) || 1));
  const musicVol = Math.max(0, Math.min(1.5, parseFloat(b.musicVol) != null ? parseFloat(b.musicVol) : 0.25));
  let musicPath = "";
  if (b.music && b.music !== "none") {
    const mf = String(b.music).replace(/[^a-z0-9._-]/gi, "");
    const mp = join(MUSIC_DIR, mf);
    if (existsSync(mp) && mp.startsWith(MUSIC_DIR)) musicPath = mp;
  }
  const tmp = join(OUT, base + ".remix.mp4");
  try {
    if (musicPath) {
      execFileSync("ffmpeg", ["-y", "-i", videoPath, "-i", voicePath, "-stream_loop", "-1", "-i", musicPath,
        "-filter_complex", `[1:a]volume=${voiceVol}[v];[2:a]volume=${musicVol}[m];[v][m]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
        "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-shortest", tmp], { stdio: "ignore" });
    } else {
      execFileSync("ffmpeg", ["-y", "-i", videoPath, "-i", voicePath,
        "-filter_complex", `[1:a]volume=${voiceVol}[aout]`,
        "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-shortest", tmp], { stdio: "ignore" });
    }
    renameSync(tmp, videoPath);
    try { const th = join(OUT, base + ".thumb.jpg"); if (existsSync(th)) unlinkSync(th); } catch {}
    res.json({ ok: true, file });
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    res.status(500).json({ error: "Remix failed: " + (e.message || "ffmpeg error").slice(0, 160) });
  }
});

// Editor: change VOICE / LANGUAGE — re-runs the render with the saved script (no
// AI re-writing), because new words/timing require the captions to be re-rendered.
app.post("/api/edit/revoice", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const file = String(b.file || "").replace(/[^a-z0-9._-]/gi, "");
  const base = file.replace(/\.mp4$/, "");
  const cfgPath = join(DATA, base + ".config.json");
  if (!file.endsWith(".mp4") || !existsSync(cfgPath)) return res.status(400).json({ error: "This video was made before re-voicing existed — re-render it once to enable it." });
  let config;
  try { config = JSON.parse(readFileSync(cfgPath, "utf8")); } catch { return res.status(500).json({ error: "Could not read this video's saved script." }); }
  const lang = resolveLang(b.language || config.langCode || "en");
  config.langCode = b.language || config.langCode || "en";
  if (b.voice) config.voice = b.voice;
  config.voiceEngine = b.voiceEngine || config.voiceEngine || "edge";
  if (typeof b.piperVoice === "string") config.piperVoice = b.piperVoice;
  if (typeof b.kokoroVoice === "string") config.kokoroVoice = b.kokoroVoice;
  if (typeof b.heroVideo !== "undefined") config.heroVideo = !!b.heroVideo;
  config.font = lang.font; config.fontCss = lang.fontCss; config.rtl = lang.rtl;
  config.slug = base; // keep the same filename so it overwrites this video
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id });
  (async () => {
    try { pushLog(job, `🎙️ Re-voicing "${config.title || base}" in ${lang.label}…`); await runAll([config], job); }
    catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; busy = false; }
  })();
});

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
  { id: "local", label: "AI images: Local (ComfyUI/SDXL) — free, unlimited, offline" },
  { id: "fal-image", label: "AI images: fal.ai FLUX — paid, best quality" },
  { id: "fal", label: "AI video: fal.ai — paid (Seedance / Veo / Kling)" },
];
const IMAGE_LAB_PROVIDERS = [
  { id: "auto", label: "Auto — local first, cloud fallback" },
  { id: "local", label: "Local ComfyUI / SDXL — offline" },
  { id: "image", label: "Pollinations FLUX — free cloud" },
  { id: "hf", label: "Hugging Face FLUX — cloud" },
  { id: "fal-image", label: "fal.ai FLUX — cloud" },
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
const IMAGE_FILTERS = [
  { id: "none", label: "Clean" },
  { id: "cinematic", label: "Cinematic contrast" },
  { id: "warm", label: "Warm golden" },
  { id: "cool", label: "Cool teal" },
  { id: "vibrant", label: "Vibrant pop" },
  { id: "vintage", label: "Vintage film" },
  { id: "noir", label: "Noir B&W" },
  { id: "dreamy", label: "Dreamy glow" },
  { id: "sharp", label: "Sharp detail" },
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

const MOOD_FOR_STORY = { scary: "scary", bedtime: "calm", biography: "calm", tech: "calm", documentary: "calm", motivational: "uplifting", cooking: "uplifting", fashion: "uplifting", educational: "calm", history: "calm", war: "scary", mythology: "uplifting", psychology: "calm", philosophy: "calm", folklore: "calm", mystery: "scary", space: "uplifting", science: "calm", truecrime: "scary", sports: "uplifting", finance: "uplifting", story: "calm" };
// a full VISUAL THEME per story type — imageStyle (AI images), motion, captions —
// so a scary story and a bedtime story actually look different, not just sound it.
const STORY_THEMES = {
  scary: { imageStyle: "dark cinematic horror still, eerie, desaturated, deep shadows, moody low-key lighting, film grain, unsettling", motion: "in", captionPos: "bottom", effect: "vintage" },
  bedtime: { imageStyle: "soft dreamy storybook illustration, warm pastel colors, gentle glow, cozy, whimsical, calming", motion: "subtle", captionPos: "bottom", effect: "dreamy" },
  biography: { imageStyle: "cinematic documentary photograph, warm natural light, timeless, dignified, detailed", motion: "in", captionPos: "bottom", effect: "warm" },
  tech: { imageStyle: "sleek modern technology, clean minimal, cool blue tones, futuristic, crisp, high-tech", motion: "in", captionPos: "bottom", effect: "cold" },
  documentary: { imageStyle: "epic cinematic documentary, natural lighting, sweeping wide shots, rich detail, film look", motion: "in", captionPos: "bottom", effect: "none" },
  motivational: { imageStyle: "epic inspiring cinematic, golden-hour light, dramatic, uplifting, high contrast", motion: "in", captionPos: "middle", effect: "vibrant" },
  cooking: { imageStyle: "vibrant appetizing food photography, warm kitchen light, fresh ingredients, steam, close-up, delicious", motion: "in", captionPos: "bottom", effect: "warm" },
  fashion: { imageStyle: "high-fashion editorial photography, stylish, rich color, elegant, magazine look, detailed", motion: "in", captionPos: "bottom", effect: "vibrant" },
  educational: { imageStyle: "clean bright explainer visuals, clear, colorful, friendly, well-lit, detailed", motion: "in", captionPos: "bottom", effect: "none" },
  history: { imageStyle: "epic historical documentary still, aged film look, dramatic lighting, sweeping, richly detailed", motion: "in", captionPos: "bottom", effect: "vintage" },
  war: { imageStyle: "gritty war documentary, desaturated, dramatic smoke and shadow, cinematic, intense", motion: "in", captionPos: "bottom", effect: "vintage" },
  mythology: { imageStyle: "epic mythological art, divine golden light, ancient gods and heroes, ornate, painterly, dramatic, richly detailed", motion: "in", captionPos: "bottom", effect: "vintage" },
  psychology: { imageStyle: "clean thoughtful conceptual art, mind and brain motifs, soft modern lighting, minimal, intriguing, detailed", motion: "in", captionPos: "bottom", effect: "cold" },
  philosophy: { imageStyle: "contemplative cinematic, soft timeless light, thoughtful, minimal, atmospheric, painterly", motion: "subtle", captionPos: "bottom", effect: "warm" },
  folklore: { imageStyle: "folk-tale illustration, warm firelight, mystical, rustic, storybook, atmospheric, detailed", motion: "subtle", captionPos: "bottom", effect: "dreamy" },
  mystery: { imageStyle: "moody mysterious cinematic, fog, low key light, noir, intriguing, richly detailed", motion: "in", captionPos: "bottom", effect: "noir" },
  space: { imageStyle: "breathtaking space art, nebulae, planets, stars, cosmic scale, deep vivid colors, ultra detailed, cinematic", motion: "in", captionPos: "bottom", effect: "cold" },
  science: { imageStyle: "vivid science visualization, clean, colorful, bright, detailed, engaging", motion: "in", captionPos: "bottom", effect: "vibrant" },
  truecrime: { imageStyle: "dark investigative cinematic, moody noir, grainy, tense, detailed", motion: "in", captionPos: "bottom", effect: "noir" },
  sports: { imageStyle: "dynamic sports cinematic, motion blur, stadium light, intense, high energy, detailed", motion: "in", captionPos: "bottom", effect: "vibrant" },
  finance: { imageStyle: "sleek modern finance visuals, clean, gold and green accents, professional, crisp, detailed", motion: "in", captionPos: "bottom", effect: "cold" },
  story: { imageStyle: "cinematic film still, dramatic lighting, highly detailed, atmospheric", motion: "in", captionPos: "bottom", effect: "none" },
};
// best-fit XTTS-v2 built-in voice per story type (safe: server falls back if missing)
const XTTS_VOICE_FOR = { scary: "Damien Black", bedtime: "Sofia Hellen", biography: "Royston Min", tech: "Andrew Chipper", documentary: "Viktor Menelaos", motivational: "Craig Gutsy", cooking: "Sofia Hellen", fashion: "Alison Dietlinde", educational: "Andrew Chipper", history: "Viktor Menelaos", war: "Damien Black", mythology: "Viktor Menelaos", psychology: "Andrew Chipper", philosophy: "Viktor Menelaos", folklore: "Sofia Hellen", mystery: "Damien Black", space: "Viktor Menelaos", science: "Andrew Chipper", truecrime: "Damien Black", sports: "Craig Gutsy", finance: "Craig Gutsy", story: "Damien Black" };
// emotional delivery per story type: edge-tts rate/pitch + Piper length-scale (pace)
const PROSODY = {
  scary: { rate: "-12%", pitch: "-6Hz", length: 1.18 },
  bedtime: { rate: "-14%", pitch: "-2Hz", length: 1.22 },
  biography: { rate: "-3%", pitch: "0Hz", length: 1.05 },
  tech: { rate: "+3%", pitch: "0Hz", length: 0.98 },
  documentary: { rate: "-5%", pitch: "-2Hz", length: 1.08 },
  motivational: { rate: "+6%", pitch: "+3Hz", length: 0.95 },
  cooking: { rate: "+1%", pitch: "0Hz", length: 1.0 },
  fashion: { rate: "+2%", pitch: "+1Hz", length: 0.98 },
  educational: { rate: "+2%", pitch: "0Hz", length: 0.98 },
  history: { rate: "-4%", pitch: "-2Hz", length: 1.08 },
  war: { rate: "-5%", pitch: "-3Hz", length: 1.1 },
  mythology: { rate: "-4%", pitch: "-2Hz", length: 1.1 },
  psychology: { rate: "+1%", pitch: "0Hz", length: 1.0 },
  philosophy: { rate: "-6%", pitch: "-2Hz", length: 1.12 },
  folklore: { rate: "-6%", pitch: "-1Hz", length: 1.14 },
  mystery: { rate: "-6%", pitch: "-3Hz", length: 1.12 },
  space: { rate: "-3%", pitch: "-1Hz", length: 1.06 },
  science: { rate: "+2%", pitch: "0Hz", length: 0.98 },
  truecrime: { rate: "-6%", pitch: "-3Hz", length: 1.12 },
  sports: { rate: "+6%", pitch: "+3Hz", length: 0.95 },
  finance: { rate: "+3%", pitch: "+1Hz", length: 0.97 },
  story: { rate: "-4%", pitch: "0Hz", length: 1.08 },
};
function resolveMood(sel, ctx = {}) {
  let s = String(sel || "").trim();
  if (!s || s === "none") return "";
  if (s === "neutral") s = "calm"; // no separate neutral bed — calm covers it
  if (["scary", "calm", "uplifting", "rain", "ocean", "wind", "stream", "fire", "forest"].includes(s)) return s;
  if (s === "auto") {
    if (ctx.storyType) return MOOD_FOR_STORY[ctx.storyType] || "neutral";
    const g = String(ctx.genre || "").toLowerCase();
    if (/horror|mystery|scary|unsolved/.test(g)) return "scary";
    if (/motivation|success|discipline|stoic/.test(g)) return "uplifting";
    return "calm";
  }
  return "";
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
// Rough per-unit time estimates (seconds) used to show an ETA while a job
// runs. Scaled by the machine's tier — a Lite M1 is slower than a Pro/Ultra.
// `kind` is set by each endpoint; falls back to a generic render estimate.
const ETA_BASE = { render: 55, animate: 430, image: 45, voice: 6, series: 70, install: 300 };
function etaScale() {
  const t = detectHardware().tierId;
  return { lite: 1, standard: 0.65, pro: 0.45, ultra: 0.32 }[t] || 1;
}
function newJob(total, kind = "render") {
  const id = String(++seq);
  const perUnit = Math.round((ETA_BASE[kind] || ETA_BASE.render) * etaScale());
  const job = {
    id, status: "running", log: [], files: [], total, current: 0, title: "",
    kind, startedAt: Date.now(), perUnit, etaTotal: perUnit * Math.max(1, total),
  };
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
    xttsUrl: getEnvValue("XTTS_URL") || "",
    xttsVoice: getEnvValue("XTTS_VOICE") || "",
    elevenVoice: getEnvValue("ELEVEN_VOICE") || "",
    voiceEngines: { piper: !!(getEnvValue("PIPER_MODEL") && getEnvValue("PIPER_PYTHON")), xtts: !!getEnvValue("XTTS_URL"), eleven: !!getEnvValue("ELEVEN_API_KEY") },
    avatarProvider: avatarProvider(),
    keys: { pexels: km("PEXELS_API_KEY"), jamendo: km("JAMENDO_CLIENT_ID"), gemini: km("GEMINI_API_KEY"), openai: km("OPENAI_API_KEY"), fal: km("FAL_KEY"), hf: km("HF_TOKEN"), did: km("DID_API_KEY"), heygen: km("HEYGEN_API_KEY"), eleven: km("ELEVEN_API_KEY") },
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
  setIf("jamendo", "JAMENDO_CLIENT_ID", "Jamendo key");
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
  setIf("xttsUrl", "XTTS_URL", "XTTS server URL");
  if (typeof b.xttsVoice === "string") { setEnvValue("XTTS_VOICE", b.xttsVoice.trim()); saved.push("XTTS voice"); }
  setIf("eleven", "ELEVEN_API_KEY", "ElevenLabs key");
  setIf("elevenVoice", "ELEVEN_VOICE", "ElevenLabs voice");
  res.json({ ok: true, saved });
});

// ---- Piper offline voices (list .onnx models in the piper voices folder) ----
function piperDir() {
  const d = getEnvValue("PIPER_DIR");
  if (d) return d;
  const m = getEnvValue("PIPER_MODEL");
  return m ? dirname(m) : "";
}
const LOCALE_NAMES = { en_US: "English (US)", en_GB: "English (UK)", es_ES: "Spanish", fr_FR: "French", de_DE: "German", it_IT: "Italian", hi_IN: "Hindi", pt_BR: "Portuguese", nl_NL: "Dutch" };
function piperVoiceLabel(file) {
  const m = file.replace(/\.onnx$/i, "").match(/^([a-z]{2}_[A-Z]{2})-(.+?)-(\w+)$/);
  if (!m) return file;
  const [, loc, name, q] = m;
  return `${LOCALE_NAMES[loc] || loc} · ${name} (${q})`;
}
app.get("/api/piper-voices", (_req, res) => {
  const dir = piperDir();
  const voices = dir && existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.onnx$/i.test(f)).sort().map((f) => ({ file: f, label: piperVoiceLabel(f) }))
    : [];
  const current = getEnvValue("PIPER_MODEL");
  res.json({ dir, voices, current: current ? current.split("/").pop() : "" });
});

app.get("/api/videos", (_req, res) => {
  const list = readdirSync(OUT)
    .filter((f) => f.endsWith(".mp4"))
    .map((f) => {
      const s = statSync(join(OUT, f));
      let meta = {};
      const base = f.replace(/\.mp4$/, "");
      const metaPath = join(DATA, base + ".json");
      if (existsSync(metaPath)) { try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {} }
      // video dimensions (cached in the sidecar so we only ffprobe once)
      let w = meta.w, h = meta.h;
      if (!w || !h) {
        try {
          const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", join(OUT, f)]).toString().trim();
          const m = out.match(/(\d+)x(\d+)/);
          if (m) { w = +m[1]; h = +m[2]; meta.w = w; meta.h = h; try { writeFileSync(metaPath, JSON.stringify(meta, null, 2)); } catch {} }
        } catch {}
      }
      // lazy thumbnail (first ~1s frame) -> out/data/
      const thumb = base + ".thumb.jpg";
      if (!existsSync(join(DATA, thumb))) {
        try { execFileSync("ffmpeg", ["-y", "-ss", "1", "-i", join(OUT, f), "-frames:v", "1", "-vf", "scale=320:-1", join(DATA, thumb)], { stdio: "ignore" }); } catch {}
      }
      const csv = (t) => (Array.isArray(t) ? t.map((x) => String(x).replace(/^#/, "").trim()).filter(Boolean).join(", ") : "");
      return { file: f, size: s.size, mtime: s.mtimeMs, title: meta.title || "", description: meta.description || "", hashtags: meta.hashtags || "", tagsCsv: csv(meta.tags), thumb: existsSync(join(DATA, thumb)) ? thumb : "", w: w || 0, h: h || 0, language: meta.language || "", titleLocal: meta.titleLocal || "", descriptionLocal: meta.descriptionLocal || "", hashtagsLocal: meta.hashtagsLocal || "", tagsCsvLocal: csv(meta.tagsLocal) };
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
        c.piperVoice = b.piperVoice || "";
    c.kokoroVoice = b.kokoroVoice || "";
    c.heroVideo = !!b.heroVideo; // chosen local Piper voice file (optional)
        c.musicMood = resolveMood(b.musicMood, { genre });
        c.reuseVisuals = b.reuseVisuals || 0;
        c.langCode = b.language || "en";
        c.effect = (b.effect && b.effect !== "auto") ? b.effect : "none";
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

// ---- Long-form Story mode (3-10 min narration: bedtime / scary / biography / tech) ----
app.post("/api/story", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const topic = String(b.topic || "").trim();
  const country = String(b.country || "").trim();
  if (!topic && !country) return res.status(400).json({ error: "Enter a topic or pick a country." });
  const minutes = Math.min(Math.max(parseInt(b.minutes) || 3, 1), 10);
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const lang = resolveLang(b.language || "en");
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id });
  (async () => {
    try {
      const pr = PROSODY[b.storyType] || PROSODY.story;
      const config = await generateStory({
        topic, country, storyType: b.storyType || "story", minutes,
        language: lang.label, voice: b.voice || "en-US-AriaNeural", rate: pr.rate,
        width, height, source: b.source || "pexels", videoModel: b.videoModel || "",
        font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
        llmProvider: b.llmProvider || "", instructions: b.instructions || "",
        onProgress: (m) => pushLog(job, m),
      });
      const theme = STORY_THEMES[b.storyType] || STORY_THEMES.story;
      config.imageStyle = b.imageStyle || theme.imageStyle; // themed AI-image look per genre
      config.watermark = b.watermark || "";
      config.captionPos = theme.captionPos;
      config.motion = theme.motion;
      config.watermarkImage = b.watermarkImage ? watermarkFile() : "";
      config.voiceEngine = b.voiceEngine || "edge";
      config.piperVoice = b.piperVoice || "";
    config.kokoroVoice = b.kokoroVoice || "";
    config.heroVideo = !!b.heroVideo;
      config.musicMood = resolveMood(b.musicMood || "auto", { storyType: b.storyType || "story" });
      config.reuseVisuals = b.reuseVisuals || 0;
      config.pitch = pr.pitch;          // edge-tts pitch for emotion
      config.piperLength = pr.length;   // Piper pace for emotion
      config.xttsSpeaker = XTTS_VOICE_FOR[b.storyType] || XTTS_VOICE_FOR.story; // best XTTS voice for the genre
      config.langCode = b.language || "en";
      config.effect = (!b.effect || b.effect === "auto") ? theme.effect : b.effect; // themed camera look, or the user's pick
      pushLog(job, `🎬 Rendering a ${minutes}-min ${b.storyType || "story"} — ${config.scenes.length} scenes. This is a long render; hang tight…`);
      await runAll([config], job);
    } catch (e) {
      pushLog(job, "❌ " + (String(e.message).startsWith("NO_LLM_KEY") ? "No AI key/model set — add a Gemini key or set an Ollama model in Settings." : e.message));
      job.status = "error"; busy = false;
    }
  })();
});

// ---- Song mode: your song + lyrics -> aesthetic lyric video ----
function parseLyrics(raw, dur) {
  const rawLines = String(raw || "").split(/\r?\n/).map((l) => l.trim());
  const timed = [];
  const plain = [];
  const lrc = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?\]\s*(.*)$/;
  for (const l of rawLines) {
    if (!l) continue;
    const m = l.match(lrc);
    if (m) { const t = (+m[1]) * 60 + (+m[2]) + (m[3] ? (+m[3]) / (m[3].length === 1 ? 10 : 100) : 0); timed.push({ t, text: m[4].trim() }); }
    else plain.push(l);
  }
  let lines;
  if (timed.length >= 2) {
    timed.sort((a, b) => a.t - b.t);
    lines = timed.map((x, i) => ({ text: x.text, start: x.t, end: i + 1 < timed.length ? timed[i + 1].t : dur })).filter((x) => x.text);
  } else {
    const all = (plain.length ? plain : rawLines).filter(Boolean);
    const per = dur / Math.max(1, all.length);
    lines = all.map((text, i) => ({ text, start: i * per, end: (i + 1) * per }));
  }
  return lines;
}
app.post("/api/song", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const lyricsRaw = String(b.lyrics || "").trim();
  if (!lyricsRaw) return res.status(400).json({ error: "Add lyrics (or write them from a topic)." });
  const theme = String(b.theme || b.topic || "").trim();
  const songPath = join(PUBLIC, "voiceover.mp3");
  const m = String(b.songDataUrl || "").match(/^data:audio\/[^;]+;base64,(.+)$/);
  let dur = 30;
  if (m) {
    // uploaded song -> the audio track
    const rawPath = join(PUBLIC, "song_raw");
    writeFileSync(rawPath, Buffer.from(m[1], "base64"));
    try { execFileSync("ffmpeg", ["-y", "-i", rawPath, "-codec:a", "libmp3lame", "-q:a", "2", songPath], { stdio: "ignore" }); }
    catch (e) { return res.status(400).json({ error: "Could not read that audio file." }); }
    try { dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", songPath]).toString().trim()) || 30; } catch {}
  } else {
    // no upload: build a music-bed backing track sized to the lyrics
    const nLines = lyricsRaw.split(/\r?\n/).filter((l) => l.trim()).length;
    dur = Math.max(15, Math.round(nLines * 3.2));
    ensureBeds();
    const mood = resolveMood(b.musicMood, {}) || "calm";
    let bedSrc = join(MUSIC_DIR, `bed_${mood}.mp3`);
    if (!existsSync(bedSrc)) bedSrc = join(MUSIC_DIR, "bed_calm.mp3");
    if (!existsSync(bedSrc)) return res.status(400).json({ error: "Upload a song, or pick a music mood for the backing track." });
    try { execFileSync("ffmpeg", ["-y", "-stream_loop", "-1", "-i", bedSrc, "-t", String(dur), "-codec:a", "libmp3lame", "-q:a", "2", songPath], { stdio: "ignore" }); }
    catch (e) { return res.status(400).json({ error: "Couldn't build the backing track." }); }
  }
  const lyricLines = parseLyrics(lyricsRaw, dur);
  if (lyricLines.length < 1) return res.status(400).json({ error: "Couldn't read any lyric lines." });
  const { width, height } = dims(b.aspect || "1:1", b.quality || "1080");
  const lang = resolveLang(b.language || "en");
  // per-line images: each lyric gets its own relevant image (fixes repeated/irrelevant visuals)
  const perLine = b.perLineImages !== false;
  const uniq = perLine ? 0 : Math.max(1, Math.min(lyricLines.length, parseInt(b.reuseVisuals) || 6));
  const config = {
    title: String(b.title || "Lyric Video").slice(0, 100),
    slug: slugify(b.title || "lyric-video") || ("song-" + Date.now().toString(36)),
    description: "", tags: [],
    songMode: true,
    voice: "", rate: "0%", music: "", width, height,
    source: b.source || "image", videoModel: b.videoModel || "",
    imageStyle: b.imageStyle || "",
    watermark: b.watermark || "", watermarkImage: b.watermarkImage ? watermarkFile() : "",
    captionPos: b.captionPos || "bottom", motion: b.motion || "subtle", effect: (b.effect && b.effect !== "auto") ? b.effect : "none",
    reuseVisuals: uniq, langCode: b.language || "en",
    font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
    lyricLines,
    scenes: lyricLines.map((l) => ({
      text: l.text,
      query: theme || l.text,
      imagePrompt: perLine ? ((theme ? theme + ", " : "") + l.text) : (theme || l.text),
    })),
  };
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id });
  (async () => {
    try { pushLog(job, `🎵 Building a ${Math.round(dur)}s lyric video — ${lyricLines.length} lines, ${uniq} images…`); await runAll([config], job); }
    catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; busy = false; }
  })();
});

// ---- Find: search free stock images (Pexels) + build a video from picked media ----
app.get("/api/find/images", async (req, res) => {
  const key = getEnvValue("PEXELS_API_KEY");
  if (!key) return res.status(400).json({ error: "Add a Pexels key in Settings." });
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const orient = ["landscape", "portrait", "square"].includes(String(req.query.orientation)) ? `&orientation=${req.query.orientation}` : "";
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=30&page=${page}${orient}`, { headers: { Authorization: key } });
    if (!r.ok) return res.status(502).json({ error: `Pexels ${r.status}` });
    const d = await r.json();
    res.json((d.photos || []).map((p) => ({ id: p.id, thumb: p.src.medium, url: p.src.large2x || p.src.large, w: p.width, h: p.height, alt: p.alt || "" })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
async function searchJamendo(q, page) {
  const cid = getEnvValue("JAMENDO_CLIENT_ID");
  if (!cid) return null;
  const offset = (Math.max(1, page) - 1) * 24;
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(cid)}&format=json&limit=24&offset=${offset}&search=${encodeURIComponent(q)}&audioformat=mp32&include=musicinfo+licenses&order=popularity_total`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Jamendo ${r.status}`);
  const d = await r.json();
  return (d.results || []).filter((x) => x.audio).map((x) => ({
    id: "jam-" + x.id, title: x.name || "Untitled", creator: x.artist_name || "", license: "CC (Jamendo)",
    duration: Math.round(x.duration || 0), url: x.audiodownload || x.audio,
    attribution: `"${x.name}" by ${x.artist_name} — Jamendo (${x.license_ccurl ? x.license_ccurl.replace(/^https?:\/\//, "") : "Creative Commons"})`,
  }));
}
async function searchOpenverse(q, page) {
  const r = await fetch(`https://api.openverse.org/v1/audio/?q=${encodeURIComponent(q)}&page_size=24&page=${Math.max(1, page)}&license_type=commercial,modification`, { headers: { "User-Agent": "ShortsStudio/1.0 (faceless-video-studio)" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Openverse ${r.status}`);
  const d = await r.json();
  return (d.results || []).filter((x) => x.url).map((x) => ({
    id: "ov-" + x.id, title: x.title || "Untitled", creator: x.creator || "", license: ((x.license || "") + " " + (x.license_version || "")).trim().toUpperCase(),
    duration: Math.round((x.duration || 0) / 1000), url: x.url,
    attribution: `"${x.title || "track"}" by ${x.creator || "unknown"} — ${(x.license || "").toUpperCase()} ${x.license_version || ""}`.trim(),
  }));
}
app.get("/api/find/music", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const hasJamendo = !!getEnvValue("JAMENDO_CLIENT_ID");
  try {
    // Prefer Jamendo when a key is set (reliable, high limits); else keyless Openverse.
    if (hasJamendo) {
      try { const j = await searchJamendo(q, page); if (j && j.length) return res.json(j); } catch (e) { /* fall through */ }
    }
    const ov = await searchOpenverse(q, page);
    return res.json(ov);
  } catch (e) {
    // Last resort: if Openverse failed but we haven't tried Jamendo, try it.
    if (!hasJamendo) return res.status(502).json({ error: "Free music search is busy right now (Openverse). Add a free Jamendo key in Settings for reliable search.", source: "openverse" });
    try { const j = await searchJamendo(q, page); return res.json(j || []); } catch (e2) { return res.status(502).json({ error: "Music search failed: " + e2.message }); }
  }
});
app.post("/api/find/create", async (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const images = Array.isArray(b.images) ? b.images.filter(Boolean).slice(0, 40) : [];
  if (!images.length) return res.status(400).json({ error: "Select at least one image." });
  const songPath = join(PUBLIC, "voiceover.mp3");
  const mu = b.music || {};
  if (mu.dataUrl) {
    const m = String(mu.dataUrl).match(/^data:audio\/[^;]+;base64,(.+)$/);
    if (!m) return res.status(400).json({ error: "That audio file couldn't be read." });
    const raw = join(PUBLIC, "song_raw"); writeFileSync(raw, Buffer.from(m[1], "base64"));
    try { execFileSync("ffmpeg", ["-y", "-i", raw, "-codec:a", "libmp3lame", "-q:a", "2", songPath], { stdio: "ignore" }); } catch { return res.status(400).json({ error: "That audio file couldn't be read." }); }
  } else if (mu.file) {
    const f = String(mu.file).replace(/[^a-z0-9._-]/gi, ""); const mp = join(MUSIC_DIR, f);
    if (!existsSync(mp)) return res.status(400).json({ error: "Music track not found." });
    try { execFileSync("ffmpeg", ["-y", "-i", mp, "-codec:a", "libmp3lame", "-q:a", "2", songPath], { stdio: "ignore" }); } catch { return res.status(400).json({ error: "Music error." }); }
  } else if (mu.url && /^https?:\/\//.test(String(mu.url))) {
    const raw = join(PUBLIC, "song_raw");
    try {
      const rr = await fetch(String(mu.url), { headers: { "User-Agent": "ShortsStudio/1.0" }, redirect: "follow" });
      if (!rr.ok) throw new Error(`download ${rr.status}`);
      writeFileSync(raw, Buffer.from(await rr.arrayBuffer()));
      execFileSync("ffmpeg", ["-y", "-i", raw, "-codec:a", "libmp3lame", "-q:a", "2", songPath], { stdio: "ignore" });
    } catch { return res.status(400).json({ error: "Couldn't fetch that track. Pick another." }); }
  } else return res.status(400).json({ error: "Pick a music track." });
  let dur = 20; try { dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", songPath]).toString().trim()) || 20; } catch {}
  const lines = String(b.lines || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const per = dur / Math.max(1, lines.length);
  const lyricLines = lines.map((text, i) => ({ text, start: i * per, end: (i + 1) * per }));
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  const lang = resolveLang(b.language || "en");
  const config = {
    title: String(b.title || "My Video").slice(0, 100), slug: slugify(b.title || "find-video") || ("find-" + Date.now().toString(36)),
    description: "", tags: [], songMode: true, voice: "", rate: "0%", music: "", width, height,
    source: "pexels", videoModel: "", imageStyle: "",
    watermark: b.watermark || "", watermarkImage: b.watermarkImage ? watermarkFile() : "",
    captionPos: b.captionPos || "bottom", motion: b.motion || "subtle", effect: (b.effect && b.effect !== "auto") ? b.effect : "none",
    reuseVisuals: 0, langCode: b.language || "en", font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
    lyricLines, scenes: images.map((u) => ({ text: "", query: "", imageUrl: u })),
  };
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id });
  (async () => {
    try { pushLog(job, `🎬 Building a ${Math.round(dur)}s video from ${images.length} picked images…`); await runAll([config], job); }
    catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; busy = false; }
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
    piperVoice: b.piperVoice || "",
    kokoroVoice: b.kokoroVoice || "",
    heroVideo: !!b.heroVideo,
    musicMood: resolveMood(b.musicMood, {}),
    reuseVisuals: b.reuseVisuals || 0,
    langCode: b.language || "en",
    effect: (b.effect && b.effect !== "auto") ? b.effect : "none",
    font: lang.font, fontCss: lang.fontCss, rtl: lang.rtl,
    scenes: scenes.map((s) => ({ text: String(s.text), query: String(s.query) })),
  };
  busy = true;
  const job = newJob(1);
  res.json({ jobId: job.id, dims: `${width}x${height}` });
  runAll([config], job);
});

// ---- ✍️ write song lyrics from a topic ----
app.post("/api/lyrics", async (req, res) => {
  const b = req.body || {};
  const topic = String(b.topic || "").trim();
  if (!topic) return res.status(400).json({ error: "Give a topic for the song." });
  try {
    const lyrics = await generateLyrics({
      topic, language: resolveLang(b.language || "en").label,
      lines: Math.min(24, Math.max(6, parseInt(b.lines) || 12)),
      mood: String(b.mood || "").trim(), llmProvider: b.llmProvider || "",
    });
    if (!lyrics) throw new Error("no lyrics");
    res.json({ lyrics });
  } catch (e) { res.status(500).json({ error: e.message || "Couldn't write lyrics — try again." }); }
});

// ---- 🎲 endless topics (dice): invent one fresh topic, optionally from a hint ----
app.post("/api/topic", async (req, res) => {
  const b = req.body || {};
  try {
    const topic = await generateTopic({
      forType: String(b.forType || "shorts"),
      type: String(b.type || "").trim(),
      hint: String(b.hint || "").trim(),
      genre: String(b.genre || "").trim(),
      country: String(b.country || "").trim(),
      language: resolveLang(b.language || "en").label,
      llmProvider: b.llmProvider || "",
    });
    if (!topic) throw new Error("no topic");
    res.json({ topic });
  } catch (e) { res.status(500).json({ error: e.message || "Couldn't roll a topic — try again." }); }
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
      forType: String(b.forType || "shorts"),
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
  // Freeze the clock the first time we observe a finished job, so "time taken"
  // reflects the actual run, not how long since it finished.
  if (job.status !== "running" && !job.finishedAt) job.finishedAt = Date.now();
  const end = job.finishedAt || Date.now();
  const elapsed = Math.round((end - (job.startedAt || end)) / 1000);
  // ETA: units already finished contribute their real cost; the rest are
  // estimated. While a unit is in flight, don't let "remaining" run negative.
  const doneUnits = Math.max(0, (job.current || 1) - 1);
  const estTotal = job.etaTotal || (job.perUnit || 55) * Math.max(1, job.total || 1);
  let remaining = job.status === "running" ? Math.max(0, estTotal - elapsed) : 0;
  res.json({
    status: job.status, title: job.title, total: job.total, current: job.current,
    files: job.files, log: job.log.slice(-26),
    kind: job.kind, elapsed, etaTotal: estTotal, remaining,
    doneUnits,
  });
});

// ---- voice cloning: manage reference samples for XTTS ----
const VOICE_DIR = join(DATA, "voices");
if (!existsSync(VOICE_DIR)) mkdirSync(VOICE_DIR, { recursive: true });
app.use("/data/voices", express.static(VOICE_DIR));
app.get("/api/voices", async (_req, res) => {
  const clones = existsSync(VOICE_DIR)
    ? readdirSync(VOICE_DIR).filter((f) => f.endsWith(".wav")).map((f) => {
        const id = f.replace(/\.wav$/, "");
        return { id, name: id.replace(/-/g, " "), url: "/data/voices/" + f };
      })
    : [];
  let speakers = [], kokoro = [];
  try {
    const u = (getEnvValue("XTTS_URL") || "http://localhost:7870/generate").replace(/\/generate$/, "/health");
    const r = await fetch(u, { signal: AbortSignal.timeout(2000) });
    if (r.ok) speakers = (await r.json()).speakers || [];
  } catch {}
  try {
    const u = (getEnvValue("KOKORO_URL") || "http://localhost:7880/generate").replace(/\/generate$/, "/health");
    const r = await fetch(u, { signal: AbortSignal.timeout(2000) });
    if (r.ok) kokoro = (await r.json()).voices || [];
  } catch {}
  res.json({ clones, speakers, kokoro, selected: getEnvValue("XTTS_VOICE") || "" });
});
app.post("/api/voices", (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Give the voice a name." });
  const m = String(b.dataUrl || "").match(/^data:audio\/[^;]+;base64,(.+)$/);
  if (!m) return res.status(400).json({ error: "Upload a short audio sample (6–20s)." });
  const id = (slugify(name) || "voice-" + Date.now().toString(36));
  const raw = join(VOICE_DIR, id + "_raw");
  const wav = join(VOICE_DIR, id + ".wav");
  writeFileSync(raw, Buffer.from(m[1], "base64"));
  // XTTS clones best from a clean ~mono 22.05kHz wav; cap length to keep it snappy
  try { execFileSync("ffmpeg", ["-y", "-i", raw, "-t", "25", "-ac", "1", "-ar", "22050", wav], { stdio: "ignore" }); }
  catch { try { unlinkSync(raw); } catch {}; return res.status(400).json({ error: "Couldn't read that audio file." }); }
  try { unlinkSync(raw); } catch {}
  res.json({ id, name, url: "/data/voices/" + id + ".wav" });
});
app.delete("/api/voices/:id", (req, res) => {
  const id = String(req.params.id).replace(/[^a-z0-9._-]/gi, "");
  const wav = join(VOICE_DIR, id + ".wav");
  if (existsSync(wav)) { try { unlinkSync(wav); } catch {} }
  if (getEnvValue("XTTS_VOICE") === "clone:" + id) setEnvValue("XTTS_VOICE", "");
  res.json({ ok: true });
});

// ---- Image Lab: generate one image from a prompt, local or cloud ----
async function falQueue(model, body) {
  const key = getEnvValue("FAL_KEY");
  if (!key) throw new Error("Add a fal.ai key in Settings.");
  const auth = { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  const s = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  if (!s.ok) throw new Error(`fal ${s.status}`);
  const j = await s.json();
  const statusUrl = j.status_url || `https://queue.fal.run/${model}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${model}/requests/${j.request_id}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    await new Promise((r) => setTimeout(r, 3000));
    const sd = await (await fetch(statusUrl, { headers: auth })).json();
    if (sd.status === "COMPLETED") break;
    if (sd.status === "FAILED" || sd.status === "ERROR") throw new Error("fal generation failed");
  }
  return (await fetch(respUrl, { headers: auth })).json();
}
// Generate one image and return its bytes. Shared by the Image Lab preview and
// the Comparison template. `source`: local | hf | fal-image | image(pollinations).
async function genImageBuffer({ source = "image", prompt, width, height }) {
  if (source === "local") {
    const url = getEnvValue("LOCAL_IMAGE_URL") || "http://localhost:7801/generate";
    const tc = tierConfig(getEnvValue("HW_TIER"));   // clamp to the Mac's tier ceiling
    const sc = Math.min(1, tc.image.maxDim / Math.max(width, height));
    const lw = Math.round((width * sc) / 8) * 8, lh = Math.round((height * sc) / 8) * 8;
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, width: lw, height: lh, steps: tc.image.steps }) });
    if (!r.ok) throw new Error("Local ComfyUI not reachable — turn Local engines ON.");
    return { buf: Buffer.from(await r.arrayBuffer()), ctype: r.headers.get("content-type") || "image/png" };
  }
  if (source === "hf") {
    const token = getEnvValue("HF_TOKEN"); if (!token) throw new Error("Add a Hugging Face token in Settings.");
    const sc = Math.min(1, 1440 / Math.max(width, height));
    const w = Math.round(width * sc / 8) * 8, h = Math.round(height * sc / 8) * 8;
    const r = await fetch("https://router.huggingface.co/fal-ai/fal-ai/flux/schnell", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }) });
    if (!r.ok) { if (r.status === 402) throw new Error("HF free credits used up this month."); throw new Error(`HF ${r.status}`); }
    const j = await r.json(); const u = j?.images?.[0]?.url || j?.image?.url || j?.url; if (!u) throw new Error("HF: no image");
    return { buf: Buffer.from(await (await fetch(u)).arrayBuffer()), ctype: "image/jpeg" };
  }
  if (source === "fal-image") {
    const rd = await falQueue("fal-ai/flux/schnell", { prompt, image_size: { width, height }, num_images: 1 });
    const u = rd?.images?.[0]?.url || rd?.image?.url || rd?.url; if (!u) throw new Error("fal: no image");
    return { buf: Buffer.from(await (await fetch(u)).arrayBuffer()), ctype: "image/jpeg" };
  }
  // pollinations (free, cloud, default)
  const seed = Math.floor(Math.random() * 1e6);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&model=flux&seed=${seed}`;
  const r = await fetch(url); if (!r.ok) throw new Error(`Pollinations ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), ctype: "image/jpeg" };
}
app.post("/api/image/preview", async (req, res) => {
  const b = req.body || {};
  const source = String(b.source || "image");
  const prompt = String(b.prompt || "").slice(0, 800).trim();
  if (!prompt) return res.status(400).json({ error: "Type a prompt to generate an image." });
  const { width, height } = dims(b.aspect || "9:16", b.quality || "1080");
  try {
    const { buf, ctype } = await genImageBuffer({ source, prompt, width, height });
    res.setHeader("Content-Type", ctype); res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Animate: turn one image into a short LTX video clip (local) ----
const CLIPS_DIR = join(DATA, "clips");
if (!existsSync(CLIPS_DIR)) mkdirSync(CLIPS_DIR, { recursive: true });
app.use("/data/clips", express.static(CLIPS_DIR));
app.get("/api/clips", (_req, res) => {
  const list = existsSync(CLIPS_DIR)
    ? readdirSync(CLIPS_DIR).filter((f) => f.endsWith(".mp4")).map((f) => ({ id: f.replace(/\.mp4$/, ""), url: "/data/clips/" + f }))
    : [];
  res.json(list.reverse());
});
app.post("/api/animate", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render or animation is already running. Please wait." });
  const b = req.body || {};
  if (!/^data:image\/[^;]+;base64,/.test(String(b.image || ""))) return res.status(400).json({ error: "Upload an image to animate." });
  const id = "clip-" + Date.now().toString(36);
  const clipUrl = "/data/clips/" + id + ".mp4";
  const animateUrl = (getEnvValue("LOCAL_IMAGE_URL") || "http://localhost:7801/generate").replace(/\/generate$/, "/animate");
  const vertical = (b.aspect || "9:16") === "9:16" || (b.aspect || "") === "4:5";
  busy = true;
  const job = newJob(1, "animate");
  res.json({ jobId: job.id, clipUrl });
  (async () => {
    try {
      // Match the clip to what this Mac can handle: the tier caps resolution,
      // clip length (seconds→frames) and — via the timer — how long we warn.
      const tc = tierConfig(getEnvValue("HW_TIER"));
      const cap = tc.video.maxDim;
      const long = Math.min(cap, cap >= 704 ? 704 : cap);       // long edge
      const shortEdge = Math.round((long * 480) / 768 / 8) * 8; // keep ~ same ratio
      const width = vertical ? shortEdge : long, height = vertical ? long : shortEdge;
      const maxFrames = Math.max(25, Math.round(tc.video.maxSeconds * tc.video.fps));
      const frames = Math.min(maxFrames, Math.max(25, parseInt(b.frames) || 49));
      pushLog(job, `🎬 Animating with ${tc.video.model} at ${width}×${height}, ${(frames / tc.video.fps).toFixed(1)}s (${tc.name} tier)…`);
      const r = await fetch(animateUrl, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: b.image, prompt: String(b.prompt || "gentle cinematic camera motion, subtle movement, high detail"), width, height, frames, steps: 12 }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `animate failed (${r.status}) — is ComfyUI/Local engines ON?`); }
      writeFileSync(join(CLIPS_DIR, id + ".mp4"), Buffer.from(await r.arrayBuffer()));
      pushLog(job, "✅ Done! Your clip is ready.");
      job.files = [clipUrl]; job.status = "done"; busy = false;
    } catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; busy = false; }
  })();
});

// ---- Comparison (split-screen) videos: e.g. Textbook vs Casual Japanese ----
// A recurring character per side + trilingual captions (native + romaji +
// English), each panel a still (fast) or a short AI clip (animate, slow).
const EDGE_VOICE = {
  japanese: "ja-JP-NanamiNeural", korean: "ko-KR-SunHiNeural", chinese: "zh-CN-XiaoxiaoNeural",
  spanish: "es-ES-ElviraNeural", french: "fr-FR-DeniseNeural", german: "de-DE-KatjaNeural",
  hindi: "hi-IN-SwaraNeural", italian: "it-IT-ElsaNeural", portuguese: "pt-BR-FranciscaNeural",
  russian: "ru-RU-SvetlanaNeural", arabic: "ar-SA-ZariyahNeural", english: "en-US-AriaNeural",
};
function ffprobeDur(p) {
  try { return parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", p]).toString().trim()) || 0; } catch { return 0; }
}
// pick the render command — prefer the machine's `npx remotion`, else run the
// Remotion CLI JS entry via our own Node runtime (packaged fresh Mac).
function remotionCmd(args) {
  try { execFileSync("/usr/bin/env", ["npx", "--version"], { stdio: "ignore" }); return { cmd: "npx", args: ["remotion", ...args], env: process.env }; } catch {}
  const cli = join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");
  return { cmd: process.execPath, args: [cli, ...args], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
}
async function genPanel(source, prompt, w, h, outPath) {
  let buf;
  try { ({ buf } = await genImageBuffer({ source, prompt, width: w, height: h })); }
  catch (e) { if (source !== "image") ({ buf } = await genImageBuffer({ source: "image", prompt, width: w, height: h })); else throw e; }
  const tmp = outPath + ".raw"; writeFileSync(tmp, buf);
  if (!toJpeg(tmp, outPath)) writeFileSync(outPath, buf);
  try { unlinkSync(tmp); } catch {}
}
app.post("/api/comparison", (req, res) => {
  if (busy) return res.status(409).json({ error: "A render is already running. Please wait." });
  const b = req.body || {};
  const language = String(b.language || "Japanese").trim() || "Japanese";
  const topic = String(b.topic || "").slice(0, 200).trim();
  const count = Math.min(10, Math.max(2, parseInt(b.count) || 6));
  const animate = !!b.animate;
  const source = String(b.source || "image");
  const leftLabel = String(b.leftLabel || `Textbook ${language}`).slice(0, 40).trim();
  const rightLabel = String(b.rightLabel || `Casual ${language}`).slice(0, 40).trim();
  const withVoice = b.voice !== false;
  const edgeVoice = EDGE_VOICE[language.toLowerCase()] || "en-US-AriaNeural";
  const animateUrl = (getEnvValue("LOCAL_IMAGE_URL") || "http://localhost:7801/generate").replace(/\/generate$/, "/animate");
  busy = true;
  const job = newJob(count, animate ? "animate" : "render");
  res.json({ jobId: job.id });
  (async () => {
    try {
      pushLog(job, `✍️ Writing a "${leftLabel} vs ${rightLabel}" script…`);
      const c = await generateComparison({ topic, language, count, leftLabel, rightLabel, llmProvider: getEnvValue("LLM_PROVIDER") });
      job.total = c.scenes.length;
      if (animate) pushLog(job, `⚠️ Animated mode makes 2 AI clips per scene (~5–8 min each on an M1). ${c.scenes.length} scenes → this can take a long time. Sit tight.`);
      const W = 720, H = 1280, genW = 832, genH = 1216;
      const tc = tierConfig(getEnvValue("HW_TIER"));
      const scenes = []; let cursor = 0; const parts = [];
      for (let i = 0; i < c.scenes.length; i++) {
        job.current = i + 1;
        const s = c.scenes[i];
        pushLog(job, `🎨 [${i + 1}/${c.scenes.length}] ${s.english} — generating panels…`);
        const lPrompt = `${c.leftCharacter}, ${s.moment}. ${leftLabel} vibe, cinematic photo, vertical portrait, sharp focus, highly detailed`;
        const rPrompt = `${c.rightCharacter}, ${s.moment}. ${rightLabel} vibe, cinematic photo, vertical portrait, sharp focus, highly detailed`;
        let leftMedia = `cmp_l${i}.jpg`, rightMedia = `cmp_r${i}.jpg`;
        await genPanel(source, lPrompt, genW, genH, join(PUBLIC, leftMedia));
        await genPanel(source, rPrompt, genW, genH, join(PUBLIC, rightMedia));
        if (animate) {
          const cap = Math.min(tc.video.maxDim, 704), longE = cap, shortE = Math.round((longE * 480) / 768 / 8) * 8;
          const frames = Math.min(Math.max(25, Math.round(tc.video.maxSeconds * tc.video.fps)), 49);
          for (const [imgFile, mp4File, tag] of [[leftMedia, `cmp_l${i}.mp4`, "left"], [rightMedia, `cmp_r${i}.mp4`, "right"]]) {
            try {
              pushLog(job, `🎬 [${i + 1}/${c.scenes.length}] animating ${tag} panel (LTX)…`);
              const b64 = readFileSync(join(PUBLIC, imgFile)).toString("base64");
              const r = await fetch(animateUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: `data:image/jpeg;base64,${b64}`, prompt: `${s.moment}, gentle natural motion, subtle movement`, width: shortE, height: longE, frames, steps: 12 }) });
              if (!r.ok) throw new Error(`animate ${r.status}`);
              writeFileSync(join(PUBLIC, mp4File), Buffer.from(await r.arrayBuffer()));
              if (tag === "left") leftMedia = mp4File; else rightMedia = mp4File;
            } catch (e) { pushLog(job, `↷ ${tag} clip skipped (${e.message}) — using the still.`); }
          }
        }
        // voiceover of the native phrase (drives the scene's length)
        let dur = 3.0;
        if (withVoice) {
          try {
            const mp3 = join(PUBLIC, `cmp_v${i}.mp3`);
            execFileSync("edge-tts", ["--voice", edgeVoice, "--text", s.native, "--write-media", mp3], { stdio: "ignore" });
            const d = ffprobeDur(mp3); if (d > 0.3) { dur = d + 0.9; parts[i] = mp3; }
          } catch { /* no edge-tts → silent, fixed length */ }
        }
        dur = Math.max(2.6, dur);
        scenes.push({ leftMedia, rightMedia, native: s.native, romaji: s.romaji, english: s.english, start: +cursor.toFixed(3), end: +(cursor + dur).toFixed(3) });
        cursor += dur;
      }
      // assemble one audio track: pad each phrase to its scene length, concat
      let audioFile = "";
      if (parts.some(Boolean)) {
        const padded = [];
        for (let i = 0; i < scenes.length; i++) {
          const d = (scenes[i].end - scenes[i].start).toFixed(3);
          const out = join(PUBLIC, `cmp_p${i}.mp3`);
          try {
            if (parts[i]) execFileSync("ffmpeg", ["-y", "-i", parts[i], "-af", `apad=whole_dur=${d}`, out], { stdio: "ignore" });
            else execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-t", d, "-i", "anullsrc=r=24000:cl=mono", out], { stdio: "ignore" });
            padded.push(out);
          } catch {}
        }
        if (padded.length === scenes.length) {
          const list = join(PUBLIC, "cmp_list.txt");
          writeFileSync(list, padded.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
          try { execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-q:a", "3", join(PUBLIC, "cmp_audio.mp3")], { stdio: "ignore" }); audioFile = "cmp_audio.mp3"; } catch {}
        }
      }
      const props = {
        fps: 30, width: W, height: H, durationInSeconds: Math.ceil(cursor) + 0.3,
        scenes, audio: audioFile, music: b.music ? "bg_calm.mp3" : "",
        leftLabel, rightLabel, leftEmoji: c.leftEmoji, rightEmoji: c.rightEmoji,
        watermark: String(b.watermark || "").slice(0, 40),
      };
      writeFileSync(join(PUBLIC, "comparison.json"), JSON.stringify(props, null, 2));
      const name = slugify(topic || `comparison ${language}`) || "comparison";
      const outName = `${name}.mp4`;
      pushLog(job, "🎬 Rendering the split-screen video…");
      await new Promise((resolve) => {
        const { cmd, args, env } = remotionCmd(["render", "Comparison", `out/${outName}`, "--props=public/comparison.json"]);
        const child = spawn(cmd, args, { cwd: ROOT, env });
        const onData = (d) => pushLog(job, d.toString());
        child.stdout.on("data", onData); child.stderr.on("data", onData);
        child.on("close", () => resolve());
      });
      if (existsSync(join(OUT, outName))) { job.files = [outName]; job.title = `${leftLabel} vs ${rightLabel}`; job.status = "done"; pushLog(job, "✅ Done!"); }
      else { job.status = "error"; pushLog(job, "❌ Render produced no file — see log."); }
      busy = false;
    } catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; busy = false; }
  })();
});

// ---- voice preview (Voice Lab): speak arbitrary text in any engine/voice ----
app.post("/api/voice/preview", async (req, res) => {
  const b = req.body || {};
  const engine = String(b.engine || "edge");
  const text = String(b.text || "").slice(0, 500).trim();
  const language = String(b.language || "en");
  const voice = String(b.voice || "");
  if (!text) return res.status(400).json({ error: "Type some text to preview." });
  const tmp = join(PUBLIC, "preview_" + Date.now().toString(36));
  try {
    if (engine === "kokoro") {
      const url = getEnvValue("KOKORO_URL") || "http://localhost:7880/generate";
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language, speaker: voice || undefined }) });
      if (!r.ok) throw new Error(`Kokoro not reachable — turn Local engines ON (or run setup-kokoro.sh).`);
      res.setHeader("Content-Type", "audio/wav"); return res.send(Buffer.from(await r.arrayBuffer()));
    }
    if (engine === "xtts") {
      const url = getEnvValue("XTTS_URL") || "http://localhost:7870/generate";
      const body = { text, language };
      if (voice.startsWith("clone:")) { const p = join(VOICE_DIR, voice.slice(6) + ".wav"); if (existsSync(p)) body.speaker_wav = p; }
      else if (voice.startsWith("builtin:")) body.speaker = voice.slice(8);
      else if (voice) body.speaker = voice;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`XTTS not reachable — turn Local engines ON.`);
      res.setHeader("Content-Type", "audio/wav"); return res.send(Buffer.from(await r.arrayBuffer()));
    }
    if (engine === "piper") {
      const py = getEnvValue("PIPER_PYTHON"), model = voice || getEnvValue("PIPER_MODEL");
      if (!py || !model) throw new Error("Piper isn't set up in Settings.");
      const wav = tmp + ".wav";
      execFileSync(py, ["-m", "piper", "-m", model, "-f", wav], { input: text });
      const buf = readFileSync(wav); try { unlinkSync(wav); } catch {}
      res.setHeader("Content-Type", "audio/wav"); return res.send(buf);
    }
    if (engine === "eleven") {
      const key = getEnvValue("ELEVEN_API_KEY");
      if (!key) throw new Error("Add an ElevenLabs API key in Settings.");
      const vid = voice || getEnvValue("ELEVEN_VOICE") || "21m00Tcm4TlvDq8ikWAM";
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
        method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true } }),
      });
      if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 120)}`);
      res.setHeader("Content-Type", "audio/mpeg"); return res.send(Buffer.from(await r.arrayBuffer()));
    }
    // edge (cloud, default)
    const mp3 = tmp + ".mp3";
    execFileSync("edge-tts", ["--voice", voice || "en-US-AriaNeural", "--text", text, "--write-media", mp3], { stdio: "ignore" });
    const buf = readFileSync(mp3); try { unlinkSync(mp3); } catch {}
    res.setHeader("Content-Type", "audio/mpeg"); return res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message || "Preview failed." }); }
});

// ---- engine health + one-click local-server start ----
async function portUp(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 2500);
    await fetch(url, { signal: c.signal });   // any HTTP response (even 404) = server is up
    clearTimeout(t);
    return true;
  } catch { return false; }
}
app.get("/api/health", async (_req, res) => {
  const xttsUrl = (getEnvValue("XTTS_URL") || "http://localhost:7870/generate").replace(/\/generate$/, "/");
  const kokUrl = (getEnvValue("KOKORO_URL") || "http://localhost:7880/generate").replace(/\/generate$/, "/health");
  const localImg = (getEnvValue("LOCAL_IMAGE_URL") || "http://localhost:7801/generate").replace(/\/generate$/, "/health");
  const ollama = (getEnvValue("OLLAMA_URL") || "http://localhost:11434") + "/api/tags";
  const [xtts, kokoro, comfy, llm] = await Promise.all([portUp(xttsUrl), portUp(kokUrl), portUp(localImg), portUp(ollama)]);
  res.json({ xtts, kokoro, comfy, ollama: llm });
});

// ---- hardware scan + tier (adapts the app to whatever Mac it's on) ----
app.get("/api/hardware", (req, res) => {
  const hw = detectHardware({ fresh: req.query.fresh === "1" });
  const override = getEnvValue("HW_TIER") || "";
  const active = tierConfig(override);
  // downloads follow the ACTIVE tier (what you'll actually run), so a manual
  // override shows the models that override needs — not the auto-detected set.
  res.json({ ...hw, override, activeTier: active, auto: !override, downloads: downloadPlan(active.id) });
});
app.post("/api/hardware/tier", (req, res) => {
  const t = String((req.body || {}).tier || "");
  const valid = ["", "auto", "lite", "standard", "pro", "ultra"];
  if (!valid.includes(t)) return res.status(400).json({ error: "unknown tier" });
  setEnvValue("HW_TIER", t === "auto" ? "" : t);   // empty = follow the auto scan
  const override = getEnvValue("HW_TIER") || "";
  res.json({ ok: true, override, activeTier: tierConfig(override), auto: !override });
});

// ---- one-click model installer (pulls the tier's recommended models) ----
function approxGB(sizes) {
  const n = sizes.reduce((a, s) => a + (parseFloat(s) || 0), 0);
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}
app.get("/api/models/plan", (_req, res) => {
  const active = tierConfig(getEnvValue("HW_TIER"));
  const plan = installPlan(active.id);
  const missing = plan.steps.filter((s) => s.auto && !s.satisfied);
  res.json({ ...plan, tierName: active.name, missingGB: approxGB(missing.map((s) => s.size)), textTag: active.text.tag || "" });
});
let installing = false;
// runs one install step (ollama pull / setup script), streaming output to the job log
function runStep(job, cmd, args) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.PORT; delete env.ELECTRON_RUN_AS_NODE; delete env.SHORTS_DESKTOP;
    const child = spawn(cmd, args, { cwd: ROOT, env });
    const onData = (d) => pushLog(job, d.toString());
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => { pushLog(job, "❌ " + e.message); resolve(1); });
    child.on("close", (code) => resolve(code));
  });
}
app.post("/api/models/install", (_req, res) => {
  if (installing) return res.status(409).json({ error: "An install is already running." });
  const active = tierConfig(getEnvValue("HW_TIER"));
  const plan = installPlan(active.id);
  const steps = plan.steps.filter((s) => s.auto && !s.satisfied);
  const job = newJob(Math.max(1, steps.length), "install");
  res.json({ jobId: job.id, count: steps.length, manual: plan.steps.filter((s) => s.kind === "manual") });
  installing = true;
  (async () => {
    try {
      if (!steps.length) { pushLog(job, "✅ Everything for the " + active.name + " tier is already installed."); job.status = "done"; installing = false; return; }
      pushLog(job, `📦 Installing ${steps.length} model set(s) for the ${active.name} tier. Large downloads — keep this open; it resumes if interrupted.`);
      let failed = 0;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]; job.current = i + 1;
        pushLog(job, `\n===== ${i + 1}/${steps.length}: ${s.label} (${s.size}) =====`);
        const c = installCommand(s, ROOT);
        if (!c) { pushLog(job, "↷ Skipped (manual install)."); continue; }
        const code = await runStep(job, c.cmd, c.args);
        if (code === 0) pushLog(job, `✅ ${s.label} ready.`);
        else { failed++; pushLog(job, `⚠️ ${s.label} did not finish (exit ${code}). You can re-run — downloads resume.`); }
      }
      // If the tier's recommended LLM is now available, point the app at it
      // (model only — we don't override a cloud provider choice).
      const tag = active.text.tag;
      if (tag) {
        const now = installPlan(active.id).steps.find((x) => x.tag === tag);
        if (now && now.satisfied) { setEnvValue("OLLAMA_MODEL", tag); pushLog(job, `⚙︎ Set your local Script AI model to ${tag}.`); }
      }
      pushLog(job, failed ? `\nDone with ${failed} item(s) to retry.` : `\n🎉 All set! Turn Local engines ON to use them.`);
      job.status = failed && failed === steps.length ? "error" : "done";
    } catch (e) { pushLog(job, "❌ " + e.message); job.status = "error"; }
    installing = false;
  })();
});
let startingServers = false;
app.post("/api/servers/start", (_req, res) => {
  const script = join(ROOT, "start-local-servers.command");
  if (!existsSync(script)) return res.status(404).json({ error: "launcher script missing" });
  if (startingServers) return res.json({ ok: true, already: true });
  startingServers = true;
  setTimeout(() => { startingServers = false; }, 90000);
  try {
    // Strip PORT (the web server's 4321) and Electron flags so the launched
    // XTTS/ComfyUI servers use THEIR own default ports (7870/7801/8188), not 4321.
    const env = { ...process.env };
    delete env.PORT; delete env.ELECTRON_RUN_AS_NODE; delete env.SHORTS_DESKTOP;
    const p = spawn("bash", [script], { cwd: ROOT, detached: true, stdio: "ignore", env });
    p.unref();
    res.json({ ok: true });
  } catch (e) { startingServers = false; res.status(500).json({ error: e.message }); }
});
app.post("/api/servers/stop", (_req, res) => {
  // force-kill immediately (SIGKILL) so OFF is instant — no graceful torch teardown
  for (const port of [7870, 7880, 7801, 8188]) {
    try {
      const pids = execFileSync("lsof", ["-ti:" + port]).toString().trim().split(/\s+/).filter(Boolean);
      if (pids.length) execFileSync("kill", ["-9", ...pids]);
    } catch {}
  }
  for (const pat of ["xtts_server.py", "kokoro_server.py", "main.py --port 8188", "comfy-adapter.mjs", "start-xtts.command", "start-kokoro.command", "start-comfy.command"]) {
    try { execFileSync("pkill", ["-9", "-f", pat]); } catch {}
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🎬 Shorts Studio running at ${url}\n`);
  // Don't pop a browser tab when we're the engine inside the desktop app.
  const inDesktop = process.env.SHORTS_DESKTOP === "1" || process.env.ELECTRON_RUN_AS_NODE === "1";
  if (!inDesktop) open(url).catch(() => {});
});
