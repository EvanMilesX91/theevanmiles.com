import os
import re
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=None if os.getenv("VERCEL") else ROOT / ".env", extra="ignore")
    app_mode: Literal["demo", "live"] = "demo"
    database_url: str = Field(default=f"sqlite:///{(ROOT / 'data' / 'waypoint.db').as_posix()}", repr=False)
    runtime_mode: Literal["server", "serverless"] = "server"
    auto_migrate: bool = True
    waypoint_service_token: str = Field(default="", repr=False)
    trusted_hosts: str = "localhost,127.0.0.1,testserver"
    frontend_origin: str = "http://localhost:3000"
    tick_seconds: float = Field(default=5, ge=1, le=300)
    apca_api_key_id: str = Field(default="", repr=False)
    apca_api_secret_key: str = Field(default="", repr=False)
    alpha_vantage_api_key: str = Field(default="", repr=False)
    sec_user_agent: str = ""
    live_symbols: str = "AAPL,MSFT"
    scheduler_enabled: bool = True

    @field_validator("live_symbols")
    @classmethod
    def valid_live_symbols(cls, value: str) -> str:
        symbols = list(dict.fromkeys(symbol.strip().upper() for symbol in value.split(",") if symbol.strip()))
        if not 1 <= len(symbols) <= 100 or any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", s) for s in symbols):
            raise ValueError("LIVE_SYMBOLS must contain 1 to 100 ordinary share symbols separated by commas.")
        return ",".join(symbols)

    @model_validator(mode="after")
    def hosted_defaults(self) -> "Config":
        # A mistaken environment flag must never start a daemon or migrate on a cold start.
        if os.getenv("VERCEL"):
            self.runtime_mode = "serverless"
        if self.runtime_mode == "serverless":
            self.auto_migrate = False
            self.scheduler_enabled = False
        return self

    @property
    def hosted(self) -> bool:
        return self.runtime_mode == "serverless" or bool(os.getenv("VERCEL"))

    @property
    def allowed_hosts(self) -> list[str]:
        hosts = [host.strip() for host in self.trusted_hosts.split(",") if host.strip()]
        deployment_host = os.getenv("VERCEL_URL")
        if deployment_host and deployment_host not in hosts:
            hosts.append(deployment_host)
        return hosts


config = Config()
