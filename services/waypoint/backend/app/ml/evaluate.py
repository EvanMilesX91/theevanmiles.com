"""Chronological walk-forward evaluation with execution friction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .calibration import brier_score, reliability_curve
from .datasets import PointInTimeSnapshot
from .predict import predict_with_model
from .train import train


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


def _folds(rows: list[PointInTimeSnapshot], minimum_train: int = 8) -> list[tuple[list[PointInTimeSnapshot], list[PointInTimeSnapshot]]]:
    ordered = sorted(rows, key=lambda row: row.as_of)
    if len(ordered) < minimum_train + 1:
        return []
    step = max(1, len(ordered) // 4)
    return [(ordered[:cut], ordered[cut:min(len(ordered), cut + step)]) for cut in range(minimum_train, len(ordered), step)
            if cut < len(ordered)]


def walk_forward(rows: list[PointInTimeSnapshot], *, friction: Friction | None = None) -> dict[str, Any]:
    friction = friction or Friction()
    predictions: list[dict[str, Any]] = []
    for training_rows, validation_rows in _folds(rows):
        model = train(training_rows)
        predictions.extend([{**predict_with_model(model, row), "actual": row.labels, "regime": row.regime, "as_of": row.as_of}
                            for row in validation_rows if row.labels])
    probabilities, outcomes = [], []
    net_returns = []
    by_regime: dict[str, list[dict[str, Any]]] = {}
    for item in predictions:
        actual = item.get("actual") or {}
        if actual.get("return_5d") is not None:
            probabilities.append(item.get("probability_positive_5d", 0.5))
            outcomes.append(int(float(actual["return_5d"]) > 0))
            net_returns.append(float(actual["return_5d"]) - friction.round_trip)
        by_regime.setdefault(item.get("regime", "unknown"), []).append(item)
    regime_metrics = {regime: {"count": len(values), "mean_net_return_5d": float(np.mean([
        float(item.get("actual", {}).get("return_5d", 0)) - friction.round_trip for item in values
    ])) if values else 0.0} for regime, values in by_regime.items()}
    return {"method": "chronological_walk_forward", "folds": len(_folds(rows)), "predictions": predictions,
            "metrics": {"brier_score_5d": brier_score(probabilities, outcomes),
                        "mean_net_return_5d": float(np.mean(net_returns)) if net_returns else None,
                        "friction": friction.__dict__, "reliability_5d": [item.__dict__ for item in reliability_curve(probabilities, outcomes)],
                        "by_regime": regime_metrics}}
