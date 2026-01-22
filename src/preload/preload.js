const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (next) => ipcRenderer.invoke('settings:set', next),
    update: (next) => ipcRenderer.invoke('settings:update', next),
    open: () => ipcRenderer.invoke('settings:open')
  },
  backups: {
    save: (payload) => ipcRenderer.invoke('backups:save', payload),
    list: (station) => ipcRenderer.invoke('backups:list', { station }),
    read: (path) => ipcRenderer.invoke('backups:read', { path }),
    cleanup: (payload) => ipcRenderer.invoke('backups:cleanup', payload)
  },
  notify: (payload) => ipcRenderer.invoke('notify', payload)
});

console.log('[APP] api exposed');
