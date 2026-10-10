"""Probability calibration and reliability metrics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


def brier_score(probabilities: Iterable[float], outcomes: Iterable[int]) -> float:
    pairs = list(zip(probabilities, outcomes, strict=True))
    return sum((max(0.0, min(1.0, float(probability))) - int(outcome)) ** 2 for probability, outcome in pairs) / max(1, len(pairs))


@dataclass(frozen=True)
class ReliabilityBin:
    lower: float
    upper: float
    count: int
    mean_probability: float
    observed_rate: float


def reliability_curve(probabilities: Iterable[float], outcomes: Iterable[int], bins: int = 10) -> list[ReliabilityBin]:
    values = list(zip(probabilities, outcomes, strict=True))
    result: list[ReliabilityBin] = []
    for index in range(bins):
        lower, upper = index / bins, (index + 1) / bins
        selected = [(max(0.0, min(1.0, float(probability))), int(outcome)) for probability, outcome in values
                    if lower <= float(probability) < upper or (index == bins - 1 and float(probability) == 1)]
        result.append(ReliabilityBin(lower, upper, len(selected),
                                     sum(item[0] for item in selected) / len(selected) if selected else 0.0,
                                     sum(item[1] for item in selected) / len(selected) if selected else 0.0))
    return result


def fit_platt(probabilities: list[float], outcomes: list[int], steps: int = 300, learning_rate: float = 0.05) -> dict[str, float]:
    """Fit a tiny logistic calibration layer without adding a heavy dependency."""
    if not probabilities:
        return {"a": 1.0, "b": 0.0}
    import math
    a, b = 1.0, 0.0
    for _ in range(steps):
        grad_a = grad_b = 0.0
        for probability, outcome in zip(probabilities, outcomes, strict=True):
            logit = math.log(max(1e-6, min(1 - 1e-6, probability)) / max(1e-6, 1 - min(1 - 1e-6, probability)))
            score = max(-30.0, min(30.0, a * logit + b))
            predicted = 1 / (1 + math.exp(-score))
            grad_a += (predicted - outcome) * logit
            grad_b += predicted - outcome
        a -= learning_rate * grad_a / len(probabilities)
        b -= learning_rate * grad_b / len(probabilities)
    return {"a": a, "b": b}


def calibrate(probability: float, params: dict[str, float] | None) -> float:
    if not params:
        return max(0.0, min(1.0, probability))
    import math
    safe = max(1e-6, min(1 - 1e-6, probability))
    logit = math.log(safe / (1 - safe))
    score = max(-30.0, min(30.0, params.get("a", 1.0) * logit + params.get("b", 0.0)))
    return 1 / (1 + math.exp(-score))
