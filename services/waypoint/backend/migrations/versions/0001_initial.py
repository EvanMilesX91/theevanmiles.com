"""Initial append-only ledger, analysis snapshots, alerts and shadow signals."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "settings", sa.Column("id", sa.Integer, primary_key=True), sa.Column("data", sa.JSON, nullable=False)
    )
    op.create_table(
        "trades",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("idempotency_key", sa.String(100), nullable=False, unique=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False),
        *[
            sa.Column(name, sa.String(64), nullable=False)
            for name in ("price_usd", "quantity", "amount_eur", "fee_eur", "fx_usd_per_eur", "realized_pnl_eur")
        ],
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.Text, nullable=False),
        sa.Column("model_version", sa.String(30), nullable=False),
        sa.Column("entry_snapshot", sa.JSON, nullable=False),
    )
    for col in ("symbol", "mode", "executed_at"):
        op.create_index(f"ix_trades_{col}", "trades", [col])
    op.create_table(
        "analyses",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_version", sa.String(30), nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
    )
    for col in ("symbol", "created_at"):
        op.create_index(f"ix_analyses_{col}", "analyses", [col])
    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("state", sa.String(30), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_alerts_created_at", "alerts", ["created_at"])
    op.create_table(
        "equity",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("total_eur", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_equity_mode", "equity", ["mode"])
    op.create_table(
        "shadow",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("ticks", sa.Integer, nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
    )
    op.create_index("ix_shadow_symbol", "shadow", ["symbol"])


def downgrade():
    for table in ("shadow", "equity", "alerts", "analyses", "trades", "settings"):
        op.drop_table(table)
