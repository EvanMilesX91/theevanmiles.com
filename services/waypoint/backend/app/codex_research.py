"""Import Codex-curated historical news into the auditable news archive.

This is intentionally an explicit import step. Codex web research is not an
always-on feed, so records are reviewed and written to JSONL first. The
importer preserves the publication and earliest-known timestamps and never
changes existing observations.

Example::

    python -m app.codex_research --input data/codex_research.jsonl

Each JSON object must contain ``symbol``, ``title``, ``url`` and
``published_at`` (ISO-8601). ``available_at`` should be supplied when it is
known; otherwise the publication timestamp is used conservatively.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .db import SessionLocal
from .news import candidates_from_codex, persist_candidates


def load_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            text = line.strip()
            if not text or text.startswith("#"):
                continue
            try:
                value = json.loads(text)
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSON on line {line_number}: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"Line {line_number} must contain a JSON object.")
            records.append(value)
    return records


def import_records(path: Path) -> dict[str, int]:
    records = load_records(path)
    rows = candidates_from_codex(records, now=datetime.now(UTC))
    with SessionLocal() as db:
        inserted = persist_candidates(db, rows)
        db.commit()
    return {"records": len(records), "valid": len(rows), "inserted": inserted, "skipped": len(rows) - inserted}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Codex research JSONL file")
    args = parser.parse_args()
    print(json.dumps(import_records(args.input), sort_keys=True))


if __name__ == "__main__":
    main()
