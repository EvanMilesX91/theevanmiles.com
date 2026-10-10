import asyncio
import json
import math
from datetime import UTC, datetime, timedelta

import pytest

from app.streaming import AlpacaStream, StreamProcessLock, normalize_event

NOW = datetime(2026, 10, 9, 15, 0, tzinfo=UTC)


def quote(symbol="AAPL", at=NOW, **updates):
    return {"T": "q", "S": symbol, "bp": 100, "ap": 101, "bs": 1, "as": 2, "t": at.isoformat(), **updates}


class FakeSocket:
    def __init__(self, *, auto_ack=True):
        self.messages = asyncio.Queue()
        self.messages.put_nowait([{"T": "success", "msg": "connected"}])
        self.sent = []
        self.symbols = {channel: set() for channel in ("trades", "quotes", "bars")}
        self.closed = False
        self.auto_ack = auto_ack

    async def send(self, raw):
        message = json.loads(raw)
        self.sent.append(message)
        if message["action"] == "auth":
            self.messages.put_nowait([{"T": "success", "msg": "authenticated"}])
            return
        for channel, symbols in self.symbols.items():
            if message["action"] == "subscribe":
                symbols.update(message.get(channel, []))
            else:
                symbols.difference_update(message.get(channel, []))
        if self.auto_ack:
            self.ack()

    def ack(self):
        self.messages.put_nowait([{"T": "subscription", **{key: sorted(value) for key, value in self.symbols.items()}}])

    async def recv(self):
        value = await self.messages.get()
        if isinstance(value, Exception):
            raise value
        return json.dumps(value)

    async def close(self):
        if not self.closed:
            self.closed = True
            self.messages.put_nowait(ConnectionError("closed"))


async def until(predicate, timeout=2):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.001)


def make_stream(tmp_path, sockets, **kwargs):
    events, statuses, opened = [], [], []

    async def on_event(event):
        events.append(event)

    async def on_status(status):
        statuses.append(status)

    async def connector():
        socket = sockets[len(opened)]
        opened.append(socket)
        return socket

    stream = AlpacaStream(
        "fake-key", "fake-secret", on_event=on_event, on_status=on_status,
        lock_path=tmp_path / "alpaca.lock", connector=connector,
        clock=kwargs.pop("clock", lambda: NOW),
        reconnect_base_seconds=0.01, reconnect_max_seconds=0.02,
        **kwargs,
    )
    return stream, events, statuses, opened


@pytest.mark.parametrize("updates", [
    {"bp": 0}, {"ap": -1}, {"bp": math.nan}, {"ap": math.inf}, {"bs": -1},
    {"bp": 105, "ap": 100}, {"as": True}, {"as": 0}, {"bs": 0}, {"S": "*"}, {"t": "2026-10-09T15:00:01Z"},
    {"t": "2026-10-09T15:00:00"}, {"t": "garbage"},
])
def test_rejects_invalid_and_future_quotes(updates):
    assert normalize_event(quote(**updates), NOW) is None


def test_normalization_exposes_iex_price_basis_units_and_minute_volume():
    value = normalize_event(quote(), NOW)
    assert value["price"] == 100.5
    assert value["bid_size"] == 1
    assert value["size_unit"] == "round_lots"
    assert value["feed"] == "iex"
    assert value["provider"] == "Alpaca"
    bar = normalize_event({"T": "b", "S": "AAPL", "o": 100, "h": 102, "l": 99, "c": 101, "v": 300, "t": NOW.isoformat()}, NOW)
    assert bar["volume_basis"] == "iex_minute"
    assert "price" not in bar


def test_no_connection_until_symbols_then_subscription_ack_and_freshness_gate(tmp_path):
    async def scenario():
        socket = FakeSocket(auto_ack=False)
        stream, events, statuses, opened = make_stream(tmp_path, [socket])
        task = asyncio.create_task(stream.run())
        await until(lambda: statuses)
        assert not opened
        stream.set_symbols(["aapl"])
        await until(lambda: any(item.get("action") == "subscribe" for item in socket.sent))
        assert stream.snapshot()["pending_symbols"] == ["AAPL"]
        socket.messages.put_nowait([quote()])
        await asyncio.sleep(0.01)
        assert events == []
        socket.ack()
        await until(lambda: stream.snapshot()["subscribed_symbols"] == ["AAPL"])
        assert stream.snapshot()["stale_symbols"] == ["AAPL"]
        socket.messages.put_nowait([quote()])
        await until(lambda: events)
        assert stream.snapshot()["fresh_symbols"] == ["AAPL"]
        await stream.stop()
        await task
        assert socket.closed
    asyncio.run(scenario())


def test_quotes_go_stale_without_any_new_frames(tmp_path):
    async def scenario():
        now = [NOW]
        socket = FakeSocket()
        stream, events, statuses, _ = make_stream(tmp_path, [socket], clock=lambda: now[0], freshness_seconds=0.01)
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        socket.messages.put_nowait([quote()])
        await until(lambda: events)
        now[0] += timedelta(seconds=1)
        await until(lambda: statuses[-1]["stale_symbols"] == ["AAPL"])
        assert stream.snapshot()["fresh_symbols"] == []
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_disconnect_marks_stale_reconnects_and_requires_new_valid_price(tmp_path):
    async def scenario():
        first, second = FakeSocket(), FakeSocket()
        stream, events, statuses, opened = make_stream(tmp_path, [first, second])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        first.messages.put_nowait([quote(at=NOW - timedelta(seconds=1))])
        await until(lambda: events)
        first.messages.put_nowait(ConnectionError("credential-secret-must-never-escape"))
        await until(lambda: len(opened) == 2 and stream.snapshot()["subscribed_symbols"])
        assert first.closed
        assert stream.snapshot()["fresh_symbols"] == []
        assert any(item["status"] == "reconnecting" and item["stale_symbols"] == ["AAPL"] for item in statuses)
        assert all("credential-secret" not in str(item) for item in statuses)
        second.messages.put_nowait([quote()])
        await until(lambda: len(events) == 2)
        assert stream.snapshot()["fresh_symbols"] == ["AAPL"]
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_hot_swap_unsubscribes_and_waits_for_ack_before_addition(tmp_path):
    async def scenario():
        socket = FakeSocket()
        stream, events, _, opened = make_stream(tmp_path, [socket], max_symbols=1)
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        socket.auto_ack = False
        stream.set_symbols(["MSFT"])
        await until(lambda: socket.sent[-1]["action"] == "unsubscribe")
        assert socket.sent[-1]["quotes"] == ["AAPL"]
        assert stream.snapshot()["pending_symbols"] == ["MSFT"]
        await asyncio.sleep(0.01)
        assert socket.sent[-1]["action"] == "unsubscribe"
        socket.ack()
        await until(lambda: socket.sent[-1]["action"] == "subscribe")
        assert socket.sent[-1]["quotes"] == ["MSFT"]
        socket.messages.put_nowait([quote(symbol="MSFT")])
        await asyncio.sleep(0.01)
        assert not events
        socket.ack()
        await until(lambda: stream.snapshot()["subscribed_symbols"] == ["MSFT"])
        socket.messages.put_nowait([quote(symbol="MSFT")])
        await until(lambda: events)
        assert len(opened) == 1
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_out_of_order_duplicate_future_and_minute_bars_do_not_restore_price(tmp_path):
    async def scenario():
        socket = FakeSocket()
        stream, events, _, _ = make_stream(tmp_path, [socket])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        socket.messages.put_nowait([quote(), quote(at=NOW - timedelta(seconds=1)), quote(), quote(at=NOW + timedelta(seconds=1))])
        await until(lambda: events)
        await asyncio.sleep(0.01)
        assert len(events) == 1
        socket.messages.put_nowait([{"T": "t", "S": "AAPL", "p": 100, "s": 1, "t": NOW.isoformat()}])
        await until(lambda: len(events) == 2)
        socket.messages.put_nowait([{"T": "x", "S": "AAPL"}])
        await until(lambda: stream.snapshot()["stale_symbols"])
        socket.messages.put_nowait([{"T": "b", "S": "AAPL", "o": 100, "h": 101, "l": 99, "c": 100, "v": 42, "t": (NOW - timedelta(minutes=1)).isoformat()}])
        await until(lambda: len(events) == 3)
        assert stream.snapshot()["fresh_symbols"] == []
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_nanosecond_order_and_trade_quote_cross_channel_order(tmp_path):
    async def scenario():
        socket = FakeSocket()
        stream, events, _, _ = make_stream(tmp_path, [socket])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        socket.messages.put_nowait([
            quote(t="2026-10-09T14:59:59.000000002Z"), quote(t="2026-10-09T14:59:59.000000001Z"),
            quote(t="2026-10-09T14:59:59.000000003Z"),
            {"T": "t", "S": "AAPL", "p": 99, "s": 1, "t": "2026-10-09T14:59:58Z"},
            {"T": "t", "S": "AAPL", "p": 101, "s": 1, "t": NOW.isoformat()},
        ])
        await until(lambda: len(events) == 3)
        assert [item["type"] for item in events] == ["quote", "quote", "trade"]
        assert events[-1]["last_trade"] == 101
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_symbols_are_validated_atomically_before_any_upstream_request(tmp_path):
    stream, _, _, opened = make_stream(tmp_path, [], max_symbols=2)
    stream.set_symbols(["AAPL"])
    for symbols in (["AAPL", "MSFT", "NVDA"], ["*"], ["invalid/symbol"]):
        with pytest.raises(ValueError):
            stream.set_symbols(symbols)
        assert stream.snapshot()["desired_symbols"] == ["AAPL"]
    assert opened == []


def test_os_lock_blocks_another_worker_and_releases_for_restart(tmp_path):
    first = StreamProcessLock(tmp_path / "feed.lock")
    second = StreamProcessLock(tmp_path / "feed.lock")
    assert first.acquire()
    assert not second.acquire()
    first.release()
    assert second.acquire()
    second.release()


def test_blocked_process_opens_no_connection_and_cleanly_stops(tmp_path):
    async def scenario():
        lock = StreamProcessLock(tmp_path / "alpaca.lock")
        assert lock.acquire()
        stream, _, statuses, opened = make_stream(tmp_path, [])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: statuses and statuses[-1]["status"] == "blocked")
        assert not opened
        await stream.stop()
        await task
        lock.release()
    asyncio.run(scenario())


def test_cancellation_closes_socket_and_releases_process_lock(tmp_path):
    async def scenario():
        socket = FakeSocket()
        stream, _, _, _ = make_stream(tmp_path, [socket])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert socket.closed
        assert stream.snapshot()["status"] == "stopped"
        lock = StreamProcessLock(tmp_path / "alpaca.lock")
        assert lock.acquire()
        lock.release()
    asyncio.run(scenario())


def test_ack_timeout_reconnects_and_resubscribes_without_making_pending_symbol_fresh(tmp_path):
    async def scenario():
        first, second = FakeSocket(auto_ack=False), FakeSocket()
        stream, _, statuses, opened = make_stream(tmp_path, [first, second], acknowledgement_timeout=0.01, freshness_seconds=0.01)
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: len(opened) == 2 and stream.snapshot()["subscribed_symbols"])
        assert any("acknowledge" in (item["last_error"] or "") for item in statuses)
        assert stream.snapshot()["fresh_symbols"] == []
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_provider_symbol_limit_failure_is_safely_reported_and_retried(tmp_path):
    async def scenario():
        first, second = FakeSocket(auto_ack=False), FakeSocket()
        stream, _, statuses, opened = make_stream(tmp_path, [first, second])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: any(item["action"] == "subscribe" for item in first.sent))
        first.messages.put_nowait([{"T": "error", "code": 405, "msg": "untrusted message"}])
        await until(lambda: len(opened) == 2 and stream.snapshot()["subscribed_symbols"])
        assert any("allowance" in (item["last_error"] or "") for item in statuses)
        assert all("untrusted message" not in str(item) for item in statuses)
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_quote_withdrawal_immediately_marks_stale_and_special_trades_cannot_restore_it(tmp_path):
    async def scenario():
        socket = FakeSocket()
        stream, events, statuses, _ = make_stream(tmp_path, [socket])
        stream.set_symbols(["AAPL"])
        task = asyncio.create_task(stream.run())
        await until(lambda: stream.snapshot()["subscribed_symbols"])
        socket.messages.put_nowait([quote(at=NOW - timedelta(seconds=2))])
        await until(lambda: events)
        assert stream.snapshot()["fresh_symbols"] == ["AAPL"]
        socket.messages.put_nowait([quote(bp=0, at=NOW - timedelta(seconds=1))])
        await until(lambda: statuses[-1]["stale_symbols"] == ["AAPL"])
        socket.messages.put_nowait([{"T": "t", "S": "AAPL", "p": 100, "s": 10, "c": ["W"], "t": NOW.isoformat()}])
        await asyncio.sleep(0.01)
        assert len(events) == 1
        assert stream.snapshot()["fresh_symbols"] == []
        socket.messages.put_nowait([quote()])
        await until(lambda: len(events) == 2)
        assert stream.snapshot()["fresh_symbols"] == ["AAPL"]
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_future_nanoseconds_are_not_rounded_down_into_current_time():
    assert normalize_event(quote(t="2026-10-09T15:00:00.000000001Z"), NOW) is None


def test_full_thirty_symbol_watchlist_uses_one_connection_and_three_batched_channels(tmp_path):
    async def scenario():
        socket = FakeSocket()
        stream, events, _, opened = make_stream(tmp_path, [socket])
        symbols = [f"T{index}" for index in range(30)]
        stream.set_symbols(symbols)
        task = asyncio.create_task(stream.run())
        await until(lambda: len(stream.snapshot()["subscribed_symbols"]) == 30)
        assert len(opened) == 1
        assert len(socket.sent) == 2  # one auth and one batched subscription
        assert len(socket.sent[-1]["quotes"]) == 30
        assert len(socket.sent[-1]["bars"]) == 30
        assert socket.sent[-1]["trades"] == []
        socket.messages.put_nowait([quote(symbol=symbol) for symbol in symbols])
        await until(lambda: len(events) == 30)
        assert len(stream.snapshot()["fresh_symbols"]) == 30
        await stream.stop()
        await task
    asyncio.run(scenario())


def test_midpoint_remains_finite_for_finite_input_prices():
    assert math.isfinite(normalize_event(quote(bp=1e308, ap=1e308), NOW)["price"])
