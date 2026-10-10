from datetime import UTC, datetime, timedelta

import pytest

from app.ml.datasets import PointInTimeSnapshot
from app.ml.projections import build_projection, disagreement, rank_analogues


def _row(symbol: str, when: datetime, close_return: float, *, regime: str = "bull", company_type: str = "growth") -> PointInTimeSnapshot:
    path = [{"day": day, "close": 1 + close_return * day / 10, "high": 1 + close_return * day / 8, "low": 1 - 0.01 * day}
            for day in range(1, 21)]
    labels = {"return_10d": close_return, "max_upside_10d": close_return + 0.03,
              "max_drawdown_10d": -0.02, "barrier_outcome_20d": "TARGET_FIRST", "forward_path": path}
    return PointInTimeSnapshot(symbol=symbol, as_of=when.isoformat(), features={"price_return_5d": close_return, "volume_relative": 1.2,
                                                                                  "market_return_20d": 0.08}, labels=labels,
                               regime=regime, company_type=company_type, sector="aerospace")


def test_projection_ranks_only_past_rows_and_builds_ranges() -> None:
    now = datetime(2025, 1, 1, tzinfo=UTC)
    current = _row("RKLB", now, 0.08)
    history = [_row("RKLB", now - timedelta(days=day), 0.02 + day / 2000) for day in range(1, 40)]
    matches = rank_analogues(current, history, horizon_days=10, group="same_stock", top_n=25)
    projection = build_projection(current, matches, current_price=20.0, horizon_days=10)
    assert len(matches) == 25
    assert projection is not None
    assert projection["quantiles"]["p10"] < projection["quantiles"]["p50"] < projection["quantiles"]["p90"]
    assert projection["analogue_quality"] == "LOW"
    assert projection["cases"][0]["why_similar"]


def test_groups_and_regime_filter_are_explicit() -> None:
    now = datetime(2025, 1, 1, tzinfo=UTC)
    current = _row("RKLB", now, 0.08, regime="bear")
    history = [_row("RKLB", now - timedelta(days=1), 0.04, regime="bull"),
               _row("ABC", now - timedelta(days=2), 0.04, regime="bear", company_type="growth"),
               _row("BANK", now - timedelta(days=3), 0.04, regime="bear", company_type="financial")]
    assert len(rank_analogues(current, history, horizon_days=10, group="same_stock", top_n=25)) == 1
    assert len(rank_analogues(current, history, horizon_days=10, group="peers", top_n=25)) == 2
    assert len(rank_analogues(current, history, horizon_days=10, group="broad", same_regime=True, top_n=25)) == 2


def test_future_provenance_is_rejected() -> None:
    now = datetime(2025, 1, 1, tzinfo=UTC)
    current = _row("RKLB", now, 0.08)
    future = _row("RKLB", now - timedelta(days=1), 0.04)
    future = PointInTimeSnapshot(symbol=future.symbol, as_of=future.as_of, features=future.features, labels=future.labels,
                                 provenance=[{"field": "earnings", "available_at": (now + timedelta(days=1)).isoformat()}], regime=future.regime)
    with pytest.raises(ValueError, match="future information"):
        rank_analogues(current, [future], horizon_days=10)


def test_disagreement_lowers_confidence() -> None:
    assert disagreement({"positive_rate": 0.72}, {"positive_rate": 0.31}) == {
        "status": "HISTORICAL ANALOGUES DISAGREE", "all_history": "positive", "same_regime": "negative",
        "detail": "All-history and same-regime analogue outcomes differ materially; confidence is reduced.",
    }
