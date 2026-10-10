import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import app.main as main
import app.db as database
import app.runtime as runtime_module
from app import accounting
from app.config import Config, config
from app.db import database_engine
from app.models import Base, Setting, Trade
from app.runtime import AUTH_ID, RUNTIME_IDS, acquire_database_lock, auth_attempt, transaction
from app.schemas import TradeInput
from app.service import EngineService

TOKEN = "a-test-service-secret-that-is-at-least-32-characters"


@pytest.fixture
def hosted(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite:///" + (tmp_path / "runtime.db").as_posix(), connect_args={"check_same_thread": False, "timeout": 20}
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    runtime = EngineService()
    monkeypatch.setattr(config, "runtime_mode", "serverless")
    monkeypatch.setattr(config, "app_mode", "demo")
    monkeypatch.setattr(config, "waypoint_service_token", TOKEN)
    # The HTTP safety check requires PostgreSQL in hosted mode. The isolated test
    # session factory uses a real file-backed SQLite database for transaction tests.
    monkeypatch.setattr(config, "database_url", "postgresql+psycopg://test.invalid/waypoint")
    monkeypatch.setattr(main, "SessionLocal", sessions)
    monkeypatch.setattr(main, "service", runtime)
    with TestClient(main.app, headers={"Authorization": f"Bearer {TOKEN}"}) as client:
        yield client, sessions, runtime
    engine.dispose()


def test_hosted_cold_start_makes_no_provider_or_migration_calls(hosted, monkeypatch):
    client, sessions, runtime = hosted
    monkeypatch.setattr(main, "migrate", Mock(side_effect=AssertionError("No cold-start migration")))
    monkeypatch.setattr(runtime, "initialize", Mock(side_effect=AssertionError("No cold-start provider I/O")))
    with TestClient(main.app, headers={"Authorization": f"Bearer {TOKEN}"}) as second:
        response = second.get("/api/dashboard")
    assert response.status_code == 200
    assert response.json()["stocks"] == []
    assert "DATA MISSING" in response.json()["provider_status"]
    assert response.json()["portfolio"]["cash_eur"] == 20
    assert client.get("/api/events").status_code == 409


def test_hosted_all_reads_and_writes_require_secret_and_missing_secret_fails_closed(hosted, monkeypatch):
    client, _, _ = hosted
    for path in ["/api/dashboard", "/api/shadow", "/api/backtest", "/api/sources/a", "/docs"]:
        assert client.get(path, headers={"Authorization": "Bearer wrong"}).status_code == 401
    for path in ["/api/trades", "/api/refresh", "/api/jobs/tick", "/api/jobs/refresh", "/api/auth/attempt"]:
        assert client.post(path, headers={"Authorization": ""}, json={}).status_code == 401
    assert client.get("/api/health", headers={"Authorization": ""}).json() == {
        "status": "ok",
        "model_version": main.MODEL_VERSION,
    }
    monkeypatch.setattr(config, "waypoint_service_token", "")
    assert client.get("/api/dashboard").status_code == 503
    monkeypatch.setattr(config, "waypoint_service_token", TOKEN)
    monkeypatch.setattr(config, "database_url", "sqlite:///must-not-create.db")
    assert client.get("/api/dashboard").status_code == 503


def test_durable_snapshot_restores_on_new_instance_and_does_not_overwrite_with_stale_memory(hosted, monkeypatch):
    client, sessions, first = hosted
    assert client.post("/api/jobs/refresh").status_code == 200
    first.research = {"stale": "must not persist"}
    response = client.post("/api/demo/step", json={"scenario": "entry", "symbol": "RKLB"})
    assert response.status_code == 200
    expected = response.json()
    next_instance = EngineService()
    next_instance.prices = {"RKLB": 999999}
    monkeypatch.setattr(main, "service", next_instance)
    restored = client.get("/api/dashboard").json()
    assert next(s["price"] for s in restored["stocks"] if s["symbol"] == "RKLB") == next(
        s["price"] for s in expected["stocks"] if s["symbol"] == "RKLB"
    )
    assert next_instance.overrides == first.overrides
    with sessions() as db:
        row = db.get(Setting, RUNTIME_IDS["demo"])
        assert row and row.data["version"] == 1
        assert "stale" not in row.data.get("research", {})


def test_failed_transaction_rolls_back_ledger_and_snapshot(hosted):
    _, sessions, runtime = hosted

    async def scenario():
        async with transaction(runtime, sessions):
            runtime.tick = 7
            runtime.research = {"facts": {"verified": True}}
            runtime.provider_cache = {"news": ["one"]}
            runtime.provider_health = {"sec": "ok"}
            runtime.fx = {"rate": 1.1}
        with pytest.raises(ValueError, match="cancel"):
            async with transaction(runtime, sessions) as db:
                runtime.tick = 999
                row = db.get(Setting, 1)
                if not row:
                    db.add(Setting(id=1, data={"never": "commit"}))
                raise ValueError("cancel")
        other = EngineService()
        async with transaction(other, sessions) as db:
            assert other.tick == 7
            assert other.research == {"facts": {"verified": True}}
            assert other.provider_cache == {"news": ["one"]}
            assert other.fx == {"rate": 1.1}
            assert db.get(Setting, 1) is None

    asyncio.run(scenario())


def test_separate_instances_cannot_double_spend_shared_cash(hosted):
    _, sessions, _ = hosted
    barrier = Barrier(2)

    def purchase(index):
        barrier.wait(timeout=10)

        async def perform():
            runtime = EngineService()
            try:
                async with transaction(runtime, sessions) as db:
                    accounting.record_trade(
                        db,
                        TradeInput(
                            symbol="RKLB",
                            side="buy",
                            price_usd=20,
                            amount_eur=15,
                            fee_eur=0,
                            fx_usd_per_eur=1.1,
                            executed_at=datetime.now(UTC),
                            mode="paper",
                            idempotency_key=f"concurrent-fill-{index}",
                            notes="",
                        ),
                        {},
                        "test",
                    )
                    await asyncio.sleep(0.05)
                return True
            except ValueError:
                return False

        return asyncio.run(perform())

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(purchase, [1, 2]))
    assert sorted(results) == [False, True]
    with sessions() as db:
        assert len(list(db.scalars(select(Trade)))) == 1
        assert accounting.portfolio(db, {"RKLB": 20}, 1.1, "paper")["cash_eur"] == 5


def test_rate_limit_is_shared_across_instances_expires_and_clears(hosted, monkeypatch):
    client, sessions, _ = hosted
    for _ in range(5):
        monkeypatch.setattr(main, "service", EngineService())
        assert client.post("/api/auth/attempt", json={"key": "owner-login"}).json()["allowed"]
    denied = client.post("/api/auth/attempt", json={"key": "owner-login"}).json()
    assert not denied["allowed"] and 1 <= denied["retry_after"] <= 900
    assert client.post("/api/auth/attempt", json={"key": "owner-login", "success": True}).json()["allowed"]
    assert client.post("/api/auth/attempt", json={"key": "owner-login"}).json()["allowed"]
    with sessions() as db:
        assert "owner-login" not in str(db.get(Setting, AUTH_ID).data)
        later = datetime.now(UTC) + timedelta(minutes=16)
        assert auth_attempt(db, "owner-login", now=later)["allowed"]
    assert client.post("/api/auth/attempt", json={"key": "owner-login", "password": "do-not-accept"}).status_code == 422


def test_tick_job_checks_exchange_session(hosted, monkeypatch):
    client, _, runtime = hosted
    monkeypatch.setattr(main, "market_status", lambda: {"is_open": False})
    assert client.post("/api/jobs/tick").json()["status"] == "skipped"
    assert runtime.tick == 0
    assert client.post("/api/jobs/refresh").status_code == 200
    monkeypatch.setattr(main, "market_status", lambda: {"is_open": True})
    assert client.post("/api/jobs/tick").json()["tick"] == 1


def test_vercel_environment_forces_safe_hosted_defaults(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    configured = Config(_env_file=None, runtime_mode="server", auto_migrate=True, scheduler_enabled=True)
    assert configured.hosted and configured.runtime_mode == "serverless"
    assert not configured.auto_migrate and not configured.scheduler_enabled
    assert TOKEN not in repr(Config(_env_file=None, waypoint_service_token=TOKEN))


def test_postgres_lock_is_transaction_level_not_session_level():
    db = Mock()
    db.get_bind.return_value.dialect.name = "postgresql"
    acquire_database_lock(db)
    statements = [str(call.args[0]) for call in db.execute.call_args_list]
    assert "SET LOCAL lock_timeout" in statements[0]
    assert "pg_advisory_xact_lock" in statements[1]


def test_hosted_postgres_statements_and_lock_wait_are_bounded(monkeypatch):
    monkeypatch.setattr(config, "runtime_mode", "serverless")
    db = Mock()
    db.get_bind.return_value.dialect.name = "postgresql"
    acquire_database_lock(db)
    statements = [str(call.args[0]) for call in db.execute.call_args_list]
    assert "SET LOCAL statement_timeout = '10000ms'" == statements[0]
    assert "SET LOCAL lock_timeout = '10000ms'" == statements[1]
    assert "pg_advisory_xact_lock" in statements[2]


def expire_at_next_yield(monkeypatch):
    actual_timeout_at = asyncio.timeout_at
    monkeypatch.setattr(
        runtime_module.asyncio, "timeout_at",
        lambda deadline: actual_timeout_at(asyncio.get_running_loop().time()),
    )


def test_hosted_deadline_includes_process_lock_queue(hosted, monkeypatch):
    _, _, runtime = hosted
    sessions = Mock(side_effect=AssertionError("A queued request must not open a database session."))
    expire_at_next_yield(monkeypatch)

    async def scenario():
        await runtime.lock.acquire()
        try:
            with pytest.raises(TimeoutError):
                async with transaction(runtime, sessions):
                    pytest.fail("The expired request entered the transaction.")
        finally:
            runtime.lock.release()
        assert not runtime.lock.locked()

    asyncio.run(scenario())
    sessions.assert_not_called()


@pytest.mark.parametrize("path", ["/api/settings", "/api/jobs/refresh", "/api/jobs/tick"])
def test_hosted_refresh_timeout_rolls_back_settings_and_runtime(hosted, monkeypatch, path):
    client, sessions, runtime = hosted
    assert client.get("/api/dashboard").status_code == 200
    before = runtime_module.capture_state(runtime)
    with sessions() as db:
        saved_before = db.get(Setting, RUNTIME_IDS[config.app_mode]).data

    async def delayed_refresh(db):
        runtime.research = {"uncommitted": True}
        row = db.get(Setting, 1)
        row.data = row.data | {"horizon": "years"}
        db.flush()
        await asyncio.sleep(0)  # Force cancellation without a production-length wait.
        pytest.fail("An expired refresh continued.")

    monkeypatch.setattr(runtime, "slow_refresh", delayed_refresh)
    monkeypatch.setattr(runtime, "fast_tick", delayed_refresh)
    monkeypatch.setattr(main, "market_status", lambda: {"is_open": True})
    expire_at_next_yield(monkeypatch)
    response = client.patch(path, json={"horizon": "months"}) if path == "/api/settings" else client.post(path)
    assert response.status_code == 503
    assert "time budget" in response.json()["detail"]
    assert runtime.research == before["research"]
    assert not runtime.lock.locked()
    with sessions() as db:
        assert db.get(Setting, 1).data["horizon"] == "weeks"
        assert db.get(Setting, RUNTIME_IDS[config.app_mode]).data == saved_before


def test_hosted_deadline_is_checked_before_synchronous_sql(hosted, monkeypatch):
    _, sessions, runtime = hosted

    async def scenario():
        loop = asyncio.get_running_loop()
        current_time = loop.time
        with pytest.raises(TimeoutError):
            async with transaction(runtime, sessions) as db:
                runtime.tick = 999
                db.add(Setting(id=1, data={"uncommitted": True}))
                db.flush()
                # No await occurs while the clock is advanced: the SQL callback
                # must catch expiry even before asyncio can deliver cancellation.
                monkeypatch.setattr(loop, "time", lambda: current_time() + runtime_module.HOSTED_TRANSACTION_SECONDS + 1)
                try:
                    db.scalar(select(Setting.id))
                finally:
                    monkeypatch.setattr(loop, "time", current_time)
        assert runtime.tick == 0
        assert not runtime.lock.locked()

    asyncio.run(scenario())
    with sessions() as db:
        assert db.get(Setting, 1) is None


def test_import_engine_does_not_create_local_directories(tmp_path):
    directory = tmp_path / "not-created"
    engine = database_engine("sqlite:///" + (directory / "database.db").as_posix())
    assert not directory.exists()
    engine.dispose()


def test_postgres_pooler_options_and_explicit_schema_mapping(monkeypatch):
    create = Mock()
    monkeypatch.setattr(database, "create_engine", create)
    database_engine("postgres://role:password@pooler.example:6543/postgres")
    url = create.call_args.args[0]
    options = create.call_args.kwargs
    assert url.drivername == "postgresql+psycopg"
    assert options["poolclass"].__name__ == "NullPool"
    assert options["connect_args"] == {"prepare_threshold": None, "connect_timeout": 10, "sslmode": "require"}
    assert options["execution_options"] == {"schema_translate_map": {None: "waypoint"}}
    with pytest.raises(ValueError, match="SSL"):
        database_engine("postgresql://role:password@pooler.example/postgres?sslmode=disable")


def test_symbol_configuration_is_bounded():
    assert Config(_env_file=None, live_symbols="aapl, MSFT,aapl").live_symbols == "AAPL,MSFT"
    for value in ["", "AAPL;DROP TABLE", "AAPL/../../", ",".join(f"A{i}" for i in range(101))]:
        with pytest.raises(ValueError):
            Config(_env_file=None, live_symbols=value)
