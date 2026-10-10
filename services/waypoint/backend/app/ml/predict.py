"""Fast inference and explanation helpers."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .calibration import calibrate
from .datasets import PointInTimeSnapshot
from .train import TrainedModel


def _vector(model: TrainedModel, row: PointInTimeSnapshot) -> np.ndarray:
    values = np.asarray([row.features.get(name, 0.0) for name in model.feature_names], dtype=float)
    return (values - np.asarray(model.means)) / np.where(np.asarray(model.scales) == 0, 1, np.asarray(model.scales))


def predict_with_model(model: TrainedModel, row: PointInTimeSnapshot) -> dict[str, Any]:
    vector = _vector(model, row)
    result: dict[str, Any] = {"model_version": model.version, "model_family": model.model_family,
                              "as_of": row.as_of, "dataset_version": model.dataset_version}
    for target, head in model.heads.items():
        raw = float(vector @ np.asarray(head["weights"]) + head["bias"])
        if head["kind"] == "logistic":
            probability = 1 / (1 + math.exp(-max(-30, min(30, raw))))
            result[target] = calibrate(probability, model.calibration.get(target))
        else:
            result[target] = raw
    if "probability_target_first" in result or "probability_reconsider_first" in result or "probability_neither" in result:
        values = [result.get(name, 0.0) for name in ("probability_target_first", "probability_reconsider_first", "probability_neither")]
        total = sum(values)
        if total > 0:
            for name, value in zip(("probability_target_first", "probability_reconsider_first", "probability_neither"), values, strict=True):
                result[name] = value / total
    result["model_confidence"] = _confidence(model, row)
    result["feature_explanations"] = explain(model, row)
    return result


def _confidence(model: TrainedModel, row: PointInTimeSnapshot) -> str:
    if len(model.heads) < 3:
        return "LOW"
    volatility = row.features.get("volatility_20d", 0)
    return "MEDIUM" if volatility < 0.6 else "LOW"


def explain(model: TrainedModel, row: PointInTimeSnapshot, limit: int = 4) -> dict[str, list[str]]:
    vector = _vector(model, row)
    head = model.heads.get("probability_positive_10d") or model.heads.get("probability_positive_5d")
    if not head:
        return {"likes": [], "cautions": []}
    contributions = [(name, float(weight * value)) for name, weight, value in zip(model.feature_names, head["weights"], vector, strict=True)]
    likes = [f"↑ {name.replace('_', ' ').capitalize()}" for name, value in sorted(contributions, key=lambda item: item[1], reverse=True) if value > 0][:limit]
    cautions = [f"↓ {name.replace('_', ' ').capitalize()}" for name, value in sorted(contributions, key=lambda item: item[1]) if value < 0][:limit]
    return {"likes": likes, "cautions": cautions}


def similar_setups(model: TrainedModel, row: PointInTimeSnapshot, history: list[PointInTimeSnapshot], limit: int = 10) -> dict[str, Any]:
    vector = _vector(model, row)
    ranked = []
    for candidate in history:
        if candidate.symbol == row.symbol and candidate.as_of == row.as_of:
            continue
        distance = float(np.linalg.norm(vector - _vector(model, candidate)))
        ranked.append((distance, candidate))
    selected = [candidate for _, candidate in sorted(ranked, key=lambda item: item[0])[:limit]]
    returns = [float(item.labels["return_10d"]) for item in selected if item.labels and item.labels.get("return_10d") is not None]
    positives = [item for item in returns if item > 0]
    targets = [item for item in selected if item.labels and item.labels.get("barrier_outcome_20d") == "TARGET_FIRST"]
    drawdowns = [float(item.labels["max_drawdown_10d"]) for item in selected if item.labels and item.labels.get("max_drawdown_10d") is not None]
    return {"count": len(selected), "median_return_10d": float(np.median(returns)) if returns else None,
            "positive_rate": len(positives) / len(returns) if returns else None,
            "target_first_rate": len(targets) / len(selected) if selected else None,
            "median_drawdown_10d": float(np.median(drawdowns)) if drawdowns else None}
