"""Persist minute-level market observations from the live stream."""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "market_observations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", sa.String(12), nullable=False),
        sa.Column("price", sa.Float, nullable=False),
        sa.Column("bid", sa.Float),
        sa.Column("ask", sa.Float),
        sa.Column("volume", sa.Float),
        sa.Column("source", sa.String(40), nullable=False, server_default="alpaca_iex"),
        sa.Column("data", sa.JSON, nullable=False),
    )
    for column in ("symbol", "mode", "observed_at"):
        op.create_index(f"ix_market_observations_{column}", "market_observations", [column])
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text('ALTER TABLE waypoint."market_observations" ENABLE ROW LEVEL SECURITY'))
        bind.execute(sa.text('REVOKE ALL ON TABLE waypoint."market_observations" FROM PUBLIC'))
        for role in ("anon", "authenticated"):
            bind.execute(sa.text(
                f'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'{role}\') '
                f'THEN REVOKE ALL ON TABLE waypoint."market_observations" FROM {role}; END IF; END $$;'
            ))


def downgrade():
    op.drop_table("market_observations")
