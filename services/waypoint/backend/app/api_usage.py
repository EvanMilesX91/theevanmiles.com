"""JSON usage/cache metadata plus process-local request queues and single flight.

Callers share and persist one cache. Cross-process scheduling is serialized by
the engine; ``checkpoint`` persists reservations before a request is dispatched.
No credentials, request URLs, headers or provider response bodies are recorded.
"""

import asyncio
import copy
from collections.abc import Awaitable, Callable, MutableMapping
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any, TypeVar
from weakref import WeakKeyDictionary

USAGE_KEY = "api_usage_v1"
CACHE_VERSION = 1
T = TypeVar("T")


class RequestBlocked(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class _Shared:
    def __init__(self, cache: MutableMapping[str, Any]):
        self.cache = cache
        self.lock = asyncio.Lock()
        self.flights: dict[str, asyncio.Task[Any]] = {}


_loops: WeakKeyDictionary[Any, dict[tuple[int, str], _Shared]] = WeakKeyDictionary()


def _shared(cache: MutableMapping[str, Any], provider: str) -> _Shared:
    values = _loops.setdefault(asyncio.get_running_loop(), {})
    key = (id(cache), provider)
    if key not in values or values[key].cache is not cache:
        values[key] = _Shared(cache)
    return values[key]


async def singleflight(cache: MutableMapping[str, Any], provider: str, key: str, operation: Callable[[], Awaitable[T]]) -> T:
    flights = _shared(cache, provider).flights
    task = flights.get(key)
    if task is None:
        async def execute() -> T:
            return await operation()
        task = asyncio.create_task(execute())
        flights[key] = task
    try:
        # Cancellation propagates to upstream work, so timed-out engine jobs do
        # not keep changing a cache after its transaction has rolled back.
        return await task
    finally:
        if task.done() and flights.get(key) is task:
            flights.pop(key, None)


def cache_record(data: Any, source: str, retrieved_at: datetime, *, source_timestamp: str | None = None,
                 ttl: float | None = None, policy: str = "ttl", **metadata: Any) -> dict[str, Any]:
    return {
        "source": source, "retrieved_at": retrieved_at.isoformat(), "source_timestamp": source_timestamp,
        "expires_at": (retrieved_at + timedelta(seconds=ttl)).isoformat() if ttl is not None else None,
        "freshness_policy": policy, "data_version": CACHE_VERSION, "data": copy.deepcopy(data), **metadata,
    }


def cached_data(cache: MutableMapping[str, Any], key: str, now: datetime) -> Any | None:
    row = cache.get(key)
    if not isinstance(row, dict) or row.get("data_version") != CACHE_VERSION:
        return None
    try:
        if datetime.fromisoformat(row["retrieved_at"]) <= now < datetime.fromisoformat(row["expires_at"]):
            return copy.deepcopy(row["data"])
    except (ValueError, TypeError, KeyError):
        pass
    return None


def _row(cache: MutableMapping[str, Any], provider: str) -> dict[str, Any]:
    return cache.setdefault(USAGE_KEY, {}).setdefault(provider, {"provider": provider, "endpoints": {}})


def _counter(row: dict[str, Any], now: datetime) -> None:
    day, minute = now.date().isoformat(), now.strftime("%Y-%m-%dT%H:%M")
    if row.get("day") != day:
        row.update(day=day, requests_today=0, rate_limit_responses=0)
    if row.get("minute") != minute:
        row.update(minute=minute, requests_this_minute=0)
    row["requests_today"] += 1
    row["requests_this_minute"] += 1
    row["last_request"] = now.isoformat()


async def reserve_request(cache: MutableMapping[str, Any], provider: str, endpoint: str, *, interval: float,
                          clock: Callable[[], datetime], checkpoint: Callable[[], None] | None = None,
                          daily_limit: int | None = None, budget_key: str | None = None) -> None:
    async with _shared(cache, provider).lock:
        now = clock().astimezone(UTC)
        row = _row(cache, provider)
        try:
            cooldown = max(0.0, (datetime.fromisoformat(row.get("retry_at", now.isoformat())) - now).total_seconds())
            delay = max(cooldown, (datetime.fromisoformat(row.get("next_request_at", now.isoformat())) - now).total_seconds())
        except (ValueError, TypeError):
            raise RequestBlocked("invalid_cache") from None
        if delay > 5:
            raise RequestBlocked("rate_limited")
        if delay > 0:
            await asyncio.sleep(delay)
        now = clock().astimezone(UTC)
        # Tests may use a frozen observation clock; real requests still queue by
        # wall time, and a stored reservation survives provider reconstruction.
        row["next_request_at"] = (now + timedelta(seconds=interval)).isoformat()
        if daily_limit is not None:
            row["daily_limit"] = daily_limit
            budget = cache.get(budget_key, {}) if budget_key else row
            if not isinstance(budget, dict):
                raise RequestBlocked("invalid_cache")
            calls = budget.get("calls", 0) if budget.get("day") == now.date().isoformat() else 0
            if not isinstance(calls, int) or isinstance(calls, bool) or calls < 0:
                raise RequestBlocked("invalid_cache")
            if calls >= daily_limit:
                raise RequestBlocked("daily_limit")
            if budget_key:
                cache[budget_key] = {"day": now.date().isoformat(), "calls": calls + 1}
        _counter(row, now)
        _counter(row["endpoints"].setdefault(endpoint, {"endpoint": endpoint}), now)
        if checkpoint:
            try:
                checkpoint()
            except Exception:
                raise RequestBlocked("checkpoint_failed") from None


def record_result(cache: MutableMapping[str, Any], provider: str, endpoint: str, now: datetime,
                  *, error: str | None = None, rate_limited: bool = False) -> None:
    row = _row(cache, provider)
    endpoint_row = row["endpoints"].setdefault(endpoint, {"endpoint": endpoint})
    for item in (row, endpoint_row):
        if error:
            item["last_error"] = {"code": error, "at": now.isoformat()}
        else:
            item["last_success"] = now.isoformat()
            item["last_error"] = None
        if rate_limited:
            item["rate_limit_responses"] = item.get("rate_limit_responses", 0) + 1


def retry_after_seconds(value: str | None, now: datetime) -> float:
    if not value:
        return 0.0
    try:
        result = float(value)
        return max(0.0, result) if result < float("inf") else 86400.0
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return max(0.0, (parsed - now).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return 0.0


def set_cooldown(cache: MutableMapping[str, Any], provider: str, now: datetime, seconds: float) -> None:
    _row(cache, provider)["retry_at"] = (now + timedelta(seconds=min(seconds, 86400))).isoformat()


def usage_snapshot(cache: MutableMapping[str, Any], now: datetime | None = None) -> list[dict[str, Any]]:
    now = (now or datetime.now(UTC)).astimezone(UTC)
    result = []
    for provider in ("alpaca", "sec", "alpha_vantage"):
        source = cache.get(USAGE_KEY, {}).get(provider, {})

        def public(row: dict[str, Any]) -> dict[str, Any]:
            return {
                "requests_today": row.get("requests_today", 0) if row.get("day") == now.date().isoformat() else 0,
                "requests_this_minute": row.get("requests_this_minute", 0) if row.get("minute") == now.strftime("%Y-%m-%dT%H:%M") else 0,
                "last_request": row.get("last_request"), "last_success": row.get("last_success"),
                "last_error": copy.deepcopy(row.get("last_error")),
                "rate_limit_responses": row.get("rate_limit_responses", 0) if row.get("day") == now.date().isoformat() else 0,
            }

        result.append({"provider": provider, **public(source), "daily_limit": source.get("daily_limit"),
                       "endpoints": [{"endpoint": name, **public(row)} for name, row in source.get("endpoints", {}).items()]})
    return result
