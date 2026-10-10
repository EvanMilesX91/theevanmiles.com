import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import accounting, live_data
from app.config import config
from app.models import Base, Setting, Trade
from app.providers import Provenance, Quote
from app.schemas import TradeInput
from app.service import EngineService


def test_earnings_only_v1_preserves_user_fx_and_historical_fill(monkeypatch):
    monkeypatch.setattr(config, "app_mode", "live")
    monkeypatch.setattr(config, "live_symbols", "AAPL")
    now = datetime.now(UTC)
    source = Provenance(provider="Test market", url="https://example.com/quote", retrieved_at=now, description="Test only")
    quote = Quote(symbol="AAPL", bid=Decimal(99), ask=Decimal(101), timestamp=now,
                  feed="REAL-TIME", feed_detail="Test only", source=source)

    class Market:
        async def latest_quotes(self, symbols):
            return {"AAPL": quote}

    observation = {"from_currency": "EUR", "to_currency": "USD", "rate": "1.25",
                   "timestamp": now.isoformat(), "health": {"status": "current"}}

    async def research(*args, **kwargs):
        return {"by_symbol": {"AAPL": {"missing_reasons": ["Unsupported model inputs"],
                "news_checked_at": (now - timedelta(days=1)).isoformat(),
                "coverage": {"news": {"status": "stale"}}}},
                "fx": observation, "provider_health": {"fx": {"status": "current"}}}

    monkeypatch.setattr(live_data, "build_live_research", research)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    runtime = EngineService()
    runtime.provider = Market()
    with Session(engine) as db:
        runtime.settings(db)
        fill = accounting.record_trade(db, TradeInput(
            symbol="AAPL", side="buy", mode="manual", price_usd="100", amount_eur="2",
            fx_usd_per_eur="1.05", executed_at=now, idempotency_key="fx-test-original-fill"
        ), {}, "test")
        db.commit()
        asyncio.run(runtime.refresh_live(history=True, db=db))
        assert runtime.settings(db).fx_usd_per_eur == 1.1
        assert db.get(Trade, fill.id).fx_usd_per_eur == "1.05"
        result = runtime.dashboard(db)
        assert "User-entered" in result["portfolio"]["fx_source"]
        assert result["stocks"][0]["freshness"]["news_checked_at"] == (now - timedelta(days=1)).isoformat()
        assert result["stocks"][0]["plan"] is None
        # Old observations and wrong pairs cannot overwrite current valuation.
        for change in ({"timestamp": (now - timedelta(days=3)).isoformat()},
                       {"timestamp": now.isoformat(), "from_currency": "USD", "to_currency": "EUR"}):
            observation.update(change)
            observation["rate"] = "1.4"
            asyncio.run(runtime.refresh_live(history=True, db=db))
            assert runtime.settings(db).fx_usd_per_eur == 1.1
            assert db.get(Trade, fill.id).fx_usd_per_eur == "1.05"
        row = db.get(Setting, 1)
        row.data = row.data | {"fx_usd_per_eur": 1.3}
        assert "User-entered" in runtime.dashboard(db)["portfolio"]["fx_source"]
    engine.dispose()
