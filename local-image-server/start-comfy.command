#!/bin/bash
# Start ComfyUI (:8188) + the Shorts Studio adapter (:7801) together.
# Double-click this file, or run it from a terminal. Ctrl-C stops both.
COMFY="$HOME/ComfyUI"
ADAPTER="$(cd "$(dirname "$0")" && pwd)/comfy-adapter.mjs"

if [ ! -d "$COMFY/venv" ]; then
  echo "ComfyUI is not set up yet. Run:  bash local-image-server/setup-comfy.sh"
  exit 1
fi

# --- optional SDXL Lightning speed mode (≈4× faster) -------------------------
# If you downloaded a Lightning checkpoint, set these before launch, e.g.:
#   export COMFY_CKPT="dreamshaperXL_lightningDPMSDE.safetensors"
#   export COMFY_STEPS=6 COMFY_CFG=2 COMFY_SAMPLER=dpmpp_sde COMFY_SCHEDULER=sgm_uniform
# -----------------------------------------------------------------------------

cleanup() { echo "stopping…"; kill $COMFY_PID $ADAPTER_PID 2>/dev/null; exit 0; }
trap cleanup INT TERM

echo "==> starting ComfyUI (this loads the model; first run is slow)…"
source "$COMFY/venv/bin/activate"
( cd "$COMFY" && exec python main.py --port 8188 ) &
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
