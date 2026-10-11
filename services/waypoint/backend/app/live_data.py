"""Real, sourced research enrichment; never manufactures eligibility inputs.

This module deliberately does not call the scoring engine or produce a trade
recommendation. Cache values are JSON-safe and may be persisted by a single
serialized scheduler in Postgres; no credentials are stored in them.
"""

from __future__ import annotations

import copy
from collections.abc import MutableMapping
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from statistics import mean
from typing import Any
from zoneinfo import ZoneInfo

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
    "catalyst_strength": "News headlines do not establish a scored favorable catalyst.",
    "estimate_uncertainty_pct": "No validated estimate-uncertainty mapping is connected.",
    "binary_event": "A news search cannot establish the absence of binary events.",
    "revenue_stability": "A reviewed stability model is not configured.",
}
REVENUE_TAGS = ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet")


def _source(source, identity: str) -> dict:
    value = source.model_dump(mode="json") if hasattr(source, "model_dump") else dict(source)
    value["id"] = identity
    return value


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
            result["missing_reasons"].append(
                "Positive FCF: cash runway is not applicable; no artificial month count is assigned."
            )
    if assets and assets.value > 0:
        add("assets_usd", assets.value, [assets], "Reported total assets.", True)
        # Only an explicit complete total debt concept; partial long-term figures
        # or liabilities never stand in for total interest-bearing debt.
        debt = exact(("DebtCurrentAndNoncurrent",), None, end)
        if debt and debt.value >= 0:
            add("total_debt_usd", debt.value, [debt], "Reported complete interest-bearing debt.", True)
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
    result["missing_reasons"].append(
        "Comparable TTM valuation, bank metrics and specialist event coverage remain unavailable."
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
            if 6000 <= sic_number < 6800:
                record["sector_group"] = "financial"
                record["metric_sources"]["sector_group"] = identity_id
            elif sic_number == 2836:
                record["sector_group"] = "biotechnology"
                record["metric_sources"]["sector_group"] = identity_id

            async def filings_call(identity=identity):
                assert sec is not None
                rows = await sec.filings(identity.cik)
                return [
                    f.model_dump(mode="json")
                    for f in rows
                    if f.form in {"10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A", "20-F", "6-K", "3", "4", "5", "3/A", "4/A", "5/A"}
                ][:12]

            filings, health = await fetch(f"live:filings:{symbol}", 3600, filings_call, sec is not None)
            record["coverage"]["filings"] = health
            record["filings"] = filings or []

            version_key = f"live:fundamentals-version:{symbol}"
            version = sorted((item["accession"] for item in record["filings"] if item["form"] in {"10-K", "10-Q", "10-K/A", "10-Q/A", "8-K", "8-K/A"}))
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

        news = [item for item in (news_batch or []) if symbol in item.get("symbols", [])]
        record["coverage"]["news"] = news_health
        record["news_checked_at"] = news_health.get("checked_at")
        for index, item in enumerate((news or [])[:12]):
            source_id = f"alpaca-{symbol.lower()}-news-{index}"
            record["sources"].append(_source(item["source"], source_id))
            record["news"].append(
                {
                    "title": item["title"],
                    "published_at": item["published_at"],
                    "url": item["source"]["url"],
                    "source_id": source_id,
                }
            )
        record["coverage"]["earnings"] = calendar_health
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
            if health["status"] != "current":
                record["missing_reasons"].append(f"{name.capitalize()} data is {health['status']}.")
        record["missing_reasons"] = list(dict.fromkeys(record["missing_reasons"] + list(UNSUPPORTED.values())))
        output["by_symbol"][symbol] = record
    return output
