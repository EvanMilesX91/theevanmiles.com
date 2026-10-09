from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.main as main
import app.service as service_module
from app.config import config
from app.models import Analysis
from app.service import EngineService


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = "sqlite:///" + (tmp_path / "test.db").as_posix()
    engine = create_engine(url, connect_args={"check_same_thread": False})
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    runtime = EngineService()
    monkeypatch.setattr(config, "database_url", url)
    monkeypatch.setattr(config, "scheduler_enabled", False)
    monkeypatch.setattr(config, "app_mode", "demo")
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(service_module, "SessionLocal", sessions)
    monkeypatch.setattr(main, "service", runtime)
    with TestClient(main.app) as client:
        yield client, sessions, runtime
    engine.dispose()


def post_fill(client, **overrides):
    fill = dict(
        symbol="RKLB",
        side="buy",
        price_usd=18.4,
        amount_eur=3,
        fee_eur=0,
        fx_usd_per_eur=1.1,
        executed_at=datetime.now(UTC).isoformat(),
        mode="paper",
        idempotency_key="api-buy-000001",
        notes="Paper practice",
    )
    fill.update(overrides)
    return client.post("/api/trades", json=fill)


def test_dashboard_contract_and_demo_provenance(client):
    http, _, _ = client
    response = http.get("/api/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "demo" and data["portfolio"]["total_eur"] == 20
    assert len(data["stocks"]) >= 6
    for stock in data["stocks"]:
        assert stock["freshness"]["feed"] == "DEMO DATA"
        for reason in stock["reasons"] + stock["risks"]:
            assert reason["source_id"] in {source["id"] for source in stock["sources"]}


def test_end_to_end_candidate_position_profit_partial_sell(client):
    http, _, _ = client

    def stock(data):
        return next(s for s in data["stocks"] if s["symbol"] == "RKLB")

    entry = http.post("/api/demo/step", json={"symbol": "RKLB", "scenario": "entry"}).json()
    assert stock(entry)["state"] == "BUY_AREA"
    result = post_fill(http, price_usd=stock(entry)["price"])
    assert result.status_code == 200, result.text
    data = result.json()
    assert stock(data)["state"] == "HOLD"
    assert data["portfolio"]["cash_eur"] == 17
    profit = http.post("/api/demo/step", json={"symbol": "RKLB", "scenario": "profit"}).json()
    assert stock(profit)["state"] == "TAKE_PROFIT"
    assert stock(profit)["sizing"]["planned_downside_eur"] > 0
    assert stock(profit)["sizing"]["first_profit_eur"] > 0
    quantity = round(profit["portfolio"]["positions"][0]["quantity"] / 2, 12)
    sale = post_fill(
        http,
        side="sell",
        amount_eur=None,
        quantity=quantity,
        price_usd=stock(profit)["price"],
        idempotency_key="api-sell-00001",
    )
    assert sale.status_code == 200, sale.text
    assert sale.json()["portfolio"]["realized_pnl_eur"] > 0
    assert len(sale.json()["journal"]) == 2


def test_slow_refresh_preserves_original_position_plan_and_fast_does_not_reanalyze(client):
    http, sessions, _ = client
    before = http.get("/api/dashboard").json()
    plan = next(s["plan"] for s in before["stocks"] if s["symbol"] == "RKLB")
    assert post_fill(http).status_code == 200
    with sessions() as db:
        count = len(list(db.scalars(select(Analysis))))
    http.post("/api/demo/step", json={"scenario": "entry"})
    with sessions() as db:
        assert len(list(db.scalars(select(Analysis)))) == count
    result = http.patch("/api/settings", json={"horizon": "months"})
    assert result.status_code == 200
    assert next(s["plan"] for s in result.json()["stocks"] if s["symbol"] == "RKLB") == plan


def test_missing_live_keys_never_fall_back_to_demo(client, monkeypatch):
    http, _, runtime = client
    monkeypatch.setattr(config, "app_mode", "live")
    monkeypatch.delenv("APCA_API_KEY_ID", raising=False)
    monkeypatch.delenv("APCA_API_SECRET_KEY", raising=False)
    runtime.stocks = {}
    runtime.prices = {}
    data = http.post("/api/refresh").json()
    assert data["mode"] == "live"
    assert {stock["symbol"] for stock in data["stocks"]} == {"AAPL", "MSFT"}
    assert all(stock["price"] == 0 and stock["plan"] is None and stock["opportunity"] is None for stock in data["stocks"])
    assert all(stock["freshness"]["status"] == "missing" for stock in data["stocks"])
    assert "UNAVAILABLE" in data["provider_status"]


def test_security_and_invalid_settings(client):
    http, _, _ = client
    assert post_fill(http, mode="manual").status_code == 400
    assert http.post("/api/refresh", headers={"origin": "https://untrusted.example"}).status_code == 403
    assert http.get("/api/health", headers={"host": "untrusted.example"}).status_code == 400
    assert http.patch("/api/settings", json={"fx_usd_per_eur": -1}).status_code == 422
    assert http.patch("/api/settings", json={"goal": 2000}).status_code == 422
    assert (
        http.post(
            "/api/refresh", headers={"origin": "http://localhost:3000", "sec-fetch-site": "cross-site"}
        ).status_code
        == 200
    )
    assert http.get("/api/research/sec/0").status_code == 400
    assert http.get("/api/research/sec/１２３").status_code == 400


def test_stale_prices_suppress_buy_state(client):
    http, _, runtime = client
    http.post("/api/demo/step", json={"scenario": "entry"})
    runtime.stocks["RKLB"]["freshness"]["market_at"] = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
    stock = next(s for s in http.get("/api/dashboard").json()["stocks"] if s["symbol"] == "RKLB")
    assert stock["state"] != "BUY_AREA"
    assert stock["freshness"]["status"] == "stale"


def test_shadow_next_tick_fill_separate_from_ledger(client):
    http, _, _ = client
    http.patch("/api/settings", json={"shadow_enabled": True})
    http.post("/api/demo/step", json={"scenario": "entry"})
    signals = http.get("/api/shadow").json()
    rklb = next(s for s in signals if s["symbol"] == "RKLB")
    assert rklb["status"] == "pending"
    second = http.post("/api/demo/step", json={"scenario": "entry"}).json()
    assert second["shadow"]["open"] >= 1
    assert second["portfolio"]["cash_eur"] == 20
    third = http.post("/api/demo/step", json={"scenario": "profit"}).json()
    assert third["shadow"]["closed"] >= 1
    assert third["shadow"]["realized_pnl_eur"] > 0
    assert third["journal"] == []


def test_missing_timestamp_and_baseline_degrade_without_crashing(client):
    http, _, runtime = client
    runtime.stocks["RKLB"]["freshness"]["market_at"] = None
    runtime.stocks["RKLB"]["previous_close"] = 0
    result = http.get("/api/dashboard")
    assert result.status_code == 200
    stock = next(s for s in result.json()["stocks"] if s["symbol"] == "RKLB")
    assert stock["change_pct"] is None
    assert stock["state"] == "NO_SETUP"


def test_shadow_signals_independent_of_personal_ownership(client):
    http, _, _ = client
    assert post_fill(http).status_code == 200
    http.patch("/api/settings", json={"shadow_enabled": True})
    http.post("/api/demo/step", json={"scenario": "entry"})
    assert any(s["symbol"] == "RKLB" for s in http.get("/api/shadow").json())


def test_live_old_quote_never_shows_realtime(client, monkeypatch):
    http, _, runtime = client
    monkeypatch.setattr(config, "app_mode", "live")
    runtime.stocks["RKLB"]["freshness"].update(
        market_at=(datetime.now(UTC) - timedelta(hours=1)).isoformat(), feed="REAL-TIME", status="missing"
    )
    stock = next(s for s in http.get("/api/dashboard").json()["stocks"] if s["symbol"] == "RKLB")
    assert stock["freshness"]["feed"] == "UNAVAILABLE"
    assert stock["state"] != "BUY_AREA"
