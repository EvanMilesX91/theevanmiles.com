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
            saved = db.get(Setting, RUNTIME_IDS[config.app_mode])
            if saved:
                restore_state(self, saved.data)
            runtime = db.get(Setting, 2)
            if runtime and config.app_mode == "demo":
                self.tick = runtime.data.get("tick", 0)
                self.overrides = runtime.data.get("overrides", {})
            await self.slow_refresh(db)
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
        self.last_slow_refresh = now

    async def refresh_live(self, history: bool = False, db: Session | None = None) -> None:
        from .live_data import build_live_research
        from .providers import AlpacaMarketDataProvider, AlphaVantageProvider, ProviderError, SECProvider

        symbols = list(dict.fromkeys(s.strip().upper() for s in config.live_symbols.split(",") if s.strip()))
        now = datetime.now(UTC)
        if self.provider is None:
            try:
                self.provider = AlpacaMarketDataProvider(
                    api_key=config.apca_api_key_id, secret_key=config.apca_api_secret_key
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
                    sec = SECProvider(user_agent=config.sec_user_agent)
                except ProviderError:
                    pass
                try:
                    alpha = AlphaVantageProvider(
                        api_key=config.alpha_vantage_api_key, cache=self.provider_cache
                    )
                except ProviderError:
                    pass
                research = await build_live_research(
                    symbols, market=self.provider, sec=sec, alpha=alpha,
                    cache=self.provider_cache, now=now,
                )
                self.research = research["by_symbol"]
                self.provider_health = research["provider_health"]
                self.fx = research["fx"] or {}
                # Only current, dated EUR→USD observations update portfolio valuation.
                # Historical fill FX stays immutable in the trade ledger.
                if db is not None and self.fx and self.fx.get("health", {}).get("status") == "current":
                    fx_time = datetime.fromisoformat(self.fx["timestamp"])
                    rate = float(self.fx["rate"])
                    if self.fx.get("from_currency") == "EUR" and self.fx.get("to_currency") == "USD" and (
                        -5 <= (now - fx_time).total_seconds() <= 86400 and 0.01 < rate <= 1000
                    ):
                        setting = self.settings(db)
                        row = db.get(Setting, 1)
                        assert row is not None
                        row.data = setting.model_dump() | {"fx_usd_per_eur": rate}
                        db.flush()
            finally:
                if sec:
                    await sec.aclose()
                if alpha:
                    await alpha.aclose()

        quotes: dict[str, Any] = {}
        quote_error = None
        if self.provider:
            try:
                quotes = await self.provider.latest_quotes(symbols)
                if not quotes:
                    quote_error = (
                        "No two-sided IEX quotes are currently available; showing completed-session prices where available."
                    )
            except (ProviderError, ValueError):
                quote_error = "Live quotes are unavailable. Check Alpaca credentials and feed access."
        else:
            quote_error = "Set APCA_API_KEY_ID and APCA_API_SECRET_KEY to connect free Alpaca IEX quotes."
        self.provider_health["quotes"] = {
            "status": "current" if quotes else "unavailable", "attempted_at": now.isoformat(),
            "message": quote_error or "Alpaca IEX indicative midpoints; limited exchange coverage.",
        }

        for symbol in symbols:
            prior = self.stocks.get(symbol, {})
            record = self.research.get(symbol, {})
            quote = quotes.get(symbol)
            previous_close = record.get("previous_close", prior.get("previous_close"))
            price = float(quote.price) if quote else prior.get("price") or previous_close or 0.0
            timestamp = quote.timestamp.isoformat() if quote else prior.get("freshness", {}).get("market_at")
            using_completed_close = not quote and previous_close is not None and not market_status(now)["is_open"]
            if using_completed_close:
                price = previous_close
                timestamp = None
            history_values = record.get("history", prior.get("history", []))
            change_reference = history_values[-2] if using_completed_close and len(history_values) > 1 else previous_close
            quote_current = quote is not None and -5 <= (now - quote.timestamp).total_seconds() <= 90
            sources = copy.deepcopy(record.get("sources", []))
            if quote:
                source = quote.source.model_dump(mode="json")
                source["id"] = f"alpaca-{symbol.lower()}-quote"
                sources.insert(0, source)
            else:
                sources[0:0] = [s for s in prior.get("sources", []) if s["id"] == f"alpaca-{symbol.lower()}-quote"]
            feed = quote.feed if quote_current and quote is not None else "UNAVAILABLE"
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
                "changes": ["Verified observations only. Missing eligibility inputs keep trade plans paused."],
                "sources": sources, "business_warning": False, "research": copy.deepcopy(record),
            }
            if price > 0:
                self.prices[symbol] = price
        self.provider_status = (
            "LIVE QUOTES UNAVAILABLE. " + quote_error if quote_error else
            "Real Alpaca IEX prices with sourced research. IEX is one exchange. Incomplete eligibility inputs block trade plans."
        )

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
            if config.app_mode == "live" and not quote_current and stock["freshness"]["feed"] in {"REAL-TIME", "DELAYED"}:
                stock["freshness"]["feed"] = "UNAVAILABLE"
            if not fresh and stock["freshness"]["status"] == "current":
                stock["freshness"]["status"] = "stale"
            if config.app_mode == "live" and not market_status(now)["is_open"]:
                if stock["freshness"]["feed"] in {"REAL-TIME", "DELAYED"}:
                    stock["freshness"]["feed"] = "MARKET CLOSED"
                fresh = False
            state, explanation = trade_state(
                stock["price"], stock["plan"], symbol in owned, fresh, stock.get("business_warning", False)
            )
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
            "market": market_status(now),
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
        elif market_status(now)["is_open"]:
            await self.refresh_live()
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
            self.previous_states[stock["symbol"]] = state
        if dashboard["settings"]["shadow_enabled"] and config.app_mode == "demo":
            self.update_shadow(db, dashboard)
        if self.tick % 12 == 0:
            db.add(Equity(mode=self.mode, total_eur=str(dashboard["portfolio"]["total_eur"]), created_at=now))

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
