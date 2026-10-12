"""One persistent Alpaca Basic IEX connection, with explicit subscription ACKs.

The public Alpaca SDK does not expose subscription acknowledgements or socket
status callbacks. This small adapter therefore uses Alpaca's documented JSON
protocol rather than SDK private fields. Historical SDK use is independent.
No REST requests, database transactions, or company analysis run here.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import random
from collections.abc import Awaitable, Callable, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO, Protocol

from websockets.asyncio.client import connect

from .watchlist import BASIC_MAX_SYMBOLS, normalize_symbol, validate_capacity

IEX_ENDPOINT = "wss://stream.data.alpaca.markets/v2/iex"
CHANNELS = ("trades", "quotes", "bars")
Callback = Callable[[dict[str, Any]], Awaitable[None]]


class Socket(Protocol):
    async def send(self, message: str) -> Any: ...
    async def recv(self) -> str | bytes: ...
    async def close(self) -> Any: ...


class StreamProtocolError(Exception):
    """Safe, locally generated messages only; never echo provider payloads."""


class StreamProcessLock:
    """OS-owned lock survives no crash and guards sibling local workers.

    Every process for an account must use the same path. It contains no keys.
    An always-on deployment should run exactly one worker and a shared lock
    path (or a bounded renewable distributed lease), never a held DB session.
    """

    def __init__(self, path: Path):
        self.path = path
        self.handle: BinaryIO | None = None

    def acquire(self) -> bool:
        if self.handle is not None:
            return True
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        if handle.seek(0, os.SEEK_END) == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                file_lock: Any = fcntl
                file_lock.flock(handle.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.handle = handle
        return True

    def release(self) -> None:
        if self.handle is None:
            return
        handle, self.handle = self.handle, None
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                file_lock: Any = fcntl
                file_lock.flock(handle.fileno(), file_lock.LOCK_UN)
        finally:
            handle.close()


def _number(value: Any, *, zero: bool = False) -> float:
    if isinstance(value, bool):
        raise ValueError("Boolean is not a market value")
    result = float(value)
    if not math.isfinite(result) or result < 0 or (not zero and result == 0):
        raise ValueError("Invalid market value")
    return result


def _timestamp(value: Any) -> tuple[datetime, int]:
    if not isinstance(value, str):
        raise ValueError("Timestamp must be RFC3339")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    parsed = parsed.astimezone(UTC)
    # Preserve sub-microsecond ordering in Alpaca's nanosecond trade/quote feed.
    fraction = value.partition(".")[2]
    digits = ""
    for character in fraction:
        if not character.isdigit():
            break
        digits += character
    nanos = int((digits + "000000000")[:9])
    epoch_seconds = int(parsed.replace(microsecond=0).timestamp())
    return parsed, epoch_seconds * 1_000_000_000 + nanos


def normalize_event(message: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    """Reject malformed, crossed, nonfinite and future data before ingestion.

    Quote sizes retain the provider's round-lot units. Minute volume is never
    mislabeled daily/consolidated volume. Bars are not fresh price evidence.
    """
    try:
        kind = {"q": "quote", "t": "trade", "b": "bar"}.get(str(message.get("T")))
        if kind is None:
            return None
        symbol = normalize_symbol(message["S"])
        timestamp, timestamp_ns = _timestamp(message["t"])
        now_ns = int(now.replace(microsecond=0).timestamp()) * 1_000_000_000 + now.microsecond * 1000
        if timestamp_ns > now_ns:
            return None
        result: dict[str, Any] = {
            "type": kind, "symbol": symbol, "timestamp": timestamp.isoformat(),
            "source_timestamp": message["t"], "received_at": now.isoformat(),
            "provider": "Alpaca", "feed": "iex", "timestamp_ns": timestamp_ns,
        }
        if kind == "quote":
            bid, ask = _number(message["bp"]), _number(message["ap"])
            if ask < bid:
                return None
            result.update(
                bid=bid, ask=ask, price=bid / 2 + ask / 2,
                bid_size=_number(message["bs"]), ask_size=_number(message["as"]),
                size_unit="round_lots", price_basis="iex_quote_midpoint",
            )
        elif kind == "trade":
            # Conservatively accept ordinary, odd-lot and intermarket-sweep
            # prints only. Out-of-sequence, average-price, prior-reference and
            # other special-condition trades must not become an actionable last
            # price. Minute bars still supply the provider's eligible volume.
            conditions = message.get("c", [])
            if not isinstance(conditions, list) or any(condition not in {"@", " ", "I", "F"} for condition in conditions):
                return None
            price = _number(message["p"])
            result.update(price=price, last_trade=price, size=_number(message["s"]), price_basis="iex_last_trade")
            if isinstance(message.get("i"), int):
                result["trade_id"] = message["i"]
        else:
            opening, high, low, closing = [_number(message[key]) for key in ("o", "h", "l", "c")]
            if not low <= min(opening, closing) <= max(opening, closing) <= high:
                return None
            result.update(
                open=opening, high=high, low=low, close=closing,
                volume=_number(message["v"], zero=True), volume_basis="iex_minute", timeframe="1Min",
            )
        return result
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        return None


async def _open_socket() -> Socket:
    return await connect(
        IEX_ENDPOINT, additional_headers={"Content-Type": "application/json"},
        open_timeout=10, close_timeout=5, ping_interval=20, ping_timeout=20,
        max_queue=32, max_size=2**20,
    )


class AlpacaStream:
    def __init__(
        self, api_key: str, secret_key: str, *, on_event: Callback, on_status: Callback,
        max_symbols: int = BASIC_MAX_SYMBOLS, lock_path: Path | str | None = None,
        freshness_seconds: float = 30,
        connector: Callable[[], Awaitable[Socket]] = _open_socket,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        jitter: Callable[[], float] = random.random,
        reconnect_base_seconds: float = 1, reconnect_max_seconds: float = 60,
        acknowledgement_timeout: float = 10,
    ):
        validate_capacity(max_symbols)
        if freshness_seconds <= 0 or acknowledgement_timeout <= 0:
            raise ValueError("Freshness and acknowledgement deadlines must be positive.")
        self._api_key, self._secret_key = api_key, secret_key
        self.on_event, self.on_status = on_event, on_status
        self.max_symbols, self.freshness_seconds = max_symbols, freshness_seconds
        self._connector, self._clock, self._jitter = connector, clock, jitter
        self._backoff_base, self._backoff_max = reconnect_base_seconds, reconnect_max_seconds
        self._ack_timeout = acknowledgement_timeout
        self._lock = StreamProcessLock(Path(lock_path) if lock_path else Path(__file__).resolve().parents[2] / "data" / "alpaca-stream.lock")
        self._desired: tuple[str, ...] = ()
        self._acknowledged: set[str] = set()
        self._channel_symbols: dict[str, set[str]] = {channel: set() for channel in CHANNELS}
        self._expected_ack: dict[str, set[str]] | None = None
        self._sent_at: float | None = None
        self._last_price: dict[str, datetime] = {}
        self._last_price_kind: dict[str, str] = {}
        self._last_sequence: dict[tuple[str, str], int] = {}
        self._last_price_sequence: dict[str, int] = {}
        self._last_event_at: str | None = None
        self._connected_at: str | None = None
        self._last_error: str | None = None
        self._connected = False
        self._state = "waiting"
        self._changed = asyncio.Event()
        self._stop = asyncio.Event()
        self._socket: Socket | None = None
        self._runner: asyncio.Task | None = None
        self._published: dict[str, Any] | None = None
        self._valid_in_session = False

    def set_symbols(self, symbols: Iterable[str]) -> None:
        """Same-event-loop control; validation is atomic and never subscribes '*'."""
        desired = tuple(dict.fromkeys(normalize_symbol(symbol) for symbol in symbols))
        if len(desired) > self.max_symbols:
            raise ValueError(f"HOT list exceeds the configured {self.max_symbols}-symbol allowance.")
        if desired == self._desired:
            return
        removed = set(self._desired) - set(desired)
        for symbol in removed:
            self._last_price.pop(symbol, None)
            self._last_price_kind.pop(symbol, None)
        self._desired = desired
        self._changed.set()

    def force_resubscribe(self) -> None:
        """Request a clean channel acknowledgement without restarting the socket."""
        if not self._connected:
            return
        self._acknowledged.clear()
        self._channel_symbols = {channel: set() for channel in CHANNELS}
        self._expected_ack = None
        self._sent_at = None
        self._changed.set()

    def snapshot(self) -> dict[str, Any]:
        now = self._clock()
        fresh = {
            symbol for symbol, stamp in self._last_price.items()
            if self._connected and symbol in self._acknowledged
            and 0 <= (now - stamp).total_seconds() <= self.freshness_seconds
        }
        desired = set(self._desired)
        return {
            "provider": "Alpaca", "feed": "iex", "status": self._state,
            "connected": self._connected, "max_symbols": self.max_symbols,
            "desired_symbols": list(self._desired),
            "subscribed_symbols": sorted(self._acknowledged & desired),
            "trade_symbols": sorted(self._channel_symbols["trades"] & desired),
            "bar_symbols": sorted(self._channel_symbols["bars"] & desired),
            "pending_symbols": sorted(desired - self._acknowledged),
            "stale_symbols": sorted(desired - fresh), "fresh_symbols": sorted(desired & fresh),
            "connected_at": self._connected_at,
            "last_event_at": self._last_event_at, "last_error": self._last_error,
        }

    async def _publish(self, *, force: bool = False) -> None:
        status = self.snapshot()
        # Advancing timestamps alone need not send/persist a second callback for
        # every quote. Events already carry timestamps for the fast-loop consumer.
        comparison = {key: value for key, value in status.items() if key != "last_event_at"}
        if force or comparison != self._published:
            await self.on_status(status)
            self._published = comparison

    async def stop(self) -> None:
        self._stop.set()
        self._changed.set()
        if self._socket is not None:
            await self._socket.close()
        if self._runner is not None and self._runner is not asyncio.current_task():
            await self._runner

    async def _wait(self, seconds: float | None = None) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._changed.wait(), timeout=seconds)
        self._changed.clear()

    async def run(self) -> None:
        if self._runner is not None:
            raise RuntimeError("The Alpaca stream already has a runner.")
        self._runner = asyncio.current_task()
        failures = 0
        try:
            if not self._api_key or not self._secret_key:
                self._state, self._last_error = "blocked", "Alpaca credentials are not configured."
                await self._publish()
                return
            while not self._stop.is_set():
                if not self._desired:
                    self._state = "waiting"
                    await self._publish()
                    await self._wait()
                    continue
                if not self._lock.acquire():
                    self._state, self._last_error = "blocked", "Another local process owns the Alpaca stream."
                    await self._publish()
                    await self._wait(5)
                    continue
                self._state = "connecting" if failures == 0 else "reconnecting"
                await self._publish()
                self._valid_in_session = False
                try:
                    self._socket = await self._connector()
                    await self._session(self._socket)
                    if not self._stop.is_set() and self._desired:
                        raise StreamProtocolError("Alpaca stream ended unexpectedly.")
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    # Upstream exceptions may include credential-bearing URLs
                    # or raw messages. Only locally generated safe errors escape.
                    self._last_error = str(error) if isinstance(error, StreamProtocolError) else "Alpaca stream disconnected; retrying."
                    failures = 1 if self._valid_in_session else failures + 1
                finally:
                    self._connected = False
                    self._acknowledged.clear()
                    self._last_price.clear()
                    self._last_price_kind.clear()
                    self._expected_ack = None
                    self._channel_symbols = {channel: set() for channel in CHANNELS}
                    if self._socket is not None:
                        with contextlib.suppress(Exception):
                            await self._socket.close()
                        self._socket = None
                if not self._stop.is_set():
                    self._state = "reconnecting" if self._desired else "waiting"
                    await self._publish()
                    if self._desired:
                        delay = min(self._backoff_max, self._backoff_base * 2 ** min(failures - 1, 10))
                        # Bounded jitter prevents simultaneous clients hammering
                        # reconnect after an outage; desired edits do not bypass it.
                        delay *= 0.75 + 0.25 * max(0.0, min(1.0, self._jitter()))
                        with contextlib.suppress(TimeoutError):
                            await asyncio.wait_for(self._stop.wait(), timeout=delay)
        finally:
            self._connected = False
            self._acknowledged.clear()
            self._last_price.clear()
            self._last_price_kind.clear()
            self._lock.release()
            if self._stop.is_set() or self._state != "blocked":
                self._state = "stopped"
            self._runner = None
            await self._publish(force=True)

    async def _messages(self, socket: Socket, *, timeout: float | None = None) -> list[dict]:
        raw = await asyncio.wait_for(socket.recv(), timeout=timeout) if timeout else await socket.recv()
        try:
            messages = json.loads(raw)
        except (TypeError, ValueError):
            raise StreamProtocolError("Alpaca sent an invalid stream frame.") from None
        if not isinstance(messages, list) or any(not isinstance(message, dict) for message in messages):
            raise StreamProtocolError("Alpaca sent an invalid stream frame.")
        for message in messages:
            if message.get("T") == "error":
                descriptions = {
                    402: "Alpaca authentication failed.", 405: "Alpaca live-symbol allowance was exceeded.",
                    406: "Alpaca already has an active connection for this account.",
                    409: "Alpaca IEX permission is unavailable.",
                }
                raise StreamProtocolError(descriptions.get(message.get("code"), "Alpaca reported a stream error."))
        return messages

    async def _session(self, socket: Socket) -> None:
        messages = await self._messages(socket, timeout=10)
        if not any(message.get("T") == "success" and message.get("msg") == "connected" for message in messages):
            raise StreamProtocolError("Alpaca did not confirm the connection.")
        await socket.send(json.dumps({"action": "auth", "key": self._api_key, "secret": self._secret_key}))
        messages = await self._messages(socket, timeout=10)
        if not any(message.get("T") == "success" and message.get("msg") == "authenticated" for message in messages):
            raise StreamProtocolError("Alpaca did not confirm authentication.")
        self._connected, self._state, self._last_error = True, "connected", None
        self._connected_at = self._clock().isoformat()
        await self._publish()
        await self._reconcile(socket)
        reader: asyncio.Task | None = None
        changed: asyncio.Task | None = None
        try:
            while not self._stop.is_set() and self._desired:
                if reader is None:
                    reader = asyncio.create_task(self._messages(socket))
                if changed is None:
                    changed = asyncio.create_task(self._changed.wait())
                done, _ = await asyncio.wait({reader, changed}, timeout=min(1.0, self.freshness_seconds), return_when=asyncio.FIRST_COMPLETED)
                if changed in done:
                    self._changed.clear()
                    changed = None
                if reader in done:
                    messages = reader.result()
                    reader = None
                    for message in messages:
                        await self._handle(message)
                if self._expected_ack is not None and self._sent_at is not None:
                    if asyncio.get_running_loop().time() - self._sent_at > self._ack_timeout:
                        raise StreamProtocolError("Alpaca did not acknowledge the HOT subscription in time.")
                await self._reconcile(socket)
                await self._publish()
        finally:
            for task in (reader, changed):
                if task is not None:
                    task.cancel()
            await asyncio.gather(*(task for task in (reader, changed) if task is not None), return_exceptions=True)

    async def _reconcile(self, socket: Socket) -> None:
        if self._expected_ack is not None:
            return
        desired = set(self._desired)
        # Alpaca Basic counts quote and trade subscriptions against one
        # 30-channel allowance. Every HOT symbol receives top-of-book quotes;
        # remaining channels add individual trades in priority order.
        trade_slots = max(0, self.max_symbols - len(desired))
        targets = {
            "quotes": desired,
            "trades": set(self._desired[:trade_slots]),
            "bars": desired,
        }
        # Remove, wait for ACK, then add. A full HOT list swap cannot briefly
        # exceed Basic's cap, even if subscription messages are processed slowly.
        removals = {channel: sorted(symbols - targets[channel]) for channel, symbols in self._channel_symbols.items()}
        if any(removals.values()):
            payload = {"action": "unsubscribe", **removals}
            expected = {channel: symbols & targets[channel] for channel, symbols in self._channel_symbols.items()}
        else:
            additions = {channel: sorted(targets[channel] - symbols) for channel, symbols in self._channel_symbols.items()}
            if not any(additions.values()):
                return
            payload = {"action": "subscribe", **additions}
            expected = {channel: set(symbols) | targets[channel] for channel, symbols in self._channel_symbols.items()}
        self._expected_ack = expected
        self._sent_at = asyncio.get_running_loop().time()
        await socket.send(json.dumps(payload))

    async def _handle(self, message: dict[str, Any]) -> None:
        if message.get("T") == "subscription":
            actual: dict[str, set[str]] = {}
            for channel in CHANNELS:
                values = message.get(channel, [])
                if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                    raise StreamProtocolError("Alpaca returned an invalid subscription acknowledgement.")
                try:
                    actual[channel] = {normalize_symbol(value) for value in values}
                except ValueError:
                    raise StreamProtocolError("Alpaca returned an invalid subscription acknowledgement.") from None
            if len(actual["quotes"] | actual["trades"]) > self.max_symbols or len(actual["bars"]) > self.max_symbols:
                raise StreamProtocolError("Alpaca acknowledged more channels than the configured allowance.")
            if self._expected_ack is not None and actual != self._expected_ack:
                raise StreamProtocolError("Alpaca did not confirm the requested subscription.")
            self._channel_symbols = actual
            acknowledged = actual["quotes"]
            for removed_symbol in self._acknowledged - acknowledged:
                self._last_price.pop(removed_symbol, None)
            self._acknowledged = acknowledged
            self._expected_ack = None
            self._sent_at = None
            await self._publish()
            return
        symbol = message.get("S")
        if not isinstance(symbol, str) or symbol not in self._desired or symbol not in self._acknowledged:
            return
        if message.get("T") in {"c", "x"}:
            # A correction/cancel can invalidate the latest trade. Fail closed
            # until a later valid quote/trade rather than calling REST per event.
            if self._last_price_kind.get(symbol) == "trade":
                self._last_price.pop(symbol, None)
                self._last_price_kind.pop(symbol, None)
            await self._publish()
            return
        event = normalize_event(message, self._clock())
        if event is None:
            if message.get("T") == "q":
                # A zero-sided/invalid current quote withdraws usable liquidity.
                # Do not silently retain a healthy-looking old quote until TTL.
                # Delayed or future malformed frames cannot invalidate a newer
                # accepted price. Payload values never reach status/log text.
                try:
                    _, stamp = _timestamp(message.get("t"))
                    received = self._clock()
                    received_ns = int(received.replace(microsecond=0).timestamp()) * 1_000_000_000 + received.microsecond * 1000
                    if stamp <= received_ns and stamp >= self._last_price_sequence.get(symbol, -1):
                        self._last_price.pop(symbol, None)
                        self._last_price_kind.pop(symbol, None)
                        self._last_price_sequence[symbol] = stamp
                        self._last_sequence[(symbol, "quote")] = stamp
                        await self._publish()
                except (TypeError, ValueError):
                    pass
            return
        kind, stamp = event["type"], event["timestamp_ns"]
        key = (symbol, kind)
        if stamp <= self._last_sequence.get(key, -1):
            return
        if kind != "bar" and stamp < self._last_price_sequence.get(symbol, -1):
            return
        self._last_sequence[key] = stamp
        if kind != "bar":
            self._last_price_sequence[symbol] = stamp
            self._last_price[symbol] = datetime.fromisoformat(event["timestamp"])
            self._last_price_kind[symbol] = kind
        self._valid_in_session = True
        self._last_event_at = event["received_at"]
        await self.on_event(event)
        await self._publish()
