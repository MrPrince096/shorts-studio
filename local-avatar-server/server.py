#!/usr/bin/env python3
"""
Local talking-avatar server for Shorts Studio (free, offline).

It exposes ONE endpoint the app calls:
    POST /generate   (multipart: image=<photo>, audio=<voiceover mp3>)
    -> returns an MP4 of the photo talking, in sync with the audio.

It wraps SadTalker (https://github.com/OpenTalker/SadTalker), which turns a
still photo + audio into a talking head. SadTalker auto-uses your NVIDIA GPU
(CUDA) when present and falls back to CPU otherwise (slower, works on Mac).

Point the app at this server in Settings -> "Local avatar server URL":
    http://localhost:7860/generate

Run:  SADTALKER_DIR=/path/to/SadTalker python server.py
See README.md for the full one-time setup.
"""
import os, sys, glob, time, tempfile, subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

SADTALKER_DIR = os.environ.get("SADTALKER_DIR", os.path.expanduser("~/SadTalker"))
PORT = int(os.environ.get("PORT", "7860"))
# extra flags: e.g. EXTRA_FLAGS="--enhancer gfpgan --preprocess full"
EXTRA_FLAGS = os.environ.get("EXTRA_FLAGS", "--preprocess full --still").split()

app = FastAPI(title="Shorts Studio — Local Avatar")


@app.get("/health")
def health():
    ok = os.path.isfile(os.path.join(SADTALKER_DIR, "inference.py"))
    return {"ok": ok, "sadtalker_dir": SADTALKER_DIR, "found_inference": ok}


@app.post("/generate")
async def generate(image: UploadFile = File(...), audio: UploadFile = File(...)):
    infer = os.path.join(SADTALKER_DIR, "inference.py")
    if not os.path.isfile(infer):
        raise HTTPException(500, f"SadTalker not found at {SADTALKER_DIR}. Set SADTALKER_DIR.")

    work = tempfile.mkdtemp(prefix="avatar_")
    img_path = os.path.join(work, "photo" + os.path.splitext(image.filename or ".jpg")[1])
    aud_path = os.path.join(work, "audio" + os.path.splitext(audio.filename or ".mp3")[1])
    with open(img_path, "wb") as f:
        f.write(await image.read())
    with open(aud_path, "wb") as f:
        f.write(await audio.read())

    result_dir = os.path.join(work, "out")
    os.makedirs(result_dir, exist_ok=True)
    cmd = [sys.executable, "inference.py",
           "--source_image", img_path,
           "--driven_audio", aud_path,
           "--result_dir", result_dir] + EXTRA_FLAGS
    print("▶️ ", " ".join(cmd), flush=True)
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=SADTALKER_DIR, capture_output=True, text=True)
    if proc.returncode != 0:
        print(proc.stdout[-2000:], proc.stderr[-2000:], flush=True)
        raise HTTPException(500, "SadTalker failed: " + (proc.stderr[-400:] or "unknown"))

    mp4s = sorted(glob.glob(os.path.join(result_dir, "**", "*.mp4"), recursive=True),
                  key=os.path.getmtime)
    if not mp4s:
        raise HTTPException(500, "SadTalker produced no video")
    print(f"✅ done in {time.time()-t0:.0f}s -> {mp4s[-1]}", flush=True)
    return FileResponse(mp4s[-1], media_type="video/mp4", filename="talking.mp4")


if __name__ == "__main__":
    import uvicorn
    print(f"🎭 Local avatar server on http://localhost:{PORT}  (SadTalker: {SADTALKER_DIR})")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
