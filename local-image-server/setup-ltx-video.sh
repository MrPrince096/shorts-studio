#!/bin/bash
# Download LTX-Video (local text/image->video) models into the existing ComfyUI.
# Distilled 2B model (fast, M1-friendly) + T5 fp8 text encoder. ~11GB total.
set -e
COMFY="$HOME/ComfyUI"
CKPT="$COMFY/models/checkpoints"
TENC="$COMFY/models/text_encoders"
mkdir -p "$CKPT" "$TENC"

echo "==> 1/2 LTX-Video 2B distilled checkpoint (~6GB)"
LTX="$CKPT/ltxv-2b-0.9.6-distilled.safetensors"
if [ ! -f "$LTX" ] || [ "$(stat -f%z "$LTX" 2>/dev/null || echo 0)" -lt 4000000000 ]; then
  curl -L --fail --retry 5 -C - -o "$LTX" \
    "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltxv-2b-0.9.6-distilled-04-25.safetensors" \
  || curl -L --fail --retry 5 -C - -o "$LTX" \
    "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors"
else echo "    already present"; fi

echo "==> 2/2 T5-XXL fp8 text encoder (~5GB)"
T5="$TENC/t5xxl_fp8_e4m3fn.safetensors"
if [ ! -f "$T5" ] || [ "$(stat -f%z "$T5" 2>/dev/null || echo 0)" -lt 3000000000 ]; then
  curl -L --fail --retry 5 -C - -o "$T5" \
    "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors"
else echo "    already present"; fi

echo "==> done"
ls -lh "$LTX" "$T5" 2>/dev/null | awk '{print "   ",$5,$NF}'
