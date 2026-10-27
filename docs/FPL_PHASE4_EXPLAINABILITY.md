# FPL Decision Engine — Phase 4

Phase 4 explains and challenges the Phase 3 decision. Its endpoint is `GET /api/fpl/phase-four`.

## Decision Council

Every player is evaluated through ten deterministic feature lenses: projection, value, demonstrated FPL output, new-player upside, minutes, fixtures, scoring rules/position, captaincy, risk and contrarian value. The lenses use different inputs and documented weights; they are not simulated AI personalities.

Each lens emits applicability, a 0–100 score, confidence, recommendation, reason and evidence. Percentile ties receive the same score. Only applicable lenses with at least 50 confidence can trigger a disagreement, preventing specialist neutral scores from manufacturing conflict. The aggregate preserves disagreement for likely participants when the lens spread is at least 45 points or strong upside conflicts with a strong caution score.

Historical confidence is capped at 50 until a verified, identity-matched multi-season dataset exists. The engine states this limitation instead of pretending current-season data is long-term history.

## Comparisons and omissions

Transfer moves now include direct incoming-versus-outgoing comparisons, price and xPts differences, whole-squad opportunity-cost reasoning and a concrete condition that would reverse the decision. High-scoring omissions explain the selected positional alternative and any budget or club-limit reason.

## Red Team and Final Committee

The Red Team checks ledger freshness, minutes uncertainty, weak slots, premium value, club concentration, source health and hit margins. It searches the wider legal scenario set for a structurally different alternative.

The Final Committee emits separate `FACT`, `DATA`, `MODEL_ESTIMATE`, `INTERPRETATION` and `DECISION` statements. A stale ledger is a hard execution block. No Phase 4 output mutates the owner ledger.
