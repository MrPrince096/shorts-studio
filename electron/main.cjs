// Shorts Studio — Electron desktop wrapper.
// Runs the existing Express server (server.mjs) as a child process and shows
// the UI in a native window. No browser needed. Fully local/offline.
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

// ---------------------------------------------------------------------------
// Portability: in a packaged .app the code lives read-only inside the bundle
// (Contents/Resources/app). The server + renderer must WRITE (out/, uploads,
// .env, series/…) and Remotion needs one writable project dir. So on first run
// we lay out a writable "store" in Application Support: copy the code there and
// symlink node_modules back to the read-only bundle (no multi-hundred-MB copy).
// In dev (not packaged) we just run from the project folder as before.
const BUNDLE = path.join(__dirname, "..");            // dev: project; packaged: Resources/app
const PORT = process.env.PORT || 4321;
const URL = `http://localhost:${PORT}`;

// Code files/dirs that make up the app (everything except node_modules and the
// runtime data dirs). Re-copied when the app version changes; data is left alone.
const CODE_ENTRIES = [
  "server.mjs", "package.json", "remotion.config.ts",
  "scripts", "src", "web", "electron", "build",
  "local-image-server", "local-voice-server",
  "start-local-servers.command", "stop-local-servers.command",
];

function prepareStore() {
  if (!app.isPackaged) return BUNDLE; // dev: run in place
  // Name the data folder "Shorts Studio" (not the package name) — set before
  // we read userData, since getPath derives the folder from the app name.
  try { app.setName("Shorts Studio"); } catch {}
  const store = path.join(app.getPath("appData"), "Shorts Studio", "runtime");
  fs.mkdirSync(store, { recursive: true });
  const verFile = path.join(store, ".appversion");
  const cur = app.getVersion();
  let prev = "";
  try { prev = fs.readFileSync(verFile, "utf8").trim(); } catch {}
  if (prev !== cur) {
    for (const e of CODE_ENTRIES) {
      const from = path.join(BUNDLE, e);
      if (!fs.existsSync(from)) continue;
      try { fs.rmSync(path.join(store, e), { recursive: true, force: true }); } catch {}
      try { fs.cpSync(from, path.join(store, e), { recursive: true }); } catch (err) { console.error("copy", e, err.message); }
    }
    try { fs.writeFileSync(verFile, cur); } catch {}
  }
  // node_modules: symlink to the read-only bundle copy (the server only reads it).
  const nmLink = path.join(store, "node_modules");
  const nmReal = path.join(BUNDLE, "node_modules");
  try {
    const ok = fs.existsSync(nmLink) && fs.realpathSync(nmLink) === fs.realpathSync(nmReal);
    if (!ok) { try { fs.rmSync(nmLink, { recursive: true, force: true }); } catch {} fs.symlinkSync(nmReal, nmLink, "dir"); }
  } catch (err) { console.error("node_modules link", err.message); }
  // Seed a public/ dir with the shipped assets (bg music beds) if absent.
  const pub = path.join(store, "public");
  if (!fs.existsSync(pub)) { try { fs.cpSync(path.join(BUNDLE, "public"), pub, { recursive: true }); } catch {} }
  return store;
}

const ROOT = prepareStore();

// Bundled ffmpeg/ffprobe ship inside Remotion's compositor package (so a fresh
// Mac needs no Homebrew ffmpeg). Location, if present.
const IS_WIN = process.platform === "win32";
const FFEXE = IS_WIN ? "ffmpeg.exe" : "ffmpeg";
function compositorDir() {
  const arches = IS_WIN ? ["win32-x64"] : ["darwin-arm64", "darwin-x64"];
  for (const a of arches) {
    const d = path.join(ROOT, "node_modules", "@remotion", "compositor-" + a);
    if (fs.existsSync(path.join(d, FFEXE))) return d;
  }
  return "";
}

// Is a system ffmpeg already on the user's normal PATH? If so we use it and
// leave the environment untouched — never override a working ffmpeg.
function hasSystemFfmpeg() {
  const dirs = IS_WIN ? [] : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", `${process.env.HOME}/.local/bin`];
  const extra = (process.env.PATH || "").split(path.delimiter);
  return [...dirs, ...extra].some((d) => d && fs.existsSync(path.join(d, FFEXE)));
}

// Only when there's NO system ffmpeg: expose the bundled binaries through tiny
// wrapper scripts that set DYLD_LIBRARY_PATH *for themselves* (the compositor
// ffmpeg loads its sibling libav*.dylib by bare name). Setting it inside the
// wrapper — not as a global env var — keeps every OTHER subprocess (python,
// edge-tts, node…) on a clean, unpolluted environment. Returns the bin dir,
// or "" if a system ffmpeg exists or the bundle isn't found.
function ffmpegBinDir() {
  if (hasSystemFfmpeg()) return "";
  const comp = compositorDir();
  if (!comp) return "";
  // Windows: the bundled ffmpeg.exe loads its sibling DLLs from its own folder,
  // so just put that folder on PATH — no shims, no DYLD.
  if (IS_WIN) return comp;
  const bin = path.join(ROOT, "runtime-bin");
  try {
    fs.mkdirSync(bin, { recursive: true });
    for (const tool of ["ffmpeg", "ffprobe"]) {
      const shim = path.join(bin, tool);
      const body = `#!/bin/bash\nexport DYLD_LIBRARY_PATH="${comp}:$DYLD_LIBRARY_PATH"\nexec "${comp}/${tool}" "$@"\n`;
      fs.writeFileSync(shim, body); fs.chmodSync(shim, 0o755);
    }
    return bin;
  } catch { return ""; }
}

// Some Macs crash Electron's GPU/network service process (exit_code=15) which
// leaves the window blank or unopened. This is a plain web UI — it doesn't need
// GPU acceleration — so turn it off for a rock-solid window.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
// Unsigned/relocated Electron on macOS can have its sandboxed helper processes
// (GPU, network) killed (exit_code=15); disabling the sandbox keeps them alive.
app.commandLine.appendSwitch("no-sandbox");

let serverProc = null;
let win = null;

// Apps launched from Finder get a bare PATH that usually omits node/ffmpeg/python.
// Resolve the user's real login-shell PATH so the render pipeline (node, npx,
// ffmpeg, ffprobe, python3, remotion) is found. Falls back to common locations.
function resolveUserPath() {
  const sep = path.delimiter;
  if (IS_WIN) {
    // Windows: the process PATH already carries the user's tools; nothing to shell out for.
    return process.env.PATH || "";
  }
  const common = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", `${process.env.HOME}/.local/bin`];
  let shellPath = "";
  try {
    const sh = process.env.SHELL || "/bin/zsh";
    shellPath = execSync(`${sh} -ilc 'echo -n $PATH'`, { timeout: 4000 }).toString().trim();
  } catch {}
  const parts = new Set([...(shellPath ? shellPath.split(sep) : []), ...(process.env.PATH ? process.env.PATH.split(sep) : []), ...common].filter(Boolean));
  return [...parts].join(sep);
}

// Env for the server + render subprocesses. Uses the user's real PATH; only if
// there's no system ffmpeg do we prepend the bundled-ffmpeg shim dir. No global
// DYLD_LIBRARY_PATH — the shims set it just for themselves — so python/edge-tts
// and every other tool run in a clean, unmodified environment.
function childEnv(extra = {}) {
  const ffdir = ffmpegBinDir();
  const base = resolveUserPath();
  const PATH = ffdir ? `${ffdir}${path.delimiter}${base}` : base;
  return { ...process.env, PATH, ...extra };
}

let restarts = 0;
let serverUpSince = 0;
function startServer() {
  // Use the same Node that launched Electron so the server runs identically.
  serverProc = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    cwd: ROOT,
    env: childEnv({ PORT: String(PORT), ELECTRON_RUN_AS_NODE: "1", SHORTS_DESKTOP: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverUpSince = Date.now();
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (app.isQuiting || !code) return;
    // If something else already answers on the port (e.g. another window or a
    // dev server), just use it — no need for our own engine or an error.
    http.get(URL + "/api/config", (res) => { res.destroy(); if (win) win.reload(); })
      .on("error", () => {
        // Port is genuinely dead — auto-restart the engine (with a rapid-fail cap).
        if (serverUpSince && Date.now() - serverUpSince > 12000) restarts = 0; // was stable, reset
        if (restarts < 6) {
          restarts++;
          setTimeout(() => { startServer(); waitForServer(15000).then(() => win && win.reload()).catch(() => {}); }, 700);
        } else if (!app.isQuiting) {
          dialog.showErrorBox("Shorts Studio", `The engine keeps stopping (code ${code}). Another program may be using port ${PORT} — quit any other Shorts Studio window and reopen.`);
        }
      })
      .setTimeout(2500, function () { this.destroy(); });
  });
}

function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(URL + "/api/config", (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return reject(new Error("Server did not start in time."));
        setTimeout(tick, 400);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0e0e12",
    title: "Shorts Studio",
    // A normal macOS title bar: the window controls sit in their own bar and no
    // longer overlap the "Shorts Studio" logo in the app's sidebar.
    titleBarStyle: "default",
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    show: false,
  });

  // Allow microphone access (for the Assistant's voice input) inside the app.
  try {
    win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media" || permission === "audioCapture"));
  } catch {}

  win.loadURL(URL);
  win.once("ready-to-show", () => win.show());
  // Fallbacks: show even if ready-to-show is delayed, and retry on a failed load.
  setTimeout(() => { if (win && !win.isVisible()) win.show(); }, 3000);
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -3) return; // aborted (normal during redirects)
    setTimeout(() => win && win.loadURL(URL), 800);
  });
  win.webContents.on("render-process-gone", () => {
    setTimeout(() => win && win.reload(), 500);
  });

  // Open external links (e.g. "Get a free key →") in the real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(URL)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

// Run one of the local-server launcher scripts (detached, full PATH) and report.
function runLocalScript(scriptName, label) {
  const script = path.join(ROOT, scriptName);
  const p = spawn("bash", [script], {
    cwd: ROOT, detached: true,
    env: childEnv(),
    stdio: "ignore",
  });
  p.unref();
  dialog.showMessageBox(win, {
    type: "info", title: "Shorts Studio",
    message: label,
    detail: scriptName.startsWith("start")
      ? "Voice (XTTS) and images (ComfyUI) are starting in the background. First load takes ~30–60s each. You can keep working — cloud mode works immediately."
      : "Local voice and image servers have been stopped. Cloud voice/images still work.",
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    // The one-click local-AI servers use macOS .command/bash scripts — only on Mac.
    ...(isMac ? [{
      label: "Local Servers",
      submenu: [
        { label: "Start voice + images (offline mode)", click: () => runLocalScript("start-local-servers.command", "Starting local servers…") },
        { label: "Stop local servers", click: () => runLocalScript("stop-local-servers.command", "Stopping local servers…") },
        { type: "separator" },
        { label: "What is this?", click: () => dialog.showMessageBox(win, { type: "info", title: "Local Servers", message: "Fully-offline generation", detail: "Start these to generate voice (XTTS) and AI images (ComfyUI/SDXL) entirely on your Mac — no internet, no keys. Without them, Shorts Studio uses cloud voice/images instead." }) },
      ],
    }] : []),
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Open in Browser", click: () => shell.openExternal(URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  app.setName("Shorts Studio");
  if (process.platform === "darwin" && app.dock) {
    try { app.dock.setIcon(path.join(ROOT, "build", "icon.png")); } catch {}
  }
  startServer();
  buildMenu();
  try {
    await waitForServer();
  } catch (e) {
    dialog.showErrorBox("Shorts Studio", "Could not start the engine.\n\n" + e.message);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  if (serverProc) {
    try { serverProc.kill("SIGTERM"); } catch {}
  }
});
