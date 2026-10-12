"""Probability calibration and reliability metrics."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


def brier_score(probabilities: Iterable[float], outcomes: Iterable[int]) -> float:
    pairs = list(zip(probabilities, outcomes, strict=True))
    return sum((max(0.0, min(1.0, float(probability))) - int(outcome)) ** 2 for probability, outcome in pairs) / max(1, len(pairs))


def brier_decomposition(probabilities: Iterable[float], outcomes: Iterable[int], bins: int = 10) -> dict[str, float | int]:
    """Return the reliability, resolution and uncertainty parts of Brier.

    For a binary target the score is approximately ``reliability - resolution +
    uncertainty``.  This tells us *why* a score is poor: reliability is the
    calibration error, resolution is useful separation between situations, and
    uncertainty is the irreducible base-rate term.
    """
    bins = max(1, int(bins))
    pairs = [(max(0.0, min(1.0, float(probability))), int(outcome))
             for probability, outcome in zip(probabilities, outcomes, strict=True)]
    if not pairs:
        return {"reliability": 0.0, "resolution": 0.0, "uncertainty": 0.0,
                "reconstructed_brier": 0.0, "count": 0}
    base_rate = sum(outcome for _, outcome in pairs) / len(pairs)
    reliability = 0.0
    resolution = 0.0
    for index in range(max(1, bins)):
        lower, upper = index / bins, (index + 1) / bins
        selected = [(probability, outcome) for probability, outcome in pairs
                    if lower <= probability < upper or (index == bins - 1 and probability == 1.0)]
        if not selected:
            continue
        weight = len(selected) / len(pairs)
        mean_probability = sum(probability for probability, _ in selected) / len(selected)
        observed_rate = sum(outcome for _, outcome in selected) / len(selected)
        reliability += weight * (mean_probability - observed_rate) ** 2
        resolution += weight * (observed_rate - base_rate) ** 2
    uncertainty = base_rate * (1.0 - base_rate)
    return {"reliability": reliability, "resolution": resolution, "uncertainty": uncertainty,
            "reconstructed_brier": reliability - resolution + uncertainty, "count": len(pairs)}


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


def fit_platt(probabilities: list[float], outcomes: list[int], steps: int = 300, learning_rate: float = 0.05,
              regularization: float = 0.05) -> dict[str, float]:
    """Fit a conservative logistic calibration layer.

    A calibration set can be much smaller than the training set. A completely
    unregularised Platt fit can therefore drive its slope to infinity after a
    few lucky observations and emit false 0%/100% certainty. The small prior
    toward the identity transform keeps probabilities useful while retaining
    the ability to correct a real bias.
    """
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
        grad_a = grad_a / len(probabilities) + regularization * (a - 1.0)
        grad_b = grad_b / len(probabilities) + regularization * b
        a -= learning_rate * grad_a
        b -= learning_rate * grad_b
        # Avoid unstable calibration tails on small, non-stationary folds.
        a = max(0.05, min(3.0, a))
        b = max(-3.0, min(3.0, b))
    return {"a": a, "b": b}


def calibrate(probability: float, params: dict[str, float] | None) -> float:
    if not params:
        return max(0.0, min(1.0, probability))
    import math
    safe = max(1e-6, min(1 - 1e-6, probability))
    logit = math.log(safe / (1 - safe))
    score = max(-30.0, min(30.0, params.get("a", 1.0) * logit + params.get("b", 0.0)))
    calibrated = 1 / (1 + math.exp(-score))
    prior = max(0.0, min(1.0, float(params.get("prior", 0.5))))
    shrinkage = max(0.0, min(1.0, float(params.get("shrinkage", 0.0))))
    return prior + (calibrated - prior) * (1.0 - shrinkage)


def choose_shrinkage(raw_probabilities: list[float], outcomes: list[int], params: dict[str, float],
                     prior: float, requested: float = 0.80) -> tuple[float, float]:
    """Choose a conservative probability blend on a chronological holdout.

    The classifier and Platt layer are fitted before this function is called.
    Selecting the blend only on the later calibration slice avoids tuning it on
    the final validation period.  A small fixed grid is intentional: it keeps
    the calibration choice stable instead of overfitting a continuous knob.
    """
    if not raw_probabilities or len(raw_probabilities) != len(outcomes):
        return max(0.0, min(1.0, float(requested))), float("nan")
    grid = sorted({max(0.0, min(1.0, float(requested))), 0.60, 0.70, 0.80, 0.85, 0.90, 0.95})
    candidates: list[tuple[float, float]] = []
    for shrinkage in grid:
        probabilities = []
        for raw in raw_probabilities:
            safe = max(1e-6, min(1 - 1e-6, float(raw)))
            import math
            logit = math.log(safe / (1 - safe))
            score = max(-30.0, min(30.0, params.get("a", 1.0) * logit + params.get("b", 0.0)))
            calibrated = 1 / (1 + math.exp(-score))
            probabilities.append(prior + (calibrated - prior) * (1.0 - shrinkage))
        candidates.append((brier_score(probabilities, outcomes), shrinkage))
    best_score = min(score for score, _ in candidates)
    # When scores are effectively tied, prefer the more conservative blend.
    tied = [item for item in candidates if item[0] <= best_score + 1e-4]
    score, shrinkage = min(tied, key=lambda item: (-item[1], item[0]))
    return shrinkage, score
