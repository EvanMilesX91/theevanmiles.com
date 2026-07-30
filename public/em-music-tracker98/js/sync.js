/* ============================================================================
   sync.js — cross-device sync via Supabase (auth + a single jsonb state row).

   Dependency-free: talks to Supabase's Auth (GoTrue) and REST (PostgREST)
   endpoints with plain fetch, matching the rest of the app. The anon key in
   config.js is public by design — every row is guarded by Row-Level Security
   scoped to the signed-in user, so a token only ever sees its owner's data.

   Model: one row per user in `em_tracker_state`, holding the whole app state
   blob. The server stamps `updated_at` on write (trigger), so we compare server
   timestamps — never device clocks — to decide which copy is newer.
   ========================================================================== */
(function () {
  const cfg = window.EM_CONFIG || {};
  const AUTH_KEY = 'em-tracker-auth';
  const SYNC_KEY = 'em-tracker-synced-at'; // server updated_at we last reconciled

  let store, onState, onStatus;
  let session = loadSession();     // { access_token, refresh_token, expires_at, user }
  let lastSyncedAt = localStorage.getItem(SYNC_KEY) || '';
  let pushTimer = null, pollTimer = null;
  let applying = false;            // guard: don't push while adopting a pull
  let status = 'signedout';

  /* ---------- session persistence ----------------------------------------- */
  function loadSession() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch (e) { return null; } }
  function saveSession() {
    if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
    else localStorage.removeItem(AUTH_KEY);
  }
  function setSynced(ts) { lastSyncedAt = ts || ''; localStorage.setItem(SYNC_KEY, lastSyncedAt); }
  const signedIn = () => !!(session && session.access_token);
  function setStatus(s) { status = s; if (onStatus) onStatus(s, session); }
  const newer = (a, b) => Date.parse(a) > (b ? Date.parse(b) : 0);

  /* ---------- auth --------------------------------------------------------- */
  function applyAuth(d) {
    session = {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
      user: d.user,
    };
    saveSession();
  }
  function authHeaders(json) {
    const h = { apikey: cfg.SUPABASE_ANON_KEY };
    if (json) h['Content-Type'] = 'application/json';
    if (signedIn()) h.Authorization = 'Bearer ' + session.access_token;
    return h;
  }
  async function ensureFresh() {
    if (session && session.expires_at && Date.now() / 1000 > session.expires_at - 60) {
      const res = await fetch(cfg.SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', headers: { apikey: cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      if (!res.ok) { signOutLocal(); throw new Error('Session expired — sign in again.'); }
      applyAuth(await res.json());
    }
  }

  async function signUp(email, password) {
    const res = await fetch(cfg.SUPABASE_URL + '/auth/v1/signup', {
      method: 'POST', headers: { apikey: cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.msg || d.error_description || d.error || 'Could not create account.');
    if (!d.access_token) throw new Error('Account exists — try signing in instead.');
    applyAuth(d); await afterSignIn(true);
  }
  async function signIn(email, password) {
    const res = await fetch(cfg.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error_description || d.msg || d.error || 'Wrong email or password.');
    applyAuth(d); await afterSignIn(true);
  }
  function signOutLocal() { session = null; saveSession(); setSynced(''); stopPolling(); setStatus('signedout'); }
  async function signOut() {
    try { await fetch(cfg.SUPABASE_URL + '/auth/v1/logout', { method: 'POST', headers: authHeaders() }); } catch (e) {}
    signOutLocal();
  }

  /* ---------- data --------------------------------------------------------- */
  async function pullRow() {
    await ensureFresh();
    const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/em_tracker_state?select=data,updated_at', { headers: authHeaders() });
    if (!res.ok) throw new Error('pull failed');
    const arr = await res.json();
    return arr && arr[0] ? arr[0] : null;
  }
  const hasData = (d) => d && typeof d === 'object' && Object.keys(d).length > 0;

  function adopt(row) {
    applying = true;
    store.replaceState(row.data);   // sets state + writes localStorage
    applying = false;
    setSynced(row.updated_at);
    if (onState) onState();         // re-render
  }

  async function pushNow() {
    if (!signedIn()) return;
    try {
      await ensureFresh();
      setStatus('syncing');
      const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/em_tracker_state', {
        method: 'POST',
        headers: Object.assign(authHeaders(true), { Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify({ user_id: session.user.id, data: store.state }),
      });
      if (!res.ok) throw new Error('push failed');
      const rows = await res.json();
      if (rows && rows[0]) setSynced(rows[0].updated_at);
      setStatus('synced');
    } catch (e) { setStatus('error'); }
  }

  // Adopt the cloud copy only if it's newer than what we last reconciled.
  async function pull() {
    if (!signedIn()) return;
    try {
      const row = await pullRow();
      if (row && hasData(row.data) && newer(row.updated_at, lastSyncedAt)) adopt(row);
      setStatus('synced');
    } catch (e) { setStatus('error'); }
  }

  // Fresh sign-in: reconcile this device's local data with the cloud.
  async function afterSignIn(fresh) {
    setStatus('syncing');
    try {
      const row = await pullRow();
      if (row && hasData(row.data)) {
        // If this device also has real, different local data, let the user
        // choose rather than silently overwriting one with the other.
        if (fresh && localHasData() && localDiffers(row.data)) {
          if (confirm('This account already has saved data in the cloud.\n\nOK  = load the cloud copy onto this device\nCancel = keep THIS device\'s data and upload it (replaces the cloud copy)')) {
            adopt(row);
          } else {
            await pushNow();
          }
        } else {
          adopt(row);
        }
      } else {
        await pushNow();   // cloud is empty — seed it from this device
      }
      setStatus('synced');
    } catch (e) { setStatus('error'); }
    startPolling();
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

  /* ---------- push scheduling (called from Store.persist) ------------------ */
  function schedulePush() {
    if (!signedIn() || applying) return;
    setStatus('syncing');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 1200);
  }

  /* ---------- polling / focus ---------------------------------------------- */
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') pull(); }, 45000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ---------- init --------------------------------------------------------- */
  function init(storeRef, onStateCb, onStatusCb) {
    store = storeRef; onState = onStateCb; onStatus = onStatusCb;
    if (!cfg.SUPABASE_URL) { setStatus('signedout'); return; }
    if (signedIn()) {
      setStatus('syncing');
      pull();                 // adopt newer cloud copy on load
      startPolling();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
      window.addEventListener('focus', pull);
    } else {
      setStatus('signedout');
    }
  }

  window.Sync = {
    init, signUp, signIn, signOut, schedulePush, pull, pushNow,
    signedIn, status: () => status, email: () => session && session.user && session.user.email,
  };
})();
