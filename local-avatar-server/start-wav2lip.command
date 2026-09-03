#!/bin/bash
# Double-click this file (Finder) or run it to start the local Wav2Lip avatar
# server for Shorts Studio. Leave the window open while you generate videos.
cd "$(dirname "$0")"

export WAV2LIP_DIR="${WAV2LIP_DIR:-$HOME/Wav2Lip}"
export PORT="${PORT:-7860}"
VENV="$WAV2LIP_DIR/.venv311/bin/python"

echo "🎭 Starting local talking-avatar server (Wav2Lip)…"
echo "   Wav2Lip: $WAV2LIP_DIR"
echo "   Port:    $PORT"
echo

if [ ! -x "$VENV" ]; then
  echo "❌ Python venv not found at: $VENV"
  echo "   Set it up first (see local-avatar-server/README.md), or set WAV2LIP_DIR."
  echo
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi

echo "➡️  In Shorts Studio → Settings → Talking avatars, set:"
echo "       Local avatar server URL = http://localhost:$PORT/generate"
echo "   Then tick “Bring creator to life” in a UGC ad. Ctrl+C here to stop."
echo
exec "$VENV" "$(dirname "$0")/server_wav2lip.py"
