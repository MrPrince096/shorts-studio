// Build step: edge-tts voiceover -> Pexels stock download -> caption timings -> props.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

// --- 1. Voiceover + word-level subtitles via edge-tts ---
const audioPath = join(PUBLIC, "voiceover.mp3");
const vttPath = join(PUBLIC, "subs.vtt");
console.log("🎙️  Generating voiceover with edge-tts...");
const ttsArgs = ["--voice", voice, "--text", fullText, "--write-media", audioPath, "--write-subtitles", vttPath];
// edge-tts requires a leading +/- sign; auto-add it so "0%" / "10%" also work.
const signed = (v) => (/^[+-]/.test(String(v).trim()) ? String(v).trim() : "+" + String(v).trim());
if (config.rate) ttsArgs.push("--rate", signed(config.rate)); // e.g. "-10%" slower, "+10%" faster
if (config.pitch) ttsArgs.push("--pitch", signed(config.pitch)); // e.g. "-5Hz"
execFileSync("edge-tts", ttsArgs, { stdio: "inherit" });

// --- 2. Parse VTT into word-level timings ---
function vttTimeToSec(t) {
  // handle SRT (HH:MM:SS,mmm) and VTT (HH:MM:SS.mmm or MM:SS.mmm)
  const parts = t.trim().replace(",", ".").split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}
const vtt = readFileSync(vttPath, "utf8");
const cues = [];
const blocks = vtt.replace(/\r/g, "").split("\n\n");
for (const b of blocks) {
  const line = b.split("\n").find((l) => l.includes("-->"));
  if (!line) continue;
  const [s, e] = line.split("-->").map((x) => vttTimeToSec(x));
  const textLines = b
    .split("\n")
    .filter((l) => l && !l.includes("-->") && l !== "WEBVTT" && !/^\d+$/.test(l.trim()));
  const text = textLines.join(" ").trim();
  if (text) cues.push({ start: s, end: e, text });
}
// Expand each cue into words with evenly distributed timing
const words = [];
for (const c of cues) {
  const ws = c.text.split(/\s+/).filter(Boolean);
  const dur = (c.end - c.start) / ws.length;
  ws.forEach((w, i) => {
    words.push({ text: w, start: c.start + i * dur, end: c.start + (i + 1) * dur });
  });
}
console.log(`📝 Parsed ${words.length} words across ${cues.length} cues`);

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
// AI IMAGE via Hugging Face (FLUX.1-schnell) — free with a free token
async function hfImage(scene, outFile) {
  const token = process.env.HF_TOKEN;
  const model = config.hfModel || "black-forest-labs/FLUX.1-schnell";
  const prompt = visualPrompt(scene, "cinematic, highly detailed, dramatic lighting");
  for (let a = 0; a < 5; a++) {
    const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: prompt, parameters: { width: OUT_W, height: OUT_H } }),
    });
    if (r.status === 503) { await sleep(8000); continue; } // model warming up
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || ct.includes("application/json")) {
      const t = await r.text();
      if (a < 4) { await sleep(5000); continue; }
      throw new Error(`HF ${r.status}: ${t.slice(0, 140)}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) { if (a < 4) { await sleep(4000); continue; } throw new Error("HF empty image"); }
    writeFileSync(outFile, buf);
    return { w: OUT_W, h: OUT_H };
  }
  throw new Error("HF image failed after retries");
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

const src = config.source || "pexels";
const GEN = {
  pexels: (s, f) => pexelsVideo(s.query, f),
  image: pollImage,
  hf: hfImage,
  "fal-image": falImage,
  fal: falVideo,
};
const TAG = { pexels: "🎬 Pexels", image: "🎨 Pollinations", hf: "🎨 HuggingFace", "fal-image": "🎨 fal image", fal: "🤖 fal video" };
const genFn = GEN[src] || GEN.pexels;
const isImageSrc = src === "image" || src === "hf" || src === "fal-image";
// key checks
if ((src === "fal" || src === "fal-image") && !process.env.FAL_KEY) {
  console.error("❌ This source needs a fal.ai key (FAL_KEY). Add it in Settings.");
  process.exit(1);
}
if (src === "hf" && !process.env.HF_TOKEN) {
  console.error("❌ Hugging Face source needs a free token (HF_TOKEN). Add it in Settings.");
  process.exit(1);
}

const sceneOut = [];
for (let i = 0; i < config.scenes.length; i++) {
  const file = `scene${i}.${isImageSrc ? "jpg" : "mp4"}`;
  process.stdout.write(`${TAG[src] || "🎬"} [${i + 1}/${config.scenes.length}] "${config.scenes[i].query}" ... `);
  try {
    const b = await genFn(config.scenes[i], join(PUBLIC, file));
    console.log(`ok (${b.w}x${b.h})`);
  } catch (e) {
    console.log("FAILED:", e.message);
    process.exit(1);
  }
  sceneOut.push({ video: file, start: sceneRanges[i].start, end: sceneRanges[i].end });
}

// --- 6. Write props.json ---
const props = {
  fps: FPS,
  width: config.width || 1080,
  height: config.height || 1920,
  font: config.font || "Arial Black",
  fontCss: config.fontCss || "",
  rtl: !!config.rtl,
  durationInSeconds: durationSec,
  audio: "voiceover.mp3",
  music: config.music || "",
  title: config.title || "",
  scenes: sceneOut,
  words,
};
writeFileSync(join(PUBLIC, "props.json"), JSON.stringify(props, null, 2));
console.log(`✅ Wrote public/props.json — ${sceneOut.length} scenes, ${durationSec.toFixed(1)}s`);
console.log("➡️  Now run:  npm run render");
