# Optional machine-learning evidence

Waypoint's deterministic Opportunity Score, Risk Score, trade-state engine,
position sizing, freshness gates and manual execution rules remain authoritative.
The ML subsystem is an additional evidence source. It is disabled by default;
when enabled it starts in shadow mode and cannot create a trade plan.

The flow is:

`DATA → point-in-time features → deterministic opportunity/risk → ML prediction → conservative decision bridge → dashboard`

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

Training uses chronological walk-forward folds. It never randomly mixes future
rows into training. Evaluation reports Brier score, reliability bins, regime
breakdowns and mean net return after spread, slippage, FX cost and fees.

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

LightGBM, XGBoost and CatBoost availability is detected by `app/ml/tree.py`.
They are optional and never silently replace the baseline model family. Social
features are not part of V1.
