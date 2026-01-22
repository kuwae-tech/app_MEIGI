// main.js (FULL REPLACE)
// 名義SPOT管理 - Electron main process (packaged-safe)
// - Avoid relying on dist/main.js or src/main.js existing inside app.asar
// - Find an HTML entry and open it
// - Keep security sane (contextIsolation on / nodeIntegration off)

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { registerIpc } = require("./src/main/ipc");

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

let mainWindow = null;
let settingsWindow = null;

const resolvePreload = () =>
  firstExisting([
    path.join(__dirname, "preload.js"),
    path.join(__dirname, "src", "preload", "preload.js"),
    path.join(__dirname, "dist", "preload.js"),
  ]);

const resolveHtml = () =>
  firstExisting([
    // typical renderer locations
    path.join(__dirname, "renderer", "index.html"),
    path.join(__dirname, "renderer", "prototype.html"),

    // if you keep a single HTML at repo root (seen in your tree screenshot)
    path.join(__dirname, "名義SPOT進捗チェッカー.html"),

    // fallback candidates
    path.join(__dirname, "dist", "index.html"),
    path.join(__dirname, "index.html"),
  ]);

function createMainWindow() {
  const preload = resolvePreload();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preload || undefined,
    },
  });

  win.once("ready-to-show", () => win.show());
  mainWindow = win;

  // HTML entry candidates (adjust as needed)
  const html = resolveHtml();

  if (!html) {
    const msg =
      "App entry HTML was not found inside the packaged app.\n\n" +
      "Tried:\n" +
      [
        "renderer/index.html",
        "renderer/prototype.html",
        "名義SPOT進捗チェッカー.html",
        "dist/index.html",
        "index.html",
      ]
        .map((s) => `- ${s}`)
        .join("\n") +
      "\n\n" +
      `__dirname=${__dirname}\n`;
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(`<pre style="white-space:pre-wrap">${msg}</pre>`)
    );
    return;
  }

  win.loadFile(html);
}

app.whenReady().then(() => {
  const preload = resolvePreload();
  console.log("[APP] preload path", preload || "not found");
  registerIpc();
  console.log("[APP] ipc handlers registered");
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

ipcMain.handle("settings:open", async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return { ok: true };
  }
  const preload = resolvePreload();
  const html = resolveHtml();
  if (!html) {
    return { ok: false, reason: "settings html not found" };
  }
  settingsWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: preload || undefined,
    },
  });
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(html, { query: { settings: "1" } });
  console.log("[APP] settings window opened");
  return { ok: true };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
