"""Slow analysis snapshots and fast quote/state updates are deliberately separate."""

import asyncio
import copy
import math
from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import accounting
from .calendar import market_status
from .config import config
from .db import SessionLocal
from .engine import MODEL_VERSION, analyze_stock, position_size, trade_state
from .fixtures import demo_stocks
from .models import Alert, Analysis, Equity, Setting, Shadow
from .schemas import Settings
from .ml import MLEngine


class EngineService:
    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.stocks: dict[str, dict[str, Any]] = {}
        self.prices: dict[str, float] = {}
        self.previous_states: dict[str, str] = {}
        self.overrides: dict[str, float] = {}
        self.tick = 0
        self.last_slow_refresh = datetime.now(UTC)
        self.provider_status = "Deterministic simulation. Prices and company inputs are fictional."
        self.provider: Any = None
        self.research: dict[str, Any] = {}
        self.provider_cache: dict[str, Any] = {}
        self.provider_health: dict[str, Any] = {}
        self.fx: dict[str, Any] = {}
        self.market_values: dict[str, Any] = {}
        self.stream_status: dict[str, Any] = {"status": "waiting", "connected": False,
                                            "subscribed_symbols": [], "last_event_at": None}
        self.hot_symbols: list[str] = []
        self.warm_symbols: list[str] = []
        self.dynamic_discovery: list[str] = []
        self.capacity_error: str | None = None
        self.schedule_status: dict[str, Any] = {}
        self.data_engine: Any = None
        self.usage_checkpoint: Any = None
        self.last_equity_at = datetime(1970, 1, 1, tzinfo=UTC)
        self.ml = MLEngine()
        # Historical projection matching is intentionally cached separately
        # from live prices. Recomputing all cones on every dashboard poll can
        # starve health checks and mobile clients without changing the evidence.
        self.projection_cache: dict[str, tuple[datetime, dict[str, Any]]] = {}
        self.ml_maintenance_task: asyncio.Task[Any] | None = None
        self.market_session: dict[str, Any] = {
            "observations_today": 0,
            "symbols_today": 0,
            "first_observed_at": None,
            "last_observed_at": None,
            "storage": "minute observations",
        }

    @property
    def mode(self) -> str:
        return "paper" if config.app_mode == "demo" else "manual"

    def settings(self, db: Session) -> Settings:
        row = db.get(Setting, 1)
        if row is None:
            row = Setting(id=1, data=Settings().model_dump())
            db.add(row)
            db.flush()
        return Settings.model_validate(row.data)

    async def initialize(self) -> None:
        from .runtime import RUNTIME_IDS, acquire_database_lock, capture_state, restore_state

        with SessionLocal() as db:
            acquire_database_lock(db)
            self.settings(db)
            saved = db.get(Setting, RUNTIME_IDS[config.app_mode])
            if saved:
                restore_state(self, saved.data)
                # A process can be stopped while a research pass is in
                # flight. Never present that old flag as an active pass after
                # restart; the scheduler will start a fresh, visible pass.
                if self.schedule_status.get("running"):
                    self.schedule_status.update(
                        running=False,
                        reason="restart_recovery",
                        last_error="The previous research pass was interrupted by a restart; awaiting the next pass.",
                    )
            runtime = db.get(Setting, 2)
            if runtime and config.app_mode == "demo":
                self.tick = runtime.data.get("tick", 0)
                self.overrides = runtime.data.get("overrides", {})
            if config.app_mode == "demo":
                await self.slow_refresh(db)
            else:
                # Boot immediately from saved observations. A first-ever
                # install still needs a seed snapshot, but an existing live
                # database must not make the health endpoint wait on a full
                # provider pass after every container restart.
                if not self.stocks:
                    # Do not block the ASGI lifespan on the first live provider
                    # pass.  A fresh install or a missing snapshot can require
                    # many provider calls; DataEngine.slow_loop performs that
                    # refresh after the API, health endpoint, and stream are
                    # already available.
                    self.provider_status = "Waiting for the first live research pass."
                    self.schedule_status.setdefault("research_pass", "waiting")
                self.stream_status = {"status": "waiting", "connected": False,
                                      "subscribed_symbols": [], "last_event_at": None}
            # A live restart already restored the persisted snapshot above.
            # Rewriting that large JSON document during lifespan startup can
            # hold the pooler transaction long enough to make health and login
            # appear offline.  The streaming checkpoint persists subsequent
            # changes; only create the row here when no snapshot exists.
            if not saved:
                db.add(Setting(id=RUNTIME_IDS[config.app_mode], data=capture_state(self)))
            db.commit()

    async def slow_refresh(self, db: Session) -> None:
        now = datetime.now(UTC)
        settings = self.settings(db)
        previous = self.stocks
        if config.app_mode == "demo":
            self.stocks = {f["symbol"]: analyze_stock(f, settings.horizon, now) for f in demo_stocks(now)}
            for symbol, stock in self.stocks.items():
                stock["changes"] = []
                old = previous.get(symbol)
                if old:
                    for metric in ("opportunity", "risk", "confidence"):
                        difference = round(stock[metric] - old[metric], 1)
                        if abs(difference) >= 2:
                            stock["changes"].append(
                                f"{metric.capitalize()} changed {difference:+g} after recalculation."
                            )
                if not stock["changes"]:
                    stock["changes"] = ["No material change in the deterministic demo inputs."]
                self.prices.setdefault(symbol, stock["price"])
            self.provider_status = "Deterministic simulation. Prices and company inputs are fictional."
        else:
            await self.refresh_live(history=True, db=db)
        for stock in self.stocks.values():
            stock["analysis_horizon"] = settings.horizon
            if config.app_mode == "live":
                latest = db.scalar(select(Analysis).where(
                    Analysis.symbol == stock["symbol"], Analysis.mode == "live"
                ).order_by(Analysis.id.desc()).limit(1))
                if latest and accounting.utc(latest.created_at).date() == now.date() and (
                    latest.data.get("analysis_horizon") == settings.horizon
                ):
                    continue  # Keep one daily research snapshot per horizon; current data lives in runtime.
            db.add(
                Analysis(
                    symbol=stock["symbol"],
                    mode=config.app_mode,
                    created_at=now,
                    model_version=MODEL_VERSION,
                    data=copy.deepcopy(stock),
                )
            )
            # ML snapshots are point-in-time evidence only. They are captured
            # after the deterministic research refresh and never alter it.
            self.ml.capture(db, symbol=stock["symbol"], stock=stock, now=now)
            prediction = self.ml.predict(stock, symbol=stock["symbol"], now=now, db=db)
            if prediction is not None and self.ml.shadow_mode:
                self.ml.attach_shadow(db, stock["symbol"], prediction, now)
        if config.ml_maintenance_enabled and (
            self.ml_maintenance_task is None or self.ml_maintenance_task.done()
        ):
            # Walk-forward evaluation and candidate training are deliberately
            # kept off the event loop. A slow model job must never make the
            # health endpoint, live stream, or price ticks appear offline.
            self.ml_maintenance_task = asyncio.create_task(self._run_ml_maintenance())
        self.last_slow_refresh = now

    async def _run_ml_maintenance(self) -> None:
        def run() -> dict[str, Any]:
            with SessionLocal() as maintenance_db:
                result = self.ml.scheduled_maintenance(maintenance_db)
                maintenance_db.commit()
                return result

        try:
            await asyncio.to_thread(run)
        except (OSError, ValueError):
            # Maintenance is offline work; a failed candidate must never
            # interrupt live price/state updates.
            return

    async def refresh_live(self, history: bool = False, db: Session | None = None,
                           selected_symbols: list[str] | None = None) -> None:
        from .live_data import build_live_research
        from .providers import AlpacaMarketDataProvider, AlphaVantageProvider, ProviderError, SECProvider

        self.projection_cache.clear()
        universe = list(dict.fromkeys(
            [
                s.strip().upper()
                for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols).split(",")
                if (s := raw.strip())
            ] + list(self.dynamic_discovery)
        ))
        symbols = list(dict.fromkeys(selected_symbols or universe))
        unknown = [symbol for symbol in symbols if symbol not in universe]
        if unknown:
            raise ValueError(f"Research symbols are outside the configured universe: {', '.join(unknown)}")
        discovery_symbols = set(config.discovery_symbols.split(",")) | set(self.dynamic_discovery)
        # A changed universe must not leave removed candidates visible from a
        # previously persisted runtime snapshot. Open positions are expected to
        # remain in LIVE_SYMBOLS or SCAN_SYMBOLS so their monitoring continues.
        configured_symbols = set(universe)
        for stale in set(self.stocks) - configured_symbols:
            self.stocks.pop(stale, None)
            self.prices.pop(stale, None)
            self.market_values.pop(stale, None)
        now = datetime.now(UTC)
        if self.provider is None:
            try:
                self.provider = AlpacaMarketDataProvider(
                    api_key=config.apca_api_key_id, secret_key=config.apca_api_secret_key,
                    cache=self.provider_cache, checkpoint=self.usage_checkpoint
                )
            except ProviderError:
                pass

        # Slow research has its own cached observations and success timestamps.
        # A fresh quote must never make an old filing or failed news check fresh.
        if history:
            sec = None
            alpha = None
            # SEC companyfacts responses are large raw archives. Keep them out
            # of the runtime snapshot; only the normalized research cache and
            # provider usage counters belong in the persistent engine state.
            sec_cache: dict[str, Any] = {}
            try:
                try:
                    sec = SECProvider(user_agent=config.sec_user_agent, cache=sec_cache, checkpoint=None)
                except ProviderError:
                    pass
                try:
                    alpha = AlphaVantageProvider(
                        api_key=config.alpha_vantage_api_key, cache=self.provider_cache,
                        daily_limit=config.alpha_vantage_daily_limit,
                        history_reserve=config.alpha_vantage_history_reserve,
                        checkpoint=self.usage_checkpoint
                    )
                except ProviderError:
                    pass
                research = await build_live_research(
                    symbols, market=self.provider, sec=sec, alpha=alpha,
                    cache=self.provider_cache, now=now,
                )
                if selected_symbols:
                    self.research.update(research["by_symbol"])
                    self.provider_health.update(research["provider_health"])
                else:
                    self.research = research["by_symbol"]
                    self.provider_health = research["provider_health"]
                self.fx = {}  # V1 reserves Alpha Vantage solely for the daily earnings calendar.
            finally:
                if sec:
                    await sec.aclose()
                    if "api_usage_v1" in sec_cache:
                        self.provider_cache["api_usage_v1"] = sec_cache["api_usage_v1"]
                if alpha:
                    await alpha.aclose()

        # Live prices come exclusively from the one IEX stream. Slow research
        # never polls latest_quotes, and cannot make an old market value fresh.
        quotes: dict[str, Any] = {}
        for symbol in symbols:
            prior = self.stocks.get(symbol, {})
            record = self.research.get(symbol, {})
            quote = quotes.get(symbol)
            stream_state = self.market_values.get(symbol, {})
            stream_quote_current = False
            stream_timestamp = None
            try:
                stream_timestamp = datetime.fromisoformat(str(stream_state.get("timestamp")).replace("Z", "+00:00"))
                stream_quote_current = (
                    stream_state.get("price_basis") == "quote"
                    and stream_state.get("bid") is not None
                    and stream_state.get("ask") is not None
                    and -5 <= (now - stream_timestamp).total_seconds() <= 90
                )
            except (TypeError, ValueError):
                stream_quote_current = False
            analysis_record = copy.deepcopy(record)
            previous_close = record.get("previous_close", prior.get("previous_close"))
            price = float(quote.price) if quote else (float(stream_state["price"]) if stream_quote_current else prior.get("price") or previous_close or 0.0)
            timestamp = quote.timestamp.isoformat() if quote else (stream_timestamp.isoformat() if stream_quote_current else prior.get("freshness", {}).get("market_at"))
            using_completed_close = not quote and not stream_quote_current and previous_close is not None and not market_status(now)["is_open"]
            if using_completed_close:
                price = previous_close
                timestamp = record.get("history_at") or timestamp
            history_values = record.get("history", prior.get("history", []))
            change_reference = history_values[-2] if using_completed_close and len(history_values) > 1 else previous_close
            quote_current = (quote is not None and -5 <= (now - quote.timestamp).total_seconds() <= 90) or stream_quote_current
            sources = copy.deepcopy(record.get("sources", []))
            if quote:
                source = quote.source.model_dump(mode="json")
                source["id"] = f"alpaca-{symbol.lower()}-quote"
                sources.insert(0, source)
            elif stream_quote_current:
                source = {
                    "id": f"alpaca-{symbol.lower()}-quote",
                    "provider": "Alpaca IEX streaming",
                    "url": "https://docs.alpaca.markets/docs/real-time-stock-pricing-data",
                    "retrieved_at": now.isoformat(),
                    "published_at": stream_timestamp.isoformat(),
                    "reporting_period": None,
                    "raw_value": {"bid": stream_state.get("bid"), "ask": stream_state.get("ask")},
                    "normalized_value": {"price": price, "spread_pct": (float(stream_state["ask"]) - float(stream_state["bid"])) / price},
                    "description": "Indicative IEX bid/ask midpoint and observed spread; not a Trading 212 executable quote.",
                }
                sources.insert(0, source)
                analysis_record.setdefault("metrics", {})["spread_pct"] = source["normalized_value"]["spread_pct"]
                analysis_record.setdefault("metric_sources", {})["spread_pct"] = source["id"]
            else:
                sources[0:0] = [s for s in prior.get("sources", []) if s["id"] == f"alpaca-{symbol.lower()}-quote"]
            feed = quote.feed if quote_current and quote is not None else "REAL-TIME" if stream_quote_current else "UNAVAILABLE"
            if not market_status(now)["is_open"]:
                if quote_current:
                    feed = "MARKET CLOSED"
                elif using_completed_close:
                    feed = "END OF DAY"
            missing = record.get("missing_reasons", ["Research providers have not completed a refresh."])
            events = [{
                "label": "Expected earnings", "date": event.get("date"),
                "detail": event.get("text", "Provider estimate; not a confirmed company announcement."),
                "source_id": event["source_id"],
            } for event in record.get("next_events", [])]
            self.stocks[symbol] = {
                "symbol": symbol, "name": record.get("name", symbol),
                "research_lane": "discovery" if symbol in discovery_symbols else "core",
                "sector": record.get("sector", "Industry not verified"),
                "company_type": "Unclassified", "classification_confidence": 0,
                "classification_version": MODEL_VERSION,
                "price": price, "previous_close": previous_close,
                "history": history_values,
                "price_basis": "completed_close" if using_completed_close else "quote",
                "price_as_of": record.get("history_at") if using_completed_close else timestamp,
                "change_reference": change_reference,
                "change_pct": (price / change_reference - 1) * 100 if change_reference and price else None,
                "opportunity": None, "risk": None, "confidence": 0, "confidence_label": "LOW",
                "opportunity_components": [], "risk_components": [], "plan": None,
                "freshness": {
                    "market_at": timestamp, "financial_period": record.get("financial_period", "DATA MISSING"),
                    "news_checked_at": record.get("news_checked_at"), "feed": feed, "status": "missing",
                },
                "reasons": [],
                "risks": [{"text": reason, "source_id": ""} for reason in missing],
                "next_events": events,
                "changes": ["Verified observations only. Core evidence and a current quote are required before a plan can be actionable."],
                "sources": sources, "business_warning": False, "research": copy.deepcopy(analysis_record),
            }
            # Run the same deterministic engine used by demo mode against the
            # point-in-time live snapshot.  Previously live mode stopped after
            # fetching providers, so the UI could only show NO_SETUP with empty
            # Opportunity/Risk values even when the feeds were healthy.  The
            # engine still owns eligibility and keeps ``plan`` as None when a
            # required input is unavailable.
            source_ids = {item.get("id") for item in sources}
            metric_sources = dict(analysis_record.get("metric_sources", {}))
            if "price" not in metric_sources:
                history_id = f"alpaca-{symbol.lower()}-history"
                quote_id = f"alpaca-{symbol.lower()}-quote"
                if quote_id in source_ids:
                    metric_sources["price"] = quote_id
                elif history_id in source_ids:
                    metric_sources["price"] = history_id
            analysis_fixture = {
                "symbol": symbol,
                "name": record.get("name", symbol),
                "sector": record.get("sector", "Industry unavailable"),
                "sector_group": record.get("sector_group", "other"),
                "metrics": analysis_record.get("metrics", {}),
                "raw_metrics": analysis_record.get("raw_metrics", {}),
                "history": history_values,
                "history_timestamps": record.get("history_timestamps", prior.get("history_timestamps", [])),
                "price": price,
                "market_at": timestamp or record.get("history_at"),
                "financial_as_of": record.get("financial_as_of"),
                "financial_period": record.get("financial_period"),
                "news_checked_at": record.get("news_checked_at"),
                "feed": feed,
                "metric_sources": metric_sources,
                "sources": sources,
                "events": events,
                "business_warning": False,
                "live": True,
            }
            # A DataEngine research worker may run without a database session;
            # use the normal settings default in that isolated copy. The
            # committed live service still supplies the persisted horizon.
            horizon = self.settings(db).horizon if db is not None else Settings().horizon
            analysis = analyze_stock(analysis_fixture, horizon, now)
            for key in (
                "company_type", "classification_confidence", "classification_version", "opportunity",
                "risk", "confidence", "confidence_label", "opportunity_components", "risk_components",
                "plan", "explanation", "freshness", "reasons", "risks", "next_events", "eligibility",
            ):
                self.stocks[symbol][key] = analysis[key]
            self.stocks[symbol]["research"] = copy.deepcopy(analysis_record)
            if price > 0:
                self.prices[symbol] = price
        self.provider_status = (
            ("LIVE PRICES UNAVAILABLE. " if not self.stream_status.get("connected") else "") +
            "LIVE FEED: ALPACA IEX. NOT CONSOLIDATED NBBO. "
            "Trading 212 is the final execution-price check. Optional evidence gaps lower confidence and remain visible."
        )

    def accept_market_event(self, event: dict[str, Any]) -> bool:
        from .market_state import apply_event

        symbol = event.get("symbol")
        if symbol not in self.hot_symbols or symbol not in self.stocks:
            return False
        value = self.market_values.setdefault(symbol, {})
        if not apply_event(value, event, datetime.now(UTC)):
            return False
        if event.get("type") != "bar" and value.get("price"):
            self.prices[symbol] = value["price"]
            stock = self.stocks[symbol]
            stock["price"] = value["price"]
            stock["price_basis"] = value["price_basis"]
            stock["price_as_of"] = value["timestamp"]
            stock["freshness"]["market_at"] = value["timestamp"]
            stock["freshness"]["feed"] = "REAL-TIME"
        return True

    def data_status(self) -> dict[str, Any]:
        from .api_usage import usage_snapshot

        providers = {item["provider"]: {**item, "requests_minute": item["requests_this_minute"]}
                     for item in usage_snapshot(self.provider_cache)}
        for name, configured in (("alpaca", bool(config.apca_api_key_id and config.apca_api_secret_key)),
                                 ("sec", bool(config.sec_user_agent)),
                                 ("alpha_vantage", bool(config.alpha_vantage_api_key))):
            providers[name]["configured"] = configured
            error = providers[name].get("last_error")
            if isinstance(error, dict):
                providers[name]["last_error"] = error.get("code")
        providers["alpha_vantage"]["daily_limit"] = config.alpha_vantage_daily_limit
        budget = self.provider_cache.get("alpha_vantage_budget", {})
        today = datetime.now(UTC).date().isoformat()
        used = budget.get("calls", 0) if isinstance(budget, dict) and budget.get("day") == today else 0
        schedule = dict(self.schedule_status)
        schedule["alpha_vantage_budget_remaining"] = max(0, config.alpha_vantage_daily_limit - used)
        schedule["alpha_vantage_next_reset"] = datetime.combine(
            datetime.now(UTC).date() + timedelta(days=1), datetime.min.time(), UTC
        ).isoformat()
        return {"stream": {"connected_at": None, **self.stream_status, "feed": "Alpaca IEX"},
                "market_session": copy.deepcopy(self.market_session), "providers": providers,
                "hot_symbols": self.hot_symbols, "warm_symbols": self.warm_symbols,
                "max_hot_symbols": config.max_hot_symbols, "capacity_error": self.capacity_error,
                "price_stale_seconds": config.price_stale_seconds, "schedule": schedule}

    def position_plans(self, db: Session) -> dict[str, Any]:
        plans: dict[str, Any] = {}
        quantities: dict[str, Decimal] = {}
        for trade in accounting.rows(db, self.mode):
            quantity = quantities.get(trade.symbol, Decimal(0))
            if trade.side == "buy":
                if quantity == 0:
                    plans[trade.symbol] = trade.entry_snapshot.get("plan")
                quantities[trade.symbol] = quantity + Decimal(trade.quantity)
            else:
                quantities[trade.symbol] = quantity - Decimal(trade.quantity)
                if quantities[trade.symbol] == 0:
                    plans.pop(trade.symbol, None)
        return plans

    def dashboard(self, db: Session) -> dict[str, Any]:
        now = datetime.now(UTC)
        settings = self.settings(db)
        session = market_status(now)
        p = accounting.portfolio(db, self.prices, settings.fx_usd_per_eur, self.mode)
        if self.fx and abs(float(self.fx.get("rate", 0)) - settings.fx_usd_per_eur) < 0.00000001:
            p["fx_source"] = f"Alpha Vantage EUR/USD observation at {self.fx.get('timestamp', 'unknown time')}"
        owned = {position["symbol"] for position in p["positions"]}
        original_plans = self.position_plans(db)
        stocks = []
        for symbol, base in self.stocks.items():
            # Dashboard updates run on every live heartbeat. Copying the full
            # research payload here duplicated historical bars and provenance
            # for every symbol once per second. The dashboard only mutates its
            # top-level view plus freshness/market dictionaries, so keep the
            # evidence payload shared and copy the mutable views explicitly.
            stock = dict(base)
            stock["freshness"] = dict(base.get("freshness", {}))
            if isinstance(base.get("market"), dict):
                stock["market"] = dict(base["market"])
            stock["price"] = self.prices.get(symbol, base["price"])
            change_reference = stock.get("change_reference", stock.get("previous_close"))
            stock["change_pct"] = round((stock["price"] / change_reference - 1) * 100, 2) if change_reference else None
            if symbol in owned:
                stock["plan"] = original_plans.get(symbol)
                stock["plan_basis"] = "Frozen at the first fill of this open position."
            try:
                quote_time = datetime.fromisoformat(stock["freshness"]["market_at"].replace("Z", "+00:00"))
                age = (now - accounting.utc(quote_time)).total_seconds()
                quote_current = -5 <= age <= 90
            except (ValueError, TypeError, AttributeError):
                quote_current = False
            fresh = stock["freshness"]["status"] == "current" and quote_current
            if config.app_mode == "live":
                from .market_state import market_view

                view = market_view(self.market_values.get(symbol, {}), now=now,
                                   connected=bool(self.stream_status.get("connected")) and symbol not in self.stream_status.get("stale_symbols", []),
                                   subscribed=symbol in self.stream_status.get("subscribed_symbols", []),
                                   hot=symbol in self.hot_symbols, stale_seconds=config.price_stale_seconds)
                # The slow research pass can finish just before the stream
                # supplies a current bid/ask. Re-run the deterministic view
                # from the already persisted point-in-time evidence so live
                # eligibility does not retain a stale "spread missing" gate.
                # This performs no provider I/O and never relaxes any engine
                # threshold; it only synchronizes the evidence snapshot.
                current_quote = bool(
                    not view.get("stale") and view.get("price") and
                    view.get("bid") is not None and view.get("ask") is not None
                )
                current_missing = set(stock.get("eligibility", {}).get("missing_inputs", []))
                if (
                    symbol not in owned and isinstance(stock.get("research"), dict)
                    and current_quote and ({"spread_pct", "price"} & current_missing)
                ):
                    record = copy.deepcopy(stock["research"])
                    metrics = record.setdefault("metrics", {})
                    metric_sources = dict(record.get("metric_sources", {}))
                    quote_price = view.get("price")
                    bid = view.get("bid")
                    ask = view.get("ask")
                    if quote_price and bid is not None and ask is not None:
                        metrics["spread_pct"] = max(0.0, float(ask) - float(bid)) / float(quote_price)
                        metric_sources["spread_pct"] = f"alpaca-{symbol.lower()}-quote"
                    analysis_fixture = {
                        "symbol": symbol,
                        "name": stock.get("name", symbol),
                        "sector": stock.get("sector", "Industry unavailable"),
                        "sector_group": record.get("sector_group", "other"),
                        "metrics": metrics,
                        "raw_metrics": record.get("raw_metrics", {}),
                        "history": stock.get("history", []),
                        "history_timestamps": record.get("history_timestamps", []),
                        "price": stock.get("price"),
                        "market_at": stock.get("freshness", {}).get("market_at"),
                        "financial_as_of": record.get("financial_as_of"),
                        "financial_period": record.get("financial_period"),
                        "news_checked_at": record.get("news_checked_at"),
                        "feed": stock.get("freshness", {}).get("feed"),
                        "metric_sources": metric_sources,
                        "sources": stock.get("sources", []),
                        "events": record.get("next_events", []),
                        "business_warning": stock.get("business_warning", False),
                        "live": True,
                    }
                    refreshed = analyze_stock(analysis_fixture, settings.horizon, now)
                    for key in (
                        "company_type", "classification_confidence", "classification_version", "opportunity",
                        "risk", "confidence", "confidence_label", "opportunity_components", "risk_components",
                        "plan", "explanation", "freshness", "reasons", "risks", "next_events", "eligibility",
                    ):
                        stock[key] = refreshed[key]
                    stock["research"] = record
                stock["market"] = view
                stock["watchlist_tier"] = "HOT" if symbol in self.hot_symbols else "WARM"
                quote_current = not view["stale"] and not self.capacity_error
                # A fresh quote alone does not repair incomplete research.
                fresh = quote_current and stock["freshness"]["status"] == "current"
                if stock.get("plan") and stock["freshness"]["status"] == "stale":
                    fresh = False
            if config.app_mode == "live" and not quote_current and stock["freshness"]["feed"] in {"REAL-TIME", "DELAYED"}:
                stock["freshness"]["feed"] = "UNAVAILABLE"
            if not fresh and stock["freshness"]["status"] == "current":
                stock["freshness"]["status"] = "stale"
            if config.app_mode == "live" and not session["is_open"]:
                if stock["freshness"]["feed"] in {"REAL-TIME", "DELAYED"}:
                    stock["freshness"]["feed"] = "MARKET CLOSED"
                fresh = False
            prediction = self.ml.predict(stock, symbol=symbol, now=now, db=db)
            if prediction is not None:
                stock["ml"] = prediction
            # Historical projections are read-only evidence and should remain
            # visible while the staged research pass is running. Previously we
            # suppressed them for the entire pass, which made a ready
            # projection history look like it had disappeared. Keep a short
            # service-level cache so polling does not repeatedly rebuild the
            # analogue map; the ML engine also caches its per-symbol result.
            projection = None
            cached_projection = self.projection_cache.get(symbol)
            if cached_projection and (now - cached_projection[0]).total_seconds() < 300:
                projection = copy.deepcopy(cached_projection[1])
            else:
                projection = self.ml.project(stock, symbol=symbol, now=now, db=db)
                if projection is not None:
                    self.projection_cache[symbol] = (now, copy.deepcopy(projection))
            if projection is not None:
                stock["projection"] = projection
            state, explanation = trade_state(
                stock["price"], stock["plan"], symbol in owned, fresh, stock.get("business_warning", False)
            )
            if prediction is not None:
                from .ml.decision import combine_decision

                combined = combine_decision(
                    deterministic_state=state, opportunity=stock.get("opportunity"), risk=stock.get("risk"),
                    prediction=prediction, influence_enabled=self.ml.influence_enabled,
                    fresh=fresh, liquidity_ok=not bool(stock.get("business_warning")),
                    event_risk=bool(stock.get("research", {}).get("event_risk", False)), owned=symbol in owned,
                )
                state = combined["state"]
                if combined["ml_applied"]:
                    explanation = combined["reason"]
            stock["sizing"] = position_size(
                stock["plan"], stock["price"], p["total_eur"], p["cash_eur"], settings.model_dump()
            )
            if symbol in owned and stock["plan"]:
                position = next(item for item in p["positions"] if item["symbol"] == symbol)
                plan = stock["plan"]

                def net_at(level: float, holding: dict = position) -> float:
                    return (
                        holding["quantity"] * level * 0.999 / settings.fx_usd_per_eur * (1 - settings.fx_fee_pct)
                        - settings.fixed_fee_eur
                        - holding["cost_eur"]
                    )

                stock["sizing"] = {
                    "amount_eur": position["cost_eur"],
                    "quantity": position["quantity"],
                    "planned_downside_eur": round(max(0, -net_at(plan["reconsider"])), 2),
                    "first_profit_eur": round(net_at(plan["first_profit_low"]), 2),
                    "strong_profit_eur": round(net_at(plan["strong_profit_low"]), 2),
                    "viable": False,
                    "reason": "Based on remaining recorded shares, original levels, and estimated exit costs. Gaps and FX can increase losses.",
                }
            if symbol not in owned and state == "BUY_AREA" and not stock["sizing"]["viable"]:
                state, explanation = "SKIP", stock["sizing"]["reason"]
            if config.app_mode == "live" and stock["plan"] is None:
                state = "WATCH_CLOSELY" if symbol in owned else "NO_SETUP"
                explanation = "Company inputs are incomplete. No calculated trade plan is available."
            if config.app_mode == "live" and (not quote_current or not session["is_open"]):
                if state in {"BUY_AREA", "TAKE_PROFIT", "RECONSIDER_EXIT"}:
                    state = "WATCH_CLOSELY" if symbol in owned else "WAIT"
                    explanation = "PRICE DATA STALE. Wait for fresh HOT-stream data; check Trading 212 manually."
            opportunity = stock.get("opportunity")
            risk = stock.get("risk")
            confidence = stock.get("confidence") or 0
            worth_score = round((opportunity + (100 - risk) + confidence) / 3) if opportunity is not None and risk is not None else None
            missing_inputs = bool(stock.get("research", {}).get("missing_reasons"))
            if (missing_inputs or stock.get("plan") is None) and config.app_mode == "live":
                decision_label = "RESEARCH INCOMPLETE"
            elif risk is not None and risk >= 85:
                decision_label = "AVOID"
            elif state in {"BUY_AREA", "TAKE_PROFIT"} and worth_score is not None and worth_score >= 67:
                decision_label = "STRONG CANDIDATE"
            elif worth_score is not None and worth_score >= 45:
                decision_label = "WORTH REVIEWING"
            else:
                decision_label = "WATCH ONLY"
            stock["actionable"] = bool(config.app_mode == "live" and fresh and session["is_open"]
                                       and state in {"BUY_AREA", "TAKE_PROFIT", "RECONSIDER_EXIT"})
            stock.update(state=state, explanation=explanation, worth_score=worth_score,
                         decision_label=decision_label)
            stocks.append(stock)
        alerts = list(
            db.scalars(select(Alert).where(Alert.mode == config.app_mode).order_by(Alert.id.desc()).limit(15))
        )
        queue_items = []
        blockers: Counter[str] = Counter()
        for stock in stocks:
            missing = list(stock.get("research", {}).get("missing_reasons", []))
            if not missing and stock.get("plan") is not None:
                continue
            for reason in missing:
                blockers[reason] += 1
            queue_items.append({
                "symbol": stock["symbol"],
                "lane": stock.get("research_lane", "core"),
                "missing": missing[:6] or ["A complete deterministic trade plan has not been produced yet."],
            })
        readiness_specs = [
            (
                "Company fundamentals",
                ("debt", "capex", "concentration", "revenue"),
                "SEC filing review for debt, capex, concentration, and comparable revenue.",
            ),
            (
                "Peer valuation",
                ("peer valuation", "peer_multiple"),
                "A comparable valuation basis from at least two peer issuers.",
            ),
            (
                "Earnings evidence",
                ("estimate-uncertainty", "earnings history", "earnings timing"),
                "Alpha Vantage earnings rows and a forthcoming calendar observation.",
            ),
            (
                "Live execution data",
                ("spread", "liquidity", "price", "history"),
                "A current stream quote plus usable price and volume history.",
            ),
        ]
        evidence_readiness = []
        for label, terms, next_step in readiness_specs:
            blocked_symbols = {
                item["symbol"]
                for item in queue_items
                if any(term in reason.lower() for reason in item["missing"] for term in terms)
            }
            total = len(stocks)
            blocked = len(blocked_symbols)
            evidence_readiness.append({
                "label": label,
                "ready": max(0, total - blocked),
                "total": total,
                "status": "ready" if blocked == 0 else "partial" if blocked < total else "waiting",
                "next_step": next_step,
            })
        projection_status = self.ml.projection_status(db)
        evidence_readiness.append({
            "label": "Historical projections",
            "ready": len(stocks) if projection_status.get("status") == "ready" else 0,
            "total": len(stocks),
            "status": "ready" if projection_status.get("status") == "ready" else "waiting",
            "next_step": "Use labelled historical cases; confidence remains reduced while drift is material.",
        })
        shadow = list(db.scalars(select(Shadow)))
        return {
            "mode": config.app_mode,
            "now": now.isoformat(),
            "model_version": MODEL_VERSION,
            "settings": settings.model_dump(),
            "market": session,
            "data_status": self.data_status(),
            "ml": self.ml.dashboard(db),
            "portfolio": p,
            "stocks": stocks,
            "research_queue": {
                "total": len(queue_items),
                "complete": len(stocks) - len(queue_items),
                "items": queue_items,
                "top_blockers": [{"reason": reason, "count": count} for reason, count in blockers.most_common(8)],
                "evidence_readiness": evidence_readiness,
            },
            "alerts": [
                {
                    "id": a.id,
                    "symbol": a.symbol,
                    "state": a.state,
                    "message": a.message,
                    "created_at": accounting.utc(a.created_at).isoformat(),
                }
                for a in alerts
            ],
            "journal": accounting.journal(db, self.mode),
            "shadow": {
                "signals": len(shadow),
                "open": sum(s.status == "open" for s in shadow),
                "closed": sum(s.status == "closed" for s in shadow),
                "realized_pnl_eur": round(sum(s.data.get("pnl_eur", 0) for s in shadow), 6),
            },
            "last_slow_refresh": self.last_slow_refresh.isoformat(),
            "provider_status": self.provider_status,
            "provider_health": self.provider_health,
            "fx": self.fx or None,
        }

    async def fast_tick(self, db: Session) -> None:
        now = datetime.now(UTC)
        self.tick += 1
        if config.app_mode == "demo":
            for i, (symbol, base) in enumerate(self.stocks.items()):
                self.prices[symbol] = self.overrides.get(
                    symbol, round(base["price"] * (1 + 0.012 * math.sin((self.tick + i * 3) / 9)), 2)
                )
                base["freshness"]["market_at"] = now.isoformat()
            row = db.get(Setting, 2)
            data = {"tick": self.tick, "overrides": self.overrides}
            if row:
                row.data = data
            else:
                db.add(Setting(id=2, data=data))
        dashboard = self.dashboard(db)
        for stock in dashboard["stocks"]:
            previous = self.previous_states.get(stock["symbol"])
            state = stock["state"]
            if (
                previous
                and previous != state
                and state in {"BUY_AREA", "TAKE_PROFIT", "WATCH_CLOSELY", "RECONSIDER_EXIT"}
            ):
                recent = db.scalar(
                    select(Alert).where(
                        Alert.symbol == stock["symbol"],
                        Alert.mode == config.app_mode,
                        Alert.state == state,
                        Alert.created_at > now - timedelta(minutes=5),
                    )
                )
                if recent is None:
                    db.add(
                        Alert(
                            symbol=stock["symbol"],
                            mode=config.app_mode,
                            state=state,
                            message=stock["explanation"],
                            created_at=now,
                        )
                    )
            if stock["freshness"]["status"] == "stale":
                recent = db.scalar(
                    select(Alert).where(
                        Alert.symbol == stock["symbol"], Alert.mode == config.app_mode,
                        Alert.state == "DATA_STALE", Alert.created_at > now - timedelta(minutes=15),
                    )
                )
                if recent is None:
                    db.add(Alert(symbol=stock["symbol"], mode=config.app_mode, state="DATA_STALE",
                                 message="Price or research data is stale. Wait for a fresh update before acting.", created_at=now))
            self.previous_states[stock["symbol"]] = state
        if dashboard["settings"]["shadow_enabled"]:
            self.update_shadow(db, dashboard)
        if ((config.app_mode == "demo" and self.tick % 12 == 0) or
                (config.app_mode == "live" and (now - self.last_equity_at).total_seconds() >= 300)):
            db.add(Equity(mode=self.mode, total_eur=str(dashboard["portfolio"]["total_eur"]), created_at=now))
            self.last_equity_at = now

    def update_shadow(self, db: Session, dashboard: dict[str, Any]) -> None:
        now = datetime.now(UTC)
        settings = dashboard["settings"]
        records = list(db.scalars(select(Shadow)))
        stocks = {s["symbol"]: s for s in dashboard["stocks"]}
        # Fully separate €20 experimental shadow account; costs and available cash constrain fills.
        shadow_cash = (
            20
            + sum(s.data.get("pnl_eur", 0) for s in records)
            - sum(s.data.get("cost_eur", 0) for s in records if s.status == "open")
        )
        for signal in records:
            stock = stocks.get(signal.symbol)
            if not stock or signal.status not in {"pending", "open"}:
                continue
            signal.ticks += 1
            data = copy.deepcopy(signal.data)
            plan = data["plan"]
            fresh = stock["freshness"]["status"] == "current"
            if not fresh or stock.get("business_warning"):
                if signal.status == "pending":
                    signal.status = "expired"
                continue
            if signal.status == "pending":
                fill = stock["price"] * 1.001
                if plan["entry_low"] <= fill <= plan["entry_high"]:
                    sizing = position_size(plan, fill, shadow_cash, shadow_cash, settings)
                    cost = sizing["amount_eur"] * (1 + settings["fx_fee_pct"]) + settings["fixed_fee_eur"]
                    if sizing["viable"] and cost <= shadow_cash:
                        data.update(
                            entry=fill,
                            quantity=sizing["amount_eur"] * settings["fx_usd_per_eur"] / fill,
                            fx=settings["fx_usd_per_eur"],
                            cost_eur=cost,
                            filled_at=now.isoformat(),
                        )
                        signal.status = "open"
                        shadow_cash -= cost
                if signal.status == "pending" and signal.ticks >= 12:
                    signal.status = "expired"
            elif stock["price"] <= plan["reconsider"] or stock["price"] >= plan["first_profit_low"]:
                fill = stock["price"] * 0.999
                gross = data["quantity"] * fill / settings["fx_usd_per_eur"]
                proceeds = gross * (1 - settings["fx_fee_pct"]) - settings["fixed_fee_eur"]
                data.update(
                    exit=fill,
                    pnl_eur=proceeds - data["cost_eur"],
                    exit_reason="price warning" if fill <= plan["reconsider"] else "first profit area",
                )
                signal.status = "closed"
                signal.closed_at = now
                shadow_cash += proceeds
            signal.data = data
        for stock in dashboard["stocks"]:
            # Personal holdings and cash must not affect the independent shadow account.
            base = self.stocks[stock["symbol"]]
            state, _ = trade_state(
                stock["price"],
                base["plan"],
                False,
                stock["freshness"]["status"] == "current",
                stock.get("business_warning", False),
            )
            if state != "BUY_AREA" or any(
                s.symbol == stock["symbol"]
                and (s.status in {"pending", "open"} or accounting.utc(s.created_at).date() == now.date())
                for s in records
            ):
                continue
            signal_stock = copy.deepcopy(stock)
            signal_stock["plan"] = base["plan"]
            db.add(
                Shadow(
                    symbol=stock["symbol"],
                    status="pending",
                    created_at=now,
                    ticks=0,
                    data={
                        "plan": base["plan"],
                        "snapshot": signal_stock,
                        "model_version": MODEL_VERSION,
                        "signal_at": now.isoformat(),
                        "source_data_timestamps": stock["freshness"],
                        "method": "Next observed tick plus 0.1% spread; entry only within saved range; exit at observed bid, costs included.",
                    },
                )
            )

    def performance(self, db: Session) -> dict[str, Any]:
        """Return a compact engine-vs-reality report for the performance page."""
        shadows = list(db.scalars(select(Shadow).order_by(Shadow.created_at.desc())))
        outcomes = self.ml.dashboard(db)
        equity = list(db.scalars(select(Equity).where(Equity.mode == self.mode).order_by(Equity.created_at.asc())))
        closed = [item for item in shadows if item.status == "closed"]
        pnl = [float(item.data.get("pnl_eur", 0)) for item in closed]
        return {
            "mode": config.app_mode,
            "paper_signals": {"total": len(shadows), "open": sum(item.status == "open" for item in shadows),
                               "pending": sum(item.status == "pending" for item in shadows), "closed": len(closed),
                               "expired": sum(item.status == "expired" for item in shadows),
                               "realized_pnl_eur": round(sum(pnl), 6),
                               "win_rate": round(sum(value > 0 for value in pnl) / len(pnl), 4) if pnl else None},
            "equity": [{"created_at": accounting.utc(item.created_at).isoformat(), "total_eur": float(item.total_eur)} for item in equity[-200:]],
            "ml": outcomes,
            "walk_forward": self.ml.registry.list().get("walk_forward"),
            "disclaimer": "Paper and shadow results are research records, not proof of future profitability.",
        }

    def quote_check(self, db: Session, *, symbol: str, broker_price: float, broker_spread: float | None = None) -> dict[str, Any]:
        stocks = {item["symbol"]: item for item in self.dashboard(db)["stocks"]}
        stock = stocks.get(symbol)
        if not stock:
            raise ValueError("Choose a symbol from the monitored watchlist.")
        plan = stock.get("plan")
        if not plan:
            return {"symbol": symbol, "valid": False, "reason": "No calculated entry plan is available.",
                    "broker_price": broker_price, "market_price": stock.get("price")}
        entry_low, entry_high = float(plan["entry_low"]), float(plan["entry_high"])
        spread_pct = max(0.0, float(broker_spread or 0.0)) / max(broker_price, 0.000001)
        effective = broker_price + float(broker_spread or 0.0) / 2
        difference_pct = (effective / float(stock["price"]) - 1) * 100 if stock.get("price") else None
        valid = entry_low <= effective <= entry_high and not stock.get("business_warning", False)
        reason = ("Quote remains inside the calculated entry range; review the broker's final spread before placing any order."
                  if valid else "Cancel the entry suggestion: the broker quote or spread is outside the calculated entry range.")
        return {"symbol": symbol, "valid": valid, "reason": reason, "broker_price": broker_price,
                "effective_price": round(effective, 6), "broker_spread": broker_spread or 0.0,
                "spread_pct": round(spread_pct * 100, 4), "market_price": stock.get("price"),
                "difference_pct": round(difference_pct, 4) if difference_pct is not None else None,
                "entry_range": [entry_low, entry_high], "checked_at": datetime.now(UTC).isoformat()}
    async def run(self) -> None:
        while True:
            await asyncio.sleep(config.tick_seconds)
            async with self.lock:
                with SessionLocal() as db:
                    local = datetime.now(ZoneInfo("Europe/Dublin"))
                    if (
                        local.hour >= 9
                        and local.weekday() < 5
                        and self.last_slow_refresh.astimezone(ZoneInfo("Europe/Dublin")).date() < local.date()
                    ):
                        await self.slow_refresh(db)
                    await self.fast_tick(db)
                    db.commit()


service = EngineService()
