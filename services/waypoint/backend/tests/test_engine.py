"""Regression tests of meaningful decisions, cost accounting and failure modes."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.engine import MODEL_VERSION, analyze_stock, position_size, trade_state
from app.fixtures import demo_stocks

NOW = datetime(2026, 10, 7, 14, 0, tzinfo=timezone.utc)
SETTINGS = {"size": "small", "fx_usd_per_eur": 1.10, "fx_fee_pct": 0.0015, "fixed_fee_eur": 0, "min_order_eur": 1}


@pytest.fixture
def fixture():
    return demo_stocks(NOW)[0]


@pytest.fixture
def plan(fixture):
    return analyze_stock(fixture, now=NOW)["plan"]


def test_determinism_and_distinct_qualifying_and_skip_setups():
    first = [analyze_stock(f, now=NOW) for f in demo_stocks(NOW)]
    assert first == [analyze_stock(f, now=NOW) for f in demo_stocks(NOW)]
    assert len(first) == 8
    assert sum(stock["plan"] is not None for stock in first) == 4
    assert first[0]["opportunity"] == 85
    assert first[0]["risk"] == 21
    assert first[0]["confidence"] == 91
    assert first[0]["plan"]["entry_high"] == 18.55
    assert all(stock["freshness"]["feed"] == "DEMO DATA" for stock in first)


def test_every_displayed_claim_has_a_source_and_demo_is_explicit(fixture):
    stock = analyze_stock(fixture, now=NOW)
    sources = {source["id"]: source for source in stock["sources"]}
    for item in stock["reasons"] + stock["risks"] + stock["next_events"]:
        assert item["source_id"] in sources
    assert all("FICTIONAL" in source["description"] for source in fixture["sources"])
    assert any(MODEL_VERSION in source["id"] for source in stock["sources"])


def test_components_reproduce_scores_and_horizon_changes_weights(fixture):
    snapshots = [analyze_stock(fixture, h, NOW) for h in ("weeks", "months", "years")]
    for stock in snapshots:
        for name in ("opportunity", "risk"):
            components = stock[name + "_components"]
            assert sum(c["weight"] for c in components) == 100
            assert stock[name] == round(sum(c["score"] * c["weight"] / 100 for c in components))
            assert all(0 <= c["score"] <= 100 for c in components)
    assert snapshots[0]["opportunity_components"] != snapshots[2]["opportunity_components"]
    assert snapshots[2]["plan"]["strong_profit_high"] > snapshots[0]["plan"]["strong_profit_high"]


def test_company_specific_rules_do_not_treat_bank_debt_as_ordinary_debt():
    f = demo_stocks(NOW)[3]
    baseline = analyze_stock(f, now=NOW)
    f["metrics"]["debt_to_assets_pct"] = 99
    changed = analyze_stock(f, now=NOW)
    assert changed["company_type"] == "Financial"
    assert changed["risk"] == baseline["risk"]
    f["metrics"]["capital_buffer_pct"] = 5
    impaired = analyze_stock(f, now=NOW)
    assert impaired["risk"] > baseline["risk"]
    assert impaired["opportunity"] < baseline["opportunity"]


@pytest.mark.parametrize(
    "key", ["revenue_growth_pct", "cash_runway_months", "valuation_multiple", "earnings_in_days", "spread_pct"]
)
def test_missing_critical_metrics_suppress_plan_and_confidence(fixture, key):
    fixture["metrics"][key] = None
    stock = analyze_stock(fixture, now=NOW)
    assert stock["plan"] is None
    assert stock["confidence"] <= 39
    assert stock["freshness"]["status"] == "missing"
    assert key in stock["eligibility"]["missing_inputs"]


def test_unsourced_values_are_not_treated_as_facts(fixture):
    fixture["metric_sources"].pop("revenue_growth_pct")
    stock = analyze_stock(fixture, now=NOW)
    assert stock["plan"] is None
    assert not any("revenue growth" in item["text"] for item in stock["reasons"])
    assert "revenue_growth_pct" in stock["eligibility"]["missing_inputs"]


def test_positive_free_cash_flow_does_not_require_an_artificial_runway(fixture):
    fixture["metrics"]["cash_runway_months"] = None
    fixture["raw_metrics"] = {"free_cash_flow_usd": 125_000_000}
    stock = analyze_stock(fixture, now=NOW)
    assert stock["plan"] is not None
    assert "cash_runway_months" not in stock["eligibility"]["missing_inputs"]


@pytest.mark.parametrize(
    "field,age",
    [
        ("market_at", timedelta(minutes=16)),
        ("financial_as_of", timedelta(days=191)),
        ("news_checked_at", timedelta(hours=49)),
    ],
)
def test_stale_information_never_produces_a_new_plan(fixture, field, age):
    fixture[field] = (NOW - age).isoformat()
    stock = analyze_stock(fixture, now=NOW)
    assert stock["freshness"]["status"] == "stale"
    assert stock["confidence"] <= 49
    assert stock["plan"] is None


@pytest.mark.parametrize("timestamp", [None, "bad-date", "2026-10-07T14:00:00", "2026-10-08T14:00:00+00:00"])
def test_missing_naive_or_future_timestamp_fails_closed(fixture, timestamp):
    fixture["market_at"] = timestamp
    stock = analyze_stock(fixture, now=NOW)
    assert stock["freshness"]["status"] == "missing"
    assert stock["plan"] is None


def test_closed_market_label_preserves_timestamp_and_handles_weekend(fixture):
    fixture["feed"] = "MARKET CLOSED"
    fixture["market_at"] = (NOW - timedelta(days=3)).isoformat()
    stock = analyze_stock(fixture, now=NOW)
    assert stock["freshness"]["feed"] == "MARKET CLOSED"
    assert stock["freshness"]["market_at"] == fixture["market_at"]
    assert stock["plan"] is not None


def test_binary_event_lowers_confidence_and_blocks_new_setup(fixture):
    fixture["metrics"]["binary_event"] = 1
    stock = analyze_stock(fixture, now=NOW)
    assert stock["confidence_label"] == "LOW"
    assert stock["plan"] is None
    assert "Binary event requires review" in stock["eligibility"]["reasons"]


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -10, None])
def test_invalid_prices_do_not_become_tradable(fixture, bad):
    fixture["price"] = bad
    stock = analyze_stock(fixture, now=NOW)
    assert stock["plan"] is None
    assert stock["freshness"]["status"] == "missing"


def test_volatile_history_widens_predefined_plan(fixture):
    base = analyze_stock(fixture, now=NOW)
    fixture["history"] = [value * (1.025 if i % 2 else 0.975) for i, value in enumerate(fixture["history"])]
    changed = analyze_stock(fixture, now=NOW)
    assert changed["risk"] > base["risk"]
    assert changed["plan"] is not None
    assert (
        changed["plan"]["entry_high"] - changed["plan"]["reconsider"]
        > base["plan"]["entry_high"] - base["plan"]["reconsider"]
    )


def test_state_transition_sequence_and_inclusive_boundaries(plan):
    assert trade_state(plan["entry_high"] + 0.01, plan)[0] == "WAIT"
    assert trade_state(plan["entry_high"], plan)[0] == "BUY_AREA"
    assert trade_state(plan["entry_low"], plan)[0] == "BUY_AREA"
    assert trade_state(plan["entry_low"], plan, owned=True)[0] == "HOLD"
    assert trade_state(plan["first_profit_low"], plan, owned=True)[0] == "TAKE_PROFIT"
    assert trade_state(plan["reconsider"] + 0.01, plan, owned=True)[0] == "WATCH_CLOSELY"
    assert trade_state(plan["reconsider"], plan, owned=True)[0] == "RECONSIDER_EXIT"
    assert trade_state(plan["entry_low"] - 0.01, plan)[0] == "WATCH"
    assert trade_state(plan["reconsider"] - 2, plan)[0] == "SKIP"


def test_owned_missing_data_never_says_buy_or_blindly_hold(plan):
    assert trade_state(18.4, plan, owned=True, fresh=False)[0] == "WATCH_CLOSELY"
    assert trade_state(18.4, None, owned=True)[0] == "WATCH_CLOSELY"
    assert trade_state(18.4, plan, fresh=False)[0] == "NO_SETUP"
    assert trade_state(18.4, None)[0] == "SKIP"


def test_business_warning_is_separate_from_price_warning(plan):
    state, message = trade_state(100, plan, owned=True, business_warning=True)
    assert state == "RECONSIDER_EXIT"
    assert "business" in message
    assert trade_state(18.4, plan, business_warning=True)[0] == "SKIP"


def test_small_account_has_viable_fractional_position(plan):
    result = position_size(plan, 18.4, 20, 20, SETTINGS)
    assert result["viable"]
    assert result["amount_eur"] == 3
    assert 0 < result["quantity"] < 1
    assert 0 < result["planned_downside_eur"] <= 0.50
    assert "Actual losses can be larger" in result["reason"]


def test_exact_round_trip_costs_and_fractional_conversion():
    plan = {"reconsider": 90, "first_profit_low": 130, "strong_profit_low": 150}
    settings = {**SETTINGS, "size": "large", "fx_usd_per_eur": 1.20, "fx_fee_pct": 0.01, "fixed_fee_eur": 0.01}
    result = position_size(plan, 100, 20, 20, settings, spread_pct=0.002)
    assert result["viable"]
    consideration = Decimal(str(result["amount_eur"]))
    expected_quantity = consideration * Decimal("1.2") / Decimal("100.1")
    expected_first = consideration * (
        Decimal("130") * Decimal("0.999") / Decimal("100.1") * Decimal("0.99") - Decimal("1.01")
    ) - Decimal("0.02")
    assert result["quantity"] == pytest.approx(float(expected_quantity), abs=1e-8)
    assert result["first_profit_eur"] == pytest.approx(float(expected_first), abs=0.005)


def test_costs_and_minimum_order_can_make_entire_account_unviable(plan):
    assert not position_size(plan, 18.4, 20, 20, {**SETTINGS, "fixed_fee_eur": 1})["viable"]
    assert not position_size(plan, 18.4, 20, 20, {**SETTINGS, "min_order_eur": 4})["viable"]
    assert not position_size(plan, 18.4, 20, 0.9, SETTINGS)["viable"]
    assert not position_size(plan, 18.4, 20, 20, {**SETTINGS, "size": "none"})["viable"]


def test_higher_costs_never_improve_projected_net_profit(plan):
    cheap = position_size(plan, 18.4, 20, 20, SETTINGS)
    expensive = position_size(plan, 18.4, 20, 20, {**SETTINGS, "fx_fee_pct": 0.01})
    assert expensive["first_profit_eur"] <= cheap["first_profit_eur"]
    assert expensive["amount_eur"] <= cheap["amount_eur"]


def test_allocation_never_uses_all_cash_or_increases_after_loss(plan):
    normal = position_size(plan, 18.4, 20, 20, SETTINGS)
    after_loss = position_size(plan, 18.4, 18, 18, SETTINGS)
    larger = position_size(plan, 18.4, 300, 300, SETTINGS)
    assert after_loss["amount_eur"] <= normal["amount_eur"]
    assert larger["amount_eur"] / 300 < normal["amount_eur"] / 20
    for amount in (10, 20, 30):
        result = position_size(plan, 18.4, amount, amount, {**SETTINGS, "size": "large"})
        assert result["amount_eur"] < amount


def test_goal_and_loss_history_cannot_affect_analysis_or_sizing(fixture, plan):
    altered = deepcopy(fixture)
    altered.update({"goal_eur": 1_000_000, "last_trade_lost": True})
    assert analyze_stock(altered, now=NOW) == analyze_stock(fixture, now=NOW)
    assert position_size(plan, 18.4, 20, 20, SETTINGS) == position_size(
        plan, 18.4, 20, 20, {**SETTINGS, "goal_eur": 1_000_000, "last_trade_lost": True}
    )


@pytest.mark.parametrize("selection", ["small", "medium", "large"])
def test_risk_protection_has_no_threshold_cliff_after_account_losses(plan, selection):
    balances = [20, 49, 49.99, 50, 50.01, 51, 199, 199.99, 200, 200.01, 201, 300]
    amounts = [
        position_size(plan, 18.4, balance, balance, {**SETTINGS, "size": selection})["amount_eur"]
        for balance in balances
    ]
    assert amounts == sorted(amounts)
    fractions = [amount / balance for amount, balance in zip(amounts, balances, strict=True)]
    assert fractions[-1] < fractions[0]


@pytest.mark.parametrize(
    "field,value",
    [
        ("fx_usd_per_eur", 0),
        ("fx_fee_pct", -0.1),
        ("fixed_fee_eur", -1),
        ("min_order_eur", 0),
        ("fx_usd_per_eur", "NaN"),
    ],
)
def test_invalid_size_inputs_fail_closed(plan, field, value):
    assert not position_size(plan, 18.4, 20, 20, {**SETTINGS, field: value})["viable"]


def test_horizon_enum_is_explicit(fixture):
    with pytest.raises(ValueError, match="horizon"):
        analyze_stock(fixture, "tomorrow", NOW)
