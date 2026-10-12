"""Historical analogue projection mapping.

This module only describes the distribution of outcomes observed after similar
point-in-time snapshots. It never produces a deterministic price target and it
rejects snapshots containing future-dated provenance.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

import numpy as np

from .datasets import PointInTimeSnapshot, assert_no_lookahead
from .features import parse_time


HORIZONS = (1, 5, 10, 20, 60)
FEATURE_WEIGHT_VERSION = "projection-weights-1.0"


@dataclass(frozen=True)
class ProjectionWeights:
    version: str
    values: dict[str, float]

    @classmethod
    def for_horizon(cls, horizon_days: int) -> "ProjectionWeights":
        # Short horizons emphasize observable price behaviour; longer horizons
        # give fundamentals and valuation more influence.
        values = {
            "price": 1.0 if horizon_days <= 10 else 0.7,
            "volume": 0.9 if horizon_days <= 10 else 0.5,
            "volatility": 0.9 if horizon_days <= 10 else 0.6,
            "fundamentals": 0.4 if horizon_days <= 10 else 1.0,
            "valuation": 0.3 if horizon_days <= 10 else 0.9,
            "events": 0.8 if horizon_days <= 20 else 0.5,
            "market": 0.7,
        }
        return cls(version=FEATURE_WEIGHT_VERSION, values=values)


@dataclass(frozen=True)
class AnalogueMatch:
    row: PointInTimeSnapshot
    similarity: float
    distance: float
    group: str
    completeness: float
    why_similar: list[str]


def _bucket(name: str) -> str:
    lowered = name.lower()
    if any(token in lowered for token in ("return", "momentum", "trend", "high", "low", "gap")):
        return "price"
    if "volume" in lowered:
        return "volume"
    if "volatility" in lowered or "atr" in lowered:
        return "volatility"
    if any(token in lowered for token in ("revenue", "margin", "cash", "debt", "profit", "growth", "flow")):
        return "fundamentals"
    if any(token in lowered for token in ("valuation", "pe", "price_to", "ev_")):
        return "valuation"
    if any(token in lowered for token in ("event", "earnings", "filing", "catalyst")):
        return "events"
    if "news" in lowered:
        return "events"
    if any(token in lowered for token in ("market", "sector", "rate", "regime")):
        return "market"
    return "price"


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _coverage_name(name: str) -> str | None:
    lowered = name.lower()
    if name.endswith("_coverage"):
        return None
    if any(token in lowered for token in ("cash", "debt", "free_cash_flow", "revenue", "earnings_growth",
                                         "operating_margin", "dilution", "valuation", "pe", "price_to", "ev_")):
        return "fundamental_coverage"
    if "news" in lowered:
        return "news_coverage"
    if any(token in lowered for token in ("earnings_in_days", "filing", "catalyst", "event")):
        return "event_coverage"
    if "volume" in lowered:
        return "volume_coverage"
    if any(token in lowered for token in ("market", "sector", "rate", "regime")):
        return "market_context_coverage"
    if any(token in lowered for token in ("return", "momentum", "trend", "high", "low", "gap", "volatility", "atr")):
        return "history_coverage"
    return None


def _usable_feature(snapshot: PointInTimeSnapshot, name: str) -> float | None:
    """Return a point-in-time value, excluding known missing sentinels.

    Coverage flags distinguish a real zero (for example, no debt) from a
    provider default. Dollar amounts are log-scaled before distance scoring so
    a large company's balance sheet cannot swamp price and regime evidence.
    """
    value = _finite(snapshot.features.get(name))
    if value is None:
        return None
    if name in {"filing_recency_days", "fundamental_freshness_days"} and value >= 900:
        return None
    required = _coverage_name(name)
    # Older labelled archives predate explicit coverage flags. Keep those
    # rows usable; current snapshots include the flags and therefore get the
    # missingness protection above.
    if required is not None and required in snapshot.features and (_finite(snapshot.features.get(required)) or 0.0) <= 0.0:
        return None
    if name in {"cash_eur", "debt_eur", "free_cash_flow_eur"}:
        return math.copysign(math.log1p(abs(value)), value)
    return value


def _sector_key(value: str | None) -> str:
    """Map provider-specific industry descriptions to stable peer buckets."""
    lowered = (value or "").lower()
    if not lowered or lowered in {"unknown", "industry unavailable", "industry not verified", "unclassified"}:
        return "unknown"
    aliases = {
        "semiconductor": "semiconductors", "chip": "semiconductors",
        "software": "software", "prepackaged": "software", "technology": "technology",
        "financial": "financials", "bank": "financials", "insurance": "financials",
        "health": "healthcare", "biotech": "healthcare", "pharma": "healthcare",
        "energy": "energy", "oil": "energy", "gas": "energy",
        "consumer": "consumer", "retail": "consumer", "auto": "consumer",
        "aerospace": "aerospace", "defense": "aerospace", "industrial": "industrials",
        "real estate": "real_estate", "communication": "communications", "media": "communications",
    }
    for token, key in aliases.items():
        if token in lowered:
            return key
    return lowered.strip().replace(" ", "_")


def _allowed_group(current: PointInTimeSnapshot, row: PointInTimeSnapshot, group: str) -> bool:
    if group == "same_stock":
        return row.symbol.upper() == current.symbol.upper()
    if group == "peers":
        if row.symbol.upper() == current.symbol.upper():
            return False
        same_type = (current.company_type.lower() not in {"unknown", "unclassified"}
                     and row.company_type.lower() == current.company_type.lower())
        current_sector = _sector_key(current.sector)
        row_sector = _sector_key(row.sector)
        same_sector = current_sector != "unknown" and row_sector == current_sector
        return same_type or same_sector
    return True


def _why_similar(current: PointInTimeSnapshot, row: PointInTimeSnapshot, names: list[str]) -> list[str]:
    differences: list[tuple[float, str, float]] = []
    for name in names:
        left = _usable_feature(current, name)
        right = _usable_feature(row, name)
        if left is None or right is None:
            continue
        differences.append((abs(left - right), name, right - left))
    reasons: list[str] = []
    for _, name, delta in sorted(differences)[:4]:
        label = name.replace("_", " ")
        arrow = "↑" if delta >= 0 else "↓"
        reasons.append(f"{arrow} {label} was comparable")
    if not reasons:
        reasons.append("↑ Historical feature coverage was comparable")
    return reasons


def _history_ready(row: PointInTimeSnapshot, current_time: datetime) -> bool:
    if not row.labels:
        return False
    assert_no_lookahead(row)
    timestamp = parse_time(row.as_of)
    return timestamp is not None and timestamp < current_time


def _has_forward_value(row: PointInTimeSnapshot, horizon_days: int) -> bool:
    """Require a complete path when one is stored, otherwise its endpoint."""
    path = (row.labels or {}).get("forward_path")
    if isinstance(path, list) and path:
        return all(_path_value(row, day) is not None for day in range(1, horizon_days + 1))
    return _path_value(row, horizon_days) is not None


def rank_analogues(
    current: PointInTimeSnapshot,
    history: Iterable[PointInTimeSnapshot],
    *,
    horizon_days: int,
    group: str = "broad",
    same_regime: bool = False,
    top_n: int = 100,
) -> list[AnalogueMatch]:
    """Rank eligible historical rows with weighted standardized distance."""
    current_time = parse_time(current.as_of)
    if current_time is None:
        return []
    weights = ProjectionWeights.for_horizon(horizon_days)
    candidates = [row for row in history if _history_ready(row, current_time) and _has_forward_value(row, horizon_days)]
    candidates = [row for row in candidates if _allowed_group(current, row, group)]
    if same_regime:
        candidates = [row for row in candidates if row.regime == current.regime]
    names = [name for name in current.features if _usable_feature(current, name) is not None]
    if not names:
        return []
    centers: dict[str, float] = {}
    scales: dict[str, float] = {}
    for name in names:
        values = [_usable_feature(row, name) for row in candidates]
        finite_values = [value for value in values if value is not None]
        current_value = _usable_feature(current, name)
        centers[name] = float(np.median(finite_values)) if finite_values else float(current_value or 0.0)
        if len(finite_values) > 1:
            mad = float(np.median(np.abs(np.asarray(finite_values) - centers[name])))
            deviation = 1.4826 * mad
            if deviation <= 1e-9:
                deviation = float(np.std(finite_values))
        else:
            deviation = 1.0
        scales[name] = deviation if deviation > 1e-9 else 1.0
    ranked: list[AnalogueMatch] = []
    for row in candidates:
        terms: list[float] = []
        present = 0
        for name in names:
            left = _usable_feature(current, name)
            right = _usable_feature(row, name)
            if left is None or right is None:
                continue
            present += 1
            z = max(-5.0, min(5.0, (left - right) / scales[name]))
            terms.append((z * z) * weights.values[_bucket(name)])
        if not terms:
            continue
        distance = math.sqrt(sum(terms) / len(terms))
        similarity = 1.0 / (1.0 + distance)
        completeness = present / len(names)
        ranked.append(AnalogueMatch(row=row, similarity=similarity, distance=distance, group=group,
                                    completeness=completeness, why_similar=_why_similar(current, row, names)))
    return sorted(ranked, key=lambda match: match.distance)[: max(25, min(250, top_n))]


def _label_number(row: PointInTimeSnapshot, key: str) -> float | None:
    return _finite((row.labels or {}).get(key))


def _path_value(row: PointInTimeSnapshot, day: int) -> float | None:
    path = (row.labels or {}).get("forward_path", [])
    if isinstance(path, list):
        for point in path:
            if int(point.get("day", -1)) == day:
                return _finite(point.get("close"))
    return _label_number(row, f"return_{day}d")


def _quality(matches: list[AnalogueMatch]) -> str:
    if len(matches) >= 100 and float(np.mean([match.similarity for match in matches])) >= 0.55:
        return "HIGH"
    if len(matches) >= 25 and float(np.mean([match.similarity for match in matches])) >= 0.30:
        return "MEDIUM"
    return "LOW"


def _range(values: list[float], low: float, high: float) -> list[float | None]:
    if not values:
        return [None, None]
    return [float(np.quantile(values, low)), float(np.quantile(values, high))]


def build_projection(
    current: PointInTimeSnapshot,
    matches: list[AnalogueMatch],
    *,
    current_price: float,
    horizon_days: int,
) -> dict[str, Any] | None:
    if current_price <= 0 or not matches:
        return None
    paths: dict[int, list[float]] = {}
    for day in range(1, horizon_days + 1):
        values = [_path_value(match.row, day) for match in matches]
        paths[day] = [value for value in values if value is not None and value > 0]
    final_values = paths.get(horizon_days, [])
    if not final_values:
        return None
    horizon = {
        "horizon_days": horizon_days,
        "samples": len(final_values),
        "quantiles": {f"p{percentile}": current_price * float(np.quantile(final_values, percentile / 100))
                      for percentile in (10, 25, 50, 75, 90)},
        "weak_range": _range([current_price * value for value in final_values], 0.10, 0.25),
        "typical_range": _range([current_price * value for value in final_values], 0.25, 0.75),
        "strong_range": _range([current_price * value for value in final_values], 0.75, 0.90),
    }
    return_values = [value for match in matches if (value := _label_number(match.row, f"return_{horizon_days}d")) is not None]
    upside = [value for match in matches if (value := _label_number(match.row, f"max_upside_{horizon_days}d")) is not None]
    drawdown = [value for match in matches if (value := _label_number(match.row, f"max_drawdown_{horizon_days}d")) is not None]
    barrier_key = f"barrier_outcome_{horizon_days}d"
    barriers = [(match.row.labels or {}).get(barrier_key, (match.row.labels or {}).get("barrier_outcome_20d")) for match in matches]
    barrier_counts = {name: barriers.count(name) / len(barriers) for name in ("TARGET_FIRST", "RECONSIDER_FIRST", "NEITHER")}
    cases = [{"symbol": match.row.symbol, "as_of": match.row.as_of, "similarity": round(match.similarity, 4),
              "group": match.group, "horizon_return": _label_number(match.row, f"return_{horizon_days}d"),
              "why_similar": match.why_similar} for match in matches[:5]]
    return {
        "current_price": current_price,
        "horizon_days": horizon_days,
        "quantiles": horizon["quantiles"],
        "weak_range": horizon["weak_range"],
        "typical_range": horizon["typical_range"],
        "strong_range": horizon["strong_range"],
        "samples": len(final_values),
        "analogue_quality": _quality(matches),
        "average_similarity": float(np.mean([match.similarity for match in matches])),
        "feature_completeness": float(np.mean([match.completeness for match in matches])),
        "positive_rate": sum(value > 0 for value in return_values) / len(return_values) if return_values else None,
        "median_return": float(np.median(return_values)) if return_values else None,
        "mean_return": float(np.mean(return_values)) if return_values else None,
        "median_max_upside": float(np.median(upside)) if upside else None,
        "median_max_drawdown": float(np.median(drawdown)) if drawdown else None,
        "best_return": max(return_values) if return_values else None,
        "worst_return": min(return_values) if return_values else None,
        "target_first_rate": barrier_counts["TARGET_FIRST"],
        "reconsider_first_rate": barrier_counts["RECONSIDER_FIRST"],
        "neither_rate": barrier_counts["NEITHER"],
        "cases": cases,
        "path": [{"day": day, "p10": current_price * float(np.quantile(values, 0.10)),
                  "p25": current_price * float(np.quantile(values, 0.25)),
                  "median": current_price * float(np.quantile(values, 0.50)),
                  "p75": current_price * float(np.quantile(values, 0.75)),
                  "p90": current_price * float(np.quantile(values, 0.90))}
                 for day, values in paths.items() if values],
    }


def disagreement(all_history: dict[str, Any] | None, same_regime: dict[str, Any] | None) -> dict[str, Any] | None:
    if not all_history or not same_regime or all_history.get("positive_rate") is None or same_regime.get("positive_rate") is None:
        return None
    gap = abs(float(all_history["positive_rate"]) - float(same_regime["positive_rate"]))
    if gap < 0.20:
        return None
    return {"status": "HISTORICAL ANALOGUES DISAGREE", "all_history": "positive" if all_history["positive_rate"] >= 0.5 else "negative",
            "same_regime": "positive" if same_regime["positive_rate"] >= 0.5 else "negative",
            "detail": "All-history and same-regime analogue outcomes differ materially; confidence is reduced."}
