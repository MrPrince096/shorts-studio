#!/bin/bash
# Stop the local voice (XTTS) and image (ComfyUI + adapter) servers.
echo "🛑 Stopping Shorts Studio local servers…"
for port in 7870 7801 8188; do
  pids=$(lsof -ti:"$port" 2>/dev/null)
  if [ -n "$pids" ]; then echo "  killing :$port ($pids)"; kill $pids 2>/dev/null; fi
done
# also clean up the launcher wrappers
pkill -f start-xtts.command 2>/dev/null
pkill -f start-comfy.command 2>/dev/null
pkill -f xtts_server.py 2>/dev/null
pkill -f "main.py --port 8188" 2>/dev/null
pkill -f comfy-adapter.mjs 2>/dev/null
echo "Done. (Cloud voice/images still work with everything stopped.)"
