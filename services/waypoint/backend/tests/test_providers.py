import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx
import pytest

from app.providers import AlphaVantageProvider, AlpacaMarketDataProvider, ProviderError, SECProvider, clean_text


def run(coroutine):
    return asyncio.run(coroutine)


def alpaca(transport):
    provider = AlpacaMarketDataProvider(
        httpx.AsyncClient(transport=httpx.MockTransport(transport)),
        api_key="test-key-not-real",
        secret_key="test-secret-not-real",
    )
    provider._min_interval = 0
    return provider


def sec(transport):
    provider = SECProvider(
        httpx.AsyncClient(transport=httpx.MockTransport(transport)),
        user_agent="Waypoint test test@example.com",
    )
    provider._min_interval = 0
    return provider


def test_quotes_use_explicit_feed_validate_and_retain_source():
    def handler(request):
        assert request.url.path == "/v2/stocks/quotes/latest"
        assert request.url.params["feed"] == "iex"
        assert request.headers["APCA-API-KEY-ID"] == "test-key-not-real"
        return httpx.Response(200, json={"quotes": {"RKLB": {"t": "2026-10-07T14:00:00Z", "bp": 18, "ap": 18.2}}})

    quote = run(alpaca(handler).latest_quotes(["rklb", "PLTR"]))["RKLB"]
    assert quote.price == Decimal("18.1")
    assert quote.timestamp.tzinfo is not None
    assert "IEX only" in quote.feed_detail
    assert quote.source.published_at == quote.timestamp
    assert quote.source.raw_value["bp"] == "18"


@pytest.mark.parametrize(
    "bad_quote",
    [
        {"t": "2026-10-07T14:00:00Z", "bp": -1, "ap": 2},
        {"t": "2026-10-07T14:00:00Z", "bp": 20, "ap": 19},
        {"t": "2026-10-07T14:00:00", "bp": 18, "ap": 19},
        {"t": "2026-10-07T14:00:00Z", "bp": "NaN", "ap": 19},
    ],
)
def test_invalid_quotes_fail_closed(bad_quote):
    provider = alpaca(lambda _: httpx.Response(200, json={"quotes": {"RKLB": bad_quote}}))
    with pytest.raises(ProviderError, match="invalid quote"):
        run(provider.latest_quotes(["RKLB"]))


def test_missing_symbol_is_not_fabricated():
    provider = alpaca(lambda _: httpx.Response(200, json={"quotes": {}}))
    assert run(provider.latest_quotes(["RKLB"])) == {}


def test_withdrawn_after_hours_quote_does_not_become_zero_price():
    provider = alpaca(lambda _: httpx.Response(200, json={"quotes": {
        "RKLB": {"t": "2026-10-07T20:00:02Z", "bp": 19, "ap": 0},
        "AAPL": {"t": "2026-10-07T19:50:00Z", "bp": 220, "ap": 222},
    }}))
    values = run(provider.latest_quotes(["RKLB", "AAPL"]))
    assert set(values) == {"AAPL"}
    assert values["AAPL"].price == 221


def test_access_failure_does_not_echo_secret_or_upstream_content():
    def handler(_):
        return httpx.Response(403, text="test-secret-not-real <script>leak</script>")

    with pytest.raises(ProviderError) as error:
        run(alpaca(handler).latest_quotes(["RKLB"]))
    assert error.value.code == "access_denied"
    assert "test-secret" not in str(error.value)
    assert "script" not in str(error.value)


def test_rate_limit_retries_then_recovers():
    calls = 0

    def handler(_):
        nonlocal calls
        calls += 1
        return httpx.Response(429) if calls < 3 else httpx.Response(200, json={"quotes": {}})

    assert run(alpaca(handler).latest_quotes(["RKLB"])) == {}
    assert calls == 3


def test_long_backoff_is_not_ignored():
    calls = 0

    def handler(_):
        nonlocal calls
        calls += 1
        return httpx.Response(429, headers={"Retry-After": "60"})

    with pytest.raises(ProviderError) as error:
        run(alpaca(handler).latest_quotes(["RKLB"]))
    assert error.value.code == "rate_limited"
    assert calls == 1


def test_network_failure_is_bounded_and_safe():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("secret should not reach output", request=request)

    with pytest.raises(ProviderError) as error:
        run(alpaca(handler).latest_quotes(["RKLB"]))
    assert calls == 3
    assert error.value.code == "unavailable"
    assert "secret" not in str(error.value)


def test_history_paginates_and_validates_ohlc():
    def handler(request):
        page2 = request.url.params.get("page_token") == "page2"
        assert request.url.params["adjustment"] == "raw"
        return httpx.Response(
            200,
            json={
                "bars": {
                    "RKLB": [
                        {"t": f"2026-10-0{6 if page2 else 5}T04:00:00Z", "o": 18, "h": 20, "l": 17, "c": 19, "v": 100}
                    ]
                },
                "next_page_token": None if page2 else "page2",
            },
        )

    bars = run(
        alpaca(handler).historical_bars(
            "RKLB", datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 10, 7, tzinfo=timezone.utc)
        )
    )
    assert len(bars) == 2
    assert bars[0].timestamp < bars[1].timestamp
    assert bars[0].close == 19


def test_repeated_page_token_does_not_loop_forever():
    provider = alpaca(lambda _: httpx.Response(200, json={"bars": {}, "next_page_token": "same"}))
    with pytest.raises(ProviderError) as error:
        run(
            provider.historical_bars(
                "RKLB", datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 10, 7, tzinfo=timezone.utc)
            )
        )
    assert error.value.code == "pagination_limit"


def test_credentials_missing_is_explicit(monkeypatch):
    monkeypatch.delenv("APCA_API_KEY_ID", raising=False)
    monkeypatch.delenv("APCA_API_SECRET_KEY", raising=False)
    monkeypatch.delenv("SEC_USER_AGENT", raising=False)
    with pytest.raises(ProviderError, match="credentials"):
        AlpacaMarketDataProvider()
    with pytest.raises(ProviderError, match="contact email"):
        SECProvider()


def test_sec_submission_parses_real_columnar_shape():
    def handler(request):
        assert request.headers["User-Agent"] == "Waypoint test test@example.com"
        assert request.url.path == "/submissions/CIK0000000001.json"
        return httpx.Response(
            200,
            json={
                "cik": "1",
                "name": "Example",
                "filings": {
                    "recent": {
                        "accessionNumber": ["0000000001-26-000001"],
                        "filingDate": ["2026-10-01"],
                        "form": ["10-Q"],
                        "primaryDocument": ["report.htm"],
                        "acceptanceDateTime": ["2026-10-01T20:01:00Z"],
                        "reportDate": ["2026-09-30"],
                        "primaryDocDescription": ["<b>Quarterly</b>\u0000 report"],
                    }
                },
            },
        )

    filing = run(sec(handler).filings("1"))[0]
    assert filing.description == "Quarterly report"
    assert filing.source.url.endswith("/1/000000000126000001/report.htm")
    assert filing.accepted_at.hour == 20


def test_sec_rejects_mismatched_arrays():
    provider = sec(
        lambda _: httpx.Response(
            200,
            json={
                "cik": 1,
                "name": "Example",
                "filings": {
                    "recent": {
                        "accessionNumber": ["0000000001-26-000001"],
                        "filingDate": [],
                        "form": ["10-Q"],
                        "primaryDocument": ["r.htm"],
                    }
                },
            },
        )
    )
    with pytest.raises(ProviderError, match="invalid filing"):
        run(provider.filings("1"))


def test_companyfacts_filters_by_filing_date_not_financial_period():
    rows = [
        {
            "val": 100,
            "start": "2026-01-01",
            "end": "2026-03-31",
            "filed": "2026-05-01",
            "accn": "0000000001-26-000001",
            "form": "10-Q",
        },
        {
            "val": 110,
            "start": "2026-01-01",
            "end": "2026-03-31",
            "filed": "2026-08-01",
            "accn": "0000000001-26-000002",
            "form": "10-Q/A",
        },
    ]

    def handler(request):
        if request.url.path == "/submissions/CIK0000000001.json":
            return httpx.Response(200, json={"cik": "1", "name": "Example", "filings": {"recent": {
                "accessionNumber": ["0000000001-26-000002"], "filingDate": ["2026-08-01"],
                "form": ["10-Q/A"], "primaryDocument": ["report.htm"]}}})
        assert request.url.path == "/api/xbrl/companyfacts/CIK0000000001.json"
        return httpx.Response(
            200,
            json={
                "cik": 1,
                "entityName": "<b>Example</b>",
                "facts": {"us-gaap": {"Revenues": {"units": {"USD": rows}}}},
            },
        )

    provider = sec(handler)
    result = run(provider.fundamentals("1", date(2026, 5, 2)))
    assert result.company == "Example"
    assert len(result.facts) == 1
    assert result.facts[0].value == 100
    assert result.facts[0].filed_on == date(2026, 5, 1)
    # Date-only availability deliberately excludes same-day filings.
    assert run(sec(handler).fundamentals("1", date(2026, 5, 1))).facts == []


def test_plain_text_sanitization():
    assert clean_text("&lt;b&gt;hello&lt;/b&gt;\nworld") == "hello world"


def test_live_history_can_select_consolidated_split_adjusted_bars():
    def handler(request):
        assert request.url.params["feed"] == "sip"
        assert request.url.params["adjustment"] == "split"
        return httpx.Response(200, json={"bars": {}})

    assert (
        run(
            alpaca(handler).historical_bars(
                "AAPL",
                datetime(2026, 9, 1, tzinfo=timezone.utc),
                datetime(2026, 10, 1, tzinfo=timezone.utc),
                feed="sip",
                adjustment="split",
            )
        )
        == []
    )


def test_sec_resolves_ticker_and_verifies_submissions():
    def handler(request):
        if request.url.path == "/files/company_tickers.json":
            return httpx.Response(200, json={"0": {"cik_str": 1, "ticker": "ABC", "title": "Old name"}})
        return httpx.Response(
            200,
            json={"cik": 1, "name": "Verified name", "tickers": ["ABC"], "sic": "3571", "sicDescription": "Computers"},
        )

    identity = run(sec(handler).resolve_company("ABC"))
    assert identity.cik == "0000000001"
    assert identity.company == "Verified name"
    assert identity.sic == "3571"


def test_sec_rejects_ticker_identity_mismatch():
    def handler(request):
        if request.url.path == "/files/company_tickers.json":
            return httpx.Response(200, json={"0": {"cik_str": 1, "ticker": "ABC"}})
        return httpx.Response(200, json={"cik": 1, "name": "Other issuer", "tickers": ["XYZ"]})

    with pytest.raises(ProviderError, match="identity"):
        run(sec(handler).resolve_company("ABC"))


def test_alpaca_news_returns_sanitized_headlines_and_original_urls():
    def handler(request):
        assert request.url.path == "/v1beta1/news"
        assert request.url.params["include_content"] == "false"
        return httpx.Response(
            200,
            json={
                "news": [
                    {
                        "id": 42,
                        "created_at": "2026-01-01T14:00:00Z",
                        "headline": "<b>Company</b> update",
                        "symbols": ["ABC"],
                        "url": "https://www.benzinga.com/news/example",
                    }
                ],
                "next_page_token": None,
            },
        )

    rows = run(alpaca(handler).news(["ABC"], datetime(2026, 1, 1, tzinfo=timezone.utc)))
    assert len(rows) == 1
    assert rows[0].title == "Company update"
    assert rows[0].source.url == "https://www.benzinga.com/news/example"


def test_news_incomplete_pagination_is_not_reported_as_complete_coverage():
    provider = alpaca(lambda _: httpx.Response(200, json={"news": [], "next_page_token": "same"}))
    with pytest.raises(ProviderError) as error:
        run(provider.news(["ABC"], datetime(2026, 1, 1, tzinfo=timezone.utc)))
    assert error.value.code == "pagination_limit"


ALPHA_NOW = datetime(2026, 10, 8, 14, tzinfo=timezone.utc)


def alpha(handler, cache=None):
    return AlphaVantageProvider(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        api_key="secret-alpha-key",
        cache=cache,
        clock=lambda: ALPHA_NOW,
    )


def fx_payload(pair="EUR", timestamp="2026-10-08 13:45:00", rate="1.12"):
    return {
        "Realtime Currency Exchange Rate": {
            "1. From_Currency Code": pair,
            "3. To_Currency Code": "USD",
            "5. Exchange Rate": rate,
            "6. Last Refreshed": timestamp,
            "7. Time Zone": "UTC",
        }
    }


def test_alpha_bulk_calendar_parses_and_cache_prevents_repeat_calls():
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.params["function"] == "EARNINGS_CALENDAR"
        assert "symbol" not in request.url.params
        return httpx.Response(
            200,
            text="symbol,name,reportDate,fiscalDateEnding,estimate,currency\nABC,Company,2026-10-30,2026-09-30,1.23,USD\n",
        )

    cache = {}
    first = run(alpha(handler, cache).earnings_calendar())
    second = run(alpha(handler, cache).earnings_calendar())
    assert first == second
    assert first[0].report_date == date(2026, 10, 30)
    assert first[0].source.published_at is None  # future event date is not publication time
    assert len(calls) == 1
    assert cache[AlphaVantageProvider.BUDGET_KEY]["calls"] == 1
    assert "secret-alpha-key" not in str(cache)


def test_alpha_earnings_history_parses_surprises_and_caches():
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.params["function"] == "EARNINGS"
        assert request.url.params["symbol"] == "ABC"
        return httpx.Response(200, json={
            "quarterlyEarnings": [
                {
                    "fiscalDateEnding": "2026-06-30",
                    "reportedDate": "2026-07-30",
                    "reportedEPS": "1.20",
                    "estimatedEPS": "1.10",
                    "surprisePercentage": "9.09",
                    "reportTime": "post-market",
                    "currency": "USD",
                }
            ]
        })

    cache = {}
    first = run(alpha(handler, cache).earnings_history("ABC"))
    second = run(alpha(handler, cache).earnings_history("ABC"))
    assert first == second
    assert first[0]["surprise_percentage"] == "9.09"
    assert len(calls) == 1
    assert "secret-alpha-key" not in str(cache)


def test_alpha_budget_is_reserved_before_request_and_survives_http_200_rejection():
    cache = {}

    def handler(_):
        assert cache[AlphaVantageProvider.BUDGET_KEY]["calls"] == 1
        return httpx.Response(200, json={"Information": "secret-alpha-key provider payload"})

    with pytest.raises(ProviderError) as error:
        run(alpha(handler, cache).exchange_rate())
    assert error.value.code == "provider_rejected"
    assert "secret-alpha-key" not in str(error.value)
    assert cache[AlphaVantageProvider.BUDGET_KEY]["calls"] == 1
    assert AlphaVantageProvider.FX_KEY not in cache


def test_alpha_persisted_daily_limit_prevents_network_call():
    cache = {AlphaVantageProvider.BUDGET_KEY: {"day": "2026-10-08", "calls": 25}}

    def handler(_):
        pytest.fail("exhausted daily budget must prevent HTTP request")

    with pytest.raises(ProviderError) as error:
        run(alpha(handler, cache).exchange_rate())
    assert error.value.code == "daily_limit"


def test_alpha_new_utc_day_resets_budget_and_fx_cache_retains_observation_time():
    cache = {AlphaVantageProvider.BUDGET_KEY: {"day": "2026-10-07", "calls": 25}}
    result = run(alpha(lambda _: httpx.Response(200, json=fx_payload()), cache).exchange_rate())
    assert result.rate == Decimal("1.12")
    assert result.timestamp.minute == 45
    assert result.source.retrieved_at.minute == 0
    assert cache[AlphaVantageProvider.BUDGET_KEY] == {"day": "2026-10-08", "calls": 1}


@pytest.mark.parametrize(
    "payload",
    [fx_payload(pair="USD"), fx_payload(rate="0"), fx_payload(rate="NaN"), fx_payload(timestamp="2026-10-09 15:00:00")],
)
def test_alpha_invalid_pair_value_or_future_timestamp_fails_closed(payload):
    with pytest.raises(ProviderError) as error:
        run(alpha(lambda _: httpx.Response(200, json=payload)).exchange_rate())
    assert error.value.code == "invalid_response"


def test_alpha_json_rejection_cannot_be_mistaken_for_empty_calendar():
    with pytest.raises(ProviderError):
        run(alpha(lambda _: httpx.Response(200, json={"Note": "Rate limit"})).earnings_calendar())


def test_alpha_invalid_persisted_budget_fails_closed():
    cache = {AlphaVantageProvider.BUDGET_KEY: {"day": "2026-10-08", "calls": -1}}
    with pytest.raises(ProviderError) as error:
        run(alpha(lambda _: pytest.fail("no HTTP expected"), cache).exchange_rate())
    assert error.value.code == "invalid_cache"
