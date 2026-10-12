"""Persistent audit trail for model and strategy research experiments.

The research layer deliberately records failed candidates as well as promising
ones.  This makes multiple testing visible and prevents a lucky backtest from
being presented as if it were the only idea that was tried.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable


def _metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    """Keep the registry compact while preserving the decision evidence."""
    names = (
        "brier_score_5d", "baseline_brier_score_5d", "expected_calibration_error_5d",
        "calibration_gap_5d", "overall_mean_net_return_5d", "macro_symbol_brier_score_5d",
        "macro_symbol_baseline_brier_score_5d", "macro_regime_brier_score_5d",
        "macro_regime_baseline_brier_score_5d", "signal_thresholds_5d", "friction",
        "feature_coverage", "brier_decomposition_5d",
    )
    return {name: metrics[name] for name in names if name in metrics}


class ExperimentRegistry:
    """Small atomic JSON registry suitable for the single local engine."""

    def __init__(self, path: str | Path, *, max_experiments: int = 2000) -> None:
        self.path = Path(path)
        self.max_experiments = max_experiments

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"schema_version": 1, "runs": [], "experiments": []}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(value, dict):
                raise ValueError
            value.setdefault("schema_version", 1)
            value.setdefault("runs", [])
            value.setdefault("experiments", [])
            return value
        except (OSError, ValueError, TypeError):
            return {"schema_version": 1, "runs": [], "experiments": []}

    def list(self, *, limit: int = 50) -> dict[str, Any]:
        data = self._read()
        experiments = list(reversed(data.get("experiments", [])))[:max(1, min(limit, 250))]
        statuses = [str(item.get("status", "UNKNOWN")) for item in data.get("experiments", [])]
        return {
            "schema_version": data.get("schema_version", 1),
            "experiment_count": len(statuses),
            "rejected_count": sum(status == "REJECTED" for status in statuses),
            "paper_count": sum(status == "PAPER_TEST" for status in statuses),
            "eligible_count": sum(status == "ELIGIBLE" for status in statuses),
            "latest_run": data.get("runs", [])[-1] if data.get("runs") else None,
            "experiments": experiments,
        }

    def record_run(
        self,
        candidates: Iterable[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]],
        *,
        dataset_version: str,
        completed_at: str | None = None,
    ) -> dict[str, Any]:
        data = self._read()
        timestamp = completed_at or datetime.now(UTC).isoformat()
        run_id = "run-" + hashlib.sha256(f"{dataset_version}:{timestamp}".encode()).hexdigest()[:12]
        records: list[dict[str, Any]] = []
        for training, report, gate in candidates:
            metrics = report.get("metrics", {})
            fingerprint = json.dumps(training, sort_keys=True, separators=(",", ":"))
            experiment_id = "exp-" + hashlib.sha256(f"{run_id}:{fingerprint}".encode()).hexdigest()[:12]
            eligible = bool(gate.get("eligible"))
            records.append({
                "experiment_id": experiment_id,
                "run_id": run_id,
                "status": "ELIGIBLE" if eligible else "REJECTED",
                "decision": "paper testing only" if eligible else "rejected before paper testing",
                "hypothesis": "Waypoint feature model candidate",
                "training": training,
                "dataset_version": dataset_version,
                "method": report.get("method", "chronological_walk_forward"),
                "folds": report.get("folds", 0),
                "metrics": _metrics(metrics),
                "promotion_gate": gate,
                "completed_at": timestamp,
            })
        data["experiments"] = (data.get("experiments", []) + records)[-self.max_experiments:]
        run = {"run_id": run_id, "dataset_version": dataset_version,
               "completed_at": timestamp, "candidate_count": len(records),
               "eligible_count": sum(item["status"] == "ELIGIBLE" for item in records)}
        data["runs"] = (data.get("runs", []) + [run])[-200:]
        self._write(data)
        return self.list()

    def record_single(
        self, *, training: dict[str, Any], report: dict[str, Any], gate: dict[str, Any],
        dataset_version: str, model_version: str,
    ) -> dict[str, Any]:
        result = self.record_run([(training, report, gate)], dataset_version=dataset_version)
        if result["experiments"]:
            result["experiments"][0]["model_version"] = model_version
            data = self._read()
            for item in data["experiments"]:
                if item.get("experiment_id") == result["experiments"][0].get("experiment_id"):
                    item["model_version"] = model_version
            self._write(data)
            result = self.list()
        return result

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="ml-experiments-", suffix=".json", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, sort_keys=True)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
