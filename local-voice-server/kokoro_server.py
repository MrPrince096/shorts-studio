#!/usr/bin/env python3
"""
Kokoro TTS server for Shorts Studio (fast, natural, offline).

Kokoro is a small (82M) open-weight voice model — quick even on CPU, with a set
of clean American/British male & female voices. Serves:

    POST /generate  {"text": "...", "language": "en", "speaker": "af_heart"}  -> WAV
    GET  /health    -> {"ok": true, "voices": [...]}

Uses the ONNX build (onnxruntime, no PyTorch). Point the app at
http://localhost:7880/generate. English is best; a few other majors supported.
"""
import os, tempfile
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

KROOT = os.path.expanduser("~/kokoro-tts")
MODEL = os.environ.get("KOKORO_MODEL", os.path.join(KROOT, "kokoro-v1.0.onnx"))
VOICES = os.environ.get("KOKORO_VOICES", os.path.join(KROOT, "voices-v1.0.bin"))
PORT = int(os.environ.get("PORT", "7880"))

print("Loading Kokoro…", flush=True)
from kokoro_onnx import Kokoro
kokoro = Kokoro(MODEL, VOICES)
try:
    VOICE_LIST = sorted(kokoro.get_voices())
except Exception:
    VOICE_LIST = ["af_heart", "af_bella", "af_nicole", "af_sarah", "am_adam", "am_michael",
                  "bf_emma", "bf_isabella", "bm_george", "bm_lewis"]
DEFAULT_VOICE = "af_heart" if "af_heart" in VOICE_LIST else (VOICE_LIST[0] if VOICE_LIST else "af_heart")
print(f"Kokoro ready — {len(VOICE_LIST)} voices", flush=True)

# Kokoro only speaks a handful of languages; map app codes, fall back to en-us.
LANG_MAP = {"en": "en-us", "en-gb": "en-gb", "fr": "fr-fr", "ja": "ja", "ko": "ko",
            "zh": "cmn", "es": "es", "hi": "hi", "it": "it", "pt": "pt-br"}

app = FastAPI(title="Shorts Studio — Kokoro voice")


class Req(BaseModel):
    text: str
    language: str = "en"
    speaker: str | None = None   # a Kokoro voice name


@app.get("/health")
def health():
    return {"ok": True, "voices": VOICE_LIST, "default": DEFAULT_VOICE}


@app.post("/generate")
def generate(r: Req):
    voice = r.speaker if (r.speaker and r.speaker in VOICE_LIST) else DEFAULT_VOICE
    lang = LANG_MAP.get((r.language or "en").lower(), "en-us")
    try:
        samples, sr = kokoro.create(r.text, voice=voice, speed=1.0, lang=lang)
    except Exception as e:
        raise HTTPException(500, f"Kokoro failed: {e}")
    out = tempfile.mktemp(suffix=".wav")
    sf.write(out, samples, sr)
    return FileResponse(out, media_type="audio/wav", filename="voice.wav")


if __name__ == "__main__":
    import uvicorn
    print(f"🎧 Kokoro voice server on http://localhost:{PORT}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
