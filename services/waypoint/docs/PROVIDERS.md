# Real providers

`app/providers.py` contains read-only, typed adapters. `app/live_data.py` combines separately cached observations and reports partial coverage. API keys never appear in cached data, source URLs or returned errors. No brokerage order endpoint exists.

| Data | Provider | Scope |
|---|---|---|
| Quotes/trades/bars | Alpaca | One persistent IEX WebSocket. Every HOT symbol receives quotes and minute bars; spare Basic channel allowance adds trades. Valid positive uncrossed quotes are required. |
| Daily history/liquidity | Alpaca | SIP history ending at least 16 minutes ago, split-adjusted completed prior sessions; mean 20-session close × volume is a dollar-volume proxy. |
| Company identity | SEC | Official ticker map plus submissions ticker/CIK verification. |
| Financials | SEC | Reported domestic US-GAAP USD facts, actual quarter/YTD/year duration, exact-period revenue/income/cash-flow alignment. |
| Filings | SEC | Recent supported filings and original documents, accession and availability dates. |
| Headlines | Alpaca | One batched symbol request per slow refresh, headline/time/link; unavailable entitlement remains explicit. |
| Earnings | Alpha Vantage | One cached bulk calendar daily; expected dates, not confirmed company announcements. A missing row means unknown. |

Credentials in the engine's private environment: `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`; optional `ALPHA_VANTAGE_API_KEY`; optional `SEC_USER_AGENT` containing an actual contact email. Paper Alpaca account keys can read market data; no funded account is required for Basic IEX data. Alpha Vantage is used only for the earnings calendar. No LLM provider is needed.

## Normalization

`sec-observed-1.0.0` selects the latest reported revenue period, preferring the longest actual duration at that end so YTD cash flows can align. It compares a matching prior-year duration using the same concept. Ratios preserve each component's concept, period, unit, accession, filed date and original source link. Facts filed on the cutoff date are conservatively excluded without reliable intraday acceptance timing.

Net margin uses aligned net income/revenue. FCF subtracts reported nonnegative PP&E acquisition payments from aligned operating cash flow; absent capex is not zero. Debt/assets requires an explicit complete debt concept. Positive FCF has no invented infinite runway. Annual EPS is only displayed for actual annual periods and is not silently called TTM EPS. No YTD annualization or overlapping-quarter sum is performed. A failed fetch retains an old observation only with its old timestamps and stale coverage.

Coverage `current` means a successful retrieval within its cache TTL. It does not prove the financial period or market observation is recent. Separate timestamps govern use. The market gate requires a connected stream, an acknowledged quote subscription, a timely event and an open exchange before a state can be actionable. Cached closed-session prices are labeled distinctly. The browser ages data from its source timestamp even if no new snapshot arrives.

## What remains unavailable

Peer reference valuations, concentration, catalyst scores, validated uncertainty and specialist binary-event coverage are not supplied by these free feeds. Financial companies need dedicated regulatory/credit definitions. Live trade plans remain unavailable until the model has supported inputs or a separately versioned, validated model is introduced. MacroProvider remains an interface without a configured macro source. Demo backtests use fictional prices and do not validate the full live model.

## Limits

Standard HTTP requests use bounded retries/timeouts, Retry-After handling, singleflight deduplication and sanitized errors. Usage is tracked by provider and endpoint. Alpha Vantage reserves calls before requests, does not retry automatically and tracks up to 25 calls/day in persisted state. Normal failure consumes the reservation. Historical bars are cached by completed time range; SEC facts are invalidated when a new financial filing accession appears. Historical bars and SEC restatements fetched today are not an archived point-in-time backtest dataset.

Official references: [Alpaca access](https://docs.alpaca.markets/us/docs/about-market-data-api), [SIP historical cutoff](https://docs.alpaca.markets/us/docs/market-data-faq), [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [Alpha Vantage endpoints](https://www.alphavantage.co/documentation/), [free allowance](https://www.alphavantage.co/support/).
