"""Migrate older snapshots to the cost-aware direction labels."""

from __future__ import annotations

import argparse
from pathlib import Path

from .datasets import PointInTimeSnapshot, read_jsonl, write_jsonl


def add_cost_labels(rows: list[PointInTimeSnapshot], *, round_trip_cost: float = 0.007,
                   neutral_band: float = 0.002) -> list[PointInTimeSnapshot]:
    output: list[PointInTimeSnapshot] = []
    for row in rows:
        if not row.labels:
            output.append(row)
            continue
        labels = dict(row.labels)
        cost = float(labels.get("round_trip_cost", round_trip_cost))
        band = float(labels.get("neutral_band", neutral_band))
        labels["round_trip_cost"] = cost
        labels["neutral_band"] = band
        for days in (1, 5, 10, 20):
            value = labels.get(f"return_{days}d")
            if value is None:
                continue
            net = float(value) - cost
            labels[f"net_return_{days}d"] = net
            labels[f"direction_{days}d"] = "POSITIVE" if net > band else "NEGATIVE" if net < -band else "NEUTRAL"
        output.append(PointInTimeSnapshot(symbol=row.symbol, as_of=row.as_of, features=row.features,
                                          labels=labels, provenance=row.provenance, regime=row.regime,
                                          company_type=row.company_type, sector=row.sector, metadata=row.metadata))
    return output


def relabel_path(input_path: str | Path, output_path: str | Path | None = None) -> dict[str, object]:
    source = Path(input_path)
    output = Path(output_path) if output_path else source
    rows = add_cost_labels(read_jsonl(str(source)))
    version = write_jsonl(str(output), rows)
    return {"status": "cost_labels_added", "rows": len(rows), "dataset_version": version, "path": str(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add cost-aware neutral/positive/negative labels to snapshots.")
    parser.add_argument("dataset")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()
    print(relabel_path(args.dataset, args.output))
