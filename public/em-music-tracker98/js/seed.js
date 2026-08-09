/* ============================================================================
   seed.js — starter data pulled straight from the Artist Guide + Tracker.
   Everything here is the DEFAULT state used the first time the app is opened
   (or after a reset). Once the user edits anything it lives in localStorage
   and this file is no longer touched.

   Kept as plain data (window.EM_SEED) so it is trivial to migrate to a
   backend later: this same shape maps 1:1 onto Supabase/Firebase tables.
   ========================================================================== */
window.EM_SEED = {

  /* The permanent-week checklist definition. Groups render in this order.
     `key` is the stable id stored per-week; `type` drives the control.
     Reach rows are flagged `protect` — the guide's rule is: if a week
     collapses, these are the ones you keep. */
  weekTemplate: [
    // The four series are 9:16 videos = Reels. The Content data says Reels are
    // best Thu–Sun, so they live on Thu/Fri/Sat/Sun. `timeType` pulls the type
    // badge + best time/days from one source (the Content posting-times).
    { group: 'REELS', timeType: 'Reels', items: [
      { key: 'r_thu', day: 'Thu', label: 'Working On',        type: 'check', timeType: 'Reels' },
      { key: 'r_fri', day: 'Fri', label: 'Making',            type: 'check', timeType: 'Reels' },
      { key: 'r_sat', day: 'Sat', label: "What's In My USB",  type: 'check', timeType: 'Reels' },
      { key: 'r_sun', day: 'Sun', label: 'Playing',           type: 'check', timeType: 'Reels' },
    ]},
    { group: 'STORIES', timeType: 'Stories', desc: '3–5 across the week, rough is fine', items: [
      { key: 'stories', label: '3–5 stories across the week', type: 'count', goal: 3, max: 5, timeType: 'Stories' },
    ]},
    { group: 'MAKE', items: [
      { key: 'capture',      label: 'One studio capture (2 min → CAPTURES)', type: 'check' },
      { key: 'friday_asset', label: "Friday reel asset ready",              type: 'check' },
    ]},
    // Engagement is flagged so the view can append this week's collab targets.
    { group: 'ENGAGEMENT', engage: true,
      desc: 'Like + comment on your warm-up targets — 15 min, ~10 likes, 5 real comments each.', items: [
      { key: 'engage', label: 'Engagement sessions (aim 3)', type: 'count', goal: 3, max: 5 },
    ]},
  ],

  /* Weekly day-by-day focus — one recurring reach/content habit per day, shown
     as a calendar grid on This Week (no ticking, just a reminder). */
  dailyHabits: [
    { day: 'Mon', task: 'Look for new artists to collab with' },
    { day: 'Tue', task: 'Find a song to edit or remix' },
    { day: 'Wed', task: 'Reach out with engagement' },
    { day: 'Thu', task: 'Work on an edit or a track' },
    { day: 'Fri', task: 'Capture a studio moment → CAPTURES' },
    { day: 'Sat', task: 'Warm up a collab target' },
    { day: 'Sun', task: 'Repost / share from a mutual' },
  ],

  /* Monthly — the "once a month, on top" block from the guide. */
  monthlyTemplate: [
    { key: 'captures_review', label: 'Pull anything usable from CAPTURES' },
    { key: 'edit_released',   label: 'One edit or playlist released' },
    { key: 'collab_approach', label: 'One Collab Ladder approach' },
    { key: 'newsletter',      label: 'Send the monthly newsletter' },
    { key: 'congrats',        label: 'Congratulate anyone with a release or show this month' },
  ],

  /* Release sprint — the full 19-item workflow. Offsets are DAYS from the
     release Friday (negative = before). `kind` is 'admin' (a deadline) or
     'post' (content). `blockedBy` references another item's key. */
  sprintTemplate: [
    // Pre-release
    { key: 'submit_distro', label: 'Submit to distro',        offset: -42, kind: 'admin' },
    { key: 'dsp_pitch',     label: 'DSP submissions / pitch', offset: -38, kind: 'admin' },
    { key: 'press_release', label: 'Write press release',     offset: -35, kind: 'admin', blockedBy: 'submit_distro' },
    { key: 'blogs_pr',      label: 'Blogs press release sent', offset: -28, kind: 'admin' },
    { key: 'canvas',        label: 'Canvas upload',           offset: -14, kind: 'admin' },
    { key: 'presave',       label: 'Presave link to GC',      offset:  -7, kind: 'admin' },
    { key: 'artwork',       label: 'Artwork post',            offset:  -5, kind: 'post' },
    { key: 'selfie',        label: 'Selfie announce post',    offset:  -4, kind: 'post' },
    { key: 'radio_pr',      label: 'Radio press release sent', offset: -3, kind: 'admin' },
    { key: 'upcoming',      label: 'Upcoming tune post',      offset:  -3, kind: 'post' },
    // Post-release
    { key: 'out_now',       label: 'Out Now post',            offset:   0, kind: 'post' },
    { key: 'audio_yt',      label: 'Audio video for YT',      offset:   1, kind: 'post' },
    { key: 'reel1',         label: 'TikTok / Reel 1',         offset:   3, kind: 'post' },
    { key: 'reel2',         label: 'TikTok / Reel 2',         offset:   6, kind: 'post' },
    { key: 'lyric',         label: 'Lyric video / visualiser', offset:  8, kind: 'post' },
    { key: 'reel3',         label: 'TikTok / Reel 3',         offset:  11, kind: 'post' },
    { key: 'reel4',         label: 'TikTok / Reel 4',         offset:  14, kind: 'post' },
    { key: 'reel5',         label: 'TikTok / Reel 5',         offset:  18, kind: 'post' },
    { key: 'reel6',         label: 'TikTok / Reel 6',         offset:  21, kind: 'post' },
  ],

  /* CONTENT CADENCE — the MAJOR post lands on TUESDAY, so the week's feed posts
     spread out: major Tue, Playing Thu, Working On Sun. (Note: this is off Evan's
     best post days — his IG data says posts do best Thu & Sun — a deliberate call
     to spread across the week instead.) Stories run daily; engagement rides the
     follower-active peaks (Mon/Fri/Sun). A Tuesday post can't be prepped earlier
     the same week, so each hero's `prep` is placed in the LIGHTER week BEFORE the
     drop (see fillWeekChips look-ahead) — the flex week doubles as the prep window.
     `media` sets the calendar colour; `short` is the tile shorthand; `hint` is the
     Today explainer. */
  heroRotation: [
    { key: 'hero_usb', day: 'Tue', label: "What's In My USB", short: 'USB', media: 'post',
      hint: 'Show the 3-5 tracks you are actually rating right now',
      prep: [
        { day: 'Fri', key: 'p_usb_find', label: 'Find USB tunes', short: 'Find tunes',
          hint: 'Pick 3-5 tracks worth shouting about (for next week)' },
        { day: 'Sat', key: 'p_usb_gfx', label: 'Make USB graphic', short: 'USB graphic',
          hint: 'Drop the tracklist into your template' },
      ] },
    { key: 'hero_tune', day: 'Tue', label: 'New Tune', short: 'New Tune', media: 'reel',
      hint: 'Tease or drop a new track — snippet reel with a fast hook',
      prep: [
        { day: 'Fri', key: 'p_tune_film', label: 'Film the tune clip', short: 'Film clip',
          hint: 'Grab 2-3 desk clips of the track playing (for next week)' },
        { day: 'Sat', key: 'p_tune_edit', label: 'Edit the tune reel', short: 'Edit reel',
          hint: 'Cut to the best 15s, caption, sign-off frame' },
      ] },
    { key: 'hero_playlist', day: 'Tue', label: 'Playlist', short: 'Playlist', media: 'post',
      hint: 'Share a playlist you have curated',
      prep: [
        { day: 'Fri', key: 'p_pl_source', label: 'Source playlist tunes', short: 'Source tunes',
          hint: 'Crate-dig and lock the tracklist (for next week)' },
        { day: 'Sat', key: 'p_pl_gfx', label: 'Make playlist graphic', short: 'PL graphic',
          hint: 'Design the playlist cover' },
      ] },
    { key: 'hero_edit', day: 'Tue', label: 'Edit', short: 'Edit', media: 'reel',
      hint: 'Post an edit / flip — your strongest reel format',
      prep: [
        { day: 'Fri', key: 'p_edit_make', label: 'Make the edit', short: 'Make edit',
          hint: 'Finish the edit/flip ready to film (for next week)' },
        { day: 'Sat', key: 'p_edit_cut', label: 'Cut the edit reel', short: 'Cut reel',
          hint: 'Film the edit-lab version, cut on the beat' },
      ] },
    { key: 'hero_mix', day: 'Tue', label: 'Mix', short: 'Mix', media: 'post',
      hint: 'Drop a mix — one unreleased ID minimum',
      prep: [
        { day: 'Wed', key: 'p_mix_source', label: 'Source mix tunes', short: 'Source tunes',
          hint: 'Crate-dig and build the tracklist (mix drops next Tue)' },
        { day: 'Fri', key: 'p_mix_rec', label: 'Record the mix', short: 'Record mix',
          hint: 'Record and bounce the mix' },
        { day: 'Sat', key: 'p_mix_gfx', label: 'Make mix graphic', short: 'Mix graphic',
          hint: 'Design the mix cover art' },
      ] },
  ],

  /* Which hero runs each week — a major only EVERY OTHER week, with flexible
     'flex' weeks in between (no scheduled major: just the weekly Playing/Working
     On + daily stories; drop a spontaneous edit, New Tune, or extra post here if
     you feel like it). Over this 8-week (2-month) cycle:
       • USB runs every month.
       • The other major slot alternates Mix (one month) and Playlist (the next),
         so the Mix — your biggest lift — stays bi-monthly and never doubles up.
       • Edits aren't scheduled: slot one into a flex week whenever you want one,
         so they're present but never the headline.
     Result: 2 scheduled majors a month + 2 lighter flex weeks.
     Reorder/relabel freely; any entry that isn't a heroRotation key = a flex week.
     Available hero keys: hero_usb, hero_playlist, hero_edit, hero_mix, hero_tune. */
  heroSequence: [
    'flex', 'hero_usb', 'flex', 'hero_mix',
    'flex', 'hero_usb', 'flex', 'hero_playlist',
  ],
  // Smaller posts that run EVERY week, on the other strong days (Sat reel, Sun post).
  weeklySmall: [
    { day: 'Thu', key: 's_playing', label: 'Playing', short: 'Playing', media: 'reel',
      hint: 'A rehearsal, a mix clip, or one unreleased track in your room' },
    { day: 'Sun', key: 's_working', label: 'Working On', short: 'Working On', media: 'post',
      hint: 'Photo or clip of a track in progress — DAW, gear, or a hook' },
  ],
  // Stories — one EVERY day, a different type each day (all quick, low-effort).
  // Peak story window is 8–10 PM (IG data), but a rough story any time beats none.
  weekStories: [
    { day: 'Mon', key: 'story_mon', short: 'Big artist',   label: 'Story · big artist',
      hint: 'A track you love from a bigger artist — tag them' },
    { day: 'Tue', key: 'story_tue', short: 'Small artist', label: 'Story · small artist',
      hint: 'Spotlight a smaller artist you genuinely rate' },
    { day: 'Wed', key: 'story_wed', short: 'Snippet',      label: 'Story · snippet',
      hint: "Quick snippet of whatever's on the desk right now" },
    { day: 'Thu', key: 'story_thu', short: 'Repost',       label: 'Story · repost',
      hint: 'Repost your recent reel/post with a link sticker' },
    { day: 'Fri', key: 'story_fri', short: 'Into now',     label: 'Story · into now',
      hint: 'A track or playlist you are into right now — tag the artist' },
    { day: 'Sat', key: 'story_sat', short: 'Poll',         label: 'Story · poll',
      hint: 'Poll — two edits or mixes, “A or B?”',
      // Alternates week-to-week: Poll one Saturday, this the next (swap freely).
      alt: { short: 'Throwback', label: 'Story · throwback',
        hint: 'Resurface an older track, set, or release you are still proud of' } },
  ],
  // Engagement — ride the follower-active peaks (IG data: Mon, Fri, Sun).
  weekEngage: [
    { day: 'Mon', key: 'eng_mon', hint: 'Reply and like on your warm-up targets (15 min)' },
    { day: 'Fri', key: 'eng_fri', hint: 'Comment on 5 accounts a step above you' },
    { day: 'Sun', key: 'eng_sun', hint: 'React to anyone who engaged this week' },
  ],
  // Collab sourcing — find NEW artists to warm up (engagement warms up ones you
  // already have; this feeds the top of the Collab Ladder). One quiet browse/week.
  weekCollab: [
    { day: 'Tue', key: 'collab_find', short: 'Find collab', label: 'Find a collab target',
      hint: 'Find 1–2 new artists to warm up → add them to the Collab Ladder' },
  ],

  /* 90-Day Roadmap — three monthly dashboards, seeded from Part Five.
     Outreach/ledger lines have been dropped; the collab + content + live
     items remain. */
  roadmap: {
    m1: {
      title: 'Month 1 — Revive & Fix the Leak',
      blurb: 'Build the templates, plug the feed→Spotify leak (only 2 bio-link taps last quarter), start the collab shortlist, and play the first show.',
      checks: [
        'Four content templates built',
        'Fix the feed→Spotify path — one clear CTA, link one tap away',
        'One edit or playlist released',
        'Capture habit run at least twice',
        'First show played and documented',
        'Collab Ladder Tier 2 shortlist started — 3–4 names',
      ],
      numbers: [
        { label: 'Monthly active listeners', target: 'hold / grow from 2,911' },
        { label: 'Bio-link taps', target: 'up from 2 in 90d' },
      ],
      reflections: [
        'Did the capture habit happen without friction, or did it get skipped?',
        'Is anything actually sending people from the feed to Spotify yet?',
      ],
    },
    m2: {
      title: 'Month 2 — Second Show & First Collab Approaches',
      blurb: 'Deliver the second show, hold the series cadence, make the first collab approaches, and lift the signals that fell hardest.',
      checks: [
        'Second show played and documented',
        'Second edit or playlist released',
        'Push saves + playlist adds — the algorithmic signal that dropped most (−56% / −33%)',
        'At least one Collab Ladder approach made',
      ],
      numbers: [
        { label: 'Saves this month', target: 'trending up (was −56%)' },
        { label: 'Collab approaches made', target: '1+' },
      ],
      reflections: [
        "Did the gallery show open doors a normal club gig wouldn't have?",
        'Which collab approach looks most promising right now?',
      ],
    },
    m3: {
      title: 'Month 3 — Assess & Systematise',
      blurb: 'Look at three months of real data, double down on whatever actually produced something, decide what to formalise.',
      checks: [
        'Reviewed all collab activity from Months 1–2',
        'Reviewed the monthly logs — what moved, what didn’t',
        'Identified the single best-performing channel',
        'Third edit or playlist released',
      ],
      numbers: [
        { label: 'Monthly active listeners vs quarter start', target: 'vs 2,911' },
        { label: 'Total reach content released this quarter', target: '' },
      ],
      reflections: [
        'Of everything tried, what earned attention from someone who didn’t already know you?',
        "What's worth increasing, and what's worth quietly dropping?",
      ],
    },
  },

  /* Metrics — leading (you control) vs lagging (aim, can't force).
     `auto` metrics are computed from live app data; the rest are typed in. */
  metrics: {
    leading: [
      { key: 'reach_released',   label: 'Reach content released', target: '1 edit or playlist / month', auto: false },
      { key: 'saves',            label: 'Saves',                  target: 'recover — fell 56%', auto: false },
      { key: 'playlist_adds',    label: 'Playlist adds',          target: 'recover — fell 33%', auto: false },
      { key: 'collab_shortlist', label: 'Collab shortlist size',  target: '3–4 names per tier', auto: 'collabCount' },
    ],
    lagging: [
      { key: 'monthly_listeners', label: 'Monthly listeners', now: '5,000', m6: '8–10k', m12: '12–18k', auto: 'listeners' },
      { key: 'collabs_landed',    label: 'Collabs landed',    now: '0', m6: '1', m12: '2–3', auto: 'collabsLanded' },
      { key: 'shows_confirmed',   label: 'Shows confirmed',   now: '2 confirmed', m6: '+2–3', m12: '+5', auto: false },
    ],
  },

  /* Content — reference + ideas for the Content section.
     Posting times come from Evan's own Instagram data; everything else is
     lifted from Part Three of the guide (Content Language, Four Series,
     Format Library, Being In Your Own Content). */
  content: {
    postingTimes: [
      { type: 'Posts',   time: '6–8 PM',  days: 'Thu & Sun', tip: 'Bold CTA, short caption' },
      { type: 'Stories', time: '8–10 PM', days: 'Tue–Thu',   tip: 'Polls, Q&A, follow up with a swipe-up' },
      { type: 'Reels',   time: '6–8 PM',  days: 'Thu–Sun',   tip: 'Hook fast, keep it under 15 sec' },
    ],
    series: [
      { day: 'Mon', name: 'Working On',        what: '30 sec of unreleased music, no talking. Cut between hands, Ableton, synth, speaker cone.', caption: '“still working on this”' },
      { day: 'Thu', name: 'Making',            what: 'Anything being built — an edit, a visual, a melody, a field recording. One idea per post.', caption: 'Edit-lab version works well — “turning this…”, original plays, cut, your version' },
      { day: 'Fri', name: "What's In My USB",  what: "5 tracks you're actually playing, 10 sec each. The strongest format on the list — people want discovery.", caption: 'One per track, 5 words max — “opening track”, “peak time”, “closer”' },
      { day: 'Sun', name: 'Playing',           what: 'A rehearsal, a mix clip, a rooftop, or one unreleased track in your room. One light, one take.', caption: "Timeless — these don't expire the way promo does" },
    ],
    formats: [
      { name: 'CRT re-film',        what: 'Play a clip on an actual CRT and film the screen', effort: 'Low',      note: 'highest payoff' },
      { name: 'Session capture',    what: 'Ableton screen recording run through the VHS treatment', effort: 'Low' },
      { name: 'Foley close-up',     what: 'Film the object making the sound in the track — the source, not the waveform', effort: 'Low' },
      { name: 'Terminal / text',    what: 'A caption or thought rendered as terminal output or ASCII', effort: 'Very low' },
      { name: 'Waterford landscape',what: 'Coast, Comeraghs, Tramore — muted grade, degraded', effort: 'Low' },
      { name: 'Live footage, graded', what: 'Storehouse / Gallery clips, treated to match', effort: 'Low', note: 'once shot' },
      { name: 'TouchDesigner loop', what: "Generative visual driven by the track's audio", effort: 'Medium' },
      { name: 'Found footage cut',  what: 'Archival or public-domain footage edited to a track', effort: 'Medium' },
    ],
    storyIdeas: [
      { idea: "Repost a mutual's release or story (credit them)", tag: 'repost' },
      { idea: "Rough snippet of whatever's on the desk right now", tag: 'bts' },
      { idea: "A track you're feeling — 10 sec, tag the artist",   tag: 'share' },
      { idea: 'Poll: two edits or mixes, “A or B?”',               tag: 'poll' },
      { idea: "Q&A / ask-me sticker — gear, sets, what's coming",  tag: 'q&a' },
      { idea: 'Reshare your latest post with a link sticker',      tag: 'link' },
      { idea: 'A moment from a rehearsal or live set',             tag: 'bts' },
      { idea: 'Countdown sticker before a release',                tag: 'release' },
    ],
    language: [
      { el: 'Typeface',    rule: 'IBM Plex Mono, everywhere — same as the site' },
      { el: 'Aspect',      rule: '9:16, always. No square crops' },
      { el: 'Grade',       rule: 'Muted naturals, lifted blacks, grain, scan lines, slight chromatic aberration' },
      { el: 'First frame', rule: 'The best second of the music, playing. Never a title card, never silence' },
      { el: 'Captions',    rule: 'Fixed position and size, 5 words max, lowercase' },
      { el: 'Pacing',      rule: 'Cut on the beat. Always' },
      { el: 'Framing',     rule: 'Close — fill the frame. Hands, gear, screen, texture' },
      { el: 'Ending',      rule: 'The same sign-off frame every time — one word or a mark, on black' },
    ],
    presence: {
      do: [
        'Hands, not face, as the default — on gear, the desk, the CRT',
        'Back or silhouette at the decks — atmosphere, not portrait',
        'Let degradation do the work — scan lines, low light, VHS artifacts',
        "Face is fine when it's incidental — caught mid-work, not addressing camera",
        'Roughly 4 world posts to 1 you appear in',
      ],
      dont: [
        "No talking heads, unless there's a real reason (there usually isn't)",
        'No pointing at floating text, no lip-syncing, no reaction faces',
        'No trend audio',
        "Don't explain the music in a caption",
      ],
    },
  },

  /* Insights — pulled from Evan's real Spotify-for-Artists + Instagram data
     (screenshots dated 28 Jul 2026). The stat blocks are a point-in-time
     baseline; the audience read informs what to post and who to collab with. */
  insights: {
    date: '28 Jul 2026',
    // What the raw IG "follower active times" actually says (refines the table above).
    activeWindows: 'Instagram says your followers are most active Sun 6–9pm, Mon 12–3pm and Fri 12–3pm — evenings (6–9pm) run strong every day.',
    audience: {
      age: '25–34 is the core — 52% on Spotify, 79% on Instagram. Barely anyone under 24.',
      gender: 'Roughly 55% male across both.',
      igPlaces: 'Instagram is local — 71% Ireland (Waterford 25%, Dublin 17%, Tramore 7%, then London 4%).',
      spotifyPlaces: 'Spotify is international — US, UK, Germany, Australia lead. Ireland is small in volume but your most engaged (93% active).',
      crux: "The people who see your content (local, Irish) aren't the people who stream you (international). Content's job is to make the profile convert; collabs with international artists are what actually reach new listeners.",
    },
    // The single biggest content leak in the data.
    contentTakeaway: '45k Instagram views in 90 days but only 2 bio-link taps — the jump from feed to Spotify is where you lose people. Lead posts with one clear CTA and keep the link one tap away.',
    spotify: [
      { label: 'Listeners (12mo)', value: '47,621', delta: '-34%', dir: 'down' },
      { label: 'Monthly active',   value: '2,911',  delta: '-29%', dir: 'down' },
      { label: 'Streams (12mo)',   value: '121,765', delta: '-36%', dir: 'down' },
      { label: 'Followers',        value: '1,611',  delta: '+12%', dir: 'up' },
      { label: 'Saves',            value: '1,356',  delta: '-56%', dir: 'down' },
      { label: 'Playlist adds',    value: '7,083',  delta: '-33%', dir: 'down' },
    ],
    topTrack: 'Hour Glass — 51,806 streams (12mo), ~43% of your top-catalogue. Everything else is a long tail.',
    instagram: [
      { label: 'Views (90d)',      value: '45,170', sub: '55% non-followers' },
      { label: 'Net followers',    value: '+12',    dir: 'up' },
      { label: 'Profile visits',   value: '641' },
      { label: 'Bio-link taps',    value: '2',      flag: true },
    ],
    streamSources: [
      { label: 'Personalised playlists, autoplay & mixes', pct: 50 },
      { label: "Listeners' own library",                   pct: 37 },
      { label: "Other listeners' playlists",               pct: 7 },
      { label: 'Artist profile & catalog',                 pct: 2 },
      { label: 'Editorial playlists',                      pct: 1 },
    ],
    sourceTakeaway: 'Half your streams are algorithmic (personalised playlists + Radio), a third are people replaying you. Editorial is 1% — pitching curators is not the lever. Feeding the algorithm (saves, playlist adds, consistent releases) and collabs are.',
  },

  /* Collab Ladder config. `collabSteps` is the ordered warm-up ladder — the
     guide's remix-first approach turned into a per-artist checklist. The app
     reads this to draw the checklist AND to work out the suggested next move. */
  lists: {
    warmth:       ['Warm', 'Lukewarm', 'Cold'],
    collabStatus: ['Active', 'Landed', 'Passed', 'Parked'],
  },
  // Post log — the types you can log when you post something.
  postTypes: ['Post', 'Story', 'Reel', 'Edit', 'Other'],

  // Monthly log — what the end-of-month review asks you to record. The Spotify
  // rows show last-baseline (28 Jul 2026) so you can see movement at a glance.
  monthlyLogDef: {
    spotify: [
      { key: 'listeners',    label: 'Monthly listeners', base: '2,911', baseNum: 2911 },
      { key: 'streams',      label: 'Streams (28d)',     base: null,    baseNum: null },
      { key: 'followers',    label: 'Followers',         base: '1,611', baseNum: 1611 },
      { key: 'saves',        label: 'Saves',             base: '1,356', baseNum: 1356 },
      { key: 'playlistAdds', label: 'Playlist adds',     base: '7,083', baseNum: 7083 },
    ],
    text: [
      { key: 'wentWell',    label: 'What went well on socials this month' },
      { key: 'didntWork',   label: "What didn't work" },
      { key: 'spotifyRead', label: 'How your Spotify data is looking' },
      { key: 'notes',       label: 'Anything else worth noting' },
    ],
  },

  collabSteps: [
    { key: 'followed',    label: 'Followed them' },
    { key: 'engaging',    label: 'Liking + commenting on their posts' },
    { key: 'trackPicked', label: 'Picked a track of theirs to remix' },
    { key: 'remixMade',   label: 'Made the remix — finished, not a demo' },
    { key: 'remixSent',   label: 'Sent it once, no ask attached' },
    { key: 'reacted',     label: 'They reacted (repost / reply / story)' },
    { key: 'proposed',    label: 'Proposed the collab' },
  ],

  // Where to find collab targets — shown as reference on the Collab tab.
  collabSourcing: {
    sources: [
      { t: '"Fans also like" on your Spotify page', d: 'Algorithmically matched to your listeners — the highest sound-fit source there is, and free.' },
      { t: "Artists you've been playlisted alongside", d: 'A curator already decided you belong next to them. Shared curator is also a warm intro path.' },
      { t: "People who've already engaged with you", d: 'Likes, comments, story replies, SoundCloud reposts on your edits, your follower list. Warmth is worth 2 points on its own.' },
      { t: "Line-ups you've shared", d: 'Same rooms via Hidden Agenda, POD, the Button Factory promoter. A shared promoter is a real introduction route.' },
      { t: 'Rosters of labels that fit your sound', d: 'Pre-filtered for level and aesthetic in one go.' },
      { t: 'Brand / third-party playlists (the H&M approach)', d: 'Fine as volume, weakest on fit.' },
    ],
    ratio: 'The check that matters: monthly listeners vs Instagram followers. 40k listeners / 700 followers = an algorithmic audience, not a fanbase — a collab gets you playlist adjacency and almost no actual people. 12k listeners / 6k engaged followers is worth far more. That ratio is the single best signal of whether a collab moves anything.',
    filters: [
      "Is their top track very recent and dwarfing the rest? That's a spike, not a baseline.",
      'Does their bio show a personal email or management address? A gatekeeper makes it a much longer road.',
    ],
  },

  // Spinning wheel — genre roulette (Content tab).
  wheel: [
    'Pop', 'R&B', 'Hip-Hop', 'Rap', 'UK Rap', 'Drill', 'Afrobeats', 'Amapiano',
    'Reggaeton', 'Latin Pop', 'Indie', 'Indie Pop', 'Alternative', 'Folk',
    'Singer-Songwriter', 'Soul', 'Funk', 'Disco', 'Dance', 'House', 'Tech House',
    'Deep House', 'Melodic House', 'Progressive House', 'Techno', 'Melodic Techno',
    'EDM', 'Drum & Bass', 'UK Garage', 'Garage', 'Dubstep', 'Trance',
    'Irish Traditional', 'Blues', 'Lo-fi', 'One Hit Wonders', '80s Pop', '90s Pop',
    '2000s Pop', '90s R&B', '2000s Hip-Hop',
  ],

  /* GROWTH — the promotion plan ranked by cadence (from the 100-idea triage).
     Reference/strategy only: the recurring DO parts live on the calendar and in
     the monthly block; this section is the layer above them — the funnel to fix
     first, what fires on an opportunity vs the calendar, deadlines to watch, and
     what's deliberately parked. Numbers in (#) map to the ideas spreadsheet. */
  growth: {
    // The through-line. Everything you post leaks out through a broken funnel, so
    // this gets fixed before adding more activity on top.
    funnel: {
      lead: '45k IG views last quarter turned into 2 bio-link taps. Reach is not the problem — the jump from feed to Spotify is. Get this working before pouring more content in.',
      steps: [
        { t: 'Release landing pages (#51)', d: 'One clean page per release, every link one tap away. Build the template once (see Build once), reuse it forever.' },
        { t: 'Free download for email (#45)', d: 'Gate an edit, stems, or an unreleased track behind an email signup. Tie it to any month with a release or an edit worth gating.' },
        { t: 'Monthly newsletter (#46)', d: 'New music, what you are playing, shows, one behind-the-scenes note. Now a monthly-block task on the calendar.' },
        { t: 'Early access + private demo club (#47, #48)', d: 'Let the list hear tracks first. This is the reason people stay subscribed.' },
        { t: '100 true fans habit (#100)', d: 'Notice recurring names, reply, remember them, give early access. Treat them as people, not analytics.' },
      ],
    },
    // What runs on a clock. The weekly layer is already the calendar; noted here
    // so the whole rhythm is visible in one place.
    cadence: [
      { when: 'Weekly', live: true, items: 'Studio clips and snippets, genuine comments on releases (#12) and story replies (#13), 3x engagement blocks. All already on This Week.' },
      { when: 'Monthly', items: 'Edit or bootleg (#1), monthly playlist (#3), newsletter (#46), congratulate people (#14), and gate a free download whenever there is a release worth it.' },
      { when: 'Bi-monthly (6-8 weeks)', items: 'DJ mix (your stated cadence), SoundCloud edits/mixes upkeep (#40-43) so SC does not get neglected, and batch a few guest-mix pitches (#21).' },
      { when: 'Quarterly', items: 'Producer-community participation (Vealer’s, #90) and a Collab Ladder shortlist review (already in the 90-Day roadmap).' },
    ],
    // Fires on a real event, not a date. This is the home for outreach that would
    // feel like spam if forced to a quota — it is only ever a response.
    triggers: [
      { when: 'A Collab Ladder name responds', act: 'Make the collab / remix approach — lateral or upward (#16-19).' },
      { when: 'You have a release', act: 'Radio outreach (#34, #35), selective press and local media (#52, #53), and gate a free download.' },
      { when: 'A relevant artist announces an Irish date', act: 'Contact the promoter early for a support slot (#59); test an AV-support angle rather than DJ-only (#60).' },
      { when: 'A budget-free visual collab makes sense', act: 'Collaborate with a visual artist, photographer, or filmmaker (#65, #66).' },
      { when: 'You have done the sync research pass', act: 'Sync outreach, short films, installations, production libraries (#67-70) — not before the research.' },
    ],
    // Deadline-driven, not cadence-driven: these have fixed seasonal dates, so
    // they get checked as a list rather than waiting for a tidy "quarter".
    deadlinesNote: 'These have fixed, seasonal deadlines — glance at this list once a month rather than treating it as a quarterly ritual, or you will miss windows.',
    deadlines: [
      'Gallery / late-night arts programming (#56)',
      'Arts festivals — digital art, light, multidisciplinary (#57)',
      'Electronic music festivals (#58)',
      'Open calls — arts councils, galleries, AV commissions (#92)',
      'Funding, especially for audiovisual / live / installation work (#93)',
      'Cultural-org relationships — keep them warm (#94, #95)',
    ],
    // Build it once and it pays off on every release after.
    oneTime: [
      { t: 'Release landing-page template (#51)', d: 'The single highest-leverage build here. One good template, reused every release.' },
      { t: 'Bandcamp set up (#44)', d: 'For niche, experimental, collector, or community-focused releases.' },
      { t: 'Contact database (#28)', d: 'Only if you commit to outreach — see the relationship note below. Otherwise skip it.' },
    ],
    // The ledger question, resolved.
    relationships: 'The weekly relationship quota (#29) does not need a new ledger — the Collab Ladder already is your log. Point the quota at it: did I move ~5 ladder names forward this week? Warm targets also surface automatically in the engagement blocks on This Week, so the relationship work stays informal but still gets counted.',
    // Reference only — nothing here needs a slot until something above runs well.
    backlog: 'Platform-building (#22, #23), sample and preset packs (#76, #77), education content (#78, #79), podcast and interview series (#80, #82, #83), and playlist-as-curation projects (#84-87). Park these until something higher up is actually working.',
    // Deliberately dropped — your own notes already said why.
    offList: [
      { t: 'Trackstack (#26)', d: 'Expensive and never much success — your note said it.' },
      { t: 'Lads-in-a-field YouTube sessions (#37)', d: 'Not your thing, and you already know it.' },
    ],
  },

  meta: {
    monthlyListeners: 5000, // drives the Collab Ladder ratio scoring
  },
};
