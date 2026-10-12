"""Real, sourced research enrichment; never manufactures eligibility inputs.

This module deliberately does not call the scoring engine or produce a trade
recommendation. Cache values are JSON-safe and may be persisted by a single
serialized scheduler in Postgres; no credentials are stored in them.
"""

from __future__ import annotations

import copy
import math
from collections.abc import MutableMapping
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from statistics import mean, median, pstdev
from typing import Any
from zoneinfo import ZoneInfo

from .news import classify_title

from .providers import (
    AlpacaMarketDataProvider,
    AlphaVantageProvider,
    CompanyIdentity,
    FundamentalFact,
    Fundamentals,
    ProviderError,
    SECProvider,
)
from .api_usage import cache_record

NORMALIZATION_VERSION = "sec-observed-1.0.0"
UNSUPPORTED = {
    "peer_multiple": "A comparable, reviewed peer valuation reference is unavailable.",
    "concentration_pct": "Customer/product concentration requires disclosure review.",
    "estimate_uncertainty_pct": "No validated estimate-uncertainty mapping is connected.",
}


def enrich_peer_valuations(records: dict[str, dict[str, Any]], now: datetime) -> None:
    """Attach cross-batch peer valuation observations to a full research set.

    Live research is fetched in small batches so the dashboard stays responsive.
    Peer valuation needs the complete current universe, so it is applied once
    more after all batches have been assembled.  The derived observation is
    descriptive only and is never treated as a forecast.
    """
    valuation_groups: dict[tuple[str, str], list[tuple[str, float]]] = {}
    for symbol, record in records.items():
        value = record.get("metrics", {}).get("valuation_multiple")
        group = (
            str(record.get("sector_group") or "other"),
            str(record.get("valuation_basis") or "earnings"),
        )
        if value is not None and float(value) > 0:
            valuation_groups.setdefault(group, []).append((symbol, float(value)))
    for symbol, record in records.items():
        if record.get("metrics", {}).get("peer_multiple") is not None:
            continue
        group = (
            str(record.get("sector_group") or "other"),
            str(record.get("valuation_basis") or "earnings"),
        )
        peers = [value for peer_symbol, value in valuation_groups.get(group, []) if peer_symbol != symbol]
        if len(peers) < 2:
            continue
        peer_value = median(peers)
        peer_id = f"derived-{symbol.lower()}-peer-multiple"
        valuation_id = record.get("metric_sources", {}).get("valuation_multiple", "")
        peer_inputs = [
            item for item in [
                valuation_id,
                *[
                    f"derived-{peer.lower()}-annual-valuation"
                    for peer, _ in valuation_groups[group]
                    if peer != symbol
                ],
            ] if item
        ]
        record.setdefault("metrics", {})["peer_multiple"] = peer_value
        record.setdefault("metric_sources", {})["peer_multiple"] = peer_id
        record["missing_reasons"] = [
            reason for reason in record.get("missing_reasons", [])
            if reason != UNSUPPORTED["peer_multiple"]
        ]
        record.setdefault("sources", []).append(_derived_source(
            source_id=peer_id,
            now=now,
            value=peer_value,
            inputs=peer_inputs,
            description=(
                "Median annual valuation multiple of at least two other issuers in the same sourced sector "
                "group from this refresh; descriptive peer reference, not a forward estimate."
            ),
        ))
REVENUE_TAGS = ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet")


def _source(source, identity: str) -> dict:
    value = source.model_dump(mode="json") if hasattr(source, "model_dump") else dict(source)
    value["id"] = identity
    return value


def _derived_source(
    *,
    source_id: str,
    now: datetime,
    value: Any,
    description: str,
    inputs: list[str],
    provider: str = "Waypoint transparent derivation",
) -> dict[str, Any]:
    """Create a traceable source for a deterministic, non-provider metric.

    Derived observations are kept visibly separate from SEC/Alpaca facts.  A
    source can therefore explain why a field is present without pretending
    that a heuristic is a reported company fact.
    """
    return {
        "id": source_id,
        "provider": provider,
        "url": None,
        "published_at": None,
        "retrieved_at": now.isoformat(),
        "reporting_period": None,
        "raw_value": {"inputs": inputs},
        "normalized_value": value,
        "description": description,
    }


def _clip(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, float(value)))


def _sector_group(sic: int) -> str:
    """Map SEC SIC ranges into broad peer groups for valuation comparisons."""
    if 6000 <= sic < 6800:
        return "financial"
    if sic == 2836:
        return "biotechnology"
    if 1000 <= sic < 1500:
        return "commodity"
    if 1300 <= sic < 1400:
        return "commodity"
    if 2000 <= sic < 4000:
        return "cyclical"
    if 4800 <= sic < 4900:
        return "technology"
    if 5000 <= sic < 6000:
        return "consumer"
    if 7000 <= sic < 9000:
        return "services"
    return "other"


def normalize_fundamentals(
    fundamentals: Fundamentals,
    identity: CompanyIdentity,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Select actual USD periods, requiring aligned inputs for each ratio.

    Quarter/YTD/annual observations remain those actual durations. No TTM,
    forecast, annualization, custom-tag interpretation or cash-generative
    'infinite runway' assumption is silently introduced.
    """
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("normalization time must include a timezone")
    now = now.astimezone(UTC)
    if fundamentals.cik != identity.cik:
        raise ValueError("fundamental/company identity mismatch")
    result: dict[str, Any] = {
        "metrics": {},
        "raw_metrics": {},
        "metric_sources": {},
        "sources": [],
        "financial_as_of": None,
        "financial_period": "Unavailable",
        "missing_reasons": list(UNSUPPORTED.values()),
        "normalization_version": NORMALIZATION_VERSION,
    }
    # Recheck availability even if a caller supplied rather than fetched facts.
    available = [
        f
        for f in fundamentals.facts
        if f.filed_on < now.date() and f.period_end <= now.date() and f.form in {"10-K", "10-K/A", "10-Q", "10-Q/A"}
    ]
    grouped: dict[tuple, list[FundamentalFact]] = {}
    for fact in available:
        grouped.setdefault((fact.concept, fact.unit, fact.period_start, fact.period_end), []).append(fact)
    facts: list[FundamentalFact] = []
    for rows in grouped.values():
        latest_date = max(f.filed_on for f in rows)
        latest = [f for f in rows if f.filed_on == latest_date]
        # Conflicting same-day disclosures are ambiguous, not a pick-last rule.
        if len({f.value for f in latest}) == 1:
            facts.append(max(latest, key=lambda f: f.accession))

    def rows_for(tags: tuple[str, ...], unit: str = "USD") -> list[FundamentalFact]:
        return [f for f in facts if f.concept in tags and f.unit == unit]

    def exact(tags: tuple[str, ...], start: date | None, end: date, unit: str = "USD") -> FundamentalFact | None:
        for tag in tags:
            rows = [f for f in rows_for((tag,), unit) if f.period_start == start and f.period_end == end]
            if rows:
                return rows[0]
        return None

    def latest_instant(tags: tuple[str, ...], end: date, unit: str = "USD") -> FundamentalFact | None:
        rows = [
            item for item in rows_for(tags, unit)
            if item.period_start is None and item.period_end <= end
        ]
        return max(rows, key=lambda item: item.period_end, default=None)

    def add(name: str, value: Decimal | float, inputs: list[FundamentalFact], formula: str, raw: bool = False):
        number = float(value)
        if not Decimal(str(number)).is_finite():
            return
        source_id = f"sec-{identity.symbol.lower()}-{name}"
        result["raw_metrics" if raw else "metrics"][name] = number
        result["metric_sources"][name] = source_id
        result["sources"].append(
            {
                "id": source_id,
                "provider": "Waypoint calculation from SEC EDGAR",
                "url": inputs[0].source.url,
                "published_at": None,
                "retrieved_at": fundamentals.retrieved_at.isoformat(),
                "reporting_period": "; ".join(
                    dict.fromkeys(f"{f.period_start or 'instant'} to {f.period_end}" for f in inputs)
                ),
                "raw_value": [
                    {
                        "concept": f.concept,
                        "value": str(f.value),
                        "unit": f.unit,
                        "start": str(f.period_start) if f.period_start else None,
                        "end": str(f.period_end),
                        "filed": str(f.filed_on),
                        "accession": f.accession,
                        "url": f.source.url,
                    }
                    for f in inputs
                ],
                "normalized_value": number,
                "description": f"{NORMALIZATION_VERSION}: {formula}",
            }
        )

    revenues = [
        f
        for f in rows_for(REVENUE_TAGS)
        if f.period_start is not None and 60 <= (f.period_end - f.period_start).days <= 380 and f.value > 0
    ]
    if not revenues:
        result["missing_reasons"].append("No unambiguous reported USD revenue duration is available.")
        return result
    end = max(f.period_end for f in revenues)
    # Prefer longest actual duration at the latest end (YTD often aligns with cash flows).
    start = min(f.period_start for f in revenues if f.period_end == end and f.period_start is not None)
    revenue = exact(REVENUE_TAGS, start, end)
    if revenue is None or revenue.value <= 0:
        result["missing_reasons"].append("The latest revenue period cannot be normalized.")
        return result
    duration = (end - start).days + 1
    result["financial_as_of"] = datetime.combine(end, time.min, UTC).isoformat()
    result["financial_period"] = f"{start} to {end} ({duration} reported days)"
    add("revenue_usd", revenue.value, [revenue], "Reported revenue for the displayed actual duration.", True)
    prior_revenue = [
        f
        for f in rows_for((revenue.concept,))
        if f.period_start is not None
        and 350 <= (end - f.period_end).days <= 380
        and abs((f.period_end - f.period_start).days + 1 - duration) <= 7
        and f.value > 0
    ]
    if prior_revenue:
        prior = min(prior_revenue, key=lambda f: abs((end - f.period_end).days - 365))
        add(
            "revenue_growth_pct",
            (revenue.value / prior.value - 1) * 100,
            [revenue, prior],
            "100 × (actual-duration revenue / comparable prior-year revenue − 1); percentage points.",
        )
    else:
        result["missing_reasons"].append("A matching prior-year revenue duration is unavailable.")

    # Revenue stability is a descriptive measure of how consistently the
    # issuer has grown across independently reported, comparable periods. It
    # is only emitted when at least three point-in-time year-over-year
    # observations exist; one or two periods are not enough to call a business
    # stable. Each fact was already filtered by filed_on above, so no future
    # revision can enter this feature.
    growth_observations: list[tuple[float, str]] = []
    seen_periods: set[tuple[date, date]] = set()
    for current in revenues:
        if current.period_start is None or current.value <= 0:
            continue
        duration = (current.period_end - current.period_start).days + 1
        prior_rows = [
            item for item in revenues
            if item is not current
            and item.period_start is not None
            and 350 <= (current.period_end - item.period_end).days <= 380
            and abs((item.period_end - item.period_start).days + 1 - duration) <= 7
            and item.value > 0
        ]
        if not prior_rows:
            continue
        prior = min(prior_rows, key=lambda item: abs((current.period_end - item.period_end).days - 365))
        period_key = (current.period_start, current.period_end)
        if period_key in seen_periods:
            continue
        seen_periods.add(period_key)
        growth_observations.append((float((current.value / prior.value - 1) * 100), current.accession))
    if len(growth_observations) >= 3:
        growth_values = [value for value, _ in growth_observations]
        stability = _clip(100 - pstdev(growth_values) * 2.0)
        source_id = f"sec-{identity.symbol.lower()}-revenue-stability"
        result["metrics"]["revenue_stability"] = stability
        result["metric_sources"]["revenue_stability"] = source_id
        result["sources"].append(_derived_source(
            source_id=source_id,
            now=now,
            value=stability,
            inputs=[accession for _, accession in growth_observations],
            description=(
                "Standard deviation of at least three filed, comparable year-over-year revenue-growth "
                "observations mapped to a 0–100 stability score (100 − 2 × population standard deviation)."
            ),
        ))
    income = exact(("NetIncomeLoss",), start, end)
    operating_income = exact(("OperatingIncomeLoss",), start, end)
    if operating_income:
        add("operating_income_usd", operating_income.value, [operating_income], "Reported operating income.", True)
        add("operating_margin_pct", operating_income.value / revenue.value * 100,
            [operating_income, revenue], "Same-duration operating income / revenue × 100.")
    if income:
        add("net_income_usd", income.value, [income], "Reported net income for the revenue duration.", True)
        add(
            "net_margin_pct",
            income.value / revenue.value * 100,
            [income, revenue],
            "Net income / same-duration revenue × 100.",
        )
        prior_income = [
            f for f in rows_for(("NetIncomeLoss",))
            if f.period_start is not None
            and 350 <= (end - f.period_end).days <= 380
            and abs((f.period_end - f.period_start).days + 1 - duration) <= 7
        ]
        if prior_income and prior_income[0].value != 0:
            prior = min(prior_income, key=lambda f: abs((end - f.period_end).days - 365))
            add(
                "earnings_growth_pct",
                (income.value / prior.value - 1) * 100,
                [income, prior],
                "100 × (same-duration net income / comparable prior-year net income − 1); percentage points.",
            )
    cashflow = exact(("NetCashProvidedByUsedInOperatingActivities",), start, end)
    capex = exact(("PaymentsToAcquirePropertyPlantAndEquipment",), start, end)
    if cashflow:
        add(
            "operating_cash_flow_usd",
            cashflow.value,
            [cashflow],
            "Reported operating cash flow for the revenue duration.",
            True,
        )
    if capex and capex.value >= 0:
        add(
            "capital_expenditure_usd",
            capex.value,
            [capex],
            "Reported property, plant and equipment acquisition payments.",
            True,
        )
    if cashflow and capex and capex.value >= 0:
        fcf = cashflow.value - capex.value
        add(
            "free_cash_flow_usd",
            fcf,
            [cashflow, capex],
            "Operating cash flow less PP&E acquisition payments; same duration.",
            True,
        )
        add(
            "fcf_margin_pct",
            fcf / revenue.value * 100,
            [cashflow, capex, revenue],
            "(Operating cash flow − PP&E acquisition payments) / same-duration revenue × 100.",
        )
    else:
        result["missing_reasons"].append(
            "Aligned operating cash flow and nonnegative capex are required; missing capex is not zero."
        )
        fcf = None
    cash = exact(("CashAndCashEquivalentsAtCarryingValue",), None, end)
    assets = exact(("Assets",), None, end)
    if cash and cash.value >= 0:
        add("cash_usd", cash.value, [cash], "Reported unrestricted cash and cash equivalents.", True)
        if fcf is not None and fcf < 0:
            assert cashflow is not None and capex is not None
            add(
                "cash_runway_months",
                cash.value / (-fcf / Decimal(duration) * Decimal("30.4375")),
                [cash, cashflow, capex],
                "Cash / average monthly negative FCF over the actual reporting duration; not a forecast.",
            )
        elif fcf is not None:
            # A profitable cash-generative issuer does not have a finite
            # "runway" to measure. Keep that field absent rather than
            # inventing a large number; the deterministic engine treats a
            # verified non-negative FCF observation as the corresponding
            # business-safety evidence.
            pass
    if assets and assets.value > 0:
        add("assets_usd", assets.value, [assets], "Reported total assets.", True)
        # Only an explicit complete total debt concept; partial long-term figures
        # or liabilities never stand in for total interest-bearing debt.
        debt = latest_instant(("DebtCurrentAndNoncurrent",), end)
        debt_inputs: list[FundamentalFact] = [debt] if debt else []
        if debt is None:
            # Some issuers do not publish the aggregate us-gaap concept. A
            # current/non-current sum is accepted only when both parts are
            # explicit balance-sheet facts, avoiding a partial liabilities
            # proxy or double counting.
            noncurrent = latest_instant(("LongTermDebtNoncurrent",), end)
            current = latest_instant(("LongTermDebtCurrent", "ShortTermBorrowings", "ShortTermDebt"), end)
            if noncurrent and current:
                debt = FundamentalFact(
                    concept="DebtCurrentAndNoncurrent",
                    value=noncurrent.value + current.value,
                    unit="USD",
                    period_start=None,
                    period_end=max(noncurrent.period_end, current.period_end),
                    filed_on=max(noncurrent.filed_on, current.filed_on),
                    accession=f"{noncurrent.accession}+{current.accession}",
                    form=noncurrent.form,
                    source=noncurrent.source,
                )
                debt_inputs = [noncurrent, current]
        if debt and debt.value >= 0:
            add(
                "total_debt_usd",
                debt.value,
                debt_inputs,
                "Reported complete interest-bearing debt, or explicit current plus non-current debt components.",
                True,
            )
            add(
                "debt_to_assets_pct",
                debt.value / assets.value * 100,
                [debt, assets],
                "Reported total debt / assets × 100.",
            )
        else:
            result["missing_reasons"].append("A complete, non-overlapping total debt disclosure is unavailable.")
    shares = exact(("WeightedAverageNumberOfDilutedSharesOutstanding",), start, end, "shares")
    if shares and shares.value > 0:
        add(
            "diluted_weighted_average_shares",
            shares.value,
            [shares],
            "Reported diluted weighted-average shares for the displayed duration.",
            True,
        )
        # Retain observed share comparison as research only. The comparison is
        # deliberately labeled as a reported-period change; it is not a
        # split-adjusted forecast.
        prior_shares = [
            f for f in rows_for(("WeightedAverageNumberOfDilutedSharesOutstanding",), "shares")
            if f.period_start is not None
            and 350 <= (end - f.period_end).days <= 380
            and abs((f.period_end - f.period_start).days + 1 - duration) <= 7
            and f.value > 0
        ]
        if prior_shares:
            prior = min(prior_shares, key=lambda f: abs((end - f.period_end).days - 365))
            add(
                "dilution_pct",
                (shares.value / prior.value - 1) * 100,
                [shares, prior],
                "100 × (diluted weighted-average shares / comparable prior-year shares − 1).",
            )
        else:
            result["missing_reasons"].append("A comparable prior-year diluted share count is unavailable.")
    eps = exact(("EarningsPerShareDiluted",), start, end, "USD/shares")
    if eps and 350 <= duration <= 380:
        add(
            "annual_diluted_eps_usd",
            eps.value,
            [eps],
            "Actual annual diluted EPS; not trailing-twelve-month EPS.",
            True,
        )
    share_rows = [
        item for item in rows_for(("CommonStockSharesOutstanding",), "shares")
        if item.period_start is None and item.period_end <= end and item.value > 0
    ]
    shares = max(share_rows, key=lambda item: item.period_end, default=None)
    if shares and shares.value > 0:
        add(
            "shares_outstanding",
            shares.value,
            [shares],
            "Reported common shares outstanding at the latest available balance-sheet date.",
            True,
        )
    return result


async def build_live_research(
    symbols: list[str],
    *,
    market: AlpacaMarketDataProvider | None = None,
    sec: SECProvider | None = None,
    alpha: AlphaVantageProvider | None = None,
    cache: MutableMapping[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Fetch independent research inputs; return safe per-provider health.

    A failed fetch can return a previous cached observation with its original
    timestamps and explicit stale health. It never updates a successful-check
    timestamp or substitutes a demo observation.
    """
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("research time must include a timezone")
    now = now.astimezone(UTC)
    cache = cache if cache is not None else {}
    output: dict[str, Any] = {"by_symbol": {}, "fx": None, "provider_health": {}}

    async def fetch(key: str, ttl: int, operation, configured: bool = True):
        entry = cache.get(key)
        if configured and isinstance(entry, dict):
            try:
                age = (now - datetime.fromisoformat(entry["checked_at"])).total_seconds()
                if 0 <= age < ttl:
                    return copy.deepcopy(entry["data"]), {
                        "status": "current",
                        "checked_at": entry["checked_at"],
                        "cached": True,
                    }
            except (ValueError, TypeError, KeyError):
                pass
        try:
            if not configured:
                raise ProviderError("not_configured", "Provider credentials are not configured.")
            data = await operation()
            cache[key] = {**cache_record(data, key.split(':')[1], now, ttl=ttl,
                                        source_timestamp=now.isoformat()), "checked_at": now.isoformat()}
            return data, {"status": "current", "checked_at": now.isoformat(), "cached": False}
        except (ProviderError, ValueError) as error:
            health = {
                "status": "unavailable",
                "code": getattr(error, "code", "invalid_response"),
                "message": str(error) if isinstance(error, ProviderError) else "Provider data could not be normalized.",
                "checked_at": entry.get("checked_at") if isinstance(entry, dict) else None,
                "attempted_at": now.isoformat(),
            }
            if isinstance(entry, dict) and "data" in entry:
                health["status"] = "stale"
                return copy.deepcopy(entry["data"]), health
            return None, health

    async def calendar_call():
        assert alpha is not None
        return [e.model_dump(mode="json") for e in await alpha.earnings_calendar()]

    calendar, calendar_health = await fetch("live:earnings", 24 * 3600, calendar_call, alpha is not None)
    output["provider_health"]["earnings"] = calendar_health

    output["provider_health"]["fx"] = {"status": "unavailable", "code": "not_configured",
                                       "message": "No FX provider in V1; Alpha Vantage is reserved for earnings."}

    async def news_batch_call():
        assert market is not None
        rows = await market.news(list(dict.fromkeys(symbols)), now - timedelta(days=1))
        return [item.model_dump(mode="json") for item in rows]

    # One broad news request/cache, not one seven-day request per stock.
    news_batch, news_health = await fetch("live:news-batch:" + ",".join(sorted(set(symbols))),
                                         15 * 60, news_batch_call, market is not None)

    async def alpha_news_batch_call():
        # Alpha Vantage accepts a comma-separated ticker list, so one request
        # can enrich the whole scan universe.  It is deliberately an optional
        # second source: a rejected/free-plan request must not block Alpaca,
        # SEC, or the deterministic engine.
        assert alpha is not None
        rows = await alpha.news_sentiment(
            list(dict.fromkeys(symbols)), now - timedelta(days=1), now
        )
        return [item.model_dump(mode="json") for item in rows]

    alpha_news_batch, alpha_news_health = await fetch(
        "live:alpha-news-batch:" + ",".join(sorted(set(symbols))),
        15 * 60,
        alpha_news_batch_call,
        alpha is not None and callable(getattr(alpha, "news_sentiment", None)),
    )
    output["provider_health"]["news_sentiment"] = alpha_news_health
    for symbol in dict.fromkeys(symbols):
        record: dict[str, Any] = {
            "identity": None,
            "metrics": {},
            "raw_metrics": {},
            "metric_sources": {},
            "sources": [],
            "history": [],
            "previous_close": None,
            "financial_as_of": None,
            "financial_period": "Unavailable",
            "news_checked_at": None,
            "news": [],
            "next_events": [],
            "filings": [],
            "coverage": {},
            "missing_reasons": [],
        }

        async def identity_call(symbol=symbol):
            assert sec is not None
            return (await sec.resolve_company(symbol)).model_dump(mode="json")

        identity_data, identity_health = await fetch(
            f"live:identity:{symbol}", 7 * 86400, identity_call, sec is not None
        )
        record["identity"] = identity_data
        record["coverage"]["identity"] = identity_health
        if identity_data:
            identity = CompanyIdentity.model_validate(identity_data)
            identity_id = f"sec-{symbol.lower()}-identity"
            record["sources"].append(_source(identity.source, identity_id))
            record["name"] = identity.company
            record["sector"] = identity.sic_description or "Industry unavailable"
            try:
                sic_number = int(identity.sic or "0")
            except ValueError:
                sic_number = 0
            record["sector_group"] = _sector_group(sic_number)
            record["metric_sources"]["sector_group"] = identity_id

            async def filings_call(identity=identity):
                assert sec is not None
                rows = await sec.filings(identity.cik)
                filtered = [
                    f.model_dump(mode="json")
                    for f in rows
                    if f.form in {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "6-K", "3", "4", "5", "3/A", "4/A", "5/A"}
                ]
                # Recent insider filings can outnumber quarterly/annual
                # reports. Keep the filings that carry customer, debt and
                # earnings evidence before filling the remainder with recent
                # event filings; otherwise the concentration reviewer may
                # never see the latest 10-K.
                primary_forms = {"10-K", "10-K/A", "10-Q", "10-Q/A", "20-F"}
                primary = [item for item in filtered if item.get("form") in primary_forms]
                supplemental = [item for item in filtered if item.get("form") not in primary_forms]
                return (primary + supplemental)[:24]

            # v2 invalidates older caches that were sliced before filtering,
            # which could leave only recent Form 4 rows and no annual/quarterly
            # filing available for concentration review.
            filings, health = await fetch(f"live:filings:v3:{symbol}", 3600, filings_call, sec is not None)
            record["coverage"]["filings"] = health
            record["filings"] = filings or []

            concentration_candidates = [
                item for item in record["filings"]
                if item.get("form") in {"10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "6-K"}
            ]
            # Quarterly filings often omit the customer-concentration note
            # that is present in the latest annual report. Prefer the newest
            # annual filing, then fall back to a quarterly filing for issuers
            # that report concentration there. This keeps the evidence current
            # without treating a missing quarterly note as proof of zero.
            annual = [item for item in concentration_candidates if item.get("form") in {"10-K", "10-K/A", "20-F"}]
            concentration_filing = max(
                annual or concentration_candidates,
                key=lambda item: (item.get("filed_on", ""), item.get("accession", "")),
                default=None,
            )

            async def concentration_call(identity=identity, concentration_filing=concentration_filing):
                assert sec is not None and concentration_filing is not None
                filing = next(
                    item for item in await sec.filings(identity.cik)
                    if item.accession == concentration_filing["accession"]
                )
                return await sec.customer_concentration(filing)

            concentration_key = (
                f"live:concentration:v2:{symbol}:{concentration_filing.get('accession')}"
                if concentration_filing else f"live:concentration:v2:{symbol}:none"
            )
            if concentration_filing is None:
                concentration = None
                concentration_health = {
                    "status": "unavailable",
                    "code": "no_annual_filing",
                    "message": "No annual or quarterly SEC filing is available in the current filing window.",
                    "checked_at": None,
                    "attempted_at": now.isoformat(),
                }
            else:
                concentration, concentration_health = await fetch(
                    concentration_key,
                    7 * 86400,
                    concentration_call,
                    sec is not None and callable(getattr(sec, "customer_concentration", None)),
                )
            record["coverage"]["concentration"] = concentration_health
            if concentration and concentration.get("maximum_pct") is not None and concentration_filing:
                filing_source = concentration_filing.get("source") or {}
                filing_id = f"sec-{symbol.lower()}-filing-{concentration_filing['accession']}"
                record["sources"].append({**filing_source, "id": filing_id})
                concentration_id = f"derived-{symbol.lower()}-concentration"
                concentration_value = _clip(float(concentration["maximum_pct"]))
                record["metrics"]["concentration_pct"] = concentration_value
                record["metric_sources"]["concentration_pct"] = concentration_id
                record["sources"].append(_derived_source(
                    source_id=concentration_id,
                    now=now,
                    value=concentration_value,
                    inputs=[filing_id],
                    description=(
                        "Maximum explicit customer/client concentration percentage found in the latest "
                        "reviewed SEC annual or quarterly filing; no disclosure is treated as unknown, not zero."
                    ),
                ))

            version_key = f"live:fundamentals-version:{symbol}"
            # The normalized payload is a derived research artifact, not just
            # a copy of the filing. Invalidate it when the normalizer changes
            # even if the issuer has not filed a new document; otherwise an
            # older missing-reason set or metric mapping can keep suppressing
            # a company after the calculation has been improved.
            filing_version = sorted((item["accession"] for item in record["filings"] if item["form"] in {"10-K", "10-Q", "10-K/A", "10-Q/A", "8-K", "8-K/A"}))
            version = {"normalization": NORMALIZATION_VERSION, "filings": filing_version}
            if health["status"] == "current" and cache.get(version_key) != version:
                cache.pop(f"live:fundamentals:{symbol}", None)
                cache[version_key] = version
            async def fundamentals_call(identity=identity):
                assert sec is not None
                return normalize_fundamentals(await sec.fundamentals(identity.cik, now.date()), identity, now)

            normalized, health = await fetch(
                f"live:fundamentals:{symbol}", 6 * 3600, fundamentals_call, sec is not None
            )
            record["coverage"]["fundamentals"] = health
            if normalized:
                for key in ("metrics", "raw_metrics", "metric_sources"):
                    record[key].update(normalized[key])
                for key in ("financial_as_of", "financial_period", "normalization_version"):
                    record[key] = normalized[key]
                record["sources"].extend(normalized["sources"])
                record["missing_reasons"].extend(normalized["missing_reasons"])


        async def bars_call(symbol=symbol):
            assert market is not None
            bars = await market.historical_bars(
                symbol, now - timedelta(days=180),
                now.astimezone(ZoneInfo("America/New_York")).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
                - timedelta(microseconds=1), feed="sip", adjustment="split"
            )
            # Prior local dates are complete even before today's session opens;
            # intentionally omit today's bar, including after close, until tomorrow.
            completed = [
                b
                for b in bars
                if b.timestamp.astimezone(ZoneInfo("America/New_York")).date()
                < now.astimezone(ZoneInfo("America/New_York")).date()
            ]
            if not completed:
                raise ProviderError("no_history", "No completed daily history is available.")
            return {"bars": [b.model_dump(mode="json") for b in completed]}

        bars_data, history_health = await fetch(f"live:history:{symbol}", 3600, bars_call, market is not None)
        record["coverage"]["history"] = history_health
        if bars_data:
            bars = bars_data["bars"]
            closes = [float(b["close"]) for b in bars]
            record["history"] = closes
            record["previous_close"] = closes[-1]
            record["history_at"] = bars[-1]["timestamp"]
            history_id = f"alpaca-{symbol.lower()}-history"
            history_source = copy.deepcopy(bars[-1]["source"])
            history_source.update(
                id=history_id,
                raw_value=[{"t": b["timestamp"], "close": b["close"], "volume": b["volume"]} for b in bars],
                normalized_value=closes,
                description="Completed prior-day SIP closes; split-adjusted. Not an archived point-in-time backtest dataset.",
            )
            record["sources"].append(history_source)
            record["metric_sources"]["history"] = history_id
            if len(bars) >= 20:
                volume = mean(float(b["close"]) * float(b["volume"]) for b in bars[-20:])
                volume_id = f"alpaca-{symbol.lower()}-dollar-volume"
                source = copy.deepcopy(history_source)
                source.update(
                    id=volume_id,
                    raw_value=history_source["raw_value"][-20:],
                    normalized_value=volume,
                    description="Mean completed 20-session SIP close × volume; USD daily dollar-volume proxy.",
                )
                record["sources"].append(source)
                record["metrics"]["dollar_volume"] = volume
                record["metric_sources"]["dollar_volume"] = volume_id

            # A reported positive annual diluted EPS plus the last completed
            # close gives a transparent, point-in-time earnings multiple. It
            # is deliberately labelled as an annual-EPS multiple rather than
            # pretending to be a forecast TTM valuation.
            eps = record["raw_metrics"].get("annual_diluted_eps_usd")
            shares = record["raw_metrics"].get("shares_outstanding")
            revenue = record["raw_metrics"].get("revenue_usd")
            valuation_basis = "earnings"
            value = None
            valuation_inputs: list[str] = []
            if eps is not None and float(eps) > 0 and record.get("previous_close"):
                value = float(record["previous_close"]) / float(eps)
                valuation_inputs = [record["metric_sources"].get("annual_diluted_eps_usd", "")]
            elif shares is not None and float(shares) > 0 and revenue is not None and float(revenue) > 0 and record.get("previous_close"):
                # Early-stage issuers often have no positive EPS. A price to
                # reported-revenue multiple keeps them comparable without
                # turning a loss into a fake earnings multiple.
                value = float(record["previous_close"]) * float(shares) / float(revenue)
                valuation_basis = "revenue"
                valuation_inputs = [
                    record["metric_sources"].get("shares_outstanding", ""),
                    record["metric_sources"].get("revenue_usd", ""),
                ]
            if value is not None:
                valuation_id = f"derived-{symbol.lower()}-annual-valuation"
                history_id = record["metric_sources"].get("history", f"alpaca-{symbol.lower()}-history")
                record["metrics"]["valuation_multiple"] = value
                record["metric_sources"]["valuation_multiple"] = valuation_id
                valuation_inputs.append(history_id)
                record["sources"].append(_derived_source(
                    source_id=valuation_id,
                    now=now,
                    value=value,
                    inputs=[item for item in valuation_inputs if item],
                    description=(
                        (
                            "Completed prior-session close divided by the latest reported positive annual diluted EPS; "
                            "a descriptive annual earnings multiple, not a forecast or TTM estimate."
                        ) if valuation_basis == "earnings" else (
                            "Completed prior-session market capitalisation divided by the latest reported revenue; "
                            "a descriptive price-to-revenue multiple for an issuer without positive annual EPS."
                        )
                    ),
                ))
                record["valuation_basis"] = valuation_basis

        news = [item for item in (news_batch or []) if symbol in item.get("symbols", [])]
        # Keep both provider observations, de-duplicating by canonical URL and
        # title.  The source id is assigned below so every displayed headline
        # remains traceable to its provider record.
        alpha_news = [item for item in (alpha_news_batch or []) if symbol in item.get("symbols", [])]
        combined_news: list[dict[str, Any]] = []
        seen_news: set[tuple[str, str]] = set()
        for item in [*news, *alpha_news]:
            source = item.get("source") or {}
            key = (str(source.get("url") or ""), str(item.get("title") or "").strip().lower())
            if key in seen_news:
                continue
            seen_news.add(key)
            combined_news.append(item)
        news = combined_news
        record["coverage"]["news"] = news_health
        record["coverage"]["news_sentiment"] = alpha_news_health
        checked_at = [value for value in (news_health.get("checked_at"), alpha_news_health.get("checked_at")) if value]
        record["news_checked_at"] = max(checked_at) if checked_at else None
        for index, item in enumerate((news or [])[:12]):
            provider_slug = "alpha" if "Alpha Vantage" in str(item.get("source", {}).get("provider", "")) else "alpaca"
            source_id = f"{provider_slug}-{symbol.lower()}-news-{index}"
            record["sources"].append(_source(item["source"], source_id))
            record["news"].append(
                {
                    "title": item["title"],
                    "published_at": item["published_at"],
                    "url": item["source"]["url"],
                    "source_id": source_id,
                }
            )
        news_current = news_health["status"] == "current" or alpha_news_health["status"] == "current"
        if news_current and (record["news"] or record["filings"]):
            classified = [classify_title(item["title"]) for item in record["news"]]
            filing_descriptions = [
                classify_title(f"{item.get('form', '')} {item.get('description', '')}")
                for item in record["filings"][:12]
            ]
            event_observations = classified + filing_descriptions
            weighted_sentiment = sum(item["sentiment"] * item["importance"] for item in classified)
            catalyst_score = _clip(50 + weighted_sentiment * 18)
            catalyst_id = f"derived-{symbol.lower()}-catalyst"
            record["metrics"]["catalyst_strength"] = catalyst_score
            record["metric_sources"]["catalyst_strength"] = catalyst_id
            record["sources"].append(_derived_source(
                source_id=catalyst_id,
                now=now,
                value=catalyst_score,
                inputs=[
                    *[item["source_id"] for item in record["news"]],
                    *[item.get("source", {}).get("id", "") for item in record["filings"]],
                ],
                description=(
                    "Neutral 50/100 baseline adjusted by the sentiment and importance of current verified "
                    "headlines; when no headline is available, current SEC filing metadata keeps the score neutral. "
                    "This describes observed evidence; it is not a prediction."
                ),
            ))
            binary_types = {"offering", "merger", "regulatory", "legal", "leadership"}
            binary = any(item["event_type"] in binary_types for item in event_observations)
            binary_id = f"derived-{symbol.lower()}-binary-event"
            record["metrics"]["binary_event"] = 1.0 if binary else 0.0
            record["metric_sources"]["binary_event"] = binary_id
            record["sources"].append(_derived_source(
                source_id=binary_id,
                now=now,
                value=1.0 if binary else 0.0,
                inputs=[
                    *[item["source_id"] for item in record["news"]],
                    *[item.get("source", {}).get("id", "") for item in record["filings"]],
                ],
                description=(
                    "Deterministic screen of the current verified headlines for offering, merger, regulatory, "
                    "legal or leadership language and SEC filing descriptions; a zero means no matching event "
                    "was observed in the current provider window, not that no undiscovered event exists."
                ),
            ))
        record["coverage"]["earnings"] = calendar_health

        # Historical earnings estimates are collected by the bounded archive
        # worker and retained in the shared provider cache.  Four or more
        # observations are required before turning surprises into an
        # uncertainty percentage; one or two reports are not enough evidence.
        history_entry = cache.get(f"{AlphaVantageProvider.EARNINGS_HISTORY_KEY}:{symbol}")
        earnings_history = history_entry.get("data") if isinstance(history_entry, dict) else None
        if isinstance(earnings_history, list):
            surprises: list[float] = []
            estimate_inputs: list[str] = []
            for row in earnings_history:
                try:
                    value = float(row.get("surprise_percentage"))
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(value):
                    continue
                surprises.append(abs(value))
                estimate_inputs.append(str(row.get("fiscal_date_ending") or row.get("reported_date") or "unknown"))
            if len(surprises) >= 4:
                uncertainty = _clip(sum(surprises) / len(surprises))
                estimate_id = f"derived-{symbol.lower()}-estimate-uncertainty"
                record["metrics"]["estimate_uncertainty_pct"] = uncertainty
                record["metric_sources"]["estimate_uncertainty_pct"] = estimate_id
                record["sources"].append(_derived_source(
                    source_id=estimate_id,
                    now=now,
                    value=uncertainty,
                    inputs=estimate_inputs,
                    provider="Waypoint transparent derivation from Alpha Vantage earnings history",
                    description=(
                        "Mean absolute historical EPS surprise percentage across at least four reported quarters; "
                        "used as a bounded estimate-uncertainty proxy, not as a forward forecast."
                    ),
                ))
                record["coverage"]["earnings_history"] = {
                    "status": "current",
                    "checked_at": history_entry.get("retrieved_at"),
                    "observations": len(surprises),
                }
            else:
                record["coverage"]["earnings_history"] = {
                    "status": "insufficient",
                    "checked_at": history_entry.get("retrieved_at"),
                    "observations": len(surprises),
                }
        else:
            record["coverage"]["earnings_history"] = {
                "status": "unavailable",
                "code": "not_collected",
                "message": "Historical earnings estimates have not been collected for this symbol.",
            }
        matching = [
            e
            for e in (calendar or [])
            if e["symbol"].replace("-", ".") == symbol.replace("-", ".")
            and date.fromisoformat(e["report_date"]) >= now.astimezone(ZoneInfo("America/New_York")).date()
        ]
        if matching:
            event = min(matching, key=lambda e: e["report_date"])
            source_id = f"alpha-{symbol.lower()}-earnings"
            record["sources"].append(_source(event["source"], source_id))
            record["next_events"].append(
                {
                    "text": f"Expected earnings: {event['report_date']} (provider estimate)",
                    "date": event["report_date"],
                    "source_id": source_id,
                }
            )
            # Stale calendar observations remain readable but cannot satisfy eligibility.
            if calendar_health["status"] == "current":
                record["metrics"]["earnings_in_days"] = (
                    date.fromisoformat(event["report_date"]) - now.astimezone(ZoneInfo("America/New_York")).date()
                ).days
                record["metric_sources"]["earnings_in_days"] = source_id
        elif calendar_health["status"] == "current":
            record["missing_reasons"].append(
                "The earnings calendar has no forthcoming row for this issuer; earnings timing is unknown."
            )
        for name, health in record["coverage"].items():
            if name == "news" and news_current:
                continue
            if name == "news_sentiment" and news_health["status"] == "current":
                continue
            if health["status"] != "current":
                record["missing_reasons"].append(f"{name.replace('_', ' ').capitalize()} data is {health['status']}.")
        # Normalized fundamentals start with conservative unsupported-input
        # reasons. Remove those reasons once a later source (for example the
        # historical earnings archive) supplies the corresponding metric, so
        # the UI and eligibility gate describe the current record accurately.
        supported_reasons = {
            reason for key, reason in UNSUPPORTED.items()
            if record["metrics"].get(key) is not None
        }
        record["missing_reasons"] = list(dict.fromkeys(
            [reason for reason in record["missing_reasons"] if reason not in supported_reasons]
            + [reason for key, reason in UNSUPPORTED.items() if record["metrics"].get(key) is None]
        ))
        output["by_symbol"][symbol] = record

    # The normal refresh may be a two-symbol batch. Re-run this across the
    # complete set so eligible same-sector peers are not lost at batch edges.
    enrich_peer_valuations(output["by_symbol"], now)
    return output
