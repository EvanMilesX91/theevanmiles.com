"""Point-in-time feature extraction.

Every feature carries or derives an ``available_at`` timestamp. Values newer
than the requested snapshot time are ignored. This is deliberately boring and
explicit: a future value must be absent, never silently shifted backwards.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any

FEATURE_NAMES = (
    "return_1d", "return_5d", "return_20d", "volatility_20d", "relative_volume",
    "gap_pct", "distance_from_high_20d", "distance_from_low_20d", "trend_slope_20d",
    "revenue_growth_pct", "earnings_growth_pct", "operating_margin_pct", "cash_eur",
    "debt_eur", "free_cash_flow_eur", "dilution_pct", "valuation_multiple",
    "earnings_in_days", "news_count_7d", "news_sentiment_7d", "news_novelty_7d",
    "news_importance_7d", "market_return_20d", "sector_return_20d", "market_volatility_20d",
    "rate_environment", "regime_bull", "regime_bear", "regime_high_vol", "regime_risk_on",
    "filing_count_90d", "filing_recency_days", "fundamental_freshness_days",
    # Cross-sectional comparisons are computed after snapshots are assembled
    # for a date. They use only rows with the same as-of calendar day.
    "sector_relative_return_20d", "peer_return_20d", "same_regime_return_20d",
    "return_5d_rank", "return_20d_rank", "relative_volume_rank", "volatility_rank",
    "valuation_percentile", "same_regime_momentum_rank", "cross_section_coverage",
    "symbol_historical_positive_rate_5d", "sector_historical_positive_rate_5d",
    "regime_historical_positive_rate_5d",
    # Explicit coverage signals stop a missing provider response looking like
    # a neutral financial value. These are inputs, not confidence claims.
    "history_coverage", "volume_coverage", "fundamental_coverage",
    "news_coverage", "event_coverage", "market_context_coverage",
)


def parse_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, str):
        try:
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if result.tzinfo is None:
        return None
    return result.astimezone(UTC)


def available(value: Any, as_of: datetime) -> bool:
    timestamp = parse_time(value)
    return timestamp is None or timestamp <= as_of


def _number(value: Any, as_of: datetime, default: float = 0.0) -> float:
    if isinstance(value, dict):
        if not available(value.get("available_at") or value.get("published_at") or value.get("timestamp"), as_of):
            return default
        value = value.get("value")
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _history(snapshot: dict[str, Any], as_of: datetime, key: str = "history_rows") -> list[tuple[datetime, float, float]]:
    """Return available (time, close, volume) observations in time order."""
    rows: list[tuple[datetime, float, float]] = []
    for item in snapshot.get(key, snapshot.get("history", []) if key == "history_rows" else []):
        if isinstance(item, dict):
            timestamp = parse_time(item.get("timestamp") or item.get("time") or item.get("date"))
            close = item.get("close", item.get("price"))
            volume = item.get("volume", 0)
        else:
            timestamp = None
            close = item
            volume = 0
        if timestamp is None:
            # A bare historical vector has no point-in-time proof. It is useful
            # for current inference but is excluded from historical snapshots.
            continue
        if timestamp <= as_of:
            close_value = _number(close, as_of, default=0.0)
            volume_value = _number(volume or 0, as_of, default=0.0)
            if close_value > 0 and math.isfinite(close_value):
                rows.append((timestamp, close_value, max(0.0, volume_value)))
    rows.sort(key=lambda row: row[0])
    return rows


def _returns(closes: list[float], periods: int) -> float:
    if len(closes) <= periods or closes[-1 - periods] <= 0:
        return 0.0
    return closes[-1] / closes[-1 - periods] - 1.0


def build_features(snapshot: dict[str, Any], as_of: datetime | str) -> dict[str, float]:
    """Build a fixed-width, deterministic vector using only available inputs."""
    point = parse_time(as_of)
    if point is None:
        raise ValueError("as_of must be a timezone-aware ISO timestamp")
    rows = _history(snapshot, point)
    market_rows = _history(snapshot, point, "market_history_rows")
    sector_rows = _history(snapshot, point, "sector_history_rows")
    closes = [row[1] for row in rows]
    volumes = [row[2] for row in rows if row[2] > 0]
    last = closes[-1] if closes else _number(snapshot.get("price"), point)
    returns = [(closes[index] / closes[index - 1] - 1.0) for index in range(1, len(closes)) if closes[index - 1] > 0]
    mean_return = sum(returns[-20:]) / max(1, len(returns[-20:]))
    variance = sum((item - mean_return) ** 2 for item in returns[-20:]) / max(1, len(returns[-20:]))
    high = max(closes[-20:], default=last)
    low = min(closes[-20:], default=last)
    metrics = snapshot.get("metrics", {})
    research = snapshot.get("research", {})
    metrics = {**research.get("metrics", {}), **metrics} if isinstance(research, dict) else metrics
    events = [event for event in snapshot.get("events", snapshot.get("next_events", [])) if isinstance(event, dict)]
    events = [event for event in events if available(event.get("published_at") or event.get("available_at") or event.get("date"), point)]
    news = [item for item in snapshot.get("news", []) if isinstance(item, dict) and available(item.get("published_at"), point)]
    sentiment = sum(_number(item.get("sentiment"), point) for item in news) / max(1, len(news))
    novelty = sum(_number(item.get("novelty"), point) for item in news) / max(1, len(news))
    importance = sum(_number(item.get("importance"), point) for item in news) / max(1, len(news))
    rate = _number(snapshot.get("rate_environment", metrics.get("rate_environment")), point)
    market_closes = [row[1] for row in market_rows]
    sector_closes = [row[1] for row in sector_rows]
    market_return = (_returns(market_closes, 20) if len(market_closes) > 20
                     else _number(snapshot.get("market_return_20d", metrics.get("market_return_20d")), point))
    sector_return = (_returns(sector_closes, 20) if len(sector_closes) > 20
                     else _number(snapshot.get("sector_return_20d", metrics.get("sector_return_20d")), point))
    market_returns = [(market_closes[index] / market_closes[index - 1] - 1.0)
                      for index in range(1, len(market_closes)) if market_closes[index - 1] > 0]
    market_variance = sum((item - (sum(market_returns[-20:]) / max(1, len(market_returns[-20:]))) ) ** 2
                           for item in market_returns[-20:]) / max(1, len(market_returns[-20:]))
    market_vol = (math.sqrt(market_variance) * math.sqrt(252) if market_returns
                  else abs(_number(snapshot.get("market_volatility_20d", metrics.get("market_volatility_20d")), point)))
    filing_events = [event for event in events if str(event.get("kind", "")).upper() == "SEC_FILING"]
    latest_filing = max((parse_time(event.get("published_at")) for event in filing_events), default=None)
    filing_recency = max(0.0, (point - latest_filing).total_seconds() / 86400) if latest_filing else 999.0
    fundamental_as_of = parse_time(metrics.get("fundamental_available_at") or metrics.get("fundamental_as_of"))
    fundamental_freshness = max(0.0, (point - fundamental_as_of).total_seconds() / 86400) if fundamental_as_of else 999.0
    fundamental_fields = (
        "revenue_growth_pct", "earnings_growth_pct", "operating_margin_pct",
        "cash_eur", "debt_eur", "free_cash_flow_eur", "valuation_multiple",
    )
    # The legacy feature names use the account's EUR display convention, while
    # SEC company facts are reported in USD. Keep the vector version stable and
    # explicitly map the observed SEC names rather than silently dropping them.
    aliases = {
        "cash_eur": ("cash_eur", "cash_usd"),
        "debt_eur": ("debt_eur", "total_debt_usd", "debt_usd"),
        "free_cash_flow_eur": ("free_cash_flow_eur", "free_cash_flow_usd"),
    }
    def metric_present(name: str) -> bool:
        candidates = aliases.get(name, (name,))
        return any(
            metrics.get(candidate) is not None
            and _number(metrics.get(candidate), point, default=float("nan"))
            == _number(metrics.get(candidate), point, default=float("nan"))
            for candidate in candidates
        )
    fundamental_coverage = sum(
        1 for name in fundamental_fields
        if metric_present(name)
    ) / len(fundamental_fields)
    has_news_observation = "news" in snapshot or (isinstance(research, dict) and "news" in research)
    has_event_observation = "events" in snapshot or "next_events" in snapshot
    has_market_context = bool(market_rows or sector_rows or "market_return_20d" in snapshot or "market_return_20d" in metrics)
    result = {
        "return_1d": _returns(closes, 1),
        "return_5d": _returns(closes, 5),
        "return_20d": _returns(closes, 20),
        "volatility_20d": math.sqrt(variance) * math.sqrt(252),
        "relative_volume": (volumes[-1] / (sum(volumes[-20:]) / max(1, len(volumes[-20:])))) if volumes else 0.0,
        "gap_pct": _number(snapshot.get("gap_pct"), point),
        "distance_from_high_20d": last / high - 1.0 if high else 0.0,
        "distance_from_low_20d": last / low - 1.0 if low else 0.0,
        "trend_slope_20d": (closes[-1] / closes[-20] - 1.0) / 20 if len(closes) >= 20 and closes[-20] else 0.0,
        "revenue_growth_pct": _number(metrics.get("revenue_growth_pct"), point),
        "earnings_growth_pct": _number(metrics.get("earnings_growth_pct"), point),
        "operating_margin_pct": _number(metrics.get("operating_margin_pct"), point),
        "cash_eur": _number(metrics.get("cash_eur", metrics.get("cash_usd", metrics.get("cash"))), point),
        "debt_eur": _number(metrics.get("debt_eur", metrics.get("total_debt_usd", metrics.get("debt"))), point),
        "free_cash_flow_eur": _number(metrics.get("free_cash_flow_eur", metrics.get("free_cash_flow_usd", metrics.get("free_cash_flow"))), point),
        "dilution_pct": _number(metrics.get("dilution_pct"), point),
        "valuation_multiple": _number(metrics.get("valuation_multiple"), point),
        "earnings_in_days": _number(metrics.get("earnings_in_days"), point),
        "news_count_7d": float(len(news)),
        "news_sentiment_7d": sentiment,
        "news_novelty_7d": novelty,
        "news_importance_7d": importance,
        "market_return_20d": market_return,
        "sector_return_20d": sector_return,
        "market_volatility_20d": market_vol,
        "rate_environment": rate,
        "regime_bull": float(market_return > 0.05),
        "regime_bear": float(market_return < -0.05),
        "regime_high_vol": float(market_vol > 0.25 or math.sqrt(variance) * math.sqrt(252) > 0.4),
        "regime_risk_on": float(market_return > 0 and sector_return > 0 and market_vol < 0.3),
        "filing_count_90d": float(sum(1 for event in filing_events
                                       if parse_time(event.get("published_at")) and
                                       (point - parse_time(event["published_at"])).total_seconds() <= 90 * 86400)),
        "filing_recency_days": filing_recency,
        "fundamental_freshness_days": fundamental_freshness,
        "history_coverage": min(1.0, len(rows) / 60.0),
        "volume_coverage": len(volumes) / max(1, len(rows)),
        "fundamental_coverage": fundamental_coverage,
        "news_coverage": float(has_news_observation),
        "event_coverage": float(has_event_observation),
        "market_context_coverage": float(has_market_context),
    }
    return {name: float(result.get(name, 0.0)) if math.isfinite(float(result.get(name, 0.0))) else 0.0 for name in FEATURE_NAMES}


def feature_provenance(snapshot: dict[str, Any], as_of: datetime | str) -> list[dict[str, str]]:
    point = parse_time(as_of)
    if point is None:
        raise ValueError("as_of must be a timezone-aware ISO timestamp")
    provenance: list[dict[str, str]] = []
    for item in snapshot.get("provenance", []):
        if not isinstance(item, dict):
            continue
        timestamp = parse_time(item.get("available_at") or item.get("published_at") or item.get("timestamp"))
        if timestamp is not None and timestamp <= point:
            provenance.append({"field": str(item.get("field", "unknown")), "available_at": timestamp.isoformat()})
    return provenance
