"""Unit tests never inherit personal API credentials or deployment settings."""
import pytest

from app.config import config


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    for name in ('APCA_API_KEY_ID', 'APCA_API_SECRET_KEY', 'ALPHA_VANTAGE_API_KEY', 'SEC_USER_AGENT', 'VERCEL'):
        monkeypatch.delenv(name, raising=False)
    for field in ('apca_api_key_id', 'apca_api_secret_key', 'alpha_vantage_api_key', 'sec_user_agent', 'waypoint_service_token'):
        monkeypatch.setattr(config, field, '')
    monkeypatch.setattr(config, 'scan_symbols', '')
    monkeypatch.setattr(config, 'discovery_symbols', '')
    monkeypatch.setattr(config, 'news_gdelt_enabled', False)
    monkeypatch.setattr(config, 'runtime_mode', 'server')
    monkeypatch.setattr(config, 'app_mode', 'demo')
    monkeypatch.setattr(config, 'auto_migrate', True)
