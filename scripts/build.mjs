// Build step: edge-tts voiceover -> Pexels stock download -> caption timings -> props.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateTalkingVideo, avatarProviderName } from "./avatar.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");
const FPS = 30;

// --- load .env (simple parser, no deps) ---
function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const PEXELS_KEY = process.env.PEXELS_API_KEY;
if (!PEXELS_KEY) {
  console.error("Missing PEXELS_API_KEY in .env");
  process.exit(1);
}

if (!existsSync(PUBLIC)) mkdirSync(PUBLIC, { recursive: true });

const config = JSON.parse(readFileSync(join(ROOT, "scenes.json"), "utf8"));
const voice = config.voice || "en-US-GuyNeural";
const fullText = config.scenes.map((s) => s.text).join(" ");

// --- 1. Voiceover + word-level timings (edge-tts cloud, or Piper offline) ---
const audioPath = join(PUBLIC, "voiceover.mp3");
const vttPath = join(PUBLIC, "subs.vtt");
const words = [];
const engine = config.voiceEngine || "edge";
// resolve the Piper voice: an explicitly chosen voice (from PIPER_DIR) wins, else PIPER_MODEL
const piperDir = process.env.PIPER_DIR || (process.env.PIPER_MODEL ? dirname(process.env.PIPER_MODEL) : "");
const piperModel = config.piperVoice && piperDir ? join(piperDir, config.piperVoice) : process.env.PIPER_MODEL;

// audio-only engines (piper/xtts/eleven) have no word timings — approximate them
// from the measured duration, weighted by word length (fine for karaoke captions).
function approxTimings() {
  let dur = 0;
  try { dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", audioPath]).toString().trim()); } catch {}
  const wlist = fullText.split(/\s+/).filter(Boolean);
  if (!dur) dur = Math.max(2, wlist.length * 0.35);
  const weights = wlist.map((w) => w.replace(/[^A-Za-z0-9]/g, "").length + 1);
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  wlist.forEach((w, i) => { const d = (dur * weights[i]) / totalW; words.push({ text: w, start: t, end: t + d }); t += d; });
  console.log(`📝 ${words.length} words (approx timings) over ${dur.toFixed(2)}s`);
}
const toMp3From = (wav) => execFileSync("ffmpeg", ["-y", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "2", audioPath], { stdio: "ignore" });

// Language support: fall back to edge-tts (34 langs) when the chosen offline engine
// can't speak the selected language — otherwise it produces broken/runaway audio.
const langCode = String(config.langCode || "en").toLowerCase();
const XTTS_LANGS = new Set(["en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "ja", "hu", "ko", "hi"]);
const piperLocaleOk = piperModel ? piperModel.split("/").pop().toLowerCase().startsWith(langCode + "_") : false;
let engineEff = engine;
if (engine === "piper" && !piperLocaleOk) { console.log(`⚠️  No Piper voice for "${langCode}" — using edge-tts instead.`); engineEff = "edge"; }
if (engine === "xtts" && !XTTS_LANGS.has(langCode)) { console.log(`⚠️  XTTS-v2 can't speak "${langCode}" — using edge-tts instead.`); engineEff = "edge"; }

const usePiper = engineEff === "piper" && piperModel && existsSync(piperModel) && process.env.PIPER_PYTHON;
const useXtts = engineEff === "xtts" && process.env.XTTS_URL;
const useEleven = engineEff === "eleven" && process.env.ELEVEN_API_KEY;

if (usePiper) {
  console.log(`🎙️  Voiceover: Piper (offline) — ${piperModel.split("/").pop()}...`);
  const wav = join(PUBLIC, "voiceover.wav");
  const piperArgs = ["-m", "piper", "-m", piperModel, "-f", wav];
  if (config.piperLength) piperArgs.push("--length-scale", String(config.piperLength)); // pace for emotion (higher=slower)
  execFileSync(process.env.PIPER_PYTHON, piperArgs, { input: fullText });
  toMp3From(wav);
  approxTimings();
} else if (useXtts) {
  // Expressive, offline XTTS-v2 via a local voice server (see local-voice-server/)
  console.log(`🎙️  Voiceover: XTTS-v2 (offline, expressive) — ${process.env.XTTS_URL}...`);
  const body = { text: fullText, language: langCode === "zh" ? "zh-cn" : langCode };
  if (config.xttsSpeaker) body.speaker = config.xttsSpeaker;
  const r = await fetch(process.env.XTTS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`XTTS server ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const wav = join(PUBLIC, "voiceover.wav");
  writeFileSync(wav, Buffer.from(await r.arrayBuffer()));
  toMp3From(wav);
  approxTimings();
} else if (useEleven) {
  // Expressive cloud voices with emotion (ElevenLabs)
  console.log("🎙️  Voiceover: ElevenLabs (cloud, expressive)...");
  const vid = config.elevenVoice || process.env.ELEVEN_VOICE || "21m00Tcm4TlvDq8ikWAM";
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVEN_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: fullText, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.6, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 160)}`);
  writeFileSync(audioPath, Buffer.from(await r.arrayBuffer()));
  approxTimings();
} else {
  console.log("🎙️  Generating voiceover with edge-tts...");
  const ttsArgs = ["--voice", voice, "--text", fullText, "--write-media", audioPath, "--write-subtitles", vttPath];
  // edge-tts requires a leading +/- sign; auto-add it so "0%" / "10%" also work.
  const signed = (v) => (/^[+-]/.test(String(v).trim()) ? String(v).trim() : "+" + String(v).trim());
  if (config.rate) ttsArgs.push("--rate", signed(config.rate)); // e.g. "-10%" slower, "+10%" faster
  if (config.pitch) ttsArgs.push("--pitch", signed(config.pitch)); // e.g. "-5Hz"
  execFileSync("edge-tts", ttsArgs, { stdio: "inherit" });
  // parse VTT into word-level timings
  const vttTimeToSec = (t) => { const p = t.trim().replace(",", ".").split(":").map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const vtt = readFileSync(vttPath, "utf8");
  const cues = [];
  for (const b of vtt.replace(/\r/g, "").split("\n\n")) {
    const line = b.split("\n").find((l) => l.includes("-->"));
    if (!line) continue;
    const [s, e] = line.split("-->").map((x) => vttTimeToSec(x));
    const textLines = b.split("\n").filter((l) => l && !l.includes("-->") && l !== "WEBVTT" && !/^\d+$/.test(l.trim()));
    const text = textLines.join(" ").trim();
    if (text) cues.push({ start: s, end: e, text });
  }
  for (const c of cues) {
    const ws = c.text.split(/\s+/).filter(Boolean);
    const dur = (c.end - c.start) / ws.length;
    ws.forEach((w, i) => words.push({ text: w, start: c.start + i * dur, end: c.start + (i + 1) * dur }));
  }
  console.log(`📝 Parsed ${words.length} words across ${cues.length} cues`);
}

// --- 3. Total duration from ffprobe ---
let durationSec;
try {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
  ]).toString().trim();
  durationSec = parseFloat(out);
} catch {
  durationSec = words.length ? words[words.length - 1].end + 0.5 : 10;
}
durationSec = Math.max(durationSec, words.length ? words[words.length - 1].end : 1) + 0.4;
// safety net: a broken TTS (e.g. wrong language) can emit runaway audio. Cap the
// composition so Remotion never tries to render an absurdly long video and crash.
const expectedSec = Math.max(30, words.length * 1.0);
const HARD_CAP = 20 * 60;
if (durationSec > HARD_CAP || durationSec > expectedSec * 4) {
  const capped = Math.min(HARD_CAP, Math.max(60, expectedSec * 2));
  console.log(`⚠️  Voiceover is ${(durationSec / 60).toFixed(1)} min but ~${(expectedSec / 60).toFixed(1)} min was expected — capping to ${(capped / 60).toFixed(1)} min (likely a TTS/language mismatch).`);
  durationSec = capped;
}
console.log(`⏱️  Voiceover duration: ${durationSec.toFixed(2)}s`);

// --- 4. Map scene time ranges by counting words ---
function wordCount(t) {
  return t.split(/\s+/).filter(Boolean).length;
}
const sceneRanges = [];
let idx = 0;
for (const s of config.scenes) {
  const n = wordCount(s.text);
  const first = words[Math.min(idx, words.length - 1)];
  const last = words[Math.min(idx + n - 1, words.length - 1)];
  sceneRanges.push({ start: first ? first.start : 0, end: last ? last.end : durationSec });
  idx += n;
}
// stretch last scene end to full duration
if (sceneRanges.length) sceneRanges[sceneRanges.length - 1].end = durationSec;

// --- 5. Download one Pexels video per scene (orientation matches output) ---
const OUT_W = config.width || 1080;
const OUT_H = config.height || 1920;
const wantOrientation = OUT_W > OUT_H ? "landscape" : OUT_W < OUT_H ? "portrait" : "square";
// prefer files whose orientation matches; target width ~ the larger output dimension
const targetW = Math.max(OUT_W, OUT_H);
const matchesOrientation = (f) => {
  if (!f.width || !f.height) return false;
  if (wantOrientation === "landscape") return f.width > f.height;
  if (wantOrientation === "portrait") return f.height > f.width;
  return Math.abs(f.width - f.height) < Math.min(f.width, f.height) * 0.15; // ~square
};
async function pexelsVideo(query, outFile) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    query
  )}&orientation=${wantOrientation}&size=medium&per_page=10`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
  if (!res.ok) throw new Error(`Pexels ${res.status} for "${query}"`);
  const data = await res.json();
  if (!data.videos || !data.videos.length) throw new Error(`No Pexels results for "${query}"`);
  // pick the first video that has a matching-orientation file near target resolution
  let best = null;
  for (const v of data.videos) {
    for (const f of v.video_files) {
      if (!matchesOrientation(f)) continue;
      const score = Math.abs((Math.max(f.width, f.height) || 0) - targetW);
      if (!best || score < best.score) best = { link: f.link, score, w: f.width, h: f.height };
    }
    if (best) break; // first video with a usable file
  }
  if (!best) {
    // fallback: any file from first video (largest)
    const f = data.videos[0].video_files.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    best = { link: f.link, w: f.width, h: f.height };
  }
  const vr = await fetch(best.link);
  const buf = Buffer.from(await vr.arrayBuffer());
  writeFileSync(outFile, buf);
  return best;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visualPrompt = (scene, dflt) =>
  `${scene.imagePrompt || scene.query}. ${config.imageStyle || dflt}. Tasteful, safe for work.`;

// --- fal.ai shared queue runner ---
function falAspect() {
  if (OUT_W > OUT_H) return "16:9";
  if (OUT_W < OUT_H) return OUT_H / OUT_W >= 1.5 ? "9:16" : "3:4";
  return "1:1";
}
async function falRun(model, body) {
  const auth = { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
  const submit = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  if (!submit.ok) throw new Error(`fal submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
  const j = await submit.json();
  const statusUrl = j.status_url || `https://queue.fal.run/${model}/requests/${j.request_id}/status`;
  const respUrl = j.response_url || `https://queue.fal.run/${model}/requests/${j.request_id}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 6 * 60 * 1000) {
    await sleep(4000);
    const sd = await (await fetch(statusUrl, { headers: auth })).json();
    if (sd.status === "COMPLETED") break;
    if (sd.status === "FAILED" || sd.status === "ERROR") throw new Error("fal generation failed");
  }
  return (await fetch(respUrl, { headers: auth })).json();
}
async function download(url, outFile) {
  writeFileSync(outFile, Buffer.from(await (await fetch(url)).arrayBuffer()));
}
// AI VIDEO (Seedance / Veo / Kling)
async function falVideo(scene, outFile) {
  const model = config.videoModel || "fal-ai/bytedance/seedance/v1/lite/text-to-video";
  const rd = await falRun(model, { prompt: visualPrompt(scene, "cinematic, high quality") + " smooth natural motion.", aspect_ratio: falAspect(), duration: "5" });
  const url = rd?.video?.url || rd?.output?.url || rd?.videos?.[0]?.url || rd?.url || (typeof rd?.video === "string" ? rd.video : null);
  if (!url) throw new Error("fal: no video URL in response");
  await download(url, outFile);
  return { w: OUT_W, h: OUT_H };
}
// AI IMAGE via fal.ai (Flux) — paid, best quality
async function falImage(scene, outFile) {
  const model = (config.videoModel && config.videoModel.includes("flux")) ? config.videoModel : "fal-ai/flux/schnell";
  const rd = await falRun(model, { prompt: visualPrompt(scene, "cinematic, highly detailed"), image_size: { width: OUT_W, height: OUT_H }, num_images: 1 });
  const url = rd?.images?.[0]?.url || rd?.image?.url || rd?.url;
  if (!url) throw new Error("fal: no image URL in response");
  await download(url, outFile);
  return { w: OUT_W, h: OUT_H };
}
// AI IMAGE via Hugging Face Inference Providers (FLUX through fal) — free monthly credits
async function hfImage(scene, outFile) {
  const token = process.env.HF_TOKEN;
  const model = config.hfModel || "fal-ai/flux/schnell";
  const prompt = visualPrompt(scene, "cinematic, highly detailed, dramatic lighting");
  // fal caps the long side; scale request down to <=1440 (composition covers the rest)
  const scale = Math.min(1, 1440 / Math.max(OUT_W, OUT_H));
  const w = Math.round((OUT_W * scale) / 8) * 8;
  const h = Math.round((OUT_H * scale) / 8) * 8;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://router.huggingface.co/fal-ai/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }),
    });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 402) throw new Error("HF free credits used up for this month. Switch source to Pollinations (free) or fal.ai/HF-PRO (paid).");
      if (r.status === 401 || r.status === 403) throw new Error("HF token rejected — check it in Settings (needs Inference permission).");
      if ((r.status === 503 || r.status === 429) && a < 3) { await sleep(7000); continue; }
      if (a < 3) { await sleep(4000); continue; }
      throw new Error(`HF ${r.status}: ${t.slice(0, 160)}`);
    }
    const j = await r.json();
    const url = j?.images?.[0]?.url || j?.image?.url || j?.url;
    if (!url) { if (a < 3) { await sleep(4000); continue; } throw new Error("HF: no image URL in response"); }
    await download(url, outFile);
    return { w: OUT_W, h: OUT_H };
  }
  throw new Error("HF image failed after retries");
}

// AI IMAGE via a LOCAL generator (free, unlimited) — you run an image server on your Mac
async function localImage(scene, outFile) {
  const url = process.env.LOCAL_IMAGE_URL || "http://localhost:7801/generate";
  const prompt = visualPrompt(scene, "cinematic, highly detailed");
  let r;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, width: OUT_W, height: OUT_H }) });
  } catch (e) { throw new Error(`Local image server not reachable at ${url} — is it running? (${e.message})`); }
  if (!r.ok) throw new Error(`Local ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const ct = r.headers.get("content-type") || "";
  if (ct.startsWith("image/")) { writeFileSync(outFile, Buffer.from(await r.arrayBuffer())); return { w: OUT_W, h: OUT_H }; }
  const j = await r.json();
  const cand = j.image || j.url || (Array.isArray(j.images) ? j.images[0] : null);
  if (!cand) throw new Error("Local server: no image in response");
  if (/^https?:/.test(cand)) { await download(cand, outFile); return { w: OUT_W, h: OUT_H }; }
  writeFileSync(outFile, Buffer.from(String(cand).replace(/^data:image\/\w+;base64,/, ""), "base64"));
  return { w: OUT_W, h: OUT_H };
}

// --- AI images via Pollinations.ai (free, no key) ---
async function pollImage(scene, outFile) {
  const prompt = visualPrompt(scene, "cinematic, highly detailed, dramatic lighting, digital painting");
  const seed = Math.floor(Math.random() * 1e6);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${OUT_W}&height=${OUT_H}&nologo=true&model=flux&seed=${seed}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000) throw new Error("empty image");
      writeFileSync(outFile, buf);
      return { w: OUT_W, h: OUT_H };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// use the user's uploaded image/video as the visual for every scene
async function uploadMedia(_scene, outFile) {
  if (!config.uploadFile || !existsSync(config.uploadFile)) throw new Error("uploaded media file missing");
  copyFileSync(config.uploadFile, outFile);
  return { w: OUT_W, h: OUT_H };
}

const src = config.source || "pexels";
const GEN = {
  pexels: (s, f) => pexelsVideo(s.query, f),
  image: pollImage,
  hf: hfImage,
  local: localImage,
  "fal-image": falImage,
  fal: falVideo,
};
const TAG = { pexels: "🎬 Pexels", image: "🎨 Pollinations", hf: "🎨 HuggingFace", local: "🎨 Local", "fal-image": "🎨 fal image", fal: "🤖 fal video", upload: "🖼️ Your product" };
const IMG_SOURCES = new Set(["image", "hf", "local", "fal-image"]);
const srcIsImage = (s) => IMG_SOURCES.has(s);
// key checks for the base (fallback) source
if ((src === "fal" || src === "fal-image") && !process.env.FAL_KEY) {
  console.error("❌ This source needs a fal.ai key (FAL_KEY). Add it in Settings.");
  process.exit(1);
}
if (src === "hf" && !process.env.HF_TOKEN) {
  console.error("❌ Hugging Face source needs a free token (HF_TOKEN). Add it in Settings.");
  process.exit(1);
}

// when a product image/clip was uploaded, feature it PROMINENTLY across the ad:
// keep scene 0 as the hook, then show the product on ~every other scene (and always
// the last), merging with any scenes the script already flagged. Ensures the user's
// image is clearly the star, not a 2-second cameo.
if (config.uploadFile) {
  const n = config.scenes.length;
  const flagged = config.scenes.filter((s) => s.showProduct).length;
  if (flagged < Math.ceil(n / 2)) {
    config.scenes.forEach((s, i) => {
      if (i > 0 && (i % 2 === 1 || i === n - 1)) s.showProduct = true;
    });
    if (n === 1) config.scenes[0].showProduct = true;
  }
}

// "reuse visuals" mode: generate only N unique clips and cycle them across all
// scenes — makes long (and offline-AI-image) videos far faster. Off for product ads.
const reuseN = Math.max(0, parseInt(config.reuseVisuals) || 0);
const doReuse = reuseN >= 2 && reuseN < config.scenes.length && !config.uploadFile;
if (doReuse) console.log(`♻️  Reuse mode: ${reuseN} unique visuals across ${config.scenes.length} scenes`);
const sceneOut = [];
for (let i = 0; i < config.scenes.length; i++) {
  const useUpload = !!config.uploadFile && !!config.scenes[i].showProduct;
  const isImg = useUpload ? !!config.uploadIsImage : srcIsImage(src);
  const slot = doReuse ? (i % reuseN) : i;
  const file = `scene${slot}.${isImg ? "jpg" : "mp4"}`;
  const needGen = !doReuse || i < reuseN;
  if (needGen) {
    const gen = useUpload ? uploadMedia : (GEN[src] || GEN.pexels);
    process.stdout.write(`${useUpload ? TAG.upload : (TAG[src] || "🎬")} [${i + 1}/${config.scenes.length}] "${config.scenes[i].query}" ... `);
    try {
      const b = await gen(config.scenes[i], join(PUBLIC, file));
      console.log(`ok (${b.w}x${b.h})`);
    } catch (e) {
      console.log("FAILED:", e.message);
      process.exit(1);
    }
  } else {
    console.log(`♻️  [${i + 1}/${config.scenes.length}] reusing ${file}`);
  }
  sceneOut.push({ video: file, start: sceneRanges[i].start, end: sceneRanges[i].end });
}

// --- 5b. Talking avatar: bring the creator photo to life (photo + voiceover -> talking clip) ---
let talkingVideo = "";
let talkingSeconds = 0;
if (config.talkingAvatar && config.uploadFile && existsSync(config.uploadFile) && avatarProviderName()) {
  try {
    const ok = await generateTalkingVideo({
      photoPath: config.uploadFile, audioPath, scriptText: fullText,
      voice, width: config.width || 1080, height: config.height || 1920,
      outFile: join(PUBLIC, "talking.mp4"), log: (m) => console.log(m),
    });
    if (ok) {
      talkingVideo = "talking.mp4";
      // the talking clip has its own length (esp. D-ID/HeyGen TTS) — match the
      // composition to it so the video doesn't freeze on the last frame or get cut.
      try {
        const d = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", join(PUBLIC, "talking.mp4")]).toString().trim());
        if (d > 0.5) { talkingSeconds = d; }
      } catch {}
      console.log("✅ Talking creator generated.");
    }
  } catch (e) {
    console.log("⚠️  Talking avatar failed (" + e.message + ") — falling back to the still photo.");
  }
} else if (config.talkingAvatar && !avatarProviderName()) {
  console.log("⚠️  Talking avatar requested but no avatar API key set — using the still photo. Add a fal.ai / D-ID / HeyGen key in Settings.");
}

// --- 5c. Background music: procedural ambient bed by mood (royalty-free, offline) ---
// Beds sit in the AUDIBLE band (highpass removes sub-bass that phone/laptop
// speakers can't reproduce) so the music is actually heard, not felt.
const MOOD_FILTERS = {
  scary: { inputs: ["sine=frequency=110:duration=20", "sine=frequency=146.83:duration=20", "sine=frequency=220:duration=20", "anoisesrc=d=20:c=pink:a=0.05"], filter: "amix=inputs=4:normalize=0,tremolo=f=0.12:d=0.5,aecho=0.8:0.85:800:0.3,highpass=f=90,lowpass=f=2200,volume=2.0" },
  calm: { inputs: ["sine=frequency=220:duration=20", "sine=frequency=329.63:duration=20", "sine=frequency=440:duration=20"], filter: "amix=inputs=3:normalize=0,tremolo=f=0.08:d=0.4,aecho=0.8:0.9:1200:0.3,highpass=f=120,lowpass=f=1800,volume=1.6" },
  uplifting: { inputs: ["sine=frequency=261.63:duration=20", "sine=frequency=329.63:duration=20", "sine=frequency=392:duration=20", "sine=frequency=523.25:duration=20"], filter: "amix=inputs=4:normalize=0,tremolo=f=0.1:d=0.3,aecho=0.8:0.9:600:0.25,highpass=f=140,lowpass=f=3200,volume=1.5" },
  neutral: { inputs: ["sine=frequency=220:duration=20", "sine=frequency=329.63:duration=20"], filter: "amix=inputs=2:normalize=0,tremolo=f=0.06:d=0.3,aecho=0.8:0.9:1000:0.25,highpass=f=120,lowpass=f=1600,volume=1.6" },
};
function ensureMoodBed(mood) {
  const m = MOOD_FILTERS[mood];
  if (!m) return "";
  const file = `bg_${mood}.mp3`;
  const out = join(PUBLIC, file);
  if (!existsSync(out)) {
    const args = ["-y"];
    m.inputs.forEach((i) => args.push("-f", "lavfi", "-i", i));
    const labels = m.inputs.map((_, k) => `[${k}]`).join("");
    args.push("-filter_complex", labels + m.filter, "-ac", "2", "-q:a", "4", out);
    try { execFileSync("ffmpeg", args, { stdio: "ignore" }); } catch { return ""; }
  }
  return existsSync(out) ? file : "";
}
const musicFile = config.musicMood ? ensureMoodBed(config.musicMood) : (config.music || "");
if (config.musicMood && musicFile) console.log(`🎵 Background music: ${config.musicMood}`);

// --- 6. Write props.json ---
const props = {
  fps: FPS,
  width: config.width || 1080,
  height: config.height || 1920,
  font: config.font || "Arial Black",
  fontCss: config.fontCss || "",
  rtl: !!config.rtl,
  watermark: config.watermark || "",
  watermarkImage: config.watermarkImage || "",
  captionPos: config.captionPos || "bottom",
  motion: config.motion || "in",
  talkingVideo,
  durationInSeconds: talkingSeconds || durationSec,
  audio: "voiceover.mp3",
  music: musicFile,
  title: config.title || "",
  scenes: sceneOut,
  words,
};
writeFileSync(join(PUBLIC, "props.json"), JSON.stringify(props, null, 2));
console.log(`✅ Wrote public/props.json — ${sceneOut.length} scenes, ${durationSec.toFixed(1)}s`);
console.log("➡️  Now run:  npm run render");
