"""Pure market-event normalization and fresh-price gates; no network or database I/O."""
from datetime import UTC, datetime
from math import isfinite
from typing import Any


def timestamp(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(UTC) if parsed.tzinfo is not None else None
    except (ValueError, TypeError, AttributeError):
        return None


def number(value: Any, *, zero: bool = False) -> float | None:
    try:
        parsed = float(value)
        return parsed if isfinite(parsed) and (parsed >= 0 if zero else parsed > 0) else None
    except (TypeError, ValueError, OverflowError):
        return None


def apply_event(state: dict[str, Any], event: dict[str, Any], now: datetime) -> bool:
    """Reject future/out-of-order prices and never substitute a bar for a live quote."""
    kind = event.get('type')
    if kind not in {'quote', 'trade', 'bar'}:
        return False
    observed = timestamp(event.get('timestamp'))
    if observed is None or (observed - now).total_seconds() > 5:
        return False
    previous = timestamp(state.get(f'{kind}_at'))
    if previous is not None and observed <= previous:
        return False
    if kind == 'quote':
        bid, ask = number(event.get('bid')), number(event.get('ask'))
        if bid is None or ask is None or ask < bid:
            return False
        price = (bid + ask) / 2
        state.update(bid=bid, ask=ask, bid_size=number(event.get('bid_size'), zero=True),
                     ask_size=number(event.get('ask_size'), zero=True))
    elif kind == 'trade':
        trade_price = number(event.get('last_trade', event.get('price')))
        if trade_price is None:
            return False
        price = trade_price
        state.update(last_trade=price, last_trade_size=number(event.get('size'), zero=True))
    else:
        volume = number(event.get('volume'), zero=True)
        if volume is None:
            return False
        # This is minute IEX volume, not consolidated daily volume.
        state.update(volume=volume, volume_scope='IEX minute bar', bar_at=observed.isoformat())
        return True
    state[f'{kind}_at'] = observed.isoformat()
    prior_price = timestamp(state.get('timestamp'))
    if prior_price is None or observed >= prior_price:
        state.update(price=price, timestamp=observed.isoformat(), source_timestamp=observed.isoformat(),
                     received_at=now.isoformat(), provider='Alpaca', feed='iex', price_basis=kind)
    return True


def market_view(state: dict[str, Any], *, now: datetime, connected: bool, subscribed: bool,
                hot: bool, stale_seconds: float) -> dict[str, Any]:
    observed = timestamp(state.get('timestamp'))
    age = (now - observed).total_seconds() if observed else None
    stale = (not connected or not subscribed or not hot or age is None or not -5 <= age <= stale_seconds)
    return {**state, 'provider': 'Alpaca', 'feed': 'iex', 'age_seconds': max(0, age) if age is not None else None,
            'stale': stale}
