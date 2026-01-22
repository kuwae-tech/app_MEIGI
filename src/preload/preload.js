const { contextBridge, ipcRenderer } = require('electron');

const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (next) => ipcRenderer.invoke('settings:set', next)
  },
  data: {
    loadInitial: () => ipcRenderer.invoke('data:loadInitial'),
    saveExcel: (payload) => ipcRenderer.invoke('data:saveExcel', payload)
  },
  backups: {
    save: (payload) => ipcRenderer.invoke('backups:save', payload),
    list: (station) => ipcRenderer.invoke('backups:list', { station }),
    read: (path) => ipcRenderer.invoke('backups:read', { path }),
    cleanup: (payload) => ipcRenderer.invoke('backups:cleanup', payload)
  },
  notify: (payload) => ipcRenderer.invoke('notify', payload)
};

contextBridge.exposeInMainWorld('meigi', api);

try {
  console.log('[PRELOAD] exposed:', Object.keys(api));
} catch {
  // ignore logging errors
}
