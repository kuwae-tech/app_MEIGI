// main.js
// 名義SPOT管理 - Electron main process
// - Single entry for main/preload/renderer to avoid path drift
// - Always open settings in renderer modal (no extra windows)

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { registerIpc } = require("./src/main/ipc");

const APP_ID = "com.meigi.spot.kanri";

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
