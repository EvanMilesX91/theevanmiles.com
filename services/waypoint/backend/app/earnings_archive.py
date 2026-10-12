"""Bounded historical earnings-estimate collection for live research."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from .config import config
from .providers import AlphaVantageProvider, ProviderError


class EarningsEstimateCollector:
    """Collect Alpha Vantage earnings history without blocking live prices.

    The free plan has a shared daily request budget.  The collector therefore
    stops as soon as the provider budget is exhausted and resumes on a later
    run; it never retries a rejected request in a tight loop.
    """

    def __init__(self, service: Any, checkpoint: Any) -> None:
        self.service = service
        self.checkpoint = checkpoint
        self.interval_seconds = 24 * 3600

    def symbols(self) -> list[str]:
        configured = [
            raw.strip().upper()
            for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols + "," + ",".join(self.service.dynamic_discovery)).split(",")
            if raw.strip()
        ]
        return list(dict.fromkeys(configured + list(self.service.stocks)))

    async def collect_once(self, reason: str = "scheduled") -> dict[str, Any]:
        started = datetime.now(UTC)
        if not config.alpha_vantage_api_key:
            status = {
                "earnings_history_last_run": started.isoformat(),
                "earnings_history_last_error": "ALPHA_VANTAGE_API_KEY is not configured.",
                "earnings_history_collected": 0,
            }
            self.service.schedule_status.update(**status)
            return status

        provider = AlphaVantageProvider(
            api_key=config.alpha_vantage_api_key,
            cache=self.service.provider_cache,
            daily_limit=config.alpha_vantage_daily_limit,
            history_reserve=config.alpha_vantage_history_reserve,
            checkpoint=self.checkpoint,
        )
        collected = 0
        skipped = 0
        stopped_for_budget = False
        symbols = self.symbols()
        cursor = self.service.provider_cache.get("alpha_vantage_earnings_cursor", 0)
        try:
            cursor = int(cursor) % max(1, len(symbols))
        except (TypeError, ValueError):
            cursor = 0
        ordered = symbols[cursor:] + symbols[:cursor]
        try:
            for symbol in ordered:
                key = f"{AlphaVantageProvider.EARNINGS_HISTORY_KEY}:{symbol}"
                entry = self.service.provider_cache.get(key)
                if isinstance(entry, dict) and entry.get("data"):
                    try:
                        age = (started - datetime.fromisoformat(entry["retrieved_at"])).total_seconds()
                        if 0 <= age < 30 * 86400:
                            skipped += 1
                            continue
                    except (KeyError, TypeError, ValueError):
                        pass
                try:
                    await provider.earnings_history(symbol)
                    collected += 1
                except ProviderError as error:
                    if getattr(error, "code", "") in {"rate_limited", "provider_rejected", "budget_exhausted", "daily_limit"}:
                        stopped_for_budget = True
                        break
        finally:
            await provider.aclose()

        if symbols:
            # Advance through both cached and newly collected symbols so the
            # next day starts where this pass stopped rather than repeating
            # the first few names forever.
            advanced = max(1, collected + skipped)
            self.service.provider_cache["alpha_vantage_earnings_cursor"] = (cursor + advanced) % len(symbols)

        status = {
            "earnings_history_last_run": started.isoformat(),
            "earnings_history_last_success": datetime.now(UTC).isoformat(),
            "earnings_history_last_reason": reason,
            "earnings_history_collected": collected,
            "earnings_history_skipped": skipped,
            "earnings_history_budget_limited": stopped_for_budget,
            "earnings_history_last_error": None,
        }
        self.service.schedule_status.update(**status)
        if self.service.data_engine:
            self.service.data_engine.changed = True
            if collected:
                # Rebuild the deterministic snapshot once the new historical
                # estimate observations are available, so uncertainty can be
                # reflected without waiting for the next market refresh.
                await self.service.data_engine.refresh(reason="earnings history")
        return status

    async def run(self) -> None:
        # Let the initial live research pass establish the current snapshot
        # before spending Alpha Vantage calls on the historical archive.
        while not (
            self.service.schedule_status.get("last_success")
            or self.service.schedule_status.get("last_error")
        ):
            await asyncio.sleep(5)
        while True:
            try:
                reason = "startup" if not self.service.schedule_status.get("earnings_history_last_success") else "scheduled"
                await self.collect_once(reason)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.service.schedule_status.update(
                    earnings_history_last_error="Historical earnings collection failed; existing observations remain available.",
                    earnings_history_last_error_at=datetime.now(UTC).isoformat(),
                )
            await asyncio.sleep(self.interval_seconds)
