# Optional machine-learning evidence

Waypoint's deterministic Opportunity Score, Risk Score, trade-state engine,
position sizing, freshness gates and manual execution rules remain authoritative.
The ML subsystem is an additional evidence source. It is disabled by default;
when enabled it starts in shadow mode and cannot create a trade plan.

The flow is:

`DATA → point-in-time features → deterministic opportunity/risk → ML prediction and historical projection → conservative decision bridge → dashboard`

## Runtime modes

Training is offline and manual. `POST /api/ml/train` reads the configured
point-in-time JSONL dataset, trains the dependency-light logistic and linear
baselines, and writes a new immutable version to `data/ml_registry.json`.
Pass `activate=true` only after inspecting the walk-forward evaluation from
`GET /api/ml/evaluate`. Registering a version never replaces an existing one.

Inference loads the explicitly active model in milliseconds. It never retrains
on a quote or dashboard request. With no model, the normal backend and dashboard
continue without ML fields.

Set these private engine values to opt in:

```text
ML_ENABLED=true
ML_SHADOW_MODE=true
ML_INFLUENCE_ENABLED=false
```

The first two settings are the recommended starting point. Influence should
remain false until completed shadow outcomes show improvement after costs.

## Point-in-time data and labels

`app/ml/features.py` filters timestamped history, fundamentals, events and news
to the requested `as_of` time. `app/ml/datasets.py` rejects provenance entries
newer than that timestamp. `build_labeled_dataset` accepts future bars only for
labels, never for features.

Labels include 1/5/10/20-day returns, maximum upside and drawdown for 5/10/20
days, and the 20-day barrier outcome `TARGET_FIRST`, `RECONSIDER_FIRST`, or
`NEITHER`. If both barriers are touched in one OHLC bar, the outcome is treated
as `NEITHER` because the intrabar order is unknowable. Direction labels are
cost-aware: a 5-day move is `POSITIVE` only after the configured round-trip
spread, slippage and FX cost plus a small neutral band; tiny moves are
`NEUTRAL` and are excluded from probability scoring. Raw and net returns remain
available for expected-value and transaction-cost reporting.

To build the first real dataset, run the job from the backend virtualenv after
Alpaca is connected:

```text
python -m app.ml.ingest --symbols AAPL,MSFT --years 5 --stride-days 5
```

It fetches daily bars, creates one snapshot every configured stride, leaves a
60-session tail for forward labels, and replaces the JSONL file atomically. The
same operation is available to an authenticated operator as `POST /api/ml/ingest`.
No current quote is used to backfill an earlier snapshot.

Alpaca's free history may stop at its account/feed boundary. For an offline
research-only extension, the explicit Yahoo chart importer can build a longer
candidate file; it is never used for live quotes:

```text
python -m app.ml.yahoo_ingest --symbols AAPL,MSFT --years 10 --stride-days 5 --output data/ml_snapshots.yahoo.jsonl
python -m app.ml.enrich data/ml_snapshots.yahoo.jsonl --archive-glob 'codex_research_*.jsonl'
python -m app.ml.merge --preferred data/ml_snapshots.jsonl --supplemental data/ml_snapshots.yahoo.jsonl --output data/ml_snapshots.merged.jsonl
```

Validate the longer file with `GET /api/ml/evaluate` or the Engine Performance
page before making it the training source. The importer records its source in
the snapshot metadata so the two feeds are not silently mixed.

The live engine evaluates every symbol in `LIVE_SYMBOLS` plus the optional
`SCAN_SYMBOLS` universe during startup, pre-market refresh and scheduled scans.
It ranks the resulting deterministic setups, then uses the historical analogue
and ML evidence as additional context. Free feeds cannot cheaply and reliably
scan every listed US stock, so a curated 10–20 symbol universe is the safe V1;
the universe can be expanded after request budgets and data freshness are
observed.

## Historical projection mapping

`app/ml/projections.py` is a separate evidence module. It standardizes the
current point-in-time feature snapshot, ranks weighted nearest historical cases,
and maps their normalized forward paths to 1, 5, 10, 20 and 60 trading-day
outcome ranges. The dashboard uses the 10-day view when available and shows the
10th/25th/50th/75th/90th percentiles, weak/typical/strong ranges, positive and
barrier rates, analogue quality, and a few inspectable cases. Groups are kept
separate for same-stock, peer and broad-market comparisons; same-regime matches
are compared with all-history matches and materially different outcomes lower
confidence.

Projection mapping only reads labelled snapshots whose provenance is available
before the snapshot timestamp. It never uses future prices or revised data to
construct features, and it returns no projection until labelled historical
rows exist. The dashboard wording is deliberately “historical outcome range”:
these are distributions of comparable past outcomes, not guaranteed prices or
confidence intervals. The deterministic trade plan and risk controls remain
authoritative.

Training uses six expanding chronological walk-forward folds by default. It
never randomly mixes future rows into training, and each fold has separate
fit, calibration and validation periods with a purge before validation.
Evaluation reports Brier score, weighted calibration error, reliability bins,
symbol and regime macro scores, Brier decomposition, signal breadth, feature
coverage, and mean net return after spread, slippage, FX cost and fees. Brier
decomposition separates three things: reliability (probabilities matching
outcomes), resolution (the model separating better and worse situations), and
uncertainty (the base-rate floor that no model can remove). A candidate must improve both
the overall and macro symbol/regime baselines before it can influence
decisions. The promotion check uses a fixed 55% policy threshold; it does not
pick the most profitable cutoff after inspecting the same validation returns.

The optional `auto_probability_shrinkage` setting can select a conservative
probability blend on each fold's calibration holdout. It is disabled by default:
on the current merged history, fixed shrinkage is more stable out of sample. This
is deliberate; a lower calibration error on the holdout is not enough to claim a
better Brier score on unseen dates.

Coverage inputs are explicit features: price-history depth, volume coverage,
fundamental coverage, news availability, event availability and market-context
availability. Missing data is visible to the model instead of being silently
treated as neutral evidence.

The dataset builder can add same-day comparative features without look-ahead:
sector-relative momentum, cross-sectional return/volume/volatility ranks,
valuation percentile, same-regime momentum, and smoothed historical positive
rates for the symbol, sector and regime. Historical rates use only earlier
labelled dates. The evaluator also reports a hierarchical-prior challenger as a
diagnostic between the global prevalence baseline and a feature model; it is not
automatically promoted.

### Historical news coverage

The ingestion job has an optional, deterministic news feature lane. It stores
headline timestamp, simple keyword sentiment, novelty and importance only when
the headline was published inside the seven-day window ending at the snapshot;
`features.py` applies the same timestamp filter again when materializing the
vector. No current headline is copied backward into history. The free Alpaca
news endpoint is a bounded recent feed rather than a complete five-year archive,
so missing coverage remains neutral and should reduce confidence. A complete
point-in-time news backtest requires an archive with historical availability
timestamps; the current feed is not enough to claim that result.

For a local historical rebuild, the dated research archive can be merged after
ingestion without changing any timestamp:

```powershell
python -m app.ml.enrich data/ml_snapshots.jsonl --archive-glob 'codex_research_*.jsonl'
```

The enrichment job only uses records whose `available_at` is before the
snapshot. It marks the archive as partial, preserves source URLs in
provenance, and never treats an absent article as proof that no news existed.
The trainer also compares an `all` profile with a `price_volume` profile; the
latter remains usable when fundamentals or news coverage are sparse.

The live worker now keeps a separate SEC archive in
`fundamental_observations`. It stores the raw fact, accession, reporting
period, filing date and a conservative next-day `available_at` timestamp, so
historical research can be rebuilt from the database rather than depending on
the current dashboard cache. SEC filing events are also written to
`news_articles` as primary evidence. GDELT collection is enabled by default as
a discovery-only lane with explicit start/end times; it never becomes verified
issuer evidence and cannot change the deterministic decision by itself.

Codex can also curate historical articles and primary announcements, but web
research is not a complete or continuously running news feed. Save reviewed
records as JSONL and import them explicitly:

```powershell
python -m app.codex_research --input data/codex_research.jsonl
```

Each record must include `symbol`, `title`, `url`, and `published_at`. Supply
`available_at` when the source provides a reliable earliest-known timestamp.
Imported records are labelled `provider=codex`, `source_tier=research`, and
remain unverified until reviewed. They must not enter point-in-time training
unless `available_at` is no later than the snapshot timestamp.

### Tree challengers

`app/ml/tree.py` contains an offline XGBoost challenger. It uses the same
chronological folds, labels and transaction-cost assumptions as the baseline,
then calibrates probabilities on each training fold. XGBoost is intentionally
not installed in the always-on runtime image: its optional dependency is large
and a challenger should not silently change production behavior. A challenger
must beat the prevalence Brier baseline, produce enough selected cases, stay
within the calibration-error limit, and show positive net return after costs
before it can even be considered for the existing promotion gate. Until then
the deterministic engine and the current registered baseline remain the only
decision inputs.

## Explainability and monitoring

The dashboard only shows a compact model outlook: positive-return probability,
target/reconsider probabilities, expected return and confidence. The detail
view translates the largest linear contributions into plain-language “likes”
and “cautions”. Similar historical setups are nearest neighbours in the
standardized feature space and are explanatory only.

`GET /api/ml/drift` checks recent feature-distribution shift. A material shift
reduces ML confidence. Shadow predictions are persisted separately from the
trade ledger; `POST /api/ml/outcome` settles a prediction after its holding
window so deterministic-only and ML-filtered results can be compared.

Set `ML_MAINTENANCE_ENABLED=true` to let the persistent scheduler periodically
evaluate the dataset and train an immutable candidate. It records the
walk-forward report and candidate version but never activates it. The manual
`POST /api/ml/maintenance` endpoint is useful for an explicit run; activation
still requires `POST /api/ml/train?activate=true` after review.

LightGBM, XGBoost and CatBoost availability is detected by `app/ml/tree.py`.
They are optional and never silently replace the baseline model family. Social
features are not part of V1.
