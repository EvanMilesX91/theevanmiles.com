"""Independent, bounded news collection worker.

News is evidence for the engine, but it must not sit on the live refresh path.
This worker runs on its own cadence, writes immutable observations in a short
database transaction, and reports its health without affecting price ticks or
deterministic trade decisions.
"""

from __future__ import annotations

import asyncio
import copy
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from .config import config
from .news import candidates_from_filings, collect_candidates, persist_candidates
from .providers import AlpacaMarketDataProvider, AlphaVantageProvider


class NewsCollector:
    def __init__(self, service: Any, sessions: Any, checkpoint: Any) -> None:
        self.service = service
        self.sessions = sessions
        self.checkpoint = checkpoint
        self.interval_seconds = config.news_collection_interval_minutes * 60

    def symbols(self) -> list[str]:
        configured = [
            raw.strip().upper()
            for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols + "," + ",".join(self.service.dynamic_discovery)).split(",")
            if raw.strip()
        ]
        return list(dict.fromkeys(configured + list(self.service.stocks)))

    def _persist(self, rows: list[dict[str, Any]]) -> int:
        """Run the blocking SQL write on a worker thread, never the event loop."""
        with self.sessions() as db:
            inserted = persist_candidates(db, rows)
            db.commit()
            return inserted

    async def collect_once(self, reason: str = "scheduled") -> dict[str, Any]:
        started = datetime.now(UTC)
        symbols = self.symbols()
        async with self.service.lock:
            research = copy.deepcopy(self.service.research)
        rows = candidates_from_filings(research, started)
        market = None
        alpha = None
        try:
            if config.apca_api_key_id and config.apca_api_secret_key:
                market = AlpacaMarketDataProvider(
                    api_key=config.apca_api_key_id,
                    secret_key=config.apca_api_secret_key,
                    cache=self.service.provider_cache,
                    checkpoint=self.checkpoint,
                )
            if config.alpha_vantage_api_key:
                alpha = AlphaVantageProvider(
                    api_key=config.alpha_vantage_api_key,
                    cache=self.service.provider_cache,
                    daily_limit=config.alpha_vantage_daily_limit,
                    history_reserve=config.alpha_vantage_history_reserve,
                    checkpoint=self.checkpoint,
                )
            rows.extend(await collect_candidates(
                symbols=symbols,
                market=market,
                alpha=alpha,
                now=started,
                since_hours=36,
                include_gdelt=config.news_gdelt_enabled and config.app_mode == "live",
            ))
        finally:
            if market:
                await market.aclose()
            if alpha:
                await alpha.aclose()

        try:
            inserted = await asyncio.to_thread(self._persist, rows)
        except Exception:
            self.service.schedule_status.update(
                news_last_error="News collection write failed; existing observations remain available.",
                news_last_error_at=datetime.now(UTC).isoformat(),
            )
            raise

        tiers = Counter(row.get("source_tier", "discovery") for row in rows)
        status = {
            "news_last_run": started.isoformat(),
            "news_last_success": datetime.now(UTC).isoformat(),
            "news_last_reason": reason,
            "news_collected": len(rows),
            "news_inserted": inserted,
            "news_sources": dict(tiers),
            "news_last_error": None,
        }
        self.service.schedule_status.update(**status)
        if self.service.data_engine:
            self.service.data_engine.changed = True
        return status

    async def run(self) -> None:
        # Run once after startup, then on a quiet hourly cadence. Collection is
        # deliberately independent from the pre-market/live price refresh.
        # The first refresh is the source of the current runtime research
        # snapshot. Wait for it before starting a second full-universe provider
        # pass; otherwise startup would double the SEC/market requests and make
        # the dashboard appear stuck while both jobs compete for the same feeds.
        while not (
            self.service.schedule_status.get("last_success")
            or self.service.schedule_status.get("last_error")
        ):
            await asyncio.sleep(5)
        while True:
            try:
                await self.collect_once("startup" if not self.service.schedule_status.get("news_last_success") else "scheduled")
            except asyncio.CancelledError:
                raise
            except Exception:
                self.service.schedule_status.update(
                    news_last_error="News collection unavailable; prices and deterministic analysis continue.",
                    news_last_error_at=datetime.now(UTC).isoformat(),
                )
            await asyncio.sleep(self.interval_seconds)
