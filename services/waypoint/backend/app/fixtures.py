"""Synthetic, deterministic development inputs; NONE are real company facts.

Real US share symbols are convenient UI identifiers only. Prices, sectors used by
the classifier, financial metrics, events, and histories are fictional examples.
"""

from datetime import datetime, timedelta, timezone
from math import sin


def _utc(value: datetime | None) -> datetime:
    value = value or datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def demo_stocks(now: datetime | None = None) -> list[dict]:
    """Return new fixtures on every call, with no random or network dependencies."""
    now = _utc(now)
    common: dict[str, float | None] = {
        "revenue_growth_pct": 24.0,
        "net_margin_pct": 12.0,
        "fcf_margin_pct": 10.0,
        "cash_runway_months": 36.0,
        "debt_to_assets_pct": 18.0,
        "valuation_multiple": 6.0,
        "peer_multiple": 7.0,
        "revenue_stability": 85.0,
        "concentration_pct": 20.0,
        "dilution_pct": 2.0,
        "catalyst_strength": 75.0,
        "estimate_uncertainty_pct": 15.0,
        "earnings_in_days": 28.0,
        "binary_event": 0.0,
        "dollar_volume": 120_000_000.0,
        "spread_pct": 0.002,
        "capital_buffer_pct": 14.0,
        "credit_loss_pct": 0.8,
    }
    # These overrides deliberately illustrate diverse states, NOT real issuers.
    specs: list[tuple[str, str, str, str, float, float, float, dict[str, float | None]]] = [
        (
            "RKLB",
            "Rocket Lab",
            "Space & industrials",
            "industrial",
            18.80,
            0.09,
            0.022,
            {
                "net_margin_pct": -8,
                "fcf_margin_pct": -5,
                "cash_runway_months": 38,
                "revenue_growth_pct": 42,
                "valuation_multiple": 5.4,
                "peer_multiple": 7.5,
                "catalyst_strength": 88,
                "revenue_stability": 78,
                "dilution_pct": 4,
            },
        ),
        (
            "MSFT",
            "Microsoft",
            "Software",
            "technology",
            425.00,
            0.04,
            0.008,
            {
                "revenue_growth_pct": 17,
                "net_margin_pct": 26,
                "fcf_margin_pct": 28,
                "cash_runway_months": 60,
                "revenue_stability": 94,
                "catalyst_strength": 64,
            },
        ),
        (
            "PLTR",
            "Palantir",
            "Software",
            "technology",
            34.20,
            0.12,
            0.018,
            {
                "revenue_growth_pct": 32,
                "net_margin_pct": 15,
                "fcf_margin_pct": 20,
                "valuation_multiple": 11,
                "peer_multiple": 7,
                "catalyst_strength": 80,
            },
        ),
        (
            "JPM",
            "JPMorgan Chase",
            "Banking",
            "financial",
            205.00,
            0.03,
            0.007,
            {
                "revenue_growth_pct": 9,
                "capital_buffer_pct": 15.5,
                "credit_loss_pct": 0.6,
                "valuation_multiple": 1.5,
                "peer_multiple": 1.6,
                "debt_to_assets_pct": 80,
                "catalyst_strength": 62,
                "dilution_pct": 0,
            },
        ),
        (
            "MRNA",
            "Moderna",
            "Drug development",
            "biotechnology",
            54.00,
            -0.10,
            0.040,
            {
                "net_margin_pct": -55,
                "fcf_margin_pct": -45,
                "cash_runway_months": 14,
                "revenue_growth_pct": -28,
                "binary_event": 1,
                "earnings_in_days": 3,
                "catalyst_strength": 94,
                "estimate_uncertainty_pct": 75,
                "revenue_stability": 25,
                "concentration_pct": 90,
                "dilution_pct": 18,
            },
        ),
        (
            "XOM",
            "Exxon Mobil",
            "Energy",
            "commodity",
            112.00,
            -0.04,
            0.019,
            {
                "revenue_growth_pct": -12,
                "net_margin_pct": 8,
                "fcf_margin_pct": 5,
                "revenue_stability": 38,
                "concentration_pct": 75,
                "catalyst_strength": 32,
                "valuation_multiple": 10,
                "peer_multiple": 7,
            },
        ),
        (
            "SOFI",
            "SoFi Technologies",
            "Financial services",
            "financial",
            8.40,
            0.08,
            0.030,
            {
                "capital_buffer_pct": 7,
                "credit_loss_pct": 4,
                "revenue_growth_pct": 27,
                "valuation_multiple": 4,
                "peer_multiple": 1.8,
                "earnings_in_days": 5,
                "catalyst_strength": 65,
                "estimate_uncertainty_pct": 50,
                "dilution_pct": 12,
            },
        ),
        (
            "AAPL",
            "Apple",
            "Consumer technology",
            "technology",
            220.00,
            0.02,
            0.010,
            {"revenue_growth_pct": None, "net_margin_pct": 23, "fcf_margin_pct": 25, "catalyst_strength": 40},
        ),
    ]
    result = []
    for index, (symbol, name, sector, sector_group, price, trend, amplitude, overrides) in enumerate(specs):
        metrics = {**common, **overrides}
        history = [round(price * (1 + trend * (i - 59) / 59 + amplitude * sin(i * 1.71 + index)), 2) for i in range(60)]
        history[-1] = price
        if symbol == "RKLB":
            history[-10:] = [18.3, 18.1, 18.45, 18.4, 18.55, 18.35, 18.6, 18.5, 18.7, 18.8]
        market_at = now.isoformat()
        financial_at = (now - timedelta(days=45)).isoformat()
        reporting_period = "Illustrative prior quarter (fictional)"
        sources: list[dict] = []
        metric_sources: dict[str, str] = {}

        def source(
            key: str,
            value,
            description: str,
            period: str | None = None,
            symbol=symbol,
            sources=sources,
            financial_at=financial_at,
            market_at=market_at,
        ) -> str:
            source_id = f"demo-{symbol.lower()}-{key}"
            sources.append(
                {
                    "id": source_id,
                    "provider": "Waypoint synthetic fixtures — DEMO DATA",
                    "url": None,
                    "published_at": financial_at if period else market_at,
                    "retrieved_at": market_at,
                    "reporting_period": period,
                    "raw_value": value,
                    "normalized_value": value,
                    "description": f"FICTIONAL EXAMPLE, NOT A FACT ABOUT {symbol}. {description}",
                }
            )
            return source_id

        for key, value in metrics.items():
            metric_sources[key] = source(key, value, f"Synthetic {key} input.", reporting_period)
        for key, input_value in {"price": price, "history": history, "sector_group": sector_group}.items():
            metric_sources[key] = source(key, input_value, f"Synthetic {key} input.")
        event_date = (now + timedelta(days=int(metrics["earnings_in_days"] or 0))).date().isoformat()
        event_source = source(
            "event",
            {"date": event_date, "type": "scenario review"},
            "Fictional review event, not an actual company calendar date.",
        )
        result.append(
            {
                "symbol": symbol,
                "name": name,
                "sector": sector,
                "sector_group": sector_group,
                "demo": True,
                "price": price,
                "previous_close": history[-2],
                "history": history,
                "metrics": metrics,
                "market_at": market_at,
                "financial_as_of": financial_at,
                "financial_period": reporting_period,
                "news_checked_at": market_at,
                "feed": "DEMO DATA",
                "business_warning": False,
                "sources": sources,
                "metric_sources": metric_sources,
                "events": [
                    {
                        "label": "Fictional scenario review",
                        "date": event_date,
                        "detail": "Demo event only. Check a verified company calendar before any real decision.",
                        "source_id": event_source,
                    }
                ],
                "changes": ["Initial synthetic snapshot; no real company change is asserted."],
            }
        )
    return result
