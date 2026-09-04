# 🎬 Shorts Studio

A free, unlimited faceless short-video generator that runs entirely on your own machine.
Type a script, pick a voice and format, hit **Generate** — and get a captioned, voiced,
stock-footage video in ~2 minutes. **No credits, no subscriptions, no per-video cost.**

Built with **edge-tts** (voiceover) + **Pexels** (stock footage) + **Remotion** (rendering).

![aspect ratios](https://img.shields.io/badge/formats-9%3A16%20%7C%2016%3A9%20%7C%201%3A1%20%7C%204%3A5-ffd23f) ![cost](https://img.shields.io/badge/cost-%240%20forever-39d98a)

## ✨ Features

- 🖥️ **Desktop app** — a clean local web UI (opens in your browser, runs on your Mac)
- ✨ **Quick Create** — type a topic (or pick a genre/country, or go random); AI writes the scripts and renders them
- 🧠 **Pluggable script AI** — Gemini (free), OpenAI/GPT, or Ollama (local & offline) — switch in Settings
- 🎥 **Pluggable footage** — free Pexels stock, or AI video via fal.ai (Seedance / Veo / Kling)
- ⚙️ **In-app Settings** — manage all API keys from the UI (saved to `.env`, never leaves your machine)
- 🎙️ **9 voices** — female & male, US / UK / Indian / Australian accents (edge-tts)
- 📐 **Any format** — 9:16 (Shorts/Reels), 16:9 (YouTube), 1:1 (Instagram), 4:5 (portrait)
- 🖼️ **Any resolution** — 720p, 1080p, 2K
- ✍️ **Word-synced captions** — bold Hormozi-style with yellow highlight
- 🎞️ **Auto stock footage** — pulls matching Pexels clips per scene, Ken Burns zoom
- 🗂️ **Batch mode** — render many scripts in one command
- 🔁 **Daily autopilot** (optional) — render + YouTube upload on a schedule

## 🚀 Quick start

```bash
git clone <your-repo-url>
cd shorts-engine
npm install
pip3 install edge-tts        # free voiceover engine
cp .env.example .env          # then add your free Pexels API key
npm start                     # opens http://localhost:4321
```

Get a free Pexels API key at <https://www.pexels.com/api/> and paste it into `.env`.
For **Quick Create** (AI writes scripts from a topic), also add a free Gemini key from
<https://aistudio.google.com/app/apikey>. You also need **ffmpeg** (`brew install ffmpeg`) and **Node 18+**.

Then just fill the form and click **Generate Video**. Done videos land in `out/`.

## 🖥️ Desktop app (macOS)

Run Shorts Studio as a real Mac app in its own window — no browser, no terminal:

```bash
npm run icon        # generate the app icon (build/icon.icns) — once
bash scripts/make-app.sh   # builds "Shorts Studio.app" in the project folder
```

Now **double-click `Shorts Studio.app`** to open it. It starts the local engine
and shows the UI in a native window with its own Dock icon. Everything runs
locally — nothing leaves your Mac. You can also run it directly with:

```bash
npm run desktop     # opens the Electron window
```

> The app launches from this project folder (so it can read/write `out/`, and
> find `node`, `ffmpeg`, and `python3`). Keep the folder where it is, or rebuild
> the app after moving it.

## 🔎 Find tab — free images & music

Search free stock photos (Pexels) and free Creative-Commons music, hand-pick
what you want, and render. **Music search** uses **Jamendo** when you add a free
client ID in Settings (reliable, high limits) and falls back to **Openverse**
(keyless, but sometimes rate-limited). Get a free Jamendo client ID at
<https://devportal.jamendo.com/>.

## 🎨 AI images — cloud or fully local

By default AI images come from **Pollinations** (free, cloud, no key). For
**fully offline** image generation, Shorts Studio can drive a local **ComfyUI**
(SDXL) on Apple Silicon:

```bash
# one-time setup: installs ComfyUI + SDXL base (~7 GB) + SDXL-Lightning LoRA
# (~400 MB) into ~/ComfyUI
bash local-image-server/setup-comfy.sh

# each session: start ComfyUI + the adapter (keep the window open)
bash local-image-server/start-comfy.command
```

Then in **Settings → Visual source** choose **“AI images: Local (ComfyUI/SDXL)”**.
The adapter on `http://localhost:7801/generate` translates Shorts Studio's
requests into a ComfyUI SDXL workflow, picks an SDXL-optimal resolution (so it
won't OOM a 16 GB Mac), and returns the image. If ComfyUI isn't running, the
`local` source automatically falls back to Pollinations.

**Speed (Apple M1, 16 GB):** the launcher auto-enables **SDXL-Lightning** (4
steps) when the LoRA is present → **~45 s/image** (first image of a session is
slower while the model loads). Verified end-to-end at 768×1344. For maximum
quality instead of speed, run full 25-step SDXL:

```bash
COMFY_LORA= bash local-image-server/start-comfy.command   # ~3–4 min/image
```

Tune anything with env vars: `COMFY_STEPS`, `COMFY_CFG`, `COMFY_SAMPLER`,
`COMFY_SCHEDULER`, `COMFY_CKPT`, `COMFY_LORA`.

## 🧰 Command-line usage

```bash
# single video — edit scenes.json, then:
npm run make          # -> out/<title-slug>.mp4

# batch — drop scripts in batch/*.json, then:
npm run batch         # renders all of them (resumes if interrupted)
```

### Script format (`scenes.json` / `batch/*.json`)

```json
{
  "title": "Foods Your Heart Loves",
  "description": "for the video caption",
  "tags": ["hearthealth", "shorts"],
  "voice": "en-US-AriaNeural",
  "rate": "0%",
  "width": 1080,
  "height": 1920,
  "scenes": [
    { "text": "Narration spoken aloud.", "query": "pexels search term for the background" }
  ]
}
```

## 🤖 Optional: daily autopilot + YouTube upload

- `scripts/daily.sh` renders the next queued script and uploads it to YouTube.
- Scheduled via `launchd` (see the plist in the repo) — runs each morning if your Mac is awake.
- YouTube upload needs a one-time OAuth setup — see [`YOUTUBE-SETUP.md`](./YOUTUBE-SETUP.md).

## 📁 Project structure

```
server.mjs            local web app (the "Studio")
web/index.html        the UI
src/                  Remotion composition (Short.tsx = the video template)
scripts/
  build.mjs           voiceover + Pexels download + caption timing
  make.mjs            build + render one video -> out/<title>.mp4
  batch.mjs           render every batch/*.json
  autopilot.mjs       render next queued script (for the scheduler)
  daily.sh            render + upload chain
  auth-youtube.mjs    one-time YouTube OAuth
  upload-youtube.mjs  upload the last render to YouTube
batch/                example "Incredible India" scripts
```

## 📝 Requirements

- Node 18+ · ffmpeg · Python 3 with `edge-tts`
- A free Pexels API key
- (First render downloads a headless Chrome shell for Remotion — one time)

## ⚖️ License

MIT — do whatever you like. Pexels footage is free for commercial use; check individual
clip licenses if you need attribution.
