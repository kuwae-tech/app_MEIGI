// main.js (FULL REPLACE)
// 名義SPOT管理 - Electron main process (packaged-safe)
// - Avoid relying on dist/main.js or src/main.js existing inside app.asar
// - Find an HTML entry and open it
// - Keep security sane (contextIsolation on / nodeIntegration off)

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function createMainWindow() {
  const preload = firstExisting([
    path.join(__dirname, "preload.js"),
    path.join(__dirname, "src", "preload", "preload.js"),
    path.join(__dirname, "src", "preload.js"),
    path.join(__dirname, "dist", "preload.js"),
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

  // HTML entry candidates (adjust as needed)
  const html = firstExisting([
    // typical renderer locations
    path.join(__dirname, "renderer", "index.html"),
    path.join(__dirname, "renderer", "prototype.html"),

    // if you keep a single HTML at repo root (seen in your tree screenshot)
    path.join(__dirname, "名義SPOT進捗チェッカー.html"),

    // fallback candidates
    path.join(__dirname, "dist", "index.html"),
    path.join(__dirname, "index.html"),
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
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
