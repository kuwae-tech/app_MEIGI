const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meigiBridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (next) => ipcRenderer.invoke('settings:update', next),
  saveBackup: (payload) => ipcRenderer.invoke('backups:save', payload),
  listBackups: (station) => ipcRenderer.invoke('backups:list', { station }),
  readBackup: (path) => ipcRenderer.invoke('backups:read', { path }),
  cleanupBackups: (payload) => ipcRenderer.invoke('backups:cleanup', payload),
  readInternalExcel: () => ipcRenderer.invoke('excel:read-internal'),
  saveInternalExcel: (payload) => ipcRenderer.invoke('excel:save-internal', payload),
  notify: (payload) => ipcRenderer.invoke('notify', payload)
});
