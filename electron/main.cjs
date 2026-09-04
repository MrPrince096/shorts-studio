// Shorts Studio — Electron desktop wrapper.
// Runs the existing Express server (server.mjs) as a child process and shows
// the UI in a native window. No browser needed. Fully local/offline.
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 4321;
const URL = `http://localhost:${PORT}`;

let serverProc = null;
let win = null;

// Apps launched from Finder get a bare PATH that usually omits node/ffmpeg/python.
// Resolve the user's real login-shell PATH so the render pipeline (node, npx,
// ffmpeg, ffprobe, python3, remotion) is found. Falls back to common locations.
function resolveUserPath() {
  const common = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", `${process.env.HOME}/.local/bin`];
  let shellPath = "";
  try {
    const sh = process.env.SHELL || "/bin/zsh";
    shellPath = execSync(`${sh} -ilc 'echo -n $PATH'`, { timeout: 4000 }).toString().trim();
  } catch {}
  const parts = new Set([...(shellPath ? shellPath.split(":") : []), ...(process.env.PATH ? process.env.PATH.split(":") : []), ...common].filter(Boolean));
  return [...parts].join(":");
}

function startServer() {
  // Use the same Node that launched Electron so the server runs identically.
  serverProc = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PATH: resolveUserPath(), PORT: String(PORT), ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProc.on("exit", (code) => {
    serverProc = null;
    if (code && code !== 0 && !app.isQuiting) {
      dialog.showErrorBox("Shorts Studio", `The engine stopped unexpectedly (code ${code}). Restart the app.`);
    }
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
    titleBarStyle: "hiddenInset",
    icon: path.join(ROOT, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    show: false,
  });

  win.loadURL(URL);
  win.once("ready-to-show", () => win.show());

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
    env: { ...process.env, PATH: resolveUserPath() },
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
    {
      label: "Local Servers",
      submenu: [
        { label: "Start voice + images (offline mode)", click: () => runLocalScript("start-local-servers.command", "Starting local servers…") },
        { label: "Stop local servers", click: () => runLocalScript("stop-local-servers.command", "Stopping local servers…") },
        { type: "separator" },
        { label: "What is this?", click: () => dialog.showMessageBox(win, { type: "info", title: "Local Servers", message: "Fully-offline generation", detail: "Start these to generate voice (XTTS) and AI images (ComfyUI/SDXL) entirely on your Mac — no internet, no keys. Without them, Shorts Studio uses cloud voice/images instead." }) },
      ],
    },
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
