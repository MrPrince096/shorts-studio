#!/bin/bash
# Start the local Kokoro voice server (:7880). Double-click, or run from a terminal.
cd "$(dirname "$0")"
export PORT="7880"                 # Kokoro is always :7880 (ignore any inherited PORT)
KROOT="$HOME/kokoro-tts"
VENV="$KROOT/venv/bin/python"

if [ ! -x "$VENV" ]; then
  echo "❌ Kokoro isn't set up. Run:  bash local-voice-server/setup-kokoro.sh"
  exit 1
fi

echo "🎧 Starting Kokoro voice server on :$PORT …"
# Force native arm64 on Apple Silicon hardware (sysctl is true even under Rosetta).
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] && command -v arch >/dev/null 2>&1; then
  exec arch -arm64 "$VENV" kokoro_server.py
else
  exec "$VENV" kokoro_server.py
fi
