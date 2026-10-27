# FPL Decision Engine — Phase 2 method

Phase 2 converts the Phase 1 evidence layer into forward-looking estimates. Its public endpoint is `GET /api/fpl/phase-two`.

## What the model now does

- Projects expected minutes from official availability, season starts, and last-five minutes.
- Builds attack and defence ratings from completed scores, recent results, home/away splits and official FPL strength priors. Small samples are shrunk toward league average.
- Propagates official injuries through team attack and defence using a capped importance estimate based on minutes, expected goal involvement and set pieces.
- Separates observed points per 90 from a sustainable estimate based on xG, xA, clean sheets, regressed bonus and defensive contributions.
- Produces fixture-level and 1/3/6-Gameweek xPts, including component breakdowns and an uncertainty range.
- Reads independent confirmed-lineup evidence when available. One out-of-position start is `possible`; two matching starts are required for `confirmed`.

## Evidence rules

Facts are retained separately from estimates. Official status, scores, minutes and prices are facts. Expected minutes, team effects, sustainable returns and xPts are estimates. A stored lineup feed that does not cover either of the two latest completed Gameweeks is marked degraded and never presented as a current predicted lineup.

## Important limits

- The uncertainty range is a transparent sensitivity range, not a calibrated probability interval.
- Official FPL strength is a prior, not ground truth.
- Injury effects are deliberately capped because replacement quality and tactical adaptation are not fully observed.
- Role evidence changes scoring opportunity, but does not automatically increase minutes.
- Price-change forecasting and transfer optimization remain later phases; Phase 2 supplies the projections they need.
