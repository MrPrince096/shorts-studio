# Installing Shorts Studio on another Mac

You get a single file: **`Shorts Studio-1.0.0-arm64.dmg`** (Apple Silicon — M1 or newer).

## 1. Install (drag & drop)

1. Double-click the `.dmg`.
2. Drag **Shorts Studio** onto the **Applications** folder shortcut.
3. Eject the disk image.

## 2. First open (one-time Gatekeeper step)

The app isn't signed with a paid Apple Developer certificate, so macOS shows
*"Shorts Studio can't be opened because it is from an unidentified developer."*
That's expected. To allow it **once**:

- **Right-click** (or Control-click) the app in Applications → **Open** → **Open**.

(Or: System Settings → Privacy & Security → scroll down → **Open Anyway**.)

After the first launch it opens normally by double-click.

## 3. What works immediately

- The full studio UI, projects, editor, ideas, scripts.
- **Rendering** — a bundled ffmpeg ships inside the app; no Homebrew needed.
  (The very first render downloads a small headless-browser once — needs internet that one time.)
- **Cloud AI** — images (Pollinations) and scripts (add a free Gemini/OpenAI key in Settings) work over the internet.

The app scans the Mac on first run and picks a **performance tier** to match the
chip (Settings → System & performance).

## 4. Optional: fully-local / offline AI

Local voice + image + video models are large toolchains and aren't bundled.
To enable them on this Mac (one time):

1. Install **Ollama** (local LLM): https://ollama.com  → then it's auto-detected.
2. In **Settings → System & performance**, click **Download recommended models**
   — it pulls exactly what this Mac's tier needs (SDXL, LTX-Video, Kokoro, and
   the recommended LLM) with a progress bar.
3. Toggle **Local engines · on** in the top bar to run them.

> The default cloud voice uses `edge-tts`. If you want it, install once with
> `pip3 install edge-tts`. Otherwise use the local **Kokoro** voice after step 2.

## Where your data lives

Everything you create is stored in
`~/Library/Application Support/Shorts Studio/runtime` (videos in `out/`,
settings in `.env`). Deleting the app never touches your keys or projects.
