# Daily news collection

Waypoint records news and filing observations separately from the deterministic
trade engine. The collector stores a fingerprint, symbol, provider, headline,
source URL, publication time, first-seen time, availability time, event class,
sentiment and importance. Existing rows are immutable, so a later refresh cannot
rewrite the evidence that was available to an earlier decision.

The live worker refreshes the lane during startup, pre-market, the morning scan
and scheduled market scans. Sources are:

- Alpaca's ticker-filtered news endpoint when the market provider is configured;
- SEC filings already retrieved by the research refresh;
- Alpha Vantage `NEWS_SENTIMENT` when the key and plan permit the endpoint;
- GDELT's public discovery feed, enabled by `NEWS_GDELT_ENABLED=true`.

GDELT is deliberately marked as discovery evidence. Its issuer mapping is
headline-token based and it does not prove that the company issued the story.
The dashboard can inspect the stored observations through the authenticated
`GET /api/news?symbol=AAPL&limit=100` endpoint.

The historical ML pipeline does not backfill this table into old snapshots.
Only an article with an availability timestamp before a snapshot can become a
historical feature. The current free Alpaca/GDELT collection therefore builds a
forward archive from the moment it is enabled; a complete five-year news
backtest still requires a licensed or otherwise point-in-time historical archive.
