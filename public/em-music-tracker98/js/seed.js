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
    { group: 'POST', desc: 'Best 6–8 PM — especially Thu & Sun', items: [
      { key: 'mon',  label: 'Mon — Working On',        type: 'check' },
      { key: 'wed',  label: "Wed — What's In My USB",   type: 'check' },
      { key: 'fri',  label: 'Fri — Making',             type: 'check' },
      { key: 'sun',  label: 'Sun — Playing',            type: 'check' },
    ]},
    { group: 'MAKE', items: [
      { key: 'capture',      label: 'One studio capture (2 min → CAPTURES)', type: 'check' },
      { key: 'friday_asset', label: "Friday post asset ready",              type: 'check' },
    ]},
    // Engagement is flagged so the view can append this week's collab targets.
    { group: 'ENGAGEMENT', engage: true,
      desc: 'Like + comment on your warm-up targets — 15 min, ~10 likes, 5 real comments each.', items: [
      { key: 'engage', label: 'Engagement sessions (aim 3)', type: 'count', goal: 3, max: 5 },
    ]},
    { group: 'STORIES', desc: '8–10 PM, Tue–Thu · 3–5 across the week, rough is fine', items: [
      { key: 'stories', label: '3–5 stories across the week', type: 'count', goal: 3, max: 5 },
    ]},
  ],

  /* Monthly — the "once a month, on top" block from the guide. */
  monthlyTemplate: [
    { key: 'captures_review', label: 'Pull anything usable from CAPTURES' },
    { key: 'edit_released',   label: 'One edit or playlist released' },
    { key: 'collab_approach', label: 'One Collab Ladder approach' },
  ],

  /* Release sprint post schedule. Offsets are DAYS from the release Friday.
     Matches the guide's sprint table exactly. */
  sprintTemplate: [
    { key: 'teaser1',   label: 'Teaser 1',    offset: -10, note: 'Template 1 · 15–30 sec' },
    { key: 'teaser2',   label: 'Teaser 2',    offset:  -8, note: 'Different angle · a studio capture works' },
    { key: 'track_out', label: 'Track out',   offset:   0, note: 'Template 2 + Release Day procedure' },
    { key: 'round_up',  label: 'Support round-up', offset: 2, note: 'Reposts, reactions, plays' },
    { key: 'visualiser',label: 'Visualiser',  offset:  11, note: 'TouchDesigner / Stay Asleep loop' },
    { key: 'clip',      label: 'Clip',         offset:  16, note: 'Second use of the visualiser' },
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
      { day: 'Wed', name: "What's In My USB",  what: "5 tracks you're actually playing, 10 sec each. The strongest format on the list — people want discovery.", caption: 'One per track, 5 words max — “opening track”, “peak time”, “closer”' },
      { day: 'Fri', name: 'Making',            what: 'Anything being built — an edit, a visual, a melody, a field recording. One idea per post.', caption: 'Edit-lab version works well — “turning this…”, original plays, cut, your version' },
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
      { key: 'listeners',    label: 'Monthly listeners', base: '2,911' },
      { key: 'streams',      label: 'Streams (28d)',     base: '—' },
      { key: 'followers',    label: 'Followers',         base: '1,611' },
      { key: 'saves',        label: 'Saves',             base: '1,356' },
      { key: 'playlistAdds', label: 'Playlist adds',     base: '7,083' },
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

  // Spinning wheel categories (Content tab).
  wheel: {
    Genres: ['Melodic house', 'Organic house', 'Afro house', 'Progressive', 'Downtempo', 'Dub techno', 'Breakbeat', 'Deep house', 'Indie dance', 'Ambient'],
    Edits:  ['Bootleg remix', 'VIP of your own', 'Classic flip', 'Acapella + your beat', 'Slowed + reverb', 'Club-tool edit', 'Mashup', 'Field-recording intro', 'CRT visual loop', 'Pop flip'],
  },

  meta: {
    monthlyListeners: 5000, // drives the Collab Ladder ratio scoring
  },
};
