"""Track trust tier and verification state for collected news."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("news_articles", sa.Column("source_tier", sa.String(20), nullable=False, server_default="discovery"))
    op.add_column("news_articles", sa.Column("verified", sa.Boolean, nullable=False, server_default=sa.false()))
    op.create_index("ix_news_articles_source_tier", "news_articles", ["source_tier"])
    op.create_index("ix_news_articles_verified", "news_articles", ["verified"])
    bind = op.get_bind()
    # Existing rows can be classified deterministically from their provider.
    bind.execute(sa.text("UPDATE news_articles SET source_tier='primary', verified=TRUE WHERE provider='sec'"))
    bind.execute(sa.text("UPDATE news_articles SET source_tier='verified', verified=TRUE WHERE provider IN ('alpaca', 'alpha_vantage')"))
    bind.execute(sa.text("UPDATE news_articles SET source_tier='discovery', verified=FALSE WHERE provider='gdelt'"))


def downgrade():
    op.drop_index("ix_news_articles_verified", table_name="news_articles")
    op.drop_index("ix_news_articles_source_tier", table_name="news_articles")
    op.drop_column("news_articles", "verified")
    op.drop_column("news_articles", "source_tier")
