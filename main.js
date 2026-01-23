// main.js
// 名義SPOT管理 - Electron main process
// - Single entry for main/preload/renderer to avoid path drift
// - Always open settings in renderer modal (no extra windows)

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { registerIpc } = require("./src/main/ipc");

const APP_ID = "com.meigi.spot.kanri";
const QUIT_FALLBACK_DELAY_MS = 1500;

let mainWindow;
let isQuitting = false;
let closeFlowInProgress = false;
let closeFlowFallbackActive = false;
let quitTimer;
let closeFlowTimer;

const CLOSE_REQUEST_TIMEOUT_MS = 1500;

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

const finalizeQuit = (source) => {
  if (isQuitting) {
    console.log(`[MAIN] quit already in progress (${source})`);
    return;
  }
  isQuitting = true;
  closeFlowInProgress = false;
  clearTimeout(closeFlowTimer);
  if (source === "ipc") {
    console.log("[MAIN] app:quit received; isQuitting=true");
  } else {
    console.log(`[MAIN] quit requested: ${source}`);
  }
  app.quit();
  clearTimeout(quitTimer);
  quitTimer = setTimeout(() => {
    console.warn("[MAIN] fallback app.exit(0) after timeout");
    app.exit(0);
  }, QUIT_FALLBACK_DELAY_MS);
};

const showFallbackCloseDialog = async () => {
  console.warn("[CLOSE] fallback dialog used");
  closeFlowFallbackActive = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "未保存の変更があります",
      message: "未保存の変更があります。保存せずに閉じますか？",
      buttons: ["キャンセル", "保存せず閉じる"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 1) {
      finalizeQuit("fallback");
    } else {
      closeFlowInProgress = false;
    }
  } catch (error) {
    console.error("[CLOSE] fallback dialog failed", error);
    finalizeQuit("fallback-error");
  } finally {
    clearTimeout(closeFlowTimer);
    closeFlowFallbackActive = false;
  }
};

const startCloseFlow = (source) => {
  if (closeFlowInProgress) return;
  closeFlowInProgress = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:request-close", { source });
    console.log("[CLOSE] request-close sent");
  } else {
    showFallbackCloseDialog();
    return;
  }
  clearTimeout(closeFlowTimer);
  closeFlowTimer = setTimeout(() => {
    if (!closeFlowInProgress) return;
    showFallbackCloseDialog();
  }, CLOSE_REQUEST_TIMEOUT_MS);
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
    console.log(`[CLOSE] onClose source=window-close isQuitting=${isQuitting} inProgress=${closeFlowInProgress}`);
    if (isQuitting) {
      console.log("[MAIN] mainWindow close: allow (isQuitting)");
      return;
    }
    if (closeFlowInProgress) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    startCloseFlow("window-close");
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
    finalizeQuit("ipc");
  });

  ipcMain.on("app:request-close:result", (_event, payload) => {
    const decision = payload?.decision;
    console.log(`[CLOSE] request-close result decision=${decision}`);
    if (!closeFlowInProgress || closeFlowFallbackActive) return;
    if (decision === "cancel") {
      closeFlowInProgress = false;
      clearTimeout(closeFlowTimer);
      return;
    }
    if (decision === "close_no_save" || decision === "close_after_save") {
      finalizeQuit(`request-close:${decision}`);
      return;
    }
    closeFlowInProgress = false;
    clearTimeout(closeFlowTimer);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  console.log("[MAIN] handlers ready: app:quit, window:close, before-quit, will-quit, window-all-closed");
});

app.on("before-quit", (event) => {
  console.log(`[CLOSE] onClose source=before-quit isQuitting=${isQuitting} inProgress=${closeFlowInProgress}`);
  if (isQuitting) return;
  if (closeFlowInProgress) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  startCloseFlow("before-quit");
});

app.on("will-quit", () => {
  console.log("[MAIN] will-quit");
});

app.on("window-all-closed", () => {
  console.log("[MAIN] window-all-closed");
  if (process.platform !== "darwin") app.quit();
});
