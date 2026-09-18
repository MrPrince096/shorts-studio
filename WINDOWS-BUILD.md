# Building the Windows version

The app code is now cross-platform (ffmpeg, PATH handling, hardware scan, and
the macOS-only menus are guarded). A Windows installer must be **built and
tested on a Windows PC** — it can't be produced or verified from a Mac.

## Build it (on Windows 10/11, x64)

1. Install [Node.js LTS](https://nodejs.org) and [Git](https://git-scm.com).
2. In a terminal:
   ```powershell
   git clone https://github.com/MrPrince096/shorts-studio
   cd shorts-studio
   npm install
   npm run dist:win
   ```
3. The installer lands in `dist-app\` as **`Shorts Studio Setup <version>.exe`**
   (an NSIS installer — the user picks the install folder).

`npm install` on Windows automatically pulls `@remotion/compositor-win32-x64`
(the optional dependency), which ships **`ffmpeg.exe` + its DLLs** — so the
Windows app renders with no separate ffmpeg install, the same way the Mac build
bundles ffmpeg.

## What works on Windows out of the box

- The full studio UI, Assistant chat, projects, editor.
- **Rendering** (bundled ffmpeg + Remotion; first render downloads a headless browser once).
- **Cloud AI** — Pexels real footage, Pollinations images, Gemini/OpenAI scripts, fal.ai, Higgsfield.
- Data is stored under `%APPDATA%\Shorts Studio` (Electron handles this automatically).

## Not yet on Windows (macOS-only today)

The **fully-local/offline AI** stack uses macOS shell scripts:
- `local-image-server/*.sh` (ComfyUI/SDXL), `local-voice-server/*.sh` (XTTS/Kokoro/Whisper),
  and the `start-local-servers.command` one-click launcher.

To bring local AI to Windows, these need PowerShell/`.bat` equivalents (ComfyUI,
Python venvs, and Ollama all run on Windows — it's a porting task, not a
limitation). Until then, the Windows build uses the **cloud** providers, which
cover images, footage, scripts, and voice.

## Voice / edge-tts

The default cloud voice uses `edge-tts` (a Python tool). On Windows:
`pip install edge-tts`. Or use a cloud voice key. (Same one-time step as macOS.)
