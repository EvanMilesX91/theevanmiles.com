/* ============================================================================
   sync.js — automatic cross-device sync, no login.

   A single shared row in Supabase (`em_tracker_shared`, id = SHARED_ID) holds
   the whole app-state blob. Every device that opens the app reads/writes that
   one row with the public anon key — so the phone and laptop just stay in sync,
   no account required. RLS scopes access to the one known id. The tradeoff: no
   privacy — anyone who opens the URL loads the same shared copy. That's the
   intended design for this personal tool.

   The server stamps `updated_at` on write, so we compare server timestamps
   (never device clocks) to decide when a device should adopt the cloud copy.
   ========================================================================== */
(function () {
  const cfg = window.EM_CONFIG || {};
  const SYNC_KEY = 'em-tracker-synced-at';   // server updated_at we last reconciled
  const ID = cfg.SHARED_ID;

  let store, onState, onStatus;
  let lastSyncedAt = localStorage.getItem(SYNC_KEY) || '';
  let pushTimer = null, pollTimer = null;
  let applying = false;   // guard: don't push while adopting a pulled copy
  let status = 'idle';

  function headers(json) {
    const h = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function setSynced(ts) { lastSyncedAt = ts || ''; localStorage.setItem(SYNC_KEY, lastSyncedAt); }
  function setStatus(s) { status = s; if (onStatus) onStatus(s); }
  const newer = (a, b) => Date.parse(a) > (b ? Date.parse(b) : 0);
  const hasData = (d) => d && typeof d === 'object' && Object.keys(d).length > 0;
  // How much REAL data a state holds (things that only exist if you actually used
  // the app — posts, collab, sprints, monthly logs). Weeks/months auto-seed so
  // they don't count. The richer copy always wins, so an empty device can never
  // wipe a populated cloud (and an empty cloud can never wipe a populated device).
  const score = (s) => {
    if (!s || typeof s !== 'object') return -1;
    const n = (x) => Array.isArray(x) ? x.length : (x && typeof x === 'object' ? Object.keys(x).length : 0);
    return n(s.posts) + n(s.collab) + n(s.sprints) + n(s.monthlyLog);
  };
  const url = (path) => cfg.SUPABASE_URL + path;

  async function pullRow() {
    const res = await fetch(url('/rest/v1/em_tracker_shared?id=eq.' + encodeURIComponent(ID) + '&select=data,updated_at'), { headers: headers() });
    if (!res.ok) throw new Error('pull ' + res.status);
    const arr = await res.json();
    return arr && arr[0] ? arr[0] : null;
  }

  function adopt(row) {
    applying = true;
    store.replaceState(row.data);   // sets state + writes localStorage
    applying = false;
    setSynced(row.updated_at);
    if (onState) onState();         // re-render
  }

  async function pushNow() {
    try {
      setStatus('syncing');
      const res = await fetch(url('/rest/v1/em_tracker_shared'), {
        method: 'POST',
        headers: Object.assign(headers(true), { Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify({ id: ID, data: store.state }),
      });
      if (!res.ok) throw new Error('push ' + res.status);
      const rows = await res.json();
      if (rows && rows[0]) setSynced(rows[0].updated_at);
      setStatus('synced');
    } catch (e) { setStatus('error'); }
  }

  // Called from Store.persist() on every change — debounced cloud push.
  function schedulePush() {
    if (applying || !cfg.SUPABASE_URL || !ID) return;
    setStatus('syncing');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 1200);
  }

  // Adopt the cloud copy only if it's newer AND at least as rich as local. If
  // local is richer than a newer cloud (e.g. the cloud got wiped), keep local and
  // push it back up to restore the cloud instead of losing data.
  async function pull() {
    try {
      const row = await pullRow();
      if (row && newer(row.updated_at, lastSyncedAt)) {
        if (score(row.data) >= score(store.state)) adopt(row);
        else { setSynced(row.updated_at); await pushNow(); }   // local richer — restore cloud
      }
      setStatus('synced');
    } catch (e) { setStatus('error'); }
  }

  // First run on a device: reconcile local data with the shared cloud copy.
  // Deterministic + safe — the RICHER side wins, so there's no confirm() that an
  // automation browser could auto-cancel into wiping the cloud.
  async function firstReconcile() {
    setStatus('syncing');
    try {
      const row = await pullRow();
      if (row && hasData(row.data)) {
        if (score(store.state) > score(row.data)) await pushNow();  // this device richer — restore cloud
        else adopt(row);                                            // cloud >= local — load it
      } else if (localHasData()) {
        await pushNow();   // cloud empty but this device has real data — seed it
      }
      setStatus('synced');
    } catch (e) { setStatus('error'); }
  }

  function localHasData() {
    const s = store.state;
    return !!(s && (s.posts && s.posts.length || s.collab && s.collab.length ||
      (s.weeks && Object.keys(s.weeks).length) || (s.monthlyLog && Object.keys(s.monthlyLog).length) ||
      (s.sprints && s.sprints.length)));
  }
  function localDiffers(cloud) {
    try { return JSON.stringify(cloud) !== JSON.stringify(store.state); } catch (e) { return true; }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 45000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function init(storeRef, onStateCb, onStatusCb) {
    store = storeRef; onState = onStateCb; onStatus = onStatusCb;
    if (!cfg.SUPABASE_URL || !ID) { setStatus('offline'); return; }
    if (lastSyncedAt) pull(); else firstReconcile();   // reconcile once, then adopt-if-newer
    startPolling();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
    window.addEventListener('focus', pull);
  }

  window.Sync = { init, schedulePush, pull, pushNow, status: () => status };
})();
