"""Point-in-time historical ingestion and forward labelling.

The job intentionally builds each feature vector from bars at or before the
snapshot date, while labels are calculated only from bars after that date.
It is safe to run repeatedly because the output is rebuilt atomically.
"""

from __future__ import annotations

import asyncio
import argparse
import os
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from ..providers import MarketDataProvider
from .datasets import PointInTimeSnapshot, make_snapshot, write_jsonl


def _bar_dict(bar: Any) -> dict[str, Any]:
    if hasattr(bar, "model_dump"):
        return bar.model_dump(mode="json")
    return dict(bar)


def _snapshot_record(symbol: str, bars: list[dict[str, Any]], index: int, *,
                     target_pct: float, reconsider_pct: float) -> PointInTimeSnapshot | None:
    bar = bars[index]
    price = float(bar["close"])
    if price <= 0:
        return None
    as_of = datetime.fromisoformat(str(bar["timestamp"]).replace("Z", "+00:00")).astimezone(UTC)
    history_rows = bars[: index + 1]
    snapshot = {
        "price": price,
        "history_rows": history_rows,
        "projection_metadata": {"source": "alpaca_daily_bars", "bar_timestamp": bar["timestamp"]},
    }
    # A fixed, versioned barrier definition makes labels comparable across runs.
    return make_snapshot(snapshot, symbol=symbol, as_of=as_of, bars=bars,
                         target=price * (1 + target_pct),
                         reconsider=price * (1 - reconsider_pct))


async def build_dataset(provider: MarketDataProvider, symbols: list[str], *, years: int = 5,
                        stride_days: int = 5, target_pct: float = 0.15,
                        reconsider_pct: float = 0.08) -> list[PointInTimeSnapshot]:
    if not symbols:
        raise ValueError("At least one symbol is required")
    if years < 1 or stride_days < 1 or not 0 < target_pct < 1 or not 0 < reconsider_pct < 1:
        raise ValueError("Invalid ingestion settings")
    end = datetime.now(UTC)
    start = end - timedelta(days=365 * years + 90)
    rows: list[PointInTimeSnapshot] = []
    for symbol in dict.fromkeys(item.strip().upper() for item in symbols if item.strip()):
        bars = [_bar_dict(item) for item in await provider.historical_bars(symbol, start, end, timeframe="1Day")]
        bars.sort(key=lambda item: str(item.get("timestamp", "")))
        # Leave enough future observations for the 60-day path and avoid a
        # train/test leak from incomplete labels at the end of the range.
        last_usable = max(0, len(bars) - 61)
        for index in range(60, last_usable + 1, stride_days):
            row = _snapshot_record(symbol, bars, index, target_pct=target_pct, reconsider_pct=reconsider_pct)
            if row is not None:
                rows.append(row)
    return sorted(rows, key=lambda row: (row.as_of, row.symbol))


async def ingest_to_path(provider: MarketDataProvider, symbols: list[str], path: str | Path, **kwargs: Any) -> dict[str, Any]:
    rows = await build_dataset(provider, symbols, **kwargs)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="ml-snapshots-", suffix=".jsonl", dir=target.parent)
    os.close(fd)
    try:
        version = write_jsonl(temporary, rows)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"status": "ingested", "rows": len(rows), "dataset_version": version, "path": str(target)}


def run_sync(provider: MarketDataProvider, symbols: list[str], path: str | Path, **kwargs: Any) -> dict[str, Any]:
    return asyncio.run(ingest_to_path(provider, symbols, path, **kwargs))


async def _cli(args: argparse.Namespace) -> None:
    from ..config import ROOT, config
    from ..providers import AlpacaMarketDataProvider

    provider = AlpacaMarketDataProvider(api_key=config.apca_api_key_id, secret_key=config.apca_api_secret_key)
    try:
        path = Path(config.ml_dataset_path)
        if not path.is_absolute():
            path = ROOT / path
        result = await ingest_to_path(provider, args.symbols.split(","), path,
                                      years=args.years, stride_days=args.stride_days,
                                      target_pct=args.target_pct, reconsider_pct=args.reconsider_pct)
        print(result)
    finally:
        await provider.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Waypoint point-in-time labelled history from Alpaca daily bars.")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols; defaults to the core, scan and discovery universes")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--stride-days", type=int, default=5)
    parser.add_argument("--target-pct", type=float, default=0.15)
    parser.add_argument("--reconsider-pct", type=float, default=0.08)
    arguments = parser.parse_args()
    if not arguments.symbols:
        from ..config import config
        arguments.symbols = ",".join(filter(None, (config.live_symbols, config.scan_symbols, config.discovery_symbols)))
    asyncio.run(_cli(arguments))
