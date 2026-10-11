"""Daily, auditable news and filing collection.

The collector is deliberately separate from trade scoring. It records what was
available and when it was first seen; the deterministic engine decides later
whether an event is relevant. Historical ML snapshots never read this table
unless the article's availability timestamp is before the snapshot timestamp.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import NewsArticle

POSITIVE = {"beat", "beats", "growth", "approval", "contract", "award", "upgrade", "profit", "surge", "record", "strong"}
NEGATIVE = {"miss", "misses", "decline", "lawsuit", "offering", "downgrade", "loss", "cut", "probe", "recall", "weak", "fraud"}
MAJOR_EVENTS = {
    "earnings": ("earnings", "results", "quarterly"),
    "guidance": ("guidance", "outlook", "forecast"),
    "offering": ("offering", "dilution", "secondary shares", "convertible"),
    "merger": ("merger", "acquisition", "acquire", "takeover"),
    "contract": ("contract", "award", "partnership"),
    "regulatory": ("fda", "approval", "regulator", "regulatory"),
    "legal": ("lawsuit", "investigation", "probe", "fraud", "recall"),
    "leadership": ("ceo", "cfo", "resigns", "resignation", "appoints"),
    "insider": ("insider", "form 4", "director buys", "director sells"),
}

SOURCE_TIERS = {
    "sec": ("primary", True),
    "alpaca": ("verified", True),
    "alpha_vantage": ("verified", True),
    "gdelt": ("discovery", False),
    # Codex-curated records are useful research evidence, but remain
    # unverified until the source and point-in-time availability are checked.
    "codex": ("research", False),
}


def _utc(value: Any, fallback: datetime) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except (TypeError, ValueError):
        return fallback


def classify_title(title: str) -> dict[str, Any]:
    clean = " ".join(str(title or "").split())[:1000]
    lowered = clean.lower()
    words = set(re.findall(r"[a-z]+", lowered))
    positive = len(words & POSITIVE)
    negative = len(words & NEGATIVE)
    sentiment = (positive - negative) / max(1, positive + negative)
    event_type = "general"
    for candidate, phrases in MAJOR_EVENTS.items():
        if any(phrase in lowered for phrase in phrases):
            event_type = candidate
            break
    importance = 1.0 if event_type != "general" else 0.25
    return {
        "title": clean,
        "event_type": event_type,
        "sentiment": float(sentiment),
        "importance": importance,
        "is_major": event_type != "general" or abs(sentiment) >= 0.75,
    }


def fingerprint(*, provider: str, symbol: str, title: str, url: str, published_at: datetime) -> str:
    # Canonicalise URLs before hashing so trailing slashes, fragments and
    # host casing cannot create a second observation for the same release.
    parsed = urlsplit(url.strip())
    canonical_url = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), parsed.query, ""))
    canonical_title = " ".join(title.strip().lower().split())
    basis = "|".join((provider.lower(), symbol.upper(), canonical_url, canonical_title, published_at.isoformat()))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _observation_keys(row: dict[str, Any] | NewsArticle) -> tuple[tuple[str, str, str], tuple[str, str, str, str]]:
    """Return URL and title/date keys used to catch replayed research records.

    The fingerprint remains the immutable database identity. These secondary
    keys also catch older rows created before URL canonicalisation and issuer
    releases represented once as an IR page and once as a PDF link.
    """
    provider = str(row["provider"] if isinstance(row, dict) else row.provider).lower()
    symbol = str(row["symbol"] if isinstance(row, dict) else row.symbol).upper()
    url = str(row["url"] if isinstance(row, dict) else row.url).strip()
    parsed = urlsplit(url)
    canonical_url = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/"), parsed.query, ""))
    title = str(row["title"] if isinstance(row, dict) else row.title)
    normalized_title = " ".join(title.lower().split())
    published = row["published_at"] if isinstance(row, dict) else row.published_at
    published_key = _utc(published, datetime.now(UTC)).date().isoformat()
    return (provider, symbol, canonical_url), (provider, symbol, normalized_title, published_key)


def _candidate(*, provider: str, symbol: str, title: str, url: str,
               published_at: datetime, first_seen_at: datetime, data: dict[str, Any] | None = None) -> dict[str, Any]:
    published = _utc(published_at, first_seen_at)
    details = classify_title(title)
    source_tier, verified = SOURCE_TIERS.get(provider, ("discovery", False))
    return {
        "fingerprint": fingerprint(provider=provider, symbol=symbol, title=details["title"], url=url, published_at=published),
        "symbol": symbol.upper(), "provider": provider, "source_tier": source_tier,
        "verified": verified, "title": details["title"],
        "url": url if str(url).startswith("https://") else "https://gdeltproject.org/",
        "published_at": published, "first_seen_at": first_seen_at,
        "available_at": first_seen_at, "event_type": details["event_type"],
        "sentiment": details["sentiment"], "importance": details["importance"],
        "is_major": details["is_major"], "data": data or {},
    }


def candidates_from_filings(research: dict[str, Any], now: datetime) -> list[dict[str, Any]]:
    """Turn already-fetched SEC filing metadata into deduplicated observations."""
    rows: list[dict[str, Any]] = []
    for symbol, record in research.items():
        for filing in record.get("filings", []) if isinstance(record, dict) else []:
            filed = _utc(filing.get("accepted_at") or filing.get("filed_on"), now)
            url = str(filing.get("source", {}).get("url", ""))
            title = f"{filing.get('form', 'SEC filing')}: {filing.get('description', '')}".strip()
            rows.append(_candidate(provider="sec", symbol=symbol, title=title, url=url,
                                   published_at=filed, first_seen_at=now,
                                   data={"form": filing.get("form"), "accession": filing.get("accession")}))
    return rows


def candidates_from_codex(records: Iterable[dict[str, Any]], now: datetime | None = None) -> list[dict[str, Any]]:
    """Normalize Codex-researched historical news into immutable observations.

    Records must carry a source URL and a publication date. ``available_at``
    is deliberately explicit: it is the earliest time the item could have
    been known to the engine, which prevents a page retrieved today from
    silently becoming historical training data.
    """
    observed = (now or datetime.now(UTC)).astimezone(UTC)
    rows: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        symbol = str(record.get("symbol", "")).strip().upper()
        title = str(record.get("title", "")).strip()
        url = str(record.get("url", "")).strip()
        published = record.get("published_at") or record.get("event_date")
        if not symbol or not title or not url.startswith("https://") or not published:
            continue
        first_seen = _utc(record.get("retrieved_at"), observed)
        available = _utc(record.get("available_at") or published, first_seen)
        # Availability cannot be later than retrieval, but it may be earlier
        # when the source gives a reliable publication timestamp.
        available = min(available, first_seen)
        row = _candidate(provider="codex", symbol=symbol, title=title, url=url,
                         published_at=published, first_seen_at=first_seen,
                         data={
                             "source_type": "codex_web_research",
                             "review_status": str(record.get("review_status", "needs_review")),
                             "source_name": str(record.get("source_name", "")),
                             "availability_basis": str(record.get("availability_basis", "published_at")),
                             "summary": str(record.get("summary", ""))[:2000],
                             "original": record,
                         })
        row["available_at"] = available
        rows.append(row)
    return rows


async def _gdelt(symbols: list[str], since: datetime, now: datetime) -> list[dict[str, Any]]:
    """Fetch a bounded discovery window from GDELT's public DOC API.

    GDELT is a discovery source, not a verified issuer feed. Its observed time
    is treated as availability, and raw results are stored for review.
    """
    if not symbols:
        return []
    terms = " OR ".join(f'"{symbol}"' for symbol in symbols[:30])
    params = {
        "query": f"({terms})", "mode": "ArtList", "maxrecords": "250", "format": "json",
        "sort": "HybridRel", "startdatetime": since.strftime("%Y%m%d%H%M%S"),
        "enddatetime": now.strftime("%Y%m%d%H%M%S"),
    }
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
            response = await client.get("https://api.gdeltproject.org/api/v2/doc/doc", params=params)
            if response.status_code != 200:
                return []
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return []
    rows = payload.get("articles", []) if isinstance(payload, dict) else []
    output: list[dict[str, Any]] = []
    symbol_lookup = {symbol.upper() for symbol in symbols}
    for item in rows if isinstance(rows, list) else []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        url = str(item.get("url", "")).strip()
        if not title or not url.startswith("https://"):
            continue
        seen = str(item.get("seendate", ""))
        try:
            observed = datetime.strptime(seen[:14], "%Y%m%d%H%M%S").replace(tzinfo=UTC)
        except ValueError:
            observed = now
        observed = max(since, min(observed, now))
        # GDELT does not provide a reliable ticker map. Require a symbol token
        # in the headline before attaching an article to an issuer.
        upper_title = title.upper()
        for symbol in symbol_lookup:
            if re.search(rf"(?<![A-Z0-9]){re.escape(symbol)}(?![A-Z0-9])", upper_title):
                output.append(_candidate(provider="gdelt", symbol=symbol, title=title, url=url,
                                         published_at=observed, first_seen_at=now,
                                         data={"domain": item.get("domain"), "language": item.get("language"), "observed_at": observed.isoformat()}))
    return output


async def collect_candidates(*, symbols: Iterable[str], market: Any, alpha: Any = None, now: datetime | None = None,
                             since_hours: int = 36, include_gdelt: bool = True) -> list[dict[str, Any]]:
    """Collect current observations without touching the database or scoring."""
    now = (now or datetime.now(UTC)).astimezone(UTC)
    symbols = list(dict.fromkeys(str(s).strip().upper() for s in symbols if str(s).strip()))
    since = now - timedelta(hours=since_hours)
    rows: list[dict[str, Any]] = []
    if market is not None and symbols:
        try:
            for item in await market.news(symbols, since):
                source = item.source.model_dump(mode="json") if hasattr(item.source, "model_dump") else {}
                rows.extend(_candidate(provider="alpaca", symbol=symbol, title=item.title,
                                       url=str(source.get("url", "")), published_at=item.published_at,
                                       first_seen_at=now, data={"source": source}) for symbol in item.symbols)
        except Exception:
            # News is optional evidence and must never interrupt price monitoring.
            pass
    if alpha is not None and symbols:
        try:
            for item in await alpha.news_sentiment(symbols, since, now):
                source = item.source.model_dump(mode="json") if hasattr(item.source, "model_dump") else {}
                rows.extend(_candidate(provider="alpha_vantage", symbol=symbol, title=item.title,
                                       url=str(source.get("url", "")), published_at=item.published_at,
                                       first_seen_at=now, data={"source": source}) for symbol in item.symbols)
        except Exception:
            # Alpha Vantage may restrict NEWS_SENTIMENT on free plans.
            pass
    if include_gdelt:
        rows.extend(await _gdelt(symbols, since, now))
    unique: dict[str, dict[str, Any]] = {}
    for row in rows:
        unique[row["fingerprint"]] = row
    return list(unique.values())


def persist_candidates(db: Session, rows: Iterable[dict[str, Any]]) -> int:
    """Insert only unseen observations; existing records are immutable.

    Deduplication is performed by fingerprint plus canonical URL and by
    provider/symbol/title/publication-day. This prevents repeated Codex batches
    from inserting the same issuer release when a source changes its URL
    formatting or when both an IR page and its attached PDF are collected.
    """
    pending = list(rows)
    if not pending:
        return 0
    unique: dict[str, dict[str, Any]] = {}
    seen_urls: set[tuple[str, str, str]] = set()
    seen_title_dates: set[tuple[str, str, str, str]] = set()
    for row in pending:
        if not row.get("fingerprint"):
            continue
        url_key, title_date_key = _observation_keys(row)
        if row["fingerprint"] in unique or url_key in seen_urls or title_date_key in seen_title_dates:
            continue
        unique[row["fingerprint"]] = row
        seen_urls.add(url_key)
        seen_title_dates.add(title_date_key)
    pending = list(unique.values())
    if not pending:
        return 0
    fingerprints = list(unique)
    existing: set[str] = set()
    for offset in range(0, len(fingerprints), 500):
        chunk = fingerprints[offset:offset + 500]
        existing.update(db.scalars(select(NewsArticle.fingerprint).where(NewsArticle.fingerprint.in_(chunk))).all())
    # Secondary lookup catches rows written with the pre-canonicalisation
    # fingerprint, and is bounded to the providers/symbols in this import.
    providers = {str(row["provider"]) for row in pending}
    symbols = {str(row["symbol"]).upper() for row in pending}
    prior = db.scalars(select(NewsArticle).where(NewsArticle.provider.in_(providers), NewsArticle.symbol.in_(symbols))).all()
    prior_urls: set[tuple[str, str, str]] = set()
    prior_title_dates: set[tuple[str, str, str, str]] = set()
    for row in prior:
        url_key, title_date_key = _observation_keys(row)
        prior_urls.add(url_key)
        prior_title_dates.add(title_date_key)
    fresh = [
        row for row in pending
        if row["fingerprint"] not in existing
        and _observation_keys(row)[0] not in prior_urls
        and _observation_keys(row)[1] not in prior_title_dates
    ]
    if fresh:
        db.add_all(NewsArticle(**row) for row in fresh)
    return len(fresh)


def recent_articles(db: Session, *, symbol: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query = select(NewsArticle).order_by(NewsArticle.published_at.desc(), NewsArticle.id.desc()).limit(max(1, min(limit, 250)))
    if symbol:
        query = query.where(NewsArticle.symbol == symbol.upper())
    return [
        {"symbol": row.symbol, "provider": row.provider, "title": row.title, "url": row.url,
         "source_tier": row.source_tier, "verified": row.verified,
         "published_at": row.published_at.isoformat(), "first_seen_at": row.first_seen_at.isoformat(),
         "event_type": row.event_type, "sentiment": row.sentiment, "importance": row.importance,
         "is_major": row.is_major, "data": row.data}
        for row in db.scalars(query).all()
    ]
