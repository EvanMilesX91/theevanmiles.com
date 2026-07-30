/* ============================================================================
   store.js — all persistence. Single source of truth lives in localStorage
   under one versioned key. The app mutates Store.state directly and then
   calls Store.persist(); everything is plain JSON so a later migration to
   Supabase/Firebase is a straight serialise-and-push.
   ========================================================================== */
(function () {
  const KEY = 'em-music-tracker98';
  const VERSION = 1;

  /* Build the first-run state from the seed. Dynamic, per-period collections
     (weeks, months, sprints) start empty and are filled lazily as the user
     works — this keeps history without ever needing a manual "reset". */
  function buildDefault() {
    const s = window.EM_SEED;
    return {
      version: VERSION,
      meta: { ...s.meta, createdAt: new Date().toISOString() },
      weeks: {},          // keyed by Monday ISO date -> { tasks:{}, stories:0 }
      months: {},         // keyed by "YYYY-MM"       -> { <monthlyKey>:bool }
      sprints: [],        // [{ id, title, releaseDate, done:{} }]
      collab: [],         // starts empty; user builds the shortlist
      posts: [],          // [{ id, date, type, desc }] — the post log
      monthlyLog: {},     // keyed "YYYY-MM" -> { listeners, saves, wentWell, ... }
      ui: { lastPrompt: '' }, // month key we last showed the end-of-month popup for
      roadmap: emptyRoadmapState(s.roadmap),
      metrics: emptyMetricsState(s.metrics),
    };
  }

  function emptyRoadmapState(def) {
    const out = {};
    for (const m of Object.keys(def)) {
      out[m] = {
        checks: def[m].checks.map(() => false),
        numbers: def[m].numbers.map(() => ''),
        reflections: def[m].reflections.map(() => ''),
      };
    }
    return out;
  }

  function emptyMetricsState(def) {
    const out = { leading: {}, lagging: {} };
    def.leading.forEach((m) => (out.leading[m.key] = ''));
    def.lagging.forEach((m) => (out.lagging[m.key] = ''));
    return out;
  }

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Deep-ish merge so that new fields shipped in a future seed appear on old
     saved state without wiping the user's data. Only fills missing top-level
     keys and missing metric keys — never overwrites existing user values. */
  // Keep only the metric keys the current build defines, overlaying any saved
  // values — this drops keys for metrics that have since been removed.
  function mergeMetric(defObj, savedObj) {
    const out = {};
    for (const k of Object.keys(defObj)) {
      out[k] = savedObj && savedObj[k] != null ? savedObj[k] : defObj[k];
    }
    return out;
  }

  function migrate(saved) {
    const def = buildDefault();
    const state = Object.assign({}, def, saved);
    state.version = VERSION;
    state.meta = Object.assign({}, def.meta, saved.meta);
    delete state.ledger;   // ledger was removed; drop it from older saves/backups
    // New collections added over time — make sure their shapes exist.
    if (!Array.isArray(state.posts)) state.posts = [];
    if (!state.monthlyLog || typeof state.monthlyLog !== 'object') state.monthlyLog = {};
    state.ui = Object.assign({ lastPrompt: '' }, saved.ui);
    // Ensure roadmap/metrics shapes exist for any newly-added months/keys.
    state.roadmap = Object.assign({}, def.roadmap, saved.roadmap);
    state.metrics = {
      leading: mergeMetric(def.metrics.leading, saved.metrics && saved.metrics.leading),
      lagging: mergeMetric(def.metrics.lagging, saved.metrics && saved.metrics.lagging),
    };
    return state;
  }

  let state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? migrate(JSON.parse(raw)) : buildDefault();
  } catch (e) {
    console.warn('Could not read saved data, starting fresh.', e);
    state = buildDefault();
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Save failed', e);
    }
    // Schedule a debounced cloud push (no-op unless signed in to sync).
    if (window.Sync) window.Sync.schedulePush();
  }

  // Replace the whole state (used by the sync layer when adopting a cloud copy).
  // Runs it through migrate() so a copy saved by an older build is normalised.
  function replaceState(obj) {
    state = migrate(obj);
    persist();
  }

  // Normalise storage on load so removed fields (e.g. an old ledger) don't
  // linger in older saves even if the user never makes an edit this session.
  persist();

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `em-music-tracker_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSON(file, cb) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        state = migrate(parsed);
        persist();
        cb(null);
      } catch (e) {
        cb(e);
      }
    };
    reader.onerror = () => cb(reader.error);
    reader.readAsText(file);
  }

  function reset() {
    state = buildDefault();
    persist();
  }

  window.Store = {
    get state() { return state; },
    get seed() { return window.EM_SEED; },
    uid,
    persist,
    replaceState,
    exportJSON,
    importJSON,
    reset,
  };
})();
