import asyncio
from datetime import UTC, datetime, timedelta

import httpx

from app.config import config
from app.providers import AlpacaMarketDataProvider
from app.service import EngineService


def test_live_quote_without_history_never_invents_baseline_or_financials(monkeypatch):
    monkeypatch.setattr(config, "live_symbols", "AAPL")

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json=(
                        {"quotes": {"AAPL": {"t": datetime.now(UTC).isoformat(), "bp": 220, "ap": 222}}}
                        if "quotes" in request.url.path
                        else {"bars": {}, "next_page_token": None}
                    ),
                )
            )
        ) as client:
            runtime = EngineService()
            runtime.provider = AlpacaMarketDataProvider(client, api_key="test", secret_key="test")
            await runtime.refresh_live(history=True)
            stock = runtime.stocks["AAPL"]
            assert stock["price"] == 221
            assert stock["previous_close"] is None
            assert stock["change_pct"] is None
            assert stock["history"] == []
            assert stock["opportunity"] is None and stock["risk"] is None
            assert stock["plan"] is None
            assert stock["sources"][0]["provider"] != "Waypoint synthetic fixtures"
            assert stock["freshness"]["status"] == "missing"

    asyncio.run(scenario())


def test_live_stale_feed_and_outage_preserve_last_price_but_block_signals(monkeypatch):
    monkeypatch.setattr(config, "live_symbols", "AAPL")
    stale = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
    unavailable = False

    def respond(request):
        if unavailable:
            return httpx.Response(403, text="Never display upstream account details")
        return httpx.Response(200, json={"quotes": {"AAPL": {"t": stale, "bp": 220, "ap": 222}}})

    async def scenario():
        nonlocal unavailable
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            runtime = EngineService()
            runtime.provider = AlpacaMarketDataProvider(client, api_key="test", secret_key="test")
            await runtime.refresh_live()
            assert runtime.stocks["AAPL"]["freshness"]["feed"] == "UNAVAILABLE"
            unavailable = True
            await runtime.refresh_live()
            assert runtime.prices["AAPL"] == 221
            assert "UNAVAILABLE" in runtime.provider_status
            assert "account details" not in runtime.provider_status
            assert runtime.stocks["AAPL"]["plan"] is None

    asyncio.run(scenario())
