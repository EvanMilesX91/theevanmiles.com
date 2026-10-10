from alembic import command
from alembic.config import Config

from .config import ROOT


def migrate() -> None:
    command.upgrade(Config(str(ROOT / "backend" / "alembic.ini")), "head")


if __name__ == "__main__":
    migrate()
