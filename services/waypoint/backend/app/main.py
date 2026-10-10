import asyncio
import contextlib
import copy
import json
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import accounting
from .backtest import demo_backtest
from .calendar import market_status
from .config import ROOT, config
from .db import SessionLocal
from .engine import MODEL_VERSION
from .migrate import migrate
from .models import Equity, Setting, Shadow
from .runtime import auth_attempt, run_scheduler, transaction
from .schemas import DemoStep, QuoteCheck, Settings, SettingsPatch, TradeInput
from .service import service


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    # Serverless cold starts do no database migration, filesystem writes, or provider calls.
    task = None
    data_engine = None
    if not config.hosted:
        if config.auto_migrate:
            migrate()
        await service.initialize()
        if config.app_mode == "live":
            from .data_engine import DataEngine
            data_engine = DataEngine(service, SessionLocal)
            await data_engine.start()
        else:
            task = asyncio.create_task(run_scheduler(service, SessionLocal)) if config.scheduler_enabled else None
    yield
    if data_engine:
        await data_engine.stop()
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    if service.provider:
        await service.provider.aclose()


app = FastAPI(
    title="Waypoint API",
    version=MODEL_VERSION,
    lifespan=lifespan,
    docs_url=None if config.hosted else "/docs",
    redoc_url=None if config.hosted else "/redoc",
    openapi_url=None if config.hosted else "/openapi.json",
)
origins = list({config.frontend_origin, "http://localhost:3000", "http://127.0.0.1:3000"})
app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.allowed_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=False,
)


@app.middleware("http")
async def local_mutations(request: Request, call_next):  # type: ignore[no-untyped-def]
    def reject(status: int, detail: str) -> JSONResponse:
        return JSONResponse(status_code=status, content={"detail": detail},
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    if request.url.path != "/api/health" and (config.hosted or config.waypoint_service_token):
        token = config.waypoint_service_token
        if not token or (config.hosted and len(token) < 32):
            return reject(503, "Service authentication is not configured.")
        supplied = request.headers.get("authorization", "")
        if not secrets.compare_digest(supplied.encode(), f"Bearer {token}".encode()):
            return reject(401, "Service authentication required.")
        if config.hosted and not config.database_url.startswith(
            ("postgres://", "postgresql://", "postgresql+psycopg://")
        ):
            return reject(503, "Hosted database is not configured.")
    if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
        origin = request.headers.get("origin")
        if (origin and origin not in origins) or (not origin and request.headers.get("sec-fetch-site") == "cross-site"):
            return reject(403, "Only the configured app may change this ledger.")
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(DBAPIError)
async def database_unavailable(request: Request, error: DBAPIError) -> JSONResponse:
    # Never return connection strings, SQL parameters, or provider secrets to callers.
    return JSONResponse(status_code=503, content={"detail": "Database unavailable or busy. Retry shortly."})


@app.exception_handler(TimeoutError)
async def job_timeout(request: Request, error: TimeoutError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": "The request exceeded its time budget. Retry later."})


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.get("/api/dashboard")
async def dashboard() -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        return service.dashboard(db)


@app.get("/api/events")
async def events(request: Request) -> StreamingResponse:
    if config.hosted:
        raise HTTPException(409, "streaming_worker_required: connect a persistent background engine for live streaming.")

    async def stream():  # type: ignore[no-untyped-def]
        engine = service.data_engine
        if engine:
            version = -1
            while not await request.is_disconnected():
                async with engine.condition:
                    if version == engine.version:
                        try:
                            await asyncio.wait_for(engine.condition.wait(), timeout=15)
                        except TimeoutError:
                            pass
                    changed = version != engine.version
                    version = engine.version
                    result = engine.latest
                if changed and result:
                    yield f"event: snapshot\ndata: {json.dumps(result, allow_nan=False)}\n\n"
                else:
                    yield "event: heartbeat\ndata: {}\n\n"
            return
        while not await request.is_disconnected():
            result = await dashboard()
            yield f"event: snapshot\ndata: {json.dumps(result, allow_nan=False)}\n\n"
            await asyncio.sleep(config.tick_seconds)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


@app.get("/api/notifications")
async def notifications() -> list[dict[str, Any]]:
    async with transaction(service, SessionLocal) as db:
        return service.dashboard(db)["alerts"]


@app.post("/api/trades")
async def trades(data: TradeInput) -> dict[str, Any]:
    if config.app_mode == "demo" and data.mode != "paper":
        raise HTTPException(
            400, "Demo mode only accepts paper records. No real fills can be mixed with fictional prices."
        )
    if config.app_mode == "live" and data.mode != "manual":
        raise HTTPException(400, "Live mode uses a separate manually recorded ledger.")
    async with transaction(service, SessionLocal) as db:
        stocks = {s["symbol"]: s for s in service.dashboard(db)["stocks"]}
        if data.symbol not in stocks:
            raise HTTPException(400, "Choose a symbol from the monitored watchlist.")
        snapshot = copy.deepcopy(stocks[data.symbol])
        snapshot["recorded_at"] = datetime.now(UTC).isoformat()
        try:
            accounting.record_trade(db, data, snapshot, MODEL_VERSION)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        result = service.dashboard(db)
        db.add(Equity(mode=service.mode, total_eur=str(result["portfolio"]["total_eur"]), created_at=datetime.now(UTC)))
        return result


@app.patch("/api/settings")
async def settings(patch: SettingsPatch) -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        previous = service.settings(db)
        data = previous.model_dump() | patch.model_dump(exclude_none=True)
        validated = Settings.model_validate(data)
        row = db.get(Setting, 1)
        assert row is not None
        row.data = validated.model_dump()
        db.flush()
        if validated.horizon != previous.horizon:
            await service.slow_refresh(db)
        return service.dashboard(db)


@app.post("/api/demo/step")
async def demo_step(data: DemoStep) -> dict[str, Any]:
    if config.app_mode != "demo":
        raise HTTPException(400, "Simulation controls are only available in demo mode.")
    async with transaction(service, SessionLocal) as db:
        stocks = {s["symbol"]: s for s in service.dashboard(db)["stocks"]}
        stock = stocks.get(data.symbol)
        if not stock or not stock["plan"]:
            raise HTTPException(400, "This demo symbol does not have a qualifying plan.")
        plan = stock["plan"]
        price = {
            "entry": (plan["entry_low"] + plan["entry_high"]) / 2,
            "wait": plan["entry_high"] + (plan["first_profit_low"] - plan["entry_high"]) * 0.25,
            "profit": (plan["first_profit_low"] + plan["first_profit_high"]) / 2,
            "warning": plan["reconsider"] + (plan["entry_low"] - plan["reconsider"]) * 0.1,
            "exit": plan["reconsider"] * 0.98,
        }[data.scenario]
        service.overrides[data.symbol] = round(price, 2)
        await service.fast_tick(db)
        return service.dashboard(db)


@app.post("/api/refresh")
async def refresh() -> dict[str, Any]:
    if service.data_engine:
        return await service.data_engine.refresh()
    async with transaction(service, SessionLocal) as db:
        await service.slow_refresh(db)
        return service.dashboard(db)


@app.post("/api/jobs/refresh")
async def refresh_job() -> dict[str, Any]:
    result = await refresh()
    return {"status": "refreshed", "last_slow_refresh": result["last_slow_refresh"]}


class PromoteSymbol(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,11}$")


@app.post("/api/watchlist/promote")
async def promote_symbol(data: PromoteSymbol) -> dict[str, Any]:
    if not service.data_engine:
        raise HTTPException(409, "A persistent streaming engine is required for HOT promotion.")
    try:
        service.data_engine.select_symbols(data.symbol)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return await service.data_engine.publish()


@app.post("/api/jobs/tick")
async def tick_job() -> dict[str, Any]:
    if config.app_mode == "live":
        return {"status": "skipped", "reason": "Live prices use the persistent Alpaca WebSocket, never REST polling."}
    if not market_status()["is_open"]:
        return {"status": "skipped", "reason": "Market closed."}
    async with transaction(service, SessionLocal) as db:
        await service.fast_tick(db)
        return {"status": "updated", "tick": service.tick}


@app.get("/api/performance")
async def performance() -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        return service.performance(db)


@app.post("/api/quote-check")
async def quote_check(data: QuoteCheck) -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        try:
            return service.quote_check(db, symbol=data.symbol, broker_price=data.broker_price,
                                      broker_spread=data.broker_spread)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error


@app.post("/api/jobs/settle")
async def settle_job() -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        dashboard = service.dashboard(db)
        service.update_shadow(db, dashboard)
        return {"status": "settled", "performance": service.performance(db)}


class AuthAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=200)
    success: bool = False


@app.post("/api/auth/attempt")
async def reserve_auth_attempt(data: AuthAttempt) -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        return auth_attempt(db, data.key, data.success)


@app.get("/api/backtest")
async def backtest() -> dict[str, Any]:
    if config.app_mode == "live":
        from .history_replay import cached_backtest
        async with transaction(service, SessionLocal):
            try:
                return cached_backtest(service.provider_cache, config.live_symbols.split(',')[0])
            except ValueError as error:
                raise HTTPException(409, str(error)) from None
    return demo_backtest()


@app.get("/api/shadow")
async def shadow() -> list[dict[str, Any]]:
    async with transaction(service, SessionLocal) as db:
        return [
            {
                "id": s.id,
                "symbol": s.symbol,
                "status": s.status,
                "created_at": accounting.utc(s.created_at).isoformat(),
                "data": s.data,
            }
            for s in db.scalars(select(Shadow).order_by(Shadow.id.desc()))
        ]


@app.get("/api/ml/status")
async def ml_status() -> dict[str, Any]:
    async with transaction(service, SessionLocal) as db:
        return {**service.ml.dashboard(db), "walk_forward": service.ml.registry.list().get("walk_forward")}


@app.post("/api/ml/train")
async def ml_train(activate: bool = False) -> dict[str, Any]:
    """Manually train from a prepared point-in-time JSONL dataset.

    Training never runs on a price tick. Activation is explicit and a registry
    version can never be overwritten.
    """
    if not config.ml_enabled:
        raise HTTPException(409, "ML is disabled. Set ML_ENABLED=true for offline training.")
    from .ml.datasets import read_jsonl
    from .ml.evaluate import promotion_gate, walk_forward
    from .ml.train import train

    path = config.ml_dataset_path
    if not Path(path).is_absolute():
        path = str(ROOT / path)
    try:
        rows = read_jsonl(path)
        evaluation = walk_forward(rows)
        model = train(rows)
    except (OSError, ValueError) as error:
        raise HTTPException(409, str(error)) from None
    gate = promotion_gate(evaluation["metrics"])
    activated = bool(activate and gate["eligible"])
    model_record = model.to_dict() | {"validation": evaluation["metrics"], "promotion_gate": gate}
    registry = service.ml.registry.register(model_record, activate=activated)
    return {"status": "trained", "activated": activated, "requested_activation": activate,
            "promotion_gate": gate, "evaluation": evaluation["metrics"],
            "model": model_record, "registry": registry}


@app.get("/api/ml/evaluate")
async def ml_evaluate() -> dict[str, Any]:
    if not config.ml_enabled:
        raise HTTPException(409, "ML is disabled. Set ML_ENABLED=true for offline evaluation.")
    from .ml.datasets import read_jsonl
    from .ml.evaluate import walk_forward

    path = config.ml_dataset_path
    if not Path(path).is_absolute():
        path = str(ROOT / path)
    try:
        return walk_forward(read_jsonl(path))
    except (OSError, ValueError) as error:
        raise HTTPException(409, str(error)) from None


@app.post("/api/ml/ingest")
async def ml_ingest(symbols: str | None = None, years: int | None = None, stride_days: int | None = None) -> dict[str, Any]:
    """Fetch Alpaca daily bars and rebuild the labelled point-in-time dataset."""
    if service.provider is None:
        raise HTTPException(409, "Alpaca market data is not connected; run this job in live mode with valid keys.")
    from .ml.ingest import ingest_to_path
    from .providers import ProviderError, SECProvider
    path = Path(config.ml_dataset_path)
    if not path.is_absolute():
        path = ROOT / path
    selected = [item.strip().upper() for item in (symbols or ",".join(filter(None, (config.live_symbols, config.scan_symbols, config.discovery_symbols)))).split(",") if item.strip()]
    sec = None
    try:
        try:
            sec = SECProvider(user_agent=config.sec_user_agent, cache=service.provider_cache,
                              checkpoint=service.usage_checkpoint)
        except ProviderError:
            pass
        return await ingest_to_path(service.provider, selected, path, years=years or config.ml_ingest_years,
                                    stride_days=stride_days or config.ml_ingest_stride_days,
                                    sec=sec)
    except (OSError, ValueError, RuntimeError) as error:
        raise HTTPException(409, str(error)) from None
    finally:
        if sec:
            await sec.aclose()


@app.post("/api/ml/maintenance")
async def ml_maintenance() -> dict[str, Any]:
    if not config.ml_enabled:
        raise HTTPException(409, "ML is disabled. Enable it for offline evaluation and candidate training.")
    async with transaction(service, SessionLocal) as db:
        try:
            return service.ml.scheduled_maintenance(db, force=True)
        except (OSError, ValueError) as error:
            raise HTTPException(409, str(error)) from None


class MLOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,11}$")
    prediction_timestamp: str = Field(min_length=20, max_length=40)
    labels: dict[str, Any]


@app.post("/api/ml/outcome")
async def ml_outcome(data: MLOutcome) -> dict[str, Any]:
    if not config.ml_enabled:
        raise HTTPException(409, "ML is disabled.")
    async with transaction(service, SessionLocal) as db:
        if not service.ml.settle_shadow(db, symbol=data.symbol, prediction_timestamp=data.prediction_timestamp, labels=data.labels):
            raise HTTPException(404, "Shadow prediction not found.")
        return service.ml.dashboard(db)


@app.get("/api/ml/drift")
async def ml_drift() -> dict[str, Any]:
    if not config.ml_enabled:
        raise HTTPException(409, "ML is disabled.")
    from .ml.datasets import PointInTimeSnapshot
    from .ml.drift import assess_drift

    model = service.ml._load()
    if not model:
        return {"status": "no_model", "confidence_reduced": True}
    async with transaction(service, SessionLocal) as db:
        row = db.get(Setting, 130)
        rows = [PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                    labels=item.get("labels"), provenance=item.get("provenance", []), regime=item.get("regime", "unknown"))
                for item in (row.data.get("snapshots", []) if row else [])]
        return assess_drift(model, rows[-200:])


@app.get("/api/sources/{source_id}")
async def source(source_id: str) -> dict[str, Any]:
    async with transaction(service, SessionLocal):
        for stock in service.stocks.values():
            for item in stock["sources"]:
                if item["id"] == source_id:
                    return item
    raise HTTPException(404, "Source not found.")


@app.get("/api/research/sec/{cik}")
async def sec_research(cik: str) -> dict[str, Any]:
    from .providers import ProviderError, SECProvider

    if not cik.isascii() or not cik.isdecimal() or not 1 <= len(cik) <= 10 or int(cik) == 0:
        raise HTTPException(400, "CIK must contain 1 to 10 digits.")
    try:
        provider = SECProvider(user_agent=config.sec_user_agent, cache=service.provider_cache,
                               checkpoint=service.usage_checkpoint)
        try:
            filings = await provider.filings(cik)
            facts = await provider.fundamentals(cik)
            return {
                "filings": [f.model_dump(mode="json") for f in filings],
                "fundamentals": facts.model_dump(mode="json"),
            }
        finally:
            await provider.aclose()
    except ProviderError as error:
        raise HTTPException(503, "SEC data unavailable. Set an identifying SEC_USER_AGENT and retry later.") from error
