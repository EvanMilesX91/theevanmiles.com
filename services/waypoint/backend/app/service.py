"""Slow analysis snapshots and fast quote/state updates are deliberately separate."""

import asyncio
import copy
import math
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
        self.capacity_error: str | None = None
        self.schedule_status: dict[str, Any] = {}
        self.data_engine: Any = None
        self.usage_checkpoint: Any = None
        self.last_equity_at = datetime(1970, 1, 1, tzinfo=UTC)
        self.ml = MLEngine()
        self.ml_maintenance_task: asyncio.Task[Any] | None = None

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
            runtime = db.get(Setting, 2)
            if runtime and config.app_mode == "demo":
                self.tick = runtime.data.get("tick", 0)
                self.overrides = runtime.data.get("overrides", {})
            if config.app_mode == "demo":
                await self.slow_refresh(db)
            else:
                # Boot from saved observations; slow network work runs separately.
                await self.refresh_live(history=False, db=db)
                self.stream_status = {"status": "waiting", "connected": False,
                                      "subscribed_symbols": [], "last_event_at": None}
            if saved:
                saved.data = capture_state(self)
            else:
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

    async def refresh_live(self, history: bool = False, db: Session | None = None) -> None:
        from .live_data import build_live_research
        from .providers import AlpacaMarketDataProvider, AlphaVantageProvider, ProviderError, SECProvider

        symbols = list(dict.fromkeys(s.strip().upper() for raw in (config.live_symbols + "," + config.scan_symbols).split(",") if (s := raw.strip())))
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
            try:
                try:
                    sec = SECProvider(user_agent=config.sec_user_agent, cache=self.provider_cache, checkpoint=self.usage_checkpoint)
                except ProviderError:
                    pass
                try:
                    alpha = AlphaVantageProvider(
                        api_key=config.alpha_vantage_api_key, cache=self.provider_cache,
                        daily_limit=config.alpha_vantage_daily_limit, checkpoint=self.usage_checkpoint
                    )
                except ProviderError:
                    pass
                research = await build_live_research(
                    symbols, market=self.provider, sec=sec, alpha=alpha,
                    cache=self.provider_cache, now=now,
                )
                self.research = research["by_symbol"]
                self.provider_health = research["provider_health"]
                self.fx = {}  # V1 reserves Alpha Vantage solely for the daily earnings calendar.
            finally:
                if sec:
                    await sec.aclose()
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
            analysis = analyze_stock(analysis_fixture, self.settings(db).horizon, now)
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
        return {"stream": {"connected_at": None, **self.stream_status, "feed": "Alpaca IEX"}, "providers": providers,
                "hot_symbols": self.hot_symbols, "warm_symbols": self.warm_symbols,
                "max_hot_symbols": config.max_hot_symbols, "capacity_error": self.capacity_error,
                "price_stale_seconds": config.price_stale_seconds, "schedule": self.schedule_status}

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
            stock = copy.deepcopy(base)
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
            projection = self.ml.project(stock, symbol=symbol, now=now, db=db)
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
            stock["actionable"] = bool(config.app_mode == "live" and fresh and session["is_open"]
                                       and state in {"BUY_AREA", "TAKE_PROFIT", "RECONSIDER_EXIT"})
            stock.update(state=state, explanation=explanation)
            stocks.append(stock)
        alerts = list(
            db.scalars(select(Alert).where(Alert.mode == config.app_mode).order_by(Alert.id.desc()).limit(15))
        )
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
