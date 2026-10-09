from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.backtest import BacktestConfig, Candle, demo_backtest, demo_bars, run_backtest

D = Decimal


def trending_bars(count=20):
    output = []
    for index in range(count):
        opening = D(100) + D(index) / 2
        output.append(
            Candle(
                datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=index),
                opening,
                opening + D("0.8"),
                opening - D("0.2"),
                opening + D("0.5"),
            )
        )
    return output


def test_demo_is_reproducible_and_explicitly_synthetic():
    result = demo_backtest()
    assert result == demo_backtest()
    assert "DEMO DATA" in result["description"]
    assert "fundamental model" in result["description"]
    assert result["metrics"]["closed_trades"] > 0
    assert all(trade["entry_index"] > trade["signal_index"] for trade in result["trades"])


def test_changing_future_prices_cannot_change_prefix_equity_or_fills():
    original = demo_bars()
    changed = original[:80] + [
        replace(bar, open=bar.open * 2, high=bar.high * 2, low=bar.low * 2, close=bar.close * 2)
        for bar in original[80:]
    ]
    first, second = run_backtest(original), run_backtest(changed)
    assert first["equity"][:80] == second["equity"][:80]
    assert [trade for trade in first["trades"] if trade["exit_index"] < 80] == [
        trade for trade in second["trades"] if trade["exit_index"] < 80
    ]
    truncated = run_backtest(original[:80])
    assert truncated["equity"] == first["equity"][:80]


def test_fill_uses_next_open_and_gap_stop_is_not_guaranteed():
    bars = trending_bars(17)
    # First signal comes after the 14th completed bar; buy the 15th open.
    gap = bars[15]
    bars[15] = replace(gap, open=D(90), high=D(92), low=D(89), close=D(91))
    result = run_backtest(bars)
    trade = result["trades"][0]
    assert trade["signal_index"] == 13
    assert trade["entry_index"] == 14
    assert trade["entry_price_usd"] == pytest.approx(float(bars[14].open) * 1.001)
    assert trade["exit_price_usd"] < 90
    assert "Gap below stop" in trade["reason"]
    assert trade["return_pct"] < -6


def test_same_bar_stop_and_target_uses_conservative_stop():
    bars = trending_bars(16)
    bars[14] = replace(bars[14], high=D(140), low=D(70))
    trade = run_backtest(bars)["trades"][0]
    assert "Stop hit" in trade["reason"]
    assert trade["pnl_eur"] < 0


def test_entry_gap_outside_preexisting_plan_is_skipped():
    bars = trending_bars(15)
    bars[14] = replace(bars[14], open=D(80), high=D(81), low=D(79), close=D(80))
    result = run_backtest(bars)
    assert not result["trades"]
    assert result["signals"][0]["outcome"] == "skipped_gap_outside_plan"


def test_final_bar_does_not_get_a_fictional_next_bar_fill():
    result = run_backtest(trending_bars(14))
    assert result["metrics"]["signals"] == 1
    assert result["metrics"]["open_positions"] == 0
    assert result["metrics"]["closed_trades"] == 0
    assert result["signals"][0]["outcome"] == "pending_next_bar"


def test_costs_reduce_flat_position_equity():
    bars = trending_bars(15)
    # Entry open equals final close, isolating friction.
    bars[-1] = replace(bars[-1], close=bars[-1].open)
    expensive = run_backtest(bars)["metrics"]["final_equity_eur"]
    free = run_backtest(bars, BacktestConfig(fee_rate=D(0), spread_bps=D(0), slippage_bps=D(0)))["metrics"][
        "final_equity_eur"
    ]
    assert expensive < free
    assert free == 20


def test_metrics_expected_value_equals_average_closed_pnl():
    result = demo_backtest()
    mean = sum(trade["pnl_eur"] for trade in result["trades"]) / len(result["trades"])
    assert result["metrics"]["expected_value_eur"] == pytest.approx(mean, abs=0.000002)
    assert result["metrics"]["maximum_drawdown_pct"] >= 0


def test_empty_history_is_safe_and_no_infinite_metrics():
    result = run_backtest([])
    assert result["metrics"]["final_equity_eur"] == 20
    assert result["metrics"]["profit_factor"] is None
    assert result["metrics"]["return_pct"] == 0


def test_chronology_and_nonfinite_inputs_rejected():
    bars = trending_bars(4)
    with pytest.raises(ValueError, match="chronological"):
        run_backtest(list(reversed(bars)))
    with pytest.raises(ValueError, match="finite"):
        replace(bars[0], close=D("NaN"))
    with pytest.raises(ValueError):
        BacktestConfig(position_fraction=D(2))
