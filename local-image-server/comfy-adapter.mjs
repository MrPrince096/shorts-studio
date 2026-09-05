// ComfyUI adapter for Shorts Studio.
// Exposes  POST /generate {prompt, width, height}  on :7801 and drives a local
// ComfyUI (SDXL) to return a PNG. Shorts Studio's "local" image source points
// LOCAL_IMAGE_URL at http://localhost:7801/generate.
//
// Env:
//   PORT            (default 7801)
//   COMFY_URL       (default http://127.0.0.1:8188)
//   COMFY_CKPT      (default sd_xl_base_1.0.safetensors)
//   COMFY_STEPS     (default 25   — for SDXL Lightning use 5)
//   COMFY_CFG       (default 7.0  — for Lightning use 1.8)
//   COMFY_SAMPLER   (default dpmpp_2m — Lightning: dpmpp_sde)
//   COMFY_SCHEDULER (default karras   — Lightning: sgm_uniform)
//   COMFY_NEG       (default quality negatives)
import http from "http";
import { randomUUID } from "crypto";

const PORT = parseInt(process.env.PORT || "7801", 10);
const COMFY = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const CKPT = process.env.COMFY_CKPT || "sd_xl_base_1.0.safetensors";
// Optional SDXL-Lightning LoRA — makes each image ~6x faster (4 steps vs 25).
// When set, defaults switch to Lightning-friendly sampling unless overridden.
const LORA = process.env.COMFY_LORA || "";           // e.g. sdxl_lightning_4step_lora.safetensors
const LORA_STRENGTH = parseFloat(process.env.COMFY_LORA_STRENGTH || "1.0");
const LIGHT = !!LORA;
const STEPS = parseInt(process.env.COMFY_STEPS || (LIGHT ? "4" : "25"), 10);
const CFG = parseFloat(process.env.COMFY_CFG || (LIGHT ? "1.0" : "7.0"));
const SAMPLER = process.env.COMFY_SAMPLER || (LIGHT ? "euler" : "dpmpp_2m");
const SCHEDULER = process.env.COMFY_SCHEDULER || (LIGHT ? "sgm_uniform" : "karras");
const NEG = process.env.COMFY_NEG || "blurry, low quality, jpeg artifacts, watermark, text, signature, deformed, extra limbs, bad anatomy";

// SDXL is trained ~1MP; generating huge frames (1080x1920) is off-distribution and
// can OOM a 16GB M1. Generate at the closest SDXL "bucket" and let Remotion cover-fit.
const BUCKETS = [
  [1024, 1024], [896, 1152], [832, 1216], [768, 1344], [640, 1536],
  [1152, 896], [1216, 832], [1344, 768], [1536, 640],
];
function pickBucket(w, h) {
  const target = (w || 1024) / (h || 1024);
  let best = BUCKETS[0], bestErr = Infinity;
  for (const b of BUCKETS) {
    const err = Math.abs(b[0] / b[1] - target);
    if (err < bestErr) { bestErr = err; best = b; }
  }
  return best;
}

function workflow(prompt, w, h, seed) {
  // model/clip sources: straight from the checkpoint, or through the LoRA loader.
  const modelSrc = LORA ? ["10", 0] : ["4", 0];
  const clipSrc = LORA ? ["10", 1] : ["4", 1];
  const g = {
    "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: 1 } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: clipSrc } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: NEG, clip: clipSrc } },
    "3": { class_type: "KSampler", inputs: {
      seed, steps: STEPS, cfg: CFG, sampler_name: SAMPLER, scheduler: SCHEDULER, denoise: 1,
      model: modelSrc, positive: ["6", 0], negative: ["7", 0], latent_image: ["5", 0],
    } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "shorts" } },
  };
  if (LORA) {
    g["10"] = { class_type: "LoraLoader", inputs: {
      lora_name: LORA, strength_model: LORA_STRENGTH, strength_clip: 1.0, model: ["4", 0], clip: ["4", 1],
    } };
  }
  return g;
}

async function jf(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function generate({ prompt, width, height }) {
  const [w, h] = pickBucket(width, height);
  const seed = Math.floor(Math.random() * 1e15);
  const client_id = randomUUID();
  const { prompt_id } = await jf(`${COMFY}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow(prompt, w, h, seed), client_id }),
  });
  // poll history until this prompt has outputs
  const deadline = Date.now() + 600000;
  let img = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    let hist;
    try { hist = await jf(`${COMFY}/history/${prompt_id}`); } catch { continue; }
    const entry = hist[prompt_id];
    if (!entry) continue;
    if (entry.status && entry.status.status_str === "error") throw new Error("ComfyUI reported an error (check its console).");
    const outputs = entry.outputs || {};
    for (const nid of Object.keys(outputs)) {
      if (outputs[nid].images && outputs[nid].images.length) { img = outputs[nid].images[0]; break; }
    }
    if (img) break;
  }
  if (!img) throw new Error("Timed out waiting for ComfyUI to render.");
  const qs = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
  const r = await fetch(`${COMFY}/view?${qs}`);
  if (!r.ok) throw new Error(`fetch image -> ${r.status}`);
  return { buf: Buffer.from(await r.arrayBuffer()), w, h };
}

// ---- LTX-Video: animate an image into a short clip (local, on ComfyUI) ----
const LTX_CKPT = process.env.LTX_CKPT || "ltxv-2b-0.9.6-distilled.safetensors";
const LTX_T5 = process.env.LTX_T5 || "t5xxl_fp8_e4m3fn.safetensors";
async function uploadImage(buf) {
  const fd = new FormData();
  fd.append("image", new Blob([buf], { type: "image/png" }), "ltxsrc.png");
  fd.append("overwrite", "true");
  const r = await fetch(`${COMFY}/upload/image`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`image upload -> ${r.status}`);
  return (await r.json()).name;
}
function ltxDims(w, h) { // LTX wants multiples of 32; cap for M1 speed
  w = w || 768; h = h || 512; const cap = 704; const s = Math.min(1, cap / Math.max(w, h));
  const snap = (x) => Math.max(224, Math.round(x * s / 32) * 32);
  return [snap(w), snap(h)];
}
function ltxWf(imageName, prompt, w, h, frames, steps, seed) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: LTX_CKPT } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: LTX_T5, type: "ltxv", device: "default" } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["2", 0] } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "low quality, worst quality, deformed, distorted, blurry, jitter, flicker, artifacts, watermark, text", clip: ["2", 0] } },
    "5": { class_type: "LoadImage", inputs: { image: imageName } },
    "6": { class_type: "LTXVImgToVideo", inputs: { positive: ["3", 0], negative: ["4", 0], vae: ["1", 2], image: ["5", 0], width: w, height: h, length: frames, batch_size: 1, strength: 1.0 } },
    "7": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["6", 1], frame_rate: 25 } },
    "8": { class_type: "LTXVScheduler", inputs: { steps, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1 } },
    "9": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "10": { class_type: "SamplerCustom", inputs: { model: ["1", 0], add_noise: true, noise_seed: seed, cfg: 3, positive: ["7", 0], negative: ["7", 1], sampler: ["9", 0], sigmas: ["8", 0], latent_image: ["6", 2] } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["1", 2] } },
    "12": { class_type: "CreateVideo", inputs: { images: ["11", 0], fps: 24 } },
    "13": { class_type: "SaveVideo", inputs: { video: ["12", 0], filename_prefix: "ltxclip", format: "mp4", codec: "h264" } },
  };
}
async function animate({ imageBuf, prompt, width, height, frames, steps }) {
  const name = await uploadImage(imageBuf);
  const [w, h] = ltxDims(width, height);
  const { prompt_id } = await jf(`${COMFY}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: ltxWf(name, prompt, w, h, frames, steps, Math.floor(Math.random() * 1e9)), client_id: randomUUID() }) });
  const deadline = Date.now() + 1500000; // 25 min
  let vid = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    let hist; try { hist = await jf(`${COMFY}/history/${prompt_id}`); } catch { continue; }
    const e = hist[prompt_id]; if (!e) continue;
    if (e.status && e.status.status_str === "error") throw new Error("LTX render error (see ComfyUI console).");
    const outs = e.outputs || {};
    for (const nid of Object.keys(outs)) { const o = outs[nid]; const f = (o.images || o.gifs || o.video || [])[0]; if (f && f.filename) { vid = f; break; } }
    if (vid) break;
  }
  if (!vid) throw new Error("Timed out waiting for LTX video.");
  const qs = new URLSearchParams({ filename: vid.filename, subfolder: vid.subfolder || "", type: vid.type || "output" });
  const r = await fetch(`${COMFY}/view?${qs}`);
  if (!r.ok) throw new Error(`fetch video -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, comfy: COMFY, ckpt: CKPT, steps: STEPS, ltx: LTX_CKPT }));
  }
  if (req.method === "POST" && req.url.startsWith("/animate")) {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 2e7) req.destroy(); });
    req.on("end", async () => {
      try {
        const b = JSON.parse(body || "{}");
        const m = String(b.image || "").match(/^data:image\/[^;]+;base64,(.+)$/);
        if (!m) throw new Error("missing image (data URL)");
        const out = await animate({ imageBuf: Buffer.from(m[1], "base64"), prompt: String(b.prompt || "gentle cinematic camera motion, subtle movement, high detail"), width: +b.width || 768, height: +b.height || 512, frames: +b.frames || 49, steps: +b.steps || 12 });
        res.writeHead(200, { "Content-Type": "video/mp4" });
        res.end(out);
      } catch (e) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/generate")) {
    res.writeHead(404); return res.end("Not found");
  }
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on("end", async () => {
    try {
      const b = JSON.parse(body || "{}");
      if (!b.prompt) throw new Error("missing prompt");
      const { buf } = await generate({ prompt: String(b.prompt), width: +b.width || 1024, height: +b.height || 1024 });
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(buf);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎨 ComfyUI adapter on http://localhost:${PORT}/generate  ->  ${COMFY}  (${CKPT}, ${STEPS} steps)`);
});
