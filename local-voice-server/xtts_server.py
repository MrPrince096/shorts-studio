#!/usr/bin/env python3
"""
Local expressive voice server for Shorts Studio (XTTS-v2, offline).

Turns narration text into an EXPRESSIVE voiceover — far more emotional/"acted"
than edge-tts or Piper. Loads the model once and serves:

    POST /generate   {"text": "...", "language": "en", "speaker": "Damien Black"}
    -> a WAV of the narration

Wraps Coqui XTTS-v2 (multilingual, voice-clonable). Uses your NVIDIA GPU if
present (set XTTS_DEVICE=cuda), else CPU (works on Mac, slower). Point the app at
http://localhost:7870/generate in Settings → Expressive voice.

Run:  XTTS_DEVICE=cpu python xtts_server.py
First run downloads the model (~1.8GB). See README.md.
"""
import os, tempfile
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

DEVICE = os.environ.get("XTTS_DEVICE", "cpu")            # "cpu" | "cuda" | "mps"
SPEAKER = os.environ.get("XTTS_SPEAKER", "Damien Black")  # a built-in xtts_v2 speaker
REF_WAV = os.environ.get("XTTS_REF_WAV", "")             # optional: clone THIS voice (a short wav)
PORT = int(os.environ.get("PORT", "7870"))

print("Loading XTTS-v2 (first run downloads ~1.8GB)…", flush=True)
# Voice cloning loads the reference wav via torchaudio, whose ffmpeg/torchcodec
# backend fails to load on many Macs ("Could not load libtorchcodec"). Replace
# torchaudio.load outright with a soundfile (libsndfile) reader so cloning works
# from a plain WAV reference — no ffmpeg/torchcodec involved.
try:
    import torch as _torch, soundfile as _sf, torchaudio
    def _sf_load(path, *a, **k):
        data, sr = _sf.read(str(path), dtype="float32", always_2d=True)  # (frames, channels)
        return _torch.from_numpy(data.T.copy()), sr                       # (channels, frames), sr
    torchaudio.load = _sf_load
    print("(audio loading via soundfile — cloning enabled)", flush=True)
except Exception as _e:
    print(f"(soundfile audio patch skipped: {_e})", flush=True)
from TTS.api import TTS
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)
SPEAKERS = list(getattr(tts, "speakers", []) or [])
print(f"XTTS ready on {DEVICE} — {len(SPEAKERS)} built-in voices", flush=True)


def pick_speaker(name):
    if name and name in SPEAKERS:
        return name
    return SPEAKERS[0] if SPEAKERS else None


app = FastAPI(title="Shorts Studio — XTTS voice")


class Req(BaseModel):
    text: str
    language: str = "en"
    speaker: str | None = None
    speaker_wav: str | None = None            # per-request voice clone (path to a short wav)


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "clone": bool(REF_WAV), "speakers": SPEAKERS}


@app.post("/generate")
def generate(r: Req):
    out = tempfile.mktemp(suffix=".wav")
    kw = dict(text=r.text, file_path=out, language=(r.language or "en"), split_sentences=True)
    if r.speaker_wav and os.path.isfile(r.speaker_wav):
        kw["speaker_wav"] = r.speaker_wav      # clone the voice for THIS request
    elif REF_WAV and os.path.isfile(REF_WAV):
        kw["speaker_wav"] = REF_WAV            # clone a narrator you provide (global)
    else:
        kw["speaker"] = pick_speaker(r.speaker or SPEAKER)
    try:
        tts.tts_to_file(**kw)
    except Exception as e:
        raise HTTPException(500, f"XTTS failed: {e}")
    return FileResponse(out, media_type="audio/wav", filename="voice.wav")


if __name__ == "__main__":
    import uvicorn
    print(f"🎙️  XTTS voice server on http://localhost:{PORT}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
