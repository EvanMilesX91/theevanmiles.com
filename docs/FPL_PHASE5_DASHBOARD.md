# FPL Decision Engine — Phase 5

Phase 5 turns the modelling and explainability layers into a decision interface at `/fpl-helper`. Phase 6 now supplies this interface through a precomputed automation endpoint; the Phase 5 endpoint remains the uncached diagnostic calculation path.

## What the interface shows

- **Decision:** Final Committee action, confidence, projected XI, captaincy, provisional transfer, Red Team challenge, and the fact-to-decision evidence chain.
- **Squad:** Optimized legal XI on a pitch, bench order, captaincy shortlist, and an evidence drawer for every owned player.
- **Transfers:** Primary, alternative, and roll scenarios with one-, three-, and six-Gameweek effects, direct comparisons, and Red Team failure cases.
- **Council:** Searchable whole-player-pool Council scores, disagreements, direct player comparison, and notable omissions.
- **Data:** Source health, ledger state, and known model limitations.

## API

`GET /api/fpl/phase-five` returns a condensed `PhaseFiveSnapshot`. It runs Phase 4 against one shared official-data fetch, then maps the detailed model output into a stable dashboard view model. The website now reads `GET /api/fpl/phase-six`, which serves the scheduled stored version of this payload.

The endpoint does not write proposed transfers to the squad ledger. A stale ledger is exposed in the response and blocks the Final Committee action until the real squad is confirmed.

## Local verification

```bash
npm run lint
npm run test:fpl-phase5
npm run build
npm run dev
```

Then open `http://localhost:3000/fpl-helper`.

## Boundaries

- Council scores are deterministic model lenses, not simulated people.
- Price pressure is a transfer-activity proxy unless a true external forecast source is healthy.
- The UI surfaces degraded sources and model caveats rather than silently replacing them with certainty.
- Phase 5 is presentation and orchestration only; projection, optimization, explainability, and Red Team logic remain owned by Phases 2–4.
