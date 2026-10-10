"""Regular US equity sessions, including holidays, short days and DST."""

from datetime import datetime, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

import exchange_calendars as xcals
import pandas as pd


@lru_cache(maxsize=8)
def _calendar(year: int):
    return xcals.get_calendar("XNYS", start=f"{year - 1}-01-01", end=f"{year + 1}-12-31")


def market_status(now: datetime | None = None) -> dict:
    """Return regular-session status; extended trading is deliberately excluded.

    ``next_open`` always means the next *future* opening and is stored in UTC.
    The human label uses Dublin local time. Naive input is rejected rather than
    guessed. A close timestamp belongs to the closed session, including short days.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("market_status requires a timezone-aware datetime")
    now = now.astimezone(timezone.utc)
    stamp = pd.Timestamp(now)
    schedule = _calendar(now.year).schedule
    active = schedule[(schedule["open"] <= stamp) & (schedule["close"] > stamp)]
    future = schedule[schedule["open"] > stamp]
    next_open = future.iloc[0]["open"].to_pydatetime()
    is_open = not active.empty
    if is_open:
        closes = active.iloc[0]["close"].to_pydatetime().astimezone(ZoneInfo("Europe/Dublin"))
        label = f"US market open · closes {closes:%H:%M} Dublin"
    else:
        local_open = next_open.astimezone(ZoneInfo("Europe/Dublin"))
        label = f"US market closed · opens {local_open:%a %d %b, %H:%M} Dublin"
    return {
        "is_open": is_open,
        "label": label,
        "next_open": next_open.isoformat(),
        "timezone": "Europe/Dublin",
    }
