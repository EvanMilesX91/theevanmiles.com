import asyncio
from datetime import UTC, datetime, timedelta
import json

import httpx
import pytest

from app.api_usage import retry_after_seconds, usage_snapshot
from app.providers import AlpacaMarketDataProvider, AlphaVantageProvider, ProviderError, SECProvider

CALENDAR = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency\nAAPL,Apple,2026-11-01,2026-09-30,1.1,USD\n'


def test_calendar_concurrent_consumers_share_one_request_and_persisted_cache():
    async def scenario():
        calls = []
        async def upstream(request):
            calls.append(request)
            await asyncio.sleep(0.01)
            return httpx.Response(200, text=CALENDAR)
        cache = {}
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            first = AlphaVantageProvider(client, api_key='not-a-real-key', cache=cache)
            second = AlphaVantageProvider(client, api_key='not-a-real-key', cache=cache)
            result = await asyncio.gather(first.earnings_calendar(), second.earnings_calendar(), first.earnings_calendar())
            assert all(len(rows) == 1 for rows in result)
            assert len(calls) == 1
            restored = AlphaVantageProvider(client, api_key='not-a-real-key', cache=json.loads(json.dumps(cache)))
            await restored.earnings_calendar()
            assert len(calls) == 1
            assert calls[0].url.params['function'] == 'EARNINGS_CALENDAR'
            assert cache[first.BUDGET_KEY]['calls'] == 1
            assert cache[first.EARNINGS_KEY]['data_version'] == 1
    asyncio.run(scenario())


def test_failed_calendar_requests_consume_quota_and_checkpoint_precedes_http():
    async def scenario():
        order = []
        cache = {}
        def upstream(request):
            order.append('http')
            return httpx.Response(503)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            provider = AlphaVantageProvider(client, api_key='private', cache=cache, daily_limit=1,
                                           checkpoint=lambda: order.append('persist'))
            with pytest.raises(ProviderError):
                await provider.earnings_calendar()
            with pytest.raises(ProviderError) as limited:
                await provider.earnings_calendar()
            assert limited.value.code == 'daily_limit'
            assert order == ['persist', 'http']
            assert cache[provider.BUDGET_KEY]['calls'] == 1
            snapshot = usage_snapshot(cache)[2]
            assert snapshot['requests_today'] == 1 and snapshot['last_error']['code'] == 'request_failed'
    asyncio.run(scenario())


def test_checkpoint_failure_prevents_external_request():
    async def scenario():
        def persist():
            raise OSError('disk full')
        def upstream(request):
            pytest.fail('Must not dispatch without durable quota reservation')
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            provider = AlphaVantageProvider(client, api_key='private', checkpoint=persist)
            with pytest.raises(ProviderError) as error:
                await provider.earnings_calendar()
            assert error.value.code == 'checkpoint_failed'
    asyncio.run(scenario())


def test_daily_budget_rolls_over_without_exceeding_configured_allowance():
    async def scenario():
        now = datetime(2026, 10, 9, 12, tzinfo=UTC)
        cache = {'alpha_vantage_budget': {'day': now.date().isoformat(), 'calls': 1}}
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=CALENDAR))) as client:
            provider = AlphaVantageProvider(client, api_key='private', cache=cache, daily_limit=1, clock=lambda: now)
            with pytest.raises(ProviderError):
                await provider.earnings_calendar()
            now += timedelta(days=1)
            assert len(await provider.earnings_calendar()) == 1
            assert cache[provider.BUDGET_KEY]['calls'] == 1
    asyncio.run(scenario())


def test_retry_after_http_date_stops_immediate_retries_and_reports_rate_limit():
    async def scenario():
        calls = []
        future = datetime.now(UTC) + timedelta(minutes=3)
        header = future.strftime('%a, %d %b %Y %H:%M:%S GMT')
        def upstream(request):
            calls.append(request)
            return httpx.Response(429, headers={'Retry-After': header}, text='sensitive upstream error')
        cache = {}
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            provider = AlpacaMarketDataProvider(client, api_key='private', secret_key='private', cache=cache)
            with pytest.raises(ProviderError) as error:
                await provider.latest_quotes(['AAPL'])
            assert error.value.code == 'rate_limited'
            assert len(calls) == 1
            assert 'sensitive' not in str(error.value)
            assert usage_snapshot(cache)[0]['rate_limit_responses'] == 1
        assert retry_after_seconds(header, datetime.now(UTC)) > 150
    asyncio.run(scenario())


def test_historical_cache_requests_only_missing_ranges_and_separates_timeframes():
    async def scenario():
        calls = []
        def upstream(request):
            calls.append(request)
            return httpx.Response(200, json={'bars': {'AAPL': []}, 'next_page_token': None})
        cache = {}
        start = datetime(2025, 1, 1, tzinfo=UTC)
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            provider = AlpacaMarketDataProvider(client, api_key='private', secret_key='private', cache=cache)
            provider._min_interval = 0
            await asyncio.gather(*(provider.historical_bars('AAPL', start, start + timedelta(days=5)) for _ in range(3)))
            assert len(calls) == 1
            await provider.historical_bars('AAPL', start, start + timedelta(days=6))
            assert len(calls) == 2
            assert datetime.fromisoformat(calls[-1].url.params['start']) > start + timedelta(days=5)
            await provider.historical_bars('AAPL', start, start + timedelta(days=6))
            assert len(calls) == 2
            await provider.historical_bars('AAPL', start, start + timedelta(days=6), timeframe='5Min')
            assert len(calls) == 3 and calls[-1].url.params['timeframe'] == '5Min'
            row = cache['bars:AAPL:iex:raw:1Day']
            assert row['feed'] == 'iex' and row['adjustment'] == 'raw'
            assert row['retrieved_at'] and row['freshness_policy'] and len(row['ranges']) == 1
    asyncio.run(scenario())


def test_sec_reuses_companyfacts_until_a_new_filing_version():
    async def scenario():
        counts = {'facts': 0, 'submissions': 0}
        version = '0000000001-26-000001'
        def upstream(request):
            if '/submissions/' in request.url.path:
                counts['submissions'] += 1
                return httpx.Response(200, json={'cik': '1', 'name': 'Issuer', 'filings': {'recent': {
                    'accessionNumber': [version], 'filingDate': ['2026-01-01'], 'form': ['10-K'], 'primaryDocument': ['a.htm']}}})
            counts['facts'] += 1
            return httpx.Response(200, json={'cik': 1, 'entityName': 'Issuer', 'facts': {'us-gaap': {}}})
        cache = {}
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            provider = SECProvider(client, user_agent='Test test@example.org', cache=cache)
            provider._min_interval = 0
            await provider.fundamentals('1')
            await provider.fundamentals('1')
            assert counts == {'facts': 1, 'submissions': 1}
            for key, value in cache.items():
                if key.startswith('http:'):
                    value['expires_at'] = '2000-01-01T00:00:00+00:00'
            await provider.fundamentals('1')
            assert counts == {'facts': 1, 'submissions': 2}
            version = '0000000001-26-000002'
            for key, value in cache.items():
                if key.startswith('http:'):
                    value['expires_at'] = '2000-01-01T00:00:00+00:00'
            await provider.fundamentals('1')
            assert counts == {'facts': 2, 'submissions': 3}
    asyncio.run(scenario())
