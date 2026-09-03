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


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "clone": bool(REF_WAV), "speakers": SPEAKERS[:12]}


@app.post("/generate")
def generate(r: Req):
    out = tempfile.mktemp(suffix=".wav")
    kw = dict(text=r.text, file_path=out, language=(r.language or "en"), split_sentences=True)
    if REF_WAV and os.path.isfile(REF_WAV):
        kw["speaker_wav"] = REF_WAV            # clone a narrator you provide
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
