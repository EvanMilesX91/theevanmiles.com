"""Assemble a long offline dataset from overlapping provider snapshots."""

from __future__ import annotations

import argparse
from pathlib import Path

from .datasets import read_jsonl, write_jsonl


def merge(preferred: str | Path, supplemental: str | Path, output: str | Path) -> dict[str, int | str]:
    """Prefer the primary feed for overlapping calendar dates.

    Daily providers timestamp the same session at different UTC times. The
    symbol/date key prevents duplicate labels while preserving the preferred
    source's provenance and higher-quality coverage.
    """
    supplemental_rows = read_jsonl(str(supplemental))
    preferred_rows = read_jsonl(str(preferred))
    selected = {(row.symbol, row.as_of[:10]): row for row in supplemental_rows}
    for row in preferred_rows:
        selected[(row.symbol, row.as_of[:10])] = row
    rows = sorted(selected.values(), key=lambda row: (row.as_of, row.symbol))
    version = write_jsonl(str(output), rows)
    return {"rows": len(rows), "preferred_rows": len(preferred_rows),
            "supplemental_rows": len(supplemental_rows), "dataset_version": version,
            "path": str(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Merge point-in-time datasets by symbol/calendar date.")
    parser.add_argument("--preferred", required=True)
    parser.add_argument("--supplemental", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(merge(args.preferred, args.supplemental, args.output))
