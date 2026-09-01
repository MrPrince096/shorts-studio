#!/usr/bin/env python3
"""
Free, unlimited LOCAL image generator for Shorts Studio (Apple Silicon).
Runs FLUX on your Mac via mflux and serves it at http://localhost:7801/generate.

One-time setup:
    pip3 install mflux
    (first image downloads the FLUX schnell model, several GB)

Run it:
    python3 local-image-server.py
Then in Shorts Studio -> Settings, set Local image server URL to:
    http://localhost:7801/generate
and choose Visual source -> "Local server".

POST /generate  {"prompt": "...", "width": 1080, "height": 1920}  ->  PNG bytes
"""
import json, subprocess, tempfile, os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 7801
MODEL = "schnell"   # fast FLUX; use "dev" for higher quality (slower, needs more RAM)
STEPS = "2"         # schnell needs only 2-4 steps

def gen(prompt, w, h):
    out = tempfile.mktemp(suffix=".png")
    # mflux wants multiples of 16; round down
    w = max(256, (int(w) // 16) * 16)
    h = max(256, (int(h) // 16) * 16)
    subprocess.run([
        "mflux-generate", "--model", MODEL, "--prompt", prompt,
        "--width", str(w), "--height", str(h), "--steps", STEPS,
        "--output", out,
    ], check=True)
    data = open(out, "rb").read()
    os.remove(out)
    return data

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            img = gen(body.get("prompt", "a landscape"), body.get("width", 1024), body.get("height", 1024))
            self.send_response(200); self.send_header("Content-Type", "image/png"); self.end_headers()
            self.wfile.write(img)
        except Exception as e:
            msg = str(e).encode()
            self.send_response(500); self.send_header("Content-Type", "text/plain"); self.end_headers()
            self.wfile.write(msg)
    def log_message(self, *a):  # quiet
        pass

if __name__ == "__main__":
    print(f"Local image server on http://localhost:{PORT}/generate  (model: FLUX {MODEL})")
    print("First request downloads the model (several GB) and is slow. Ctrl+C to stop.")
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
