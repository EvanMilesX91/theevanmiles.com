"""Small, explainable model-drift checks."""

from __future__ import annotations

from typing import Any

import numpy as np

from .datasets import PointInTimeSnapshot
from .train import TrainedModel


def population_stability_index(expected: list[float], actual: list[float], bins: int = 10) -> float:
    if not expected or not actual:
        return 0.0
    edges = np.linspace(min(expected + actual), max(expected + actual) + 1e-9, bins + 1)
    expected_counts, _ = np.histogram(expected, edges)
    actual_counts, _ = np.histogram(actual, edges)
    expected_rate = np.maximum(expected_counts / len(expected), 1e-6)
    actual_rate = np.maximum(actual_counts / len(actual), 1e-6)
    return float(np.sum((actual_rate - expected_rate) * np.log(actual_rate / expected_rate)))


def assess_drift(model: TrainedModel, recent: list[PointInTimeSnapshot], *, outcomes: list[dict[str, Any]] | None = None,
                 brier_recent: float | None = None) -> dict[str, Any]:
    if not recent:
        return {"status": "unknown", "confidence_reduced": True, "reason": "No recent snapshots."}
    recent_matrix = np.asarray([[row.features.get(name, 0.0) for name in model.feature_names] for row in recent], dtype=float)
    expected = np.asarray(model.means, dtype=float)
    baseline = np.asarray(model.scales, dtype=float)
    feature_shift = float(np.mean(np.abs((recent_matrix.mean(axis=0) - expected) / np.where(baseline == 0, 1, baseline))))
    expected_error = None
    accuracy = None
    calibration_gap = None
    if outcomes:
        pairs = [(item.get("prediction", {}), item.get("actual", {})) for item in outcomes if item.get("completed")]
        if pairs:
            expected_error = float(np.mean([abs(float(prediction.get("expected_return_10d", 0)) - float(actual.get("return_10d", 0)))
                                            for prediction, actual in pairs]))
            positive_pairs = [(float(prediction.get("probability_positive_10d", 0.5)), float(actual.get("return_10d", 0)) > 0)
                              for prediction, actual in pairs]
            accuracy = float(np.mean([int((probability >= 0.5) == outcome) for probability, outcome in positive_pairs]))
            calibration_gap = abs(float(np.mean([item[0] for item in positive_pairs])) - float(np.mean([int(item[1]) for item in positive_pairs])))
            if brier_recent is None:
                brier_recent = float(np.mean([(probability - int(outcome)) ** 2 for probability, outcome in positive_pairs]))
    material = feature_shift > 1.5 or (brier_recent is not None and brier_recent > 0.3) or (expected_error is not None and expected_error > 0.1)
    watch = feature_shift > 0.75 or (calibration_gap is not None and calibration_gap > 0.1)
    status = "material" if material else "watch" if watch else "stable"
    return {"status": status, "confidence_reduced": status != "stable", "standardized_mean_shift": feature_shift,
            "brier_recent": brier_recent, "expected_value_error": expected_error, "accuracy": accuracy,
            "calibration_gap": calibration_gap, "sample_count": len(recent)}
