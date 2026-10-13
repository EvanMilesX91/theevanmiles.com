import os
import re
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_FILE_ROOT = Path(__file__).resolve()
# In the source tree the app lives at services/waypoint/backend/app, while
# the Docker image copies that package to /app/app. Resolve the data/config
# root from the layout that actually exists so mounted datasets and the model
# registry are available in both environments.
_CONTAINER_ROOT = _FILE_ROOT.parents[1]
ROOT = _CONTAINER_ROOT if (_CONTAINER_ROOT / "data").exists() else _FILE_ROOT.parents[2]


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
    # Optional broader pre-market scan universe. It is combined with LIVE_SYMBOLS.
    scan_symbols: str = ""
    # Smaller or less-followed candidates are kept in a separate exploration lane.
    discovery_symbols: str = ""
    auto_discovery_enabled: bool = True
    discovery_batch_size: int = Field(default=10, ge=1, le=50)
    scheduler_enabled: bool = True
    max_hot_symbols: int = Field(default=30, ge=1, le=30)
    price_stale_seconds: float = Field(default=30, ge=2, le=90)
    stream_enabled: bool = True
    stream_publish_seconds: float = Field(default=0.5, ge=0.1, le=5)
    stream_checkpoint_seconds: float = Field(default=30, ge=10, le=300)
    warm_refresh_minutes: int = Field(default=15, ge=5, le=60)
    # Slow research is committed in small batches so the dashboard can show
    # useful progress and keep serving the last completed snapshot.
    research_batch_size: int = Field(default=2, ge=1, le=25)
    alpha_vantage_daily_limit: int = Field(default=25, ge=1, le=25)
    # Keep a portion of the free allowance for the rotating historical
    # earnings archive; optional news must yield when the reserve is reached.
    # Keep enough free-plan calls for one earnings calendar request plus a
    # rotating set of historical earnings observations each day.
    alpha_vantage_history_reserve: int = Field(default=11, ge=1, le=24)
    # GDELT is a broad discovery feed; it is stored as unverified evidence and
    # never treated as proof that an issuer made an announcement.
    # GDELT is discovery-only and cannot influence deterministic decisions;
    # enable collection by default so the archive grows without extra setup.
    news_gdelt_enabled: bool = True
    news_collection_interval_minutes: int = Field(default=60, ge=15, le=1440)
    sec_archive_interval_hours: int = Field(default=24, ge=1, le=168)
    morning_refresh_hour: int = Field(default=9, ge=0, le=23)
    # ML is optional, offline-first, and shadow-only until explicitly enabled.
    ml_enabled: bool = False
    ml_shadow_mode: bool = True
    ml_influence_enabled: bool = False
    ml_registry_path: str = "data/ml_registry.json"
    # Every candidate, including rejected candidates, is kept in this audit log.
    ml_experiments_path: str = "data/ml_experiments.json"
    ml_dataset_path: str = "data/ml_snapshots.jsonl"
    ml_snapshot_limit: int = Field(default=10000, ge=100, le=100000)
    ml_prediction_limit: int = Field(default=5000, ge=100, le=50000)
    historical_projection_enabled: bool = True
    historical_projection_top_n: int = Field(default=50, ge=25, le=250)
    # Bound synchronous dashboard work; the full labelled file remains available
    # to offline training and can be sampled again on the next refresh.
    historical_projection_runtime_rows: int = Field(default=100, ge=25, le=5000)
    # Keep the live dashboard responsive while still showing projections for
    # the core watchlist and a small rotating discovery sample. Offline
    # training continues to use the complete archive.
    historical_projection_max_symbols: int = Field(default=8, ge=1, le=100)
    historical_projection_cache_seconds: int = Field(default=300, ge=5, le=3600)
    # Offline ML maintenance is deliberately opt-in and never activates a candidate model.
    ml_maintenance_enabled: bool = False
    ml_maintenance_interval_hours: int = Field(default=168, ge=1, le=8760)
    ml_ingest_years: int = Field(default=5, ge=1, le=20)
    ml_ingest_stride_days: int = Field(default=5, ge=1, le=60)

    @field_validator("live_symbols")
    @classmethod
    def valid_live_symbols(cls, value: str) -> str:
        symbols = list(dict.fromkeys(symbol.strip().upper() for symbol in value.split(",") if symbol.strip()))
        if not 1 <= len(symbols) <= 100 or any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", s) for s in symbols):
            raise ValueError("LIVE_SYMBOLS must contain 1 to 100 ordinary share symbols separated by commas.")
        return ",".join(symbols)

    @field_validator("scan_symbols")
    @classmethod
    def valid_scan_symbols(cls, value: str) -> str:
        if not value.strip():
            return ""
        symbols = list(dict.fromkeys(symbol.strip().upper() for symbol in value.split(",") if symbol.strip()))
        if len(symbols) > 100 or any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", s) for s in symbols):
            raise ValueError("SCAN_SYMBOLS must contain up to 100 ordinary share symbols separated by commas.")
        return ",".join(symbols)

    @field_validator("discovery_symbols")
    @classmethod
    def valid_discovery_symbols(cls, value: str) -> str:
        if not value.strip():
            return ""
        symbols = list(dict.fromkeys(symbol.strip().upper() for symbol in value.split(",") if symbol.strip()))
        if len(symbols) > 100 or any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,11}", s) for s in symbols):
            raise ValueError("DISCOVERY_SYMBOLS must contain up to 100 ordinary share symbols separated by commas.")
        return ",".join(symbols)

    @model_validator(mode="after")
    def hosted_defaults(self) -> "Config":
        # A mistaken environment flag must never start a daemon or migrate on a cold start.
        if os.getenv("VERCEL"):
            self.runtime_mode = "serverless"
        if self.runtime_mode == "serverless":
            self.auto_migrate = False
            self.scheduler_enabled = False
            self.stream_enabled = False
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
