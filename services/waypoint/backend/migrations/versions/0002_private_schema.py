"""Keep the hosted ledger out of public Data API access.

SQLite remains unchanged. PostgreSQL deployments must use the dedicated waypoint
schema (set by migrations/env.py). The backend database role owns the tables and
bypasses RLS; no policies grant public/anonymous/authenticated API users access.
"""

from alembic import op
from sqlalchemy import text

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    bind.execute(text("REVOKE ALL ON SCHEMA waypoint FROM PUBLIC"))
    bind.execute(text("REVOKE ALL ON ALL TABLES IN SCHEMA waypoint FROM PUBLIC"))
    bind.execute(text("REVOKE ALL ON ALL SEQUENCES IN SCHEMA waypoint FROM PUBLIC"))
    for table in ("settings", "trades", "analyses", "alerts", "equity", "shadow", "alembic_version"):
        bind.execute(text(f'ALTER TABLE waypoint."{table}" ENABLE ROW LEVEL SECURITY'))
    # The named Supabase roles do not exist on ordinary local PostgreSQL installations.
    bind.execute(
        text("""
        DO $$ DECLARE target_role text; BEGIN
          FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
              EXECUTE format('REVOKE ALL ON SCHEMA waypoint FROM %I', target_role);
              EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA waypoint FROM %I', target_role);
              EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA waypoint FROM %I', target_role);
              EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA waypoint REVOKE ALL ON TABLES FROM %I', target_role);
              EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA waypoint REVOKE ALL ON SEQUENCES FROM %I', target_role);
            END IF;
          END LOOP;
        END $$;
    """)
    )
    bind.execute(text("ALTER DEFAULT PRIVILEGES IN SCHEMA waypoint REVOKE ALL ON TABLES FROM PUBLIC"))
    bind.execute(text("ALTER DEFAULT PRIVILEGES IN SCHEMA waypoint REVOKE ALL ON SEQUENCES FROM PUBLIC"))


def downgrade():
    # Downgrading must not make financial records publicly readable.
    pass
