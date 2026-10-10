from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.accounting import ledger, portfolio, record_trade, rows
from app.models import Base, Equity
from app.schemas import TradeInput

NOW = datetime.now(UTC) - timedelta(hours=1)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def fill(**overrides):
    values = dict(
        symbol="RKLB",
        side="buy",
        mode="paper",
        price_usd="20",
        amount_eur="4",
        fee_eur="0.10",
        fx_usd_per_eur="1.10",
        executed_at=NOW,
        idempotency_key="buy-test-0001",
    )
    values.update(overrides)
    return TradeInput(**values)


def test_initial_portfolio_and_mode_separation(db):
    assert portfolio(db, {}, 1.1, "paper")["total_eur"] == 20
    record_trade(db, fill(), {"plan": {"reconsider": 17}}, "v1")
    assert portfolio(db, {"RKLB": 20}, 1.1, "manual")["cash_eur"] == 20
    assert portfolio(db, {"RKLB": 20}, 1.1, "paper")["total_eur"] == pytest.approx(19.9)


def test_partial_sale_fx_fees_and_average_cost(db):
    record_trade(db, fill(), {"plan": {"reconsider": 17}}, "v1")
    sale = fill(
        side="sell",
        amount_eur=None,
        quantity="0.11",
        price_usd="25",
        fee_eur="0.05",
        executed_at=NOW + timedelta(minutes=1),
        idempotency_key="sell-test-0001",
    )
    record_trade(db, sale, {}, "v1")
    result = portfolio(db, {"RKLB": 25}, 1.1, "paper")
    assert result["cash_eur"] == pytest.approx(18.35)
    assert result["realized_pnl_eur"] == pytest.approx(0.40)
    assert result["invested_eur"] == pytest.approx(2.05)
    assert result["unrealized_pnl_eur"] == pytest.approx(0.45)
    assert result["total_eur"] == pytest.approx(20.85)
    assert result["positions"][0]["quantity"] == 0.11


def test_full_close_and_compounding_use_new_cash(db):
    record_trade(db, fill(), {}, "v1")
    record_trade(
        db,
        fill(
            side="sell",
            amount_eur=None,
            quantity="0.22",
            price_usd="25",
            fee_eur="0",
            executed_at=NOW + timedelta(minutes=1),
            idempotency_key="close-test-001",
        ),
        {},
        "v1",
    )
    cash, pnl, positions = ledger(rows(db, "paper"))
    assert cash == Decimal("20.9")
    assert pnl == Decimal("0.9")
    assert positions == {}
    record_trade(
        db,
        fill(amount_eur="20.8", fee_eur="0", executed_at=NOW + timedelta(minutes=2), idempotency_key="reinvest-00001"),
        {},
        "v1",
    )
    assert portfolio(db, {"RKLB": 20}, 1.1, "paper")["cash_eur"] == 0.1


def test_duplicate_request_is_idempotent_and_changed_request_rejected(db):
    first = record_trade(db, fill(), {}, "v1")
    assert record_trade(db, fill(), {}, "v1").id == first.id
    assert len(rows(db, "paper")) == 1
    with pytest.raises(ValueError, match="different fill"):
        record_trade(db, fill(amount_eur="5"), {}, "v1")


def test_no_overdraft_or_short_sale_or_backward_fills(db):
    with pytest.raises(ValueError, match="cash"):
        record_trade(db, fill(amount_eur="20"), {}, "v1")
    record_trade(db, fill(), {}, "v1")
    with pytest.raises(ValueError, match="more shares"):
        record_trade(db, fill(side="sell", amount_eur=None, quantity="0.23", idempotency_key="oversell-0001"), {}, "v1")
    with pytest.raises(ValueError, match="execution order"):
        record_trade(db, fill(executed_at=NOW - timedelta(minutes=1), idempotency_key="outoforder-01"), {}, "v1")


def test_gap_loss_is_not_capped_at_planned_downside(db):
    record_trade(db, fill(fee_eur="0"), {"plan": {"reconsider": 18}}, "v1")
    record_trade(
        db,
        fill(
            side="sell", amount_eur=None, quantity="0.22", price_usd="5", fee_eur="0", idempotency_key="gap-sale-0001"
        ),
        {},
        "v1",
    )
    assert portfolio(db, {}, 1.1, "paper")["realized_pnl_eur"] == -3


def test_missing_price_preserves_cost_marks_incomplete_and_drawdown(db):
    record_trade(db, fill(), {}, "v1")
    db.add(Equity(mode="paper", total_eur="25", created_at=NOW))
    db.flush()
    result = portfolio(db, {}, 1.1, "paper")
    assert result["valuation_complete"] is False
    assert result["total_eur"] == 20
    assert result["max_drawdown_pct"] == 20


@pytest.mark.parametrize(
    "patch",
    [
        {"price_usd": "NaN"},
        {"quantity": "1"},
        {"amount_eur": "-1"},
        {"fx_usd_per_eur": "0"},
        {"fee_eur": "-1"},
        {"executed_at": datetime(2025, 1, 1)},
    ],
)
def test_invalid_fill_inputs(patch):
    with pytest.raises(ValueError):
        fill(**patch)
