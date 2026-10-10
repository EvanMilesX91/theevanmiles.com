"""Persist first-seen news and filing observations for daily monitoring."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "news_articles",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("fingerprint", sa.String(64), nullable=False, unique=True),
        sa.Column("symbol", sa.String(12), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("sentiment", sa.Float, nullable=False, server_default="0"),
        sa.Column("importance", sa.Float, nullable=False, server_default="0"),
        sa.Column("is_major", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("data", sa.JSON, nullable=False),
    )
    for column in ("fingerprint", "symbol", "provider", "published_at", "first_seen_at", "available_at", "event_type", "is_major"):
        op.create_index(f"ix_news_articles_{column}", "news_articles", [column])
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text('ALTER TABLE waypoint."news_articles" ENABLE ROW LEVEL SECURITY'))
        bind.execute(sa.text('REVOKE ALL ON TABLE waypoint."news_articles" FROM PUBLIC'))
        for role in ("anon", "authenticated"):
            bind.execute(sa.text(f'DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = \'{role}\') THEN REVOKE ALL ON TABLE waypoint."news_articles" FROM {role}; END IF; END $$;'))


def downgrade():
    op.drop_table("news_articles")
