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
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from collections.abc import Callable, MutableMapping
from typing import Any, Literal, Protocol
from urllib.parse import quote as urlquote

import httpx
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
    def __init__(self, client: httpx.AsyncClient | None = None, min_interval: float = 0):
        self._client = client or httpx.AsyncClient(timeout=10, follow_redirects=False)
        self._owns_client = client is None
        self._min_interval = min_interval
        self._last_request = 0.0
        self._lock = asyncio.Lock()

    async def aclose(self):
        if self._owns_client:
            await self._client.aclose()

    async def _get(self, url: str, headers: dict, params: dict | None = None) -> dict:
        for attempt in range(3):
            async with self._lock:
                delay = self._min_interval - (time.monotonic() - self._last_request)
                if delay > 0:
                    await asyncio.sleep(delay)
                self._last_request = time.monotonic()
                try:
                    response = await self._client.get(url, headers=headers, params=params)
                except httpx.RequestError:
                    response = None
            if response is not None and response.status_code == 200:
                try:
                    payload = response.json()
                    if not isinstance(payload, dict):
                        raise ValueError("not an object")
                    return payload
                except (ValueError, TypeError):
                    raise ProviderError("invalid_response", "Provider returned invalid data.") from None
            status = response.status_code if response is not None else 0
            if status in (401, 403):
                raise ProviderError("access_denied", "Provider access denied; check credentials or feed access.")
            if status and status != 429 and status < 500:
                raise ProviderError("request_failed", "Provider request could not be completed.")
            if attempt < 2:
                delay = 0.25 * (2**attempt)
                if response is not None:
                    try:
                        delay = max(delay, float(response.headers.get("Retry-After", "0")))
                    except ValueError:
                        pass
                # Do not retry earlier than a long requested backoff. Let the
                # scheduler retry later instead of tying up an HTTP worker.
                if delay > 5:
                    raise ProviderError("rate_limited", "Provider rate limit reached; try again later.")
                await asyncio.sleep(delay)
        code = "rate_limited" if status == 429 else "unavailable"
        raise ProviderError(code, "Provider temporarily unavailable; existing data must be marked stale.")


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

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        api_key: str | None = None,
        secret_key: str | None = None,
        feed: Literal["iex", "sip"] = "iex",
    ):
        key = api_key or os.getenv("APCA_API_KEY_ID")
        secret = secret_key or os.getenv("APCA_API_SECRET_KEY")
        if not key or not secret:
            raise ProviderError("not_configured", "Alpaca credentials are not configured.")
        if feed not in ("iex", "sip"):
            raise ValueError("unsupported market feed")
        super().__init__(client, min_interval=0.35)
        self._headers = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}
        self.feed = feed

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

    async def historical_bars(
        self,
        symbol: str,
        start: datetime,
        end: datetime,
        *,
        feed: Literal["iex", "sip"] | None = None,
        adjustment: Literal["raw", "split"] = "raw",
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
            "timeframe": "1Day",
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
                                description=f"Daily OHLCV, adjustment={adjustment}; bar timestamp is its start, not availability time.",
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

    def __init__(self, client: httpx.AsyncClient | None = None, user_agent: str | None = None):
        identifier: str = user_agent or os.getenv("SEC_USER_AGENT") or ""
        if "@" not in identifier or "\n" in identifier or "\r" in identifier:
            raise ProviderError("not_configured", "Set SEC_USER_AGENT to an application name and contact email.")
        super().__init__(client, min_interval=0.21)
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

    async def fundamentals(self, cik: str, as_of: date | None = None) -> Fundamentals:
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
            for concept, value in parsed.facts.get("us-gaap", {}).items():
                for unit, observations in value.units.items():
                    for row in observations:
                        # A date-only filed value does not prove availability
                        # during that same day. Exclude it until the next date.
                        if row.filed >= cutoff or row.end > cutoff:
                            continue
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
    FX_KEY = "alpha_vantage_fx_eur_usd"

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        api_key: str | None = None,
        cache: MutableMapping[str, Any] | None = None,
        clock: Callable[[], datetime] | None = None,
    ):
        key = api_key or os.getenv("ALPHA_VANTAGE_API_KEY")
        if not key:
            raise ProviderError("not_configured", "Alpha Vantage credentials are not configured.")
        super().__init__(client)
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
        async with self._lock:
            today = self._clock().astimezone(timezone.utc).date().isoformat()
            budget = self.cache.get(self.BUDGET_KEY, {})
            if not isinstance(budget, dict):
                raise ProviderError("invalid_cache", "The persisted Alpha Vantage request budget is invalid.")
            calls = budget.get("calls", 0) if budget.get("day") == today else 0
            if not isinstance(calls, int) or isinstance(calls, bool) or calls < 0:
                raise ProviderError("invalid_cache", "The persisted Alpha Vantage request budget is invalid.")
            if calls >= 25:
                raise ProviderError("daily_limit", "Alpha Vantage's 25-request daily budget is exhausted.")
            self.cache[self.BUDGET_KEY] = {"day": today, "calls": calls + 1}
            try:
                response = await self._client.get(self.BASE_URL, params={**params, "apikey": self._api_key})
            except httpx.RequestError:
                raise ProviderError("unavailable", "Alpha Vantage is temporarily unavailable.") from None
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
                raise ProviderError(
                    "provider_rejected", "Alpha Vantage rejected the request; check key, allowance and endpoint access."
                )
        return response

    async def earnings_calendar(self) -> list[EarningsEvent]:
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
        self.cache[self.EARNINGS_KEY] = {
            "retrieved_at": retrieved.isoformat(),
            "data": [e.model_dump(mode="json") for e in events],
        }
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
