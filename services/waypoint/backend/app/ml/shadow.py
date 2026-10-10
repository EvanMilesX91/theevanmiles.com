"""Helpers for measuring shadow predictions without touching the ledger."""

from __future__ import annotations

from typing import Any


def attach_outcome(prediction: dict[str, Any], labels: dict[str, Any]) -> dict[str, Any]:
    """Return a completed shadow record; caller decides when the horizon closes."""
    return {"prediction": prediction, "actual": labels, "completed": True}


def compare_deterministic_and_ml(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarise completed shadow records without claiming statistical proof."""
    completed = [record for record in records if record.get("completed")]
    if not completed:
        return {"count": 0, "deterministic_mean_return": None, "ml_mean_return": None, "improves_out_of_sample": False}
    actual = [float(record.get("actual", {}).get("return_10d", 0)) for record in completed]
    ml_positive = [record.get("prediction", {}).get("probability_positive_10d", 0.5) > 0.5 for record in completed]
    selected = [value for value, include in zip(actual, ml_positive, strict=True) if include]
    return {"count": len(completed), "deterministic_mean_return": sum(actual) / len(actual),
            "ml_mean_return": sum(selected) / len(selected) if selected else None,
            "improves_out_of_sample": bool(selected and sum(selected) / len(selected) > sum(actual) / len(actual))}
