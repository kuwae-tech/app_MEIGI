const { contextBridge, ipcRenderer } = require('electron');

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (next) => ipcRenderer.invoke('settings:set', next)
  },
  logs: {
    get: () => ipcRenderer.invoke('logs:get'),
    set: (next) => ipcRenderer.invoke('logs:set', next)
  },
  backups: {
    save: (payload) => ipcRenderer.invoke('backups:save', payload),
    list: (station) => ipcRenderer.invoke('backups:list', { station }),
    read: (path) => ipcRenderer.invoke('backups:read', { path }),
    cleanup: (payload) => ipcRenderer.invoke('backups:cleanup', payload)
  },
  export: {
    pdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
    excel: (payload) => ipcRenderer.invoke('export:excel', payload)
  },
  notify: (payload) => ipcRenderer.invoke('notify', payload),
  app: {
    quit: () => {
      try {
        console.log('[PRELOAD] app.quit called');
      } catch {
        // ignore logging errors
      }
      ipcRenderer.send('app:quit');
    },
    onPrepareQuit: (handler) => {
      ipcRenderer.on('app:prepare-quit', () => {
        try {
          handler?.();
        } catch (error) {
          console.error('[PRELOAD] onPrepareQuit handler failed', error);
        }
      });
    },
    onRequestClose: (handler) => {
      ipcRenderer.on('app:request-close', (_event, payload) => {
        try {
          handler?.(payload);
        } catch (error) {
          console.error('[PRELOAD] onRequestClose handler failed', error);
        }
      });
    },
    sendRequestCloseResult: (payload) => {
      ipcRenderer.send('app:request-close:result', payload);
    }
  }
};

contextBridge.exposeInMainWorld('meigi', api);

try {
  console.log('[PRELOAD] exposed:', Object.keys(api));
} catch {
  // ignore logging errors
}
