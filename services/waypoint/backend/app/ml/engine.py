"""Optional ML orchestration: snapshot capture, shadow predictions, and inference."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..config import ROOT, config
from ..models import Setting
from .datasets import PointInTimeSnapshot, make_snapshot
from .predict import predict_with_model, similar_setups
from .registry import ModelRegistry
from .shadow import compare_deterministic_and_ml
from .drift import assess_drift
from .train import TrainedModel

ML_SETTING_ID = 130


class MLEngine:
    def __init__(self) -> None:
        path = Path(config.ml_registry_path)
        self.registry = ModelRegistry(path if path.is_absolute() else ROOT / path)
        self._model: TrainedModel | None = None
        self._model_version: str | None = None
        self.shadow_mode = config.ml_shadow_mode
        self.influence_enabled = config.ml_influence_enabled
        self.history: list[PointInTimeSnapshot] = []

    def status(self) -> dict[str, Any]:
        active = self.registry.active()
        return {"enabled": config.ml_enabled, "shadow_mode": self.shadow_mode,
                "influence_enabled": self.influence_enabled and bool(active),
                "active_model": active.get("version") if active else None,
                "model_family": active.get("model_family") if active else None,
                "registry_path": str(config.ml_registry_path),
                "drift": active.get("drift", {"status": "unknown", "confidence_reduced": True}) if active else {"status": "no_model", "confidence_reduced": True}}

    def _load(self) -> TrainedModel | None:
        active = self.registry.active()
        if not active:
            self._model = None
            return None
        if self._model is None or self._model_version != active.get("version"):
            self._model = TrainedModel(name=active["name"], version=active["version"], model_family=active["model_family"],
                                       feature_names=tuple(active["feature_names"]), means=active["means"], scales=active["scales"],
                                       heads=active["heads"], calibration=active.get("calibration", {}),
                                       training_period=active["training_period"], dataset_version=active["dataset_version"],
                                       trained_at=active["trained_at"], hyperparameters=active.get("hyperparameters", {}))
            self._model_version = active["version"]
        return self._model

    def capture(self, db: Session, *, symbol: str, stock: dict[str, Any], now: datetime) -> None:
        if not config.ml_enabled:
            return
        snapshot = make_snapshot(stock, symbol=symbol, as_of=now)
        row = db.get(Setting, ML_SETTING_ID)
        data = copy.deepcopy(row.data) if row else {"snapshots": [], "predictions": [], "outcomes": []}
        existing = {(item.get("symbol"), item.get("as_of")) for item in data.get("snapshots", [])}
        if (symbol, snapshot.as_of) not in existing:
            data.setdefault("snapshots", []).append(snapshot.to_dict())
            data["snapshots"] = data["snapshots"][-config.ml_snapshot_limit:]
        if row:
            row.data = data
        else:
            db.add(Setting(id=ML_SETTING_ID, data=data))

    def predict(self, stock: dict[str, Any], *, symbol: str, now: datetime | None = None, db: Session | None = None) -> dict[str, Any] | None:
        if not config.ml_enabled:
            return None
        model = self._load()
        if not model:
            return None
        point = make_snapshot(stock, symbol=symbol, as_of=now or datetime.now(UTC))
        if db is not None:
            row = db.get(Setting, ML_SETTING_ID)
            if row:
                self.history = [PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                                    labels=item.get("labels"), provenance=item.get("provenance", []),
                                                    regime=item.get("regime", "unknown")) for item in row.data.get("snapshots", [])]
        result = predict_with_model(model, point)
        result["similar_setups"] = similar_setups(model, point, self.history)
        return result

    def attach_shadow(self, db: Session, symbol: str, prediction: dict[str, Any], now: datetime) -> None:
        row = db.get(Setting, ML_SETTING_ID)
        data = copy.deepcopy(row.data) if row else {"snapshots": [], "predictions": [], "outcomes": []}
        data.setdefault("predictions", []).append({"symbol": symbol, "timestamp": now.isoformat(), "prediction": prediction,
                                                     "mode": "shadow" if self.shadow_mode else "influence"})
        data["predictions"] = data["predictions"][-config.ml_prediction_limit:]
        if row:
            row.data = data
        else:
            db.add(Setting(id=ML_SETTING_ID, data=data))

    def settle_shadow(self, db: Session, *, symbol: str, prediction_timestamp: str, labels: dict[str, Any]) -> bool:
        row = db.get(Setting, ML_SETTING_ID)
        if not row:
            return False
        data = copy.deepcopy(row.data)
        matches = [item for item in data.get("predictions", []) if item.get("symbol") == symbol and item.get("timestamp") == prediction_timestamp]
        if not matches:
            return False
        data.setdefault("outcomes", []).append({"symbol": symbol, "prediction_timestamp": prediction_timestamp,
                                                 "prediction": matches[-1].get("prediction", {}), "actual": labels, "completed": True})
        data["outcomes"] = data["outcomes"][-config.ml_prediction_limit:]
        row.data = data
        return True

    def dashboard(self, db: Session) -> dict[str, Any]:
        row = db.get(Setting, ML_SETTING_ID)
        predictions = row.data.get("predictions", []) if row else []
        outcomes = row.data.get("outcomes", []) if row else []
        active = self._load()
        snapshots = [PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                          labels=item.get("labels"), provenance=item.get("provenance", []), regime=item.get("regime", "unknown"))
                     for item in (row.data.get("snapshots", []) if row else [])]
        drift = assess_drift(active, snapshots[-200:], outcomes=outcomes[-200:]) if active else self.status()["drift"]
        return {**self.status(), "drift": drift, "predictions": len(predictions), "shadow_predictions": sum(item.get("mode") == "shadow" for item in predictions),
                "evaluated_outcomes": len(outcomes), "comparison": compare_deterministic_and_ml(outcomes)}
