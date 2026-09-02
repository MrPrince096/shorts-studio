# Local Talking-Avatar Server (free & offline)

Run talking-creator generation **on your own machine** — no cloud, no per-video
cost, no watermark. Shorts Studio sends a photo + your voiceover here and gets
back a video of the person talking, perfectly in sync with the captions.

This wraps **[SadTalker](https://github.com/OpenTalker/SadTalker)** (photo + audio
→ talking head). It uses your **NVIDIA GPU (CUDA)** automatically when present,
and falls back to **CPU** otherwise (works on Mac/Apple Silicon, just slower).

---

## Hardware expectations

| Machine | Works? | Speed (≈30s clip) | Quality |
|---|---|---|---|
| NVIDIA GPU (RTX, ≥6 GB) | ✅ best | ~1–3 min | great |
| Apple Silicon Mac (CPU) | ✅ ok | several minutes | good |
| CPU-only PC | ✅ slow | 5–15 min | good |

---

## One-time setup

**1. Get SadTalker + its model checkpoints**
```bash
git clone https://github.com/OpenTalker/SadTalker ~/SadTalker
cd ~/SadTalker
python -m pip install -r requirements.txt
# download the pretrained checkpoints (script provided by SadTalker):
bash scripts/download_models.sh
```
> On Windows, download the checkpoints per SadTalker's README (the repo has a
> Windows guide). On Mac, if `torch` complains, install the CPU/MPS build:
> `pip install torch torchvision torchaudio`.

**2. Install this server's deps**
```bash
cd <shorts-studio>/local-avatar-server
python -m pip install -r requirements.txt
```

**3. Start it** (point it at your SadTalker clone)
```bash
SADTALKER_DIR=~/SadTalker python server.py
# -> 🎭 Local avatar server on http://localhost:7860
```
Check it's alive: open <http://localhost:7860/health> — `found_inference` should be `true`.

---

## Connect it to Shorts Studio

1. In Shorts Studio → **Settings → Talking avatars**
2. Set **Local avatar server URL** to `http://localhost:7860/generate`
3. Save. The status line should read **“ready via local”**.
4. Make a **UGC Ad**, tick **“Bring creator to life”**, and generate.

When a local URL is set it is **preferred over any cloud provider** — free,
offline, no watermark, and it uses *your* edge-tts voice so captions stay in sync.

---

## Options (env vars)

| Var | Default | Notes |
|---|---|---|
| `SADTALKER_DIR` | `~/SadTalker` | Path to your SadTalker clone |
| `PORT` | `7860` | Server port |
| `EXTRA_FLAGS` | `--preprocess full --still` | Passed to SadTalker. Add `--enhancer gfpgan` for sharper faces (slower). |

---

## Swap in a different model

The app only needs an endpoint that accepts `multipart {image, audio}` and returns
an MP4 (or JSON `{ "video_url": ... }` / `{ "video_base64": ... }`). To use
**Wav2Lip**, **MuseTalk**, **Hallo2**, or a **ComfyUI** workflow instead, just make
`/generate` call that model — nothing in Shorts Studio changes.
