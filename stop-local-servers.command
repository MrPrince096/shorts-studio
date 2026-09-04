#!/bin/bash
# Stop the local voice (XTTS) and image (ComfyUI + adapter) servers.
echo "🛑 Stopping Shorts Studio local servers…"
for port in 7870 7801 8188; do
  pids=$(lsof -ti:"$port" 2>/dev/null)
  if [ -n "$pids" ]; then echo "  killing :$port ($pids)"; kill -9 $pids 2>/dev/null; fi
done
# also clean up the launcher wrappers (force)
pkill -9 -f start-xtts.command 2>/dev/null
pkill -9 -f start-comfy.command 2>/dev/null
pkill -9 -f xtts_server.py 2>/dev/null
pkill -9 -f "main.py --port 8188" 2>/dev/null
pkill -9 -f comfy-adapter.mjs 2>/dev/null
echo "Done. (Cloud voice/images still work with everything stopped.)"
