"""One local streaming engine. Provider I/O never holds the price/ledger lock.

SSE readers share published snapshots; they do not open upstream connections.
Ticks stay in memory, snapshots persist at a bounded cadence, alerts persist
when states change. REST is reserved for cached, slow research/history work.
"""
import asyncio
import contextlib
import copy
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from . import accounting
from .calendar import market_status
from .config import ROOT, config
from .engine import MODEL_VERSION, trade_state
from .models import Alert, Analysis, Setting
from .runtime import transaction
from .service import EngineService
from .watchlist import HotCandidate, select_hot

USAGE_ID = 120


class DataEngine:
    def __init__(self, service: EngineService, sessions: Any):
        self.service = service
        self.sessions = sessions
        self.condition = asyncio.Condition()
        self.version = 0
        self.latest: dict[str, Any] | None = None
        self.refresh_lock = asyncio.Lock()
        self.tasks: list[asyncio.Task[Any]] = []
        self.news_collector: Any = None
        self.sec_archive: Any = None
        self.earnings_collector: Any = None
        self.stream: Any = None
        self.changed = True
        self.promoted: str | None = None
        self.pending_alerts: dict[tuple[str, str], dict[str, Any]] = {}
        self.event_states: dict[str, str] = {}
        self.last_persist = 0.0
        self.last_selection = 0.0

    def usage_checkpoint(self) -> None:
        cache = self.service.provider_cache
        data = {key: copy.deepcopy(cache[key]) for key in ('api_usage_v1', 'alpha_vantage_budget') if key in cache}
        # Own small transaction before HTTP; process termination/slow-job failure
        # cannot refund a consumed provider request reservation.
        with self.sessions() as db:
            row = db.get(Setting, USAGE_ID)
            if row:
                row.data = data
            else:
                db.add(Setting(id=USAGE_ID, data=data))
            db.commit()

    async def start(self) -> None:
        from .streaming import AlpacaStream

        with self.sessions() as db:
            saved = db.get(Setting, USAGE_ID)
            if saved:
                self.service.provider_cache.update(copy.deepcopy(saved.data))
        self.service.data_engine = self
        self.service.usage_checkpoint = self.usage_checkpoint
        self.select_symbols()
        await self.publish()
        if config.stream_enabled and config.apca_api_key_id and config.apca_api_secret_key:
            self.stream = AlpacaStream(
                config.apca_api_key_id, config.apca_api_secret_key, max_symbols=config.max_hot_symbols,
                lock_path=ROOT / 'data' / 'alpaca-stream.lock', on_event=self.on_event,
                on_status=self.on_status, freshness_seconds=config.price_stale_seconds,
            )
            self.stream.set_symbols(self.service.hot_symbols)
            self.tasks.append(asyncio.create_task(self.stream.run()))
        else:
            self.service.stream_status.update(status='unavailable', connected=False,
                                             last_error='Set Alpaca credentials and enable the local stream.')
        self.tasks.append(asyncio.create_task(self.fast_loop()))
        if config.scheduler_enabled:
            self.tasks.append(asyncio.create_task(self.slow_loop()))
            from .news_worker import NewsCollector
            self.news_collector = NewsCollector(self.service, self.sessions, self.usage_checkpoint)
            self.tasks.append(asyncio.create_task(self.news_collector.run()))
            from .sec_archive import SECArchiveCollector
            self.sec_archive = SECArchiveCollector(self.service, self.sessions, self.usage_checkpoint)
            self.tasks.append(asyncio.create_task(self.sec_archive.run()))
            from .earnings_archive import EarningsEstimateCollector
            self.earnings_collector = EarningsEstimateCollector(self.service, self.usage_checkpoint)
            self.tasks.append(asyncio.create_task(self.earnings_collector.run()))

    async def stop(self) -> None:
        if self.stream:
            await self.stream.stop()
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self.service.stream_status.update(connected=False, status='stopped', subscribed_symbols=[])
        async with transaction(self.service, self.sessions):
            pass
        self.service.data_engine = None
        self.service.usage_checkpoint = None

    def select_symbols(self, promote: str | None = None) -> None:
        with self.sessions() as db:
            settings = self.service.settings(db)
            owned = {p['symbol'] for p in accounting.portfolio(
                db, self.service.prices, settings.fx_usd_per_eur, self.service.mode)['positions']}
        symbols = {
            item.strip().upper()
            for universe in (config.live_symbols, config.scan_symbols, config.discovery_symbols, ",".join(self.service.dynamic_discovery))
            for item in universe.split(',')
            if item.strip()
        } | owned
        candidates = []
        for symbol in symbols:
            stock = self.service.stocks.get(symbol, {})
            plan = stock.get('plan') or {}
            price = self.service.prices.get(symbol, 0)

            def near(level: str, plan: dict = plan, price: float = price) -> bool:
                value = plan.get(level)
                return bool(value and price and abs(price / value - 1) < 0.03)

            candidates.append(HotCandidate(
                symbol, owned=symbol in owned, near_reconsider=near('reconsider'),
                near_take_profit=near('first_profit_low'), near_buy_area=near('entry_high'),
                opportunity_score=stock.get('opportunity') or 0,
                catalyst_priority=1 if stock.get('next_events') else 0,
                activity_score=abs(stock.get('change_pct') or 0),
            ))
        result = select_hot(candidates, config.max_hot_symbols, promote or self.promoted)
        if promote and result.promotion_error:
            raise ValueError(result.promotion_error)
        if promote:
            self.promoted = promote
        if result.hot != self.service.hot_symbols:
            # Previously observed WARM prices must not qualify on promotion.
            new_hot = set(result.hot) - set(self.service.hot_symbols)
            for symbol in new_hot:
                self.service.market_values.pop(symbol, None)
            self.changed = True
        self.service.hot_symbols = result.hot
        self.service.warm_symbols = result.warm
        self.service.capacity_error = result.capacity_error
        if self.stream:
            self.stream.set_symbols(result.hot)

    async def on_status(self, status: dict[str, Any]) -> None:
        self.service.stream_status = copy.deepcopy(status)
        self.changed = True

    async def on_event(self, event: dict[str, Any]) -> None:
        if not self.service.accept_market_event(event):
            return
        self.service.stream_status['last_event_at'] = event.get('timestamp')
        self.changed = True
        # Check every accepted price, not just the coalesced UI refresh: a brief
        # threshold crossing still records an alert. No provider or SQL work here.
        if self.latest and event.get('type') != 'bar':
            symbol = event['symbol']
            base = next((s for s in self.latest['stocks'] if s['symbol'] == symbol), None)
            if base and base.get('plan'):
                from .market_state import market_view
                view = market_view(self.service.market_values[symbol], now=datetime.now(UTC),
                                   connected=self.service.stream_status.get('connected', False) and symbol not in self.service.stream_status.get('stale_symbols', []),
                                   subscribed=symbol in self.service.stream_status.get('subscribed_symbols', []),
                                   hot=symbol in self.service.hot_symbols, stale_seconds=config.price_stale_seconds)
                owned = any(p['symbol'] == symbol for p in self.latest['portfolio']['positions'])
                fresh = (not view['stale'] and not self.service.capacity_error and
                         base['freshness']['status'] == 'current' and market_status()['is_open'])
                state, explanation = trade_state(view.get('price', 0), base.get('plan'), owned, fresh,
                                                 base.get('business_warning', False) if fresh else False)
                previous = self.event_states.get(symbol, base['state'])
                if fresh and previous != state and state in {'BUY_AREA', 'TAKE_PROFIT', 'RECONSIDER_EXIT'}:
                    self.pending_alerts[(symbol, state)] = {'symbol': symbol, 'state': state, 'message': explanation,
                                                          'created_at': datetime.now(UTC)}
                self.event_states[symbol] = state

    async def publish(self) -> dict[str, Any]:
        async with self.service.lock:
            with self.sessions() as db:
                self.latest = self.service.dashboard(db)
        async with self.condition:
            self.version += 1
            self.condition.notify_all()
        return self.latest

    async def discover_candidates(self) -> None:
        """Refresh a small rotating discovery lane from Alpaca asset metadata.

        Asset metadata is deliberately only a candidate source. The normal
        research batches still gate every candidate before it can influence a
        plan, and the core watchlist is never replaced.
        """
        if not config.auto_discovery_enabled or not self.service.provider:
            return
        now = datetime.now(UTC)
        cache = self.service.provider_cache
        entry = cache.get("alpaca_discovery_assets")
        assets: list[dict[str, Any]] = []
        if isinstance(entry, dict):
            try:
                age = (now - datetime.fromisoformat(entry["retrieved_at"])).total_seconds()
                if 0 <= age < 24 * 3600 and isinstance(entry.get("data"), list):
                    assets = entry["data"]
            except (KeyError, TypeError, ValueError):
                assets = []
        try:
            if not assets:
                assets = await self.service.provider.tradable_assets()
                cache["alpaca_discovery_assets"] = {
                    "retrieved_at": now.isoformat(), "data": assets[:10000],
                }
            configured = {
                item.strip().upper()
                for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols).split(",")
                if (item := raw.strip())
            }
            candidates = [str(row.get("symbol", "")).upper() for row in assets
                          if isinstance(row, dict) and str(row.get("symbol", "")).upper() not in configured]
            if not candidates:
                return
            cursor = cache.get("alpaca_discovery_cursor", 0)
            try:
                cursor = int(cursor) % len(candidates)
            except (TypeError, ValueError):
                cursor = 0
            selected = [candidates[(cursor + index) % len(candidates)] for index in range(min(config.discovery_batch_size, len(candidates)))]
            cache["alpaca_discovery_cursor"] = (cursor + len(selected)) % len(candidates)
            self.service.dynamic_discovery = list(dict.fromkeys(selected))
            self.service.schedule_status.update(
                discovery_last_success=now.isoformat(),
                discovery_candidates=len(selected),
                discovery_symbols=self.service.dynamic_discovery,
                discovery_last_error=None,
            )
        except Exception as error:
            self.service.schedule_status.update(
                discovery_last_error=f"Discovery scan unavailable; core watchlist continues ({type(error).__name__}).",
                discovery_last_error_at=now.isoformat(),
            )

    async def refresh(self, reason: str = 'manual') -> dict[str, Any]:
        if self.refresh_lock.locked():
            # Concurrent manual/scheduled refreshes join the current refresh.
            async with self.refresh_lock:
                return await self.publish()
        async with self.refresh_lock:
            await self.discover_candidates()
            all_symbols = list(dict.fromkeys(
                item.strip().upper()
                for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols).split(",")
                if (item := raw.strip())
            ) + self.service.dynamic_discovery)
            batch_size = max(1, min(config.research_batch_size, len(all_symbols)))
            batches = [all_symbols[index:index + batch_size] for index in range(0, len(all_symbols), batch_size)]
            self.service.schedule_status.update(
                running=True, reason=reason, last_error=None,
                research_started_at=datetime.now(UTC).isoformat(),
                research_total=len(all_symbols), research_completed=0,
                research_pass=f"0/{len(all_symbols)}" if all_symbols else "0/0",
                research_last_symbol=None, research_errors=[],
            )
            prepared = EngineService()
            prepared.provider_cache = self.service.provider_cache
            prepared.usage_checkpoint = self.usage_checkpoint
            prepared.stocks = copy.deepcopy(self.service.stocks)
            prepared.research = copy.deepcopy(self.service.research)
            prepared.market_values = copy.deepcopy(self.service.market_values)

            async def commit_batch(batch: list[str]) -> None:
                """Publish one completed research batch without waiting for the universe."""
                async with transaction(self.service, self.sessions) as db:
                    self.service.research.update({symbol: prepared.research[symbol] for symbol in batch
                                                  if symbol in prepared.research})
                    self.service.provider_health.update(prepared.provider_health)
                    self.service.fx = {}
                    refresh_now = datetime.now(UTC)
                    for symbol in batch:
                        stock = prepared.stocks.get(symbol)
                        if not stock:
                            continue
                        value = self.service.market_values.get(symbol, {})
                        if value.get('price'):
                            stock.update(price=value['price'], price_basis=value['price_basis'],
                                         price_as_of=value['timestamp'])
                            stock['freshness']['market_at'] = value['timestamp']
                            stock['freshness']['feed'] = 'REAL-TIME'
                        self.service.stocks[symbol] = stock
                        if stock['price'] > 0:
                            self.service.prices[symbol] = stock['price']
                        # Capture point-in-time snapshots for shadow evaluation.
                        self.service.ml.capture(db, symbol=symbol, stock=stock, now=refresh_now)
                        prediction = self.service.ml.predict(stock, symbol=symbol, now=refresh_now, db=db)
                        if prediction is not None and self.service.ml.shadow_mode:
                            self.service.ml.attach_shadow(db, symbol, prediction, refresh_now)
                        last = db.scalar(select(Analysis).where(Analysis.symbol == symbol, Analysis.mode == 'live')
                                         .order_by(Analysis.id.desc()).limit(1))
                        if not last or accounting.utc(last.created_at).date() < datetime.now(UTC).date():
                            db.add(Analysis(symbol=symbol, mode='live', created_at=refresh_now,
                                            model_version=MODEL_VERSION, data=copy.deepcopy(stock)))

            try:
                # Crucial: no engine/ledger lock is held during any external I/O.
                for completed, batch in enumerate(batches, start=1):
                    await prepared.refresh_live(history=True, selected_symbols=batch)
                    await commit_batch(batch)
                    completed_count = min(completed * batch_size, len(all_symbols))
                    provider_errors = [
                        f"{name}: {health.get('message') or health.get('code')}"
                        for name, health in prepared.provider_health.items()
                        if health.get('status') in {'unavailable', 'stale'} and (health.get('message') or health.get('code'))
                    ]
                    self.service.schedule_status.update(
                        research_completed=completed_count,
                        research_pass=f"{completed_count}/{len(all_symbols)}",
                        research_last_symbol=batch[-1] if batch else None,
                        research_errors=provider_errors[:12],
                    )
                    # Make each committed batch immediately visible to REST/SSE.
                    self.service.last_slow_refresh = datetime.now(UTC)
                    self.changed = True
                    await self.publish()
                self.service.last_slow_refresh = datetime.now(UTC)
                self.service.schedule_status.update(
                    running=False, last_success=datetime.now(UTC).isoformat(),
                    research_completed=len(all_symbols), research_pass=f"{len(all_symbols)}/{len(all_symbols)}",
                )
                self.select_symbols()
            except Exception:
                self.service.schedule_status.update(running=False, last_error='Research refresh failed; completed batches remain available.')
                raise
            finally:
                if prepared.provider:
                    await prepared.provider.aclose()
                self.usage_checkpoint()
                self.changed = True
            return await self.publish()

    async def fast_loop(self) -> None:
        last_heartbeat = 0.0
        while True:
            await asyncio.sleep(config.stream_publish_seconds)
            now = asyncio.get_running_loop().time()
            if now - self.last_selection >= 30:
                self.select_symbols()
                self.last_selection = now
            if self.changed or now - last_heartbeat >= 1:
                self.changed = False
                async with self.service.lock:
                    with self.sessions() as db:
                        await self.service.fast_tick(db)
                        for item in self.pending_alerts.values():
                            recent = db.scalar(select(Alert).where(Alert.symbol == item['symbol'], Alert.mode == 'live',
                                                                   Alert.state == item['state'],
                                                                   Alert.created_at > datetime.now(UTC) - timedelta(minutes=5)))
                            if recent is None:
                                db.add(Alert(mode='live', **item))
                        db.commit()
                        self.pending_alerts.clear()
                await self.publish()
                last_heartbeat = now
            if now - self.last_persist >= config.stream_checkpoint_seconds:
                async with transaction(self.service, self.sessions):
                    pass
                self.last_persist = now

    async def slow_loop(self) -> None:
        initial = True
        startup_due = True
        done: set[str] = set()
        while True:
            if initial:
                # Let health checks, the dashboard, and the stream become
                # available from the saved snapshot before the first expensive
                # research pass starts.
                initial = False
                await asyncio.sleep(15)
                continue
            now = datetime.now(UTC)
            local = now.astimezone(ZoneInfo('Europe/Dublin'))
            ny = now.astimezone(ZoneInfo('America/New_York'))
            day = local.date().isoformat()
            status = market_status(now)
            seconds_to_open = (datetime.fromisoformat(status['next_open']) - now).total_seconds()
            reason = None
            if startup_due:
                reason = 'startup'
                startup_due = False
            elif local.weekday() < 5 and local.hour >= config.morning_refresh_hour and f'{day}:morning' not in done:
                reason = 'morning'
            elif 0 < seconds_to_open <= 30 * 60 and f'{day}:premarket' not in done:
                reason = 'premarket'
            elif ny.weekday() < 5 and ny.hour >= 16 and ny.minute >= 16 and f'{day}:reconciliation' not in done:
                reason = 'reconciliation'
            elif status['is_open'] and (now - self.service.last_slow_refresh).total_seconds() >= config.warm_refresh_minutes * 60:
                reason = 'scheduled scan'
            if reason:
                initial = False
                done = {value for value in done if value.startswith(day)}
                done.add(f'{day}:{reason}')
                try:
                    await self.refresh(reason)
                except Exception:
                    # A failed non-critical provider never ends monitoring.
                    await asyncio.sleep(60)
            await asyncio.sleep(30)
