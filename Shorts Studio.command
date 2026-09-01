#!/bin/zsh
# Double-click this file to launch Shorts Studio.
# It starts the local server and opens the app in your browser.
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
echo "Starting Shorts Studio…"
echo "Keep this window open while you use the app. Close it to stop the server."
node server.mjs
