"""Small tabular baselines used for offline training.

The implementation is dependency-light and serializable. A future optional
tree model can implement the same ``fit``/``predict`` contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np

from .calibration import choose_shrinkage, fit_platt
from .datasets import PointInTimeSnapshot, dataset_version
from .features import FEATURE_NAMES


TARGETS = (
    "return_5d", "return_10d", "return_20d", "max_upside_5d", "max_drawdown_5d",
    "max_upside_10d", "max_drawdown_10d", "max_upside_20d", "max_drawdown_20d",
    "barrier_outcome_20d",
)

PRICE_VOLUME_FEATURES = (
    "return_1d", "return_5d", "return_20d", "volatility_20d", "relative_volume",
    "gap_pct", "distance_from_high_20d", "distance_from_low_20d", "trend_slope_20d",
    "market_return_20d", "sector_return_20d", "market_volatility_20d", "rate_environment",
    "regime_bull", "regime_bear", "regime_high_vol", "regime_risk_on", "history_coverage",
    "volume_coverage", "market_context_coverage",
    "sector_relative_return_20d", "peer_return_20d", "same_regime_return_20d",
    "return_5d_rank", "return_20d_rank", "relative_volume_rank", "volatility_rank",
    "valuation_percentile", "same_regime_momentum_rank", "cross_section_coverage",
    "symbol_historical_positive_rate_5d", "sector_historical_positive_rate_5d",
    "regime_historical_positive_rate_5d",
)
FEATURE_PROFILES = {"all": FEATURE_NAMES, "price_volume": PRICE_VOLUME_FEATURES}


def _matrix(rows: list[PointInTimeSnapshot], names: tuple[str, ...] = FEATURE_NAMES) -> np.ndarray:
    return np.asarray([[float(row.features.get(name, 0.0)) for name in names] for row in rows], dtype=float)


def _scale(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = matrix.mean(axis=0) if len(matrix) else np.zeros(matrix.shape[1] if matrix.ndim == 2 else len(FEATURE_NAMES))
    scale = matrix.std(axis=0) if len(matrix) else np.ones(matrix.shape[1] if matrix.ndim == 2 else len(FEATURE_NAMES))
    scale = np.where(scale < 1e-9, 1.0, scale)
    return (matrix - mean) / scale, mean, scale


def _label(row: PointInTimeSnapshot, target: str) -> float | None:
    if not row.labels:
        return None
    if target == "probability_positive_5d":
        direction = row.labels.get("direction_5d")
        if direction is not None:
            return {"POSITIVE": 1.0, "NEGATIVE": 0.0}.get(str(direction).upper())
        value = row.labels.get("return_5d")
        return float(value > 0.007) if value is not None else None
    if target == "probability_positive_10d":
        direction = row.labels.get("direction_10d")
        if direction is not None:
            return {"POSITIVE": 1.0, "NEGATIVE": 0.0}.get(str(direction).upper())
        value = row.labels.get("return_10d")
        return float(value > 0.007) if value is not None else None
    if target == "probability_positive_20d":
        direction = row.labels.get("direction_20d")
        if direction is not None:
            return {"POSITIVE": 1.0, "NEGATIVE": 0.0}.get(str(direction).upper())
        value = row.labels.get("return_20d")
        return float(value > 0.007) if value is not None else None
    if target.startswith("probability_"):
        outcome = row.labels.get("barrier_outcome_20d")
        return float(outcome == target.removeprefix("probability_").replace("_", "_").upper()) if outcome else None
    aliases = {
        "expected_return_5d": "return_5d", "expected_return_10d": "return_10d", "expected_return_20d": "return_20d",
        "expected_max_upside": "max_upside_20d", "expected_max_drawdown": "max_drawdown_20d",
    }
    target = aliases.get(target, target)
    value = row.labels.get(target)
    return float(value) if value is not None else None


def _logistic_fit(x: np.ndarray, y: np.ndarray, steps: int = 700, learning_rate: float = 0.08,
                  l2: float = 0.05, sample_weights: np.ndarray | None = None) -> tuple[np.ndarray, float]:
    weights = np.zeros(x.shape[1])
    bias = 0.0
    importance = np.ones(len(y)) if sample_weights is None else np.asarray(sample_weights, dtype=float)
    denominator = max(1e-9, float(np.sum(importance)))
    for _ in range(steps):
        scores = np.clip(x @ weights + bias, -30, 30)
        predictions = 1 / (1 + np.exp(-scores))
        residual = importance * (predictions - y)
        gradient = (x.T @ residual) / denominator
        weights -= learning_rate * (gradient + l2 * weights)
        bias -= learning_rate * float(np.sum(residual) / denominator)
    return weights, bias


def _linear_fit(x: np.ndarray, y: np.ndarray, ridge: float = 1e-3,
                sample_weights: np.ndarray | None = None) -> tuple[np.ndarray, float]:
    augmented = np.column_stack([x, np.ones(len(x))])
    if sample_weights is not None:
        root = np.sqrt(np.asarray(sample_weights, dtype=float))[:, None]
        augmented = augmented * root
        y = y * root[:, 0]
    penalty = np.eye(augmented.shape[1]) * ridge
    penalty[-1, -1] = 0
    coefficients = np.linalg.solve(augmented.T @ augmented + penalty, augmented.T @ y)
    return coefficients[:-1], float(coefficients[-1])


def _group_weights(rows: list[PointInTimeSnapshot]) -> np.ndarray:
    """Give each symbol and market regime comparable influence during fitting."""
    if not rows:
        return np.ones(0)
    symbol_counts: dict[str, int] = {}
    regime_counts: dict[str, int] = {}
    for row in rows:
        symbol_counts[row.symbol] = symbol_counts.get(row.symbol, 0) + 1
        regime_counts[row.regime] = regime_counts.get(row.regime, 0) + 1
    total = len(rows)
    values = np.asarray([
        np.sqrt((total / (len(symbol_counts) * symbol_counts[row.symbol])) *
                (total / (len(regime_counts) * regime_counts[row.regime])))
        for row in rows
    ], dtype=float)
    return values / max(1e-9, float(np.mean(values)))


def _raw_probability(head: dict[str, Any], row: PointInTimeSnapshot,
                     means: np.ndarray, scales: np.ndarray,
                     feature_names: tuple[str, ...] = FEATURE_NAMES) -> float:
    """Evaluate a logistic head before its calibration layer.

    Keeping this calculation in the training module lets walk-forward
    evaluation fit calibration on a later chronological holdout without
    importing the inference module (which would create a circular import).
    """
    values = np.asarray([float(row.features.get(name, 0.0)) for name in feature_names], dtype=float)
    vector = (values - means) / np.where(scales == 0, 1, scales)
    score = float(vector @ np.asarray(head["weights"]) + head["bias"])
    return float(1 / (1 + np.exp(-np.clip(score, -30, 30))))


@dataclass
class TrainedModel:
    name: str
    version: str
    model_family: str
    feature_names: tuple[str, ...]
    means: list[float]
    scales: list[float]
    heads: dict[str, dict[str, Any]]
    calibration: dict[str, dict[str, float]]
    training_period: dict[str, str]
    dataset_version: str
    trained_at: str
    hyperparameters: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__ | {"feature_names": list(self.feature_names)}


def train(rows: list[PointInTimeSnapshot], *, name: str = "waypoint-baseline", version: str | None = None,
          logistic_steps: int = 700, learning_rate: float = 0.08,
          logistic_l2: float = 0.05, ridge: float = 1e-3,
          calibration_rows: list[PointInTimeSnapshot] | None = None,
          # Keep the probability layer conservative until it earns more
          # confidence out of sample. This is a blend toward the observed
          # base rate, not a claim that the model knows the exact odds.
          probability_shrinkage: float = 0.80,
          auto_probability_shrinkage: bool = False,
          balance_groups: bool = True,
          feature_profile: str = "all") -> TrainedModel:
    labelled = [row for row in rows if row.labels]
    if len(labelled) < 8:
        raise ValueError("At least 8 labelled point-in-time snapshots are required to train ML baselines.")
    if feature_profile not in FEATURE_PROFILES:
        raise ValueError(f"Unknown feature profile: {feature_profile}")
    feature_names = FEATURE_PROFILES[feature_profile]
    matrix, means, scales = _scale(_matrix(labelled, feature_names))
    row_weights = _group_weights(labelled) if balance_groups else np.ones(len(labelled))
    probability_shrinkage = max(0.0, min(1.0, float(probability_shrinkage)))
    calibration_labelled = [row for row in (calibration_rows or []) if row.labels]
    heads: dict[str, dict[str, Any]] = {}
    calibration: dict[str, dict[str, float]] = {}
    for target in ("probability_positive_5d", "probability_positive_10d", "probability_positive_20d",
                   "probability_target_first", "probability_reconsider_first", "probability_neither",
                   "expected_return_5d", "expected_return_10d", "expected_return_20d",
                   "expected_max_upside", "expected_max_drawdown"):
        values = [_label(row, target) for row in labelled]
        valid = [(index, value) for index, value in enumerate(values) if value is not None]
        if not valid:
            continue
        indices = [item[0] for item in valid]
        x, y = matrix[indices], np.asarray([item[1] for item in valid], dtype=float)
        if target.startswith("probability_"):
            selected_shrinkage = probability_shrinkage
            weights, bias = _logistic_fit(x, y, steps=logistic_steps, learning_rate=learning_rate, l2=logistic_l2,
                                          sample_weights=row_weights[indices])
            heads[target] = {"kind": "logistic", "weights": weights.tolist(), "bias": bias}
            # Calibration must be fitted on observations that were not used
            # to estimate the classifier.  The walk-forward evaluator passes
            # a later chronological holdout here.  Small or single-class
            # holdouts fall back to in-sample calibration so live training
            # remains usable, but are marked explicitly in the registry.
            calibration_source = "in_sample_fallback"
            if len(calibration_labelled) >= 30:
                holdout_values = [_label(row, target) for row in calibration_labelled]
                holdout_valid = [(row, value) for row, value in zip(calibration_labelled, holdout_values, strict=True)
                                  if value is not None]
                holdout_y = [int(value) for _, value in holdout_valid]
                if len(set(holdout_y)) > 1:
                    holdout_raw = [_raw_probability(heads[target], row, means, scales, feature_names) for row, _ in holdout_valid]
                    params = fit_platt(holdout_raw, holdout_y)
                    prior = float(np.mean(holdout_y))
                    calibration_source = "chronological_holdout"
                    if auto_probability_shrinkage:
                        selected_shrinkage, calibration_brier = choose_shrinkage(
                            holdout_raw, holdout_y, params, prior, requested=probability_shrinkage)
                    else:
                        calibration_brier = None
                else:
                    params = None
            else:
                params = None
            if params is None:
                raw = 1 / (1 + np.exp(-np.clip(x @ weights + bias, -30, 30)))
                params = fit_platt(raw.tolist(), y.astype(int).tolist())
                prior = float(np.mean(y))
                selected_shrinkage = probability_shrinkage
                calibration_brier = None
            calibration[target] = params | {
                "prior": prior,
                "shrinkage": selected_shrinkage,
                "calibration_brier": calibration_brier,
                "source": calibration_source,
            }
        else:
            weights, bias = _linear_fit(x, y, ridge=ridge, sample_weights=row_weights[indices])
            heads[target] = {"kind": "linear", "weights": weights.tolist(), "bias": bias}
    ordered = sorted(labelled, key=lambda row: row.as_of)
    version = version or f"{name}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    return TrainedModel(name=name, version=version, model_family="baseline-logistic-linear",
                        feature_names=feature_names, means=means.tolist(), scales=scales.tolist(), heads=heads,
                        calibration=calibration, training_period={"start": ordered[0].as_of, "end": ordered[-1].as_of},
                        dataset_version=dataset_version(rows), trained_at=datetime.now().astimezone().isoformat(),
                        hyperparameters={"logistic_steps": logistic_steps, "learning_rate": learning_rate,
                                        "logistic_l2": logistic_l2, "probability_shrinkage": probability_shrinkage,
                                        "auto_probability_shrinkage": auto_probability_shrinkage,
                                        "calibration_source": "chronological_holdout" if calibration_labelled else "in_sample_fallback",
                                        "ridge": ridge, "balance_groups": balance_groups,
                                        "feature_profile": feature_profile})
