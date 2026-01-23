const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const Store = require('electron-store');

const defaultSettings = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  shareEnabled: false,
  notify: {
    mode: 'weekly',
    thresholdDays: 14,
    weekday: 1,
    timeWeekly: '09:30',
    timeDaily: '09:30',
    intervalHours: 6,
    lastNotifiedAt: null
  },
  backup: {
    retentionDays: 7
  }
};

const store = new Store({
  name: 'meigi-spot-settings',
  defaults: {
    settings: defaultSettings,
    logs: []
  }
});

const deepMerge = (base, next) => {
  if (Array.isArray(base) || Array.isArray(next)) return next ?? base;
  if (typeof base !== 'object' || base === null) return next ?? base;
  const out = { ...base };
  if (!next || typeof next !== 'object') return out;
  for (const [key, value] of Object.entries(next)) {
    out[key] = deepMerge(base[key], value);
  }
  return out;
};

const getSettings = () => {
  const stored = store.get('settings');
  return deepMerge(defaultSettings, stored);
};

const getLogs = () => {
  const stored = store.get('logs');
  return Array.isArray(stored) ? stored : [];
};

const setLogs = (next) => {
  const logs = Array.isArray(next) ? next : [];
  store.set('logs', logs);
  return logs;
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const backupDir = (station) => path.join(app.getPath('userData'), 'backups', station);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const buildExportHtml = ({ title, meta, columns, rows }) => {
  const headerCells = columns.map((label) => `<th>${escapeHtml(label)}</th>`).join('');
  const bodyRows = rows.map((row) => {
    const cells = row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || 'export')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN",
        "Hiragino Sans", "Meiryo", sans-serif;
      color: #111;
      margin: 24px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .meta {
      font-size: 12px;
      color: #555;
      margin-bottom: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 11px;
    }
    th, td {
      border: 1px solid #c8c8c8;
      padding: 6px 8px;
      vertical-align: top;
      word-break: break-word;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="title">${escapeHtml(title || '名義SPOT管理')}</div>
  <div class="meta">${escapeHtml(meta || '')}</div>
  <table>
    <thead>
      <tr>${headerCells}</tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
</body>
</html>`;
};

const parseBackupFiles = async (station) => {
  const dir = backupDir(station);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath);
      files.push({
        name: entry.name,
        path: filePath,
        mtimeMs: stat.mtimeMs
      });
    }
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
};

const cleanupBackups = async (retentionDays) => {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const stations = ['802', 'COCOLO'];
  for (const station of stations) {
    const files = await parseBackupFiles(station);
    for (const file of files) {
      if (file.mtimeMs < cutoff) {
        await shell.trashItem(file.path);
      }
    }
  }
};

const registerIpc = () => {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_event, next) => {
    const merged = deepMerge(getSettings(), next);
    store.set('settings', merged);
    return merged;
  });
  ipcMain.handle('settings:update', (_event, next) => {
    const merged = deepMerge(getSettings(), next);
    store.set('settings', merged);
    return merged;
  });
  ipcMain.handle('logs:get', () => getLogs());
  ipcMain.handle('logs:set', (_event, next) => setLogs(next));

  ipcMain.handle('backups:save', async (_event, { station, state }) => {
    const dir = backupDir(station);
    await ensureDir(dir);
    const stamp = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const name = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}-${pad(stamp.getMinutes())}-${pad(stamp.getSeconds())}_${station}.json`;
    const tmpPath = path.join(dir, `${name}.tmp`);
    const finalPath = path.join(dir, name);
    await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    await fs.rename(tmpPath, finalPath);
    return { path: finalPath };
  });

  ipcMain.handle('backups:list', async (_event, { station }) => {
    return parseBackupFiles(station);
  });

  ipcMain.handle('backups:read', async (_event, { path: filePath }) => {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  });

  ipcMain.handle('backups:cleanup', async (_event, { retentionDays }) => {
    await cleanupBackups(retentionDays);
    return { ok: true };
  });

  ipcMain.handle('notify', (_event, { title, body }) => {
    if (!Notification.isSupported()) {
      return { ok: false };
    }
    new Notification({ title, body }).show();
    return { ok: true };
  });

  ipcMain.handle('export:pdf', async (_event, payload) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'PDF書き出し',
      defaultPath: '名義SPOT管理_書き出し.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const html = buildExportHtml(payload || {});
    let printWin = null;
    try {
      printWin = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdfBuffer = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4'
      });
      await fs.writeFile(filePath, pdfBuffer);
      return { ok: true, path: filePath };
    } catch (error) {
      console.error('[export:pdf] failed', error);
      return { ok: false, error: error?.message };
    } finally {
      if (printWin) {
        printWin.close();
      }
    }
  });

  ipcMain.handle('export:excel', async (_event, payload) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Excel書き出し',
      defaultPath: payload?.suggestedName || '名義SPOT管理_書き出し.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    try {
      const buffer = payload?.buffer ? Buffer.from(payload.buffer) : null;
      if (!buffer) {
        return { ok: false, error: 'missing buffer' };
      }
      await fs.writeFile(filePath, buffer);
      return { ok: true, path: filePath };
    } catch (error) {
      console.error('[export:excel] failed', error);
      return { ok: false, error: error?.message };
    }
  });
};

module.exports = { registerIpc };
