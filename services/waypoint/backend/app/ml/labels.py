"""Forward-looking labels. These are only created after the holding window closes."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from .features import parse_time


def _bars_after(bars: list[dict[str, Any]], as_of: datetime, days: int) -> list[dict[str, Any]]:
    cutoff = as_of + timedelta(days=days)
    result = []
    for bar in bars:
        timestamp = parse_time(bar.get("timestamp") or bar.get("time") or bar.get("date"))
        if timestamp and as_of < timestamp <= cutoff:
            result.append((timestamp, bar))
    return [item for _, item in sorted(result, key=lambda value: value[0])]


def _trading_bars_after(bars: list[dict[str, Any]], as_of: datetime, count: int) -> list[dict[str, Any]]:
    """Return the first *count* observations after the snapshot timestamp."""
    result = []
    for bar in bars:
        timestamp = parse_time(bar.get("timestamp") or bar.get("time") or bar.get("date"))
        if timestamp and timestamp > as_of:
            result.append((timestamp, bar))
    return [item for _, item in sorted(result, key=lambda value: value[0])[:count]]


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and abs(result) != float("inf") else None


def _path_label(bars: list[dict[str, Any]], entry_price: float, target: float, reconsider: float) -> str:
    for bar in bars:
        high = _number(bar.get("high"))
        low = _number(bar.get("low"))
        if high is None and low is None:
            close = _number(bar.get("close"))
            high, low = close, close
        hit_target = high is not None and high >= target
        hit_reconsider = low is not None and low <= reconsider
        if hit_target and hit_reconsider:
            return "NEITHER"  # Same-bar ordering is unknowable from OHLC alone.
        if hit_target:
            return "TARGET_FIRST"
        if hit_reconsider:
            return "RECONSIDER_FIRST"
    return "NEITHER"


def make_labels(
    *,
    as_of: datetime | str,
    entry_price: float,
    bars: list[dict[str, Any]],
    target: float,
    reconsider: float,
    round_trip_cost: float = 0.007,
    neutral_band: float = 0.002,
) -> dict[str, Any]:
    point = parse_time(as_of)
    if point is None or point.tzinfo is None or entry_price <= 0:
        raise ValueError("A timezone-aware as_of and positive entry price are required")
    if round_trip_cost < 0 or neutral_band < 0:
        raise ValueError("round_trip_cost and neutral_band must be non-negative")
    result: dict[str, Any] = {"entry_price": entry_price, "target": target, "reconsider": reconsider,
                              "round_trip_cost": float(round_trip_cost), "neutral_band": float(neutral_band)}
    for days in (1, 5, 10, 20):
        window = _trading_bars_after(bars, point, days)
        close = _number(window[-1].get("close")) if window else None
        result[f"return_{days}d"] = close / entry_price - 1 if close is not None else None
        if close is not None:
            net_return = close / entry_price - 1 - round_trip_cost
            result[f"net_return_{days}d"] = net_return
            if net_return > neutral_band:
                result[f"direction_{days}d"] = "POSITIVE"
            elif net_return < -neutral_band:
                result[f"direction_{days}d"] = "NEGATIVE"
            else:
                result[f"direction_{days}d"] = "NEUTRAL"
        else:
            result[f"net_return_{days}d"] = None
            result[f"direction_{days}d"] = None
        if window:
            highs = [_number(item.get("high")) for item in window]
            lows = [_number(item.get("low")) for item in window]
            highs = [item for item in highs if item is not None]
            lows = [item for item in lows if item is not None]
            high_values: list[float] = [item for item in highs if item is not None]
            low_values: list[float] = [item for item in lows if item is not None]
            result[f"max_upside_{days}d"] = max(high_values) / entry_price - 1 if high_values else None
            result[f"max_drawdown_{days}d"] = min(low_values) / entry_price - 1 if low_values else None
        else:
            result[f"max_upside_{days}d"] = None
            result[f"max_drawdown_{days}d"] = None
        result[f"barrier_outcome_{days}d"] = _path_label(window, entry_price, target, reconsider)
    result["barrier_outcome_20d"] = _path_label(_trading_bars_after(bars, point, 20), entry_price, target, reconsider)
    path: list[dict[str, float]] = []
    for day, bar in enumerate(_trading_bars_after(bars, point, 60), start=1):
        close = _number(bar.get("close"))
        if close is None:
            continue
        item: dict[str, float] = {"day": float(day), "close": close / entry_price}
        for key in ("high", "low"):
            value = _number(bar.get(key))
            if value is not None:
                item[key] = value / entry_price
        path.append(item)
    result["forward_path"] = path
    result["label_as_of"] = datetime.now(UTC).isoformat()
    return result
