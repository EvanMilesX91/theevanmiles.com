import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    horizon: Literal["weeks", "months", "years"] = "weeks"
    size: Literal["small", "medium", "large", "none"] = "small"
    shadow_enabled: bool = False
    fx_usd_per_eur: float = Field(default=1.10, gt=0.01, le=1000)
    fx_fee_pct: float = Field(default=0.0015, ge=0, le=0.2)
    fixed_fee_eur: float = Field(default=0, ge=0, le=1000)
    min_order_eur: float = Field(default=1, gt=0, le=10000)


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    horizon: Literal["weeks", "months", "years"] | None = None
    size: Literal["small", "medium", "large", "none"] | None = None
    shadow_enabled: bool | None = None
    fx_usd_per_eur: float | None = Field(default=None, gt=0.01, le=1000)
    fx_fee_pct: float | None = Field(default=None, ge=0, le=0.2)
    fixed_fee_eur: float | None = Field(default=None, ge=0, le=1000)
    min_order_eur: float | None = Field(default=None, gt=0, le=10000)


class TradeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    symbol: str = Field(pattern=r"^[A-Z][A-Z0-9.\-]{0,11}$")
    side: Literal["buy", "sell"]
    mode: Literal["paper", "manual"] = "paper"
    price_usd: Decimal = Field(gt=0, le=1000000, max_digits=20, decimal_places=8)
    amount_eur: Decimal | None = Field(default=None, gt=0, le=1000000, max_digits=20, decimal_places=8)
    quantity: Decimal | None = Field(default=None, gt=0, le=1000000, max_digits=24, decimal_places=12)
    fee_eur: Decimal = Field(default=Decimal("0"), ge=0, le=10000, decimal_places=8)
    fx_usd_per_eur: Decimal = Field(gt=Decimal("0.01"), le=1000, decimal_places=8)
    executed_at: datetime
    notes: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=100, pattern=r"^[\w\-]+$")

    @field_validator("notes")
    @classmethod
    def plain_notes(cls, value: str) -> str:
        return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)

    @field_validator("executed_at")
    @classmethod
    def aware_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Execution time must include a timezone.")
        value = value.astimezone(UTC)
        if value > datetime.now(UTC) + timedelta(minutes=5):
            raise ValueError("Execution time cannot be in the future.")
        return value

    @model_validator(mode="after")
    def validate_side(self):  # type: ignore[no-untyped-def]
        if self.side == "buy" and (self.amount_eur is None or self.quantity is not None):
            raise ValueError("For a buy, supply the amount invested before fees, not quantity.")
        if self.side == "sell" and (self.quantity is None or self.amount_eur is not None):
            raise ValueError("For a sell, supply shares sold, not amount invested.")
        return self


class DemoStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    symbol: str = "RKLB"
    scenario: Literal["entry", "profit", "warning", "exit", "wait"]
