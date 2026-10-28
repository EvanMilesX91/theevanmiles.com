# FPL Decision Engine — Phase 6 automation

Phase 6 moves expensive calculation out of the private dashboard request path. A protected scheduled job builds the complete Phase 5 decision snapshot and stores one checksummed latest record. The admin-only `/fpl-helper` reads that precomputed record through the authenticated `GET /api/fpl/phase-six` endpoint.

## Runtime flow

1. The production scheduler calls `GET /api/cron/fpl-refresh` at 05:15 each day. A second self-hosted task checks every 30 minutes but calls the model only inside the final eight hours before a published FPL deadline. Install both with `scripts/install-fpl-scheduler.ps1`.
2. The route fails closed unless the request has `Authorization: Bearer $CRON_SECRET` and the configured secret is at least 16 characters.
3. The complete official-data, projection, optimization, Council and Red Team pipeline runs once.
4. A server-only record is upserted to Supabase with its refresh time, trigger, runtime, checksum and JSON payload.
5. Authenticated admin requests read that record. A two-minute server memory cache prevents repeated database reads; private/no-store headers prevent browser or shared-cache disclosure.
6. If no record exists yet, the authenticated endpoint performs a one-time bootstrap calculation and persists it. Existing aging or stale records remain visible and are labelled honestly rather than being silently replaced with live computation.
7. The first projection saved for each upcoming Gameweek is frozen. Once FPL marks that Gameweek finished, official player points, minutes and prices are attached with points/minutes error, price-direction accuracy and shadow predicted-lineup accuracy.
8. Bias learning remains locked until four completed Gameweeks exist. It then applies capped corrections (±0.75 points and ±8 minutes). Predicted lineups remain shadow-only unless their four-Gameweek 60-minute-proxy accuracy reaches 80%.

Local development uses `data/fpl/phase6/latest.json`; every production runtime (Vercel or the self-hosted Docker service) uses Supabase. The local generated directory is ignored by Git.

## Production setup

Apply both [`supabase/migrations/202610260001_fpl_dashboard_snapshots.sql`](../supabase/migrations/202610260001_fpl_dashboard_snapshots.sql) and [`supabase/migrations/202610270001_fpl_projection_calibration.sql`](../supabase/migrations/202610270001_fpl_projection_calibration.sql) to the existing Supabase project before enabling the cron. Both tables have row-level security enabled and grant no browser role access. Reads and writes happen server-side with the existing service-role key.

## Historical calibration warm start

Archived pre-deadline recommendation files can seed points, minutes, captaincy and price-direction evaluation without pretending that reconstructed forecasts are live evidence:

```powershell
npx --yes tsx@4.20.6 scripts/fpl-backfill-calibration.ts --archive-dir "C:\path\to\data\fpl" --gameweeks 2,3,4,5 --remote
```

The importer selects the final valid pre-deadline forecast for each Gameweek, evaluates it against the official event endpoint and writes an idempotent calibration record. It will not overwrite a forward record. Historical records count at 50%, so four backtests contribute 2.0 effective Gameweeks; forward records count at 100%. Historical predicted-lineup observations are deliberately excluded because the source pages were not archived consistently. The predicted-XI promotion gate therefore remains forward-only.

The automation reuses existing environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

Vercel supplies the configured cron bearer automatically. Manual requests must provide the same bearer and can use either GET or POST.

## Operational endpoints

- `GET /api/fpl/phase-six` — admin-authenticated precomputed dashboard payload plus `automation` metadata.
- `GET|POST /api/cron/fpl-refresh` — protected full refresh; returns only operational metadata, never the full model payload.
- `GET /api/fpl/phase-five` — admin-authenticated uncached diagnostic calculation path, no longer used by the website.

## Freshness contract

- **Fresh:** no more than 26 hours old.
- **Aging:** more than 26 hours and no more than 48 hours old.
- **Stale:** more than 48 hours old or an invalid timestamp.

This accommodates one free daily scheduled refresh without claiming a missed job is current. The Data view shows the age, storage backend, trigger, runtime and checksum.

## Verification

```bash
npm run lint
npm run test:fpl-phase6
npm run build
```

No scheduled run confirms or mutates a proposed transfer. Owner-ledger changes still require explicit user confirmation.
