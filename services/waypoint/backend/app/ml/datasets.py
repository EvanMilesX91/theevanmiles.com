"""Historical point-in-time snapshots and versioned dataset assembly."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable

from .features import build_features, feature_provenance, parse_time
from .labels import make_labels


@dataclass(frozen=True)
class PointInTimeSnapshot:
    symbol: str
    as_of: str
    features: dict[str, float]
    labels: dict[str, Any] | None = None
    provenance: list[dict[str, str]] = field(default_factory=list)
    regime: str = "unknown"

    def to_dict(self) -> dict[str, Any]:
        return {"symbol": self.symbol, "as_of": self.as_of, "features": self.features,
                "labels": self.labels, "provenance": self.provenance, "regime": self.regime}


def make_snapshot(snapshot: dict[str, Any], *, symbol: str, as_of: datetime | str,
                  bars: list[dict[str, Any]] | None = None, target: float | None = None,
                  reconsider: float | None = None) -> PointInTimeSnapshot:
    point = parse_time(as_of)
    if point is None:
        raise ValueError("as_of must be timezone-aware")
    features = build_features(snapshot, point)
    labels = None
    if bars is not None and target is not None and reconsider is not None:
        labels = make_labels(as_of=point, entry_price=float(snapshot.get("price", 0)), bars=bars,
                             target=target, reconsider=reconsider)
    market_return = features["market_return_20d"]
    volatility = features["market_volatility_20d"]
    regime = "bull" if market_return > 0.05 else "bear" if market_return < -0.05 else "high_vol" if volatility > 0.25 else "range"
    return PointInTimeSnapshot(symbol=symbol, as_of=point.isoformat(), features=features, labels=labels,
                               provenance=feature_provenance(snapshot, point), regime=regime)


def assert_no_lookahead(snapshot: PointInTimeSnapshot) -> None:
    point = parse_time(snapshot.as_of)
    if point is None:
        raise ValueError("Snapshot timestamp is invalid")
    future = []
    for item in snapshot.provenance:
        available_at = parse_time(item.get("available_at"))
        if available_at is not None and available_at > point:
            future.append(item)
    if future:
        raise ValueError(f"future information in snapshot {snapshot.symbol}: {future[0].get('field', 'unknown')}")


def dataset_version(rows: Iterable[PointInTimeSnapshot]) -> str:
    payload = json.dumps([row.to_dict() for row in rows], sort_keys=True, separators=(",", ":"), default=str)
    return "dataset-" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def write_jsonl(path: str, rows: Iterable[PointInTimeSnapshot]) -> str:
    materialized = list(rows)
    for row in materialized:
        assert_no_lookahead(row)
    with open(path, "w", encoding="utf-8") as handle:
        for row in materialized:
            handle.write(json.dumps(row.to_dict(), sort_keys=True) + "\n")
    return dataset_version(materialized)


def read_jsonl(path: str) -> list[PointInTimeSnapshot]:
    rows: list[PointInTimeSnapshot] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            row = PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                      labels=item.get("labels"), provenance=item.get("provenance", []),
                                      regime=item.get("regime", "unknown"))
            assert_no_lookahead(row)
            rows.append(row)
    return sorted(rows, key=lambda row: row.as_of)


def build_labeled_dataset(records: Iterable[dict[str, Any]]) -> list[PointInTimeSnapshot]:
    """Build labelled rows from records containing a snapshot and future bars.

    The caller supplies historical bars separately so labels can only be
    created after the holding window. Feature extraction still sees the
    snapshot's as-of timestamp and filters newer observations.
    """
    rows: list[PointInTimeSnapshot] = []
    for record in records:
        snapshot = record["snapshot"]
        rows.append(make_snapshot(snapshot, symbol=str(record["symbol"]), as_of=record["as_of"],
                                  bars=list(record.get("future_bars", [])), target=float(record["target"]),
                                  reconsider=float(record["reconsider"])))
    return rows
