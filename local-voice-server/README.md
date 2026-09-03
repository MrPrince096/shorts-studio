# Local Expressive Voice Server (XTTS-v2, offline)

Genuinely **emotional / "acted"** narration — far beyond edge-tts or Piper —
running on your own machine, free and offline. Great for scary, funny, bedtime
and dramatic storytelling. Wraps **Coqui XTTS-v2** (multilingual, voice-clonable).

Shorts Studio sends narration text here and gets back expressive audio.

---

## Setup (one time)

XTTS shares the same Python venv you made for Wav2Lip (`~/Wav2Lip/.venv311`).

```bash
# in that venv, install XTTS + audio deps
~/Wav2Lip/.venv311/bin/python -m pip install "coqui-tts[codec]" torchaudio "transformers>=4.57,<5"
```
> The `transformers` pin matters — 5.x breaks XTTS, and <4.57 is too old.

## Run it

```bash
./start-xtts.command
# or:  XTTS_DEVICE=cpu PORT=7870 ~/Wav2Lip/.venv311/bin/python xtts_server.py
```
First launch downloads the model (~1.8GB); after that it loads in seconds.
Check <http://localhost:7870/health> — it lists the built-in voices.

## Connect it

1. Shorts Studio → **Settings → Expressive voice** → **XTTS-v2 server URL** = `http://localhost:7870/generate`
2. Quick settings → **Voiceover engine → XTTS-v2**
3. Generate. It uses *your* text so captions stay in sync — offline, no watermark.

---

## Speed & options (env vars)

| Var | Default | Notes |
|---|---|---|
| `XTTS_DEVICE` | `cpu` | `cuda` on an NVIDIA GPU (much faster); `mps` is experimental on Mac |
| `XTTS_SPEAKER` | `Damien Black` | any built-in voice (see `/health`) |
| `XTTS_REF_WAV` | — | path to a short clean WAV to **clone that narrator's voice** |
| `PORT` | `7870` | server port |

On a Mac (CPU) expect roughly **1–2× realtime** — a 3-min story's voiceover takes
a few minutes. On an NVIDIA GPU it's much faster.

**Clone your own narrator:** set `XTTS_REF_WAV=/path/to/6-10s-sample.wav` and every
video uses that voice — record a dramatic sample for the perfect scary/story vibe.
