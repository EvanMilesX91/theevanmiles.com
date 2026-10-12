"""Enrich labelled snapshots from the dated research archive.

The archive is deliberately treated as a partial observation source. Every
record is matched only when its ``available_at`` timestamp is at or before the
snapshot. No current headline or later filing is copied backwards into the
training set.
"""

from __future__ import annotations

import argparse
import re
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable

from .datasets import PointInTimeSnapshot, parse_time, read_jsonl, write_jsonl


POSITIVE_WORDS = {"beat", "beats", "growth", "approval", "contract", "award", "upgrade", "profit", "surge", "record"}
NEGATIVE_WORDS = {"miss", "misses", "decline", "lawsuit", "offering", "downgrade", "loss", "cut", "probe", "recall"}
IMPORTANT_WORDS = {"earnings", "guidance", "approval", "contract", "offering", "lawsuit", "bankruptcy", "recall"}


def _record_time(record: dict[str, Any]):
    return parse_time(record.get("available_at") or record.get("published_at"))


def load_archive(paths: Iterable[str | Path]) -> dict[str, list[dict[str, Any]]]:
    """Load and de-duplicate research records by ticker."""
    grouped: dict[str, dict[tuple[str, str, str], dict[str, Any]]] = defaultdict(dict)
    for path in paths:
        try:
            handle = open(path, encoding="utf-8")
        except OSError:
            continue
        with handle:
            for line in handle:
                if not line.strip():
                    continue
                try:
                    record = __import__("json").loads(line)
                except (TypeError, ValueError):
                    continue
                symbol = str(record.get("symbol", "")).strip().upper()
                available = _record_time(record)
                if not symbol or available is None:
                    continue
                key = (str(record.get("url", "")), available.isoformat(), str(record.get("title", "")))
                grouped[symbol][key] = {**record, "_available_at": available}
    return {symbol: sorted(values.values(), key=lambda item: item["_available_at"])
            for symbol, values in grouped.items()}


def _headline_stats(records: list[dict[str, Any]]) -> tuple[float, float, float]:
    positive = negative = important = 0
    for record in records:
        words = set(re.findall(r"[a-z]+", str(record.get("title", "")).lower()))
        positive += len(words & POSITIVE_WORDS)
        negative += len(words & NEGATIVE_WORDS)
        important += int(bool(words & IMPORTANT_WORDS))
    sentiment = (positive - negative) / max(1, positive + negative)
    return float(sentiment), float(important / max(1, len(records))), 1.0


def enrich_rows(rows: list[PointInTimeSnapshot], archive: dict[str, list[dict[str, Any]]]) -> list[PointInTimeSnapshot]:
    enriched: list[PointInTimeSnapshot] = []
    for row in rows:
        point = parse_time(row.as_of)
        if point is None:
            enriched.append(row)
            continue
        records = archive.get(row.symbol, [])
        recent = [record for record in records
                  if point - timedelta(days=7) <= record["_available_at"] <= point]
        filings = [record for record in records
                   if str(record.get("source_name", "")).upper() == "SEC EDGAR"
                   and point - timedelta(days=90) <= record["_available_at"] <= point]
        sentiment, importance, novelty = _headline_stats(recent)
        features = dict(row.features)
        if recent:
            features["news_count_7d"] = float(max(features.get("news_count_7d", 0.0), len(recent)))
            features["news_sentiment_7d"] = sentiment
            features["news_importance_7d"] = importance
            features["news_novelty_7d"] = novelty
            # This means a dated observation exists, not that the archive is
            # a complete news feed. The partial-source flag below remains
            # visible to evaluation and the dashboard.
            features["news_coverage"] = 1.0
        if filings:
            features["event_coverage"] = 1.0
            features["filing_count_90d"] = float(max(features.get("filing_count_90d", 0.0), len(filings)))
            latest = max(record["_available_at"] for record in filings)
            features["filing_recency_days"] = float((point - latest).total_seconds() / 86400)
        provenance = list(row.provenance)
        seen = {(item.get("field"), item.get("available_at")) for item in provenance}
        for record in recent + filings:
            available = record["_available_at"].isoformat()
            item = {"field": f"research:{record.get('source_name', 'archive')}:{record.get('url', '')}",
                    "available_at": available}
            if (item["field"], available) not in seen:
                provenance.append(item)
                seen.add((item["field"], available))
        metadata = dict(row.metadata)
        metadata.update({"research_archive_enriched": True,
                         "research_archive_partial": True,
                         "research_archive_recent_records": len(recent),
                         "research_archive_filing_records": len(filings)})
        enriched.append(PointInTimeSnapshot(symbol=row.symbol, as_of=row.as_of, features=features,
                                            labels=row.labels, provenance=provenance, regime=row.regime,
                                            company_type=row.company_type, sector=row.sector, metadata=metadata))
    return enriched


def enrich_path(dataset_path: str | Path, archive_glob: str | Path, output_path: str | Path | None = None) -> dict[str, Any]:
    dataset = Path(dataset_path)
    output = Path(output_path) if output_path else dataset
    rows = read_jsonl(str(dataset))
    archive_paths = sorted(dataset.parent.glob(str(archive_glob)))
    archive = load_archive(archive_paths)
    enriched = enrich_rows(rows, archive)
    output.parent.mkdir(parents=True, exist_ok=True)
    version = write_jsonl(str(output), enriched)
    return {"status": "enriched", "rows": len(enriched), "archive_files": len(archive_paths),
            "archive_records": sum(len(items) for items in archive.values()),
            "symbols_with_archive": len(archive), "dataset_version": version, "path": str(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrich point-in-time ML snapshots from dated research records.")
    parser.add_argument("dataset", help="Input JSONL dataset")
    parser.add_argument("--archive-glob", default="codex_research_*.jsonl")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()
    print(enrich_path(args.dataset, args.archive_glob, args.output))
