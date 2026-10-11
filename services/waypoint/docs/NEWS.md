# Daily news collection

Waypoint records news and filing observations separately from the deterministic
trade engine. The collector stores a fingerprint, symbol, provider, headline,
source URL, publication time, first-seen time, availability time, event class,
sentiment and importance. Existing rows are immutable, so a later refresh cannot
rewrite the evidence that was available to an earlier decision.

The independent worker refreshes the lane at startup and then every
`NEWS_COLLECTION_INTERVAL_MINUTES` (default 60). It is separate from the live
price/research refresh, so provider slowness cannot block streaming or
deterministic decisions. Sources are:

- Alpaca's ticker-filtered news endpoint when the market provider is configured;
- SEC filings already retrieved by the research refresh;
- Alpha Vantage `NEWS_SENTIMENT` when the key and plan permit the endpoint;
- GDELT's public discovery feed, enabled by `NEWS_GDELT_ENABLED=true`.

SEC is the primary-source tier. Alpaca and Alpha Vantage are verified-feed
observations when their providers return a ticker-mapped item. GDELT is
deliberately marked as discovery evidence: its issuer mapping is headline-token
based and it does not prove that the company issued the story. Every row carries
`source_tier` and `verified` so the UI and later models can keep those meanings
separate.
The dashboard can inspect the stored observations through the authenticated
`GET /api/news?symbol=AAPL&limit=100` endpoint.

The historical ML pipeline does not backfill this table into old snapshots.
Only an article with an availability timestamp before a snapshot can become a
historical feature. The current free Alpaca/GDELT collection therefore builds a
forward archive from the moment it is enabled; a complete five-year news
backtest still requires a licensed or otherwise point-in-time historical archive.
