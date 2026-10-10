from alembic import context
from sqlalchemy import text

from app.config import config
from app.db import database_engine
from app.models import Base

target_metadata = Base.metadata
url = context.config.attributes.get("url", config.database_url)
if context.is_offline_mode():
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = database_engine(url, migrations=True)
    with engine.begin() as connection:
        postgres = connection.dialect.name == "postgresql"
        if postgres:
            connection.execute(text("SET LOCAL lock_timeout = '20000ms'"))
            connection.execute(text("SELECT pg_advisory_xact_lock(782347102015)"))
            connection.execute(text("CREATE SCHEMA IF NOT EXISTS waypoint"))
            connection.execute(text("SET LOCAL search_path TO waypoint"))
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="waypoint" if postgres else None,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
