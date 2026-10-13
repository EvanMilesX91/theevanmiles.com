"""Optional ML orchestration: snapshot capture, shadow predictions, and inference."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..config import ROOT, config
from ..models import Setting
from .datasets import PointInTimeSnapshot, make_snapshot, read_jsonl_stratified, read_jsonl_tail
from .predict import predict_with_model, similar_setups
from .projections import HORIZONS, build_projection, disagreement, rank_analogues
from .registry import ModelRegistry
from .experiments import ExperimentRegistry
from .shadow import compare_deterministic_and_ml
from .drift import assess_drift
from .train import TrainedModel

ML_SETTING_ID = 130


class MLEngine:
    def __init__(self) -> None:
        path = Path(config.ml_registry_path)
        self.registry = ModelRegistry(path if path.is_absolute() else ROOT / path)
        experiment_path = Path(config.ml_experiments_path)
        self.experiments = ExperimentRegistry(experiment_path if experiment_path.is_absolute() else ROOT / experiment_path)
        self._model: TrainedModel | None = None
        self._model_version: str | None = None
        self._active_record: dict[str, Any] | None = None
        self._registry_mtime: float | None = None
        self.shadow_mode = config.ml_shadow_mode
        self.influence_enabled = config.ml_influence_enabled
        self.history: list[PointInTimeSnapshot] = []
        self._model_history_key: tuple[int, str] | None = None
        self.projection_history: list[PointInTimeSnapshot] = []
        self._projection_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._history_cache: tuple[str, float, list[PointInTimeSnapshot]] | None = None
        self.last_maintenance: dict[str, Any] = {}

    def status(self) -> dict[str, Any]:
        active = self._load() if config.ml_enabled else None
        active_record = self._active_record if active else None
        return {"enabled": config.ml_enabled, "shadow_mode": self.shadow_mode,
                "influence_enabled": self.influence_enabled and bool(active_record),
                "active_model": active_record.get("version") if active_record else None,
                "model_family": active_record.get("model_family") if active_record else None,
                "registry_path": str(config.ml_registry_path),
                "drift": active_record.get("drift", {"status": "unknown", "confidence_reduced": True}) if active_record else {"status": "no_model", "confidence_reduced": True}}

    def _load(self) -> TrainedModel | None:
        if not config.ml_enabled:
            self._model = None
            self._model_version = None
            self._active_record = None
            return None
        try:
            registry_mtime = self.registry.path.stat().st_mtime
        except OSError:
            registry_mtime = -1.0
        if self._model is not None and self._registry_mtime == registry_mtime:
            return self._model
        active = self.registry.active()
        if not active:
            self._model = None
            self._active_record = None
            self._registry_mtime = registry_mtime
            return None
        if self._model is None or self._model_version != active.get("version"):
            self._model = TrainedModel(name=active["name"], version=active["version"], model_family=active["model_family"],
                                       feature_names=tuple(active["feature_names"]), means=active["means"], scales=active["scales"],
                                       heads=active["heads"], calibration=active.get("calibration", {}),
                                       training_period=active["training_period"], dataset_version=active["dataset_version"],
                                       trained_at=active["trained_at"], hyperparameters=active.get("hyperparameters", {}))
            self._model_version = active["version"]
        self._active_record = active
        self._registry_mtime = registry_mtime
        return self._model

    def capture(self, db: Session, *, symbol: str, stock: dict[str, Any], now: datetime) -> None:
        if not config.ml_enabled and not config.historical_projection_enabled:
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
        self._model_history_key = None

    def _load_history(self, db: Session) -> list[PointInTimeSnapshot]:
        rows: list[PointInTimeSnapshot] = []
        path = Path(config.ml_dataset_path)
        path = path if path.is_absolute() else ROOT / path
        try:
            modified = path.stat().st_mtime
        except OSError:
            modified = -1.0
        if self._history_cache and self._history_cache[0] == str(path) and self._history_cache[1] == modified:
            return self._history_cache[2]
        if path.exists():
            try:
                # The full archive is an offline training input. Never scan
                # it during live startup: on a Windows-mounted Docker volume
                # a two-pass stratified read can hold the event loop for many
                # minutes and leave health/login requests timing out. The
                # scheduler can still use the stratified reader offline; the
                # live dashboard uses a bounded tail until a compact runtime
                # cache is generated.
                if config.app_mode == "live":
                    # A live process must never open the multi-hundred-MB
                    # training archive on its request path. A compact runtime
                    # cache can be supplied at ``ml_dataset_path``; until it
                    # exists, live snapshots in SQLite are still valid and
                    # the projection panel simply reports that more history
                    # is needed.
                    runtime_path = path.with_name(f"{path.stem}.runtime{path.suffix}")
                    if runtime_path.exists():
                        rows.extend(read_jsonl_tail(str(runtime_path), config.historical_projection_runtime_rows))
                else:
                    rows.extend(read_jsonl_stratified(str(path), config.historical_projection_runtime_rows))
            except (OSError, ValueError, KeyError, TypeError):
                # A partially written offline dataset must not break the live dashboard.
                rows = []
        row = db.get(Setting, ML_SETTING_ID)
        for item in (row.data.get("snapshots", []) if row else []):
            try:
                rows.append(PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                                labels=item.get("labels"), provenance=item.get("provenance", []),
                                                regime=item.get("regime", "unknown"),
                                                company_type=item.get("company_type", "unknown"),
                                                sector=item.get("sector", "unknown"), metadata=item.get("metadata", {})))
            except (KeyError, TypeError, ValueError):
                continue
        unique = {(item.symbol, item.as_of): item for item in rows}
        ordered = sorted(unique.values(), key=lambda item: item.as_of)
        if len(ordered) > config.historical_projection_runtime_rows:
            # Prefer labelled historical cases for projections.  The runtime
            # ledger also contains newer unlabelled live snapshots; taking a
            # naive date tail would discard every usable analogue whenever the
            # live ledger is longer than the offline sample.
            labelled = [item for item in ordered if item.labels]
            unlabelled = [item for item in ordered if not item.labels]
            limit = config.historical_projection_runtime_rows
            if len(labelled) >= limit:
                pool = labelled
            else:
                pool = labelled + unlabelled
            if len(pool) > limit:
                positions = {round(index * (len(pool) - 1) / (limit - 1)) for index in range(limit)}
                ordered = [pool[index] for index in sorted(positions)]
            else:
                ordered = pool
        self._history_cache = (str(path), modified, ordered)
        return ordered

    def project(self, stock: dict[str, Any], *, symbol: str, now: datetime, db: Session) -> dict[str, Any] | None:
        """Return historical outcome ranges, or None when labelled analogues are unavailable."""
        if not config.historical_projection_enabled or stock.get("price", 0) <= 0:
            return None
        point = make_snapshot(stock, symbol=symbol, as_of=now)
        bucket = int(now.timestamp() // config.historical_projection_cache_seconds)
        # Refresh the slower historical map on a time window rather than for
        # every cent of quote movement. Live prices still update immediately;
        # the research range remains stable between refreshes.
        cache_key = f"{symbol}:{bucket}"
        cached = self._projection_cache.get(cache_key)
        if cached and cached[0] > now.timestamp():
            return cached[1]
        history = self._load_history(db)
        self.projection_history = history
        if not any(row.labels for row in history):
            return None
        horizons: dict[str, Any] = {}
        broad_by_horizon: dict[int, dict[str, Any] | None] = {}
        broad_matches_by_horizon: dict[int, list[Any]] = {}
        same_regime_by_horizon: dict[int, dict[str, Any] | None] = {}
        group_matches_by_horizon: dict[int, dict[str, list[Any]]] = {}
        groups: dict[str, int] = {}
        for horizon_days in HORIZONS:
            broad = rank_analogues(point, history, horizon_days=horizon_days, group="broad",
                                   top_n=config.historical_projection_top_n)
            same_regime = rank_analogues(point, history, horizon_days=horizon_days, group="broad",
                                         same_regime=True, top_n=config.historical_projection_top_n)
            projection = build_projection(point, broad, current_price=float(stock["price"]), horizon_days=horizon_days)
            regime_projection = build_projection(point, same_regime, current_price=float(stock["price"]), horizon_days=horizon_days)
            broad_matches_by_horizon[horizon_days] = broad
            if projection:
                horizons[str(horizon_days)] = projection
                broad_by_horizon[horizon_days] = projection
                same_regime_by_horizon[horizon_days] = regime_projection
            for group in ("same_stock", "peers"):
                group_matches = rank_analogues(point, history, horizon_days=horizon_days, group=group,
                                               top_n=config.historical_projection_top_n)
                group_matches_by_horizon.setdefault(horizon_days, {})[group] = group_matches
                groups[group] = max(groups.get(group, 0), len(group_matches))
            groups["broad"] = max(groups.get("broad", 0), len(broad))
        selected_horizon: int | None = 10 if "10" in horizons else (int(next(iter(horizons))) if horizons else None)
        if selected_horizon is None:
            return None
        selected = horizons[str(selected_horizon)]
        selected["horizon_days"] = selected_horizon
        regime_selected = same_regime_by_horizon.get(selected_horizon)
        selected["disagreement"] = disagreement(selected, regime_selected)
        selected["explanation"] = "We found historical situations that looked similar to this one and measured what happened afterward. These are historical projections, not guaranteed future prices."
        group_projections: dict[str, Any] = {}
        for group in ("same_stock", "peers", "broad"):
            if group == "broad":
                group_matches = broad_matches_by_horizon.get(selected_horizon, [])
            else:
                group_matches = group_matches_by_horizon.get(selected_horizon, {}).get(group, [])
            group_projection = build_projection(point, group_matches, current_price=float(stock["price"]),
                                                 horizon_days=selected_horizon)
            if group_projection:
                group_projections[group] = group_projection
        if regime_selected:
            group_projections["same_regime"] = regime_selected
        result = {"as_of": now.isoformat(), "current_price": float(stock["price"]), "selected_horizon": int(selected_horizon),
                  "horizons": horizons, "groups": groups, "group_projections": group_projections, "analogue_count": selected["samples"],
                  "analogue_quality": selected["analogue_quality"], "average_similarity": selected["average_similarity"],
                  "feature_completeness": selected["feature_completeness"], "positive_rate": selected["positive_rate"],
                  "target_first_rate": selected["target_first_rate"], "reconsider_first_rate": selected["reconsider_first_rate"],
                  "neither_rate": selected["neither_rate"], "median_return": selected["median_return"],
                  "median_max_upside": selected["median_max_upside"], "median_max_drawdown": selected["median_max_drawdown"],
                  "cases": selected["cases"], "disagreement": selected["disagreement"], "explanation": selected["explanation"],
                  "data_status": "historical_outcome_range"}
        self._projection_cache[cache_key] = (now.timestamp() + config.historical_projection_cache_seconds, result)
        return result

    def projection_status(self, db: Session) -> dict[str, Any]:
        history = self._load_history(db) if config.historical_projection_enabled else []
        labelled = sum(bool(row.labels) for row in history)
        return {"enabled": config.historical_projection_enabled, "snapshots": len(history),
                "labelled_snapshots": labelled, "status": "ready" if labelled else "awaiting_labelled_history"}

    def predict(self, stock: dict[str, Any], *, symbol: str, now: datetime | None = None, db: Session | None = None) -> dict[str, Any] | None:
        if not config.ml_enabled:
            return None
        model = self._load()
        if not model:
            return None
        point = make_snapshot(stock, symbol=symbol, as_of=now or datetime.now(UTC))
        if db is not None and self._model_history_key is None:
            row = db.get(Setting, ML_SETTING_ID)
            if row:
                items = row.data.get("snapshots", [])
                last_as_of = str(items[-1].get("as_of", "")) if items else ""
                cache_key = (len(items), last_as_of)
                if self._model_history_key != cache_key:
                    # Inference only needs a bounded recent comparison set.
                    # Rebuilding thousands of snapshots for every stock made
                    # the first live dashboard request exceed the browser
                    # timeout; offline training still uses the full JSONL.
                    items = items[-config.historical_projection_runtime_rows:]
                    self.history = [PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                                        labels=item.get("labels"), provenance=item.get("provenance", []),
                                                        regime=item.get("regime", "unknown"), company_type=item.get("company_type", "unknown"),
                                                        sector=item.get("sector", "unknown"), metadata=item.get("metadata", {})) for item in items]
                    self._model_history_key = cache_key
            else:
                self._model_history_key = (0, "")
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
        # Drift only uses the recent tail; avoid materialising the full
        # snapshot ledger during every dashboard request.
        snapshot_items = (row.data.get("snapshots", []) if row else [])[-200:]
        snapshots = [PointInTimeSnapshot(symbol=item["symbol"], as_of=item["as_of"], features=item["features"],
                                          labels=item.get("labels"), provenance=item.get("provenance", []), regime=item.get("regime", "unknown"),
                                          company_type=item.get("company_type", "unknown"), sector=item.get("sector", "unknown"),
                                          metadata=item.get("metadata", {})) for item in snapshot_items]
        drift = assess_drift(active, snapshots[-200:], outcomes=outcomes[-200:]) if active else self.status()["drift"]
        return {**self.status(), "drift": drift, "predictions": len(predictions), "shadow_predictions": sum(item.get("mode") == "shadow" for item in predictions),
                "evaluated_outcomes": len(outcomes), "comparison": compare_deterministic_and_ml(outcomes),
                "historical_projection": self.projection_status(db), "maintenance": self.last_maintenance}

    def scheduled_maintenance(self, db: Session, *, force: bool = False) -> dict[str, Any]:
        """Evaluate and register a candidate model without changing production."""
        if not config.ml_maintenance_enabled and not force:
            return {"status": "disabled", "last": self.last_maintenance}
        if not force and self.last_maintenance.get("completed_at"):
            try:
                elapsed = (datetime.now(UTC) - datetime.fromisoformat(self.last_maintenance["completed_at"])).total_seconds()
                if elapsed < config.ml_maintenance_interval_hours * 3600:
                    return {"status": "not_due", "last": self.last_maintenance}
            except (TypeError, ValueError):
                pass
        path = Path(config.ml_dataset_path)
        path = path if path.is_absolute() else ROOT / path
        if not path.exists():
            result = {"status": "awaiting_dataset", "path": str(path)}
            self.last_maintenance = result
            return result
        from .datasets import read_jsonl
        from .evaluate import promotion_gate, walk_forward, walk_forward_hierarchical_prior
        from .train import train

        rows = read_jsonl(str(path))
        candidates = [
            # The previous 10.0/1.0 penalties almost zeroed the standardized
            # feature weights. Compare modest regularisation values instead;
            # the walk-forward gate decides whether any candidate is useful.
            {"logistic_l2": 0.01, "learning_rate": 0.06, "probability_shrinkage": 0.80, "feature_profile": "all"},
            {"logistic_l2": 0.05, "learning_rate": 0.08, "probability_shrinkage": 0.80, "feature_profile": "all"},
            {"logistic_l2": 0.01, "learning_rate": 0.06, "probability_shrinkage": 0.80, "feature_profile": "price_volume"},
            {"logistic_l2": 0.05, "learning_rate": 0.08, "probability_shrinkage": 0.80, "feature_profile": "price_volume"},
        ]
        evaluated: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
        for train_kwargs in candidates:
            report = walk_forward(rows, train_kwargs=train_kwargs)
            gate = promotion_gate(report["metrics"])
            evaluated.append((train_kwargs, report, gate))
        def rank(item: tuple[dict[str, Any], dict[str, Any], dict[str, Any]]) -> tuple[int, float, float]:
            _, report, gate = item
            metrics = report["metrics"]
            selected = gate.get("selected_mean_net_return_5d")
            brier = metrics.get("brier_score_5d")
            return (int(gate.get("eligible", False)), float(selected if selected is not None else -1e9),
                    -float(brier if brier is not None else 1e9))
        train_kwargs, report, gate = max(evaluated, key=rank)
        model = train(rows, **train_kwargs)
        experiment_registry = self.experiments.record_run(
            evaluated, dataset_version=model.dataset_version, completed_at=datetime.now(UTC).isoformat()
        )
        model_record = model.to_dict() | {"validation": report["metrics"], "promotion_gate": gate}
        tree_challenger = None
        hierarchical_prior = None
        try:
            hierarchical_prior = walk_forward_hierarchical_prior(rows, shrinkage=0.5)
            hierarchical_prior["promotion_gate"] = promotion_gate(hierarchical_prior["metrics"])
        except (OSError, ValueError, RuntimeError):
            hierarchical_prior = {"status": "unavailable"}
        try:
            from .tree import available_backends, walk_forward_xgboost
            if "xgboost" in available_backends():
                tree_challenger = walk_forward_xgboost(rows)
        except (ImportError, RuntimeError, ValueError):
            # The production image intentionally has no heavy tree dependency.
            tree_challenger = {"status": "unavailable"}
        try:
            registry = self.registry.register(model_record, activate=False)
        except ValueError:
            registry = self.registry.list()
            result = {"status": "candidate_exists", "candidate_version": model.version,
                      "evaluation": report, "candidate_evaluations": [{"training": item[0], "gate": item[2], "metrics": item[1]["metrics"]} for item in evaluated],
                      "tree_challenger": tree_challenger,
                      "hierarchical_prior": hierarchical_prior,
                      "registry_models": len(registry.get("models", {})), "research": experiment_registry,
                      "promotion_gate": gate, "activated": False, "completed_at": datetime.now(UTC).isoformat()}
            self.last_maintenance = result
            return result
        result = {"status": "candidate_ready", "candidate_version": model.version,
                  "evaluation": report, "candidate_evaluations": [{"training": item[0], "gate": item[2], "metrics": item[1]["metrics"]} for item in evaluated],
                  "tree_challenger": tree_challenger,
                  "hierarchical_prior": hierarchical_prior,
                  "registry_models": len(registry.get("models", {})), "research": experiment_registry,
                  "promotion_gate": gate, "activated": False, "completed_at": datetime.now(UTC).isoformat()}
        self.last_maintenance = result
        return result
