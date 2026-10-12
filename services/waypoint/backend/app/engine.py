"""Versioned deterministic analytics. No network, LLM, broker, or target input.

Missing observations are never manufactured. Score components are 0–100 and
weights sum to 100; a component's contribution is score * weight / 100.
See docs/METHODOLOGY.md for formulas, limits, and source requirements.
"""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP
from math import isfinite, sqrt
from statistics import mean, median, pstdev

MODEL_VERSION = "waypoint-0.1.0"
CLASSIFICATION_VERSION = "rules-0.1.0"

OPPORTUNITY_WEIGHTS = {
    "weeks": {
        "Company strength": 15,
        "Growth": 10,
        "Valuation": 10,
        "Price behaviour": 30,
        "Catalysts": 25,
        "Cash generation": 10,
    },
    "months": {
        "Company strength": 25,
        "Growth": 20,
        "Valuation": 20,
        "Price behaviour": 15,
        "Catalysts": 10,
        "Cash generation": 10,
    },
    "years": {
        "Company strength": 30,
        "Growth": 20,
        "Valuation": 20,
        "Price behaviour": 5,
        "Catalysts": 5,
        "Cash generation": 20,
    },
}
RISK_WEIGHTS = {
    "weeks": {
        "Price volatility": 25,
        "Valuation risk": 10,
        "Business risk": 15,
        "Event risk": 25,
        "Dilution / debt": 15,
        "Concentration": 10,
    },
    "months": {
        "Price volatility": 20,
        "Valuation risk": 20,
        "Business risk": 20,
        "Event risk": 15,
        "Dilution / debt": 15,
        "Concentration": 10,
    },
    "years": {
        "Price volatility": 10,
        "Valuation risk": 20,
        "Business risk": 30,
        "Event risk": 10,
        "Dilution / debt": 15,
        "Concentration": 15,
    },
}


def _clip(value: float, low: float = 0, high: float = 100) -> float:
    return min(high, max(low, value))


def _number(value) -> float | None:
    try:
        result = float(value)
        return result if isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _now(now: datetime | None) -> datetime:
    value = now or datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _age(timestamp, now: datetime) -> float | None:
    try:
        value = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
        if value.tzinfo is None:
            return None
        elapsed = (now - value).total_seconds()
        return elapsed if elapsed >= -60 else None
    except (ValueError, TypeError):
        return None


def _classification(sector: str, metrics: dict) -> tuple[str, int]:
    if sector == "financial":
        return "Financial", 95
    if sector == "biotechnology":
        return "Biotechnology", 95
    if sector in {"commodity", "cyclical"}:
        return "Commodity/cyclical", 90
    growth, margin = metrics.get("revenue_growth_pct"), metrics.get("net_margin_pct")
    if growth is None or margin is None:
        return "Other", 35
    if margin > 0:
        return ("High-growth profitable", 85) if growth >= 20 else ("Mature profitable", 90)
    if growth >= 15:
        return "Early-stage/unprofitable growth", 80
    return "Other", 55


def _weights(base: dict, kind: str) -> dict:
    result = dict(base)
    if "Company strength" in result:
        if kind in {"Early-stage/unprofitable growth", "Biotechnology"}:
            result["Company strength"] += 5
            result["Valuation"] -= 5
        elif kind == "Financial":
            result["Company strength"] += 5
            result["Growth"] -= 5
        elif kind == "Commodity/cyclical":
            result["Valuation"] += 5
            result["Growth"] -= 5
    elif kind == "Biotechnology":
        result["Event risk"] += 10
        result["Valuation risk"] -= 5
        result["Price volatility"] -= 5
    elif kind == "Financial":
        result["Business risk"] += 10
        result["Dilution / debt"] -= 10
    elif kind == "Commodity/cyclical":
        result["Concentration"] += 5
        result["Valuation risk"] -= 5
    return result


def _round_price(value: float, reference: float) -> float:
    tick = Decimal("0.05") if reference < 100 else Decimal("0.10") if reference < 500 else Decimal("0.50")
    return float((Decimal(str(value)) / tick).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * tick)


def _plan(history: list[float], price: float, horizon: str) -> dict | None:
    """Anchor once per slow refresh. Not a price forecast or a guaranteed stop."""
    anchor = median(history[-10:])
    absolute_moves = [abs(b - a) for a, b in zip(history[-21:-1], history[-20:], strict=True)]
    distance = max(mean(absolute_moves) * 1.6, anchor * 0.018) * {"weeks": 1, "months": 1.5, "years": 2.2}[horizon]
    entry_low = _round_price(anchor - 0.7 * distance, price)
    entry_high = _round_price(anchor + 0.15 * distance, price)
    reconsider = _round_price(entry_low - 1.7 * distance, price)
    if reconsider <= 0 or entry_high <= entry_low or entry_low <= reconsider:
        return None
    risk_distance = entry_high - reconsider  # conservative: entry at upper bound
    first_low = _round_price(entry_high + 2.0 * risk_distance, price)
    first_high = _round_price(entry_high + 2.7 * risk_distance, price)
    strong_low = _round_price(entry_high + 3.4 * risk_distance, price)
    strong_high = _round_price(entry_high + 4.4 * risk_distance, price)
    return {
        "entry_low": entry_low,
        "entry_high": entry_high,
        "first_profit_low": first_low,
        "first_profit_high": first_high,
        "strong_profit_low": strong_low,
        "strong_profit_high": strong_high,
        "reconsider": reconsider,
        "reward_risk": round((first_low - entry_high) / risk_distance, 2),
        "scenarios": [
            {
                "name": "Weak case",
                "low": _round_price(max(price * 0.05, reconsider - 2 * distance), price),
                "high": reconsider,
                "assumptions": [
                    "Price moves against the setup; sudden gaps can pass this range.",
                    "This is a scenario, not a prediction or a maximum loss.",
                ],
            },
            {
                "name": "Base case",
                "low": entry_low,
                "high": first_high,
                "assumptions": [
                    "Recent price structure persists and input assumptions remain valid.",
                    "These are scenarios, not predictions.",
                ],
            },
            {
                "name": "Strong case",
                "low": strong_low,
                "high": strong_high,
                "assumptions": [
                    "Favourable price movement continues; no probability is assigned.",
                    "These are scenarios, not predictions.",
                ],
            },
        ],
    }


def analyze_stock(fixture: dict, horizon: str = "weeks", now: datetime | None = None) -> dict:
    """Calculate a fully sourced snapshot; unsupported observations block a plan."""
    if horizon not in OPPORTUNITY_WEIGHTS:
        raise ValueError("horizon must be weeks, months, or years")
    now = _now(now)
    sources = [dict(item) for item in fixture.get("sources", [])]
    source_ids = {item.get("id") for item in sources}
    source_map = fixture.get("metric_sources", {})

    def sourced(key: str, value):
        return _number(value) if source_map.get(key) in source_ids else None

    metrics = {key: sourced(key, value) for key, value in fixture.get("metrics", {}).items()}
    price = sourced("price", fixture.get("price"))
    raw_history = fixture.get("history", [])
    history_values = [_number(item) for item in raw_history] if source_map.get("history") in source_ids else []
    history_valid = len(history_values) >= 30 and all(value is not None and value > 0 for value in history_values)
    history = [value for value in history_values if value is not None] if history_valid else []
    sector = fixture.get("sector_group", "other") if source_map.get("sector_group") in source_ids else "other"
    kind, classification_confidence = _classification(sector, metrics)
    financial_age = _age(fixture.get("financial_as_of"), now)
    market_age = _age(fixture.get("market_at"), now)
    news_age = _age(fixture.get("news_checked_at"), now)
    feed = fixture.get("feed", "UNAVAILABLE")
    if feed not in {"DEMO DATA", "REAL-TIME", "DELAYED", "END OF DAY", "MARKET CLOSED", "UNAVAILABLE"}:
        feed = "UNAVAILABLE"
    # A closed-market feed can remain valid through weekends; timestamp stays visible.
    market_limit = 4 * 86400 if feed in {"END OF DAY", "MARKET CLOSED"} else 15 * 60
    financial_fresh = financial_age is not None and financial_age <= 190 * 86400
    market_fresh = market_age is not None and market_age <= market_limit and feed != "UNAVAILABLE"
    news_fresh = news_age is not None and news_age <= 48 * 3600
    required = [
        "revenue_growth_pct",
        "net_margin_pct",
        "fcf_margin_pct",
        "valuation_multiple",
        "peer_multiple",
        "revenue_stability",
        "concentration_pct",
        "dilution_pct",
        "catalyst_strength",
        "estimate_uncertainty_pct",
        "earnings_in_days",
        "binary_event",
        "dollar_volume",
        "spread_pct",
    ]
    if kind == "Financial":
        required += ["capital_buffer_pct", "credit_loss_pct"]
    else:
        # Runway is meaningful for an issuer consuming cash. For a company
        # with verified non-negative free cash flow, requiring a made-up
        # runway number would lower confidence for the wrong reason. The
        # debt-to-assets observation remains required for every non-bank.
        raw_metrics = fixture.get("raw_metrics", {})
        free_cash_flow = _number(raw_metrics.get("free_cash_flow_usd"))
        if free_cash_flow is None or free_cash_flow < 0:
            required.append("cash_runway_months")
        required.append("debt_to_assets_pct")
    missing = [key for key in required if metrics.get(key) is None]
    # Invalid units/ratios are unavailable, never interpreted as reassuring zeroes.
    nonnegative = {
        "valuation_multiple",
        "peer_multiple",
        "cash_runway_months",
        "debt_to_assets_pct",
        "capital_buffer_pct",
        "credit_loss_pct",
        "dollar_volume",
        "spread_pct",
        "estimate_uncertainty_pct",
        "concentration_pct",
        "dilution_pct",
    }
    for key in required:
        value = metrics.get(key)
        if value is not None and (
            (key in nonnegative and value < 0) or (key in {"valuation_multiple", "peer_multiple"} and value == 0)
        ):
            metrics[key] = None
            if key not in missing:
                missing.append(key)
    if price is None or price <= 0:
        missing.append("price")
    if not history_valid:
        missing.append("history")
    if market_age is None:
        missing.append("market timestamp")
    if financial_age is None:
        missing.append("financial timestamp")
    freshness_status = (
        "missing" if missing else "current" if financial_fresh and market_fresh and news_fresh else "stale"
    )

    def positive(key: str, fn) -> float:
        value = metrics.get(key)
        return _clip(fn(value)) if value is not None else 0.0

    runway = positive("cash_runway_months", lambda v: v / 36 * 100)
    debt_safety = positive("debt_to_assets_pct", lambda v: 100 - v * 1.3)
    stability = positive("revenue_stability", lambda v: v)
    cash = positive("fcf_margin_pct", lambda v: 50 + v * 2)
    if kind == "Financial":
        capital = positive("capital_buffer_pct", lambda v: (v - 5) * 10)
        credit = positive("credit_loss_pct", lambda v: 100 - v * 20)
        strength = 0.6 * capital + 0.4 * credit
        cash = 0.5 * capital + 0.5 * positive("net_margin_pct", lambda v: v * 4)
    else:
        strength = 0.35 * runway + 0.35 * debt_safety + 0.30 * stability
    if kind in {"Early-stage/unprofitable growth", "Biotechnology"}:
        cash = 0.7 * runway + 0.3 * cash
    growth_scale = 1.2 if kind in {"High-growth profitable", "Early-stage/unprofitable growth"} else 2.0
    growth = positive("revenue_growth_pct", lambda v: 45 + v * growth_scale)
    valuation = 0.0
    if metrics.get("valuation_multiple") is not None and metrics.get("peer_multiple"):
        valuation = _clip(100 - max(0, metrics["valuation_multiple"] / metrics["peer_multiple"] - 0.5) * 60)
    returns = [(b / a) - 1 for a, b in zip(history[:-1], history[1:], strict=True)] if history else []
    daily_volatility = pstdev(returns[-20:]) if returns else 0.10
    momentum = (history[-1] / history[-21] - 1) if history else 0
    price_behaviour = _clip(60 + momentum * 400 - max(0, daily_volatility - 0.03) * 700) if history else 0
    if momentum > 0.25:
        price_behaviour *= 0.6  # rapid rises do not create an unlimited chasing score
    catalyst = positive("catalyst_strength", lambda v: v)
    liquidity = positive("dollar_volume", lambda v: v / 20_000_000 * 100)
    price_behaviour *= liquidity / 100
    opportunity_raw = {
        "Company strength": strength,
        "Growth": growth,
        "Valuation": valuation,
        "Price behaviour": price_behaviour,
        "Catalysts": catalyst,
        "Cash generation": cash,
    }
    event_days = metrics.get("earnings_in_days")
    event_risk = 100 if event_days is None else 85 if 0 <= event_days <= 7 else 55 if 7 < event_days <= 14 else 20
    binary_event = metrics.get("binary_event")
    event_risk = max(event_risk, 95 if binary_event else 0) if binary_event is not None else 100
    dilution_risk = 100 - positive("dilution_pct", lambda v: 100 - v * 4)
    debt_risk = 100 - debt_safety if kind != "Financial" else 100 - strength
    spread_risk = 100 - positive("spread_pct", lambda v: 100 - v * 4000)
    risk_raw = {
        "Price volatility": max(_clip(daily_volatility / 0.06 * 100), 100 - liquidity, spread_risk),
        "Valuation risk": 100 - valuation,
        "Business risk": 100 - strength,
        "Event risk": event_risk,
        "Dilution / debt": 0.5 * dilution_risk + 0.5 * debt_risk,
        "Concentration": 100 - positive("concentration_pct", lambda v: 100 - v),
    }
    opp_weights = _weights(OPPORTUNITY_WEIGHTS[horizon], kind)
    risk_weights = _weights(RISK_WEIGHTS[horizon], kind)
    opportunity_components = [
        {"name": key, "score": round(value, 2), "weight": opp_weights[key]} for key, value in opportunity_raw.items()
    ]
    risk_components = [
        {"name": key, "score": round(value, 2), "weight": risk_weights[key]} for key, value in risk_raw.items()
    ]
    opportunity = round(sum(c["score"] * c["weight"] / 100 for c in opportunity_components))
    risk = round(sum(c["score"] * c["weight"] / 100 for c in risk_components))
    completeness = sum(metrics.get(key) is not None for key in required) / len(required)
    agreement = _clip(100 - pstdev(opportunity_raw.values()) * 2)
    uncertainty = metrics.get("estimate_uncertainty_pct")
    certainty = _clip(100 - uncertainty) if uncertainty is not None else 0
    # Sensitivity: how far can a +/-10-point perturbation to the largest component move the total?
    sensitivity = 100 - max(opp_weights.values()) * 0.2
    freshness_score = 40 * int(market_fresh) + 40 * int(financial_fresh) + 20 * int(news_fresh)
    confidence = round(
        _clip(
            25 * completeness
            + 0.20 * freshness_score
            + 0.10 * agreement
            + 0.10 * certainty
            + 0.10 * (100 - event_risk)
            + 0.10 * stability
            + 0.10 * classification_confidence
            + 0.05 * sensitivity
        )
    )
    if freshness_status == "missing":
        confidence = min(confidence, 39)
    elif freshness_status == "stale":
        confidence = min(confidence, 49)
    if binary_event:
        confidence = min(confidence, 49)
    elif event_days is not None and 0 <= event_days <= 7:
        confidence = min(confidence, 59)
    confidence_label = "HIGH" if confidence >= 80 else "MEDIUM" if confidence >= 60 else "LOW"
    warning = bool(fixture.get("business_warning", False))
    gate_reasons = []
    if freshness_status != "current":
        gate_reasons.append("Data missing" if freshness_status == "missing" else "Analysis needs refresh")
    if opportunity < 62:
        gate_reasons.append("Opportunity below the model minimum")
    if risk > 70:
        gate_reasons.append("Risk above the model limit")
    if confidence < 60:
        gate_reasons.append("Confidence below the model minimum")
    if classification_confidence < 60:
        gate_reasons.append("Company classification uncertain")
    if liquidity < 50 or metrics.get("spread_pct", 1) is None or (metrics.get("spread_pct") or 0) > 0.015:
        gate_reasons.append("Trading liquidity or spread unsuitable")
    if event_days is not None and 0 <= event_days <= 7:
        gate_reasons.append("Earnings too close for a new demo setup")
    if binary_event:
        gate_reasons.append("Binary event requires review")
    if warning:
        gate_reasons.append("Business assumptions require review")
    plan = _plan(history, price, horizon) if not gate_reasons else None
    if plan is not None and plan["reward_risk"] < 1.6:
        gate_reasons.append("Planned reward relative to downside is too low")
        plan = None
    derived_id = f"calculation-{fixture.get('symbol', 'unknown').lower()}-{MODEL_VERSION}-{horizon}"
    sources.append(
        {
            "id": derived_id,
            "provider": "Waypoint deterministic calculation",
            "url": None,
            "published_at": now.isoformat(),
            "retrieved_at": now.isoformat(),
            "reporting_period": fixture.get("financial_period"),
            "raw_value": {
                "model_version": MODEL_VERSION,
                "horizon": horizon,
                "input_sources": sorted(s for s in source_ids if s),
                "missing": missing,
                "demo": bool(fixture.get("demo")),
            },
            "normalized_value": {
                "opportunity": opportunity,
                "risk": risk,
                "confidence": confidence,
                "plan": plan,
                "daily_volatility": daily_volatility,
                "annualized_volatility": daily_volatility * sqrt(252),
            },
            "description": "Calculated with documented heuristic formulas, not calibrated probabilities. Demo inputs are fictional.",
        }
    )
    prefix = "Fictional demo input: " if fixture.get("demo") else "Sourced input: "
    reasons = []
    for key, text in [
        ("revenue_growth_pct", "revenue growth is {value:g}%."),
        ("cash_runway_months", "cash runway is {value:g} months."),
        ("catalyst_strength", "the structured catalyst input scores {value:g}/100."),
    ]:
        if metrics.get(key) is not None:
            reasons.append({"text": prefix + text.format(value=metrics[key]), "source_id": source_map[key]})
    risks = [
        {
            "text": "Actual losses can be higher if the price moves suddenly past the reconsider level.",
            "source_id": derived_id,
        }
    ]
    if binary_event:
        risks.append(
            {
                "text": prefix + "a binary event could substantially change the setup.",
                "source_id": source_map["binary_event"],
            }
        )
    if event_days is not None:
        risks.append(
            {
                "text": prefix + f"earnings are {event_days:g} days away; the date must be verified before real use.",
                "source_id": source_map["earnings_in_days"],
            }
        )
    if missing:
        risks.append({"text": "Missing or unsupported inputs: " + ", ".join(missing) + ".", "source_id": derived_id})
    previous_close = history[-2] if history else 0.0
    return {
        "symbol": fixture.get("symbol", "UNKNOWN"),
        "name": fixture.get("name", "Unknown"),
        "sector": fixture.get("sector", "Unknown"),
        "company_type": kind,
        "classification_confidence": classification_confidence,
        "classification_version": CLASSIFICATION_VERSION,
        "price": price if price is not None and price > 0 else 0.0,
        "previous_close": previous_close,
        "change_pct": round((price / previous_close - 1) * 100, 2) if previous_close and price else 0.0,
        "history": history,
        "opportunity": opportunity,
        "risk": risk,
        "confidence": confidence,
        "confidence_label": confidence_label,
        "opportunity_components": opportunity_components,
        "risk_components": risk_components,
        "plan": plan,
        "explanation": "; ".join(gate_reasons) + ". No new position suggested."
        if gate_reasons
        else "A qualifying illustrative setup. Wait for the preferred range; review sources before any decision.",
        "freshness": {
            "market_at": fixture.get("market_at"),
            "financial_period": fixture.get("financial_period", "Unknown"),
            "news_checked_at": fixture.get("news_checked_at"),
            "feed": feed,
            "status": freshness_status,
        },
        "reasons": reasons[:3],
        "risks": risks[:3],
        "next_events": [dict(event) for event in fixture.get("events", []) if event.get("source_id") in source_ids][:5],
        "changes": fixture.get("changes", []),
        "sources": sources,
        "business_warning": warning,
        "eligibility": {"qualified": plan is not None, "reasons": gate_reasons, "missing_inputs": missing},
    }


def trade_state(
    price: float, plan: dict | None, owned: bool = False, fresh: bool = True, business_warning: bool = False
) -> tuple[str, str]:
    """State priority: business warning, data, invalidation, profit, entry/wait."""
    if business_warning:
        return (
            ("RECONSIDER_EXIT", "New business information needs review; this is separate from the price warning.")
            if owned
            else ("SKIP", "Business assumptions need review before considering a position.")
        )
    if not fresh or _number(price) is None or price <= 0:
        return (
            (
                "WATCH_CLOSELY",
                "Current data is unavailable or needs refresh. Check the position using a verified quote.",
            )
            if owned
            else ("NO_SETUP", "Analysis needs refresh. No new position suggested.")
        )
    if not plan:
        return (
            ("WATCH_CLOSELY", "There is no current qualifying plan for this position. Review it manually.")
            if owned
            else ("SKIP", "No setup meets the current opportunity, confidence and risk rules.")
        )
    if price <= plan["reconsider"]:
        return (
            (
                "RECONSIDER_EXIT",
                "The price crossed the reconsider level. Review the original setup; gaps can make losses larger.",
            )
            if owned
            else ("SKIP", "The original entry setup has been invalidated by price. Wait for a fresh analysis.")
        )
    if owned:
        if price >= plan["first_profit_low"]:
            return (
                "TAKE_PROFIT",
                "The first planned profit area has been reached. Consider reviewing or taking some profit manually.",
            )
        warning_line = plan["reconsider"] + (plan["entry_low"] - plan["reconsider"]) * 0.35
        if price <= warning_line:
            return (
                "WATCH_CLOSELY",
                "The price is approaching the reconsider level. Review the position; no loss limit is guaranteed.",
            )
        return "HOLD", "The position remains between its warning and profit areas. Keep watching the predefined levels."
    if plan["entry_low"] <= price <= plan["entry_high"]:
        return (
            "BUY_AREA",
            "The price is inside the preferred range. Check position size, current data and your broker's actual quote.",
        )
    if price > plan["entry_high"]:
        return "WAIT", "The price is above the preferred range. Waiting avoids chasing the move."
    return (
        "WATCH",
        "The price is below the preferred range but above reconsider. Wait for a fresh review or a return to the range.",
    )


def position_size(
    plan: dict | None, price: float, equity_eur: float, cash_eur: float, settings: dict, spread_pct: float = 0.002
) -> dict:
    """Decimal cost/risk budget with no loss-recovery or goal-dependent inputs.

    amount_eur is share consideration BEFORE buy fees, matching TradeInput.
    Costs assume unchanged FX at exit; real exchange rates and fills may differ.
    spread_pct is full bid/ask spread, split equally over entry and exit.
    """
    empty = {
        "amount_eur": 0.0,
        "quantity": 0.0,
        "planned_downside_eur": 0.0,
        "first_profit_eur": 0.0,
        "strong_profit_eur": 0.0,
        "viable": False,
    }

    def reject(reason):
        return {**empty, "reason": reason}

    if plan is None:
        return reject("No qualifying plan. No position suggested.")
    selection = settings.get("size", "small")
    if selection == "none":
        return reject("No position selected.")
    if selection not in {"small", "medium", "large"}:
        return reject("Invalid position size selection.")
    try:
        p, equity, cash = (Decimal(str(value)) for value in (price, equity_eur, cash_eur))
        fx = Decimal(str(settings.get("fx_usd_per_eur", 1.10)))
        fx_fee = Decimal(str(settings.get("fx_fee_pct", 0.0015)))
        fixed = Decimal(str(settings.get("fixed_fee_eur", 0)))
        minimum = Decimal(str(settings.get("min_order_eur", 1)))
        spread = Decimal(str(spread_pct))
        stop, first, strong = (
            Decimal(str(plan[key])) for key in ("reconsider", "first_profit_low", "strong_profit_low")
        )
        values = (p, equity, cash, fx, fx_fee, fixed, minimum, spread, stop, first, strong)
        if not all(value.is_finite() for value in values):
            return reject("Invalid pricing or account inputs.")
        if (
            min(p, equity, cash, fx, minimum, stop) <= 0
            or min(fx_fee, fixed, spread) < 0
            or max(fx_fee, spread) >= Decimal("0.10")
        ):
            return reject("Invalid pricing, costs or available cash.")
        if stop >= p or first <= p or strong < first:
            return reject("Current price leaves no suitable planned reward relative to downside.")
        half_spread = spread / 2
        buy_price = p * (1 + half_spread)
        allocation = {"small": Decimal("0.15"), "medium": Decimal("0.25"), "large": Decimal("0.35")}[selection]
        risk_fraction = {"small": Decimal("0.025"), "medium": Decimal("0.040"), "large": Decimal("0.060")}[selection]
        # Marginal bands avoid a cliff where losing money across a threshold
        # could INCREASE the next euro allocation. Both budgets are monotonic.
        protected_equity = (
            min(equity, Decimal("50"))
            + Decimal("0.75") * min(max(equity - 50, Decimal("0")), Decimal("150"))
            + Decimal("0.50") * max(equity - 200, Decimal("0"))
        )
        risk_budget = protected_equity * risk_fraction
        exit_factors = [level * (1 - half_spread) / buy_price * (1 - fx_fee) for level in (stop, first, strong)]
        downside_rate = 1 + fx_fee - exit_factors[0]
        if downside_rate <= 0 or cash <= fixed or risk_budget <= 2 * fixed:
            return reject("NOT WORTH TRADING AT THIS ACCOUNT SIZE: fees exceed the planned risk budget.")
        spendable = (cash - fixed) / (1 + fx_fee)
        max_by_risk = (risk_budget - 2 * fixed) / downside_rate
        amount = min(protected_equity * allocation, spendable, max_by_risk).quantize(
            Decimal("0.01"), rounding=ROUND_DOWN
        )
        if amount < minimum:
            return reject("NOT WORTH TRADING AT THIS ACCOUNT SIZE: affordable amount is below the minimum order.")
        downside = amount * downside_rate + 2 * fixed
        first_profit = amount * (exit_factors[1] - 1 - fx_fee) - 2 * fixed
        strong_profit = amount * (exit_factors[2] - 1 - fx_fee) - 2 * fixed
        gross_first = amount * (first / p - 1)
        friction = gross_first - first_profit
        if first_profit < Decimal("0.05") or first_profit <= friction or first_profit / downside < Decimal("1.2"):
            return reject("NOT WORTH TRADING AT THIS ACCOUNT SIZE: spread, FX and fees overwhelm the planned reward.")

        def cents(value):
            return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

        return {
            "amount_eur": float(amount),
            "quantity": float((amount * fx / buy_price).quantize(Decimal("0.00000001"), rounding=ROUND_DOWN)),
            "planned_downside_eur": cents(downside),
            "first_profit_eur": cents(first_profit),
            "strong_profit_eur": cents(strong_profit),
            "viable": True,
            "reason": "Experimental amount includes estimated round-trip spread, FX and fees. Actual losses can be larger during gaps; FX may change.",
        }
    except (InvalidOperation, TypeError, ValueError, KeyError, ArithmeticError):
        return reject("Invalid pricing or cost inputs. No position suggested.")
