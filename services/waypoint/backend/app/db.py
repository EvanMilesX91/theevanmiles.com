from collections.abc import Iterator
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import config


def database_engine(url: str, *, migrations: bool = False) -> Engine:
    """No connections or filesystem writes at import time; pooler-safe PostgreSQL."""
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgres://")
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        if migrations and parsed.database and parsed.database != ":memory:":
            Path(parsed.database).resolve().parent.mkdir(parents=True, exist_ok=True)
        result = create_engine(url, connect_args={"check_same_thread": False, "timeout": 20}, pool_pre_ping=True)

        @event.listens_for(result, "connect")
        def sqlite_pragmas(connection, record):  # type: ignore[no-untyped-def]
            cursor = connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=20000")
            cursor.close()

        return result
    if parsed.get_backend_name() != "postgresql" or parsed.get_driver_name() != "psycopg":
        raise ValueError("Use SQLite locally or postgresql+psycopg for the hosted database.")
    if parsed.query.get("sslmode") in {"disable", "allow", "prefer"}:
        raise ValueError("PostgreSQL connections must require SSL.")
    connect_args: dict[str, Any] = {"prepare_threshold": None, "connect_timeout": 10}
    if "sslmode" not in parsed.query:
        connect_args["sslmode"] = "require"
    options = {} if migrations else {"schema_translate_map": {None: "waypoint"}}
    return create_engine(parsed, poolclass=NullPool, connect_args=connect_args, execution_options=options)


engine = database_engine(config.database_url)


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
