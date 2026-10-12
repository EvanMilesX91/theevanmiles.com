"""Point-in-time cross-sectional features for a labelled universe.

Rows are grouped by their calendar as-of date. Every comparison therefore
uses observations available at that date only; no future row can influence an
earlier snapshot. This is intentionally a deterministic rank/peer layer, not
an embedding model.
"""

from __future__ import annotations

import argparse
import math
from collections import defaultdict
from pathlib import Path
from typing import Iterable

from .datasets import PointInTimeSnapshot, read_jsonl, write_jsonl


SECTOR_BY_SYMBOL = {
    "AAPL": "technology", "MSFT": "technology", "GOOGL": "technology", "GOOG": "technology",
    "NVDA": "semiconductors", "AMD": "semiconductors", "AVGO": "semiconductors", "ARM": "semiconductors",
    "TSM": "semiconductors", "ASML": "semiconductors", "AMAT": "semiconductors", "QCOM": "semiconductors",
    "META": "communication", "NFLX": "communication", "RDDT": "communication", "ROKU": "communication",
    "AMZN": "consumer", "COST": "consumer", "WMT": "consumer", "TGT": "consumer", "SHOP": "consumer",
    "TSLA": "consumer", "RIVN": "consumer", "CAVA": "consumer", "MCD": "consumer", "SBUX": "consumer",
    "JPM": "financials", "COIN": "financials", "HOOD": "financials", "SOFI": "financials", "NU": "financials",
    "AFRM": "financials", "V": "financials", "XOM": "energy", "CVX": "energy", "MPC": "energy",
    "BA": "industrials", "GE": "industrials", "CAT": "industrials", "CRWD": "software", "CRM": "software",
    "PLTR": "software", "ORCL": "software", "UBER": "software", "ADBE": "software", "ADSK": "software",
    "LLY": "healthcare", "UNH": "healthcare", "PFE": "healthcare", "MRK": "healthcare", "GILD": "healthcare",
    "CRSP": "biotech", "VRTX": "biotech", "IONQ": "quantum", "RGTI": "quantum", "ASTS": "space",
    "RKLB": "space", "LUNR": "space", "OKLO": "energy", "HIMS": "healthcare", "DUOL": "software",
}


def _percentile(values: list[float], value: float, *, descending: bool = False) -> float:
    if len(values) <= 1:
        return 0.5
    ordered = sorted(values, reverse=descending)
    rank = sum(item <= value for item in ordered) - 1 if not descending else sum(item >= value for item in ordered) - 1
    return max(0.0, min(1.0, rank / (len(ordered) - 1)))


def _safe(value: object) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return 0.0
    return result if math.isfinite(result) else 0.0


def add_cross_sectional_features(rows: Iterable[PointInTimeSnapshot]) -> list[PointInTimeSnapshot]:
    materialized = list(rows)
    by_day: dict[str, list[PointInTimeSnapshot]] = defaultdict(list)
    for row in materialized:
        by_day[row.as_of[:10]].append(row)
    output: list[PointInTimeSnapshot] = []
    historical: dict[str, dict[str, list[int]]] = {
        "symbol": defaultdict(list), "sector": defaultdict(list), "regime": defaultdict(list)}
    for day in sorted(by_day):
        peers = by_day[day]
        for row in peers:
            sector = row.sector if row.sector != "unknown" else SECTOR_BY_SYMBOL.get(row.symbol, "unknown")
            same_sector = [item for item in peers if (item.sector if item.sector != "unknown" else SECTOR_BY_SYMBOL.get(item.symbol, "unknown")) == sector]
            same_regime = [item for item in peers if item.regime == row.regime]
            returns_5 = [_safe(item.features.get("return_5d")) for item in peers]
            returns_20 = [_safe(item.features.get("return_20d")) for item in peers]
            volumes = [_safe(item.features.get("relative_volume")) for item in peers]
            volatility = [_safe(item.features.get("volatility_20d")) for item in peers]
            valuations = [_safe(item.features.get("valuation_multiple")) for item in peers
                          if _safe(item.features.get("valuation_multiple")) > 0]
            sector_returns = [_safe(item.features.get("return_20d")) for item in same_sector]
            regime_returns = [_safe(item.features.get("return_20d")) for item in same_regime]
            value = _safe(row.features.get("valuation_multiple"))
            features = dict(row.features)
            own_return_20 = _safe(row.features.get("return_20d"))
            symbol_history = historical["symbol"].get(row.symbol, [])
            sector_history = historical["sector"].get(sector, [])
            regime_history = historical["regime"].get(row.regime, [])
            features.update({
                "sector_relative_return_20d": own_return_20 - (sum(sector_returns) / len(sector_returns) if sector_returns else own_return_20),
                "peer_return_20d": sum(sector_returns) / len(sector_returns) if sector_returns else own_return_20,
                "same_regime_return_20d": sum(regime_returns) / len(regime_returns) if regime_returns else own_return_20,
                "return_5d_rank": _percentile(returns_5, _safe(row.features.get("return_5d")), descending=True),
                "return_20d_rank": _percentile(returns_20, own_return_20, descending=True),
                "relative_volume_rank": _percentile(volumes, _safe(row.features.get("relative_volume")), descending=True),
                "volatility_rank": _percentile(volatility, _safe(row.features.get("volatility_20d")), descending=False),
                "valuation_percentile": _percentile(valuations, value, descending=False) if value > 0 and valuations else 0.0,
                "same_regime_momentum_rank": _percentile(regime_returns, own_return_20, descending=True),
                "cross_section_coverage": min(1.0, len(peers) / 20.0),
                "symbol_historical_positive_rate_5d": (sum(symbol_history) + 1) / (len(symbol_history) + 2),
                "sector_historical_positive_rate_5d": (sum(sector_history) + 1) / (len(sector_history) + 2),
                "regime_historical_positive_rate_5d": (sum(regime_history) + 1) / (len(regime_history) + 2),
            })
            output.append(PointInTimeSnapshot(symbol=row.symbol, as_of=row.as_of, features=features,
                                              labels=row.labels, provenance=row.provenance, regime=row.regime,
                                              company_type=row.company_type, sector=sector, metadata=row.metadata))
        # Update priors only after every row from this date has had its features built.
        for row in peers:
            direction = str((row.labels or {}).get("direction_5d", "")).upper()
            if direction not in {"POSITIVE", "NEGATIVE"}:
                continue
            value = 1 if direction == "POSITIVE" else 0
            sector = row.sector if row.sector != "unknown" else SECTOR_BY_SYMBOL.get(row.symbol, "unknown")
            historical["symbol"][row.symbol].append(value)
            historical["sector"][sector].append(value)
            historical["regime"][row.regime].append(value)
    return sorted(output, key=lambda item: (item.as_of, item.symbol))


def enrich_path(input_path: str | Path, output_path: str | Path | None = None) -> dict[str, object]:
    source = Path(input_path)
    output = Path(output_path) if output_path else source
    rows = add_cross_sectional_features(read_jsonl(str(source)))
    version = write_jsonl(str(output), rows)
    return {"status": "cross_sectional_enriched", "rows": len(rows),
            "symbols": len({row.symbol for row in rows}), "dataset_version": version, "path": str(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add point-in-time comparative features to a snapshot JSONL.")
    parser.add_argument("dataset")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()
    print(enrich_path(args.dataset, args.output))
