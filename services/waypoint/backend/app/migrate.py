from alembic import command
from alembic.config import Config

from .config import ROOT


def migrate() -> None:
    # Source tree keeps Alembic under backend/; the Docker image copies the
    # configuration and migrations directly under /app.
    path = ROOT / "backend" / "alembic.ini"
    if not path.exists():
        path = ROOT / "alembic.ini"
    command.upgrade(Config(str(path)), "head")


if __name__ == "__main__":
    migrate()
