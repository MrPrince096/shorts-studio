# Local Talking-Avatar Server (free & offline)

Run talking-creator generation **on your own machine** — no cloud, no per-video
cost, no watermark. Shorts Studio sends a photo + your voiceover here and gets
back a video of the person talking, perfectly in sync with the captions.

Two engines are included — pick one:

| Engine | Script | Motion | Speed | Best for |
|---|---|---|---|---|
| **SadTalker** | `server.py` | Full head + blinks + mouth | Slower | NVIDIA GPU, most lifelike |
| **Wav2Lip** | `server_wav2lip.py` | Mouth only | **Fast, low memory** | **Mac / CPU**, quick results |

Both use your **NVIDIA GPU (CUDA)** automatically when present, and fall back to
**CPU** otherwise. On a Mac, **Wav2Lip is the recommended one** — much faster.

---

## Hardware expectations

| Machine | SadTalker (≈30s) | Wav2Lip (≈30s) | Quality |
|---|---|---|---|
| NVIDIA GPU (RTX, ≥6 GB) | ~1–3 min | ~20–40 s | great |
| Apple Silicon Mac (CPU) | several min | ~1–2 min | good |
| CPU-only PC | 5–15 min | ~2–4 min | good |

---

## Option A — SadTalker (most lifelike; best on NVIDIA)

### One-time setup

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

## Option B — Wav2Lip (fast & light; recommended on Mac)

Mouth-only lip-sync — no head motion, but quick and low-memory.

**1. Get Wav2Lip + its checkpoints**
```bash
git clone https://github.com/Rudrabha/Wav2Lip ~/Wav2Lip
cd ~/Wav2Lip
python -m pip install -r requirements.txt
# download the checkpoints per the repo's README into ~/Wav2Lip/checkpoints/ :
#   wav2lip_gan.pth   (the face-lip-sync model)
#   plus the face-detection model it asks for (s3fd.pth)
```

**2. Install this server's deps** (same as above)
```bash
cd <shorts-studio>/local-avatar-server && python -m pip install -r requirements.txt
```

**3. Start it**
```bash
WAV2LIP_DIR=~/Wav2Lip python server_wav2lip.py
# -> 🎭 Local avatar (Wav2Lip) on http://localhost:7860
```
Check <http://localhost:7860/health> — `checkpoint_exists` should be `true`.

> Both servers default to port **7860** — run only one at a time (or set `PORT`).

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

| Var | Applies to | Default | Notes |
|---|---|---|---|
| `SADTALKER_DIR` | server.py | `~/SadTalker` | Path to your SadTalker clone |
| `WAV2LIP_DIR` | server_wav2lip.py | `~/Wav2Lip` | Path to your Wav2Lip clone |
| `WAV2LIP_CHECKPOINT` | server_wav2lip.py | `<dir>/checkpoints/wav2lip_gan.pth` | Model checkpoint |
| `PORT` | both | `7860` | Server port |
| `EXTRA_FLAGS` | both | (SadTalker: `--preprocess full --still`) | Passed to the engine. SadTalker: add `--enhancer gfpgan` for sharper faces. Wav2Lip: e.g. `--nosmooth --resize_factor 2`. |

---

## Swap in a different model

The app only needs an endpoint that accepts `multipart {image, audio}` and returns
an MP4 (or JSON `{ "video_url": ... }` / `{ "video_base64": ... }`). To use
**Wav2Lip**, **MuseTalk**, **Hallo2**, or a **ComfyUI** workflow instead, just make
`/generate` call that model — nothing in Shorts Studio changes.
