import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import config
from app.data_engine import DataEngine, USAGE_ID
from app.market_state import apply_event, market_view
from app.models import Base, Setting
from app.service import EngineService


def test_fresh_price_requires_acknowledged_hot_connection_and_ages_out():
    now = datetime.now(UTC)
    value = {'timestamp': now.isoformat(), 'price': 100}
    good = dict(now=now, connected=True, subscribed=True, hot=True, stale_seconds=30)
    assert market_view(value, **good)['stale'] is False
    for field in ('connected', 'subscribed', 'hot'):
        assert market_view(value, **(good | {field: False}))['stale']
    assert market_view(value, **(good | {'now': now + timedelta(seconds=31)}))['stale']


def test_minute_volume_is_not_a_fresh_trade_and_out_of_order_price_cannot_regress():
    now = datetime.now(UTC)
    value = {}
    assert apply_event(value, {'type': 'bar', 'volume': 30, 'timestamp': now.isoformat()}, now)
    assert 'timestamp' not in value and 'price' not in value
    assert apply_event(value, {'type': 'quote', 'bid': 99, 'ask': 101, 'timestamp': now.isoformat()}, now)
    assert not apply_event(value, {'type': 'quote', 'bid': 9, 'ask': 11, 'timestamp': (now - timedelta(seconds=1)).isoformat()}, now)
    assert value['price'] == 100


def test_fast_tick_and_research_refresh_never_poll_latest_quotes(monkeypatch):
    async def scenario():
        monkeypatch.setattr(config, 'app_mode', 'live')
        monkeypatch.setattr(config, 'live_symbols', 'AAPL')
        runtime = EngineService()
        runtime.provider = type('NoQuotes', (), {'latest_quotes': AsyncMock(side_effect=AssertionError('REST live polling prohibited'))})()
        engine = create_engine('sqlite://')
        Base.metadata.create_all(engine)
        sessions = sessionmaker(engine)
        with sessions() as db:
            await runtime.refresh_live(history=False)
            await runtime.fast_tick(db)
            runtime.provider.latest_quotes.assert_not_called()
        engine.dispose()
    asyncio.run(scenario())


def test_promoting_warm_symbol_discards_old_price_until_a_new_event(monkeypatch):
    monkeypatch.setattr(config, 'app_mode', 'live')
    monkeypatch.setattr(config, 'live_symbols', 'AAPL,MSFT')
    monkeypatch.setattr(config, 'max_hot_symbols', 1)
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine)
    runtime = EngineService()
    with sessions() as db:
        runtime.settings(db)
        db.commit()
    data = DataEngine(runtime, sessions)
    data.select_symbols()
    assert runtime.hot_symbols == ['AAPL'] and runtime.warm_symbols == ['MSFT']
    runtime.market_values['MSFT'] = {'price': 100, 'timestamp': datetime.now(UTC).isoformat()}
    data.select_symbols('MSFT')
    assert runtime.hot_symbols == ['MSFT']
    assert 'MSFT' not in runtime.market_values
    with pytest.raises(ValueError, match='watchlist'):
        data.select_symbols('NVDA')
    engine.dispose()


def test_usage_checkpoint_survives_failed_slow_work(tmp_path):
    engine = create_engine('sqlite:///' + str(tmp_path / 'quota.db'))
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine)
    runtime = EngineService()
    data = DataEngine(runtime, sessions)
    runtime.provider_cache = {'alpha_vantage_budget': {'day': '2026-10-09', 'calls': 7}}
    data.usage_checkpoint()
    runtime.provider_cache = {}  # Lost/rolled-back application work must not refund quota.
    with sessions() as db:
        assert db.get(Setting, USAGE_ID).data['alpha_vantage_budget']['calls'] == 7
    engine.dispose()


def test_disconnect_blocks_actionable_state_even_when_business_warning_exists(monkeypatch):
    import app.service as service_module

    async def scenario():
        engine = create_engine('sqlite://')
        Base.metadata.create_all(engine)
        sessions = sessionmaker(engine)
        runtime = EngineService()
        with sessions() as db:
            await runtime.slow_refresh(db)  # Isolated deterministic fixtures only.
            monkeypatch.setattr(config, 'app_mode', 'live')
            monkeypatch.setattr(service_module, 'market_status', lambda *_: {'is_open': True})
            runtime.hot_symbols = list(runtime.stocks)
            runtime.stream_status = {'connected': False, 'subscribed_symbols': runtime.hot_symbols}
            for stock in runtime.stocks.values():
                stock['business_warning'] = True
            result = runtime.dashboard(db)
            assert all(not s['actionable'] and s['state'] not in {'BUY_AREA', 'TAKE_PROFIT', 'RECONSIDER_EXIT'} for s in result['stocks'])
        engine.dispose()
    asyncio.run(scenario())
