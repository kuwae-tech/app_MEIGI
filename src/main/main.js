const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');

const APP_ID = 'com.meigi.spot.kanri';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '..', 'preload', 'preload.js')
    }
  });

  const indexPath = path.join(app.getAppPath(), 'renderer', 'index.html');
  win.loadFile(indexPath);
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
