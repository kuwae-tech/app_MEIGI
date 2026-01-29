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

const SUPABASE_PLACEHOLDER = {
  url: 'YOUR_SUPABASE_URL',
  anonKey: 'YOUR_SUPABASE_ANON_KEY'
};

let supabaseDefaultsPromise = null;
const loadSupabaseDefaults = async () => {
  if (!supabaseDefaultsPromise) {
    supabaseDefaultsPromise = (async () => {
      try {
        const filePath = path.join(__dirname, '..', '..', 'assets', 'supabase.default.json');
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
          url: typeof parsed.url === 'string' ? parsed.url.trim() : '',
          anonKey: typeof parsed.anonKey === 'string' ? parsed.anonKey.trim() : ''
        };
      } catch (error) {
        console.warn('[SETTINGS] supabase default load failed', error?.message || error);
        return null;
      }
    })();
  }
  return supabaseDefaultsPromise;
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

const getSettings = async () => {
  const stored = store.get('settings') || {};
  const settings = deepMerge(defaultSettings, stored);
  const defaults = await loadSupabaseDefaults();
  const storedUrl = typeof stored.supabaseUrl === 'string' ? stored.supabaseUrl.trim() : '';
  const storedKey = typeof stored.supabaseAnonKey === 'string' ? stored.supabaseAnonKey.trim() : '';
  const defaultUrl = typeof defaults?.url === 'string' ? defaults.url.trim() : '';
  const defaultKey = typeof defaults?.anonKey === 'string' ? defaults.anonKey.trim() : '';
  const hasStoredUrl = !!storedUrl;
  const hasStoredKey = !!storedKey;
  const hasDefaultUrl = !!defaultUrl && defaultUrl !== SUPABASE_PLACEHOLDER.url;
  const hasDefaultKey = !!defaultKey && defaultKey !== SUPABASE_PLACEHOLDER.anonKey;

  if (!hasStoredUrl && hasDefaultUrl) settings.supabaseUrl = defaultUrl;
  if (!hasStoredKey && hasDefaultKey) settings.supabaseAnonKey = defaultKey;

  const urlSource = hasStoredUrl ? 'saved' : hasDefaultUrl ? 'default' : 'placeholder';
  const keySource = hasStoredKey ? 'saved' : hasDefaultKey ? 'default' : 'placeholder';
  console.log(`[SETTINGS] supabase source url=${urlSource} key=${keySource}`);
  return settings;
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

const buildExportHtml = ({ title, meta, columns, rows, columnKeys, statusColorMap, statusRowKeys, dateHighlightMap, dateHighlightLevels }) => {
  const columnClassMap = {
    status: 'col-status',
    dateText: 'col-date',
    artist: 'col-artist',
    title: 'col-title',
    venue: 'col-venue',
    presale: 'col-presale',
    company: 'col-company',
    person: 'col-person',
    memo: 'col-memo'
  };
  const columnWidthMap = {
    status: '85px',
    dateText: '85px',
    artist: '120px',
    title: '180px',
    venue: '120px',
    presale: '75px',
    company: '130px',
    person: '90px',
    memo: '150px'
  };
  const headerCells = columns.map((label, index) => {
    const key = Array.isArray(columnKeys) ? columnKeys[index] : null;
    const className = key && columnClassMap[key] ? ` class="${escapeHtml(columnClassMap[key])}"` : '';
    return `<th${className}>${escapeHtml(label)}</th>`;
  }).join('');
  const colgroup = Array.isArray(columnKeys) && columnKeys.length
    ? `<colgroup>${columnKeys.map((key) => {
      const className = columnClassMap[key] ? ` class="${escapeHtml(columnClassMap[key])}"` : '';
      const width = columnWidthMap[key];
      const style = width ? ` style="width:${escapeHtml(width)}"` : '';
      return `<col${className}${style}>`;
    }).join('')}</colgroup>`
    : '';
  const statusColIndex = Array.isArray(columnKeys) ? columnKeys.indexOf('status') : -1;
  const dateColIndex = Array.isArray(columnKeys) ? columnKeys.indexOf('dateText') : -1;
  const statusStyles = statusColorMap && typeof statusColorMap === 'object'
    ? Object.entries(statusColorMap).map(([key, value]) => {
      if (!value?.bg) return '';
      const text = value.text ? `color: ${value.text};` : '';
      return `.status-cell-${key}{background:${value.bg};${text}}`;
    }).join('\n')
    : '';
  const dateStyles = dateHighlightMap && typeof dateHighlightMap === 'object'
    ? Object.entries(dateHighlightMap).map(([key, value]) => {
      if (!value) return '';
      return `.date-highlight-${key}{background:${value};}`;
    }).join('\n')
    : '';
  const bodyRows = rows.map((row, rowIndex) => {
    const statusKey = Array.isArray(statusRowKeys) ? statusRowKeys[rowIndex] : null;
    const dateLevel = Array.isArray(dateHighlightLevels) ? dateHighlightLevels[rowIndex] : null;
    const cells = row.map((cell, colIndex) => {
      const classNames = [];
      const key = Array.isArray(columnKeys) ? columnKeys[colIndex] : null;
      if (key && columnClassMap[key]) classNames.push(columnClassMap[key]);
      if (colIndex === statusColIndex && statusKey){
        classNames.push('status-cell', `status-cell-${statusKey}`);
      }
      if (colIndex === dateColIndex && dateLevel){
        classNames.push('date-highlight', `date-highlight-${dateLevel}`);
      }
      const className = classNames.length ? ` class="${classNames.map(escapeHtml).join(' ')}"` : '';
      return `<td${className}>${escapeHtml(cell)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const metaLines = [];
  if (meta?.station) metaLines.push(`ステーション: ${meta.station}`);
  if (meta?.generatedAt) metaLines.push(`出力日時: ${meta.generatedAt}`);
  if (typeof meta?.count === 'number') metaLines.push(`件数: ${meta.count}`);
  if (meta?.conditions) metaLines.push(`条件: ${meta.conditions}`);
  const metaHtml = metaLines.map((line) => `<div class="meta-line">${escapeHtml(line)}</div>`).join('');
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title || 'export')}</title>
  <style>
    @page { margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN",
        "Hiragino Sans", "Meiryo", sans-serif;
      color: #111;
      margin: 0;
    }
    .page {
      padding: 0;
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
    .meta-line + .meta-line {
      margin-top: 2px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10.5px;
    }
    th, td {
      border: 1px solid #c8c8c8;
      padding: 4px 6px;
      vertical-align: top;
      word-break: break-word;
      word-wrap: break-word;
    }
    .col-status {
      white-space: nowrap;
      word-break: keep-all;
      overflow-wrap: normal;
      line-height: 1.2;
    }
    .col-date {
      white-space: pre-line;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }
    .status-cell {
      font-weight: 600;
    }
    ${statusStyles}
    .date-highlight {
    }
    ${dateStyles}
    thead { display: table-header-group; }
    thead th {
      background: #f3f3f3;
      font-weight: 600;
    }
    tr { break-inside: avoid; page-break-inside: avoid; }
  </style>
</head>
<body>
  <div class="page">
    <div class="title">${escapeHtml(title || '名義SPOT管理')}</div>
    <div class="meta">${metaHtml}</div>
    <table>
      ${colgroup}
      <thead>
        <tr>${headerCells}</tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
  </div>
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
ipcMain.handle('settings:get', async () => getSettings());
ipcMain.handle('settings:set', async (_event, next) => {
  const merged = deepMerge(await getSettings(), next);
  store.set('settings', merged);
  return merged;
});
ipcMain.handle('settings:update', async (_event, next) => {
  const merged = deepMerge(await getSettings(), next);
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
