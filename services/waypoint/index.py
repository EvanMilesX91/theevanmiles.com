"""Vercel's native FastAPI entrypoint; migrations are an explicit deploy step."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app.main import app  # noqa: E402, F401
