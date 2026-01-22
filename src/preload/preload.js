const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meigiBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  saveBackup: (payload) => ipcRenderer.invoke('backups:save', payload),
  listBackups: (station) => ipcRenderer.invoke('backups:list', { station }),
  readBackup: (path) => ipcRenderer.invoke('backups:read', { path }),
  cleanupBackups: (payload) => ipcRenderer.invoke('backups:cleanup', payload),
  notify: (payload) => ipcRenderer.invoke('notify', payload)
});
