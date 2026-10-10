"""Explicit model registry. Activation is always a separate operation."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


class ModelRegistry:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"active": None, "models": {}}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"active": None, "models": {}}

    def list(self) -> dict[str, Any]:
        return self._read()

    def register(self, model: dict[str, Any], *, activate: bool = False) -> dict[str, Any]:
        data = self._read()
        version = str(model["version"])
        if version in data["models"]:
            raise ValueError("Model version already exists; production models are never silently replaced.")
        data["models"][version] = model
        if activate:
            data["active"] = version
        self._write(data)
        return data

    def activate(self, version: str) -> dict[str, Any]:
        data = self._read()
        if version not in data["models"]:
            raise KeyError(version)
        data["active"] = version
        self._write(data)
        return data

    def active(self) -> dict[str, Any] | None:
        data = self._read()
        active = data.get("active")
        return data.get("models", {}).get(active) if active else None

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="ml-registry-", suffix=".json", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, sort_keys=True)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
