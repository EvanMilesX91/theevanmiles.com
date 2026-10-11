from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base
from app.news import classify_title, persist_candidates, recent_articles


def test_news_classification_is_deterministic_and_major():
    result = classify_title("Company announces earnings beat and raised guidance")
    assert result["event_type"] == "earnings"
    assert result["is_major"] is True
    assert result["sentiment"] > 0


def test_news_persistence_is_immutable_and_deduplicated():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(engine)
    now = datetime(2026, 10, 10, tzinfo=UTC)
    row = {
        "fingerprint": "a" * 64, "symbol": "AAPL", "provider": "test",
        "title": "AAPL contract award", "url": "https://example.com/aapl",
        "published_at": now, "first_seen_at": now, "available_at": now,
        "event_type": "contract", "sentiment": 1.0, "importance": 1.0,
        "is_major": True, "data": {"fixture": True},
    }
    with sessions() as db:
        assert persist_candidates(db, [row, row]) == 1
        db.commit()
        assert persist_candidates(db, [{**row, "title": "changed"}]) == 0
        article = recent_articles(db, symbol="aapl")[0]
        assert article["title"] == "AAPL contract award"
        assert article["source_tier"] == "discovery"
        assert article["verified"] is False
