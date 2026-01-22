// main.js
// 名義SPOT管理 - Electron main process
// - Single entry for main/preload/renderer to avoid path drift
// - Always open settings in renderer modal (no extra windows)

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { registerIpc } = require("./src/main/ipc");

const APP_ID = "com.meigi.spot.kanri";
const QUIT_FALLBACK_DELAY_MS = 1500;

let mainWindow;
let isQuitting = false;
let quitTimer;
let quitPending = false;

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

const requestAppQuit = (source) => {
  if (isQuitting) {
    console.log(`[MAIN] quit already in progress (${source})`);
    return;
  }
  console.log(`[MAIN] quit requested: ${source}`);
  if (source === "window-close") {
    if (quitPending) {
      console.log("[MAIN] quit already pending (window-close)");
      return;
    }
    quitPending = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("app:prepare-quit");
    }
    return;
  }

  quitPending = false;
  isQuitting = true;
  if (source !== "ipc" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:prepare-quit");
  }
  app.quit();
  clearTimeout(quitTimer);
  quitTimer = setTimeout(() => {
    console.warn("[MAIN] fallback app.exit(0)");
    app.exit(0);
  }, QUIT_FALLBACK_DELAY_MS);
};

function createMainWindow() {
  const appPath = app.getAppPath();
  const preload = firstExisting([
    path.join(appPath, "src", "preload", "preload.js"),
    path.join(appPath, "preload.js"),
  ]);

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
  win.on("close", (event) => {
    console.log("[MAIN] mainWindow close");
    if (isQuitting) {
      console.log("[MAIN] mainWindow close: allow (isQuitting)");
      return;
    }
    event.preventDefault();
    console.log("[MAIN] mainWindow close prevented: initiating quit");
    requestAppQuit("window-close");
  });

  mainWindow = win;

  const html = firstExisting([
    path.join(appPath, "renderer", "index.html"),
    path.join(appPath, "renderer", "prototype.html"),
    path.join(appPath, "名義SPOT進捗チェッカー.html"),
    path.join(appPath, "dist", "index.html"),
    path.join(appPath, "index.html"),
  ]);

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
      `appPath=${appPath}\n`;
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(`<pre style="white-space:pre-wrap">${msg}</pre>`)
    );
    return;
  }

  win.loadFile(html);
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();

  ipcMain.on("app:quit", () => {
    console.log("[MAIN] ipc app:quit");
    requestAppQuit("ipc");
  });
  ipcMain.on("app:cancel-quit", () => {
    console.log("[MAIN] ipc app:cancel-quit");
    quitPending = false;
    isQuitting = false;
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  console.log("[MAIN] handlers ready: app:quit, window:close, before-quit, will-quit, window-all-closed");
});

app.on("before-quit", () => {
  console.log("[MAIN] before-quit");
  isQuitting = true;
});

app.on("will-quit", () => {
  console.log("[MAIN] will-quit");
});

app.on("window-all-closed", () => {
  console.log("[MAIN] window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
