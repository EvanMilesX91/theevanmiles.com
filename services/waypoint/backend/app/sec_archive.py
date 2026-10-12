"""Daily SEC archive worker for point-in-time fundamentals and filing events."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import select

from .config import config
from .api_usage import cache_record
from .models import FundamentalObservation
from .news import candidates_from_filings, persist_candidates
from .providers import SECProvider


def _fingerprint(symbol: str, fact: Any) -> str:
    values = (
        symbol.upper(), str(fact.concept), str(fact.value), str(fact.unit),
        str(fact.period_start), str(fact.period_end), str(fact.filed_on),
        str(fact.accession), str(fact.form),
    )
    return hashlib.sha256("|".join(values).encode("utf-8")).hexdigest()


def _available_at(filed_on: Any) -> datetime:
    # EDGAR exposes a date for some facts. Treat the next UTC day as the first
    # safe availability time rather than assuming the filing was known at the
    # market open on its filing date.
    return datetime.combine(filed_on + timedelta(days=1), time.min, UTC)


class SECArchiveCollector:
    def __init__(self, service: Any, sessions: Callable[[], Any], checkpoint: Callable[[], None] | None = None):
        self.service = service
        self.sessions = sessions
        self.checkpoint = checkpoint
        self.interval_seconds = config.sec_archive_interval_hours * 3600

    def symbols(self) -> list[str]:
        configured = [
            raw.strip().upper()
            for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols + "," + ",".join(self.service.dynamic_discovery)).split(",")
            if raw.strip()
        ]
        return list(dict.fromkeys(configured + list(self.service.stocks)))

    def _persist(self, facts: list[dict[str, Any]], filings: dict[str, dict[str, Any]], now: datetime) -> int:
        with self.sessions() as db:
            inserted = 0
            fingerprints = [row["fingerprint"] for row in facts]
            existing: set[str] = set()
            for offset in range(0, len(fingerprints), 500):
                chunk = fingerprints[offset:offset + 500]
                existing.update(db.scalars(select(FundamentalObservation.fingerprint).where(
                    FundamentalObservation.fingerprint.in_(chunk)
                )).all())
            for row in facts:
                if row["fingerprint"] in existing:
                    continue
                db.add(FundamentalObservation(**row))
                inserted += 1
            if filings:
                inserted += persist_candidates(db, candidates_from_filings(filings, now))
            db.commit()
            return inserted

    def _load_reported_eps_cache(self, symbols: list[str], now: datetime) -> int:
        """Rebuild the compact EPS cache from the durable SEC archive.

        The archive table is authoritative for already collected facts. Loading
        this small projection before a new network pass means a transient SEC
        failure cannot hide historical reported EPS that is already stored.
        """
        if not symbols:
            return 0
        with self.sessions() as db:
            rows = list(db.scalars(select(FundamentalObservation).where(
                FundamentalObservation.symbol.in_(symbols),
                FundamentalObservation.concept == "EarningsPerShareDiluted",
            )))
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row.symbol, []).append({
                "period_end": row.period_end.isoformat(),
                "filed_on": row.filed_on.isoformat(),
                "reported_eps": row.value,
                "unit": row.unit,
                "form": row.form,
                "source": {
                    "provider": "SEC EDGAR companyfacts archive",
                    "url": row.source_url,
                    "retrieved_at": row.retrieved_at.isoformat(),
                    "reporting_period": row.period_end.isoformat(),
                    "raw_value": {"concept": row.concept, "filed_on": row.filed_on.isoformat()},
                    "normalized_value": row.value,
                    "description": "Reported diluted EPS stored from a point-in-time SEC companyfacts observation.",
                },
            })
        for symbol, history in grouped.items():
            history.sort(key=lambda item: (item.get("period_end", ""), item.get("filed_on", "")))
            self.service.provider_cache[f"sec:earnings_history:{symbol}"] = cache_record(
                history[-40:], "SEC EDGAR reported EPS", now,
                source_timestamp=now.isoformat(), ttl=7 * 86400,
                coverage="reported_eps_only",
            )
        return sum(1 for history in grouped.values() if history)

    async def collect_once(self, reason: str = "scheduled") -> dict[str, Any]:
        started = datetime.now(UTC)
        if not config.sec_user_agent or "@" not in config.sec_user_agent:
            status = {
                "sec_archive_last_run": started.isoformat(),
                "sec_archive_last_error": "SEC_USER_AGENT is not configured with a contact email.",
                "sec_archive_inserted": 0,
            }
            self.service.schedule_status.update(**status)
            return status
        symbols = self.symbols()
        cached_eps_symbols = self._load_reported_eps_cache(symbols, started)
        if cached_eps_symbols and self.checkpoint:
            self.checkpoint()
        # Raw companyfacts are large and belong in the archive table, not in
        # the runtime snapshot persisted by the engine. Keep this cache local
        # to the archive pass so it cannot bloat settings or hold the engine
        # advisory lock during a snapshot write.
        provider = SECProvider(cache={}, checkpoint=None, user_agent=config.sec_user_agent)
        rows: list[dict[str, Any]] = []
        filing_research: dict[str, dict[str, Any]] = {}
        eps_history: dict[str, list[dict[str, Any]]] = {}
        resolved = 0
        failures = 0
        try:
            for symbol in symbols:
                try:
                    identity = await provider.resolve_company(symbol)
                    fundamentals = await provider.fundamentals(identity.cik)
                    filing_rows = await provider.filings(identity.cik)
                    filing_rows = [
                        item for item in filing_rows
                        if item.form in {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "6-K"}
                    ]
                    resolved += 1
                    filing_research[symbol] = {"filings": [item.model_dump(mode="json") for item in filing_rows]}
                    for fact in fundamentals.facts:
                        rows.append({
                            "fingerprint": _fingerprint(symbol, fact),
                            "symbol": symbol,
                            "cik": fundamentals.cik,
                            "concept": fact.concept,
                            "value": str(fact.value),
                            "unit": fact.unit,
                            "period_start": fact.period_start,
                            "period_end": fact.period_end,
                            "filed_on": fact.filed_on,
                            "accession": fact.accession,
                            "form": fact.form,
                            "available_at": _available_at(fact.filed_on),
                            "source_url": fact.source.url,
                            "retrieved_at": fundamentals.retrieved_at,
                            "data": fact.model_dump(mode="json"),
                        })
                        # SEC companyfacts gives us a defensible, point-in-time
                        # history of reported EPS.  Keep it separate from the
                        # Alpha Vantage estimate/surprise history: reported EPS
                        # alone cannot measure analyst-estimate uncertainty.
                        if fact.concept == "EarningsPerShareDiluted":
                            eps_history.setdefault(symbol, []).append({
                                "period_end": fact.period_end.isoformat(),
                                "filed_on": fact.filed_on.isoformat(),
                                "reported_eps": fact.value,
                                "unit": fact.unit,
                                "form": fact.form,
                                "source": fact.source.model_dump(mode="json"),
                            })
                except Exception:
                    failures += 1
        finally:
            await provider.aclose()
        inserted = await asyncio.to_thread(self._persist, rows, filing_research, started)
        # Persist a compact runtime cache for live research. This is deliberately
        # reported-EPS-only and is never used to manufacture estimate surprises.
        for symbol, history in eps_history.items():
            history.sort(key=lambda item: (item.get("period_end", ""), item.get("filed_on", "")))
            self.service.provider_cache[f"sec:earnings_history:{symbol}"] = cache_record(
                history[-40:], "SEC EDGAR reported EPS", datetime.now(UTC),
                source_timestamp=started.isoformat(), ttl=7 * 86400,
                coverage="reported_eps_only",
            )
        if eps_history and self.checkpoint:
            self.checkpoint()
        status = {
            "sec_archive_last_run": started.isoformat(),
            "sec_archive_last_success": datetime.now(UTC).isoformat(),
            "sec_archive_last_reason": reason,
            "sec_archive_symbols": len(symbols),
            "sec_archive_resolved": resolved,
            "sec_archive_failures": failures,
            "sec_archive_facts": len(rows),
            "sec_archive_inserted": inserted,
            "sec_archive_last_error": None,
            "sec_archive_eps_cache_symbols": max(cached_eps_symbols, len(eps_history)),
        }
        self.service.schedule_status.update(**status)
        if self.service.data_engine:
            self.service.data_engine.changed = True
        return status

    async def run(self) -> None:
        # Do not launch a second full SEC companyfacts pass while the first
        # live research refresh is still assembling the current dashboard.
        # Waiting here preserves coverage while avoiding a startup request
        # storm and leaves the API responsive during the expensive first pass.
        while not (
            self.service.schedule_status.get("last_success")
            or self.service.schedule_status.get("last_error")
        ):
            await asyncio.sleep(5)
        while True:
            try:
                # Keep the first expensive archive pass out of the API event
                # loop. Health checks and streaming must remain responsive while
                # SEC requests and the bulk database transaction run.
                await asyncio.sleep(15)
                reason = "startup" if not self.service.schedule_status.get("sec_archive_last_success") else "scheduled"
                await asyncio.to_thread(asyncio.run, self.collect_once(reason))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.service.schedule_status.update(
                    sec_archive_last_error=(
                        "SEC archive collection failed; existing observations remain available "
                        f"({type(error).__name__})."
                    ),
                    sec_archive_last_error_at=datetime.now(UTC).isoformat(),
                )
            await asyncio.sleep(self.interval_seconds)
