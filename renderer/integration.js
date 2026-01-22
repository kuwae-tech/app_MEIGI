(() => {
  const api = window.api;
  if (!api) {
    console.warn('[APP] preload bridge not available');
    return;
  }
  const settingsApi = api.settings;
  const backupsApi = api.backups;

  const TAGS = {
    app: 'APP',
    settings: 'SETTINGS',
    auth: 'AUTH',
    share: 'SHARE',
    presence: 'PRESENCE',
    lock: 'LOCK',
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
  const onlinePill = () => $('onlinePill');

  let settings = null;
  let supabaseClient = null;
  let supabaseAuthSub = null;
  let session = null;
  let presenceChannel = null;
  let lockRefreshTimer = null;
  let lockExtendTimer = null;
  let notifyTimer = null;
  let notifyInterval = null;
  let currentLock = null;
  let locksById = new Map();
  let displayName = null;
  let selectedBackups = { '802': null, 'COCOLO': null };

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

  const updateNotifyFieldsVisibility = () => {
    const mode = settings?.notify?.mode || 'off';
    $('notifyWeeklyFields').style.display = mode === 'weekly' ? '' : 'none';
    $('notifyDailyFields').style.display = mode === 'daily' || mode === 'start+daily' ? '' : 'none';
    $('notifyHourlyFields').style.display = mode === 'hourly' ? '' : 'none';
  };

  const updateSettings = async (partial) => {
    settings = deepMerge(settings, partial);
    settings = await settingsApi.update(settings);
    log(TAGS.settings, 'saved', settings);
    scheduleNotifications();
    return settings;
  };

  const ensureSupabaseClient = async () => {
    if (!settings.shareEnabled) {
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
    if (lockRefreshTimer) {
      clearInterval(lockRefreshTimer);
      lockRefreshTimer = null;
    }
    if (lockExtendTimer) {
      clearInterval(lockExtendTimer);
      lockExtendTimer = null;
    }
    currentLock = null;
    locksById.clear();
    updateOnlinePill([]);
    setShareStatus('共有OFF', false);
  };

  const handleSession = async (nextSession) => {
    session = nextSession;
    if (!session) {
      displayName = null;
      setLoginStatus('未ログイン');
      setShareStatus('未ログイン', false);
      if (presenceChannel) {
        presenceChannel.unsubscribe();
        presenceChannel = null;
      }
      updateOnlinePill([]);
      return;
    }

    log(TAGS.auth, `session ok user=${session.user.id}`);
    const allowed = await checkAllowedUser();
    if (!allowed) {
      alert('招待されていません。管理者に連絡してください。');
      await supabaseClient.auth.signOut();
      return;
    }

    displayName = await ensureDisplayName();
    setLoginStatus(displayName ? `ログイン中: ${displayName}` : `ログイン中: ${session.user.email}`);
    setShareStatus('接続中', true);
    await joinPresence(getCurrentStation());
    await loadSharedStation(getCurrentStation());
    startLockRefresh();
  };

  const checkAllowedUser = async () => {
    const { data, error } = await supabaseClient
      .from('allowed_users')
      .select('role')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) {
      log(TAGS.auth, `allowed_users check failed`, error);
      return false;
    }
    return !!data;
  };

  const ensureDisplayName = async () => {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('display_name')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) {
      log(TAGS.auth, 'profiles fetch failed', error);
      return null;
    }
    if (data?.display_name) return data.display_name;

    const name = await promptDisplayName();
    if (!name) return null;
    const { error: upsertError } = await supabaseClient
      .from('profiles')
      .upsert({ user_id: session.user.id, display_name: name }, { onConflict: 'user_id' });
    if (upsertError) {
      log(TAGS.auth, 'display_name save failed', upsertError);
      return null;
    }
    return name;
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
      Object.values(state).forEach((entries) => {
        entries.forEach((entry) => {
          if (entry.display_name) names.push(entry.display_name);
        });
      });
      updateOnlinePill(names);
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
      user_id: session?.user?.id || 'unknown',
      display_name: displayName || session?.user?.email || 'unknown',
      station,
      viewing_record_id: null,
      editing_record_id: currentLock?.recordId || null,
      updated_at: new Date().toISOString()
    };
  };

  const updatePresenceTrack = async () => {
    if (!presenceChannel) return;
    await presenceChannel.track(buildPresencePayload(getCurrentStation()));
  };

  const loadSharedStation = async (station) => {
    if (!supabaseClient || !settings.shareEnabled || !session) return;
    const { data, error } = await supabaseClient
      .from('station_data')
      .select('records_json')
      .eq('station', station)
      .maybeSingle();
    if (error) {
      log(TAGS.share, `load failed station=${station}`, error);
      return;
    }
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

  const startLockRefresh = () => {
    if (lockRefreshTimer) clearInterval(lockRefreshTimer);
    lockRefreshTimer = setInterval(refreshLocks, 20000);
    refreshLocks();
  };

  const refreshLocks = async () => {
    if (!supabaseClient || !settings.shareEnabled || !session) return;
    const station = getCurrentStation();
    const { data, error } = await supabaseClient
      .from('locks')
      .select('*')
      .eq('station', station);
    if (error) {
      log(TAGS.lock, `refresh failed station=${station}`, error);
      return;
    }
    locksById = new Map();
    (data || []).forEach((row) => {
      locksById.set(row.record_id, row);
    });
    applyLockIndicators();
  };

  const hasActiveLock = (recId) => {
    const row = locksById.get(recId);
    if (!row) return null;
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return row;
    }
    return null;
  };

  const acquireLock = async (recId) => {
    if (!supabaseClient || !settings.shareEnabled || !session) return true;
    const station = getCurrentStation();
    const payload = {
      station,
      record_id: recId,
      locked_by: session.user.id,
      locked_by_name: displayName || session.user.email || 'unknown',
      locked_until: new Date(Date.now() + 30000).toISOString()
    };
    const { error } = await supabaseClient
      .from('locks')
      .upsert(payload, { onConflict: 'station,record_id' });
    if (error) {
      await refreshLocks();
      const row = hasActiveLock(recId);
      if (row && row.locked_by !== session.user.id) {
        alert(`${row.locked_by_name} が編集中です。`);
      }
      log(TAGS.lock, `acquire failed station=${station} id=${recId}`, error);
      return false;
    }
    log(TAGS.lock, `acquire ok station=${station} id=${recId}`);
    currentLock = { station, recordId: recId };
    startLockExtend();
    await updatePresenceTrack();
    return true;
  };

  const startLockExtend = () => {
    if (lockExtendTimer) clearInterval(lockExtendTimer);
    lockExtendTimer = setInterval(async () => {
      if (!currentLock) return;
      const { station, recordId } = currentLock;
      const { error } = await supabaseClient
        .from('locks')
        .update({ locked_until: new Date(Date.now() + 30000).toISOString() })
        .eq('station', station)
        .eq('record_id', recordId);
      if (error) {
        log(TAGS.lock, `extend failed station=${station} id=${recordId}`, error);
      }
    }, 15000);
  };

  const releaseLock = async () => {
    if (!currentLock || !supabaseClient) return;
    const { station, recordId } = currentLock;
    currentLock = null;
    if (lockExtendTimer) {
      clearInterval(lockExtendTimer);
      lockExtendTimer = null;
    }
    await supabaseClient
      .from('locks')
      .update({ locked_until: new Date().toISOString() })
      .eq('station', station)
      .eq('record_id', recordId);
    log(TAGS.lock, `release station=${station} id=${recordId}`);
    await updatePresenceTrack();
    refreshLocks();
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
      const rowLock = hasActiveLock(recId);
      if (rowLock && rowLock.locked_by !== session?.user?.id) {
        const tag = document.createElement('span');
        tag.className = 'lockTag';
        tag.textContent = `${rowLock.locked_by_name} が編集中`;
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
      await backupsApi.save({ station, state: buildBackupSnapshot() });
      log(TAGS.backup, `saved station=${station}`);
      const retentionDays = settings.backup.retentionDays || 7;
      await backupsApi.cleanup({ retentionDays });
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
        log(TAGS.share, `save failed station=${station}`, error);
      } else {
        log(TAGS.share, `save ok station=${station}`);
      }
    }
  };

  const refreshBackupLists = async () => {
    const list802 = await backupsApi.list('802');
    const listCocolo = await backupsApi.list('COCOLO');
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
    const data = await backupsApi.read(path);
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
    await api.notify({ title: '名義SPOT管理', body });
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

  const openSettingsModal = () => {
    $('settingsBackdrop').style.display = 'flex';
  };

  const initSettingsModal = () => {
    const isSettingsWindow = new URLSearchParams(window.location.search).get('settings') === '1';
    $('settingsBtn')?.addEventListener('click', async () => {
      if (isSettingsWindow) {
        openSettingsModal();
        return;
      }
      if (settingsApi?.open) {
        await settingsApi.open();
        return;
      }
      openSettingsModal();
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
      ['share', 'notify', 'backup'].forEach((key) => {
        const section = key === 'share' ? $('settingsShare') : key === 'notify' ? $('settingsNotify') : $('settingsBackup');
        section.classList.toggle('active', key === tab);
      });
    });

    if (isSettingsWindow) {
      openSettingsModal();
    }
  };

  const bindSettingsInputs = () => {
    $('supabaseUrlInput').addEventListener('change', async (e) => {
      await updateSettings({ supabaseUrl: e.target.value.trim() });
      await ensureSupabaseClient();
    });
    $('supabaseKeyInput').addEventListener('change', async (e) => {
      await updateSettings({ supabaseAnonKey: e.target.value.trim() });
      await ensureSupabaseClient();
    });
    $('shareToggle').addEventListener('change', async (e) => {
      await updateSettings({ shareEnabled: e.target.checked });
      await ensureSupabaseClient();
      if (e.target.checked) {
        await initAuthState();
      } else {
        teardownSupabase();
      }
    });

    $('supabaseTestBtn').addEventListener('click', async () => {
      await ensureSupabaseClient();
      if (!supabaseClient) return;
      const { error } = await supabaseClient.from('station_data').select('station').limit(1);
      if (error) {
        setShareStatus('接続失敗', false);
        log(TAGS.share, 'connection test failed', error);
      } else {
        setShareStatus('接続OK', true);
        log(TAGS.share, 'connection ok');
      }
    });

    $('loginBtn').addEventListener('click', async () => {
      await ensureSupabaseClient();
      const email = $('loginEmailInput').value.trim();
      const password = $('loginPasswordInput').value;
      if (!email || !password) {
        alert('メールとパスワードを入力してください。');
        return;
      }
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        alert('ログインに失敗しました。');
        log(TAGS.auth, 'login failed', error);
      }
    });

    $('logoutBtn').addEventListener('click', async () => {
      if (!supabaseClient) return;
      await supabaseClient.auth.signOut();
      log(TAGS.auth, 'signed out');
    });

    $('notifyThreshold').addEventListener('change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, thresholdDays: Number(e.target.value) } });
    });
    $('notifyMode').addEventListener('change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, mode: e.target.value } });
    });
    $('notifyWeekday').addEventListener('change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, weekday: Number(e.target.value) } });
    });
    $('notifyTimeWeekly').addEventListener('change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, timeWeekly: e.target.value } });
    });
    $('notifyTimeDaily').addEventListener('change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, timeDaily: e.target.value } });
    });
    $('notifyIntervalHours').addEventListener('change', async (e) => {
      await updateSettings({ notify: { ...settings.notify, intervalHours: Number(e.target.value) } });
    });

    $('backupRetentionDays').addEventListener('change', async (e) => {
      await updateSettings({ backup: { retentionDays: Number(e.target.value) } });
    });
    $('backupCleanupBtn').addEventListener('click', async () => {
      const retentionDays = settings.backup.retentionDays || 7;
      await backupsApi.cleanup({ retentionDays });
      await refreshBackupLists();
    });

    $('restoreLatest802').addEventListener('click', async () => {
      const list = await backupsApi.list('802');
      await restoreBackup(list[0]?.path);
    });
    $('restoreLatestCOCOLO').addEventListener('click', async () => {
      const list = await backupsApi.list('COCOLO');
      await restoreBackup(list[0]?.path);
    });
    $('restorePick802').addEventListener('click', async () => {
      await restoreBackup(selectedBackups['802']);
    });
    $('restorePickCOCOLO').addEventListener('click', async () => {
      await restoreBackup(selectedBackups['COCOLO']);
    });
  };

  const initAuthState = async () => {
    const client = await ensureSupabaseClient();
    if (!client) return;
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
      if (settings.shareEnabled && supabaseClient && session) {
        const ok = await acquireLock(recId);
        if (!ok) return;
      }
      original(recId, ...rest);
    };

    if (window.closeModal) {
      const closeOriginal = window.closeModal;
      window.closeModal = () => {
        closeOriginal();
        releaseLock();
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
        await joinPresence(getCurrentStation());
        await loadSharedStation(getCurrentStation());
        refreshLocks();
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
    settings = deepMerge(defaultSettings, await settingsApi.get());
    populateSettingsUI();
    initSettingsModal();
    bindSettingsInputs();
    updateNotifyFieldsVisibility();

    wrapSaveNow();
    wrapManualEdit();
    wrapRender();
    wrapSwitchStation();

    await ensureSupabaseClient();
    if (settings.shareEnabled) {
      await initAuthState();
    }

    await refreshBackupLists();
    await backupsApi.cleanup({ retentionDays: settings.backup.retentionDays || 7 });
    scheduleNotifications();
    log(TAGS.app, 'integration ready');
  };

  window.addEventListener('DOMContentLoaded', init, { once: true });
})();
