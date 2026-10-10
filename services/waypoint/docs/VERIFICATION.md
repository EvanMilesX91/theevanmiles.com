# Persistent stream verification — 10 October 2026

| Check | Result |
|---|---|
| Backend suite | 201 passed; Ruff passed; mypy passed across 22 source files |
| Entire website suite | 174 passed; TypeScript and Next 15.5.27 production build passed |
| Actual Alpaca socket | One authenticated IEX socket acknowledged 30 HOT symbols |
| Basic channel allocation | 30 quotes + 30 bars accepted; quotes and trades share the observed 30-symbol allowance, so trades use only spare capacity |
| Local SSE | Authenticated stream returned coalesced snapshots; no live quote REST calls occurred |
| Freshness gate | Closed-market/stale symbols were non-actionable; source timestamps age independently in the browser |
| Provider configuration | Alpaca configured; SEC and Alpha Vantage explicitly unconfigured |
| Journal integrity | No trade records changed during live verification |

The persistent build is running locally. It has not replaced the public Vercel release because Vercel serverless cannot keep the Alpaca WebSocket open. Production cutover awaits an always-on backend.

# Live integration verification — 9 October 2026

Canonical source is in `theevanmiles.com`; the route is `/waypoint`. The release copy excludes unrelated unfinished FPL and Traitors work.

| Check | Result |
|---|---|
| Backend suite | 146 passed; Ruff and mypy (16 modules) passed |
| Entire existing website suite | 169 passed |
| Waypoint frontend authentication/proxy tests | 29 passed after the Next 15 update |
| TypeScript | Passed |
| Production build | Passed on canonical site and isolated release copy with Next 15.5.27 / React 18 |
| Production dependency audit | Zero vulnerabilities; nine development dependency findings remain in Tailwind/glob tooling |
| Actual Alpaca requests | Successful historical SIP bars and news for AAPL/MSFT; zero-sided IEX quotes ignored |
| Actual Supabase migration | Revision 0002; seven private Waypoint tables; existing eight public table names preserved |
| Database permissions | RLS enabled on every Waypoint table; anon/authenticated roles lack schema usage |
| Hosted runtime with Supabase | Unauthenticated dashboard 401; authenticated refresh 200; new engine restores live snapshots |
| PostgreSQL concurrency primitive | Separate connections cannot hold the same transaction advisory lock; release makes it available |
| Journal integrity | Zero trade records before and after hosted verification |
| Browser | Private login and real-data dashboard/research loaded; UI testing uses a separate local database |
| Vercel engine deployment | Production ready; health 200 through Vercel protection; dashboard without service bearer 401; authenticated dashboard, refresh and tick 200 |
| Website staging and production | Homepage, /waypoint, downloads and existing admin route 200; owner login and live dashboard 200; anonymous/after-logout access 401; cross-site write 403 |
| Public domain | https://theevanmiles.com/waypoint redirects to the working www sign-in page; owner cookie has HttpOnly, Secure and SameSite=Strict |
| Supabase background jobs | Four Waypoint Cron jobs active; initial HTTP request plus five automatic minute requests returned 200 without timeout or network error |
| Release protection | Vercel deployment protection retained; temporary frontend verification bypass revoked; persistent engine bypass remains server-only |

Only Alpaca is configured at the owner's request. SEC and Alpha Vantage remain optional/unconfigured. Live FX and unsupported analytical inputs are labeled missing; no live recommendation plans are manufactured.

The app uses a 140-second hosted transaction budget, including queueing and provider work, within Vercel's 180-second function limit. PostgreSQL statements and lock waits are bounded at ten seconds; timeout tests verify database and in-memory rollback. Cloud checks above were performed separately against the deployed services. The short scheduling observation does not establish long-term uptime or provider availability.

The historical section below describes the original standalone demo delivery; its dependency and credential statuses do not describe the current integration.

# Original demo verification

Verified on Windows with Python 3.13.15 and Node 26.7.0, using the project's installed dependencies.

| Check | Result |
|---|---|
| Deterministic backend tests | **99 passed** |
| Ruff lint, backend and tests | Passed |
| mypy, all 14 application modules | Passed |
| TypeScript `tsc --noEmit` | Passed |
| ESLint frontend | Passed |
| Next.js production build | Passed |
| Windows setup script | Passed after stopping the running frontend; script now checks for the Windows file-lock condition before installation |
| Windows startup script | Passed, backend and frontend healthy on loopback |
| Database migration | SQLite initial migration and repeat startup passed |
| Browser workflow | Demo entry → paper buy → HOLD → first profit → partial sell; cash and remaining position updated |
| Research UI | Demo backtest produced 10 closed trades with inspectable assumptions |
| Responsive UI | Checked at phone width 390 px and desktop width 1440 px; mobile price ranges use two columns to prevent overlap |
| Frontend production dependency audit | `npm audit --omit=dev`: zero vulnerabilities at verification |

The browser trading test used a separate disposable database under `work/`. The delivered running app uses its own clean database with **€20 cash, no trades and no open positions**. Opening or refreshing the demo does not execute real orders.

Automated coverage includes score components and weighting, classification, confidence, missing and stale sources, state boundaries, EUR/USD conversions, entry and exit fees, fractional holdings, partial-sale cost basis, realized/unrealized results, duplicate requests, overselling/overdraft rejection, original position-plan preservation, separate shadow capital, no-credential live mode, stale/invalid provider responses, bounded HTTP retries, DST mismatches, holidays/early closes and look-ahead protections in the illustrative backtest.

## Not validated

- Real Alpaca entitlement and live network quotes: no user credentials were configured. Adapter behavior was tested using mocked official-response shapes, including failure paths.
- SEC live network access: an identifying User-Agent must be supplied. Parsing, provenance, date cutoffs and errors were tested with fixtures.
- PostgreSQL/Docker deployment: Docker was installed but its daemon was stopped. SQLite is the verified default.
- Trading performance: no profitability claim is supported. The backtest uses synthetic data and a separate price-only demonstration strategy; it is not a validation of the dashboard's full heuristic model.

There are upstream deprecation warnings from the exchange-calendar/NumPy combination and the FastAPI/Starlette HTTPX test client. The full npm audit also reports five **development-only** advisory entries in the Next ESLint plugin → fast-glob → micromatch → braces dependency chain (one underlying braces stack-exhaustion issue). No compatible patched braces release was available at verification; forcing npm's suggested major downgrade would replace the current Next lint stack. These dependencies process local development files and are excluded from the production dependency audit. Re-check upstream updates before using this as a shared development service.
