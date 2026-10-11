"""Persist point-in-time SEC facts for repeatable research and backtests."""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "fundamental_observations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("cik", sa.String(10), nullable=False),
        sa.Column("concept", sa.String(200), nullable=False),
        sa.Column("value", sa.String(80), nullable=False),
        sa.Column("unit", sa.String(80), nullable=False),
        sa.Column("period_start", sa.Date, nullable=True),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("filed_on", sa.Date, nullable=False),
        sa.Column("accession", sa.String(24), nullable=False),
        sa.Column("form", sa.String(20), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_url", sa.Text, nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
    )
    for column in ("fingerprint", "symbol", "cik", "concept", "filed_on", "accession", "available_at"):
        op.create_index(f"ix_fundamental_observations_{column}", "fundamental_observations", [column])
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text('ALTER TABLE waypoint."fundamental_observations" ENABLE ROW LEVEL SECURITY'))
        bind.execute(sa.text('REVOKE ALL ON TABLE waypoint."fundamental_observations" FROM PUBLIC'))
        for role in ("anon", "authenticated"):
            bind.execute(sa.text(
                f'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'{role}\') '
                f'THEN REVOKE ALL ON TABLE waypoint."fundamental_observations" FROM {role}; END IF; END $$;'
            ))


def downgrade():
    op.drop_table("fundamental_observations")
