"""Read-only provider adapters. No broker/order APIs exist in this module.

See docs/PROVIDERS.md for feed scope and the historical-data limitations.
Provider errors intentionally omit response bodies, request headers and URLs.
"""

from __future__ import annotations

import asyncio
import csv
import html
import io
import os
import re
import random
import hashlib
import json
from datetime import UTC, date, datetime, timezone, timedelta
from decimal import Decimal
from collections.abc import Callable, MutableMapping
from typing import Any, Literal, Protocol
from urllib.parse import quote as urlquote
from zoneinfo import ZoneInfo

import httpx
from .api_usage import (RequestBlocked, reserve_request, record_result, retry_after_seconds,
                        set_cooldown, singleflight, cache_record, cached_data)
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)


def clean_text(value: str, limit: int = 1000) -> str:
    """Plain-text metadata only; never render externally supplied HTML."""
    text = re.sub(r"<[^>]*>", "", html.unescape(value))
    return " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", text).split())[:limit]


class DataModel(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    @field_validator("*", mode="after")
    @classmethod
    def utc_timestamps(cls, value):
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(timezone.utc)
        return value


class Provenance(DataModel):
    provider: str
    url: str
    retrieved_at: AwareDatetime
    published_at: AwareDatetime | None = None
    reporting_period: str | None = None
    raw_value: Any = None
    normalized_value: Any = None
    description: str


class Bar(DataModel):
    symbol: str
    timestamp: AwareDatetime
    open: Decimal = Field(gt=0)
    high: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0)
    close: Decimal = Field(gt=0)
    volume: Decimal = Field(ge=0)
    source: Provenance

    @model_validator(mode="after")
    def consistent_range(self):
        if not self.low <= min(self.open, self.close) <= max(self.open, self.close) <= self.high:
            raise ValueError("inconsistent OHLC range")
        return self


class Quote(DataModel):
    symbol: str
    bid: Decimal = Field(gt=0)
    ask: Decimal = Field(gt=0)
    timestamp: AwareDatetime
    feed: Literal["REAL-TIME", "DELAYED"]
    feed_detail: str
    source: Provenance

    @model_validator(mode="after")
    def uncrossed(self):
        if self.ask < self.bid:
            raise ValueError("crossed quote")
        return self

    @property
    def price(self) -> Decimal:
        """Indicative midpoint, never a last trade or a broker executable fill."""
        return (self.bid + self.ask) / Decimal(2)


class FundamentalFact(DataModel):
    concept: str
    value: Decimal
    unit: str
    period_start: date | None = None
    period_end: date
    filed_on: date
    accession: str
    form: str
    source: Provenance


class Fundamentals(DataModel):
    cik: str
    company: str
    facts: list[FundamentalFact]
    retrieved_at: AwareDatetime


class Filing(DataModel):
    cik: str
    accession: str
    form: str
    filed_on: date
    accepted_at: AwareDatetime | None = None
    reporting_period: date | None = None
    description: str
    source: Provenance


class NewsItem(DataModel):
    title: str
    symbols: list[str]
    published_at: AwareDatetime
    source: Provenance

    @field_validator("title")
    @classmethod
    def sanitize_title(cls, value):
        return clean_text(value)


class CompanyIdentity(DataModel):
    symbol: str
    cik: str
    company: str
    sic: str | None = None
    sic_description: str | None = None
    source: Provenance


class EarningsEvent(DataModel):
    symbol: str
    company: str
    report_date: date
    fiscal_date_ending: date | None = None
    estimate: Decimal | None = None
    currency: str | None = None
    source: Provenance


class FxRate(DataModel):
    from_currency: str
    to_currency: str
    rate: Decimal = Field(gt=0)
    timestamp: AwareDatetime
    source: Provenance


class MacroObservation(DataModel):
    series: str
    value: Decimal
    observation_date: date
    available_at: AwareDatetime
    source: Provenance


class MarketDataProvider(Protocol):
    async def latest_quotes(self, symbols: list[str]) -> dict[str, Quote]: ...

    async def historical_bars(self, symbol: str, start: datetime, end: datetime) -> list[Bar]: ...


class FundamentalsProvider(Protocol):
    async def fundamentals(self, cik: str, as_of: date | None = None) -> Fundamentals: ...


class FilingsProvider(Protocol):
    async def filings(self, cik: str) -> list[Filing]: ...


class NewsProvider(Protocol):
    async def news(self, symbols: list[str], since: datetime) -> list[NewsItem]: ...


class MacroProvider(Protocol):
    async def observations(self, series: str, as_of: datetime) -> list[MacroObservation]: ...


class ProviderError(RuntimeError):
    """A safe message suitable for local UI diagnostics, with no upstream payload."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


class _HttpProvider:
    def __init__(self, client: httpx.AsyncClient | None = None, min_interval: float = 0,
                 *, cache: MutableMapping[str, Any] | None = None, provider: str = "alpaca",
                 checkpoint: Callable[[], None] | None = None):
        self._client = client or httpx.AsyncClient(timeout=10, follow_redirects=False)
        self._owns_client = client is None
        self._min_interval = min_interval
        self._lock = asyncio.Lock()
        self.cache = cache if cache is not None else {}
        self.provider_name = provider
        self.checkpoint = checkpoint

    async def aclose(self):
        if self._owns_client:
            await self._client.aclose()

    async def _get(self, url: str, headers: dict, params: dict | None = None) -> Any:
        key = "http:" + hashlib.sha256((url + json.dumps(params or {}, sort_keys=True)).encode()).hexdigest()
        ttl = 7 * 86400 if "company_tickers" in url else 3600 if "/submissions/" in url else 0
        if ttl:
            cached = cached_data(self.cache, key, datetime.now(timezone.utc))
            if cached is not None:
                return cached
        async def load():
            payload = await self._get_uncached(url, headers, params)
            if ttl:
                self.cache[key] = cache_record(payload, self.provider_name, datetime.now(timezone.utc), ttl=ttl)
            return payload
        return await singleflight(self.cache, self.provider_name, key, load)

    async def _get_uncached(self, url: str, headers: dict, params: dict | None = None) -> Any:
        endpoint = httpx.URL(url).path
        for attempt in range(3):
            try:
                await reserve_request(self.cache, self.provider_name, endpoint, interval=self._min_interval,
                                      clock=lambda: datetime.now(timezone.utc), checkpoint=self.checkpoint)
            except RequestBlocked as error:
                raise ProviderError(error.code, "Provider request budget is unavailable; using cached data.") from None
            try:
                response = await self._client.get(url, headers=headers, params=params)
            except httpx.RequestError:
                response = None
            record_result(self.cache, self.provider_name, endpoint, datetime.now(timezone.utc),
                          error=None if response is not None and response.status_code == 200 else "request_failed",
                          rate_limited=response is not None and response.status_code == 429)
            if response is not None and response.status_code == 200:
                try:
                    payload = response.json()
                    if not isinstance(payload, (dict, list)):
                        raise ValueError("not a JSON object or array")
                    return payload
                except (ValueError, TypeError):
                    raise ProviderError("invalid_response", "Provider returned invalid data.") from None
            status = response.status_code if response is not None else 0
            if status in (401, 403):
                raise ProviderError("access_denied", "Provider access denied; check credentials or feed access.")
            if status and status != 429 and status < 500:
                raise ProviderError("request_failed", "Provider request could not be completed.")
            if attempt < 2:
                delay = 0.25 * (2**attempt) + random.uniform(0, 0.25)
                if response is not None:
                    try:
                        delay = max(delay, retry_after_seconds(response.headers.get("Retry-After"), datetime.now(timezone.utc)))
                        if response.status_code == 429:
                            set_cooldown(self.cache, self.provider_name, datetime.now(timezone.utc), delay)
                    except ValueError:
                        pass
                # Do not retry earlier than a long requested backoff. Let the
                # scheduler retry later instead of tying up an HTTP worker.
                if delay > 5:
                    raise ProviderError("rate_limited", "Provider rate limit reached; try again later.")
                await asyncio.sleep(delay)
        code = "rate_limited" if status == 429 else "unavailable"
        raise ProviderError(code, "Provider temporarily unavailable; existing data must be marked stale.")

    async def _get_text(self, url: str, headers: dict) -> tuple[str, datetime]:
        """Fetch a bounded text document while preserving provider accounting."""
        endpoint = httpx.URL(url).path
        try:
            await reserve_request(self.cache, self.provider_name, endpoint,
                                  interval=self._min_interval,
                                  clock=lambda: datetime.now(timezone.utc),
                                  checkpoint=self.checkpoint)
        except RequestBlocked as error:
            raise ProviderError(error.code, "Provider request budget is unavailable; using cached data.") from None
        try:
            response = await self._client.get(url, headers=headers)
        except httpx.RequestError:
            response = None
        retrieved = datetime.now(timezone.utc)
        record_result(self.cache, self.provider_name, endpoint, retrieved,
                      error=None if response is not None and response.status_code == 200 else "request_failed",
                      rate_limited=response is not None and response.status_code == 429)
        if response is not None and response.status_code == 200:
            return response.text, retrieved
        status = response.status_code if response is not None else 0
        if status in (401, 403):
            raise ProviderError("access_denied", "Provider access denied; check credentials or feed access.")
        if status == 429:
            raise ProviderError("rate_limited", "Provider rate limit reached; try again later.")
        raise ProviderError("unavailable", "Provider temporarily unavailable; existing data must be marked stale.")


def _symbol(symbol: str) -> str:
    symbol = symbol.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol):
        raise ValueError("invalid stock symbol")
    return symbol


class _AlpacaQuote(DataModel):
    t: AwareDatetime
    bp: Decimal = Field(gt=0)
    ap: Decimal = Field(gt=0)


class _QuoteResponse(DataModel):
    quotes: dict[str, _AlpacaQuote]


class _AlpacaBar(DataModel):
    t: AwareDatetime
    o: Decimal = Field(gt=0)
    h: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0, alias="l")
    c: Decimal = Field(gt=0)
    v: Decimal = Field(ge=0)


class _BarsResponse(DataModel):
    bars: dict[str, list[_AlpacaBar]]
    next_page_token: str | None = None


class AlpacaMarketDataProvider(_HttpProvider):
    """IEX-only quotes and raw daily bars. Explicit SIP requires feed='sip'."""

    BASE_URL = "https://data.alpaca.markets"
    TRADING_URL = "https://api.alpaca.markets"

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        api_key: str | None = None,
        secret_key: str | None = None,
        feed: Literal["iex", "sip"] = "iex",
        cache: MutableMapping[str, Any] | None = None,
        checkpoint: Callable[[], None] | None = None,
    ):
        key = api_key or os.getenv("APCA_API_KEY_ID")
        secret = secret_key or os.getenv("APCA_API_SECRET_KEY")
        if not key or not secret:
            raise ProviderError("not_configured", "Alpaca credentials are not configured.")
        if feed not in ("iex", "sip"):
            raise ValueError("unsupported market feed")
        super().__init__(client, min_interval=0.35, cache=cache, provider="alpaca", checkpoint=checkpoint)
        self._headers = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}
        self.feed = feed

    async def tradable_assets(self) -> list[dict[str, Any]]:
        """Return a bounded, filtered US-equity discovery universe.

        Asset metadata is used only to find candidates. It is never treated as
        evidence that a company is investable; each candidate still needs the
        normal price, filing, event and liquidity checks.
        """
        payload = await self._get(
            f"{self.TRADING_URL}/v2/assets", self._headers,
            {"status": "active", "asset_class": "us_equity"},
        )
        if not isinstance(payload, list):
            raise ProviderError("invalid_response", "Alpaca returned an invalid asset list.")
        allowed_exchanges = {"NYSE", "NASDAQ", "ARCA", "BATS"}
        output: list[dict[str, Any]] = []
        for row in payload:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol", "")).strip().upper()
            if (
                row.get("class") == "us_equity" and row.get("status") == "active"
                and row.get("tradable") is True and row.get("exchange") in allowed_exchanges
                and re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", symbol)
            ):
                output.append({"symbol": symbol, "exchange": row.get("exchange"), "name": clean_text(str(row.get("name", symbol)), 120)})
        return output

    async def latest_quotes(self, symbols: list[str]) -> dict[str, Quote]:
        requested = list(dict.fromkeys(_symbol(s) for s in symbols))
        if not 1 <= len(requested) <= 100:
            raise ValueError("request 1 to 100 symbols")
        url = f"{self.BASE_URL}/v2/stocks/quotes/latest"
        payload = await self._get(url, self._headers, {"symbols": ",".join(requested), "feed": self.feed})
        retrieved = datetime.now(timezone.utc)
        try:
            # IEX commonly withdraws one side after the session closes. Zero is
            # an absent quote, never a zero-dollar price or a usable midpoint.
            if isinstance(payload.get("quotes"), dict):
                payload = {**payload, "quotes": {
                    symbol: quote for symbol, quote in payload["quotes"].items()
                    if not (isinstance(quote, dict) and (quote.get("bp") == 0 or quote.get("ap") == 0))
                }}
            parsed = _QuoteResponse.model_validate(payload)
            output = {}
            for symbol in requested:
                raw = parsed.quotes.get(symbol)
                if raw is None:
                    continue  # absence is explicit; never fabricate a price
                detail = "IEX only; limited exchange coverage" if self.feed == "iex" else "SIP consolidated feed"
                output[symbol] = Quote(
                    symbol=symbol,
                    bid=raw.bp,
                    ask=raw.ap,
                    timestamp=raw.t,
                    feed="REAL-TIME",
                    feed_detail=f"{detail}; indicative bid/ask midpoint, not a broker fill",
                    source=Provenance(
                        provider=f"Alpaca {self.feed.upper()}",
                        url=url,
                        retrieved_at=retrieved,
                        published_at=raw.t,
                        raw_value=raw.model_dump(mode="json"),
                        normalized_value={"bid": str(raw.bp), "ask": str(raw.ap)},
                        description=f"{detail}; quote freshness must be checked using its timestamp.",
                    ),
                )
            return output
        except ValidationError:
            raise ProviderError("invalid_response", "Provider returned an invalid quote.") from None

    async def historical_bars(self, symbol: str, start: datetime, end: datetime, *,
                              feed: Literal["iex", "sip"] | None = None, adjustment: Literal["raw", "split"] = "raw",
                              timeframe: str = "1Day") -> list[Bar]:
        if timeframe not in {"1Min", "5Min", "15Min", "1Hour", "1Day"}:
            raise ValueError("unsupported timeframe")
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("start and end must be ordered timezone-aware datetimes")
        symbol = _symbol(symbol)
        selected_feed = feed or self.feed
        key = f"bars:{symbol}:{selected_feed}:{adjustment}:{timeframe}"
        async def load():
            row = self.cache.get(key, {})
            bars = {b["timestamp"]: b for b in row.get("data", [])}
            ranges = row.get("ranges", [])
            missing = [(start, end)]
            for begin, finish in ranges:
                left, right = datetime.fromisoformat(begin), datetime.fromisoformat(finish)
                parts = []
                for a, b in missing:
                    if right < a or left > b:
                        parts.append((a, b))
                    else:
                        if a < left:
                            parts.append((a, left - timedelta(microseconds=1)))
                        if b > right:
                            parts.append((right + timedelta(microseconds=1), b))
                missing = parts
            for a, b in missing:
                if a >= b:
                    continue
                downloaded = await self._historical_bars_uncached(symbol, a, b, feed=selected_feed,
                                                                 adjustment=adjustment, timeframe=timeframe)
                for bar in downloaded:
                    bars[bar.timestamp.isoformat()] = bar.model_dump(mode="json")
                # Only complete bars are covered forever. An in-progress daily
                # or intraday bar is re-requested once after it closes.
                step = {"1Min":60,"5Min":300,"15Min":900,"1Hour":3600,"1Day":86400}[timeframe]
                clock = datetime.now(timezone.utc)
                if timeframe == "1Day":
                    boundary = clock.astimezone(ZoneInfo("America/New_York")).replace(hour=0, minute=0, second=0, microsecond=0)
                    safe_end = min(b, boundary.astimezone(timezone.utc) - timedelta(microseconds=1))
                else:
                    available = (clock - timedelta(minutes=16)).timestamp()
                    boundary = datetime.fromtimestamp((available // step) * step, timezone.utc)
                    safe_end = min(b, boundary - timedelta(microseconds=1))
                if safe_end > a:
                    ranges.append([a.isoformat(), safe_end.isoformat()])
                merged: list[list[str]] = []
                for left, right in sorted(ranges, key=lambda pair: datetime.fromisoformat(pair[0])):
                    if merged and datetime.fromisoformat(left) <= datetime.fromisoformat(merged[-1][1]) + timedelta(microseconds=1):
                        merged[-1][1] = max(merged[-1][1], right)
                    else:
                        merged.append([left, right])
                ranges = merged
                self.cache[key] = cache_record(sorted(bars.values(), key=lambda item:item["timestamp"]),
                                              "Alpaca", datetime.now(timezone.utc), policy="completed ranges; incremental gaps only",
                                              source_timestamp=max(bars, default=None), ranges=ranges,
                                              feed=selected_feed, adjustment=adjustment, timeframe=timeframe)
            return [Bar.model_validate(b) for b in sorted(bars.values(), key=lambda item:item["timestamp"])
                    if start <= datetime.fromisoformat(b["timestamp"]) <= end]
        # Same-range consumers share a single cache fill. Engine slow jobs also
        # serialize overlapping range extensions.
        return await singleflight(self.cache, "alpaca", f"{key}:{start.isoformat()}:{end.isoformat()}", load)

    async def _historical_bars_uncached(
        self,
        symbol: str,
        start: datetime,
        end: datetime,
        *,
        feed: Literal["iex", "sip"] | None = None,
        adjustment: Literal["raw", "split"] = "raw",
        timeframe: str = "1Day",
    ) -> list[Bar]:
        symbol = _symbol(symbol)
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("start and end must be ordered timezone-aware datetimes")
        selected_feed = feed or self.feed
        if selected_feed not in {"iex", "sip"} or adjustment not in {"raw", "split"}:
            raise ValueError("unsupported feed or adjustment")
        url = f"{self.BASE_URL}/v2/stocks/bars"
        params = {
            "symbols": symbol,
            "timeframe": timeframe,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "feed": selected_feed,
            "adjustment": adjustment,
            "sort": "asc",
            "limit": 10000,
        }
        output: list[Bar] = []
        tokens: set[str] = set()
        for _ in range(10):
            payload = await self._get(url, self._headers, params)
            retrieved = datetime.now(timezone.utc)
            try:
                parsed = _BarsResponse.model_validate(payload)
                for raw in parsed.bars.get(symbol, []):
                    if not start <= raw.t <= end:
                        raise ValueError("bar outside requested range")
                    output.append(
                        Bar(
                            symbol=symbol,
                            timestamp=raw.t,
                            open=raw.o,
                            high=raw.h,
                            low=raw.low,
                            close=raw.c,
                            volume=raw.v,
                            source=Provenance(
                                provider=f"Alpaca {selected_feed.upper()}",
                                url=url,
                                retrieved_at=retrieved,
                                published_at=raw.t,
                                raw_value=raw.model_dump(mode="json", by_alias=True),
                                normalized_value=str(raw.c),
                                description=f"{timeframe} OHLCV, adjustment={adjustment}; bar timestamp is its start, not availability time.",
                            ),
                        )
                    )
            except (ValidationError, ValueError):
                raise ProviderError("invalid_response", "Provider returned invalid historical bars.") from None
            token = parsed.next_page_token
            if not token:
                by_timestamp = {bar.timestamp: bar for bar in output}
                return sorted(by_timestamp.values(), key=lambda b: b.timestamp)
            if token in tokens:
                break
            tokens.add(token)
            params["page_token"] = token
        raise ProviderError("pagination_limit", "History exceeded the bounded page limit; request a shorter period.")

    async def news(self, symbols: list[str], since: datetime) -> list[NewsItem]:
        requested = list(dict.fromkeys(_symbol(s) for s in symbols))
        if not requested or len(requested) > 100 or since.tzinfo is None:
            raise ValueError("news requires 1 to 100 symbols and a timezone-aware start")
        url = f"{self.BASE_URL}/v1beta1/news"
        params = {
            "symbols": ",".join(requested),
            "start": since.isoformat(),
            "sort": "desc",
            "limit": 50,
            "include_content": "false",
        }
        output: dict[str, NewsItem] = {}
        tokens: set[str] = set()
        for _ in range(10):
            payload = await self._get(url, self._headers, params)
            retrieved = datetime.now(timezone.utc)
            try:
                rows = payload["news"]
                if not isinstance(rows, list):
                    raise ValueError("invalid news rows")
                for row in rows:
                    if not isinstance(row.get("symbols"), list) or not all(isinstance(s, str) for s in row["symbols"]):
                        raise ValueError("invalid news symbols")
                    published = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                    article_url = row.get("url") or url
                    if not article_url.startswith("https://"):
                        article_url = url
                    item = NewsItem(
                        title=row["headline"],
                        symbols=[_symbol(s) for s in row["symbols"] if s in requested],
                        published_at=published,
                        source=Provenance(
                            provider="Alpaca / Benzinga news",
                            url=article_url,
                            retrieved_at=retrieved,
                            published_at=published,
                            raw_value={"id": row.get("id"), "headline": clean_text(row["headline"])},
                            normalized_value=clean_text(row["headline"]),
                            description="Provider headline; coverage is not an exhaustive event review.",
                        ),
                    )
                    if item.symbols and published >= since and published <= retrieved:
                        output[str(row.get("id", article_url))] = item
                token = payload.get("next_page_token")
                if token is not None and not isinstance(token, str):
                    raise ValueError("invalid pagination token")
            except (ValidationError, ValueError, TypeError, KeyError, AttributeError):
                raise ProviderError("invalid_response", "Provider returned invalid news data.") from None
            if not token:
                return sorted(output.values(), key=lambda n: n.published_at, reverse=True)
            if token in tokens:
                break
            tokens.add(token)
            params["page_token"] = token
        raise ProviderError("pagination_limit", "News coverage exceeded the bounded page limit.")


class _RecentFilings(DataModel):
    accessionNumber: list[str]
    filingDate: list[str]
    form: list[str]
    primaryDocument: list[str]
    acceptanceDateTime: list[str] = Field(default_factory=list)
    reportDate: list[str] = Field(default_factory=list)
    primaryDocDescription: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def equal_columns(self):
        count = len(self.accessionNumber)
        for column in (self.filingDate, self.form, self.primaryDocument):
            if len(column) != count:
                raise ValueError("unequal filings columns")
        for column in (self.acceptanceDateTime, self.reportDate, self.primaryDocDescription):
            if column and len(column) != count:
                raise ValueError("unequal optional filings columns")
        return self


class _FilingsBlock(DataModel):
    recent: _RecentFilings


class _Submission(DataModel):
    cik: str | int
    name: str
    filings: _FilingsBlock


class _XbrlFact(DataModel):
    val: Decimal
    end: date
    start: date | None = None
    filed: date
    accn: str
    form: str


class _Concept(DataModel):
    units: dict[str, list[_XbrlFact]]


class _CompanyFacts(DataModel):
    cik: int
    entityName: str
    facts: dict[str, dict[str, _Concept]]


def _cik(cik: str) -> str:
    if not re.fullmatch(r"\d{1,10}", str(cik)) or int(cik) <= 0:
        raise ValueError("CIK must be a positive identifier of up to 10 digits")
    return str(cik).zfill(10)


def _filing_url(cik: str, accession: str, document: str | None = None) -> str:
    if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
        raise ValueError("invalid accession number")
    prefix = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}"
    return f"{prefix}/{urlquote(document, safe='')}" if document else f"{prefix}/{accession}-index.html"


class SECProvider(_HttpProvider):
    """Current public filings and raw US-GAAP facts, with retained filing dates.

    Uses 5 requests/second per instance; run one shared instance in the scheduler.
    The optional date cutoff is conservative, not a point-in-time archive.
    """

    def __init__(self, client: httpx.AsyncClient | None = None, user_agent: str | None = None,
                 cache: MutableMapping[str, Any] | None = None, checkpoint: Callable[[], None] | None = None):
        identifier: str = user_agent or os.getenv("SEC_USER_AGENT") or ""
        if "@" not in identifier or "\n" in identifier or "\r" in identifier:
            raise ProviderError("not_configured", "Set SEC_USER_AGENT to an application name and contact email.")
        super().__init__(client, min_interval=0.21, cache=cache, provider="sec", checkpoint=checkpoint)
        self._headers = {"User-Agent": identifier, "Accept-Encoding": "gzip, deflate"}
        self._ticker_map: dict | None = None

    async def resolve_company(self, symbol: str) -> CompanyIdentity:
        """Resolve official ticker mapping and independently verify the submissions identity."""
        symbol = _symbol(symbol)
        if self._ticker_map is None:
            self._ticker_map = await self._get("https://www.sec.gov/files/company_tickers.json", self._headers)
        try:
            # SEC and market providers differ for share-class separators.
            matches = [
                row
                for row in self._ticker_map.values()
                if isinstance(row, dict) and str(row.get("ticker", "")).replace("-", ".") == symbol.replace("-", ".")
            ]
            if len(matches) != 1:
                raise ProviderError("identity_unavailable", "A unique SEC company mapping is unavailable.")
            cik = _cik(str(matches[0]["cik_str"]))
            url = f"https://data.sec.gov/submissions/CIK{cik}.json"
            payload = await self._get(url, self._headers)
            tickers = payload.get("tickers", [])
            if not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
                raise ValueError("invalid ticker list")
            if int(payload["cik"]) != int(cik) or symbol.replace("-", ".") not in [
                str(t).replace("-", ".") for t in tickers
            ]:
                raise ValueError("ticker/CIK mismatch")
            retrieved = datetime.now(timezone.utc)
            return CompanyIdentity(
                symbol=symbol,
                cik=cik,
                company=clean_text(payload["name"]),
                sic=str(payload["sic"]) if payload.get("sic") else None,
                sic_description=clean_text(payload["sicDescription"]) if payload.get("sicDescription") else None,
                source=Provenance(
                    provider="SEC EDGAR company identity",
                    url=url,
                    retrieved_at=retrieved,
                    raw_value={"cik": cik, "tickers": tickers, "sic": payload.get("sic")},
                    normalized_value={"symbol": symbol, "cik": cik},
                    description="Official SEC ticker map, verified against the issuer's current submissions metadata.",
                ),
            )
        except (ValidationError, ValueError, TypeError, KeyError):
            raise ProviderError("invalid_response", "SEC company identity could not be verified.") from None

    async def filings(self, cik: str) -> list[Filing]:
        cik = _cik(cik)
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        payload = await self._get(url, self._headers)
        retrieved = datetime.now(timezone.utc)
        try:
            parsed = _Submission.model_validate(payload)
            if int(parsed.cik) != int(cik):
                raise ValueError("CIK mismatch")
            rows = parsed.filings.recent
            output = []
            for i, accession in enumerate(rows.accessionNumber):
                accepted_text = rows.acceptanceDateTime[i] if rows.acceptanceDateTime else None
                report_text = rows.reportDate[i] if rows.reportDate else None
                accepted = datetime.fromisoformat(accepted_text.replace("Z", "+00:00")) if accepted_text else None
                report = date.fromisoformat(report_text) if report_text else None
                description = clean_text(rows.primaryDocDescription[i] if rows.primaryDocDescription else rows.form[i])
                output.append(
                    Filing(
                        cik=cik,
                        accession=accession,
                        form=clean_text(rows.form[i], 40),
                        filed_on=date.fromisoformat(rows.filingDate[i]),
                        accepted_at=accepted,
                        reporting_period=report,
                        description=description,
                        source=Provenance(
                            provider="SEC EDGAR",
                            url=_filing_url(cik, accession, rows.primaryDocument[i]),
                            retrieved_at=retrieved,
                            published_at=accepted or None,
                            reporting_period=report_text or None,
                            raw_value=accession,
                            normalized_value=accession,
                            description=description,
                        ),
                    )
                )
            return output
        except (ValidationError, ValueError, TypeError):
            raise ProviderError("invalid_response", "SEC returned invalid filing metadata.") from None

    async def customer_concentration(self, filing: Filing) -> dict[str, Any] | None:
        """Extract only an explicit customer concentration percentage.

        The result is intentionally conservative: a filing with no explicit
        percentage returns ``None`` rather than treating absent disclosure as
        zero concentration.  The source filing remains attached to the
        derived metric by the caller.
        """
        text, retrieved = await self._get_text(filing.source.url, self._headers)
        plain = re.sub(r"<[^>]+>", " ", html.unescape(text))
        plain = " ".join(plain.split())
        # Look for a percentage in the same short sentence/paragraph as
        # customer/client concentration language.  This avoids claiming that
        # an arbitrary percentage elsewhere in a filing is concentration.
        matches: list[float] = []
        for sentence in re.split(r"(?<=[.;])\s+", plain):
            lowered = sentence.lower()
            if "customer" not in lowered and "client" not in lowered:
                continue
            if not any(term in lowered for term in ("concentration", "revenue", "sales", "accounted for", "represented")):
                continue
            for raw in re.findall(r"(?<![\d.])(\d{1,3}(?:\.\d+)?)\s*%", sentence):
                value = float(raw)
                if 0 < value <= 100:
                    matches.append(value)
            # Diversified issuers commonly disclose an upper bound instead
            # of naming a customer: “no single customer accounted for more
            # than 10%”. Treat that explicit bound as the measured maximum;
            # never infer zero from silence.
            for raw in re.findall(
                r"(?:no|not)\s+(?:single|one)\s+(?:customer|client)[^.;]{0,180}?"
                r"(?:more than|exceed(?:ed|s)?|greater than|at least)\s+(\d{1,3}(?:\.\d+)?)\s*%",
                lowered,
            ):
                value = float(raw)
                if 0 < value <= 100:
                    matches.append(value)
        if not matches:
            return None
        return {
            "maximum_pct": max(matches),
            "filing_accession": filing.accession,
            "filed_on": filing.filed_on.isoformat(),
            "retrieved_at": retrieved.isoformat(),
        }

    async def fundamentals(self, cik: str, as_of: date | None = None) -> Fundamentals:
        cik = _cik(cik)
        key = f"sec:facts:{cik}"
        async def load():
            previous = self.cache.get(key)
            # Current submissions are checked at most hourly. The complete
            # normalized facts remain reusable until a new accession appears.
            filings = await self.filings(cik)
            financial_filings = [f for f in filings if f.form in {'10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A', '20-F'}]
            latest = max(financial_filings, key=lambda f: (f.filed_on, f.accession), default=None)
            version = latest.accession if latest else "none"
            if isinstance(previous, dict) and previous.get("filing_version") == version:
                return Fundamentals.model_validate(previous["data"])
            result = await self._fundamentals_uncached(cik, date.max)
            self.cache[key] = cache_record(result.model_dump(mode="json"), "SEC EDGAR", datetime.now(timezone.utc),
                                          policy="until newer filing accession", source_timestamp=version,
                                          filing_version=version)
            return result
        result = await singleflight(self.cache, "sec", key, load)
        cutoff = as_of or datetime.now(timezone.utc).date()
        return result.model_copy(update={"facts": [f for f in result.facts if f.filed_on < cutoff and f.period_end <= cutoff]})

    async def _fundamentals_uncached(self, cik: str, as_of: date | None = None) -> Fundamentals:
        cik = _cik(cik)
        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
        payload = await self._get(url, self._headers)
        retrieved = datetime.now(timezone.utc)
        cutoff = as_of or retrieved.date()
        try:
            parsed = _CompanyFacts.model_validate(payload)
            if parsed.cik != int(cik):
                raise ValueError("CIK mismatch")
            facts = []
            relevant = {
                "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
                "OperatingIncomeLoss", "NetIncomeLoss", "NetCashProvidedByUsedInOperatingActivities",
                "PaymentsToAcquirePropertyPlantAndEquipment", "CashAndCashEquivalentsAtCarryingValue",
                "Assets", "DebtCurrentAndNoncurrent", "LongTermDebtNoncurrent", "LongTermDebtCurrent",
                "ShortTermBorrowings", "ShortTermDebt", "CommonStockSharesOutstanding",
                "WeightedAverageNumberOfDilutedSharesOutstanding", "EarningsPerShareDiluted",
            }
            for concept, value in parsed.facts.get("us-gaap", {}).items():
                if concept not in relevant:
                    continue
                for unit, observations in value.units.items():
                    for row in observations:
                        # A date-only filed value does not prove availability
                        # during that same day. Exclude it until the next date.
                        if row.filed >= cutoff or row.end > cutoff:
                            continue
                        if row.end < retrieved.date() - timedelta(days=5 * 366):
                            continue  # V1 live research keeps five years of required concepts, not an EDGAR mirror.
                        facts.append(
                            FundamentalFact(
                                concept=clean_text(concept, 200),
                                value=row.val,
                                unit=clean_text(unit, 80),
                                period_start=row.start,
                                period_end=row.end,
                                filed_on=row.filed,
                                accession=row.accn,
                                form=clean_text(row.form, 40),
                                source=Provenance(
                                    provider="SEC EDGAR companyfacts",
                                    url=_filing_url(cik, row.accn),
                                    retrieved_at=retrieved,
                                    reporting_period=str(row.end),
                                    raw_value=row.model_dump(mode="json"),
                                    normalized_value=str(row.val),
                                    description=f"US-GAAP {clean_text(concept, 200)}; filed {row.filed}; unit {clean_text(unit, 80)}.",
                                ),
                            )
                        )
            return Fundamentals(cik=cik, company=clean_text(parsed.entityName), facts=facts, retrieved_at=retrieved)
        except (ValidationError, ValueError, TypeError):
            raise ProviderError("invalid_response", "SEC returned invalid company facts.") from None


class AlphaVantageProvider(_HttpProvider):
    """Two free-plan endpoints; one durable JSON cache/budget per application.

    The caller must serialize jobs and persist ``cache`` after every attempt,
    including failures. A reservation is made before each HTTP request, without
    automatic retries. Persist reservations even when calls fail; all callers
    must share one serialized budget. An uncommitted reservation can be lost
    on process termination, so durable runners should persist before dispatch.
    Never expose URLs containing the query-string API key in diagnostics.
    """

    BASE_URL = "https://www.alphavantage.co/query"
    BUDGET_KEY = "alpha_vantage_budget"
    EARNINGS_KEY = "alpha_vantage_earnings"
    EARNINGS_HISTORY_KEY = "alpha_vantage_earnings_history"
    NEWS_KEY = "alpha_vantage_news"
    FX_KEY = "alpha_vantage_fx_eur_usd"

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        api_key: str | None = None,
        cache: MutableMapping[str, Any] | None = None,
        clock: Callable[[], datetime] | None = None,
        daily_limit: int = 25,
        history_reserve: int = 0,
        checkpoint: Callable[[], None] | None = None,
    ):
        key = api_key or os.getenv("ALPHA_VANTAGE_API_KEY")
        if not key:
            raise ProviderError("not_configured", "Alpha Vantage credentials are not configured.")
        super().__init__(client, cache=cache, provider="alpha_vantage", checkpoint=checkpoint)
        if not 1 <= daily_limit <= 25:
            raise ValueError("Free Alpha Vantage allowance must be between 1 and 25.")
        self.daily_limit = daily_limit
        self.history_reserve = max(0, min(history_reserve, daily_limit - 1))
        self._api_key = key
        self.cache = cache if cache is not None else {}
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def _cached(self, key: str, seconds: int) -> Any | None:
        entry = self.cache.get(key)
        if isinstance(entry, dict):
            try:
                age = (self._clock() - datetime.fromisoformat(entry["retrieved_at"])).total_seconds()
                if 0 <= age < seconds:
                    return entry["data"]
            except (ValueError, TypeError, KeyError):
                pass
        return None

    async def _request(self, params: dict[str, str]) -> httpx.Response:
        endpoint = params["function"]
        # NEWS_SENTIMENT is optional. Preserve a slice of the shared free-plan
        # allowance for the historical earnings collector so it can make
        # steady progress instead of being starved by current news refreshes.
        if endpoint == "NEWS_SENTIMENT" and self.history_reserve:
            budget = self.cache.get(self.BUDGET_KEY, {})
            today = self._clock().astimezone(UTC).date().isoformat()
            calls = budget.get("calls", 0) if isinstance(budget, dict) and budget.get("day") == today else 0
            if isinstance(calls, int) and calls >= self.daily_limit - self.history_reserve:
                raise ProviderError("budget_reserved", "Alpha Vantage allowance reserved for historical earnings.")
        try:
            await reserve_request(self.cache, "alpha_vantage", endpoint, interval=1,
                                  clock=self._clock, checkpoint=self.checkpoint,
                                  daily_limit=self.daily_limit, budget_key=self.BUDGET_KEY)
        except RequestBlocked as error:
            raise ProviderError(error.code, "Alpha Vantage daily allowance or request budget unavailable.") from None
        try:
            response = await self._client.get(self.BASE_URL, params={**params, "apikey": self._api_key})
        except httpx.RequestError:
            record_result(self.cache, "alpha_vantage", endpoint, self._clock(), error="unavailable")
            raise ProviderError("unavailable", "Alpha Vantage is temporarily unavailable.") from None
        record_result(self.cache, "alpha_vantage", endpoint, self._clock(),
                      error=None if response.status_code == 200 else "request_failed", rate_limited=response.status_code == 429)
        if response.status_code == 429:
            set_cooldown(self.cache, "alpha_vantage", self._clock(),
                         max(60, retry_after_seconds(response.headers.get("Retry-After"), self._clock())))
        if response.status_code != 200:
            code = "rate_limited" if response.status_code == 429 else "unavailable"
            if response.status_code in {401, 403}:
                code = "access_denied"
            raise ProviderError(code, "Alpha Vantage could not complete the data request.")
        # Alpha Vantage may use HTTP 200 for throttling, plan limits and errors.
        if response.text.lstrip().startswith("{"):
            try:
                payload = response.json()
            except ValueError:
                raise ProviderError("invalid_response", "Alpha Vantage returned invalid data.") from None
            if isinstance(payload, dict) and any(k in payload for k in ("Note", "Information", "Error Message")):
                record_result(self.cache, "alpha_vantage", endpoint, self._clock(),
                              error="provider_rejected", rate_limited=True)
                set_cooldown(self.cache, "alpha_vantage", self._clock(), 86400)
                raise ProviderError(
                    "provider_rejected", "Alpha Vantage rejected the request; check key, allowance and endpoint access."
                )
        return response

    async def earnings_calendar(self) -> list[EarningsEvent]:
        return await singleflight(self.cache, "alpha_vantage", self.EARNINGS_KEY, self._earnings_calendar)

    async def earnings_history(self, symbol: str) -> list[dict[str, Any]]:
        """Return reported/estimated quarterly EPS observations for one symbol.

        Alpha Vantage documents this as the historical earnings endpoint; the
        caller uses it for an uncertainty statistic, never as a price target.
        Results are cached for 30 days because the history changes only when a
        new report arrives and the free plan has a daily request budget.
        """
        symbol = _symbol(symbol)
        key = f"{self.EARNINGS_HISTORY_KEY}:{symbol}"
        cached = self._cached(key, 30 * 86400)
        if cached is not None:
            return list(cached)
        response = await self._request({"function": "EARNINGS", "symbol": symbol})
        retrieved = self._clock()
        try:
            payload = response.json()
            rows = payload.get("quarterlyEarnings", [])
            if not isinstance(rows, list):
                raise ValueError("invalid quarterly earnings")
            result: list[dict[str, Any]] = []
            for row in rows[:40]:
                if not isinstance(row, dict) or not row.get("fiscalDateEnding"):
                    continue
                result.append({
                    "fiscal_date_ending": str(row.get("fiscalDateEnding")),
                    "reported_date": str(row.get("reportedDate") or ""),
                    "reported_eps": row.get("reportedEPS"),
                    "estimated_eps": row.get("estimatedEPS"),
                    "surprise_percentage": row.get("surprisePercentage"),
                    "report_time": clean_text(str(row.get("reportTime") or ""), 20),
                    "currency": clean_text(str(row.get("currency") or ""), 8) or None,
                    "source": {
                        "provider": "Alpha Vantage earnings history",
                        "url": "https://www.alphavantage.co/documentation/#earnings",
                        "retrieved_at": retrieved.isoformat(),
                        "published_at": None,
                        "reporting_period": str(row.get("fiscalDateEnding")),
                        "raw_value": row,
                        "normalized_value": None,
                        "description": "Historical reported and estimated EPS observations; availability depends on the configured plan.",
                    },
                })
        except (ValueError, TypeError, AttributeError):
            raise ProviderError("invalid_response", "Alpha Vantage returned invalid earnings history.") from None
        self.cache[key] = cache_record(result, "Alpha Vantage", retrieved,
                                       source_timestamp=retrieved.isoformat(), ttl=30 * 86400)
        return result

    async def news_sentiment(self, symbols: list[str], since: datetime,
                             until: datetime | None = None) -> list[NewsItem]:
        """Fetch a bounded ticker-filtered window when the configured plan permits it.

        Alpha Vantage documents this endpoint as historical market news and
        sentiment, but access and allowance vary by plan. A rejection is
        surfaced as a provider error and the caller keeps the other feeds.
        """
        tickers = ",".join(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
        if not tickers or since.tzinfo is None:
            raise ValueError("news_sentiment requires symbols and a timezone-aware start")
        until = until or self._clock()
        cache_key = f"{self.NEWS_KEY}:{tickers}:{since.strftime('%Y%m%dT%H%M')}:{until.strftime('%Y%m%dT%H%M')}"
        cached = self._cached(cache_key, 6 * 3600)
        if cached is not None:
            try:
                return [NewsItem.model_validate(row) for row in cached]
            except (ValidationError, TypeError):
                pass
        response = await self._request({
            "function": "NEWS_SENTIMENT", "tickers": tickers,
            "time_from": since.astimezone(timezone.utc).strftime("%Y%m%dT%H%M"),
            "time_to": until.astimezone(timezone.utc).strftime("%Y%m%dT%H%M"),
            "sort": "LATEST", "limit": "1000",
        })
        retrieved = self._clock()
        try:
            payload = response.json()
            rows = payload.get("feed", [])
            if not isinstance(rows, list):
                raise ValueError("invalid news feed")
            output: list[NewsItem] = []
            requested = set(tickers.split(","))
            for row in rows[:1000]:
                published = datetime.strptime(str(row["time_published"]), "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
                if not since <= published <= until:
                    continue
                mentioned = {
                    str(item.get("ticker", "")).upper()
                    for item in row.get("ticker_sentiment", [])
                    if isinstance(item, dict)
                } & requested
                if not mentioned:
                    continue
                url = str(row.get("url", ""))
                if not url.startswith("https://"):
                    continue
                output.append(NewsItem(
                    title=row["title"], symbols=sorted(mentioned), published_at=published,
                    source=Provenance(
                        provider="Alpha Vantage News & Sentiment", url=url,
                        retrieved_at=retrieved, published_at=published,
                        raw_value={"source": row.get("source"), "overall_sentiment_score": row.get("overall_sentiment_score")},
                        normalized_value=row.get("overall_sentiment_score"),
                        description="Ticker-filtered market news; availability depends on the configured Alpha Vantage plan.",
                    ),
                ))
        except (ValidationError, ValueError, TypeError, KeyError, AttributeError):
            raise ProviderError("invalid_response", "Alpha Vantage returned invalid news data.") from None
        self.cache[cache_key] = cache_record([item.model_dump(mode="json") for item in output],
                                             "Alpha Vantage", retrieved, source_timestamp=retrieved.isoformat(), ttl=6 * 3600)
        return output

    async def _earnings_calendar(self) -> list[EarningsEvent]:
        cached = self._cached(self.EARNINGS_KEY, 24 * 3600)
        if cached is not None:
            try:
                return [EarningsEvent.model_validate(row) for row in cached]
            except (ValidationError, TypeError):
                pass
        response = await self._request({"function": "EARNINGS_CALENDAR", "horizon": "3month"})
        retrieved = self._clock()
        try:
            reader = csv.DictReader(io.StringIO(response.text.lstrip("\ufeff")))
            if not {"symbol", "name", "reportDate", "fiscalDateEnding", "estimate", "currency"}.issubset(
                reader.fieldnames or []
            ):
                raise ValueError("unexpected calendar columns")
            events = []
            for index, row in enumerate(reader):
                if index >= 30000:
                    raise ValueError("unbounded calendar")
                raw_symbol = row["symbol"].strip().upper()
                # Calendar can include securities outside the supported US ticker syntax.
                if not re.fullmatch(r"[A-Z][A-Z0-9.\-]{0,9}", raw_symbol):
                    continue
                report_date = date.fromisoformat(row["reportDate"])
                events.append(
                    EarningsEvent(
                        symbol=raw_symbol,
                        company=clean_text(row["name"]),
                        report_date=report_date,
                        fiscal_date_ending=date.fromisoformat(row["fiscalDateEnding"])
                        if row["fiscalDateEnding"]
                        else None,
                        estimate=Decimal(row["estimate"]) if row["estimate"] else None,
                        currency=clean_text(row["currency"], 8) or None,
                        source=Provenance(
                            provider="Alpha Vantage earnings calendar",
                            url="https://www.alphavantage.co/documentation/#earnings-calendar",
                            retrieved_at=retrieved,
                            reporting_period=row["fiscalDateEnding"] or None,
                            raw_value={key: clean_text(value or "", 200) for key, value in row.items() if key},
                            normalized_value=report_date.isoformat(),
                            description="Expected earnings date; not a company-confirmed event or proof of complete coverage.",
                        ),
                    )
                )
        except (ValidationError, ValueError, TypeError, KeyError, ArithmeticError, AttributeError):
            raise ProviderError("invalid_response", "Alpha Vantage returned an invalid earnings calendar.") from None
        self.cache[self.EARNINGS_KEY] = cache_record([e.model_dump(mode="json") for e in events],
            "Alpha Vantage", retrieved, source_timestamp=retrieved.date().isoformat(), ttl=86400)
        return events

    async def exchange_rate(self) -> FxRate:
        cached = self._cached(self.FX_KEY, 3600)
        if cached is not None:
            try:
                return FxRate.model_validate(cached)
            except (ValidationError, TypeError):
                pass
        response = await self._request(
            {"function": "CURRENCY_EXCHANGE_RATE", "from_currency": "EUR", "to_currency": "USD"}
        )
        retrieved = self._clock()
        try:
            row = response.json()["Realtime Currency Exchange Rate"]
            if (
                row["1. From_Currency Code"] != "EUR"
                or row["3. To_Currency Code"] != "USD"
                or row["7. Time Zone"] != "UTC"
            ):
                raise ValueError("wrong currency pair or timezone")
            timestamp = datetime.fromisoformat(row["6. Last Refreshed"]).replace(tzinfo=timezone.utc)
            if (timestamp - retrieved).total_seconds() > 60:
                raise ValueError("future FX timestamp")
            result = FxRate(
                from_currency="EUR",
                to_currency="USD",
                rate=Decimal(row["5. Exchange Rate"]),
                timestamp=timestamp,
                source=Provenance(
                    provider="Alpha Vantage FX",
                    url="https://www.alphavantage.co/documentation/#currency-exchange",
                    retrieved_at=retrieved,
                    published_at=timestamp,
                    raw_value=row,
                    normalized_value=row["5. Exchange Rate"],
                    description="Indicative USD per EUR rate; a recorded broker fill can use a different execution rate.",
                ),
            )
        except (ValidationError, ValueError, TypeError, KeyError, ArithmeticError):
            raise ProviderError("invalid_response", "Alpha Vantage returned an invalid EUR/USD rate.") from None
        self.cache[self.FX_KEY] = {"retrieved_at": retrieved.isoformat(), "data": result.model_dump(mode="json")}
        return result


class FXProvider(Protocol):
    async def exchange_rate(self) -> FxRate: ...


class BackupMarketDataProvider(MarketDataProvider, Protocol):
    pass
