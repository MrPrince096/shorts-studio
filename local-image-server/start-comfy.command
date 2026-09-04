#!/bin/bash
# Start ComfyUI (:8188) + the Shorts Studio adapter (:7801) together.
# Double-click this file, or run it from a terminal. Ctrl-C stops both.
COMFY="$HOME/ComfyUI"
ADAPTER="$(cd "$(dirname "$0")" && pwd)/comfy-adapter.mjs"

if [ ! -d "$COMFY/venv" ]; then
  echo "ComfyUI is not set up yet. Run:  bash local-image-server/setup-comfy.sh"
  exit 1
fi

# --- SDXL Lightning speed mode (auto) ----------------------------------------
# If the Lightning LoRA is installed, use it by default (~6x faster: 4 steps).
# Override anything by exporting COMFY_* before running this script.
LORA_FILE="$COMFY/models/loras/sdxl_lightning_4step_lora.safetensors"
if [ -z "$COMFY_LORA" ] && [ -f "$LORA_FILE" ]; then
  export COMFY_LORA="sdxl_lightning_4step_lora.safetensors"
  echo "    ⚡ Lightning mode ON (4 steps). Unset COMFY_LORA for full-quality 25-step SDXL."
fi
# -----------------------------------------------------------------------------

cleanup() { echo "stopping…"; kill $COMFY_PID $ADAPTER_PID 2>/dev/null; exit 0; }
trap cleanup INT TERM

echo "==> starting ComfyUI (this loads the model; first run is slow)…"
source "$COMFY/venv/bin/activate"
# Force native arm64 (torch/venv are arm64-only). Detect hardware via sysctl so
# it works even under a Rosetta/x86_64 parent (where uname -m says x86_64).
PYRUN="python"
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] && command -v arch >/dev/null 2>&1; then PYRUN="arch -arm64 python"; fi
( cd "$COMFY" && exec $PYRUN main.py --port 8188 ) &
COMFY_PID=$!

# wait for ComfyUI to answer
echo -n "    waiting for ComfyUI"
for i in $(seq 1 120); do
  if curl -s -o /dev/null http://127.0.0.1:8188/ ; then echo " ✓"; break; fi
  echo -n "."; sleep 1
done

echo "==> starting adapter on :7801"
node "$ADAPTER" &
ADAPTER_PID=$!

echo ""
echo "✅ Local image generation is live."
echo "   In Shorts Studio → Settings, set the footage source to 'Local' (LOCAL_IMAGE_URL = http://localhost:7801/generate)."
echo "   Leave this window open while you generate. Ctrl-C here stops everything."
wait
