"""Atomic, durable engine snapshots for short jobs and concurrent serverless instances.

The transaction-level advisory lock is compatible with Supabase's transaction pooler.
It covers BOTH the ledger read/validation/write and the engine snapshot. Never commit
inside this context: doing so would release the lock before the snapshot is saved.
"""

import asyncio
import copy
import hashlib
import math
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import event, text
from sqlalchemy.orm import Session

from .config import config
from .models import Setting

ENGINE_LOCK = 782347102015
RUNTIME_IDS = {"demo": 100, "live": 101}
AUTH_ID = 110
SNAPSHOT_VERSION = 1
# Leave 40 seconds below Vercel's 180-second cap for a final bounded SQL call,
# rollback/commit, and response delivery. Queueing consumes the same budget.
HOSTED_TRANSACTION_SECONDS = 140
HOSTED_STATEMENT_TIMEOUT_MS = 10000
FIELDS = (
    "stocks",
    "prices",
    "previous_states",
    "overrides",
    "tick",
    "provider_status",
    "research",
    "provider_cache",
    "provider_health",
    "fx",
)


def acquire_database_lock(db: Session) -> None:
    if db.get_bind().dialect.name == "postgresql":
        if config.hosted:
            db.execute(text(f"SET LOCAL statement_timeout = '{HOSTED_STATEMENT_TIMEOUT_MS}ms'"))
        lock_timeout = HOSTED_STATEMENT_TIMEOUT_MS if config.hosted else 20000
        db.execute(text(f"SET LOCAL lock_timeout = '{lock_timeout}ms'"))
        db.execute(text("SELECT pg_advisory_xact_lock(:lock)"), {"lock": ENGINE_LOCK})
    elif db.get_bind().dialect.name == "sqlite":
        # Obtained before reading the ledger, so distinct workers cannot both spend the same cash.
        db.execute(text("BEGIN IMMEDIATE"))
    else:
        raise RuntimeError("Unsupported database for atomic engine transactions.")


def capture_state(service: Any) -> dict[str, Any]:
    return {
        "version": SNAPSHOT_VERSION,
        "app_mode": config.app_mode,
        "saved_at": datetime.now(UTC).isoformat(),
        "last_slow_refresh": service.last_slow_refresh.isoformat(),
        **{field: copy.deepcopy(getattr(service, field)) for field in FIELDS if hasattr(service, field)},
    }


def restore_state(service: Any, state: dict[str, Any] | None) -> None:
    if not state or state.get("version") != SNAPSHOT_VERSION or state.get("app_mode") != config.app_mode:
        for name in FIELDS:
            if hasattr(service, name):
                setattr(
                    service,
                    name,
                    0
                    if name == "tick"
                    else {}
                    if name != "provider_status"
                    else "DATA MISSING. No saved analysis exists; run the authenticated refresh job.",
                )
        service.last_slow_refresh = datetime(1970, 1, 1, tzinfo=UTC)
        return
    for field in FIELDS:
        if field in state:
            setattr(service, field, copy.deepcopy(state[field]))
    service.last_slow_refresh = datetime.fromisoformat(state["last_slow_refresh"])


@asynccontextmanager
async def transaction(service: Any, session_factory: Callable[[], Session]) -> AsyncIterator[Session]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + HOSTED_TRANSACTION_SECONDS if config.hosted else None

    def check_deadline(*args: Any) -> None:
        # Synchronous SQL does not yield to asyncio's cancellation callback.
        # Check before every statement as well as the final commit.
        if deadline is not None and loop.time() >= deadline:
            raise TimeoutError("The hosted transaction exceeded its time budget.")

    async with asyncio.timeout_at(deadline):
        async with service.lock:
            check_deadline()
            previous = capture_state(service)
            with session_factory() as db:
                connection = None
                try:
                    if deadline is not None:
                        connection = db.connection()
                        event.listen(connection, "before_cursor_execute", check_deadline)
                    acquire_database_lock(db)
                    row = db.get(Setting, RUNTIME_IDS[config.app_mode])
                    if config.hosted:
                        restore_state(service, row.data if row else None)
                    yield db
                    check_deadline()
                    state = capture_state(service)
                    if row:
                        # Polls do not rewrite a large unchanged snapshot every 30 seconds.
                        old_values = {key: value for key, value in row.data.items() if key != "saved_at"}
                        new_values = {key: value for key, value in state.items() if key != "saved_at"}
                        if old_values != new_values:
                            row.data = state
                    else:
                        db.add(Setting(id=RUNTIME_IDS[config.app_mode], data=state))
                    check_deadline()
                    db.commit()
                except BaseException:
                    try:
                        db.rollback()
                    finally:
                        restore_state(service, previous)
                    raise
                finally:
                    if connection is not None:
                        event.remove(connection, "before_cursor_execute", check_deadline)


def auth_attempt(db: Session, key: str, success: bool = False, now: datetime | None = None) -> dict[str, Any]:
    """Reserve an attempt before checking credentials; service-authenticated success clears it."""
    now = now or datetime.now(UTC)
    current = now.timestamp()
    row = db.get(Setting, AUTH_ID)
    data = copy.deepcopy(row.data) if row else {}
    # Bound retention and prevent raw IPs / submitted identifiers being persisted.
    data = {k: [t for t in times if t > current - 900] for k, times in data.items()}
    data = {k: times for k, times in data.items() if times}
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    times = data.get(digest, [])
    if success:
        data.pop(digest, None)
        result = {"allowed": True, "retry_after": 0}
    elif len(times) >= 5:
        result = {"allowed": False, "retry_after": max(1, math.ceil(times[0] + 900 - current))}
    else:
        data[digest] = times + [current]
        result = {"allowed": True, "retry_after": 0}
    if row:
        row.data = data
    else:
        db.add(Setting(id=AUTH_ID, data=data))
    return result


async def run_scheduler(service: Any, session_factory: Callable[[], Session]) -> None:
    """Local-only daemon; serverless deployments use authenticated bounded jobs."""
    while True:
        await asyncio.sleep(config.tick_seconds)
        async with transaction(service, session_factory) as db:
            local = datetime.now(ZoneInfo("Europe/Dublin"))
            if (
                local.hour >= 9
                and local.weekday() < 5
                and (service.last_slow_refresh.astimezone(ZoneInfo("Europe/Dublin")).date() < local.date())
            ):
                await service.slow_refresh(db)
            await service.fast_tick(db)
