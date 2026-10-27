# FPL Phase 1 audit

Date: 2026-10-26

## Baseline

- The existing website is `C:\Users\Dominika Kuzniar\theevanmiles.com`, a Next.js 15 TypeScript application deployed with Vercel configuration.
- The current `main` branch did not contain a committed `/fpl-helper` route, FPL engine module, FPL API route or FPL test suite.
- Historical generated FPL recommendation and raw-source files exist under the local untracked `data/fpl` tree.
- Earlier FPL implementation sources and patches exist only in the user-supplied staging workspace. They are useful design evidence but are not part of the live site revision.
- The repository contains unrelated admin work. Phase 1 is isolated to `lib/fpl/phase1`, `app/api/fpl/phase-one`, `tests/fpl`, this document and one package script.
- Baseline `npm run lint` passed. The first `npm test -- --runInBand` invocation was invalid because Vitest does not support that Jest option; a plain baseline `npm test` began successfully but did not return a summary within the 30-second command window.

## Phase 1 decisions

1. Official FPL `bootstrap-static`, `fixtures`, and the latest five `event/{gw}/live` endpoints are the critical sources.
2. Five event-live requests provide whole-pool rolling data and avoid hundreds of per-player history requests.
3. Rolling “start equivalents” mean matches with at least 60 minutes. They are a minutes-security proxy, not a claim about the official starting XI.
4. The Phase 1 monitoring score is explicitly a scouting/risk signal. It is not labelled xPts; calibrated xPts belongs to Phase 2.
5. Confirmed squad state and transfer proposals use different types. Only `confirmTransfer` can mutate a cloned ledger, and it requires an explicit confirmation reference.
6. Local JSON persistence is atomic. Vercel execution defaults to non-persistent because its deployment filesystem is not durable; production history storage remains a later task.
7. Player-change detection requires a previous snapshot. The first run establishes the baseline; subsequent runs produce price, availability, news, minutes, score and ranking changes.

## Phase 1 completion surface

- `GET /api/fpl/phase-one` refreshes official data and returns the full monitored player pool.
- The response contains source health, the confirmed owner ledger, rolling 1/3/5 features, rankings, “what changed” events, proactive alerts and a structural-debt score.
- The default ledger contains the last explicitly confirmed squad. Bruno-to-Rogers remains unrecorded because it was only proposed.

## Deferred deliberately

- Tactical-position and role parsing from lineups/commentary.
- Independent injury and predicted-lineup enrichment.
- Calibrated 1/3/6-Gameweek xPts.
- Multiweek transfer-path optimization.
- Durable production database storage and scheduled refreshes.
- Private admin dashboard UI.

Those are Phase 2 and later tasks; representing them as completed now would create false confidence.
