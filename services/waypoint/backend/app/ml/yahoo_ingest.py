"""Supplemental historical bar source for offline walk-forward datasets.

Alpaca's free historical window is bounded for this account. Yahoo's public
chart endpoint is used only by this explicit offline job to extend the price
history; it is never used for live quotes or trading decisions. SEC facts still
go through the point-in-time provider and the resulting dataset is enriched
with the dated research archive separately.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from ..providers import ProviderError, SECProvider
from .ingest import ingest_to_path


class YahooHistoryProvider:
    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client or httpx.AsyncClient(timeout=20, headers={"User-Agent": "Waypoint historical research"})
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def historical_bars(self, symbol: str, start: datetime, end: datetime, **_: Any) -> list[dict[str, Any]]:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol.upper()}"
        params = {"period1": int(start.timestamp()), "period2": int(end.timestamp()),
                  "interval": "1d", "events": "history", "includeAdjustedClose": "true"}
        try:
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
            result = (payload.get("chart", {}).get("result") or [None])[0]
            if not result:
                raise ValueError("empty chart")
            timestamps = result.get("timestamp") or []
            quote = (result.get("indicators", {}).get("quote") or [{}])[0]
            rows: list[dict[str, Any]] = []
            for index, timestamp in enumerate(timestamps):
                values = {name: (quote.get(name) or [None] * len(timestamps))[index]
                          for name in ("open", "high", "low", "close", "volume")}
                if any(value is None for value in values.values()) or values["close"] <= 0:
                    continue
                rows.append({"timestamp": datetime.fromtimestamp(int(timestamp), UTC).isoformat(),
                             **values})
            if len(rows) < 70:
                raise ValueError("insufficient chart history")
            return rows
        except (httpx.HTTPError, KeyError, TypeError, ValueError, IndexError) as error:
            raise ProviderError("historical_unavailable", f"Yahoo history unavailable for {symbol}.") from error

    async def latest_quotes(self, symbols: list[str]) -> dict[str, Any]:
        raise ProviderError("offline_only", "Yahoo history provider is offline-only.")


async def run(args: argparse.Namespace) -> None:
    from ..config import ROOT, config

    symbols = [item.strip().upper() for item in args.symbols.split(",") if item.strip()]
    configured_path = Path(config.ml_dataset_path)
    path = args.output or str(configured_path if configured_path.is_absolute() else ROOT / configured_path)
    provider = YahooHistoryProvider()
    sec = None
    try:
        try:
            sec = SECProvider(user_agent=config.sec_user_agent)
        except ProviderError:
            pass
        result = await ingest_to_path(provider, symbols, path, years=args.years,
                                      stride_days=args.stride_days, sec=sec,
                                      source_name="yahoo_chart_history")
        print(result)
    finally:
        if sec:
            await sec.aclose()
        await provider.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build an offline extended ML dataset from Yahoo chart history.")
    parser.add_argument("--symbols", required=True)
    parser.add_argument("--years", type=int, default=10)
    parser.add_argument("--stride-days", type=int, default=5)
    parser.add_argument("--output", default=None)
    asyncio.run(run(parser.parse_args()))
