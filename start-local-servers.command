#!/bin/bash
# One click: start the local VOICE (XTTS :7870) and IMAGE (ComfyUI :8188 +
# adapter :7801) servers — but only the ones that aren't already running.
# Safe to run repeatedly; it never double-starts (no "address already in use").
ROOT="$(cd "$(dirname "$0")" && pwd)"

up() { lsof -ti:"$1" >/dev/null 2>&1; }

echo "🎬 Shorts Studio — local servers"
echo ""

# --- Voice: XTTS ---
if up 7870; then
  echo "✅ Voice (XTTS) already running on :7870"
else
  echo "→ Starting voice server (XTTS)…"
  nohup bash "$ROOT/local-voice-server/start-xtts.command" > /tmp/xtts.log 2>&1 &
  echo "   loading model (~30–60s), log: /tmp/xtts.log"
fi

echo ""

# --- Images: ComfyUI + adapter ---
if up 7801; then
  echo "✅ Images (ComfyUI adapter) already running on :7801"
elif [ ! -d "$HOME/ComfyUI/venv" ]; then
  echo "ℹ️  Images: ComfyUI not installed — skipping."
  echo "   (Images will use cloud Pollinations. To enable local images run:"
  echo "    bash \"$ROOT/local-image-server/setup-comfy.sh\")"
else
  echo "→ Starting image server (ComfyUI + adapter)…"
  nohup bash "$ROOT/local-image-server/start-comfy.command" > /tmp/comfy.log 2>&1 &
  echo "   loading model (~30–60s), log: /tmp/comfy.log"
fi

echo ""
echo "You can close this window; the servers keep running in the background."
echo "Stop them anytime with:  bash \"$ROOT/stop-local-servers.command\""
echo ""

# brief readiness poll so the user sees green ticks before leaving
printf "Waiting for servers to come up"
for i in $(seq 1 40); do
  v=no; i7801=skip
  up 7870 && v=yes
  if [ -d "$HOME/ComfyUI/venv" ]; then up 7801 && i7801=yes || i7801=no; fi
  if [ "$v" = yes ] && { [ "$i7801" = yes ] || [ "$i7801" = skip ]; }; then echo " done."; break; fi
  printf "."; sleep 2
done
echo ""
up 7870 && echo "  ✅ Voice  (XTTS)            :7870" || echo "  ⏳ Voice  (XTTS) still loading — check /tmp/xtts.log"
if [ -d "$HOME/ComfyUI/venv" ]; then
  up 7801 && echo "  ✅ Images (ComfyUI adapter) :7801" || echo "  ⏳ Images still loading — check /tmp/comfy.log"
fi
