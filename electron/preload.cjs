// Expose the native Electron clipboard to the page, so "copy" always works in
// the desktop app regardless of web clipboard permissions.
const { contextBridge, clipboard } = require("electron");
try {
  contextBridge.exposeInMainWorld("__native", {
    copy: (text) => { try { clipboard.writeText(String(text == null ? "" : text)); return true; } catch { return false; } },
  });
} catch {}
