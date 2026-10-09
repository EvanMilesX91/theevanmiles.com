from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text
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
