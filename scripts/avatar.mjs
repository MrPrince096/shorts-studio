// Talking-avatar / lip-sync abstraction (the spec's AvatarProvider, §17/§49).
// Turns a still photo + narration into a video of the person talking & moving.
// Three pluggable providers, chosen by which API key is present:
//   FAL_KEY        -> fal.ai lip-sync (uses OUR edge-tts audio; cheapest)
//   DID_API_KEY    -> D-ID talking-photo (Microsoft TTS = same voices we use)
//   HEYGEN_API_KEY -> HeyGen talking-photo (most realistic)
// No key => no talking avatar; the pipeline falls back to the still photo.
//
// NOTE: built to each provider's documented REST API but LIVE-UNTESTED until a
// real key is supplied — expect to iterate on small quirks the first time.
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const env = (k) => process.env[k] || "";
// Local (free, offline) is preferred when configured; then the cloud providers.
export function avatarProviderName() {
  if (env("LOCAL_AVATAR_URL")) return "local";
  if (env("FAL_KEY")) return "fal";
  if (env("DID_API_KEY")) return "did";
  if (env("HEYGEN_API_KEY")) return "heygen";
  return "";
}

const mimeFor = (p) => {
  const e = extname(p).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".mp3") return "audio/mpeg";
  if (e === ".wav") return "audio/wav";
  if (e === ".m4a") return "audio/mp4";
  return "image/jpeg";
};
const dataUri = (p) => `data:${mimeFor(p)};base64,${readFileSync(p).toString("base64")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function download(url, outFile) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
}

// ---------------- Local server (free, offline; you run the model on your GPU/Mac) ----------------
// Uses OUR edge-tts audio -> captions stay perfectly in sync. No watermark, no cost.
// Expects a local HTTP endpoint that accepts multipart {image, audio} and returns
// either an mp4 body, or JSON { video_url } / { video_base64 }.
async function localTalking({ photoPath, audioPath, outFile, log }) {
  const url = env("LOCAL_AVATAR_URL");
  log(`🎭 Local avatar server — ${url} (offline, using your voiceover)…`);
  const form = new FormData();
  form.append("image", new Blob([readFileSync(photoPath)], { type: mimeFor(photoPath) }), "photo.jpg");
  form.append("audio", new Blob([readFileSync(audioPath)], { type: mimeFor(audioPath) }), "audio.mp3");
  const r = await fetch(url, { method: "POST", body: form });
  if (!r.ok) throw new Error(`local avatar ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await r.json();
    if (j.video_url) { await download(j.video_url, outFile); return true; }
    if (j.video_base64) { writeFileSync(outFile, Buffer.from(String(j.video_base64).replace(/^data:video\/\w+;base64,/, ""), "base64")); return true; }
    throw new Error("local avatar: JSON response had no video_url/video_base64");
  }
  writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
  return true;
}

// ---------------- fal.ai (audio-driven lip-sync; keeps our edge-tts voice) ----------------
async function falTalking({ photoPath, audioPath, outFile, log }) {
  const key = env("FAL_KEY");
  const model = env("FAL_AVATAR_MODEL") || "fal-ai/sadtalker"; // image + audio -> talking head
  log(`🎭 fal.ai (${model}) — animating photo to your voiceover…`);
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ source_image_url: dataUri(photoPath), driven_audio_url: dataUri(audioPath) }),
  });
  const j = await submit.json();
  if (!submit.ok) throw new Error(`fal ${submit.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const statusUrl = j.status_url, responseUrl = j.response_url;
  if (!statusUrl) throw new Error("fal: no status_url returned");
  for (let i = 0; i < 150; i++) {
    await sleep(4000);
    const st = await (await fetch(statusUrl, { headers: { Authorization: `Key ${key}` } })).json();
    if (st.status === "COMPLETED") break;
    if (st.status === "FAILED" || st.error) throw new Error("fal job failed");
    if (i % 5 === 0) log(`   …${st.status || "processing"}`);
  }
  const out = await (await fetch(responseUrl, { headers: { Authorization: `Key ${key}` } })).json();
  const url = out?.video?.url || out?.video || out?.output?.video?.url;
  if (!url) throw new Error("fal: no video in result");
  await download(url, outFile);
  return true;
}

// ---------------- D-ID (talking-photo; Microsoft TTS from the script text) ----------------
async function didTalking({ photoPath, scriptText, voice, outFile, log }) {
  const raw = env("DID_API_KEY");
  // D-ID uses HTTP Basic. Dashboard keys come as raw "email:api_key" (needs base64)
  // OR as an already-encoded Basic token. Normalise both.
  const token = raw.includes(":") ? Buffer.from(raw).toString("base64") : raw;
  const basic = `Basic ${token}`;
  const auth = { Authorization: basic, "Content-Type": "application/json" };
  log("🎭 D-ID — uploading photo & generating talking video…");
  // 1) upload the source image -> hosted url
  const form = new FormData();
  form.append("image", new Blob([readFileSync(photoPath)], { type: mimeFor(photoPath) }), "creator.jpg");
  const up = await fetch("https://api.d-id.com/images", { method: "POST", headers: { Authorization: basic }, body: form });
  const upj = await up.json();
  if (!up.ok || !upj.url) throw new Error(`D-ID upload ${up.status}: ${JSON.stringify(upj).slice(0, 200)}`);
  // 2) create the talk (edge-tts voices ARE Microsoft neural voices -> same voice)
  const create = await fetch("https://api.d-id.com/talks", {
    method: "POST", headers: auth,
    body: JSON.stringify({ source_url: upj.url, script: { type: "text", input: scriptText, provider: { type: "microsoft", voice_id: voice } } }),
  });
  const cj = await create.json();
  if (!create.ok || !cj.id) throw new Error(`D-ID talk ${create.status}: ${JSON.stringify(cj).slice(0, 200)}`);
  // 3) poll until done
  for (let i = 0; i < 150; i++) {
    await sleep(4000);
    const st = await (await fetch(`https://api.d-id.com/talks/${cj.id}`, { headers: { Authorization: basic } })).json();
    if (st.status === "done" && st.result_url) { await download(st.result_url, outFile); return true; }
    if (st.status === "error" || st.status === "rejected") throw new Error("D-ID job failed: " + (st.error?.description || st.status));
    if (i % 5 === 0) log(`   …${st.status || "processing"}`);
  }
  throw new Error("D-ID: timed out");
}

// ---------------- HeyGen (talking-photo; HeyGen TTS from the script text) ----------------
async function heygenTalking({ photoPath, scriptText, width, height, outFile, log }) {
  const key = env("HEYGEN_API_KEY");
  const voiceId = env("HEYGEN_VOICE_ID") || "1bd001e7e50f421d891986aad5158bc8"; // a default HeyGen voice
  log("🎭 HeyGen — uploading photo & generating talking avatar…");
  // 1) upload talking photo
  const up = await fetch("https://upload.heygen.com/v1/talking_photo", {
    method: "POST", headers: { "X-Api-Key": key, "Content-Type": mimeFor(photoPath) }, body: readFileSync(photoPath),
  });
  const upj = await up.json();
  const tpId = upj?.data?.talking_photo_id;
  if (!up.ok || !tpId) throw new Error(`HeyGen upload ${up.status}: ${JSON.stringify(upj).slice(0, 200)}`);
  // 2) generate the video
  const gen = await fetch("https://api.heygen.com/v2/video/generate", {
    method: "POST", headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      video_inputs: [{
        character: { type: "talking_photo", talking_photo_id: tpId },
        voice: { type: "text", input_text: scriptText, voice_id: voiceId },
      }],
      dimension: { width, height },
    }),
  });
  const gj = await gen.json();
  const videoId = gj?.data?.video_id;
  if (!gen.ok || !videoId) throw new Error(`HeyGen generate ${gen.status}: ${JSON.stringify(gj).slice(0, 200)}`);
  // 3) poll status
  for (let i = 0; i < 150; i++) {
    await sleep(5000);
    const st = await (await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, { headers: { "X-Api-Key": key } })).json();
    const s = st?.data?.status;
    if (s === "completed" && st.data.video_url) { await download(st.data.video_url, outFile); return true; }
    if (s === "failed") throw new Error("HeyGen job failed: " + (st.data?.error?.message || "unknown"));
    if (i % 4 === 0) log(`   …${s || "processing"}`);
  }
  throw new Error("HeyGen: timed out");
}

// Dispatch. Returns true if a talking clip was written to outFile, false/throws otherwise.
export async function generateTalkingVideo({ photoPath, audioPath, scriptText, voice, width, height, outFile, log = console.log }) {
  const provider = avatarProviderName();
  if (!provider) return false;
  if (provider === "local") return localTalking({ photoPath, audioPath, outFile, log });
  if (provider === "fal") return falTalking({ photoPath, audioPath, outFile, log });
  if (provider === "did") return didTalking({ photoPath, scriptText, voice, outFile, log });
  if (provider === "heygen") return heygenTalking({ photoPath, scriptText, width, height, outFile, log });
  return false;
}
