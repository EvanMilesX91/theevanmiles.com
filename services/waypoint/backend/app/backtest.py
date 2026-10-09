"""A deterministic, price-only execution simulator; not a validated stock model.

Signals see completed bars only. Orders fill on a subsequent bar. Raw OHLC
cannot resolve intrabar ordering, so simultaneous stop/target hits use the stop.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from math import sin

BACKTEST_VERSION = "price-demo-1.0.0"
D = Decimal


@dataclass(frozen=True)
class Candle:
    timestamp: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal

    def __post_init__(self):
        if self.timestamp.tzinfo is None:
            raise ValueError("bar timestamp must have a timezone")
        if not all(x.is_finite() and x > 0 for x in (self.open, self.high, self.low, self.close)):
            raise ValueError("prices must be finite and positive")
        if not self.low <= min(self.open, self.close) <= max(self.open, self.close) <= self.high:
            raise ValueError("invalid OHLC range")


@dataclass(frozen=True)
class BacktestConfig:
    initial_eur: Decimal = D("20")
    fx_usd_per_eur: Decimal = D("1.10")
    position_fraction: Decimal = D("0.15")
    fee_rate: Decimal = D("0.0015")
    spread_bps: Decimal = D("10")
    slippage_bps: Decimal = D("5")
    stop_pct: Decimal = D("0.06")
    target_pct: Decimal = D("0.10")
    max_holding_bars: int = 12

    def __post_init__(self):
        decimals = (
            self.initial_eur,
            self.fx_usd_per_eur,
            self.position_fraction,
            self.fee_rate,
            self.spread_bps,
            self.slippage_bps,
            self.stop_pct,
            self.target_pct,
        )
        if not all(value.is_finite() for value in decimals):
            raise ValueError("configuration must be finite")
        if self.initial_eur <= 0 or self.fx_usd_per_eur <= 0:
            raise ValueError("capital and FX must be positive")
        if not 0 < self.position_fraction <= 1 or not 0 < self.stop_pct < 1 or self.target_pct <= 0:
            raise ValueError("invalid strategy sizing")
        if not 0 <= self.fee_rate < 1 or not 0 <= self.spread_bps < 1000 or not 0 <= self.slippage_bps < 1000:
            raise ValueError("invalid costs")
        if self.max_holding_bars < 1:
            raise ValueError("holding period must be positive")


def signal_at(history: list[Candle]) -> bool:
    """A fixed educational momentum rule; input is already completed history."""
    if len(history) < 14:
        return False
    fast = sum(c.close for c in history[-5:]) / D(5)
    slow = sum(c.close for c in history[-12:]) / D(12)
    return fast > slow and history[-1].close > history[-2].close


def _number(value: Decimal, precision: int = 6) -> float:
    return round(float(value), precision)


def run_backtest(bars: list[Candle], config: BacktestConfig | None = None) -> dict:
    """Walk forward without precomputed indicators or access to later closes.

    ``timestamp`` labels the completed synthetic daily observation; index ordering
    encodes next-session execution. Trade records retain both signal/fill indices.
    No SEC facts or real market history are supplied to this demo strategy.
    """
    cfg = config or BacktestConfig()
    if any(bars[i].timestamp >= bars[i + 1].timestamp for i in range(len(bars) - 1)):
        raise ValueError("bars must be strictly chronological without duplicates")
    cash = cfg.initial_eur
    impact = (cfg.spread_bps / 2 + cfg.slippage_bps) / D(10000)
    position: dict | None = None
    pending: dict | None = None
    pending_exit = False
    trades: list[dict] = []
    signals: list[dict] = []
    equity: list[dict] = []
    peak = cfg.initial_eur
    max_drawdown = D(0)

    def close_position(raw_price: Decimal, index: int, reason: str):
        nonlocal position, cash, pending_exit
        assert position is not None
        fill = raw_price * (1 - impact)
        proceeds = position["quantity"] * fill / cfg.fx_usd_per_eur
        exit_fee = proceeds * cfg.fee_rate
        cash += proceeds - exit_fee
        pnl = proceeds - exit_fee - position["cost"]
        trades.append(
            {
                "symbol": "SYNTHETIC",
                "signal_at": position["signal_at"],
                "signal_index": position["signal_index"],
                "entry_index": position["entry_index"],
                "exit_index": index,
                "entry_at": position["entry_at"],
                "exit_at": bars[index].timestamp.isoformat(),
                "entry_price_usd": _number(position["fill"]),
                "exit_price_usd": _number(fill),
                "quantity": _number(position["quantity"], 10),
                "pnl_eur": _number(pnl),
                "return_pct": _number(pnl / position["cost"] * 100),
                "fees_eur": _number(position["entry_fee"] + exit_fee),
                "holding_bars": index - position["entry_index"] + 1,
                "reason": reason,
                "model_version": BACKTEST_VERSION,
            }
        )
        position = None
        pending_exit = False

    for index, bar in enumerate(bars):
        # These orders were decided strictly before this bar became available.
        if position is not None and pending_exit:
            close_position(bar.open, index, "Prior-close time/trend exit; next open")
        if pending is not None and position is None:
            fill = bar.open * (1 + impact)
            if pending["stop"] < fill < pending["target"]:
                budget = cash * cfg.position_fraction
                consideration = budget / (1 + cfg.fee_rate)
                entry_fee = consideration * cfg.fee_rate
                quantity = consideration * cfg.fx_usd_per_eur / fill
                cash -= budget
                position = {
                    **pending,
                    "quantity": quantity,
                    "fill": fill,
                    "cost": budget,
                    "entry_fee": entry_fee,
                    "entry_index": index,
                    "entry_at": bar.timestamp.isoformat(),
                }
                signals[pending["record_index"]]["outcome"] = "filled_next_open"
            else:
                signals[pending["record_index"]]["outcome"] = "skipped_gap_outside_plan"
            pending = None

        if position is not None:
            stop, target = position["stop"], position["target"]
            if bar.open <= stop:
                close_position(bar.open, index, "Gap below stop; open less costs")
            elif bar.open >= target:
                # Conservative standing limit: no favorable gap improvement.
                close_position(target, index, "Profit limit; no assumed gap improvement")
            elif bar.low <= stop:
                close_position(stop, index, "Stop hit; stop first if both levels touched")
            elif bar.high >= target:
                close_position(target, index, "Profit limit touched")

        value = cash
        if position is not None:
            # Liquidation estimate includes sell spread, slippage and fee.
            value += position["quantity"] * bar.close * (1 - impact) / cfg.fx_usd_per_eur * (1 - cfg.fee_rate)
            holding = index - position["entry_index"] + 1
            recent = bars[max(0, index - 4) : index + 1]
            mean = sum(c.close for c in recent) / D(len(recent))
            pending_exit = holding >= cfg.max_holding_bars or bar.close < mean
        peak = max(peak, value)
        drawdown = (peak - value) / peak
        max_drawdown = max(max_drawdown, drawdown)
        equity.append({"at": bar.timestamp.isoformat(), "value_eur": _number(value)})

        if position is None and signal_at(bars[: index + 1]):
            signal = {
                "at": bar.timestamp.isoformat(),
                "index": index,
                "outcome": "pending_next_bar",
                "model_version": BACKTEST_VERSION,
            }
            signals.append(signal)
            pending = {
                "signal_at": signal["at"],
                "signal_index": index,
                "stop": bar.close * (1 - cfg.stop_pct),
                "target": bar.close * (1 + cfg.target_pct),
                "record_index": len(signals) - 1,
            }

    pnl_values = [D(str(trade["pnl_eur"])) for trade in trades]
    winners = [value for value in pnl_values if value > 0]
    losers = [value for value in pnl_values if value < 0]
    count = len(trades)
    avg_win = sum(winners, D(0)) / len(winners) if winners else D(0)
    avg_loss = -sum(losers, D(0)) / len(losers) if losers else D(0)
    win_rate = D(len(winners)) / count if count else D(0)
    loss_rate = D(len(losers)) / count if count else D(0)
    final = D(str(equity[-1]["value_eur"])) if equity else cfg.initial_eur
    benchmark = D(0)
    if bars:
        quantity = cfg.initial_eur / (1 + cfg.fee_rate) * cfg.fx_usd_per_eur / (bars[0].open * (1 + impact))
        benchmark_final = quantity * bars[-1].close * (1 - impact) / cfg.fx_usd_per_eur * (1 - cfg.fee_rate)
        benchmark = (benchmark_final / cfg.initial_eur - 1) * 100
    return {
        "model_version": BACKTEST_VERSION,
        "description": "DEMO DATA — fixed price-only walk-forward execution example on synthetic prices. It does not evaluate the dashboard's fundamental model or demonstrate predictive skill.",
        "limitations": [
            "Synthetic OHLC prices, one fictional series; no market-performance claim.",
            "Signals use completed bars; entries and time/trend exits use the next open.",
            "Standing stops can lose more through gaps; a stop is checked first if both price levels are touched.",
            "Constant EUR/USD; fractional fills assumed. No broker minimums, taxes, dividends, corporate actions or liquidity model.",
            "No fundamental, news, delisting, survivor-universe or point-in-time database test; parameters were not fitted.",
            "The final open position is marked at estimated liquidation value; it is not forcibly closed with advance knowledge of the end date.",
        ],
        "assumptions": {
            "initial_eur": float(cfg.initial_eur),
            "position_fraction": float(cfg.position_fraction),
            "fee_rate_each_side": float(cfg.fee_rate),
            "spread_bps": float(cfg.spread_bps),
            "slippage_bps_each_side": float(cfg.slippage_bps),
            "fx_usd_per_eur": float(cfg.fx_usd_per_eur),
            "stop_pct": float(cfg.stop_pct),
            "target_pct": float(cfg.target_pct),
            "max_holding_bars": cfg.max_holding_bars,
            "signal_rule": "At least 14 bars, SMA(5) > SMA(12), latest close > prior close.",
            "benchmark": "100% buy-and-hold of the same synthetic series from first open, with identical costs. Strategy holds substantial cash and has different exposure.",
        },
        "metrics": {
            "signals": len(signals),
            "closed_trades": count,
            "open_positions": int(position is not None),
            "win_rate_pct": _number(win_rate * 100),
            "average_winner_eur": _number(avg_win),
            "average_loser_eur": _number(avg_loss),
            "profit_factor": _number(sum(winners, D(0)) / -sum(losers, D(0))) if losers else None,
            "maximum_drawdown_pct": _number(max_drawdown * 100),
            "average_holding_bars": round(sum(t["holding_bars"] for t in trades) / count, 2) if count else 0,
            "return_pct": _number((final / cfg.initial_eur - 1) * 100),
            "benchmark_return_pct": _number(benchmark),
            "expected_value_eur": _number(win_rate * avg_win - loss_rate * avg_loss),
            "final_equity_eur": _number(final),
        },
        "trades": trades,
        "equity": equity,
        "signals": signals,
    }


def demo_bars() -> list[Candle]:
    """Unfitted analytic fixture with trends, reversals and a negative gap."""
    bars = []
    start = datetime(2025, 1, 2, 21, tzinfo=timezone.utc)
    previous = D("20")
    for index in range(180):
        close = D(str(round(20 + index * 0.025 + 1.45 * sin(index / 8) + 0.45 * sin(index / 2.1), 4)))
        opening = previous * (D("0.88") if index in (57, 121) else D("1.0005"))
        high = max(opening, close) * D("1.009")
        low = min(opening, close) * D("0.989")
        bars.append(Candle(start + timedelta(days=index), opening, high, low, close))
        previous = close
    return bars


def demo_backtest() -> dict:
    return run_backtest(demo_bars())
