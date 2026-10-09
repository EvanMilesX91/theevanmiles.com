import asyncio
import contextlib
import copy
import json
import secrets
from contextlib import asynccontextmanager
from datetime import UTC, datetime
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
from .config import config
from .db import SessionLocal
from .engine import MODEL_VERSION
from .migrate import migrate
from .models import Equity, Setting, Shadow
from .runtime import auth_attempt, run_scheduler, transaction
from .schemas import DemoStep, Settings, SettingsPatch, TradeInput
from .service import service


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    # Serverless cold starts do no database migration, filesystem writes, or provider calls.
    task = None
    if not config.hosted:
        if config.auto_migrate:
            migrate()
        await service.initialize()
        task = asyncio.create_task(run_scheduler(service, SessionLocal)) if config.scheduler_enabled else None
    yield
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
        raise HTTPException(409, "Serverless mode uses GET /api/dashboard polling every 30 seconds.")

    async def stream():  # type: ignore[no-untyped-def]
        while not await request.is_disconnected():
            result = await dashboard()
            yield f"event: snapshot\ndata: {json.dumps(result, allow_nan=False)}\n\n"
            await asyncio.sleep(config.tick_seconds)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


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
    async with transaction(service, SessionLocal) as db:
        await service.slow_refresh(db)
        return service.dashboard(db)


@app.post("/api/jobs/refresh")
async def refresh_job() -> dict[str, Any]:
    result = await refresh()
    return {"status": "refreshed", "last_slow_refresh": result["last_slow_refresh"]}


@app.post("/api/jobs/tick")
async def tick_job() -> dict[str, Any]:
    if not market_status()["is_open"]:
        return {"status": "skipped", "reason": "Market closed."}
    async with transaction(service, SessionLocal) as db:
        await service.fast_tick(db)
        return {"status": "updated", "tick": service.tick}


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
        provider = SECProvider(user_agent=config.sec_user_agent)
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
