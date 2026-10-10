import pytest

from app.watchlist import HotCandidate, select_hot


def test_owned_paper_and_price_zones_precede_other_scores():
    candidates = [
        HotCandidate("ACTIVITY", activity_score=100), HotCandidate("CATALYST", catalyst_priority=1),
        HotCandidate("SCORE", opportunity_score=90), HotCandidate("BUY", near_buy_area=True),
        HotCandidate("PROFIT", near_take_profit=True), HotCandidate("RECONSIDER", near_reconsider=True),
        HotCandidate("PAPER", paper=True), HotCandidate("OWNED", owned=True),
    ]
    selected = select_hot(candidates, max_symbols=6)
    assert selected.hot == ["OWNED", "PAPER", "RECONSIDER", "PROFIT", "BUY", "SCORE"]
    assert selected.warm == ["CATALYST", "ACTIVITY"]


def test_thirty_symbol_cap_and_explicit_open_position_overflow():
    candidates = [HotCandidate(f"T{index}", owned=True) for index in range(31)]
    selected = select_hot(candidates)
    assert len(selected.hot) == 30
    assert len(selected.warm) == 1
    assert "31 open positions" in selected.capacity_error
    assert "paused" in selected.capacity_error


def test_promotion_never_evicts_owned_or_paper_position():
    selected = select_hot([
        HotCandidate("AAPL", owned=True), HotCandidate("MSFT", paper=True), HotCandidate("WARM"),
    ], max_symbols=2, promote="WARM")
    assert selected.hot == ["AAPL", "MSFT"]
    assert selected.warm == ["WARM"]
    assert selected.promotion_error


def test_promotion_evicts_lowest_unprotected_candidate_and_requires_stream_readiness():
    selected = select_hot([
        HotCandidate("AAPL", owned=True), HotCandidate("LOW", opportunity_score=20), HotCandidate("WARM"),
    ], max_symbols=2, promote="warm")
    assert selected.hot == ["AAPL", "WARM"]
    assert selected.warm == ["LOW"]
    assert selected.promotion_error is None
    # A selection intentionally contains no actionable state/fresh-price flag.
    assert not hasattr(selected, "actionable")


def test_duplicate_row_cannot_hide_ownership():
    selected = select_hot([
        HotCandidate(" aapl ", owned=True), HotCandidate("AAPL"), HotCandidate("MSFT", opportunity_score=100),
    ], max_symbols=1)
    assert selected.hot == ["AAPL"]


def test_unknown_promotion_is_rejected():
    selected = select_hot([HotCandidate("AAPL")], promote="MSFT")
    assert selected.hot == ["AAPL"]
    assert selected.promotion_error


@pytest.mark.parametrize("capacity", [0, -1, 31, True, 1.5])
def test_basic_capacity_configuration_is_bounded(capacity):
    with pytest.raises(ValueError):
        select_hot([], max_symbols=capacity)


def test_invalid_symbol_and_wildcard_are_rejected():
    for value in ("*", "A/B", "", "too-long-symbol"):
        with pytest.raises(ValueError):
            select_hot([HotCandidate(value)])
