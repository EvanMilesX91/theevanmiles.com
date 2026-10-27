# FPL Decision Engine — Phase 3

Phase 3 converts the Phase 2 projections into legal, financially grounded decisions. Its endpoint is `GET /api/fpl/phase-three`.

## Implemented

- Positional replacement levels, xPts per million, value above replacement and cheaper-option opportunity cost.
- Explicit treatment of unproven and limited-sample players. They remain in the player pool, while rate estimates are prior-shrunk and confidence is capped.
- Relative price pressure from official FPL net transfers. This is deliberately labelled a proxy because FPL does not publish price thresholds or an official forecast.
- Exhaustive starting-XI formation search across all legal FPL formations.
- Dedicated captain ranking using xPts, ceiling, downside, minutes and confidence.
- One- and two-transfer scenario search using confirmed purchase prices, FPL selling-price rules, current bank, free transfers, hit costs, positional rules and the three-player club limit.
- Net transfer gains over 1, 3 and 6 Gameweeks. Hits are subtracted before scenarios are ranked.
- A hard stale-ledger guard: scenarios may be calculated, but the executable recommendation becomes `wait_for_ledger_confirmation` when the confirmed ledger is behind official data.

## Deliberate boundaries

This phase does not activate a transfer, update the ledger, or claim that a price change is certain. Wildcard/free-hit squad rebuilding and calibrated independent price forecasts require later optimization/provider work.
