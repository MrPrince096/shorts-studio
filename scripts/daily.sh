#!/bin/zsh
# Daily autopilot: render next queued Short, then upload to YouTube (if authorized).
# Logs to logs/daily-YYYY-MM-DD.log
set -u
export PATH="/usr/local/bin:/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.14/bin:$PATH"
ROOT="/Users/praneethguptha/Youtube/shorts-engine"
LOGDIR="$ROOT/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/daily-$(date +%Y-%m-%d).log"

{
  echo "===== Autopilot run: $(date) ====="
  cd "$ROOT"
  node scripts/autopilot.mjs
  rc=$?
  if [ $rc -eq 2 ]; then
    echo "Queue empty — nothing rendered. Ask Claude for more scripts."
    osascript -e 'display notification "Script queue is EMPTY — ask Claude for more scripts" with title "Shorts Autopilot"' 2>/dev/null
    exit 0
  elif [ $rc -ne 0 ]; then
    echo "Render FAILED (exit $rc)"
    osascript -e 'display notification "Render FAILED — check logs" with title "Shorts Autopilot"' 2>/dev/null
    exit $rc
  fi

  if [ -f "$ROOT/token.json" ]; then
    node scripts/upload-youtube.mjs --public
    if [ $? -eq 0 ]; then
      osascript -e 'display notification "New Short rendered + uploaded to YouTube ✅" with title "Shorts Autopilot"' 2>/dev/null
    else
      osascript -e 'display notification "Rendered OK but YouTube upload failed" with title "Shorts Autopilot"' 2>/dev/null
    fi
  else
    echo "No token.json — skipping upload (run: node scripts/auth-youtube.mjs)"
    osascript -e 'display notification "Short rendered (upload skipped — not authorized yet)" with title "Shorts Autopilot"' 2>/dev/null
  fi
  echo "===== Done: $(date) ====="
} >> "$LOG" 2>&1
