"""Chronological walk-forward evaluation with execution friction."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import numpy as np

from .calibration import brier_decomposition, brier_score, reliability_curve
from .datasets import PointInTimeSnapshot
from .predict import predict_with_model
from .train import train


def _binary_outcome(actual: dict[str, Any]) -> int | None:
    """Return the cost-aware binary outcome; neutral moves are excluded."""
    direction = actual.get("direction_5d")
    if direction is not None:
        normalized = str(direction).upper()
        if normalized == "POSITIVE":
            return 1
        if normalized == "NEGATIVE":
            return 0
        return None
    value = actual.get("return_5d")
    return int(float(value) > 0.007) if value is not None else None


@dataclass(frozen=True)
class Friction:
    spread_bps: float = 10.0
    slippage_bps: float = 10.0
    fx_cost_bps: float = 15.0
    fees_bps: float = 0.0
    minimum_position_eur: float = 1.0

    @property
    def round_trip(self) -> float:
        return 2 * (self.spread_bps + self.slippage_bps + self.fx_cost_bps + self.fees_bps) / 10000


def promotion_gate(metrics: dict[str, Any], *, minimum_selected: int = 100,
                   minimum_symbols: int = 5, minimum_regimes: int = 2,
                   selection_threshold: float = 0.55) -> dict[str, Any]:
    """Decide whether a candidate has earned the right to influence decisions.

    The gate is intentionally conservative: a candidate must beat the
    prevalence-only probability baseline and have positive net return on a
    sufficiently large selected sample after configured friction.
    """
    baseline = metrics.get("baseline_brier_score_5d")
    brier = metrics.get("brier_score_5d")
    thresholds = metrics.get("signal_thresholds_5d") or {}
    # The threshold is a policy choice, not something selected after looking
    # at the same validation returns. Otherwise the gate would overfit the
    # walk-forward report by choosing whichever cutoff got lucky.
    selected_key = str(selection_threshold)
    selected_threshold = selected_key
    selected = thresholds.get(selected_key, {})
    count = int(selected.get("count") or 0)
    selected_return = selected.get("mean_net_return_5d")
    selected_symbols = int(selected.get("unique_symbols") or 0)
    selected_regimes = int(selected.get("unique_regimes") or 0)
    calibration_gap = metrics.get("calibration_gap_5d")
    macro_symbol_brier = metrics.get("macro_symbol_brier_score_5d")
    macro_symbol_baseline = metrics.get("macro_symbol_baseline_brier_score_5d")
    macro_regime_brier = metrics.get("macro_regime_brier_score_5d")
    macro_regime_baseline = metrics.get("macro_regime_baseline_brier_score_5d")
    reasons: list[str] = []
    if baseline is None or brier is None or float(brier) >= float(baseline):
        reasons.append("probability calibration does not beat the prevalence baseline")
    if (macro_symbol_brier is not None and macro_symbol_baseline is not None
            and float(macro_symbol_brier) >= float(macro_symbol_baseline)):
        reasons.append("calibration does not improve consistently across symbols")
    if (macro_regime_brier is not None and macro_regime_baseline is not None
            and float(macro_regime_brier) >= float(macro_regime_baseline)):
        reasons.append("calibration does not improve consistently across market regimes")
    if count < minimum_selected:
        reasons.append(f"fewer than {minimum_selected} selected out-of-sample cases")
    if selected_symbols < minimum_symbols:
        reasons.append(f"selected cases span fewer than {minimum_symbols} symbols")
    if selected_regimes < minimum_regimes:
        reasons.append(f"selected cases span fewer than {minimum_regimes} market regimes")
    if selected_return is None or float(selected_return) <= 0:
        reasons.append("selected signals are not positive after configured costs")
    if calibration_gap is not None and float(calibration_gap) > 0.10:
        reasons.append("probabilities remain materially miscalibrated")
    return {"eligible": not reasons, "reasons": reasons, "minimum_selected": minimum_selected,
            "minimum_symbols": minimum_symbols, "minimum_regimes": minimum_regimes,
            "selected_threshold": float(selected_threshold), "selected_count": count, "selected_mean_net_return_5d": selected_return,
            "calibration_gap_5d": calibration_gap,
            "macro_symbol_brier_score_5d": macro_symbol_brier,
            "macro_regime_brier_score_5d": macro_regime_brier,
            "brier_score_5d": brier, "baseline_brier_score_5d": baseline}


def _folds(rows: list[PointInTimeSnapshot], minimum_train: int = 8, purge_days: int = 5,
           fold_count: int = 6) -> list[tuple[list[PointInTimeSnapshot], list[PointInTimeSnapshot]]]:
    ordered = sorted(rows, key=lambda row: row.as_of)
    # Do not create a nearly empty first training fold merely because the
    # dataset is large. The first validation period should be preceded by a
    # meaningful historical sample; small unit-test datasets still use the
    # explicit minimum below.
    effective_minimum = max(minimum_train, len(ordered) // (max(2, fold_count) + 1))
    if len(ordered) < effective_minimum + 1:
        return []
    step = max(1, len(ordered) // max(2, fold_count))
    folds = []
    for cut in range(effective_minimum, len(ordered), step):
        if cut >= len(ordered):
            continue
        cutoff = ordered[cut - 1].as_of
        try:
            from datetime import datetime, timedelta
            boundary = datetime.fromisoformat(cutoff.replace("Z", "+00:00")) + timedelta(days=purge_days)
            valid_start = next((index for index in range(cut, len(ordered))
                                if datetime.fromisoformat(ordered[index].as_of.replace("Z", "+00:00")) >= boundary), cut)
        except (TypeError, ValueError):
            valid_start = cut
        if valid_start < len(ordered):
            folds.append((ordered[:cut], ordered[valid_start:min(len(ordered), valid_start + step)]))
    return folds


def _calibration_split(rows: list[PointInTimeSnapshot], *, fraction: float = 0.20,
                       purge_days: int = 5) -> tuple[list[PointInTimeSnapshot], list[PointInTimeSnapshot]]:
    """Split a training fold into fit and later calibration observations.

    Platt calibration is itself a learned model. Fitting it on the same rows
    as the classifier makes the reported probabilities look better than they
    perform in the future. The final slice is therefore held out in time,
    with a small purge gap because labels contain forward returns.
    """
    ordered = sorted(rows, key=lambda row: row.as_of)
    if len(ordered) < 40:
        return ordered, []
    calibration_count = max(30, int(len(ordered) * fraction))
    cut = max(8, len(ordered) - calibration_count)
    calibration_rows = ordered[cut:]
    try:
        calibration_start = datetime.fromisoformat(calibration_rows[0].as_of.replace("Z", "+00:00"))
        boundary = calibration_start - timedelta(days=purge_days)
        fit_rows = [row for row in ordered[:cut]
                    if datetime.fromisoformat(row.as_of.replace("Z", "+00:00")) < boundary]
    except (TypeError, ValueError):
        fit_rows = ordered[:cut]
    if len(fit_rows) < 8:
        fit_rows = ordered[:cut]
    return fit_rows, calibration_rows


def walk_forward(rows: list[PointInTimeSnapshot], *, friction: Friction | None = None,
                 train_kwargs: dict[str, Any] | None = None) -> dict[str, Any]:
    friction = friction or Friction()
    train_kwargs = train_kwargs or {}
    predictions: list[dict[str, Any]] = []
    fold_summary: list[dict[str, Any]] = []
    for training_rows, validation_rows in _folds(rows):
        fit_rows, calibration_rows = _calibration_split(training_rows)
        model_kwargs = dict(train_kwargs)
        model_kwargs.setdefault("calibration_rows", calibration_rows)
        model = train(fit_rows, **model_kwargs)
        fold_summary.append({"fit_start": fit_rows[0].as_of if fit_rows else None,
                             "fit_end": fit_rows[-1].as_of if fit_rows else None,
                             "calibration_start": calibration_rows[0].as_of if calibration_rows else None,
                             "calibration_end": calibration_rows[-1].as_of if calibration_rows else None,
                             "validation_start": validation_rows[0].as_of if validation_rows else None,
                             "validation_end": validation_rows[-1].as_of if validation_rows else None,
                             "fit_rows": len(fit_rows), "calibration_rows": len(calibration_rows),
                             "validation_rows": len(validation_rows)})
        predictions.extend([{**predict_with_model(model, row), "actual": row.labels, "regime": row.regime, "symbol": row.symbol, "as_of": row.as_of}
                            for row in validation_rows if row.labels])
    probabilities, outcomes = [], []
    net_returns = []
    by_regime: dict[str, list[dict[str, Any]]] = {}
    for item in predictions:
        actual = item.get("actual") or {}
        outcome = _binary_outcome(actual)
        if actual.get("return_5d") is not None and outcome is not None:
            probabilities.append(item.get("probability_positive_5d", 0.5))
            outcomes.append(outcome)
            net_returns.append(float(actual["return_5d"]) - friction.round_trip)
        by_regime.setdefault(item.get("regime", "unknown"), []).append(item)
    baseline_probability = float(np.mean(outcomes)) if outcomes else None
    baseline_brier = ((baseline_probability - 1) ** 2 * sum(outcomes) + baseline_probability ** 2 * (len(outcomes) - sum(outcomes))) / len(outcomes) if outcomes and baseline_probability is not None else None
    signal_thresholds: dict[str, dict[str, Any]] = {}
    # Keep the original decision thresholds, but expose a wider diagnostic
    # grid. A small selected sample often means the threshold is simply too
    # extreme; the promotion gate still requires a sufficiently large,
    # positive, out-of-sample sample before ML can influence decisions.
    for threshold in (0.50, 0.52, 0.55, 0.58, 0.60, 0.65):
        selected = [item for item in predictions
                    if item.get("probability_positive_5d") is not None
                    and float(item["probability_positive_5d"]) >= threshold
                    and item.get("actual", {}).get("return_5d") is not None
                    and _binary_outcome(item.get("actual", {})) is not None]
        selected_returns = [float(item["actual"]["return_5d"]) - friction.round_trip for item in selected]
        signal_thresholds[str(threshold)] = {
            "count": len(selected),
            "selection_rate": len(selected) / len(predictions) if predictions else 0.0,
            "unique_symbols": len({item.get("symbol") for item in selected}),
            "unique_regimes": len({item.get("regime") for item in selected}),
            "win_rate": sum(_binary_outcome(item["actual"]) or 0 for item in selected) / len(selected) if selected else None,
            "mean_net_return_5d": float(np.mean(selected_returns)) if selected_returns else None,
        }
    ranked_buckets: dict[str, dict[str, Any]] = {}
    ranked = [item for item in predictions if item.get("probability_positive_5d") is not None
              and item.get("actual", {}).get("return_5d") is not None
              and _binary_outcome(item.get("actual", {})) is not None]
    ranked.sort(key=lambda item: float(item["probability_positive_5d"]), reverse=True)
    for fraction in (0.01, 0.05, 0.10, 0.20):
        count = max(1, int(len(ranked) * fraction)) if ranked else 0
        selected = ranked[:count]
        returns = [float(item["actual"]["return_5d"]) - friction.round_trip for item in selected]
        ranked_buckets[str(fraction)] = {
            "count": count,
            "selection_rate": count / len(ranked) if ranked else 0.0,
            "threshold_probability": float(selected[-1]["probability_positive_5d"]) if selected else None,
            "win_rate": float(np.mean([_binary_outcome(item["actual"]) for item in selected])) if selected else None,
            "mean_net_return_5d": float(np.mean(returns)) if returns else None,
        }
    regime_metrics = {regime: {"count": len(values), "mean_net_return_5d": float(np.mean([
        float(item.get("actual", {}).get("return_5d", 0)) - friction.round_trip for item in values
    ])) if values else 0.0} for regime, values in by_regime.items()}
    by_symbol: dict[str, dict[str, Any]] = {}
    for symbol in sorted({item.get("symbol", "unknown") for item in predictions}):
        values = [item for item in predictions if item.get("symbol") == symbol and item.get("actual", {}).get("return_5d") is not None]
        by_symbol[symbol] = {"count": len(values), "mean_net_return_5d": float(np.mean([
            float(item["actual"]["return_5d"]) - friction.round_trip for item in values
        ])) if values else None,
                             "win_rate": float(np.mean([float(item["actual"]["return_5d"]) > 0 for item in values])) if values else None}
    def grouped_probability_metrics(key: str) -> dict[str, Any]:
        grouped: dict[str, list[tuple[float, int]]] = {}
        for item in predictions:
            actual = item.get("actual", {})
            if item.get("probability_positive_5d") is None or actual.get("return_5d") is None:
                continue
            if _binary_outcome(actual) is None:
                continue
            group = str(item.get(key) or "unknown")
            grouped.setdefault(group, []).append((float(item["probability_positive_5d"]),
                                                   _binary_outcome(actual)))
        result: dict[str, Any] = {}
        for group, values in grouped.items():
            probs = [value[0] for value in values]
            outcomes_group = [value[1] for value in values]
            prior_group = float(np.mean(outcomes_group)) if outcomes_group else None
            result[group] = {
                "count": len(values),
                "brier_score_5d": brier_score(probs, outcomes_group),
                "baseline_brier_score_5d": ((prior_group - 1) ** 2 * sum(outcomes_group) +
                                             prior_group ** 2 * (len(outcomes_group) - sum(outcomes_group))) / len(outcomes_group)
                if outcomes_group and prior_group is not None else None,
            }
        return result
    by_symbol_probability = grouped_probability_metrics("symbol")
    by_regime_probability = grouped_probability_metrics("regime")
    macro_symbol_brier = float(np.mean([item["brier_score_5d"] for item in by_symbol_probability.values()])) if by_symbol_probability else None
    macro_regime_brier = float(np.mean([item["brier_score_5d"] for item in by_regime_probability.values()])) if by_regime_probability else None
    macro_symbol_baseline = float(np.mean([item["baseline_brier_score_5d"] for item in by_symbol_probability.values()])) if by_symbol_probability else None
    macro_regime_baseline = float(np.mean([item["baseline_brier_score_5d"] for item in by_regime_probability.values()])) if by_regime_probability else None
    reliability = [item.__dict__ for item in reliability_curve(probabilities, outcomes)]
    # Ignore tiny bins when reporting the worst gap, while also exposing a
    # weighted error over every prediction. This prevents one or two examples
    # from making the dashboard look worse than the full calibration picture.
    calibration_gaps = [abs(item["mean_probability"] - item["observed_rate"])
                        for item in reliability if item["count"] >= 50]
    total_reliability = sum(item["count"] for item in reliability)
    expected_calibration_error = (sum(item["count"] * abs(item["mean_probability"] - item["observed_rate"])
                                   for item in reliability) / total_reliability) if total_reliability else None
    decomposition = brier_decomposition(probabilities, outcomes)
    return {"method": "chronological_walk_forward", "folds": len(_folds(rows)), "fold_summary": fold_summary,
            "predictions": predictions,
            "training": train_kwargs,
            "metrics": {"brier_score_5d": brier_score(probabilities, outcomes),
                        "overall_mean_net_return_5d": float(np.mean(net_returns)) if net_returns else None,
                        "baseline_probability_5d": baseline_probability,
                        "baseline_brier_score_5d": baseline_brier,
                        "signal_thresholds_5d": signal_thresholds,
                        "ranked_signal_buckets_5d": ranked_buckets,
                        "friction": friction.__dict__, "reliability_5d": reliability,
                        "calibration_gap_5d": max(calibration_gaps, default=None),
                        "expected_calibration_error_5d": expected_calibration_error,
                        "brier_decomposition_5d": decomposition,
                        "by_regime": regime_metrics, "by_symbol": by_symbol,
                        "probability_by_symbol": by_symbol_probability,
                        "probability_by_regime": by_regime_probability,
                        "macro_symbol_brier_score_5d": macro_symbol_brier,
                        "macro_symbol_baseline_brier_score_5d": macro_symbol_baseline,
                        "macro_regime_brier_score_5d": macro_regime_brier,
                        "macro_regime_baseline_brier_score_5d": macro_regime_baseline,
            "feature_coverage": _coverage(rows)}}


def walk_forward_hierarchical_prior(rows: list[PointInTimeSnapshot], *, friction: Friction | None = None,
                                    shrinkage: float = 0.0, symbol_weight: float = 0.50,
                                    sector_weight: float = 0.25, regime_weight: float = 0.15,
                                    global_weight: float = 0.10) -> dict[str, Any]:
    """Evaluate a leakage-safe symbol/sector/regime prior challenger.

    This is a useful diagnostic between a global prevalence baseline and a
    feature model. Counts for each validation row come only from earlier fold
    training rows, with Laplace smoothing for unseen groups.
    """
    friction = friction or Friction()
    predictions: list[dict[str, Any]] = []

    def rate(values: list[int], fallback: float) -> float:
        return (sum(values) + 1) / (len(values) + 2) if values else fallback

    for training_rows, validation_rows in _folds(rows):
        grouped: dict[str, dict[str, list[int]]] = {"symbol": {}, "sector": {}, "regime": {}}
        outcomes = [_binary_outcome(row.labels or {}) for row in training_rows]
        valid_training = [(row, outcome) for row, outcome in zip(training_rows, outcomes, strict=True) if outcome is not None]
        global_rate = rate([outcome for _, outcome in valid_training], 0.5)
        for row, outcome in valid_training:
            sector = row.sector or "unknown"
            for group, key in (("symbol", row.symbol), ("sector", sector), ("regime", row.regime)):
                grouped[group].setdefault(key, []).append(outcome)
        for row in validation_rows:
            symbol_rate = rate(grouped["symbol"].get(row.symbol, []), global_rate)
            sector_rate = rate(grouped["sector"].get(row.sector or "unknown", []), global_rate)
            regime_rate = rate(grouped["regime"].get(row.regime, []), global_rate)
            total_weight = max(1e-9, symbol_weight + sector_weight + regime_weight + global_weight)
            raw_probability = (symbol_weight * symbol_rate + sector_weight * sector_rate
                               + regime_weight * regime_rate + global_weight * global_rate) / total_weight
            probability = global_rate + (raw_probability - global_rate) * (1.0 - max(0.0, min(1.0, shrinkage)))
            predictions.append({"probability": probability, "actual": row.labels or {},
                                "symbol": row.symbol, "regime": row.regime})
    scored = [(item["probability"], _binary_outcome(item["actual"]), item) for item in predictions]
    scored = [(probability, outcome, item) for probability, outcome, item in scored if outcome is not None]
    probabilities = [item[0] for item in scored]
    outcomes = [item[1] for item in scored]
    baseline = float(np.mean(outcomes)) if outcomes else None
    baseline_brier = brier_score([baseline] * len(outcomes), outcomes) if outcomes and baseline is not None else None
    by_symbol: dict[str, list[tuple[float, int]]] = {}
    by_regime: dict[str, list[tuple[float, int]]] = {}
    for probability, outcome, item in scored:
        by_symbol.setdefault(item["symbol"], []).append((probability, outcome))
        by_regime.setdefault(item["regime"], []).append((probability, outcome))
    def grouped(values: dict[str, list[tuple[float, int]]]) -> tuple[float | None, float | None]:
        if not values:
            return None, None
        scores = [brier_score([probability for probability, _ in group], [outcome for _, outcome in group])
                  for group in values.values()]
        baselines = []
        for group in values.values():
            prior = float(np.mean([outcome for _, outcome in group]))
            baselines.append(brier_score([prior] * len(group), [outcome for _, outcome in group]))
        return float(np.mean(scores)), float(np.mean(baselines))
    macro_symbol, macro_symbol_baseline = grouped(by_symbol)
    macro_regime, macro_regime_baseline = grouped(by_regime)
    selected = [(probability, outcome, item) for probability, outcome, item in scored if probability >= 0.55]
    selected_returns = [float(item["actual"].get("return_5d", 0.0)) - friction.round_trip for _, _, item in selected]
    return {"method": "chronological_hierarchical_prior", "folds": len(_folds(rows)),
            "predictions": len(predictions), "metrics": {
                "brier_score_5d": brier_score(probabilities, outcomes) if outcomes else None,
                "baseline_brier_score_5d": baseline_brier,
                "baseline_probability_5d": baseline,
                "brier_decomposition_5d": brier_decomposition(probabilities, outcomes),
                "macro_symbol_brier_score_5d": macro_symbol,
                "macro_symbol_baseline_brier_score_5d": macro_symbol_baseline,
                "macro_regime_brier_score_5d": macro_regime,
                "macro_regime_baseline_brier_score_5d": macro_regime_baseline,
                "signal_thresholds_5d": {"0.55": {
                    "count": len(selected), "unique_symbols": len({item["symbol"] for _, _, item in selected}),
                    "unique_regimes": len({item["regime"] for _, _, item in selected}),
                    "win_rate": float(np.mean([outcome for _, outcome, _ in selected])) if selected else None,
                    "mean_net_return_5d": float(np.mean(selected_returns)) if selected_returns else None}},
                "friction": friction.__dict__}}


def _coverage(rows: list[PointInTimeSnapshot]) -> dict[str, float]:
    """Average explicit coverage inputs, keeping data quality measurable."""
    names = ("history_coverage", "volume_coverage", "fundamental_coverage",
             "news_coverage", "event_coverage", "market_context_coverage")
    return {name: float(np.mean([float(row.features.get(name, 0.0)) for row in rows])) if rows else 0.0 for name in names}
