#!/bin/bash
# Double-click to start the local XTTS-v2 expressive-voice server for Shorts Studio.
# Leave the window open while you generate videos. Ctrl+C to stop.
cd "$(dirname "$0")"

export XTTS_DEVICE="${XTTS_DEVICE:-cpu}"     # cpu | cuda | mps
export PORT="${PORT:-7870}"
export COQUI_TOS_AGREED=1                     # accept the Coqui model license non-interactively
VENV="${XTTS_PYTHON:-$HOME/Wav2Lip/.venv311/bin/python}"

echo "🎙️  Starting XTTS-v2 expressive voice server…"
echo "   Device: $XTTS_DEVICE   Port: $PORT"
echo "   (first run downloads ~1.8GB; then it loads in a few seconds)"
echo

if [ ! -x "$VENV" ]; then
  echo "❌ Python venv not found at: $VENV"
  echo "   Set it up (see README.md) or set XTTS_PYTHON to your venv python."
  read -n 1 -s -r -p "Press any key to close…"; exit 1
fi

echo "➡️  In Shorts Studio → Settings → Expressive voice, set:"
echo "       XTTS-v2 server URL = http://localhost:$PORT/generate"
echo "   Then pick Voiceover engine → XTTS in Quick settings."
echo
# Force native arm64 on Apple Silicon HARDWARE (detect via sysctl, which is true
# even under a Rosetta/x86_64 parent where `uname -m` lies and says x86_64).
# The venv packages are arm64-only, so a universal python must run arm64.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] && command -v arch >/dev/null 2>&1; then
  exec arch -arm64 "$VENV" xtts_server.py
else
  exec "$VENV" xtts_server.py
fi
