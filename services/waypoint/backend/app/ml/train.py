"""Small tabular baselines used for offline training.

The implementation is dependency-light and serializable. A future optional
tree model can implement the same ``fit``/``predict`` contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np

from .calibration import fit_platt
from .datasets import PointInTimeSnapshot, dataset_version
from .features import FEATURE_NAMES


TARGETS = (
    "return_5d", "return_10d", "return_20d", "max_upside_5d", "max_drawdown_5d",
    "max_upside_10d", "max_drawdown_10d", "max_upside_20d", "max_drawdown_20d",
    "barrier_outcome_20d",
)


def _matrix(rows: list[PointInTimeSnapshot], names: tuple[str, ...] = FEATURE_NAMES) -> np.ndarray:
    return np.asarray([[float(row.features.get(name, 0.0)) for name in names] for row in rows], dtype=float)


def _scale(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean = matrix.mean(axis=0) if len(matrix) else np.zeros(len(FEATURE_NAMES))
    scale = matrix.std(axis=0) if len(matrix) else np.ones(len(FEATURE_NAMES))
    scale = np.where(scale < 1e-9, 1.0, scale)
    return (matrix - mean) / scale, mean, scale


def _label(row: PointInTimeSnapshot, target: str) -> float | None:
    if not row.labels:
        return None
    if target == "probability_positive_5d":
        value = row.labels.get("return_5d")
        return float(value >= 0) if value is not None else None
    if target == "probability_positive_10d":
        value = row.labels.get("return_10d")
        return float(value >= 0) if value is not None else None
    if target == "probability_positive_20d":
        value = row.labels.get("return_20d")
        return float(value >= 0) if value is not None else None
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
                  l2: float = 0.05) -> tuple[np.ndarray, float]:
    weights = np.zeros(x.shape[1])
    bias = 0.0
    for _ in range(steps):
        scores = np.clip(x @ weights + bias, -30, 30)
        predictions = 1 / (1 + np.exp(-scores))
        gradient = (x.T @ (predictions - y)) / max(1, len(y))
        weights -= learning_rate * (gradient + l2 * weights)
        bias -= learning_rate * float(np.mean(predictions - y))
    return weights, bias


def _linear_fit(x: np.ndarray, y: np.ndarray, ridge: float = 1e-3) -> tuple[np.ndarray, float]:
    augmented = np.column_stack([x, np.ones(len(x))])
    penalty = np.eye(augmented.shape[1]) * ridge
    penalty[-1, -1] = 0
    coefficients = np.linalg.solve(augmented.T @ augmented + penalty, augmented.T @ y)
    return coefficients[:-1], float(coefficients[-1])


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
          probability_shrinkage: float = 0.80) -> TrainedModel:
    labelled = [row for row in rows if row.labels]
    if len(labelled) < 8:
        raise ValueError("At least 8 labelled point-in-time snapshots are required to train ML baselines.")
    matrix, means, scales = _scale(_matrix(labelled))
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
            weights, bias = _logistic_fit(x, y, steps=logistic_steps, learning_rate=learning_rate, l2=logistic_l2)
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
                    holdout_raw = [_raw_probability(heads[target], row, means, scales) for row, _ in holdout_valid]
                    params = fit_platt(holdout_raw, holdout_y)
                    prior = float(np.mean(holdout_y))
                    calibration_source = "chronological_holdout"
                else:
                    params = None
            else:
                params = None
            if params is None:
                raw = 1 / (1 + np.exp(-np.clip(x @ weights + bias, -30, 30)))
                params = fit_platt(raw.tolist(), y.astype(int).tolist())
                prior = float(np.mean(y))
            calibration[target] = params | {
                "prior": prior,
                "shrinkage": probability_shrinkage,
                "source": calibration_source,
            }
        else:
            weights, bias = _linear_fit(x, y, ridge=ridge)
            heads[target] = {"kind": "linear", "weights": weights.tolist(), "bias": bias}
    ordered = sorted(labelled, key=lambda row: row.as_of)
    version = version or f"{name}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    return TrainedModel(name=name, version=version, model_family="baseline-logistic-linear",
                        feature_names=FEATURE_NAMES, means=means.tolist(), scales=scales.tolist(), heads=heads,
                        calibration=calibration, training_period={"start": ordered[0].as_of, "end": ordered[-1].as_of},
                        dataset_version=dataset_version(rows), trained_at=datetime.now().astimezone().isoformat(),
                        hyperparameters={"logistic_steps": logistic_steps, "learning_rate": learning_rate,
                                        "logistic_l2": logistic_l2, "probability_shrinkage": probability_shrinkage,
                                        "calibration_source": "chronological_holdout" if calibration_labelled else "in_sample_fallback",
                                        "ridge": ridge})
