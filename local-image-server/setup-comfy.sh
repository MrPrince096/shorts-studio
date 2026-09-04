#!/bin/bash
# Set up ComfyUI + SDXL for local (offline) image generation on Apple Silicon.
# Installs into ~/ComfyUI with its own Python 3.11 venv. Idempotent-ish.
set -e
PY=/Library/Frameworks/Python.framework/Versions/3.11/bin/python3.11
COMFY="$HOME/ComfyUI"
CKPT_DIR="$COMFY/models/checkpoints"
MODEL_URL="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
MODEL_FILE="$CKPT_DIR/sd_xl_base_1.0.safetensors"

echo "==> 1/4 Clone ComfyUI"
if [ ! -d "$COMFY/.git" ]; then
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "$COMFY"
else
  echo "    already cloned"
fi

echo "==> 2/4 Python venv + deps (torch MPS, this is the big one)"
if [ ! -d "$COMFY/venv" ]; then
  "$PY" -m venv "$COMFY/venv"
fi
source "$COMFY/venv/bin/activate"
pip install --upgrade pip wheel >/dev/null
# torch/torchvision with MPS support (arm64 macOS default wheels have MPS)
pip install torch torchvision torchaudio
pip install -r "$COMFY/requirements.txt"

echo "==> 3/4 Download SDXL base checkpoint (~6.9 GB, resumable)"
mkdir -p "$CKPT_DIR"
if [ ! -f "$MODEL_FILE" ] || [ "$(stat -f%z "$MODEL_FILE" 2>/dev/null || echo 0)" -lt 6000000000 ]; then
  curl -L --fail --retry 5 -C - -o "$MODEL_FILE" "$MODEL_URL"
else
  echo "    model already present"
fi

echo "==> 4/4 Done"
echo "    ComfyUI:   $COMFY"
echo "    venv:      $COMFY/venv"
echo "    model:     $MODEL_FILE"
echo "Start it with:  bash local-image-server/start-comfy.command"
