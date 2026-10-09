# Waypoint

Private investment research and an append-only EUR trade journal at **theevanmiles.com/waypoint**. The canonical source now lives in the existing `theevanmiles.com` repository.

Live at **https://www.theevanmiles.com/waypoint**, deployed and verified on 9 October 2026. Sign in with the existing website admin password unless a separate Waypoint password has been configured.

## Open locally

From `services/waypoint`, run `setup.ps1` once, then `start.ps1`. Open **http://127.0.0.1:3000/waypoint**. Sign in with the existing website admin password, or `WAYPOINT_PASSWORD` if configured separately. `stop.ps1` stops the local processes and retains data; `check.ps1` runs the validation suite.

The frontend uses the site's Next 15 / React 18 stack. There is no second standalone frontend to maintain. Python 3.13+, Node.js 22.13+ and npm are required. Local data is in `services/waypoint/data/waypoint.db`; secret environment files, logs, databases and dependencies are excluded from Git. SQLite and Supabase are separate databases: changing the connection string does not transfer records automatically.

## Source layout

- `app/waypoint`, `components/waypoint`: private page and scoped presentation.
- `app/api/waypoint`, `lib/waypoint`: signed owner sessions, protected proxy and client types.
- `services/waypoint/backend/app`: provider adapters, conservative financial normalization, accounting, analysis, exchange calendar and persistent runtime.
- `services/waypoint/backend/tests`, `tests/waypoint`: financial, provider, concurrency and authentication tests.
- `services/waypoint/supabase/cron.sql`: namespaced background update jobs.

## Real data

The local configuration uses **live mode**. Alpaca keys have been tested with actual historical SIP prices and news. IEX quotes remain subject to exchange hours and valid two-sided quotes. A completed prior-session close is clearly labeled. Failed data requests never become synthetic live data.

SEC identity, filings and reported financial metrics require an identifying contact email. Free Alpha Vantage earnings and EUR/USD require its API key. Save these in the engine's `.env` locally; production keys belong in the Python Vercel project's environment variables. Read [PROVIDERS.md](docs/PROVIDERS.md) and [HOSTING.md](docs/HOSTING.md).

**Live trade plans remain paused when required inputs are unavailable.** Free feeds do not establish reviewed peer valuations, customer concentration, favorable catalysts, absence of binary events or estimate uncertainty. The app reports those gaps instead of making up reassuring values. The original recommendation engine and toy backtest can still be tested with `APP_MODE=demo`; their fictional inputs never support live claims.

The manual ledger starts at €20; the €200 goal does not affect calculations. Fills retain their actual supplied fees, FX, execution time and frozen entry snapshot. Duplicate IDs cannot duplicate a fill. Cash cannot go negative, and partial sales release average cost proportionally. The app does not send brokerage orders.

## Hosted setup

The existing site project serves `/waypoint`. A second **Vercel FastAPI project in the same repo** executes short jobs. Supabase stores the engine state and ledger in a private `waypoint` schema, and Cron triggers updates while the browser is closed. No dedicated always-running server is needed. Owner login uses a signed HttpOnly cookie; the Python API requires a separate server secret.

See [HOSTING.md](docs/HOSTING.md) for exact environment variables, migration, Cron and deployment checks. Both Vercel projects, authenticated cloud access, Supabase migration and automatic scheduled HTTP delivery have been verified. No paid subscription was enabled by this setup.

## Method and verification

[METHODOLOGY.md](docs/METHODOLOGY.md) describes the demo calculations and limits. [CONTRACT.md](docs/CONTRACT.md) documents the initial API; hosted additions and polling are covered in HOSTING. [VERIFICATION.md](docs/VERIFICATION.md) records checks. The toy backtest is not evidence of a profitable real strategy. Financial metrics use actual reported periods and exact aligned components; no point-in-time production backtest is claimed.
