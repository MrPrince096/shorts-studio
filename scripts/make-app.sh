#!/bin/bash
# Build a double-clickable "Shorts Studio.app" that opens the Electron window
# from this project folder (full access to node_modules, out/, ffmpeg, python).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/Shorts Studio.app"
CON="$APP/Contents"

# Ensure the icon exists.
[ -f "$ROOT/build/icon.icns" ] || python3 "$ROOT/scripts/make-icon.py"

# Ad-hoc code-sign the Electron runtime so macOS doesn't kill its sandboxed
# helper processes (GPU/network) — otherwise the window can fail to paint.
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
if [ -d "$ELECTRON_APP" ]; then
  codesign --force --deep --sign - "$ELECTRON_APP" 2>/dev/null && echo "code-signed Electron runtime (ad-hoc)" || true
fi

rm -rf "$APP"
mkdir -p "$CON/MacOS" "$CON/Resources"
cp "$ROOT/build/icon.icns" "$CON/Resources/icon.icns"

cat > "$CON/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Shorts Studio</string>
  <key>CFBundleDisplayName</key><string>Shorts Studio</string>
  <key>CFBundleIdentifier</key><string>com.shortsstudio.app</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>ShortsStudio</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

cat > "$CON/MacOS/ShortsStudio" <<LAUNCH
#!/bin/bash
# Launch Shorts Studio's Electron window from the project directory.
# Use Electron's NATIVE binary (not node_modules/.bin/electron, which is a
# node script) so it works when Finder launches us with a bare PATH.
cd "$ROOT" || exit 1
# Make node/ffmpeg/python discoverable for the render pipeline.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:\$HOME/.local/bin:\$PATH"
LOGIN_PATH="\$(/bin/zsh -ilc 'echo -n \$PATH' 2>/dev/null)"
[ -n "\$LOGIN_PATH" ] && export PATH="\$LOGIN_PATH:\$PATH"
ELECTRON="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "\$ELECTRON" ]; then
  osascript -e 'display alert "Shorts Studio" message "Electron is not installed. In the project folder run: npm install"'
  exit 1
fi
exec "\$ELECTRON" "$ROOT" >> "/tmp/shorts-studio.log" 2>&1
LAUNCH
chmod +x "$CON/MacOS/ShortsStudio"

# Refresh Finder's icon cache for the new bundle.
touch "$APP"
echo "Built: $APP"
