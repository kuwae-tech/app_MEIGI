(() => {
  const bridge = window.meigi;
  if (!bridge) {
    console.warn('[APP] preload bridge not available');
    return;
  }

  const TAGS = {
    app: 'APP',
    settings: 'SETTINGS',
    auth: 'AUTH',
    share: 'SHARE',
    presence: 'PRESENCE',
    reset: 'RESET',
    backup: 'BACKUP',
    notify: 'NOTIFY'
  };

  const log = (tag, message, extra) => {
    if (extra !== undefined) {
      console.log(`[${tag}] ${message}`, extra);
    } else {
      console.log(`[${tag}] ${message}`);
    }
  };

  const defaultSettings = {
    supabaseUrl: '',
    supabaseAnonKey: '',
    shareEnabled: false,
    auth: {
      pseudoEmailDomain: 'meigi.local',
      lastLoginId: '',
      lastLoginType: ''
    },
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

  const $ = (id) => document.getElementById(id);
  const on = (id, eventName, handler, opts) => {
    const el = $(id);
    if (!el) {
      console.warn(`[APP] element missing: ${id}`);
      return;
    }
    el.addEventListener(eventName, handler, opts);
  };
  const val = (id) => {
    const el = $(id);
    return typeof el?.value === 'string' ? el.value.trim() : '';
  };
  const onlinePill = () => $('onlinePill');

  let settings = null;
  let logEntries = [];
  let logSearchQuery = '';
  let supabaseClient = null;
  let supabaseAuthSub = null;
  let session = null;
  let presenceChannel = null;
  let notifyTimer = null;
  let notifyInterval = null;
  let displayName = null;
  let presenceEditors = new Map();
  let currentEditingRecordId = null;
  let schemaErrorNotified = false;
  let selectedBackups = { '802': null, 'COCOLO': null };

  const LOG_RETENTION_DAYS = 7;
  const LOG_MAX_ENTRIES = 3000;

  const pad2 = (v) => String(v).padStart(2, '0');
  const formatDateKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const formatTimeLabel = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

  const getCurrentStation = () => {
    try {
      const v = localStorage.getItem('meigi.station') || '802';
      return v === 'COCOLO' ? 'COCOLO' : '802';
    } catch {
      return '802';
    }
  };

  const updateOnlinePill = (names) => {
    const pill = onlinePill();
    if (!pill) return;
    const list = names && names.length ? names.join(', ') : '-';
    const count = names ? names.length : 0;
    pill.textContent = `オンライン: ${count} ${list === '-' ? '' : `(${list})`}`.trim();
  };

  const setShareStatus = (text, ok) => {
    const pill = $('shareStatusPill');
    if (!pill) return;
    pill.textContent = text;
    pill.classList.toggle('diagOk', !!ok);
    pill.classList.toggle('diagNg', ok === false);
  };

  const setLoginStatus = (text) => {
    const pill = $('loginUserPill');
    if (pill) pill.textContent = text;
  };

  const setLoginError = (message) => {
    const el = $('loginErrorText');
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.style.display = '';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  };

  const getPseudoEmailDomain = () => settings?.auth?.pseudoEmailDomain || defaultSettings.auth.pseudoEmailDomain;

  const normalizeLoginId = (value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return { error: 'ログインIDを入力してください。' };
    if (normalized.includes('@')) return { error: 'ログインIDに「@」は使用できません。' };
    if (!/^[a-z0-9._-]+$/.test(normalized)) {
      return { error: 'ログインIDは英数字と「.」「_」「-」のみ使用できます。' };
    }
    return { value: normalized };
  };

  const getPreferredLoginLabel = () => {
    const lastLoginType = settings?.auth?.lastLoginType;
    const lastLoginId = settings?.auth?.lastLoginId;
    if (lastLoginType === 'id' && lastLoginId) {
      return `ログイン中: ログインID: ${lastLoginId}`;
    }
    if (displayName) return `ログイン中: ${displayName}`;
    if (session?.user?.email) return `ログイン中: ${session.user.email}`;
    return 'ログイン中';
  };

  const updateAuthUI = (nextSession) => {
    const isLoggedIn = !!nextSession;
    const emailInput = $('loginEmailInput');
    const passwordInput = $('loginPasswordInput');
    const loginBtn = $('loginBtn');
    const logoutBtn = $('logoutBtn');
    const helpText = $('loginHelpText');

    if (emailInput) emailInput.disabled = isLoggedIn;
    if (passwordInput) passwordInput.disabled = isLoggedIn;
    if (loginBtn) loginBtn.disabled = isLoggedIn;
    if (logoutBtn) logoutBtn.disabled = !isLoggedIn;

    if (helpText) {
      helpText.textContent = isLoggedIn
        ? 'ログアウトするまでログイン情報は変更できません。'
        : 'ログインIDの場合、管理者がIDで招待している必要があります。';
    }

    if (isLoggedIn) {
      setLoginStatus(getPreferredLoginLabel());
      setLoginError('');
      log(TAGS.auth, 'ui state -> loggedIn');
    } else {
      setLoginStatus('未ログイン');
      log(TAGS.auth, 'ui state -> loggedOut');
    }
  };

  const updateNotifyFieldsVisibility = () => {
    const mode = settings?.notify?.mode || 'off';
    $('notifyWeeklyFields').style.display = mode === 'weekly' ? '' : 'none';
    $('notifyDailyFields').style.display = mode === 'daily' || mode === 'start+daily' ? '' : 'none';
    $('notifyHourlyFields').style.display = mode === 'hourly' ? '' : 'none';
  };

  const getLogUser = () => displayName || session?.user?.email || 'unknown';

  const pruneLogs = (logs) => {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const filtered = (logs || []).filter((entry) => {
      if (!entry || typeof entry.ts !== 'number') return true;
      return entry.ts >= cutoff;
    });
    const sorted = filtered.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    let trimmed = sorted;
    let removed = (logs?.length || 0) - sorted.length;
    if (sorted.length > LOG_MAX_ENTRIES) {
      removed += sorted.length - LOG_MAX_ENTRIES;
      trimmed = sorted.slice(0, LOG_MAX_ENTRIES);
    }
    if (removed > 0) {
      console.log(`[LOG] prune removed=${removed} kept=${trimmed.length}`);
    }
    return { logs: trimmed, removed };
  };

  const loadLogs = async () => {
    const stored = await bridge.logs.get();
    const { logs, removed } = pruneLogs(Array.isArray(stored) ? stored : []);
    if (removed > 0) {
      await bridge.logs.set(logs);
    }
    logEntries = logs;
    return logEntries;
  };

  const appendLogEntry = async (payload) => {
    if (!payload?.action) return;
    const now = new Date();
    const entry = {
      id: (crypto?.randomUUID?.() || `log-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      ts: now.getTime(),
      dateKey: formatDateKey(now),
      timeLabel: formatTimeLabel(now),
      user: getLogUser(),
      station: payload.station || getCurrentStation(),
      action: payload.action,
      recordId: payload.recordId,
      artist: payload.artist,
      detail: payload.detail || ''
    };
    const next = [entry, ...(logEntries || [])];
    const { logs } = pruneLogs(next);
    logEntries = logs;
    await bridge.logs.set(logEntries);
    console.log(`[LOG] append action=${entry.action} station=${entry.station} dateKey=${entry.dateKey}`);
    renderLogList();
  };

  const matchesLogQuery = (entry, query) => {
    if (!query) return true;
    const haystack = [
      entry.user,
      entry.station,
      entry.action,
      entry.recordId,
      entry.artist,
      entry.detail
    ]
      .filter((v) => v !== undefined && v !== null)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  };

  const renderLogList = () => {
    const list = $('settingsLogList');
    if (!list) return;
    const query = logSearchQuery.trim().toLowerCase();
    const filtered = (logEntries || []).filter((entry) => matchesLogQuery(entry, query));
    list.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'logEmpty';
      empty.textContent = 'ログがありません。';
      list.appendChild(empty);
      return;
    }
    let currentGroup = null;
    filtered.forEach((entry) => {
      if (!currentGroup || currentGroup.dateKey !== entry.dateKey) {
        const group = document.createElement('div');
        group.className = 'logGroup';
        const heading = document.createElement('div');
        heading.className = 'logDate';
        heading.textContent = entry.dateKey || '';
        group.appendChild(heading);
        list.appendChild(group);
        currentGroup = { dateKey: entry.dateKey, el: group };
      }
      const item = document.createElement('div');
      item.className = 'logEntry';
      const meta = document.createElement('div');
      meta.className = 'logMeta';
      const metaParts = [
        entry.timeLabel || '',
        entry.user || '',
        entry.station || '',
        entry.action || ''
      ].filter(Boolean);
      if (entry.recordId) metaParts.push(`ID:${entry.recordId}`);
      if (entry.artist) metaParts.push(`アーティスト:${entry.artist}`);
      meta.textContent = metaParts.join(' / ');
      const detail = document.createElement('div');
      detail.className = 'logDetail';
      detail.textContent = entry.detail || '';
      item.appendChild(meta);
      item.appendChild(detail);
      currentGroup.el.appendChild(item);
    });
  };

  const updateSettings = async (partial) => {
    settings = deepMerge(settings, partial);
    settings = await bridge.settings.set(settings);
    log(TAGS.settings, 'saved', settings);
    scheduleNotifications();
    return settings;
  };

  const ensureSupabaseClient = async () => {
    if (!settings.shareEnabled) {
      setShareStatus('共有OFF', false);
      teardownSupabase();
      return null;
    }
    if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
      setShareStatus('未設定', false);
      return null;
    }
    if (!window.supabase) {
      setShareStatus('SDK未読込', false);
      return null;
    }
    if (!supabaseClient || supabaseClient.__url !== settings.supabaseUrl) {
      supabaseClient = window.supabase.createClient(settings.supabaseUrl, settings.supabaseAnonKey);
      supabaseClient.__url = settings.supabaseUrl;
      if (supabaseAuthSub) {
        supabaseAuthSub.unsubscribe();
      }
      supabaseAuthSub = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
        handleSession(nextSession);
      }).data.subscription;
    }
    return supabaseClient;
  };

  const teardownSupabase = () => {
    if (presenceChannel) {
      presenceChannel.unsubscribe();
      presenceChannel = null;
    }
    presenceEditors = new Map();
    currentEditingRecordId = null;
    updateOnlinePill([]);
    setShareStatus('共有OFF', false);
  };

  const handleSession = async (nextSession) => {
    session = nextSession;
    if (!session) {
      displayName = null;
      currentEditingRecordId = null;
      presenceEditors = new Map();
      log(TAGS.auth, 'signed out');
      updateAuthUI(null);
      setShareStatus('未ログイン', false);
      if (presenceChannel) {
        presenceChannel.unsubscribe();
        presenceChannel = null;
      }
      updateOnlinePill([]);
      return;
    }

    log(TAGS.auth, `session ok user=${session.user.id}`);
    displayName = await ensureDisplayName();
    updateAuthUI(session);
    setShareStatus('接続中', true);
    await joinPresence(getCurrentStation());
    await loadSharedStation(getCurrentStation());
  };

  const ensureDisplayName = async () => {
    const metadataName = session?.user?.user_metadata?.display_name;
    if (metadataName) return metadataName;
    const name = await promptDisplayName();
    if (!name) return null;
    const { data, error } = await supabaseClient.auth.updateUser({ data: { display_name: name } });
    if (error) {
      log(TAGS.auth, 'display_name save failed', error);
      return null;
    }
    const updatedName = data?.user?.user_metadata?.display_name || name;
    log(TAGS.auth, `display_name updated ${updatedName}`);
    return updatedName;
  };

  const promptDisplayName = () => {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.className = 'fieldRow';
      const label = document.createElement('label');
      label.textContent = '表示名を入力してください';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '例: 山田';
      body.appendChild(label);
      body.appendChild(input);

      const foot = document.createElement('div');
      const cancel = document.createElement('button');
      cancel.className = 'btn btnGhost';
      cancel.textContent = 'キャンセル';
      cancel.addEventListener('click', () => {
        closeModal();
        resolve(null);
      });
      const save = document.createElement('button');
      save.className = 'btn btnPrimary';
      save.textContent = '登録';
      save.addEventListener('click', () => {
        const val = input.value.trim();
        if (!val) {
          alert('表示名を入力してください。');
          return;
        }
        closeModal();
        resolve(val);
      });
      foot.appendChild(cancel);
      foot.appendChild(save);

      openModal('表示名の登録', body, foot);
      setTimeout(() => input.focus(), 0);
    });
  };

  const joinPresence = async (station) => {
    if (!session || !supabaseClient || !settings.shareEnabled) return;
    if (presenceChannel) {
      await presenceChannel.unsubscribe();
    }
    const channel = supabaseClient.channel(`presence:meigi:${station}`, {
      config: {
        presence: {
          key: session.user.id
        }
      }
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const names = [];
      const editors = new Map();
      Object.values(state).forEach((entries) => {
        entries.forEach((entry) => {
          if (entry.displayName) names.push(entry.displayName);
          if (entry.editing) {
            const existing = editors.get(entry.editing) || [];
            existing.push({
              userId: entry.userId,
              displayName: entry.displayName || entry.userId
            });
            editors.set(entry.editing, existing);
          }
        });
      });
      presenceEditors = editors;
      updateOnlinePill(names);
      applyLockIndicators();
    });

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await channel.track(buildPresencePayload(station));
      log(TAGS.presence, `joined ${station}`);
    });

    presenceChannel = channel;
  };

  const buildPresencePayload = (station) => {
    return {
      userId: session?.user?.id || 'unknown',
      displayName: displayName || session?.user?.email || 'unknown',
      station,
      editing: currentEditingRecordId
    };
  };

  const updatePresenceTrack = async () => {
    if (!presenceChannel) return;
    await presenceChannel.track(buildPresencePayload(getCurrentStation()));
  };

  const SETUP_SQL = `-- station_data の最小セットアップ（idempotent）
create table if not exists public.station_data (
  station text,
  records_json jsonb,
  updated_at timestamptz,
  updated_by uuid
);

alter table public.station_data
  add column if not exists station text,
  add column if not exists records_json jsonb,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'station_data_pkey'
  ) then
    alter table public.station_data
      add constraint station_data_pkey primary key (station);
  end if;
end $$;

alter table public.station_data enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'station_data'
      and policyname = 'station_data_authenticated'
  ) then
    create policy station_data_authenticated
      on public.station_data
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;`;

  const showSetupNotice = (reason) => {
    const notice = $('supabaseSetupNotice');
    if (!notice) return;
    const message = reason ? `DBセットアップが必要です: ${reason}` : 'DBセットアップが必要です。';
    notice.querySelector('[data-role="message"]').textContent = message;
    notice.style.display = '';
    const sqlBox = notice.querySelector('pre');
    if (sqlBox) sqlBox.textContent = SETUP_SQL;
  };

  const hideSetupNotice = () => {
    const notice = $('supabaseSetupNotice');
    if (notice) notice.style.display = 'none';
  };

  const describeSchemaError = (error) => {
    const message = error?.message || error?.details || '';
    const code = error?.code || '';
    if (code === 'PGRST205' || message.includes('column')) return '必要な列が不足しています。';
    if (code === '42703') return '指定列が存在しません。';
    if (code === '42P01' || message.includes('station_data')) return 'station_data テーブルが存在しません。';
    if (code === '42501') return '権限が不足しています。';
    return message || 'スキーマが未設定です。';
  };

  const isSchemaError = (error) => {
    if (!error) return false;
    const code = error?.code || '';
    const message = error?.message || '';
    return ['PGRST205', '42703', '42P01', '42501'].includes(code)
      || message.includes('station_data')
      || message.includes('column');
  };

  const handleStationDataError = (error, action) => {
    if (!error) return false;
    if (!isSchemaError(error)) {
      log(TAGS.share, `station_data error ${action}: ${error.message || error}`, error);
      return false;
    }
    const reason = describeSchemaError(error);
    const code = error?.code ? `code=${error.code}` : 'code=unknown';
    log(TAGS.share, `station_data error ${action} ${code} ${reason}`, error);
    showSetupNotice(reason);
    if (!schemaErrorNotified) {
      schemaErrorNotified = true;
      alert('Supabase のDBセットアップが必要です。設定画面のSQLを確認してください。');
    }
    return true;
  };

  const loadSharedStation = async (station) => {
    if (!supabaseClient || !settings.shareEnabled || !session) return;
    const { data, error } = await supabaseClient
      .from('station_data')
      .select('records_json')
      .eq('station', station)
      .maybeSingle();
    if (error) {
      handleStationDataError(error, `load station=${station}`);
      return;
    }
    hideSetupNotice();
    if (!data?.records_json) return;

    const currentUi = app?.ui ? { ...app.ui } : null;
    app.recordsById = data.records_json || {};
    for (const id of Object.keys(app.recordsById)) {
      const rec = app.recordsById[id];
      if (rec && rec.status) rec.status = normalizeStatus(rec.status);
    }
    if (currentUi) app.ui = currentUi;
    render();
    log(TAGS.share, `loaded station=${station}`);
  };

  const applyLockIndicators = () => {
    const tbody = $('tbody');
    if (!tbody || !app?.ui?.lastRenderIds) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach((row, idx) => {
      const recId = app.ui.lastRenderIds[idx];
      if (!recId) return;
      row.dataset.recId = recId;
      const statusCell = row.querySelector('td');
      if (!statusCell) return;
      const existing = statusCell.querySelector('.lockTag');
      if (existing) existing.remove();
      const editors = presenceEditors.get(recId) || [];
      const others = editors.filter((entry) => entry.userId !== session?.user?.id);
      if (others.length) {
        const tag = document.createElement('span');
        tag.className = 'lockTag';
        const names = others.map((entry) => entry.displayName || entry.userId).filter(Boolean);
        const label = names.length ? names.join(', ') : '他のユーザー';
        tag.textContent = `${label} が編集中`;
        statusCell.appendChild(tag);
      }
    });
  };

  const buildBackupSnapshot = () => {
    return {
      recordsById: app.recordsById,
      ui: {
        tab: app.ui.tab,
        filter: {
          fromKey: app.ui.filter.fromKey,
          toKey: app.ui.filter.toKey,
          keyword: app.ui.filter.keyword,
          statusSet: Array.from(app.ui.filter.statusSet)
        },
        sort: app.ui.sort
      },
      savedAt: Date.now()
    };
  };

  const afterSave = async () => {
    const station = getCurrentStation();
    try {
      await bridge.backups.save({ station, state: buildBackupSnapshot() });
      log(TAGS.backup, `saved station=${station}`);
      const retentionDays = settings.backup.retentionDays || 7;
      await bridge.backups.cleanup({ retentionDays });
      log(TAGS.backup, `cleanup retention=${retentionDays}d`);
      await refreshBackupLists();
    } catch (error) {
      log(TAGS.backup, 'backup failed', error);
    }

    if (settings.shareEnabled && supabaseClient && session) {
      const payload = {
        station,
        records_json: app.recordsById,
        updated_at: new Date().toISOString(),
        updated_by: session.user.id
      };
      const { error } = await supabaseClient
        .from('station_data')
        .upsert(payload, { onConflict: 'station' });
      if (error) {
        handleStationDataError(error, `save station=${station}`);
      } else {
        hideSetupNotice();
        log(TAGS.share, `save ok station=${station}`);
      }
    }
  };

  const refreshBackupLists = async () => {
    const list802 = await bridge.backups.list('802');
    const listCocolo = await bridge.backups.list('COCOLO');
    renderBackupList('802', list802);
    renderBackupList('COCOLO', listCocolo);
  };

  const renderBackupList = (station, list) => {
    const el = station === '802' ? $('backupList802') : $('backupListCOCOLO');
    if (!el) return;
    el.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'hintText';
      empty.textContent = 'バックアップはまだありません。';
      el.appendChild(empty);
      return;
    }
    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'backupItem';
      row.dataset.path = item.path;
      row.textContent = item.name;
      if (selectedBackups[station] === item.path) {
        row.classList.add('selected');
      }
      row.addEventListener('click', () => {
        selectedBackups[station] = item.path;
        renderBackupList(station, list);
      });
      el.appendChild(row);
    });
  };

  const restoreBackup = async (path) => {
    if (!path) {
      alert('バックアップを選択してください。');
      return;
    }
    const data = await bridge.backups.read(path);
    if (!data?.recordsById) {
      alert('バックアップの読み込みに失敗しました。');
      return;
    }
    app.recordsById = data.recordsById;
    for (const id of Object.keys(app.recordsById)) {
      const rec = app.recordsById[id];
      if (rec && rec.status) rec.status = normalizeStatus(rec.status);
    }
    if (typeof undoStack !== 'undefined') {
      undoStack.length = 0;
      redoStack.length = 0;
      updateUndoRedoButtons();
    }
    markDirty(true);
    render();
    log(TAGS.backup, `restored ${path}`);
  };

  const computeNotifyCounts = () => {
    const threshold = settings.notify.thresholdDays || 14;
    const stations = ['802', 'COCOLO'];
    const exclude = new Set(['搬入済', '不要', '確認済']);
    const counts = { total: 0, byStation: { '802': 0, 'COCOLO': 0 } };

    stations.forEach((station) => {
      let records = {};
      if (station === getCurrentStation()) {
        records = app.recordsById || {};
      } else if (typeof stationCache !== 'undefined' && stationCache.has(station)) {
        records = stationCache.get(station).saved.recordsById || {};
      }

      Object.values(records).forEach((rec) => {
        if (!rec?.startKey) return;
        const st = normalizeStatus(rec.status);
        if (exclude.has(st)) return;
        const days = daysUntilKey(rec.startKey);
        if (days == null) return;
        if (days >= 0 && days < threshold) {
          counts.total += 1;
          counts.byStation[station] += 1;
        }
      });
    });
    return counts;
  };

  const notifyIfNeeded = async () => {
    const counts = computeNotifyCounts();
    if (counts.total === 0) return;
    const body = `公演日の近いイベントが ${counts.total}件あります（802: ${counts.byStation['802']} / COCOLO: ${counts.byStation['COCOLO']}）`;
    await bridge.notify({ title: '名義SPOT管理', body });
    settings = await updateSettings({
      notify: {
        ...settings.notify,
        lastNotifiedAt: new Date().toISOString()
      }
    });
    log(TAGS.notify, body);
  };

  const scheduleNotifications = () => {
    if (notifyTimer) clearTimeout(notifyTimer);
    if (notifyInterval) clearInterval(notifyInterval);
    notifyTimer = null;
    notifyInterval = null;

    const mode = settings.notify.mode || 'off';
    updateNotifyFieldsVisibility();
    if (mode === 'off') return;

    if (mode === 'onstart') {
      notifyIfNeeded();
      return;
    }

    const now = new Date();
    const lastNotified = settings.notify.lastNotifiedAt ? new Date(settings.notify.lastNotifiedAt) : null;

    if (mode === 'hourly') {
      const intervalMs = (settings.notify.intervalHours || 6) * 60 * 60 * 1000;
      if (!lastNotified || now - lastNotified > intervalMs) {
        notifyIfNeeded();
      }
      notifyInterval = setInterval(notifyIfNeeded, intervalMs);
      return;
    }

    const scheduleAt = (target) => {
      const delay = target.getTime() - Date.now();
      if (delay <= 0) return;
      notifyTimer = setTimeout(async () => {
        await notifyIfNeeded();
        scheduleNotifications();
      }, delay);
    };

    if (mode === 'daily' || mode === 'start+daily') {
      const [h, m] = (settings.notify.timeDaily || '09:30').split(':').map(Number);
      const target = new Date(now);
      target.setHours(h, m, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      if (!lastNotified && mode === 'start+daily') {
        notifyIfNeeded();
      } else if (lastNotified && lastNotified < target && now > target) {
        notifyIfNeeded();
      }
      scheduleAt(target);
      return;
    }

    if (mode === 'weekly') {
      const [h, m] = (settings.notify.timeWeekly || '09:30').split(':').map(Number);
      const target = new Date(now);
      const weekday = Number(settings.notify.weekday || 1);
      const diff = (weekday + 7 - target.getDay()) % 7;
      target.setDate(target.getDate() + diff);
      target.setHours(h, m, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 7);
      if (lastNotified && lastNotified < target && now > target) {
        notifyIfNeeded();
      }
      scheduleAt(target);
    }
  };

  const initSettingsModal = () => {
    $('settingsBtn')?.addEventListener('click', () => {
      $('settingsBackdrop').style.display = 'flex';
      log(TAGS.settings, 'open');
      loadLogs().then(renderLogList);
    });
    $('settingsCloseBtn')?.addEventListener('click', () => {
      $('settingsBackdrop').style.display = 'none';
    });
    $('settingsBackdrop')?.addEventListener('click', (e) => {
      if (e.target?.id === 'settingsBackdrop') {
        $('settingsBackdrop').style.display = 'none';
      }
    });

    $('settingsTabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      $('settingsTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      ['share', 'notify', 'backup', 'log'].forEach((key) => {
        const section = key === 'share'
          ? $('settingsShare')
          : key === 'notify'
            ? $('settingsNotify')
            : key === 'backup'
              ? $('settingsBackup')
              : $('settingsLog');
        section.classList.toggle('active', key === tab);
      });
      if (tab === 'log') {
        loadLogs().then(renderLogList);
      }
    });
  };

  const bindSettingsInputs = () => {
    on('supabaseUrlInput', 'change', async (e) => {
      await updateSettings({ supabaseUrl: e.target.value.trim() });
      await ensureSupabaseClient();
    });
    on('supabaseKeyInput', 'change', async (e) => {
      await updateSettings({ supabaseAnonKey: e.target.value.trim() });
      await ensureSupabaseClient();
    });
    on('shareToggle', 'change', async (e) => {
      await updateSettings({ shareEnabled: e.target.checked });
      await ensureSupabaseClient();
      if (e.target.checked) {
        await initAuthState();
      } else {
        teardownSupabase();
      }
    });

    on('supabaseTestBtn', 'click', async () => {
      setShareStatus('接続中…', true);
      const url = val('supabaseUrlInput') || settings.supabaseUrl;
      const key = val('supabaseKeyInput') || settings.supabaseAnonKey;
      if (!url || !key) {
        setShareStatus('未設定', false);
        alert('Supabase URL/KEY が未設定です。');
        return;
      }
      if (!window.supabase) {
        setShareStatus('SDK未読込', false);
        alert('Supabase SDK が読み込まれていません。');
        return;
      }
      let client = supabaseClient;
      if (settings.shareEnabled) {
        client = await ensureSupabaseClient();
      } else {
        client = window.supabase.createClient(url, key);
      }
      if (!client) return;
      const { error } = await client.from('station_data').select('station').limit(1);
      if (error) {
        setShareStatus('接続失敗', false);
        handleStationDataError(error, 'connection test');
        alert(`接続に失敗しました: ${error.message || error}`);
      } else {
        setShareStatus('接続OK', true);
        hideSetupNotice();
        log(TAGS.share, 'connection ok');
      }
    });

    on('loginBtn', 'click', async () => {
      const client = await ensureSupabaseClient();
      if (!client) {
        setLoginError('Supabase設定が未完了です。');
        return;
      }
      const input = val('loginEmailInput');
      const password = $('loginPasswordInput')?.value || '';
      if (!input || !password) {
        setLoginError('ログインに失敗しました（メール/IDまたはパスワードを確認してください）。');
        return;
      }
      const isEmail = input.includes('@');
      let email = input;
      let loginType = 'email';
      if (!isEmail) {
        const { value, error } = normalizeLoginId(input);
        if (error) {
          setLoginError(error);
          return;
        }
        loginType = 'id';
        email = `${value}@${getPseudoEmailDomain()}`;
      }
      log(TAGS.auth, `signIn start type=${loginType}`);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        const message = error?.message || error;
        setLoginError('ログインに失敗しました（メール/IDまたはパスワードを確認してください）。');
        log(TAGS.auth, `signIn failed ${message}`, error);
        return;
      }
      setLoginError('');
      if (loginType === 'id') {
        const normalized = normalizeLoginId(input);
        if (normalized.value) {
          await updateSettings({
            auth: {
              ...settings.auth,
              lastLoginId: normalized.value,
              lastLoginType: 'id'
            }
          });
        }
      } else {
        await updateSettings({
          auth: {
            ...settings.auth,
            lastLoginId: '',
            lastLoginType: 'email'
          }
        });
      }
    });

    on('logoutBtn', 'click', async () => {
      if (!supabaseClient) return;
      await supabaseClient.auth.signOut();
    });

    on('loginEmailInput', 'input', () => setLoginError(''));
    on('loginPasswordInput', 'input', () => setLoginError(''));

    on('supabaseCopySqlBtn', 'click', async () => {
      try {
        await navigator.clipboard.writeText(SETUP_SQL);
        log(TAGS.share, 'setup sql copied');
        alert('SQLをコピーしました。');
      } catch (error) {
        log(TAGS.share, 'setup sql copy failed', error);
        alert('SQLのコピーに失敗しました。');
      }
    });

    on('supabaseResetBtn', 'click', async () => {
      const ok = confirm('ローカルのデータを初期化してクラウドの内容を読み直します。実行しますか？');
      if (!ok) return;
      log(TAGS.reset, 'reset start');
      try {
        if (typeof undoStack !== 'undefined') {
          undoStack.length = 0;
        }
        if (typeof redoStack !== 'undefined') {
          redoStack.length = 0;
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('meigi.station');
        }
        if (typeof openDB === 'function') {
          const db = await openDB();
          const tx = db.transaction('state', 'readwrite');
          const store = tx.objectStore('state');
          await Promise.all([
            new Promise((resolve) => {
              const req = store.delete('app:802');
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
            }),
            new Promise((resolve) => {
              const req = store.delete('app:COCOLO');
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
            })
          ]);
        }
        if (typeof app !== 'undefined') {
          app.recordsById = {};
        }
        if (typeof stationCache !== 'undefined') {
          stationCache.clear();
        }
        if (typeof markDirty === 'function') {
          markDirty(false);
        }
        if (typeof render === 'function') {
          render();
        }
        if (!settings.shareEnabled || !supabaseClient || !session) {
          alert('共有が有効化されていないため、クラウド同期は実行できません。');
          log(TAGS.reset, 'sync skipped: share disabled or not logged in');
          return;
        }
        await loadSharedStation(getCurrentStation());
        log(TAGS.reset, 'reset done');
      } catch (error) {
        log(TAGS.reset, 'reset failed', error);
        alert('ローカル初期化に失敗しました。');
      }
    });

    on('notifyThreshold', 'change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, thresholdDays: Number(e.target.value) } });
    });
    on('notifyMode', 'change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, mode: e.target.value } });
    });
    on('notifyWeekday', 'change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, weekday: Number(e.target.value) } });
    });
    on('notifyTimeWeekly', 'change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, timeWeekly: e.target.value } });
    });
    on('notifyTimeDaily', 'change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, timeDaily: e.target.value } });
    });
    on('notifyIntervalHours', 'change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, intervalHours: Number(e.target.value) } });
    });

    on('backupRetentionDays', 'change', async (e) => {
      await updateSettings({ backup: { retentionDays: Number(e.target.value) } });
    });
    on('backupCleanupBtn', 'click', async () => {
      const retentionDays = settings.backup.retentionDays || 7;
      await bridge.backups.cleanup({ retentionDays });
      await refreshBackupLists();
    });

    on('restoreLatest802', 'click', async () => {
      const list = await bridge.backups.list('802');
      await restoreBackup(list[0]?.path);
    });
    on('restoreLatestCOCOLO', 'click', async () => {
      const list = await bridge.backups.list('COCOLO');
      await restoreBackup(list[0]?.path);
    });
    on('restorePick802', 'click', async () => {
      await restoreBackup(selectedBackups['802']);
    });
    on('restorePickCOCOLO', 'click', async () => {
      await restoreBackup(selectedBackups['COCOLO']);
    });
  };

  const initAuthState = async () => {
    const client = await ensureSupabaseClient();
    if (!client) {
      updateAuthUI(null);
      return;
    }
    const { data } = await client.auth.getSession();
    await handleSession(data.session);
  };

  const wrapSaveNow = () => {
    if (!window.saveNow) return;
    const original = window.saveNow;
    window.saveNow = async (...args) => {
      const ok = await original(...args);
      if (ok) {
        await afterSave();
      }
      return ok;
    };
  };

  const wrapManualEdit = () => {
    if (!window.openManualEditModal) return;
    const original = window.openManualEditModal;
    window.openManualEditModal = async (recId, ...rest) => {
      currentEditingRecordId = recId;
      await updatePresenceTrack();
      original(recId, ...rest);
    };

    if (window.closeModal) {
      const closeOriginal = window.closeModal;
      window.closeModal = () => {
        closeOriginal();
        currentEditingRecordId = null;
        updatePresenceTrack();
      };
    }
  };

  const wrapRender = () => {
    if (!window.render) return;
    const original = window.render;
    window.render = (...args) => {
      original(...args);
      applyLockIndicators();
    };
  };

  const wrapSwitchStation = () => {
    if (!window.switchStation) return;
    const original = window.switchStation;
    window.switchStation = async (...args) => {
      await original(...args);
      if (settings.shareEnabled && supabaseClient && session) {
        currentEditingRecordId = null;
        await joinPresence(getCurrentStation());
        await loadSharedStation(getCurrentStation());
        applyLockIndicators();
      }
    };
  };

  const populateSettingsUI = () => {
    $('supabaseUrlInput').value = settings.supabaseUrl || '';
    $('supabaseKeyInput').value = settings.supabaseAnonKey || '';
    $('shareToggle').checked = !!settings.shareEnabled;
    $('notifyThreshold').value = String(settings.notify.thresholdDays || 14);
    $('notifyMode').value = settings.notify.mode || 'weekly';
    $('notifyWeekday').value = String(settings.notify.weekday ?? 1);
    $('notifyTimeWeekly').value = settings.notify.timeWeekly || '09:30';
    $('notifyTimeDaily').value = settings.notify.timeDaily || '09:30';
    $('notifyIntervalHours').value = String(settings.notify.intervalHours || 6);
    $('backupRetentionDays').value = String(settings.backup.retentionDays || 7);
  };

  const init = async () => {
    settings = deepMerge(defaultSettings, await bridge.settings.get());
    populateSettingsUI();
    initSettingsModal();
    bindSettingsInputs();
    updateNotifyFieldsVisibility();
    $('settingsLogSearch')?.addEventListener('input', (e) => {
      logSearchQuery = e.target.value || '';
      renderLogList();
    });
    window.addEventListener('meigi-log', (event) => {
      appendLogEntry(event.detail);
    });

    wrapSaveNow();
    wrapManualEdit();
    wrapRender();
    wrapSwitchStation();

    await ensureSupabaseClient();
    if (settings.shareEnabled) {
      await initAuthState();
    }

    await refreshBackupLists();
    await bridge.backups.cleanup({ retentionDays: settings.backup.retentionDays || 7 });
    scheduleNotifications();
    log(TAGS.app, 'integration ready');
  };

  window.addEventListener('DOMContentLoaded', init, { once: true });
})();
