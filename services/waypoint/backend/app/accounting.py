"""Append-only, average-cost EUR ledger. No brokerage connectivity."""

import hashlib
from datetime import UTC, datetime
from decimal import Decimal, ROUND_DOWN
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Equity, Trade
from .schemas import TradeInput

INITIAL = Decimal("20")
ZERO = Decimal("0")
QTY_STEP = Decimal("0.000000000001")


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def rows(db: Session, mode: str) -> list[Trade]:
    return list(db.scalars(select(Trade).where(Trade.mode == mode).order_by(Trade.executed_at, Trade.id)))


def ledger(trades: list[Trade]) -> tuple[Decimal, Decimal, dict[str, dict[str, Decimal]]]:
    cash, realized = INITIAL, ZERO
    positions: dict[str, dict[str, Decimal]] = {}
    for trade in trades:
        p = positions.setdefault(trade.symbol, {"quantity": ZERO, "cost_eur": ZERO, "price_cost_usd": ZERO})
        qty, amount, fee = Decimal(trade.quantity), Decimal(trade.amount_eur), Decimal(trade.fee_eur)
        if trade.side == "buy":
            p["quantity"] += qty
            p["cost_eur"] += amount + fee
            p["price_cost_usd"] += qty * Decimal(trade.price_usd)
            cash -= amount + fee
        else:
            fraction = qty / p["quantity"]
            released_cost = p["cost_eur"] * fraction
            p["cost_eur"] -= released_cost
            p["price_cost_usd"] *= 1 - fraction
            p["quantity"] -= qty
            cash += amount - fee
            realized += amount - fee - released_cost
    return cash, realized, {key: p for key, p in positions.items() if p["quantity"] > ZERO}


def record_trade(db: Session, data: TradeInput, snapshot: dict[str, Any], model_version: str) -> Trade:
    fingerprint = hashlib.sha256(data.model_dump_json().encode()).hexdigest()
    previous = db.scalar(select(Trade).where(Trade.idempotency_key == data.idempotency_key))
    if previous:
        if previous.request_hash != fingerprint:
            raise ValueError("This request ID was already used for a different fill.")
        return previous
    # Caller serializes writes with the engine lock; use one API worker.
    trades = rows(db, data.mode)
    if trades and utc(data.executed_at) < utc(trades[-1].executed_at):
        raise ValueError("Record fills in execution order. This time is earlier than the last recorded fill.")
    cash, _, positions = ledger(trades)
    pnl = ZERO
    if data.side == "buy":
        assert data.amount_eur is not None
        amount = data.amount_eur
        qty = (amount * data.fx_usd_per_eur / data.price_usd).quantize(QTY_STEP, rounding=ROUND_DOWN)
        if qty <= ZERO:
            raise ValueError("The amount is too small to record a share fraction.")
        if amount + data.fee_eur > cash:
            raise ValueError("This fill exceeds available cash, including fees. Borrowing is not supported.")
    else:
        assert data.quantity is not None
        qty = data.quantity
        position = positions.get(data.symbol)
        if not position or qty > position["quantity"]:
            raise ValueError("You cannot sell more shares than this account owns.")
        amount = qty * data.price_usd / data.fx_usd_per_eur
        if amount - data.fee_eur + cash < ZERO:
            raise ValueError("The fee would exceed available cash and sale proceeds.")
        pnl = amount - data.fee_eur - position["cost_eur"] * qty / position["quantity"]
    trade = Trade(
        idempotency_key=data.idempotency_key,
        request_hash=fingerprint,
        symbol=data.symbol,
        side=data.side,
        mode=data.mode,
        price_usd=str(data.price_usd),
        quantity=str(qty),
        amount_eur=str(amount),
        fee_eur=str(data.fee_eur),
        fx_usd_per_eur=str(data.fx_usd_per_eur),
        realized_pnl_eur=str(pnl),
        executed_at=data.executed_at,
        recorded_at=datetime.now(UTC),
        notes=data.notes,
        model_version=model_version,
        entry_snapshot=snapshot,
    )
    db.add(trade)
    db.flush()
    return trade


def portfolio(db: Session, prices: dict[str, float], fx: float, mode: str) -> dict[str, Any]:
    cash, realized, holdings = ledger(rows(db, mode))
    positions = []
    complete = True
    for symbol, p in holdings.items():
        price = prices.get(symbol)
        if price is None:
            complete = False
        value = p["quantity"] * Decimal(str(price)) / Decimal(str(fx)) if price else p["cost_eur"]
        positions.append(
            {
                "symbol": symbol,
                "quantity": float(p["quantity"]),
                "average_price_usd": float(p["price_cost_usd"] / p["quantity"]),
                "cost_eur": float(p["cost_eur"]),
                "value_eur": float(value),
                "unrealized_pnl_eur": float(value - p["cost_eur"]),
                "mode": mode,
                "valuation_available": price is not None,
            }
        )
    invested = sum((p["cost_eur"] for p in holdings.values()), ZERO)
    market_value = sum((Decimal(str(p["value_eur"])) for p in positions), ZERO)
    total = cash + market_value
    series = (
        [INITIAL]
        + [Decimal(e.total_eur) for e in db.scalars(select(Equity).where(Equity.mode == mode).order_by(Equity.id))]
        + [total]
    )
    peak, max_dd = INITIAL, ZERO
    for value in series:
        peak = max(peak, value)
        max_dd = max(max_dd, (peak - value) / peak if peak else ZERO)
    return {
        "initial_eur": 20,
        "goal_eur": 200,
        "cash_eur": float(cash),
        "invested_eur": float(invested),
        "realized_pnl_eur": float(realized),
        "unrealized_pnl_eur": float(market_value - invested),
        "total_eur": float(total),
        "return_pct": float((total / INITIAL - 1) * 100),
        "max_drawdown_pct": float(max_dd * 100),
        "positions": positions,
        "valuation_complete": complete,
        "fx_source": "User-entered USD per EUR assumption",
    }


def journal(db: Session, mode: str) -> list[dict[str, Any]]:
    return [
        {
            "id": t.id,
            "symbol": t.symbol,
            "side": t.side,
            "mode": t.mode,
            **{
                field: float(Decimal(getattr(t, field)))
                for field in ("price_usd", "quantity", "amount_eur", "fee_eur", "fx_usd_per_eur", "realized_pnl_eur")
            },
            "executed_at": utc(t.executed_at).isoformat(),
            "notes": t.notes,
            "model_version": t.model_version,
            "entry_snapshot": t.entry_snapshot,
        }
        for t in reversed(rows(db, mode))
    ]
