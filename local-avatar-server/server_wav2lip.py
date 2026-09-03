#!/usr/bin/env python3
"""
Local talking-avatar server (Wav2Lip variant) for Shorts Studio.

Lighter and much faster than SadTalker — great on a Mac / CPU. It lip-syncs the
MOUTH onto the photo in time with the audio (no big head motion or blinking, but
quick and low-memory). Same endpoint contract as server.py:

    POST /generate   (multipart: image=<photo>, audio=<voiceover mp3>)  -> mp4

Wraps Wav2Lip (https://github.com/Rudrabha/Wav2Lip). Uses GPU when available,
otherwise CPU. Point the app at http://localhost:7860/generate in Settings.

Run:  WAV2LIP_DIR=/path/to/Wav2Lip python server_wav2lip.py
See README.md for the one-time setup.
"""
import os, sys, time, tempfile, subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

WAV2LIP_DIR = os.environ.get("WAV2LIP_DIR", os.path.expanduser("~/Wav2Lip"))
CHECKPOINT = os.environ.get("WAV2LIP_CHECKPOINT", os.path.join(WAV2LIP_DIR, "checkpoints", "wav2lip_gan.pth"))
PORT = int(os.environ.get("PORT", "7860"))
# e.g. EXTRA_FLAGS="--nosmooth --resize_factor 2"
EXTRA_FLAGS = os.environ.get("EXTRA_FLAGS", "").split()

app = FastAPI(title="Shorts Studio — Local Avatar (Wav2Lip)")


@app.get("/health")
def health():
    ok = os.path.isfile(os.path.join(WAV2LIP_DIR, "inference.py"))
    return {"ok": ok, "wav2lip_dir": WAV2LIP_DIR, "checkpoint_exists": os.path.isfile(CHECKPOINT)}


@app.post("/generate")
async def generate(image: UploadFile = File(...), audio: UploadFile = File(...)):
    infer = os.path.join(WAV2LIP_DIR, "inference.py")
    if not os.path.isfile(infer):
        raise HTTPException(500, f"Wav2Lip not found at {WAV2LIP_DIR}. Set WAV2LIP_DIR.")
    if not os.path.isfile(CHECKPOINT):
        raise HTTPException(500, f"Checkpoint not found at {CHECKPOINT}. Set WAV2LIP_CHECKPOINT.")

    work = tempfile.mkdtemp(prefix="wav2lip_")
    img_path = os.path.join(work, "photo" + os.path.splitext(image.filename or ".jpg")[1])
    aud_path = os.path.join(work, "audio" + os.path.splitext(audio.filename or ".mp3")[1])
    out_path = os.path.join(work, "talking.mp4")
    with open(img_path, "wb") as f:
        f.write(await image.read())
    with open(aud_path, "wb") as f:
        f.write(await audio.read())

    cmd = [sys.executable, "inference.py",
           "--checkpoint_path", CHECKPOINT,
           "--face", img_path,      # a still image is fine — Wav2Lip animates the mouth on it
           "--audio", aud_path,
           "--outfile", out_path] + EXTRA_FLAGS
    print("▶️ ", " ".join(cmd), flush=True)
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=WAV2LIP_DIR, capture_output=True, text=True)
    if proc.returncode != 0 or not os.path.isfile(out_path):
        print(proc.stdout[-2000:], proc.stderr[-2000:], flush=True)
        raise HTTPException(500, "Wav2Lip failed: " + (proc.stderr[-400:] or "unknown"))

    print(f"✅ done in {time.time()-t0:.0f}s -> {out_path}", flush=True)
    return FileResponse(out_path, media_type="video/mp4", filename="talking.mp4")


if __name__ == "__main__":
    import uvicorn
    print(f"🎭 Local avatar (Wav2Lip) on http://localhost:{PORT}  (Wav2Lip: {WAV2LIP_DIR})")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
