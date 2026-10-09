import asyncio
import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from app.live_data import build_live_research, normalize_fundamentals
from app.providers import (
    Bar,
    CompanyIdentity,
    EarningsEvent,
    FundamentalFact,
    Fundamentals,
    FxRate,
    Provenance,
    ProviderError,
)

NOW = datetime(2026, 10, 8, 14, tzinfo=UTC)


def run(coroutine):
    return asyncio.run(coroutine)


def source(description="Test source"):
    return Provenance(
        provider="SEC EDGAR",
        url="https://www.sec.gov/Archives/edgar/data/1/report.htm",
        retrieved_at=NOW,
        description=description,
    )


def identity(symbol="ABC"):
    return CompanyIdentity(symbol=symbol, cik="0000000001", company=f"{symbol} Company", sic="3571", source=source())


def fact(
    concept,
    value,
    start="2026-01-01",
    end="2026-06-30",
    filed="2026-08-01",
    unit="USD",
    accession="0000000001-26-000001",
):
    return FundamentalFact(
        concept=concept,
        value=Decimal(str(value)),
        unit=unit,
        period_start=date.fromisoformat(start) if start else None,
        period_end=date.fromisoformat(end),
        filed_on=date.fromisoformat(filed),
        accession=accession,
        form="10-Q",
        source=source(),
    )


def facts(rows=None):
    return Fundamentals(
        cik="0000000001",
        company="Company",
        retrieved_at=NOW,
        facts=rows
        if rows is not None
        else [
            fact("Revenues", 200),
            fact("Revenues", 160, "2025-01-01", "2025-06-30", "2025-08-01"),
            fact("NetIncomeLoss", 20),
            fact("NetCashProvidedByUsedInOperatingActivities", 35),
            fact("PaymentsToAcquirePropertyPlantAndEquipment", 5),
            fact("CashAndCashEquivalentsAtCarryingValue", 50, None),
            fact("Assets", 400, None),
            fact("DebtCurrentAndNoncurrent", 120, None),
            fact("WeightedAverageNumberOfDilutedSharesOutstanding", 12, unit="shares"),
        ],
    )


def test_normalization_uses_exact_reported_periods_and_references_every_metric():
    result = normalize_fundamentals(facts(), identity(), NOW)
    assert result["metrics"]["revenue_growth_pct"] == 25
    assert result["metrics"]["net_margin_pct"] == 10
    assert result["metrics"]["fcf_margin_pct"] == 15
    assert result["metrics"]["debt_to_assets_pct"] == 30
    assert "181 reported days" in result["financial_period"]
    assert result["financial_as_of"] == "2026-06-30T00:00:00+00:00"
    sources = {item["id"]: item for item in result["sources"]}
    for metric in result["metrics"]:
        assert result["metric_sources"][metric] in sources
        assert sources[result["metric_sources"][metric]]["raw_value"]
    assert "cash_runway_months" not in result["metrics"]  # profitable is not an invented runway
    assert "dilution_pct" not in result["metrics"]
    assert "binary_event" not in result["metrics"]
    json.dumps(result, allow_nan=False)


def test_normalization_does_not_mix_overlapping_ytd_or_currency_units():
    data = facts(
        [
            fact("Revenues", 200),
            fact("NetIncomeLoss", 10, "2026-04-01"),
            fact("NetCashProvidedByUsedInOperatingActivities", 35),
            fact("PaymentsToAcquirePropertyPlantAndEquipment", 5, unit="EUR"),
        ]
    )
    result = normalize_fundamentals(data, identity(), NOW)
    assert "net_margin_pct" not in result["metrics"]
    assert "fcf_margin_pct" not in result["metrics"]


def test_missing_capex_and_missing_short_term_debt_do_not_become_zeroes():
    data = facts(
        [
            fact("Revenues", 200),
            fact("NetCashProvidedByUsedInOperatingActivities", 35),
            fact("Assets", 400, None),
            fact("LongTermDebtNoncurrent", 120, None),
        ]
    )
    result = normalize_fundamentals(data, identity(), NOW)
    assert "fcf_margin_pct" not in result["metrics"]
    assert "debt_to_assets_pct" not in result["metrics"]


def test_cash_runway_only_uses_matched_observed_negative_cash_flow():
    data = facts(
        [
            fact("Revenues", 200),
            fact("NetCashProvidedByUsedInOperatingActivities", -20),
            fact("PaymentsToAcquirePropertyPlantAndEquipment", 10),
            fact("CashAndCashEquivalentsAtCarryingValue", 60, None),
        ]
    )
    result = normalize_fundamentals(data, identity(), NOW)
    assert result["metrics"]["cash_runway_months"] == pytest.approx(60 / (30 / 181 * 30.4375))


def test_future_filing_and_ambiguous_same_day_revisions_are_excluded():
    data = facts(
        [
            fact("Revenues", 200),
            fact("Revenues", 210, accession="0000000001-26-000002"),
            fact("Revenues", 999, "2026-07-01", "2026-09-30", "2026-10-09"),
        ]
    )
    result = normalize_fundamentals(data, identity(), NOW)
    assert result["metrics"] == {}
    assert result["financial_as_of"] is None


def test_same_day_filing_is_conservatively_unavailable():
    result = normalize_fundamentals(facts([fact("Revenues", 200, filed="2026-10-08")]), identity(), NOW)
    assert result["raw_metrics"] == {}


def test_latest_available_revision_is_selected_with_its_accession():
    data = facts([fact("Revenues", 200), fact("Revenues", 210, filed="2026-09-01", accession="0000000001-26-000002")])
    result = normalize_fundamentals(data, identity(), NOW)
    assert result["raw_metrics"]["revenue_usd"] == 210
    assert result["sources"][0]["raw_value"][0]["accession"] == "0000000001-26-000002"


class Market:
    fail_news = False

    async def historical_bars(self, symbol, start, end, **kwargs):
        assert kwargs == {"feed": "sip", "adjustment": "split"}
        assert end <= NOW - timedelta(minutes=15)
        return [
            Bar(
                symbol=symbol,
                timestamp=NOW.replace(hour=4) - timedelta(days=i),
                open=100,
                high=102,
                low=99,
                close=101,
                volume=1000000,
                source=source("Alpaca SIP split adjusted"),
            )
            for i in range(40, -1, -1)
        ]

    async def news(self, symbols, since):
        if self.fail_news:
            raise ProviderError("unavailable", "News temporarily unavailable.")
        return []


class SEC:
    async def resolve_company(self, symbol):
        if symbol == "BAD":
            raise ProviderError("identity_unavailable", "Issuer could not be verified.")
        return identity(symbol)

    async def fundamentals(self, cik, as_of):
        return facts()

    async def filings(self, cik):
        return []


class Alpha:
    async def earnings_calendar(self):
        return [EarningsEvent(symbol="ABC", company="Company", report_date=date(2026, 10, 30), source=source())]

    async def exchange_rate(self):
        return FxRate(from_currency="EUR", to_currency="USD", rate=Decimal("1.12"), timestamp=NOW, source=source())


def test_research_uses_sip_split_history_excludes_today_and_keeps_unknown_earnings():
    cache = {}
    result = run(build_live_research(["ABC", "XYZ"], market=Market(), sec=SEC(), alpha=Alpha(), cache=cache, now=NOW))
    abc, xyz = result["by_symbol"]["ABC"], result["by_symbol"]["XYZ"]
    assert len(abc["history"]) == 40
    assert abc["metrics"]["dollar_volume"] == 101000000
    assert abc["metrics"]["earnings_in_days"] == 22
    assert "earnings_in_days" not in xyz["metrics"]
    assert abc["news_checked_at"] == NOW.isoformat()
    assert "binary_event" not in abc["metrics"]
    assert result["fx"]["rate"] == "1.12"
    json.dumps(result, allow_nan=False)
    json.dumps(cache, allow_nan=False)


def test_failed_news_refresh_preserves_previous_timestamp_and_other_sources():
    cache = {}
    market = Market()
    run(build_live_research(["ABC"], market=market, sec=SEC(), alpha=Alpha(), cache=cache, now=NOW))
    market.fail_news = True
    # Still within history TTL, outside news TTL: only the news refresh fails.
    later = NOW + timedelta(minutes=20)
    result = run(build_live_research(["ABC"], market=market, sec=SEC(), alpha=Alpha(), cache=cache, now=later))
    abc = result["by_symbol"]["ABC"]
    assert abc["news_checked_at"] == NOW.isoformat()
    assert abc["coverage"]["news"]["status"] == "stale"
    assert abc["coverage"]["news"]["attempted_at"] == later.isoformat()
    assert abc["coverage"]["fundamentals"]["status"] == "current"


def test_one_identity_failure_does_not_poison_other_symbols():
    result = run(build_live_research(["BAD", "ABC"], market=Market(), sec=SEC(), alpha=Alpha(), now=NOW))
    assert result["by_symbol"]["BAD"]["coverage"]["identity"]["status"] == "unavailable"
    assert result["by_symbol"]["ABC"]["metrics"]["net_margin_pct"] == 10
    assert result["by_symbol"]["BAD"]["history"]


def test_no_providers_returns_explicit_missing_data_without_demo_values():
    result = run(build_live_research(["ABC"], now=NOW))
    row = result["by_symbol"]["ABC"]
    assert row["metrics"] == {}
    assert row["history"] == []
    assert row["news_checked_at"] is None
    assert result["fx"] is None
    assert row["coverage"]["history"]["code"] == "not_configured"


def test_naive_analysis_time_is_rejected():
    with pytest.raises(ValueError, match="timezone"):
        run(build_live_research(["ABC"], now=datetime(2026, 10, 8)))
