const { app, ipcMain, Notification, shell } = require('electron');
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
    settings: defaultSettings
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

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const backupDir = (station) => path.join(app.getPath('userData'), 'backups', station);
const INTERNAL_EXCEL_DEFAULT = 'meigi-spot-latest.xlsx';
const INTERNAL_EXCEL_CANDIDATES = [
  'event.xlsx',
  'event.xls',
  'meigi-spot.xlsx',
  'meigi-spot.xls',
  'meigi.xlsx',
  'meigi.xls',
  INTERNAL_EXCEL_DEFAULT,
  path.join('excel', 'latest.xlsx')
];

const statFile = async (filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { exists: false, size: null, mtimeMs: null };
  }
};

const findExistingInternalExcel = async () => {
  const baseDir = app.getPath('userData');
  for (const name of INTERNAL_EXCEL_CANDIDATES) {
    const filePath = path.isAbsolute(name) ? name : path.join(baseDir, name);
    const stat = await statFile(filePath);
    if (stat.exists) {
      return { path: filePath, stat };
    }
  }

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const excelFiles = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.xls') continue;
      const filePath = path.join(baseDir, entry.name);
      const stat = await fs.stat(filePath);
      excelFiles.push({ path: filePath, stat });
    }
    excelFiles.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return excelFiles[0] || null;
  } catch {
    return null;
  }
};

const resolveInternalExcelPath = async () => {
  const existing = await findExistingInternalExcel();
  if (existing?.path) return existing.path;
  return path.join(app.getPath('userData'), INTERNAL_EXCEL_DEFAULT);
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
  ipcMain.handle('settings:update', (_event, next) => {
    const merged = deepMerge(getSettings(), next);
    store.set('settings', merged);
    return merged;
  });

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

  ipcMain.handle('excel:read-internal', async () => {
    const existing = await findExistingInternalExcel();
    const fallbackPath = await resolveInternalExcelPath();
    const targetPath = existing?.path || fallbackPath;
    const stat = existing?.stat || (await statFile(targetPath));
    if (!stat.exists) {
      return { path: targetPath, exists: false, size: stat.size, mtimeMs: stat.mtimeMs };
    }
    const data = await fs.readFile(targetPath);
    return { path: targetPath, exists: true, size: stat.size, mtimeMs: stat.mtimeMs, data };
  });

  ipcMain.handle('excel:save-internal', async (_event, { buffer }) => {
    if (!buffer) {
      throw new Error('No buffer provided');
    }
    const targetPath = await resolveInternalExcelPath();
    await ensureDir(path.dirname(targetPath));
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(new Uint8Array(buffer));
    const tmpPath = `${targetPath}.tmp`;
    await fs.writeFile(tmpPath, payload);
    await fs.rename(tmpPath, targetPath);
    const stat = await fs.stat(targetPath);
    return { path: targetPath, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  ipcMain.handle('notify', (_event, { title, body }) => {
    if (!Notification.isSupported()) {
      return { ok: false };
    }
    new Notification({ title, body }).show();
    return { ok: true };
  });
};

module.exports = { registerIpc };
