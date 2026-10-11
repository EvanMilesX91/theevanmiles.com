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
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from ..providers import CompanyIdentity, Fundamentals, MarketDataProvider, ProviderError, SECProvider
from ..live_data import normalize_fundamentals
from .datasets import PointInTimeSnapshot, make_snapshot, write_jsonl


def _bar_dict(bar: Any) -> dict[str, Any]:
    if hasattr(bar, "model_dump"):
        return bar.model_dump(mode="json")
    return dict(bar)


SECTOR_PROXY = {
    "AMD": "SOXX", "AVGO": "SOXX", "NVDA": "SOXX", "TSM": "SOXX",
    "JPM": "XLF", "HOOD": "XLF", "COIN": "XLF", "SOFI": "XLF",
    "XOM": "XLE", "CVX": "XLE", "BA": "XLI", "GE": "XLI", "RKLB": "XLI",
    "LLY": "XLV", "AMZN": "XLY", "TSLA": "XLY", "COST": "XLP", "WMT": "XLP",
}
POSITIVE_NEWS = {"beat", "beats", "growth", "approval", "contract", "award", "upgrade", "profit", "surge", "record"}
NEGATIVE_NEWS = {"miss", "misses", "decline", "lawsuit", "offering", "downgrade", "loss", "cut", "probe", "recall"}
IMPORTANT_NEWS = {"earnings", "guidance", "approval", "contract", "offering", "lawsuit", "bankruptcy", "recall"}


def _news_context(item: Any) -> dict[str, Any]:
    title = str(getattr(item, "title", "") or (item.get("title", "") if isinstance(item, dict) else ""))
    published = getattr(item, "published_at", None) or (item.get("published_at") if isinstance(item, dict) else None)
    words = set(re.findall(r"[a-z]+", title.lower()))
    positive = len(words & POSITIVE_NEWS)
    negative = len(words & NEGATIVE_NEWS)
    sentiment = (positive - negative) / max(1, positive + negative)
    return {"title": title[:500], "published_at": published.isoformat() if hasattr(published, "isoformat") else str(published),
            "sentiment": float(sentiment), "novelty": 1.0,
            "importance": 1.0 if words & IMPORTANT_NEWS else 0.25}


def _available_at(fundamentals: Fundamentals, as_of: datetime) -> str | None:
    facts = [fact for fact in fundamentals.facts
             if fact.filed_on < as_of.date() and fact.period_end <= as_of.date()]
    if not facts:
        return None
    # Filing dates are date-only in EDGAR. Make availability conservative by
    # using the following UTC day rather than assuming a filing was visible at
    # that day's market open.
    return datetime.combine(max(f.filed_on for f in facts) + timedelta(days=1), datetime.min.time(), UTC).isoformat()


def _snapshot_record(symbol: str, bars: list[dict[str, Any]], index: int, *,
                     target_pct: float, reconsider_pct: float,
                     context: dict[str, Any] | None = None) -> PointInTimeSnapshot | None:
    bar = bars[index]
    price = float(bar["close"])
    if price <= 0:
        return None
    as_of = datetime.fromisoformat(str(bar["timestamp"]).replace("Z", "+00:00")).astimezone(UTC)
    history_rows = bars[: index + 1]
    snapshot = {
        "price": price,
        "history_rows": history_rows,
        "projection_metadata": {"source": "alpaca_daily_bars", "bar_timestamp": bar["timestamp"],
                                "target_pct": target_pct, "reconsider_pct": reconsider_pct},
    }
    if context:
        snapshot.update({key: value for key, value in context.items() if value})
    # A fixed, versioned barrier definition makes labels comparable across runs.
    return make_snapshot(snapshot, symbol=symbol, as_of=as_of, bars=bars,
                         target=price * (1 + target_pct),
                         reconsider=price * (1 - reconsider_pct))


async def build_dataset(provider: MarketDataProvider, symbols: list[str], *, years: int = 5,
                        stride_days: int = 5, target_pct: float = 0.08,
                        reconsider_pct: float = 0.05,
                        sec: SECProvider | None = None) -> list[PointInTimeSnapshot]:
    if not symbols:
        raise ValueError("At least one symbol is required")
    if years < 1 or stride_days < 1 or not 0 < target_pct < 1 or not 0 < reconsider_pct < 1:
        raise ValueError("Invalid ingestion settings")
    end = datetime.now(UTC)
    start = end - timedelta(days=365 * years + 90)
    rows: list[PointInTimeSnapshot] = []
    proxy_symbols = {"SPY", "QQQ"} | {SECTOR_PROXY.get(symbol, "SPY") for symbol in symbols}
    proxy_bars: dict[str, list[dict[str, Any]]] = {}
    for proxy in sorted(proxy_symbols):
        try:
            proxy_bars[proxy] = [_bar_dict(item) for item in await provider.historical_bars(proxy, start, end, timeframe="1Day")]
        except (ProviderError, ValueError):
            proxy_bars[proxy] = []
    fundamental_cache: dict[str, tuple[CompanyIdentity, Fundamentals] | None] = {}
    news_cache: dict[str, list[dict[str, Any]]] = {}
    news_provider = getattr(provider, "news", None)
    if callable(news_provider):
        for symbol in dict.fromkeys(item.strip().upper() for item in symbols if item.strip()):
            try:
                news_cache[symbol] = [_news_context(item) for item in await news_provider([symbol], start)]
            except (ProviderError, ValueError):
                news_cache[symbol] = []
    if sec is not None:
        for symbol in dict.fromkeys(item.strip().upper() for item in symbols if item.strip()):
            try:
                identity = await sec.resolve_company(symbol)
                fundamental_cache[symbol] = (identity, await sec.fundamentals(identity.cik))
            except (ProviderError, ValueError):
                fundamental_cache[symbol] = None
    for symbol in dict.fromkeys(item.strip().upper() for item in symbols if item.strip()):
        bars = [_bar_dict(item) for item in await provider.historical_bars(symbol, start, end, timeframe="1Day")]
        bars.sort(key=lambda item: str(item.get("timestamp", "")))
        # Leave enough future observations for the 60-day path and avoid a
        # train/test leak from incomplete labels at the end of the range.
        last_usable = max(0, len(bars) - 61)
        for index in range(60, last_usable + 1, stride_days):
            bar_timestamp = datetime.fromisoformat(str(bars[index]["timestamp"]).replace("Z", "+00:00")).astimezone(UTC)
            proxy = SECTOR_PROXY.get(symbol, "SPY")
            facts = fundamental_cache.get(symbol)
            metrics: dict[str, Any] = {}
            events: list[dict[str, Any]] = []
            if facts:
                identity, fundamentals = facts
                normalized = normalize_fundamentals(fundamentals, identity, bar_timestamp)
                metrics = dict(normalized.get("metrics", {}))
                raw_metrics = normalized.get("raw_metrics", {})
                # A historical, point-in-time P/E proxy is computable when the
                # filing reported annual diluted EPS. It is intentionally left
                # absent when EPS is zero or unavailable.
                eps = raw_metrics.get("annual_diluted_eps_usd")
                if not metrics.get("valuation_multiple") and eps and float(eps) > 0:
                    metrics["valuation_multiple"] = float(bars[index]["close"]) / float(eps)
                available_at = _available_at(fundamentals, bar_timestamp)
                if available_at:
                    metrics["fundamental_available_at"] = available_at
                seen_filings: set[tuple[str, str]] = set()
                for fact in fundamentals.facts:
                    available = datetime.combine(fact.filed_on + timedelta(days=1), datetime.min.time(), UTC)
                    filing_key = (fact.accession, fact.form)
                    if (bar_timestamp - timedelta(days=90)) <= available <= bar_timestamp and filing_key not in seen_filings:
                        seen_filings.add(filing_key)
                        events.append({"kind": "SEC_FILING", "form": fact.form,
                                       "published_at": available.isoformat(), "date": fact.filed_on.isoformat()})
            filing_news = [
                {
                    "title": f"SEC {event.get('form', 'filing')} filing",
                    "published_at": event["published_at"],
                    "sentiment": 0.0,
                    "novelty": 1.0,
                    "importance": 1.0,
                    "source_tier": "primary",
                }
                for event in events
                if event.get("kind") == "SEC_FILING"
                and event.get("published_at")
                and bar_timestamp - timedelta(days=7) <= datetime.fromisoformat(
                    str(event["published_at"]).replace("Z", "+00:00")
                ) <= bar_timestamp
            ]
            context = {
                "market_history_rows": [item for item in proxy_bars.get("SPY", []) if str(item.get("timestamp", "")) <= str(bars[index]["timestamp"])],
                "sector_history_rows": [item for item in proxy_bars.get(proxy, proxy_bars.get("QQQ", [])) if str(item.get("timestamp", "")) <= str(bars[index]["timestamp"])],
                "metrics": metrics,
                "events": events,
                "news": [item for item in news_cache.get(symbol, [])
                         if item.get("published_at") and
                         bar_timestamp - timedelta(days=7) <= datetime.fromisoformat(str(item["published_at"]).replace("Z", "+00:00")) <= bar_timestamp] + filing_news,
            }
            row = _snapshot_record(symbol, bars, index, target_pct=target_pct, reconsider_pct=reconsider_pct, context=context)
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
    sec = None
    try:
        sec = SECProvider(user_agent=config.sec_user_agent)
    except ProviderError:
        pass
    try:
        path = Path(config.ml_dataset_path)
        if not path.is_absolute():
            path = ROOT / path
        result = await ingest_to_path(provider, args.symbols.split(","), path,
                                      years=args.years, stride_days=args.stride_days,
                                      target_pct=args.target_pct, reconsider_pct=args.reconsider_pct, sec=sec)
        print(result)
    finally:
        if sec:
            await sec.aclose()
        await provider.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Waypoint point-in-time labelled history from Alpaca daily bars.")
    parser.add_argument("--symbols", default="", help="Comma-separated symbols; defaults to the core, scan and discovery universes")
    parser.add_argument("--years", type=int, default=5)
    parser.add_argument("--stride-days", type=int, default=5)
    parser.add_argument("--target-pct", type=float, default=0.08)
    parser.add_argument("--reconsider-pct", type=float, default=0.05)
    arguments = parser.parse_args()
    if not arguments.symbols:
        from ..config import config
        arguments.symbols = ",".join(filter(None, (config.live_symbols, config.scan_symbols, config.discovery_symbols)))
    asyncio.run(_cli(arguments))
