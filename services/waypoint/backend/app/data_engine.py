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
from .models import Alert, Analysis, MarketObservation, Setting
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
        # The quote heartbeat publishes a lightweight snapshot frequently. Keep
        # the most recent slower research snapshot separately so those fast
        # updates do not erase ML/projection evidence from the dashboard.
        self.latest_research: dict[str, Any] | None = None
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
        self.last_observation_flush = 0.0
        self.last_stream_recovery = 0.0
        self.pending_observations: dict[tuple[str, datetime], dict[str, Any]] = {}
        self.session_symbols: set[str] = set()

    def usage_checkpoint(self) -> None:
        cache = self.service.provider_cache
        data = {
            key: copy.deepcopy(cache[key])
            for key in cache
            if (
                key in {'api_usage_v1', 'alpha_vantage_budget', 'alpha_vantage_earnings_cursor'}
                or key.startswith('sec:earnings_history:')
                or key.startswith('alpha_vantage_earnings_history:')
            )
        }
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
            self._load_market_session(db)
        self.service.data_engine = self
        self.service.usage_checkpoint = self.usage_checkpoint
        self.select_symbols()
        # Publish a lightweight snapshot before declaring the ASGI app ready.
        # Historical analogue matching is intentionally deferred to the first
        # heartbeat so a large local SQLite archive cannot make health/login
        # requests appear hung during container startup.
        await self.publish(include_research=False)
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
        if config.historical_projection_enabled or config.ml_enabled:
            # Keep first paint and health checks light, then publish the
            # projection/ML evidence from the compact runtime history once
            # the engine is already serving requests. This makes projections
            # appear without making login wait on analogue matching.
            self.tasks.append(asyncio.create_task(self.research_publish_loop()))
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
        with self.sessions() as db:
            self._flush_observations(db, force=True)
            db.commit()
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
        self._queue_observation(event)
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

    def _load_market_session(self, db: Any) -> None:
        """Restore today's audit counters without putting them in the runtime blob."""
        today = datetime.now(UTC).date()
        start = datetime.combine(today, datetime.min.time(), UTC)
        rows = list(db.scalars(select(MarketObservation).where(
            MarketObservation.mode == self.service.mode,
            MarketObservation.observed_at >= start,
        ).order_by(MarketObservation.observed_at)))
        self.service.market_session = {
            "observations_today": len(rows),
            "symbols_today": len({row.symbol for row in rows}),
            "first_observed_at": rows[0].observed_at.isoformat() if rows else None,
            "last_observed_at": rows[-1].observed_at.isoformat() if rows else None,
            "storage": "minute observations",
        }
        self.session_symbols = {row.symbol for row in rows}

    def _queue_observation(self, event: dict[str, Any]) -> None:
        """Coalesce the stream into one durable observation per symbol/minute."""
        symbol = event.get("symbol")
        timestamp = event.get("timestamp")
        price = event.get("price")
        if not symbol or not timestamp or price is None:
            return
        try:
            observed = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00")).astimezone(UTC)
            price_value = float(price)
        except (TypeError, ValueError):
            return
        bucket = observed.replace(second=0, microsecond=0)
        self.pending_observations[(str(symbol), bucket)] = {
            "symbol": str(symbol),
            "observed_at": bucket,
            "received_at": datetime.now(UTC),
            "event_type": str(event.get("type", "quote")),
            "price": price_value,
            "bid": float(event["bid"]) if event.get("bid") is not None else None,
            "ask": float(event["ask"]) if event.get("ask") is not None else None,
            "volume": float(event["volume"]) if event.get("volume") is not None else None,
            "data": {"price_basis": event.get("price_basis"), "timestamp": str(timestamp)},
        }
        if len(self.pending_observations) > 5000:
            for key in sorted(self.pending_observations)[:1000]:
                self.pending_observations.pop(key, None)

    def _flush_observations(self, db: Any, *, force: bool = False) -> None:
        if not self.pending_observations:
            return
        current_bucket = datetime.now(UTC).replace(second=0, microsecond=0)
        ready = {
            key: item for key, item in self.pending_observations.items()
            if force or item["observed_at"] < current_bucket
        }
        if not ready:
            return
        rows = [MarketObservation(mode=self.service.mode, source="alpaca_iex", **item)
                for item in ready.values()]
        db.add_all(rows)
        db.flush()
        for key in ready:
            self.pending_observations.pop(key, None)
        today = datetime.now(UTC).date()
        todays = [row for row in rows if row.observed_at.date() == today]
        if todays:
            current = self.service.market_session
            current["observations_today"] = int(current.get("observations_today", 0)) + len(todays)
            self.session_symbols.update(row.symbol for row in todays)
            current["symbols_today"] = len(self.session_symbols)
            current["first_observed_at"] = current.get("first_observed_at") or min(
                row.observed_at for row in todays
            ).isoformat()
            current["last_observed_at"] = max(row.observed_at for row in todays).isoformat()

    async def publish(self, *, include_research: bool = True) -> dict[str, Any]:
        async with self.service.lock:
            with self.sessions() as db:
                snapshot = self.service.dashboard(db, include_research=include_research)
                if include_research:
                    self.latest_research = copy.deepcopy(snapshot)
                elif self.latest_research is not None:
                    # Preserve slower research fields while accepting the new
                    # prices, freshness, alerts, and portfolio state.
                    research_by_symbol = {
                        item.get("symbol"): item
                        for item in self.latest_research.get("stocks", [])
                        if item.get("symbol")
                    }
                    for item in snapshot.get("stocks", []):
                        prior = research_by_symbol.get(item.get("symbol"))
                        if prior:
                            for key in ("ml", "projection"):
                                if key in prior:
                                    item[key] = copy.deepcopy(prior[key])
                    snapshot["ml"] = copy.deepcopy(self.latest_research.get("ml", snapshot.get("ml", {})))
                    old_queue = self.latest_research.get("research_queue", {})
                    queue = snapshot.get("research_queue", {})
                    if old_queue.get("evidence_readiness"):
                        queue["evidence_readiness"] = copy.deepcopy(old_queue["evidence_readiness"])
                    snapshot["research_queue"] = queue
                self.latest = snapshot
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
                return await self.publish(include_research=False)
        async with self.refresh_lock:
            all_symbols = list(dict.fromkeys([
                item.strip().upper()
                for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols).split(",")
                if (item := raw.strip())
            ] + self.service.dynamic_discovery))
            batch_size = max(1, min(config.research_batch_size, len(all_symbols)))
            batches = [all_symbols[index:index + batch_size] for index in range(0, len(all_symbols), batch_size)]
            self.service.schedule_status.update(
                running=True, reason=reason, last_error=None,
                research_started_at=datetime.now(UTC).isoformat(),
                research_total=len(all_symbols), research_completed=0,
                research_pass=f"0/{len(all_symbols)}" if all_symbols else "0/0",
                research_last_symbol=None, research_errors=[],
            )
            # Discovery is optional.  Mark the core pass as started first so
            # a slow or unavailable assets endpoint cannot leave the UI stuck
            # on an old indeterminate "research" state.
            try:
                await asyncio.wait_for(self.discover_candidates(), timeout=15)
            except Exception as error:
                self.service.schedule_status.update(
                    discovery_last_error=f"Discovery scan unavailable; core watchlist continues ({type(error).__name__}).",
                    discovery_last_error_at=datetime.now(UTC).isoformat(),
                )
            all_symbols = list(dict.fromkeys([
                item.strip().upper()
                for raw in (config.live_symbols + "," + config.scan_symbols + "," + config.discovery_symbols).split(",")
                if (item := raw.strip())
            ] + self.service.dynamic_discovery))
            batch_size = max(1, min(config.research_batch_size, len(all_symbols)))
            batches = [all_symbols[index:index + batch_size] for index in range(0, len(all_symbols), batch_size)]
            self.service.schedule_status.update(
                research_total=len(all_symbols),
                research_pass=f"0/{len(all_symbols)}" if all_symbols else "0/0",
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
                    await self.publish(include_research=False)
                # Peer valuation needs the complete current universe. The
                # staged provider pass above intentionally works in tiny
                # batches, so enrich the combined records once and rebuild
                # the deterministic views without another provider request.
                from .live_data import enrich_peer_valuations

                enrich_peer_valuations(prepared.research, datetime.now(UTC))
                await prepared.refresh_live(history=False, selected_symbols=all_symbols)
                await commit_batch(all_symbols)
                self.changed = True
                await self.publish(include_research=False)
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
            return await self.publish(include_research=False)

    async def fast_loop(self) -> None:
        last_heartbeat = 0.0
        while True:
            await asyncio.sleep(config.stream_publish_seconds)
            now = asyncio.get_running_loop().time()
            if now - self.last_selection >= 30:
                self.select_symbols()
                self.last_selection = now
            if (
                self.stream and self.service.stream_status.get("connected")
                and self.service.stream_status.get("stale_symbols")
                and now - self.last_stream_recovery >= 120
            ):
                self.stream.force_resubscribe()
                self.service.stream_status["last_resubscribe_at"] = datetime.now(UTC).isoformat()
                self.service.stream_status["stale_retry_count"] = int(
                    self.service.stream_status.get("stale_retry_count", 0)
                ) + 1
                self.last_stream_recovery = now
                self.changed = True
            if self.changed or now - last_heartbeat >= 1:
                self.changed = False
                async with self.service.lock:
                    with self.sessions() as db:
                        if now - self.last_observation_flush >= 15:
                            self._flush_observations(db)
                            self.last_observation_flush = now
                        # Fast heartbeats update quotes, alerts, and state. The
                        # expensive historical/ML projection pass is refreshed
                        # by research work, not once per price tick.
                        await self.service.fast_tick(db, include_research=False)
                        for item in self.pending_alerts.values():
                            recent = db.scalar(select(Alert).where(Alert.symbol == item['symbol'], Alert.mode == 'live',
                                                                   Alert.state == item['state'],
                                                                   Alert.created_at > datetime.now(UTC) - timedelta(minutes=5)))
                            if recent is None:
                                db.add(Alert(mode='live', **item))
                        db.commit()
                        self.pending_alerts.clear()
                await self.publish(include_research=False)
                last_heartbeat = now
            if now - self.last_persist >= config.stream_checkpoint_seconds:
                async with transaction(self.service, self.sessions):
                    pass
                self.last_persist = now

    async def research_publish_loop(self) -> None:
        """Refresh the slower ML/projection view without blocking startup."""
        await asyncio.sleep(max(45, config.stream_publish_seconds * 5))
        while True:
            try:
                await self.publish(include_research=True)
            except Exception as error:
                self.service.schedule_status.update(
                    projection_last_error=f"Projection refresh unavailable ({type(error).__name__})."
                )
            await asyncio.sleep(max(60, config.historical_projection_cache_seconds))

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
