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
as `NEITHER` because the intrabar order is unknowable.

To build the first real dataset, run the job from the backend virtualenv after
Alpaca is connected:

```text
python -m app.ml.ingest --symbols AAPL,MSFT --years 5 --stride-days 5
```

It fetches daily bars, creates one snapshot every configured stride, leaves a
60-session tail for forward labels, and replaces the JSONL file atomically. The
same operation is available to an authenticated operator as `POST /api/ml/ingest`.
No current quote is used to backfill an earlier snapshot.

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

Training uses chronological walk-forward folds. It never randomly mixes future
rows into training, and each fold purges the forward-label window before
validation begins. Evaluation reports Brier score, reliability bins, maximum
calibration error, regime and symbol breakdowns, feature coverage, and mean net
return after spread, slippage, FX cost and fees.

Coverage inputs are explicit features: price-history depth, volume coverage,
fundamental coverage, news availability, event availability and market-context
availability. Missing data is visible to the model instead of being silently
treated as neutral evidence.

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

The live worker now keeps a separate SEC archive in
`fundamental_observations`. It stores the raw fact, accession, reporting
period, filing date and a conservative next-day `available_at` timestamp, so
historical research can be rebuilt from the database rather than depending on
the current dashboard cache. SEC filing events are also written to
`news_articles` as primary evidence. GDELT collection is enabled by default as
a discovery-only lane with explicit start/end times; it never becomes verified
issuer evidence and cannot change the deterministic decision by itself.

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
