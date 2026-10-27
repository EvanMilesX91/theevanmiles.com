# FPL Decision Engine — Phase 6 automation

Phase 6 moves expensive calculation out of the private dashboard request path. A protected scheduled job builds the complete Phase 5 decision snapshot and stores one checksummed latest record. The admin-only `/fpl-helper` reads that precomputed record through the authenticated `GET /api/fpl/phase-six` endpoint.

## Runtime flow

1. The production scheduler calls `GET /api/cron/fpl-refresh` at 05:15 each day. Vercel uses `vercel.json`; the self-hosted Windows service uses the `EvanMiles Website - FPL refresh` Scheduled Task and `scripts/fpl-production-refresh.ps1`.
2. The route fails closed unless the request has `Authorization: Bearer $CRON_SECRET` and the configured secret is at least 16 characters.
3. The complete official-data, projection, optimization, Council and Red Team pipeline runs once.
4. A server-only record is upserted to Supabase with its refresh time, trigger, runtime, checksum and JSON payload.
5. Authenticated admin requests read that record. A two-minute server memory cache prevents repeated database reads; private/no-store headers prevent browser or shared-cache disclosure.
6. If no record exists yet, the authenticated endpoint performs a one-time bootstrap calculation and persists it. Existing aging or stale records remain visible and are labelled honestly rather than being silently replaced with live computation.
7. The first projection saved for each upcoming Gameweek is frozen. Once FPL marks that Gameweek finished, official player points and minutes are attached with mean absolute error, RMSE, bias and minutes error for the whole pool, owned players and selected XI.

Local development uses `data/fpl/phase6/latest.json`; every production runtime (Vercel or the self-hosted Docker service) uses Supabase. The local generated directory is ignored by Git.

## Production setup

Apply both [`supabase/migrations/202610260001_fpl_dashboard_snapshots.sql`](../supabase/migrations/202610260001_fpl_dashboard_snapshots.sql) and [`supabase/migrations/202610270001_fpl_projection_calibration.sql`](../supabase/migrations/202610270001_fpl_projection_calibration.sql) to the existing Supabase project before enabling the cron. Both tables have row-level security enabled and grant no browser role access. Reads and writes happen server-side with the existing service-role key.

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
