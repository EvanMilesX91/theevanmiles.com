from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Setting(Base):
    __tablename__ = "settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)


class Trade(Base):
    __tablename__ = "trades"
    id: Mapped[int] = mapped_column(primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(100), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    side: Mapped[str] = mapped_column(String(4))
    mode: Mapped[str] = mapped_column(String(10), index=True)
    # Decimal strings preserve exact inputs across SQLite and PostgreSQL.
    price_usd: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[str] = mapped_column(String(64))
    amount_eur: Mapped[str] = mapped_column(String(64))
    fee_eur: Mapped[str] = mapped_column(String(64))
    fx_usd_per_eur: Mapped[str] = mapped_column(String(64))
    realized_pnl_eur: Mapped[str] = mapped_column(String(64), default="0")
    executed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str] = mapped_column(Text, default="")
    model_version: Mapped[str] = mapped_column(String(30))
    entry_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)


class Analysis(Base):
    __tablename__ = "analyses"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    mode: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    model_version: Mapped[str] = mapped_column(String(30))
    data: Mapped[dict[str, Any]] = mapped_column(JSON)


class MarketObservation(Base):
    """Bounded minute-level observations captured from the live market stream."""

    __tablename__ = "market_observations"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    mode: Mapped[str] = mapped_column(String(10), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    event_type: Mapped[str] = mapped_column(String(12))
    price: Mapped[float] = mapped_column(Float)
    bid: Mapped[float | None] = mapped_column(Float, nullable=True)
    ask: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(40), default="alpaca_iex")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(12))
    mode: Mapped[str] = mapped_column(String(10))
    state: Mapped[str] = mapped_column(String(30))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Equity(Base):
    __tablename__ = "equity"
    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String(10), index=True)
    total_eur: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Shadow(Base):
    __tablename__ = "shadow"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    status: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ticks: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)


class NewsArticle(Base):
    """Immutable first-seen record for a sourced news or filing observation."""

    __tablename__ = "news_articles"
    id: Mapped[int] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    # Source tier is explicit so the UI and later models can distinguish
    # issuer/regulator evidence from broker feeds and broad discovery hits.
    source_tier: Mapped[str] = mapped_column(String(20), index=True, default="discovery")
    verified: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    title: Mapped[str] = mapped_column(Text)
    url: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    sentiment: Mapped[float] = mapped_column(Float, default=0.0)
    importance: Mapped[float] = mapped_column(Float, default=0.0)
    is_major: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)


class FundamentalObservation(Base):
    """Immutable SEC fact with the date it became available to the engine."""

    __tablename__ = "fundamental_observations"
    id: Mapped[int] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    symbol: Mapped[str] = mapped_column(String(12), index=True)
    cik: Mapped[str] = mapped_column(String(10), index=True)
    concept: Mapped[str] = mapped_column(String(200), index=True)
    value: Mapped[str] = mapped_column(String(80))
    unit: Mapped[str] = mapped_column(String(80))
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date] = mapped_column(Date)
    filed_on: Mapped[date] = mapped_column(Date, index=True)
    accession: Mapped[str] = mapped_column(String(24), index=True)
    form: Mapped[str] = mapped_column(String(20))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source_url: Mapped[str] = mapped_column(Text)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
