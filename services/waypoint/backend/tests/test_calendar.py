from datetime import datetime

import pytest

from app.calendar import market_status


def at(value: str):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def test_regular_session_includes_open_excludes_close():
    assert not market_status(at("2026-10-07T13:29:59Z"))["is_open"]
    assert market_status(at("2026-10-07T13:30:00Z"))["is_open"]
    assert not market_status(at("2026-10-07T20:00:00Z"))["is_open"]


def test_holiday_and_weekend_are_closed():
    assert not market_status(at("2026-07-03T15:00:00Z"))["is_open"]
    assert not market_status(at("2026-10-10T15:00:00Z"))["is_open"]
    status = market_status(at("2026-12-25T15:00:00Z"))
    assert not status["is_open"]
    assert status["next_open"].startswith("2026-12-28T14:30")


def test_dublin_us_dst_mismatch():
    # US changes on March 8, Ireland March 29 in this calendar year.
    assert "13:30" in market_status(at("2026-03-09T09:00:00Z"))["label"]
    assert "14:30" in market_status(at("2026-03-30T08:00:00Z"))["label"]
    assert "13:30" in market_status(at("2026-10-26T09:00:00Z"))["label"]
    assert "14:30" in market_status(at("2026-11-02T09:00:00Z"))["label"]


def test_short_day_closes_early():
    assert market_status(at("2026-11-27T17:59:59Z"))["is_open"]
    assert not market_status(at("2026-11-27T18:00:00Z"))["is_open"]


def test_naive_time_is_rejected():
    with pytest.raises(ValueError):
        market_status(datetime(2026, 1, 1))
