"""Deterministic, capacity-bounded HOT selection. Selection is not a signal.

A selected symbol is pending until the stream confirms its subscription and a
fresh price arrives. Callers must separately enforce those freshness gates.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from dataclasses import dataclass

SYMBOL_PATTERN = re.compile(r"[A-Z][A-Z0-9.-]{0,11}\Z")
BASIC_MAX_SYMBOLS = 30


def normalize_symbol(symbol: str) -> str:
    value = symbol.strip().upper()
    if not SYMBOL_PATTERN.fullmatch(value):
        raise ValueError("Expected an ordinary US stock symbol; wildcard subscriptions are disabled.")
    return value


def validate_capacity(max_symbols: int) -> None:
    if isinstance(max_symbols, bool) or not isinstance(max_symbols, int) or not 1 <= max_symbols <= BASIC_MAX_SYMBOLS:
        raise ValueError(f"MAX_HOT_SYMBOLS must be between 1 and {BASIC_MAX_SYMBOLS} on Alpaca Basic.")


@dataclass(frozen=True)
class HotCandidate:
    symbol: str
    owned: bool = False
    paper: bool = False
    near_reconsider: bool = False
    near_take_profit: bool = False
    near_buy_area: bool = False
    opportunity_score: float = 0.0
    catalyst_priority: float = 0.0
    activity_score: float = 0.0


@dataclass(frozen=True)
class HotSelection:
    hot: list[str]
    warm: list[str]
    capacity_error: str | None = None
    promotion_error: str | None = None


def _finite(value: float) -> float:
    try:
        return float(value) if math.isfinite(float(value)) else 0.0
    except (ValueError, TypeError):
        return 0.0


def _priority(item: HotCandidate) -> tuple:
    return (
        not item.owned, not item.paper, not item.near_reconsider,
        not item.near_take_profit, not item.near_buy_area,
        -_finite(item.opportunity_score), -_finite(item.catalyst_priority),
        -_finite(item.activity_score), item.symbol,
    )


def select_hot(
    candidates: Iterable[HotCandidate], max_symbols: int = BASIC_MAX_SYMBOLS, promote: str | None = None,
) -> HotSelection:
    """Select highest priorities, reserving all possible capacity for positions.

    Duplicate candidates are merged conservatively so a second watchlist row
    cannot hide an owned position. If positions alone overflow capacity, return
    an explicit error and a capped list; consumers must pause actionable states
    while this error exists. A manual promotion never evicts an open position.
    """
    validate_capacity(max_symbols)
    by_symbol: dict[str, HotCandidate] = {}
    for candidate in candidates:
        symbol = normalize_symbol(candidate.symbol)
        previous = by_symbol.get(symbol, HotCandidate(symbol))
        by_symbol[symbol] = HotCandidate(
            symbol=symbol,
            owned=previous.owned or candidate.owned,
            paper=previous.paper or candidate.paper,
            near_reconsider=previous.near_reconsider or candidate.near_reconsider,
            near_take_profit=previous.near_take_profit or candidate.near_take_profit,
            near_buy_area=previous.near_buy_area or candidate.near_buy_area,
            opportunity_score=max(_finite(previous.opportunity_score), _finite(candidate.opportunity_score)),
            catalyst_priority=max(_finite(previous.catalyst_priority), _finite(candidate.catalyst_priority)),
            activity_score=max(_finite(previous.activity_score), _finite(candidate.activity_score)),
        )
    ordered = sorted(by_symbol.values(), key=_priority)
    protected = [item for item in ordered if item.owned or item.paper]
    capacity_error = None
    if len(protected) > max_symbols:
        capacity_error = (
            f"{len(protected)} open positions exceed the {max_symbols}-symbol live allowance. "
            "Some positions cannot stream; actionable states are paused. Reduce positions/watchlist scope or capacity use."
        )
    hot = ordered[:max_symbols]
    promotion_error = None
    if promote is not None:
        promote = normalize_symbol(promote)
        if promote not in by_symbol:
            promotion_error = "Add the symbol to the watchlist before requesting HOT promotion."
        elif promote not in {item.symbol for item in hot}:
            replaceable = [item for item in reversed(hot) if not item.owned and not item.paper]
            if capacity_error or not replaceable:
                promotion_error = "HOT capacity is reserved for open positions; promotion is paused."
            else:
                hot.remove(replaceable[0])
                hot.append(by_symbol[promote])
                hot.sort(key=_priority)
    hot_symbols = [item.symbol for item in hot]
    return HotSelection(
        hot=hot_symbols, warm=[item.symbol for item in ordered if item.symbol not in hot_symbols],
        capacity_error=capacity_error, promotion_error=promotion_error,
    )
