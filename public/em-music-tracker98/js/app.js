/* ============================================================================
   app.js — rendering + interaction for every section.

   Design of the update loop (why it's built this way):
   - `input`  events (typing in text/number/textarea) SAVE silently and never
     re-render, so the caret never jumps mid-word.
   - `change` events (checkbox / select / date, and text fields on blur) save
     AND re-render the current section, so progress bars and derived values
     (overdue flags, sprint dates, collab scores) refresh immediately.
   - `click`  on any [data-action] runs a command (add/delete/nav/export…).
   Every control carries data-k / data-id / data-f attributes that describe
   exactly which slice of state it edits — see mutate().
   ========================================================================== */
(function () {
  const S = window.Store;
  const SEED = S.seed;

  /* ---------- date helpers -------------------------------------------------
     All dates are stored as 'YYYY-MM-DD'. We always construct Date objects at
     local midnight to avoid timezone off-by-one surprises. */
  const DAY = 86400000;
  const todayISO = () => toISO(new Date());
  function toISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function fromISO(iso) { return iso ? new Date(iso + 'T00:00:00') : null; }
  function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (x.getDay() + 6) % 7;        // 0 = Monday
    x.setDate(x.getDate() - day);
    return x;
  }
  function daysBetween(isoA, isoB) {
    return Math.round((fromISO(isoB) - fromISO(isoA)) / DAY);
  }
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmt(iso) {
    if (!iso) return '';
    const d = fromISO(iso);
    return `${WD[d.getDay()]} ${pad(d.getDate())} ${MO[d.getMonth()]}`;
  }
  function monthKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  function monthLabel(key) {
    const [y, m] = key.split('-');
    return `${MO[+m - 1]} ${y}`;
  }

  /* ---------- tiny DOM/format helpers -------------------------------------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function bar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const cls = pct >= 100 ? ' is-complete' : '';
    return `<div class="bar${cls}"><span style="width:${pct}%"></span></div>
            <div class="bar-meta">${done}/${total} · ${pct}%</div>`;
  }
  function options(list, sel) {
    return list.map((o) => `<option${o === sel ? ' selected' : ''}>${esc(o)}</option>`).join('');
  }

  /* ---------- collapsible sections -----------------------------------------
     Every section on every page is a <details>. Which ones you've collapsed is
     remembered per-device (localStorage, not synced) and survives re-renders.
     `title` may contain HTML; `body` is the section's inner HTML. */
  const COLLAPSE_KEY = 'em-tracker-collapse';
  let collapse = {};
  try { collapse = JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {}; } catch (e) { collapse = {}; }
  function saveCollapse() { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapse)); } catch (e) {} }
  function secOpen(key, defOpen) { return key in collapse ? collapse[key] : defOpen !== false; }
  function section(key, title, body, defOpen) {
    return `<details class="sec" data-sec="${esc(key)}"${secOpen(key, defOpen) ? ' open' : ''}>
      <summary class="sec-head">${title}</summary>
      <div class="sec-body">${body}</div>
    </details>`;
  }

  /* ---------- period cursors (which week / month is being viewed) ---------- */
  let weekCursor = toISO(mondayOf(new Date())); // Monday ISO
  let monthCursor = monthKey(new Date());        // YYYY-MM

  function ensureWeek(k) {
    const w = S.state.weeks[k] || (S.state.weeks[k] = { tasks: {} });
    if (!w.counts) w.counts = {};
    // Back-compat: the old single `stories` number becomes a keyed counter.
    if (w.stories != null && w.counts.stories == null) { w.counts.stories = w.stories; delete w.stories; }
    return w;
  }
  function ensureMonth(k) {
    if (!S.state.months[k]) S.state.months[k] = {};
    return S.state.months[k];
  }
  function ensureMonthLog(k) {
    if (!S.state.monthlyLog[k]) S.state.monthlyLog[k] = {};
    return S.state.monthlyLog[k];
  }
  // Posts logged within a given "YYYY-MM", newest first.
  function postsInMonth(mk) {
    return S.state.posts
      .filter((p) => (p.date || '').slice(0, 7) === mk)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  /* =========================================================================
     SECTION 1 — TODAY / THIS WEEK
     ========================================================================= */
  const DABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dateShort = (iso) => fmt(iso).split(' ').slice(1).join(' '); // "03 Aug"

  // One chip on the week grid. `src` carries the data-* to tick its source.
  function wkChip(c) {
    const cls = ['wk-chip', c.overdue ? 'overdue' : c.type, c.done ? 'done' : ''].join(' ');
    return `<label class="${cls}"${c.tip || ''}>
      <input type="checkbox" hidden ${c.src} ${c.done ? 'checked' : ''}>
      <span>${esc(c.label)}</span>
    </label>`;
  }

  function viewToday() {
    const wk = ensureWeek(weekCursor);
    const isThisWeek = weekCursor === toISO(mondayOf(new Date()));
    const weekEnd = addDays(weekCursor, 6);
    const today = todayISO();
    const thisMk = monthKey(new Date());

    // 7 day cells for the visible week.
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekCursor, i);
      days.push({ abbr: DABBR[i], dateISO: d, chips: [] });
    }
    const byAbbr = Object.fromEntries(days.map((d) => [d.abbr, d]));
    const byDate = Object.fromEntries(days.map((d) => [d.dateISO, d]));

    // Source 1 — the four weekly series (tick → wk.tasks).
    SEED.weekSeries.forEach((s) => {
      const d = byAbbr[s.day]; if (!d) return;
      d.chips.push({ type: 'series', label: s.label, done: !!wk.tasks[s.key],
        dateISO: d.dateISO, src: `data-k="week" data-f="${s.key}"` });
    });
    // Source 2 — active sprint items landing in this week (tick → sprint item).
    S.state.sprints.forEach((sp) => {
      (sp.items || []).forEach((it) => {
        if (it.date < weekCursor || it.date > weekEnd) return;
        const d = byDate[it.date]; if (!d) return;
        d.chips.push({ type: it.kind === 'admin' ? 'admin' : 'sprint', label: it.label,
          done: it.done, dateISO: it.date, sprintPost: it.kind === 'post',
          src: `data-k="sprint" data-id="${sp.id}" data-item="${it.key}" data-f="done"` });
      });
    });
    // Source 3 — stories + engagement (muted).
    SEED.weekStories.forEach((s) => { const d = byAbbr[s.day]; if (!d) return;
      d.chips.push({ type: 'dim', label: 'Story', done: !!wk.tasks[s.key], dateISO: d.dateISO, src: `data-k="week" data-f="${s.key}"` }); });
    SEED.weekEngage.forEach((s) => { const d = byAbbr[s.day]; if (!d) return;
      d.chips.push({ type: 'dim', label: 'Engage', done: !!wk.tasks[s.key], dateISO: d.dateISO, src: `data-k="week" data-f="${s.key}"` }); });

    // Merge rule: a sprint post on a day drops that day's series post.
    days.forEach((d) => {
      if (d.chips.some((c) => c.sprintPost)) d.chips = d.chips.filter((c) => c.type !== 'series');
    });

    // Overdue = due before today and not ticked. Count for the header badge.
    let overdue = 0;
    days.forEach((d) => d.chips.forEach((c) => {
      c.overdue = !c.done && c.dateISO < today;
      if (c.overdue) overdue++;
    }));

    // Today strip.
    const todayCell = byDate[today];
    const todayDue = todayCell ? todayCell.chips.filter((c) => !c.done) : [];
    const todayStrip = isThisWeek ? `
      <div class="today-strip">
        <div class="ts-head">Today · ${dateShort(today)}</div>
        ${todayDue.length
          ? `<div class="wk-chips">${todayDue.map(wkChip).join('')}</div>`
          : `<span class="muted">Nothing due today — grab a studio capture (2 min → CAPTURES).</span>`}
      </div>` : '';

    const grid = `<div class="wk-grid">${days.map((d) => `
      <div class="wk-day ${d.dateISO === today ? 'today' : ''}">
        <div class="wk-day-head"><b>${d.abbr}</b><span>${dateShort(d.dateISO)}</span></div>
        <div class="wk-chips">${d.chips.map(wkChip).join('') || '<span class="wk-empty">—</span>'}</div>
      </div>`).join('')}</div>`;

    const legend = `<div class="wk-legend">
      <span class="lg series">Series</span>
      <span class="lg sprint">Sprint</span>
      <span class="lg admin">Admin</span>
    </div>`;

    // Footer — sprint status + this month's block.
    const sprintFoot = S.state.sprints.map((sp) => {
      const dOut = daysBetween(today, sp.releaseDate);
      const status = dOut === 0 ? 'Release day — today'
        : dOut > 0 ? `Releases in ${dOut} day${dOut === 1 ? '' : 's'}`
        : `Released ${-dOut} day${dOut === -1 ? '' : 's'} ago`;
      const dn = (sp.items || []).filter((it) => it.done).length;
      return `<div class="foot-card">
        <div class="fc-title">${esc(sp.trackName || 'Release')}</div>
        <div class="fc-status ${dOut === 0 ? 'live' : ''}">${status}</div>
        <div class="muted">${dn}/${(sp.items || []).length} done · ${fmt(sp.releaseDate)}</div>
      </div>`;
    }).join('');
    const mBlock = ensureMonth(thisMk);
    const blockRows = SEED.monthlyTemplate.map((t) => `
      <label class="task ${mBlock[t.key] ? 'done' : ''}">
        <input type="checkbox" data-k="monthAt" data-mk="${thisMk}" data-f="${t.key}" ${mBlock[t.key] ? 'checked' : ''}>
        <span class="task-label">${esc(t.label)}</span></label>`).join('');
    const footer = `<div class="wk-footer">
      ${sprintFoot || '<div class="foot-card"><div class="fc-title muted">No active sprint</div><div class="muted">Generate one on the Sprint tab.</div></div>'}
      <div class="foot-card">
        <div class="fc-title">This month's block</div>
        ${blockRows}
      </div>
    </div>`;

    return `
    <div class="wk-header">
      <div><h2>This week</h2>
        <p class="sub">${fmt(weekCursor)} – ${fmt(weekEnd)}</p></div>
      <div class="wk-header-right">
        ${overdue > 0 ? `<span class="overdue-badge">${overdue} overdue</span>` : ''}
        <div class="weeknav">
          <button data-action="week-prev" aria-label="previous week">‹</button>
          ${isThisWeek ? '' : `<button class="ghost" data-action="week-today" style="padding:6px 10px">Today</button>`}
          <button data-action="week-next" aria-label="next week">›</button>
        </div>
      </div>
    </div>
    ${todayStrip}
    ${grid}
    ${legend}
    ${footer}`;
  }

  // Who to spend the engagement blocks on — pulled live from the Collab Ladder
  // (any named artist you haven't landed yet). This is the reach mechanism now:
  // warm the target up with real likes/comments before the remix approach.
  function engagementTargets() {
    const targets = S.state.collab.filter((c) =>
      (c.artist || '').trim() && !['Landed', 'Passed', 'Parked'].includes(c.status));
    if (!targets.length) {
      return `<div class="eng-targets empty-hint">Add artists in
        <a href="#/collab">Collab</a> and they'll show here as who to warm up.</div>`;
    }
    const chips = targets.map((t) =>
      `<a class="chip" href="#/collab">${esc(t.artist)}${t.warmth && t.warmth !== 'Cold'
        ? `<i>${esc(t.warmth.toLowerCase())}</i>` : ''}</a>`).join('');
    return `<div class="eng-targets">
      <div class="eng-targets-head">This week's targets · from Collab</div>
      <div class="chip-wrap">${chips}</div></div>`;
  }

  /* =========================================================================
     SECTION 2 — CONTENT (reference + ideas)
     ========================================================================= */
  const effortClass = (e) => (e === 'Medium' ? 'med' : e === 'Very low' ? 'vlow' : 'low');
  let contentIdea = null; // { s: seriesIndex, f: formatIndex } — not persisted

  // Spinning wheel state (not persisted). rotation accumulates so each spin
  // continues forward from where the last one stopped.
  let wheelRotation = 0;
  let trendMetric = 'listeners'; // which monthly-log number the graph plots

  // Distinct colour per segment via the golden angle — spreads neighbouring
  // hues far apart so every slice reads as its own colour (the landed genre is
  // shown in the readout below, so the wheel itself carries no text).
  const wheelColor = (i) => `hsl(${(i * 137.508) % 360}, 66%, 54%)`;

  // Build the wheel SVG — coloured segments only, no labels.
  function buildWheel(list) {
    const n = list.length;
    const slice = 360 / n;
    const S = 260, cx = 130, cy = 130, r = 124, hub = 19;
    const pt = (ang, rad) => {
      const a = (ang - 90) * Math.PI / 180; // ang clockwise from 12 o'clock
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    };

    const segs = list.map((_, i) => {
      const a0 = i * slice, a1 = (i + 1) * slice;
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
      const large = slice > 180 ? 1 : 0;
      const path = `M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z`;
      return `<path d="${path}" data-i="${i}" fill="${wheelColor(i)}" stroke="#FBF7EA" stroke-width="0.8"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${S} ${S}" class="wheel-svg" id="wheel" style="transform:rotate(${wheelRotation}deg)">
      <g>${segs}</g>
      <circle cx="${cx}" cy="${cy}" r="${hub}" fill="#F2E8CF" stroke="#386641" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="${hub - 6}" fill="#A7C957"/>
    </svg>`;
  }

  function viewContent() {
    const c = SEED.content;

    const times = c.postingTimes.map((t) => `
      <div class="times-row">
        <div class="tt-type">${esc(t.type)}</div>
        <div class="tt-when"><b>${esc(t.time)}</b><span>${esc(t.days)}</span></div>
        <div class="tt-tip">${esc(t.tip)}</div>
      </div>`).join('');

    let ideaCard = `<div class="idea-empty">Pick a day, or hit Shuffle, for a format to point the camera at.</div>`;
    if (contentIdea) {
      const s = c.series[contentIdea.s];
      const f = c.formats[contentIdea.f];
      ideaCard = `<div class="idea-result">
        <div class="idea-series">${s.day} · ${esc(s.name)}</div>
        <div class="idea-format"><b>${esc(f.name)}</b>
          <span class="effort ${effortClass(f.effort)}">${esc(f.effort)}</span></div>
        <p>${esc(f.what)}</p>
        <div class="idea-cap">${esc(s.caption)}</div>
      </div>`;
    }
    const ideaBtns = c.series.map((s, i) =>
      `<button class="chip-btn" data-action="idea" data-s="${i}">${s.day}</button>`).join('') +
      `<button class="chip-btn primary" data-action="idea" data-s="-1">Shuffle</button>`;

    const series = c.series.map((s) => `
      <div class="ref-item">
        <div class="ref-title">${s.day} — ${esc(s.name)}</div>
        <p>${esc(s.what)}</p>
        <div class="ref-cap">${esc(s.caption)}</div>
      </div>`).join('');

    const formats = c.formats.map((f) => `
      <div class="fmt-row">
        <div><b>${esc(f.name)}</b>${f.note ? ` <span class="muted">· ${esc(f.note)}</span>` : ''}
          <p>${esc(f.what)}</p></div>
        <span class="effort ${effortClass(f.effort)}">${esc(f.effort)}</span>
      </div>`).join('');

    const stories = c.storyIdeas.map((s) => `
      <div class="story-row"><span class="tag-chip">${esc(s.tag)}</span>${esc(s.idea)}</div>`).join('');

    const lang = c.language.map((l) => `
      <div class="lang-row"><div class="lang-el">${esc(l.el)}</div><div>${esc(l.rule)}</div></div>`).join('');

    const dos = c.presence.do.map((x) => `<li>${esc(x)}</li>`).join('');
    const donts = c.presence.dont.map((x) => `<li>${esc(x)}</li>`).join('');

    // Post log — quick capture + this month's recent entries.
    const recent = postsInMonth(monthKey(new Date())).slice(0, 8);
    const recentHtml = recent.length
      ? recent.map((p) => `<div class="post-row">
          <span class="tag-chip">${esc(p.type)}</span>
          <span class="post-desc">${esc(p.desc)}</span>
          <span class="post-date">${fmt(p.date)}</span>
          <button class="icon-del" data-action="post-del" data-id="${p.id}" aria-label="delete log entry">✕</button>
        </div>`).join('')
      : `<div class="empty small">Nothing logged this month yet.</div>`;

    const jump = [
      ['c-postlog', 'Log'], ['c-idea', 'Ideas'], ['c-wheel', 'Wheel'], ['c-times', 'Times'],
      ['c-audience', 'Audience'], ['c-series', 'Series'], ['c-formats', 'Formats'],
      ['c-stories', 'Stories'], ['c-language', 'Language'], ['c-presence', 'On camera'],
    ].map(([sec, lab]) => `<button class="chip-btn" data-action="jump" data-sec="${sec}">${lab}</button>`).join('');

    return `
    <div class="section-head"><div>
      <h2>Content</h2>
      <p class="sub">What to post, when to post it, and ideas for a blank feed.</p>
    </div></div>

    <div class="content-nav chip-row">${jump}</div>

    ${section('c-postlog', `Log a post <span class="muted">· feeds the monthly review</span>`, `
      <div class="postlog-add">
        <select id="post-type">${options(SEED.postTypes, 'Post')}</select>
        <input id="post-desc" type="text" placeholder="What did you post? e.g. CRT re-film of the new intro">
        <button data-action="post-add">Log it</button>
      </div>
      <div class="postlog-recent">${recentHtml}</div>`)}

    ${section('c-idea', 'Idea generator', `
      <div class="chip-row">${ideaBtns}</div>
      ${ideaCard}`)}

    ${section('c-wheel', `Spin the wheel <span class="muted">· stuck? spin for an edit direction</span>`, `
      <div class="wheel-wrap" data-action="wheel-spin" title="tap to spin">
        <div class="wheel-pointer"></div>
        ${buildWheel(SEED.wheel)}
      </div>
      <button class="wheel-spin" data-action="wheel-spin">Spin</button>
      <div class="wheel-result" id="wheel-result"></div>`)}

    ${section('c-times', `Best posting times <span class="muted">· from your IG data</span>`, `
      <div class="times-table">${times}</div>
      <div class="active-note">${esc(SEED.insights.activeWindows)}</div>`, false)}

    ${section('c-audience', `Audience snapshot <span class="muted">· who you're talking to</span>`, `
      <ul class="aud-list">
        <li><b>Age</b> ${esc(SEED.insights.audience.age)}</li>
        <li><b>Gender</b> ${esc(SEED.insights.audience.gender)}</li>
        <li><b>Instagram</b> ${esc(SEED.insights.audience.igPlaces)}</li>
        <li><b>Spotify</b> ${esc(SEED.insights.audience.spotifyPlaces)}</li>
      </ul>
      <div class="insight">${esc(SEED.insights.audience.crux)}</div>
      <div class="insight amber">${esc(SEED.insights.contentTakeaway)}</div>`, false)}

    ${section('c-series', 'The four series — weekly rotation', series, false)}

    ${section('c-formats', 'Format library — what to point a camera at', formats, false)}

    ${section('c-stories', `Story ideas <span class="muted">· 8–10 PM, Tue–Thu</span>`, stories, false)}

    ${section('c-language', "Content language — lock once, don't revisit", lang, false)}

    ${section('c-presence', 'Being in your own content', `
      <div class="do-dont">
        <div><div class="dd-head ok">Do</div><ul>${dos}</ul></div>
        <div><div class="dd-head red">Don't</div><ul>${donts}</ul></div>
      </div>`, false)}`;
  }

  /* =========================================================================
     SECTION 3 — MONTHLY
     ========================================================================= */
  function viewMonthly() {
    const m = ensureMonth(monthCursor);
    const log = ensureMonthLog(monthCursor);
    const isThisMonth = monthCursor === monthKey(new Date());
    const tmpl = SEED.monthlyTemplate;
    const done = tmpl.filter((t) => m[t.key]).length;

    const rows = tmpl.map((t) => {
      const on = !!m[t.key];
      return `<label class="task ${on ? 'done' : ''}">
        <input type="checkbox" data-k="month" data-f="${t.key}" ${on ? 'checked' : ''}>
        <span class="task-label">${esc(t.label)}</span></label>`;
    }).join('');

    // End-of-month log — numbers with an inline delta-vs-baseline badge.
    const def = SEED.monthlyLogDef;
    const spInputs = def.spotify.map((f) => {
      const val = log[f.key];
      const hasVal = val !== '' && val != null && !isNaN(Number(val));
      let badge = '';
      if (hasVal && f.baseNum) {
        const pct = Math.round(((Number(val) - f.baseNum) / f.baseNum) * 100);
        badge = `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '+' : ''}${pct}%</span>`;
      }
      const baseHint = f.base ? `<em class="base">previous: ${esc(f.base)}</em>` : '';
      return `<label class="field"><span>${esc(f.label)} ${baseHint} ${badge}</span>
        <input type="number" data-k="mlog" data-f="${f.key}" value="${esc(val == null ? '' : val)}"></label>`;
    }).join('');
    const txtInputs = def.text.map((f) => `
      <label class="field"><span>${esc(f.label)}</span>
        <textarea rows="2" data-k="mlog" data-f="${f.key}">${esc(log[f.key] || '')}</textarea></label>`).join('');

    // What you posted this month (from the post log).
    const posts = postsInMonth(monthCursor);
    const counts = posts.reduce((a, p) => { a[p.type] = (a[p.type] || 0) + 1; return a; }, {});
    const countChips = Object.keys(counts).length
      ? Object.keys(counts).map((k) => `<span class="chip">${esc(k)} <i>${counts[k]}</i></span>`).join('')
      : '<span class="muted">Nothing logged yet — add posts from the Content tab.</span>';
    const postList = posts.length
      ? posts.map((p) => `<div class="post-row">
          <span class="tag-chip">${esc(p.type)}</span>
          <span class="post-desc">${esc(p.desc)}</span>
          <span class="post-date">${fmt(p.date)}</span></div>`).join('')
      : '';

    return `
    <div class="section-head">
      <div><h2>Monthly</h2>
        <p class="sub">The once-a-month block, plus your end-of-month review.</p></div>
      <div class="weeknav">
        <button data-action="month-prev" aria-label="previous month">‹</button>
        <div class="weeklabel"><b>${isThisMonth ? 'This month' : 'Month'}</b>
          <span>${monthLabel(monthCursor)}</span></div>
        <button data-action="month-next" aria-label="next month">›</button>
      </div>
    </div>

    ${section('m-tasks', `This month's block <span class="sec-tag muted">${done}/${tmpl.length}</span>`, `<div class="group">${rows}</div>`)}

    ${section('m-posted', `What you posted <span class="muted">· ${monthLabel(monthCursor)}</span>`, `
      <div class="chip-wrap">${countChips}</div>
      ${postList ? `<div class="postlog-recent" style="margin-top:12px">${postList}</div>` : ''}`)}

    ${section('m-log', 'End-of-month log', `
      <div class="subhead2">Spotify numbers</div>
      <div class="grid2">${spInputs}</div>
      <div class="subhead2">Review</div>
      ${txtInputs}`)}

    ${isThisMonth ? '' : `<button class="ghost" data-action="month-today">Jump to this month</button>`}
    `;
  }

  /* =========================================================================
     SECTION 4 — RELEASE SPRINT
     ========================================================================= */
  function viewSprint() {
    const sprints = S.state.sprints;
    const cards = sprints.length
      ? sprints.map(sprintCard).join('')
      : `<div class="empty">No sprints yet. Enter a release date (a Friday) — the
         full 19-item release workflow is generated from it.</div>`;

    return `
    <div class="section-head">
      <div><h2>Release Sprint</h2>
        <p class="sub">The full release workflow — distro, press, and the six-week post run — laid out from your release date.</p></div>
    </div>

    <div class="card add-row">
      <label class="field">
        <span>New release date (Friday)</span>
        <input type="date" id="new-sprint-date">
      </label>
      <input type="text" id="new-sprint-name" placeholder="Track name (optional)" style="flex:1;min-width:140px">
      <button data-action="sprint-add">Generate</button>
    </div>

    ${cards}`;
  }

  // Build a sprint's items from the template + a release date.
  function makeSprintItems(releaseDate) {
    return SEED.sprintTemplate.map((t) => ({
      key: t.key, label: t.label, kind: t.kind, blockedBy: t.blockedBy || null,
      date: addDays(releaseDate, t.offset), done: false,
    }));
  }

  function sprintItemRow(sp, it) {
    const today = todayISO();
    const blocker = it.blockedBy ? sp.items.find((x) => x.key === it.blockedBy) : null;
    const blocked = blocker && !blocker.done;
    const overdue = !it.done && !blocked && it.date < today;
    const cls = ['sprint-item', it.kind, it.done ? 'done' : '', overdue ? 'overdue' : '', blocked ? 'blocked' : ''].join(' ');
    const blockTip = blocker ? ` title="unlocks once ${esc(blocker.label)} is done"` : '';
    return `<div class="${cls}"${blockTip}>
      <input type="checkbox" data-k="sprint" data-id="${sp.id}" data-item="${it.key}" data-f="done"
             ${it.done ? 'checked' : ''} ${blocked ? 'disabled' : ''}>
      <span class="si-label">${esc(it.label)}${it.kind === 'admin' ? '<span class="si-kind">admin</span>' : ''}</span>
      ${overdue ? '<span class="tag-red si-flag">overdue</span>' : ''}
      <input type="date" class="si-date" data-k="sprint" data-id="${sp.id}" data-item="${it.key}" data-f="date" value="${esc(it.date)}">
    </div>`;
  }

  function sprintCard(sp) {
    const today = todayISO();
    if (!sp.items) sp.items = makeSprintItems(sp.releaseDate); // migrate old shape
    const total = sp.items.length;
    const done = sp.items.filter((it) => it.done).length;
    const notFriday = fromISO(sp.releaseDate).getDay() !== 5;
    const daysOut = daysBetween(today, sp.releaseDate);

    // Warnings.
    const warns = [];
    if (notFriday) warns.push(`Heads up — ${fmt(sp.releaseDate)} isn't a Friday. Offsets assume a Friday release.`);
    if (daysOut < 42) {
      const past = sp.items.filter((it) => it.date < today).map((it) => it.label);
      warns.push(`Only ${daysOut} day${daysOut === 1 ? '' : 's'} out (workflow wants 42+). Already in the past: ${past.length ? esc(past.join(', ')) : 'none'}.`);
    }
    const warnHtml = warns.map((w) => `<div class="sprint-warn">${w}</div>`).join('');

    // Group by phase (before vs on/after release day), sorted by date.
    const sorted = sp.items.slice().sort((a, b) => a.date.localeCompare(b.date));
    const pre = sorted.filter((it) => it.date < sp.releaseDate);
    const post = sorted.filter((it) => it.date >= sp.releaseDate);
    const rows = (arr) => arr.map((it) => sprintItemRow(sp, it)).join('');

    const title = `${esc(sp.trackName || sp.title || 'New release')}
      <span class="sec-tag muted">${fmt(sp.releaseDate)} · ${done}/${total}</span>`;
    const body = `
      <input class="inline-title" type="text" data-k="sprint" data-id="${sp.id}" data-f="trackName"
             value="${esc(sp.trackName || sp.title || '')}" placeholder="Track name">
      <div class="card-sub">Release ${fmt(sp.releaseDate)}${notFriday ? '' : ' · Friday'}</div>
      ${warnHtml}
      <div class="sprint-phase">Pre-release</div>
      ${rows(pre)}
      <div class="sprint-divider"><span>Release day · ${fmt(sp.releaseDate)}</span></div>
      ${rows(post)}
      <div class="cc-foot"><button class="link-del" data-action="sprint-del" data-id="${sp.id}">Delete sprint</button></div>`;
    return section('sprint-' + sp.id, title, body);
  }

  /* =========================================================================
     SECTION 5 — COLLAB LADDER
     ========================================================================= */
  const TIERS = [
    { key: 't1', label: 'Current — ~5k',      test: (n) => n > 0 && n < 8000 },
    { key: 't2', label: 'Tier 2 — 8–15k',     test: (n) => n >= 8000 && n < 15000 },
    { key: 't3', label: 'Tier 3 — 15–30k',    test: (n) => n >= 15000 && n <= 30000 },
    { key: 'tx', label: 'Above range / unset', test: (n) => !(n > 0 && n <= 30000) },
  ];

  // Full assessment: should you pursue this collab or move on? Combines the
  // guide's step-above + warmth with the key signal (listeners vs IG followers)
  // and the two red-flag filters (spike, gatekeeper). Returns a verdict + why.
  function collabAssess(row) {
    const me = S.state.meta.monthlyListeners || 5000;
    const listeners = Number(row.listeners) || 0;
    const followers = Number(row.igFollowers) || 0;
    const reasons = [];

    // 1. Step above you, not a leap.
    let stepPts = 0;
    if (listeners > 0) {
      const r = listeners / me;
      if (r <= 3) stepPts = 2;
      else if (r <= 6) { stepPts = 1; reasons.push('a stretch above you'); }
      else { stepPts = 0; reasons.push('too big a leap in listeners'); }
    }

    // 2. Warmth — do you know them.
    const warmPts = row.warmth === 'Warm' ? 2 : row.warmth === 'Lukewarm' ? 1 : 0;
    if (warmPts === 2) reasons.push('already warm');

    // 3. THE key signal — fanbase vs algorithmic audience (followers ÷ listeners).
    let fanPts = 0, fanClass = null;
    if (listeners > 0 && followers > 0) {
      const fr = followers / listeners;
      if (fr >= 0.25) { fanPts = 2; fanClass = 'real fanbase'; reasons.push('real fanbase, not just an algorithm'); }
      else if (fr >= 0.1) { fanPts = 1; fanClass = 'mixed'; }
      else { fanPts = 0; fanClass = 'algorithmic'; reasons.push('algorithmic audience — playlist adjacency, few actual people'); }
    }

    // Red-flag filters.
    let penalty = 0;
    if (row.spike) { penalty += 1; reasons.push('number looks like a spike, not a baseline'); }
    if (row.gatekeeper) { penalty += 1; reasons.push('gatekeeper in the bio — longer road'); }

    const haveFan = fanClass !== null;
    const raw = stepPts + warmPts + fanPts - penalty;
    const score = Math.max(0, raw);
    const outOf = haveFan ? 6 : 4;

    // Verdict. Without the follower number we can't run the key check, so cap
    // the confidence and nudge them to add it.
    let verdict, tone;
    if (haveFan) {
      if (fanClass === 'algorithmic' && warmPts < 2) { verdict = 'Move on'; tone = 'red'; }
      else if (score >= 5) { verdict = 'Pursue'; tone = 'ok'; }
      else if (score >= 3) { verdict = 'Worth a shot'; tone = 'amber'; }
      else { verdict = 'Move on'; tone = 'red'; }
    } else {
      if (score >= 4) { verdict = 'Worth a shot'; tone = 'amber'; }
      else if (score >= 2) { verdict = 'Worth a shot'; tone = 'amber'; }
      else { verdict = 'Weak so far'; tone = 'red'; }
      reasons.unshift('add their IG followers for the real read');
    }

    return { score, outOf, verdict, tone, fanClass, reasons };
  }

  function tierOf(n) { return (TIERS.find((t) => t.test(Number(n) || 0)) || TIERS[3]).key; }

  // Older saved rows may predate the step model — give them a safe shape.
  function collabSteps(r) { return r.steps || (r.steps = {}); }

  // Where they sit in the pipeline — a short badge.
  function collabStage(r) {
    if (['Landed', 'Passed', 'Parked'].includes(r.status)) return r.status;
    const s = collabSteps(r);
    if (s.proposed) return 'In conversation';
    if (s.reacted) return 'Reacted';
    if (s.remixSent) return 'Remix sent';
    if (s.remixMade || s.trackPicked) return 'Making remix';
    if (s.followed || s.engaging) return 'Warming up';
    return 'Shortlist';
  }

  // The single most useful thing: what to do next with this artist. Encodes the
  // guide's remix-first procedure, including "warm them up before you ask".
  function collabNext(r) {
    const s = collabSteps(r);
    if (r.status === 'Landed') return { text: 'Landed — deliver the collab, and the visuals you offered.', tone: 'ok' };
    if (r.status === 'Passed') return { text: "Passed. Post the remix publicly anyway — it wasn't wasted.", tone: 'muted' };
    if (r.status === 'Parked') return { text: "Parked. Revisit when the timing's better.", tone: 'muted' };
    if (!s.followed)  return { text: 'Follow them and start showing up — this is a warm-up, not a cold ask.' };
    if (!s.engaging)  return { text: 'Start genuinely engaging: a few real comments and likes on their posts.' };
    if (!s.trackPicked) {
      if (r.followedSince) {
        const d = daysBetween(r.followedSince, todayISO());
        if (d < 14) return { text: `Keep engaging — give it ~2 weeks of real presence first. Following ${d} day${d === 1 ? '' : 's'}.` };
      } else {
        return { text: 'Set a "following since" date and keep engaging ~2 weeks before the remix.' };
      }
      return { text: 'Pick a track of theirs you actually like to remix.' };
    }
    if (!s.remixMade) return { text: "Make the remix and finish it properly — it's the pitch, not a demo." };
    if (!s.remixSent) return { text: 'Send the remix once, unprompted, with no ask attached.' };
    if (!s.reacted)   return { text: 'Wait for a genuine reaction. Nothing in 2 weeks → one follow-up, then move on.' };
    if (!s.proposed)  return { text: "They reacted — wait 3–5 days, then propose the collab and offer to shoot the visuals." };
    return { text: 'Proposed — keep it warm. Set the outcome (Landed / Passed) when you know.' };
  }

  function viewCollab() {
    const me = S.state.meta.monthlyListeners || 5000;
    const items = S.state.collab;

    const noneAtAll = items.length === 0;
    const groups = noneAtAll
      ? `<div class="empty">No artists yet. Start with someone a step above you (~8–15k listeners)
           you'd genuinely want to work with — a warm contact beats a stranger.
           <button data-action="collab-add" style="margin-top:12px">+ Add your first artist</button></div>`
      : TIERS.map((t) => {
        const rows = items.filter((r) => tierOf(r.listeners) === t.key);
        const active = rows.filter((r) => !['Landed', 'Passed', 'Parked'].includes(r.status)).length;
        const shortfall = (t.key === 't2' || t.key === 't3') && active < 3;
        const body = rows.length
          ? rows.map(collabCard).join('')
          : `<button class="tier-add" data-action="collab-add">+ Add to this tier</button>`;
        return `<div class="tier">
          <div class="tier-head">
            <span>${t.label}</span>
            <span class="${shortfall ? 'tag-amber' : 'muted'}">${active} active${shortfall ? ' · aim for 3–4' : ''}</span>
          </div>${body}</div>`;
      }).join('');

    return `
    <div class="section-head">
      <div><h2>Collab Ladder</h2>
        <p class="sub">Log anyone you'd like to work with. Each one gets a warm-up
        checklist and a suggested next move — a step above you, not a leap.</p></div>
      <button data-action="collab-add">+ Artist</button>
    </div>
    <div class="card mini">Your monthly listeners:
      <input class="num" type="number" data-k="meta" data-f="monthlyListeners" value="${esc(me)}">
      <span class="muted">— drives the step-above check</span></div>

    ${section('collab-sources', 'Where to find targets — best sources, in order of fit', `
      <ol class="src-ol">
        ${SEED.collabSourcing.sources.map((x) => `<li><b>${esc(x.t)}</b><span>${esc(x.d)}</span></li>`).join('')}
      </ol>
      <div class="insight">${esc(SEED.collabSourcing.ratio)}</div>
      <ul class="src-filters">
        ${SEED.collabSourcing.filters.map((f) => `<li>${esc(f)}</li>`).join('')}
      </ul>`, false)}
    ${groups}`;
  }

  function collabCard(r) {
    const a = collabAssess(r);
    const s = collabSteps(r);
    const stage = collabStage(r);
    const next = collabNext(r);
    const closed = ['Landed', 'Passed', 'Parked'].includes(r.status);
    const doneCount = SEED.collabSteps.filter((st) => s[st.key]).length;

    // Follow-duration hint next to the "following since" date.
    let followHint = '';
    if (r.followedSince) {
      const d = daysBetween(r.followedSince, todayISO());
      followHint = `<span class="${d >= 14 ? 'ok' : 'muted'} follow-hint">following ${d}d${d >= 14 ? ' · ready' : ''}</span>`;
    }

    const steps = SEED.collabSteps.map((st) => `
      <label class="task cc-step ${s[st.key] ? 'done' : ''}">
        <input type="checkbox" data-k="collab" data-id="${r.id}" data-f="step:${st.key}" ${s[st.key] ? 'checked' : ''}>
        <span class="task-label">${esc(st.label)}</span>
      </label>`).join('');

    const fanTag = a.fanClass
      ? `<span class="fan-tag ${a.fanClass === 'real fanbase' ? 'ok' : a.fanClass === 'mixed' ? 'amber' : 'red'}">${esc(a.fanClass)}</span>`
      : '';
    const reasonLine = a.reasons.length ? `<div class="assess-why">${esc(a.reasons.join(' · '))}</div>` : '';

    const secTitle = `${esc(r.artist || 'New artist')}
      <span class="stagebadge sec-tag">${esc(stage)}</span>`;
    const body = `<div class="collab-card ${closed ? 'closed' : ''}">
      <div class="cc-head">
        <input class="lc-name" type="text" data-k="collab" data-id="${r.id}" data-f="artist"
               value="${esc(r.artist)}" placeholder="Artist name">
      </div>

      <div class="cc-meta">
        <label class="field"><span>Monthly listeners</span>
          <input type="number" data-k="collab" data-id="${r.id}" data-f="listeners" value="${esc(r.listeners || '')}"></label>
        <label class="field"><span>Instagram followers</span>
          <input type="number" data-k="collab" data-id="${r.id}" data-f="igFollowers" value="${esc(r.igFollowers || '')}"></label>
        <label class="field"><span>What they make</span>
          <input type="text" data-k="collab" data-id="${r.id}" data-f="genre" value="${esc(r.genre || '')}" placeholder="e.g. melodic house"></label>
        <label class="field"><span>Do you know them?</span>
          <select data-k="collab" data-id="${r.id}" data-f="warmth">${options(SEED.lists.warmth, r.warmth)}</select></label>
        <label class="field"><span>Following since ${followHint}</span>
          <input type="date" data-k="collab" data-id="${r.id}" data-f="followedSince" value="${esc(r.followedSince || '')}"></label>
        <label class="field"><span>Status</span>
          <select data-k="collab" data-id="${r.id}" data-f="status">${options(SEED.lists.collabStatus, r.status)}</select></label>
      </div>

      <div class="cc-flags">
        <label class="chip-check ${r.spike ? 'on' : ''}">
          <input type="checkbox" data-k="collab" data-id="${r.id}" data-f="spike" ${r.spike ? 'checked' : ''}>
          <span>Top track is a spike, not a baseline</span></label>
        <label class="chip-check ${r.gatekeeper ? 'on' : ''}">
          <input type="checkbox" data-k="collab" data-id="${r.id}" data-f="gatekeeper" ${r.gatekeeper ? 'checked' : ''}>
          <span>Gatekeeper (mgmt / email in bio)</span></label>
      </div>

      <div class="assess ${a.tone}">
        <div class="assess-top">
          <span class="verdict ${a.tone}">${esc(a.verdict)}</span>
          <span class="assess-score">${a.score}/${a.outOf}</span>
          ${fanTag}
        </div>
        ${reasonLine}
      </div>

      <div class="cc-next ${next.tone || ''}"><span class="cc-next-tag">Next move</span>${esc(next.text)}</div>

      <div class="cc-progress"><span class="muted cc-steps-count">${doneCount}/${SEED.collabSteps.length} steps</span></div>

      <div class="cc-steps">${steps}</div>

      <div class="cc-fields">
        <label class="field"><span>Track of theirs to remix</span>
          <input type="text" data-k="collab" data-id="${r.id}" data-f="remixTrack" value="${esc(r.remixTrack)}"></label>
        <label class="field"><span>Notes / outcome</span>
          <input type="text" data-k="collab" data-id="${r.id}" data-f="outcome" value="${esc(r.outcome)}"></label>
      </div>

      <div class="cc-foot">
        <button class="link-del" data-action="collab-del" data-id="${r.id}">Delete this artist</button>
      </div>
    </div>`;
    return section('collab-' + r.id, secTitle, body);
  }

  /* =========================================================================
     SECTION 6 — 90-DAY ROADMAP
     ========================================================================= */
  function viewRoadmap() {
    const def = SEED.roadmap;
    const cards = Object.keys(def).map((mk) => {
      const d = def[mk];
      const st = S.state.roadmap[mk];
      const done = st.checks.filter(Boolean).length;

      const checks = d.checks.map((label, i) => `
        <label class="task ${st.checks[i] ? 'done' : ''}">
          <input type="checkbox" data-k="roadmap" data-id="${mk}" data-f="check:${i}" ${st.checks[i] ? 'checked' : ''}>
          <span class="task-label">${esc(label)}</span></label>`).join('');

      const numbers = d.numbers.map((nm, i) => `
        <label class="field"><span>${esc(nm.label)}${nm.target ? ` · target ${esc(nm.target)}` : ''}</span>
          <input type="text" data-k="roadmap" data-id="${mk}" data-f="num:${i}" value="${esc(st.numbers[i])}"></label>`).join('');

      const refl = d.reflections.map((q, i) => `
        <label class="field"><span>${esc(q)}</span>
          <textarea rows="2" data-k="roadmap" data-id="${mk}" data-f="refl:${i}">${esc(st.reflections[i])}</textarea></label>`).join('');

      const title = `${esc(d.title)} <span class="sec-tag muted">${done}/${d.checks.length}</span>`;
      const body = `
        <p class="sub">${esc(d.blurb)}</p>
        <div class="group roadmap-card">${checks}</div>
        ${d.numbers.length ? `<div class="subhead">Numbers</div><div class="grid2">${numbers}</div>` : ''}
        <div class="subhead">Reflection</div>${refl}`;
      return section('road-' + mk, title, body, mk === 'm1');
    }).join('');

    return `
    <div class="section-head"><div>
      <h2>90-Day Roadmap</h2>
      <p class="sub">Anchored to your two confirmed shows. Whichever lands first opens Month 1.</p>
    </div></div>${cards}`;
  }

  /* =========================================================================
     SECTION 7 — METRICS
     ========================================================================= */
  function autoValue(kind) {
    const st = S.state;
    switch (kind) {
      case 'collabCount': return st.collab.length;
      case 'listeners':   return Number(st.meta.monthlyListeners).toLocaleString();
      case 'collabsLanded': return st.collab.filter((c) => c.reply === 'Landed').length;
      default: return '';
    }
  }

  // Line chart of a monthly-log number across the months you've logged.
  function buildTrend(metricKey) {
    const log = S.state.monthlyLog;
    const pts = Object.keys(log).sort()
      .map((mk) => ({ mk, v: Number(log[mk][metricKey]) }))
      .filter((p) => log[p.mk][metricKey] !== '' && log[p.mk][metricKey] != null && !isNaN(p.v));

    if (pts.length < 2) {
      return `<div class="empty small">Log this number for at least two months and the trend line shows here.</div>`;
    }

    const W = 320, H = 120, padL = 8, padR = 8, padT = 10, padB = 20;
    const xs = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const vals = pts.map((p) => p.v);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; } // flat line guard
    const ys = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${xs(pts.length - 1).toFixed(1)},${H - padB} L${xs(0).toFixed(1)},${H - padB} Z`;
    const dots = pts.map((p, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(p.v).toFixed(1)}" r="3" fill="#A7C957"/>`).join('');
    const first = pts[0], last = pts[pts.length - 1];
    const delta = last.v - first.v;
    const deltaTxt = delta === 0 ? 'flat' : `${delta > 0 ? '+' : ''}${delta.toLocaleString()}`;

    return `
      <div class="trend-head">
        <span class="trend-now">${last.v.toLocaleString()}</span>
        <span class="delta ${delta >= 0 ? 'up' : 'down'}">${deltaTxt}</span>
        <span class="muted">since ${monthLabel(first.mk)}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="none">
        <path d="${area}" fill="rgba(167,201,87,.15)"/>
        <path d="${line}" fill="none" stroke="#A7C957" stroke-width="2" stroke-linejoin="round"/>
        ${dots}
      </svg>
      <div class="trend-x"><span>${monthLabel(first.mk)}</span><span>${monthLabel(last.mk)}</span></div>`;
  }

  function viewMetrics() {
    const def = SEED.metrics;

    const leading = def.leading.map((mtr) => {
      const auto = mtr.auto ? autoValue(mtr.auto) : null;
      const input = mtr.auto
        ? `<div class="metric-auto">${esc(auto)}<span class="auto-tag">auto</span></div>`
        : `<input type="text" class="metric-in" data-k="metric" data-id="leading" data-f="${mtr.key}"
             value="${esc(S.state.metrics.leading[mtr.key])}" placeholder="this month">`;
      return `<div class="metric-row">
        <div class="metric-name">${esc(mtr.label)}<span class="metric-target">${esc(mtr.target)}</span></div>
        ${input}</div>`;
    }).join('');

    const lagging = def.lagging.map((mtr) => {
      const auto = mtr.auto ? autoValue(mtr.auto) : null;
      const actual = mtr.auto
        ? `<div class="metric-auto">${esc(auto)}<span class="auto-tag">auto</span></div>`
        : `<input type="text" class="metric-in" data-k="metric" data-id="lagging" data-f="${mtr.key}"
             value="${esc(S.state.metrics.lagging[mtr.key])}" placeholder="actual">`;
      return `<div class="metric-row lag">
        <div class="metric-name">${esc(mtr.label)}</div>
        <div class="lag-track"><span>now</span><b>${esc(mtr.now)}</b></div>
        <div class="lag-track"><span>6mo</span><b>${esc(mtr.m6)}</b></div>
        <div class="lag-track"><span>12mo</span><b>${esc(mtr.m12)}</b></div>
        ${actual}</div>`;
    }).join('');

    const ins = SEED.insights;
    const tile = (s) => `<div class="stat ${s.flag ? 'flag' : ''}">
      <div class="stat-val">${esc(s.value)}${s.delta ? `<span class="delta ${s.dir}">${esc(s.delta)}</span>` : ''}${s.flag ? '<span class="delta down">leak</span>' : ''}</div>
      <div class="stat-lab">${esc(s.label)}${s.sub ? ` · ${esc(s.sub)}` : ''}</div>
    </div>`;
    const spTiles = ins.spotify.map(tile).join('');
    const igTiles = ins.instagram.map(tile).join('');
    const srcRows = ins.streamSources.map((s) => `
      <div class="src-row"><div class="src-lab">${esc(s.label)}</div>
        <div class="src-bar"><span style="width:${s.pct}%"></span></div>
        <div class="src-pct">${s.pct}%</div></div>`).join('');

    // What you've posted this calendar month, from the post log.
    const mk = monthKey(new Date());
    const monthPosts = postsInMonth(mk);
    const pc = monthPosts.reduce((a, p) => { a[p.type] = (a[p.type] || 0) + 1; return a; }, {});
    const postTiles = SEED.postTypes
      .filter((t) => pc[t])
      .map((t) => `<div class="stat"><div class="stat-val">${pc[t]}</div><div class="stat-lab">${esc(t)}${pc[t] > 1 ? 's' : ''}</div></div>`).join('');

    return `
    <div class="section-head"><div>
      <h2>Metrics</h2>
      <p class="sub">Track the leading ones. The lagging ones are aims, not promises.</p>
    </div></div>

    ${section('me-posted', `Posted this month <span class="muted">· ${monthLabel(mk)}</span>`,
      monthPosts.length
        ? `<div class="stat-grid">${postTiles}</div>`
        : `<div class="empty small">Nothing logged yet — log posts from the Content tab as you go.</div>`)}

    ${section('me-funnel', `The leak <span class="muted">· feed → Spotify, last 90 days</span>`, `
      <div class="funnel">
        <div class="fn-step"><div class="fn-val">45,170</div><div class="fn-lab">IG views</div></div>
        <div class="fn-arrow">1.4%</div>
        <div class="fn-step"><div class="fn-val">641</div><div class="fn-lab">Profile visits</div></div>
        <div class="fn-arrow drop">0.3%</div>
        <div class="fn-step leak"><div class="fn-val">2</div><div class="fn-lab">Bio-link taps</div></div>
      </div>
      <div class="mini-note">45k people saw your content; 2 tapped through. The feed→Spotify jump is where the reach leaks out — one clear CTA + link one tap away is the cheapest fix.</div>`)}

    ${section('me-trend', `Trend <span class="muted">· from your monthly logs</span>`, `
      <div class="chip-row">
        ${SEED.monthlyLogDef.spotify.map((f) =>
          `<button class="chip-btn ${f.key === trendMetric ? 'primary' : ''}" data-action="trend" data-m="${f.key}">${esc(f.label)}</button>`).join('')}
      </div>
      ${buildTrend(trendMetric)}`)}

    ${section('me-baseline', `Starting baseline <span class="muted">· ${esc(ins.date)}, don't edit</span>`, `
      <div class="subhead2">Spotify · last 12 months</div>
      <div class="stat-grid">${spTiles}</div>
      <div class="mini-note">${esc(ins.topTrack)}</div>
      <div class="subhead2">Instagram · last 90 days</div>
      <div class="stat-grid">${igTiles}</div>
      <div class="subhead2">Where your streams come from</div>
      <div class="src-list">${srcRows}</div>
      <div class="mini-note">${esc(ins.sourceTakeaway)}</div>`, false)}

    ${section('me-leading', 'Leading — fully in your control', leading)}

    ${section('me-lagging', "Lagging — aim for, can't force", `
      <div class="metric-row lag head">
        <div class="metric-name"></div><div class="lag-track">now</div>
        <div class="lag-track">6mo</div><div class="lag-track">12mo</div><div>actual</div>
      </div>
      ${lagging}`)}

    <p class="note">If the leading targets are consistently hit and the lagging numbers
    still don't move, that's information — the mechanism needs another look, not more effort.</p>`;
  }

  /* =========================================================================
     SECTION 8 — DATA
     ========================================================================= */
  function syncCard() {
    const st = window.Sync ? window.Sync.status() : 'offline';
    const label = { idle: 'Connecting…', syncing: 'Syncing…', synced: 'Synced',
      error: 'Offline — will retry', offline: 'Sync unavailable' }[st] || '';
    return section('d-sync', `Cloud sync <span class="dot ${st} sec-tag"></span>`, `
      <div class="data-row">
        <div><b>${esc(label)}</b>
          <p class="muted">Syncs automatically across every device that opens this page — no login needed.</p></div>
        <button data-action="sync-now">Sync now</button>
      </div>`);
  }

  function viewData() {
    return `
    <div class="section-head"><div>
      <h2>Data</h2>
      <p class="sub">Your data syncs to the cloud automatically. Back up or restore as JSON here.</p>
    </div></div>
    ${syncCard()}
    ${section('d-backup', 'Backup & reset', `
      <div class="data-row">
        <div><b>Export</b><p class="muted">Download a full JSON backup.</p></div>
        <button data-action="export">Export JSON</button>
      </div>
      <div class="data-row">
        <div><b>Import</b><p class="muted">Restore from a backup file (replaces current data).</p></div>
        <label class="btn-file">Import JSON<input type="file" id="import-file" accept="application/json" hidden></label>
      </div>
      <div class="data-row">
        <div><b>Reset</b><p class="muted">Wipe everything and reload the starter data from the guide.</p></div>
        <button class="danger" data-action="reset">Reset all data</button>
      </div>`)}
    <p class="note">Data syncs to the cloud (Supabase) and is cached in this browser
    (key <code>em-music-tracker98</code>). Export/import makes a manual backup.</p>`;
  }

  /* =========================================================================
     ROUTER
     ========================================================================= */
  // Grouped Do / Plan / Data. `groupEnd` marks the last tab of a group.
  const ROUTES = {
    today:   { label: 'This Week',    view: viewToday },
    monthly: { label: 'Monthly',      view: viewMonthly, groupEnd: true },
    content: { label: 'Content',      view: viewContent },
    sprint:  { label: 'Sprint',       view: viewSprint },
    collab:  { label: 'Collab',       view: viewCollab },
    roadmap: { label: '90-Day',       view: viewRoadmap, groupEnd: true },
    metrics: { label: 'Metrics',      view: viewMetrics },
    data:    { label: 'Data',         view: viewData },
  };

  function currentRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    return ROUTES[h] ? h : 'today';
  }

  const viewEl = () => document.getElementById('view');

  function render() {
    const r = currentRoute();
    viewEl().innerHTML = ROUTES[r].view();
    viewEl().scrollTop = 0;
    // active nav state
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.route === r));
  }

  function buildNav() {
    const nav = document.getElementById('tabs');
    const keys = Object.keys(ROUTES);
    nav.innerHTML = keys.map((k, i) =>
      `<a class="tab" data-route="${k}" href="#/${k}">${ROUTES[k].label}</a>` +
      (ROUTES[k].groupEnd && i < keys.length - 1 ? '<span class="tab-divider"></span>' : '')
    ).join('');
  }

  /* =========================================================================
     MUTATION — turn a control's data-* attributes into a state change.
     ========================================================================= */
  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }

  function mutate(el) {
    const k = el.dataset.k;
    if (!k) return false;
    const f = el.dataset.f;
    const id = el.dataset.id;
    const v = readValue(el);

    switch (k) {
      case 'week': ensureWeek(weekCursor).tasks[f] = v; break;
      case 'month': ensureMonth(monthCursor)[f] = v; break;
      case 'monthAt': ensureMonth(el.dataset.mk)[f] = v; break;
      case 'meta': S.state.meta[f] = v; break;
      case 'sprint': {
        const sp = S.state.sprints.find((x) => x.id === id);
        if (!sp) return false;
        if (f === 'trackName') { sp.trackName = v; break; }
        if (!sp.items) sp.items = makeSprintItems(sp.releaseDate);
        const item = sp.items.find((x) => x.key === el.dataset.item);
        if (!item) return false;
        if (f === 'done') item.done = v;
        else if (f === 'date') item.date = v;
        break;
      }
      case 'collab': {
        const row = S.state.collab.find((x) => x.id === id);
        if (!row) return false;
        if (f.startsWith('step:')) { collabSteps(row)[f.slice(5)] = v; }
        else { row[f] = v; }
        break;
      }
      case 'roadmap': {
        const [type, idx] = f.split(':');
        const bucket = { check: 'checks', num: 'numbers', refl: 'reflections' }[type];
        S.state.roadmap[id][bucket][+idx] = v;
        break;
      }
      case 'metric': S.state.metrics[id][f] = v; break;
      case 'mlog': ensureMonthLog(monthCursor)[f] = v; break;
      default: return false;
    }
    S.persist();
    return true;
  }

  /* =========================================================================
     ACTIONS (clicks)
     ========================================================================= */
  function handleAction(action, el) {
    switch (action) {
      case 'week-prev': weekCursor = addDays(weekCursor, -7); return render();
      case 'week-next': weekCursor = addDays(weekCursor, 7); return render();
      case 'week-today': weekCursor = toISO(mondayOf(new Date())); return render();
      case 'count': {
        const wk = ensureWeek(weekCursor);
        const key = el.dataset.key;
        const item = SEED.weekTemplate.flatMap((g) => g.items).find((i) => i.key === key);
        const max = (item && item.max) || 5;
        wk.counts[key] = Math.max(0, Math.min(max, (wk.counts[key] || 0) + Number(el.dataset.d)));
        S.persist(); return render();
      }
      case 'idea': {
        const c = SEED.content;
        const s = Number(el.dataset.s);
        contentIdea = {
          s: s >= 0 ? s : Math.floor(Math.random() * c.series.length),
          f: Math.floor(Math.random() * c.formats.length),
        };
        return render();
      }

      case 'wheel-spin': {
        const list = SEED.wheel;
        const n = list.length, slice = 360 / n;
        const k = Math.floor(Math.random() * n);
        // absolute rotation that lands slice k's centre under the top pointer
        const target = (360 - (k * slice + slice / 2)) % 360;
        const delta = ((target - (wheelRotation % 360)) + 360) % 360;
        const turns = 6 + Math.floor(Math.random() * 3);   // 6–8 full turns
        wheelRotation += 360 * turns + delta;
        const wheelEl = document.getElementById('wheel');
        const resultEl = document.getElementById('wheel-result');
        if (wheelEl) {
          wheelEl.style.transform = `rotate(${wheelRotation}deg)`;
          wheelEl.querySelectorAll('path.win').forEach((p) => p.classList.remove('win'));
        }
        if (resultEl) { resultEl.classList.remove('show'); resultEl.textContent = ''; }
        setTimeout(() => {
          if (resultEl) { resultEl.textContent = list[k]; resultEl.classList.add('show'); }
          const w = wheelEl && wheelEl.querySelector(`path[data-i="${k}"]`);
          if (w) w.classList.add('win');
        }, 4100); // match the CSS transition duration
        return; // no re-render — that would reset the spin animation
      }

      case 'trend':
        if (el.dataset.m !== trendMetric) { trendMetric = el.dataset.m; render(); }
        return;

      case 'jump': {
        const key = el.dataset.sec;
        collapse[key] = true; saveCollapse(); render();
        const target = document.querySelector(`[data-sec="${key}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      case 'month-prev': monthCursor = shiftMonth(monthCursor, -1); return render();
      case 'month-next': monthCursor = shiftMonth(monthCursor, 1); return render();
      case 'month-today': monthCursor = monthKey(new Date()); return render();

      case 'sprint-add': {
        const input = document.getElementById('new-sprint-date');
        if (!input.value) { input.focus(); return; }
        const nameEl = document.getElementById('new-sprint-name');
        S.state.sprints.push({
          id: S.uid(),
          trackName: (nameEl && nameEl.value.trim()) || 'New release',
          releaseDate: input.value,
          items: makeSprintItems(input.value),
        });
        S.state.sprints.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
        S.persist(); return render();
      }
      case 'sprint-del':
        S.state.sprints = S.state.sprints.filter((s) => s.id !== el.dataset.id);
        S.persist(); return render();

      case 'collab-add':
        S.state.collab.push({
          id: S.uid(), artist: '', listeners: '', igFollowers: '', genre: '',
          warmth: 'Cold', followedSince: '', status: 'Active',
          spike: false, gatekeeper: false, steps: {},
          remixTrack: '', outcome: '',
        });
        S.persist(); return render();
      case 'collab-del': {
        const row = S.state.collab.find((r) => r.id === el.dataset.id);
        const name = row && row.artist ? `"${row.artist}"` : 'this artist';
        if (!confirm(`Delete ${name} from the collab ladder? This can't be undone.`)) return;
        S.state.collab = S.state.collab.filter((r) => r.id !== el.dataset.id);
        S.persist(); return render();
      }

      case 'post-add': {
        const type = document.getElementById('post-type').value;
        const descEl = document.getElementById('post-desc');
        const desc = descEl.value.trim();
        if (!desc) { descEl.focus(); return; }
        S.state.posts.push({ id: S.uid(), date: todayISO(), type, desc });
        S.persist(); return render();
      }
      case 'post-del':
        S.state.posts = S.state.posts.filter((p) => p.id !== el.dataset.id);
        S.persist(); return render();

      case 'sync-now':
        if (window.Sync) window.Sync.pull().then(() => window.Sync.pushNow()).then(render);
        return;

      case 'export': return S.exportJSON();
      case 'reset':
        if (confirm('Wipe all data and reload the starter data from the guide? This cannot be undone.')) {
          S.reset(); return render();
        }
        return;
    }
  }

  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d);
  }

  // Reflect sync state in the header badge (and refresh the Data panel if open).
  function onSyncStatus(status) {
    const el = document.getElementById('sync-badge');
    if (el) {
      const map = { idle: 'Connecting…', syncing: 'Syncing…', synced: 'Synced', error: 'Offline', offline: '' };
      el.textContent = map[status] || '';
      el.className = 'sync-badge ' + status;
    }
    if (currentRoute() === 'data') render();
  }

  /* =========================================================================
     END-OF-MONTH POPUP — greets you around the 30th to log the month.
     Shows once per month (deduped via state.ui.lastPrompt).
     ========================================================================= */
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

  function showMonthPrompt(mk) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-kicker">End of month</div>
          <h3>Time to log ${monthLabel(mk)}</h3>
          <p>Two minutes: drop in your Spotify numbers, and jot what went well on
             socials and what didn't. It feeds your monthly review and the 90-day roadmap.</p>
          <div class="modal-actions">
            <button data-action="prompt-log">Log the month</button>
            <button class="ghost" data-action="prompt-later">Later</button>
          </div>
        </div>
      </div>`;
    const done = () => { S.state.ui.lastPrompt = mk; S.persist(); };
    root.querySelector('[data-action="prompt-log"]').onclick = () => {
      done(); closeModal(); monthCursor = mk;
      collapse['m-log'] = true; saveCollapse();   // make sure the log is expanded
      location.hash = '#/monthly'; render();
      const el = document.querySelector('[data-sec="m-log"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    root.querySelector('[data-action="prompt-later"]').onclick = () => { done(); closeModal(); };
  }

  // Fire on/after the 30th (and the last day of short months), once per month.
  function maybeMonthPrompt() {
    const now = new Date();
    const dom = now.getDate();
    const lastDom = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isPromptDay = dom >= 30 || dom === lastDom;
    const mk = monthKey(now);
    if (isPromptDay && S.state.ui.lastPrompt !== mk) showMonthPrompt(mk);
  }

  /* =========================================================================
     WIRING
     ========================================================================= */
  function init() {
    buildNav();
    render();
    window.addEventListener('hashchange', render);

    const view = viewEl();
    // Typing: save silently, no re-render (keeps the caret put).
    view.addEventListener('input', (e) => {
      const el = e.target;
      if (el.matches('input[type="text"], input[type="number"], textarea')) mutate(el);
    });
    // Commit: save + re-render so bars / derived values update.
    view.addEventListener('change', (e) => {
      if (e.target.dataset && e.target.dataset.k) { mutate(e.target); render(); }
    });
    // Commands.
    view.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el) { e.preventDefault(); handleAction(el.dataset.action, el); }
    });
    // Remember which sections are collapsed (toggle doesn't bubble → capture).
    view.addEventListener('toggle', (e) => {
      const d = e.target;
      if (d.tagName === 'DETAILS' && d.dataset.sec) { collapse[d.dataset.sec] = d.open; saveCollapse(); }
    }, true);
    // Import (change on the hidden file input — handled here, not via mutate).
    view.addEventListener('change', (e) => {
      if (e.target.id !== 'import-file') return;
      const file = e.target.files[0];
      if (!file) return;
      S.importJSON(file, (err) => {
        if (err) { alert('Could not read that file — is it a valid backup?'); return; }
        alert('Data imported.'); render();
      });
    });

    maybeMonthPrompt();

    // Start cloud sync (pulls the latest if already signed in on this device).
    if (window.Sync) window.Sync.init(S, render, onSyncStatus);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
