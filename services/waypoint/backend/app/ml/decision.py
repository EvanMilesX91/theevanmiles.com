"""Conservative bridge from ML evidence to the existing decision engine.

This function is intentionally opt-in. Deterministic scores, freshness gates,
liquidity and event-risk controls remain authoritative and can only narrow a
decision; ML cannot create a trade plan or override a risk stop.
"""

from __future__ import annotations

from typing import Any


def combine_decision(*, deterministic_state: str, opportunity: float | None, risk: float | None,
                     prediction: dict[str, Any] | None, influence_enabled: bool, fresh: bool,
                     liquidity_ok: bool = True, event_risk: bool = False, owned: bool = False) -> dict[str, Any]:
    result = {"state": deterministic_state, "ml_applied": False, "reason": "Deterministic engine remains authoritative."}
    if not influence_enabled or not prediction:
        return result
    if not fresh or not liquidity_ok or event_risk:
        result["reason"] = "ML evidence was ignored because a deterministic data or risk gate is unavailable."
        return result
    if risk is not None and risk >= 85:
        result["state"] = "WATCH_CLOSELY" if owned else "SKIP"
        result["ml_applied"] = True
        result["reason"] = "Risk controls override positive model evidence."
        return result
    positive = prediction.get("probability_positive_10d")
    target = prediction.get("probability_target_first")
    if deterministic_state == "BUY_AREA" and ((positive is not None and positive < 0.45) or (target is not None and target < 0.40)):
        result["state"] = "WATCH_CLOSELY" if owned else "WAIT"
        result["ml_applied"] = True
        result["reason"] = "The model is cautious, so the deterministic entry remains unconfirmed."
    else:
        result["ml_applied"] = True
        result["reason"] = "ML evidence supports the deterministic state; risk controls remain active."
    return result
