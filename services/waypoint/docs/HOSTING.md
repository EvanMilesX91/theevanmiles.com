# Waypoint on theevanmiles.com/waypoint

The frontend is part of the existing Next.js website. The Python engine is a second Vercel project in the same repository, with root directory `services/waypoint`. Supabase Postgres stores the ledger, provider cache and engine snapshots. Supabase Cron invokes short authenticated jobs. No continuously running rented server is required.

The public domain remains on the existing website project. Its private server proxy at `/api/waypoint/*` forwards authenticated requests to the Python engine. API keys, the database password and service token never enter client JavaScript. The private page is excluded from search indexing.

Production was deployed and verified on 9 October 2026: https://www.theevanmiles.com/waypoint. The website project is `theevanmiles-com-fsdh`; the engine is `theevanmiles-waypoint-engine`, at https://theevanmiles-waypoint-engine.vercel.app. Both belong to the existing `evan-miles-projects` Vercel team. The apex domain redirects to www.

## Local use

From `services/waypoint`, run `setup.ps1` once, then `start.ps1`. Open http://127.0.0.1:3000/waypoint. Sign in with `WAYPOINT_PASSWORD`, or the existing website `ADMIN_PASSWORD` if no separate password is set. Minimum length: 12 characters. `configure-local.py` generates the two internal secrets without printing them and preserves provider keys. SQLite remains available for local use.

## Provider setup

In the engine `.env` locally, or the **engine project's** Vercel environment variables in production:

| Name | Value |
|---|---|
| `APCA_API_KEY_ID` | Alpaca Paper Trading Key ID |
| `APCA_API_SECRET_KEY` | Alpaca Paper Trading Secret Key |
| `ALPHA_VANTAGE_API_KEY` | Optional; free key from https://www.alphavantage.co/support/#api-key |
| `SEC_USER_AGENT` | Optional; `Waypoint your-real-contact-email@example.com` with your actual contact address |
| `LIVE_SYMBOLS` | Start with `AAPL,MSFT`; large watchlists need a job-budget review |

Alpaca: sign in at https://app.alpaca.markets/account/login, choose **Paper Trading**, find **API Keys** on Home, then **Generate New Key**. The secret is displayed once; regenerating keys invalidates the prior pair. Save privately. Waypoint makes market-data requests only and contains no order endpoint.

Basic IEX quotes cover one exchange. Historical SIP bars end at least 16 minutes in the past and use split adjustment. Missing/withdrawn quotes never become a zero-dollar market price. Completed-session prices are labeled END OF DAY. News entitlement is checked separately. Alpha Vantage earnings dates are expected dates, not company-confirmed events. Its free allowance is 25 requests/day: the app caches bulk earnings daily and FX hourly and tracks calls in persisted state. An abrupt job termination can roll back a reservation; the provider's own quota remains the final limit. Normal provider failures preserve reservations and old observation timestamps.

## Supabase database

1. Use the existing Supabase project; do not create a paid project just for Waypoint.
2. Open **Connect → Transaction pooler**. Copy the Postgres connection string, fill in the database password, and store it as `DATABASE_URL` in the engine's private environment. The Supabase anon/service API keys are **not** the database password. The pooler is appropriate for short-lived serverless connections; prepared statements are disabled by this app.
3. Run the explicit migration once using that connection string in the process environment: from `services/waypoint/backend`, run `..\.venv\Scripts\python.exe -m app.migrate`. Do not replace the local SQLite URL permanently unless you intend local work to use hosted data.
4. Confirm only the `waypoint` schema was created. Existing site tables remain untouched. The migration enables RLS and revokes public, anonymous and ordinary authenticated access to its tables. Do not expose this schema through the public Data API. Use the database owner connection for the engine.
5. Confirm an anonymous request cannot read the ledger. The application authenticates its owner in Next.js; it does not expose Supabase service credentials to the browser.

The owner currently uses Alpaca only. Leave Alpha Vantage and SEC values empty until explicitly configured.

No migration runs on a serverless cold start. Hosted requests fail closed if a service token or Postgres URL is missing. Each transaction locks the engine state and ledger together, preventing two server instances from spending the same cash. Daily analytical snapshots are retained; current quote/research state is overwritten in the runtime record. Trade entry snapshots and historical FX remain immutable.

## Vercel projects

**Engine project:** import the same Git repository with root `services/waypoint`, FastAPI framework and Python 3.13. Add `APP_MODE=live`, `RUNTIME_MODE=serverless`, `DATABASE_URL`, `WAYPOINT_SERVICE_TOKEN`, provider settings above, `FRONTEND_ORIGIN=https://www.theevanmiles.com`, and `TRUSTED_HOSTS` containing the engine's production hostname. Vercel's current deployment hostname is also allowed automatically. Runtime requirements and the 180-second function budget are already defined. Migrate before the first authenticated request. If deployment protection is enabled, configure a supported machine-access bypass for the proxy and scheduler rather than expecting a browser login to authorize their calls.

**Existing website project:** set `WAYPOINT_BACKEND_URL=https://theevanmiles-waypoint-engine.vercel.app`, the matching `WAYPOINT_SERVICE_TOKEN`, and `WAYPOINT_SESSION_SECRET` (at least 32 random characters). Keep the existing `ADMIN_PASSWORD`, or set a separate `WAYPOINT_PASSWORD` of at least 12 characters. `WAYPOINT_SITE_ORIGIN` is needed only for a particular preview hostname; production www and apex domains are already allowed. Do not put credentials in variables beginning `NEXT_PUBLIC_`.

Vercel deployment protection remains enabled on both projects. The website also needs `WAYPOINT_BACKEND_BYPASS_SECRET`, the engine project's automation bypass secret. Its server proxy sends this as `x-vercel-protection-bypass`, in addition to the separate bearer service token. Supabase scheduled requests need both credentials too. Neither credential is accepted from or returned to the browser. The temporary website deployment bypass used during release verification was revoked after production checks.

The repository contains unrelated uncommitted FPL and Traitors work. Review and deploy only the Waypoint integration, or deliberately release those projects separately. Do not accidentally publish the entire dirty checkout. Keep existing domain, DNS and cron settings.

## Background updates

Enable Supabase Cron, pg_net and Vault. Store `waypoint_backend_url`, `waypoint_service_token` and `waypoint_backend_bypass_secret` in Vault, then run `supabase/cron.sql`. Four namespaced jobs are active: `waypoint-quotes` checks each minute during a UTC window covering both US daylight-saving offsets; `waypoint-morning-research` refreshes research; `waypoint-session-research` refreshes hourly during sessions; `waypoint-job-log-retention` trims old Waypoint Cron run records weekly. The exchange calendar skips closed sessions and holidays. The browser polls saved results every 30 seconds. A closed browser does not stop the scheduled jobs.

On 9 October 2026, the initial Supabase HTTP call and five subsequent automatic minute calls returned HTTP 200 without timeout or network error. This verifies actual scheduled delivery through Vercel protection and the engine's authentication; it is not a long-term uptime claim.

Inspect both Cron run history and `net._http_response` for successful 2xx responses. Cron enqueuing a request is not proof that Vercel accepted it. Check an authenticated initial refresh and tick before enabling recurring jobs. Disable a named job in Supabase Cron if it needs to be paused.

## Free-tier expectations

This configuration uses free API plans and aims to fit a small personal watchlist within existing hosting allowances. It does not upgrade plans or enable paid subscriptions. Supabase Free includes 500 MB database space and can pause after inactivity. Vercel and Supabase usage limits still apply; avoid unbounded watchlists, frequent manual refreshes and indefinite cron-log retention. There is no guarantee of a zero bill on an already metered paid hosting account.

References: https://docs.alpaca.markets/us/docs/about-market-data-api ; https://docs.alpaca.markets/us/docs/market-data-faq ; https://www.alphavantage.co/support/ ; https://supabase.com/pricing ; https://supabase.com/docs/guides/database/connecting-to-postgres ; https://supabase.com/docs/guides/cron/quickstart ; https://supabase.com/docs/guides/functions/schedule-functions ; https://vercel.com/docs/frameworks/backend/fastapi

## Current analytical limit

Live research is real and sourced. Live recommendations remain paused: the free feeds do not supply reviewed peer valuations, concentration, favorable-catalyst scores, binary-event absence or validated estimate uncertainty. The app does not silently invent these values. The existing full recommendation engine and backtest remain explicitly fictional demo experiments. A future live recommendation model requires a separately documented design and validation.
