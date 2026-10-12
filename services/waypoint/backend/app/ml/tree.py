"""Optional tree challengers.

Tree models are evaluated as candidates only. They do not replace the
serializable baseline or influence live decisions until the promotion gate
has passed.
"""

from __future__ import annotations

import importlib.util
from typing import Any

import numpy as np

from .calibration import brier_score, calibrate, fit_platt
from .datasets import PointInTimeSnapshot
from .evaluate import Friction, _binary_outcome, _calibration_split, _folds
from .train import FEATURE_PROFILES, _group_weights, _label, _matrix


TREE_BACKENDS = ("lightgbm", "xgboost", "catboost")


def available_backends() -> list[str]:
    return [name for name in TREE_BACKENDS if importlib.util.find_spec(name) is not None]


def require_backend(name: str) -> str:
    if name not in TREE_BACKENDS:
        raise ValueError(f"Unsupported tree backend: {name}")
    if name not in available_backends():
        raise RuntimeError(f"{name} is not installed; baseline logistic/linear training remains available.")
    return name


def walk_forward_xgboost(rows: list[PointInTimeSnapshot], *, friction: Friction | None = None,
                         feature_profile: str = "price_volume") -> dict[str, Any]:
    """Evaluate an XGBoost probability challenger chronologically.

    The model is deliberately kept in this offline evaluator rather than the
    live inference path until its serialized registry contract is approved.
    """
    require_backend("xgboost")
    import xgboost as xgb

    if feature_profile not in FEATURE_PROFILES:
        raise ValueError(f"Unknown feature profile: {feature_profile}")
    feature_names = FEATURE_PROFILES[feature_profile]
    friction = friction or Friction()
    folds = _folds(rows)
    predictions: list[dict[str, Any]] = []
    for training_rows, validation_rows in folds:
        fit_rows, calibration_rows = _calibration_split(training_rows)
        train_rows = [row for row in fit_rows if _label(row, "probability_positive_5d") is not None]
        cal_rows = [row for row in calibration_rows if _label(row, "probability_positive_5d") is not None]
        valid_rows = [row for row in validation_rows if _label(row, "probability_positive_5d") is not None]
        if len(train_rows) < 20 or not valid_rows:
            continue
        x_train = _matrix(train_rows, feature_names)
        y_train = np.asarray([_label(row, "probability_positive_5d") for row in train_rows], dtype=int)
        sample_weights = _group_weights(train_rows)
        model = xgb.train({
            "objective": "binary:logistic", "eval_metric": "logloss", "tree_method": "hist",
            "max_depth": 3, "eta": 0.04, "min_child_weight": 20, "subsample": 0.8,
            "colsample_bytree": 0.8, "lambda": 10.0, "alpha": 0.1, "nthread": 1,
            "seed": 7,
        }, xgb.DMatrix(x_train, label=y_train, weight=sample_weights), num_boost_round=240)
        # Calibrate on the later slice, never on the same rows used to grow
        # the trees. This keeps the challenger comparable with the baseline.
        if len(cal_rows) >= 30 and len({int(_label(row, "probability_positive_5d")) for row in cal_rows}) > 1:
            cal_raw = model.predict(xgb.DMatrix(_matrix(cal_rows, feature_names)))
            cal_y = [_label(row, "probability_positive_5d") for row in cal_rows]
            calibration = fit_platt(cal_raw.tolist(), [int(value) for value in cal_y]) | {
                "prior": float(np.mean(cal_y)), "shrinkage": 0.80,
            }
        else:
            train_raw = model.predict(xgb.DMatrix(x_train))
            calibration = fit_platt(train_raw.tolist(), y_train.tolist()) | {
                "prior": float(np.mean(y_train)), "shrinkage": 0.80,
            }
        for row in valid_rows:
            raw = float(model.predict(xgb.DMatrix(_matrix([row], feature_names)))[0])
            predictions.append({
                "probability_positive_5d": calibrate(raw, calibration),
                "actual": row.labels,
                "regime": row.regime,
                "as_of": row.as_of,
            })
    scored = [item for item in predictions if _binary_outcome(item["actual"]) is not None]
    probabilities = [float(item["probability_positive_5d"]) for item in scored]
    outcomes = [_binary_outcome(item["actual"]) for item in scored]
    baseline = float(np.mean(outcomes)) if outcomes else None
    baseline_brier = ((baseline - 1) ** 2 * sum(outcomes) + baseline ** 2 * (len(outcomes) - sum(outcomes))) / len(outcomes) if outcomes and baseline is not None else None
    thresholds: dict[str, dict[str, Any]] = {}
    for threshold in (0.50, 0.52, 0.55, 0.58, 0.60, 0.65):
        selected = [item for item in scored if item["probability_positive_5d"] >= threshold]
        returns = [float(item["actual"]["return_5d"]) - friction.round_trip for item in selected]
        thresholds[str(threshold)] = {
            "count": len(selected), "selection_rate": len(selected) / len(predictions) if predictions else 0.0,
            "win_rate": sum(_binary_outcome(item["actual"]) or 0 for item in selected) / len(selected) if selected else None,
            "mean_net_return_5d": float(np.mean(returns)) if returns else None,
        }
    return {
        "method": "chronological_walk_forward_xgboost", "folds": len(folds),
        "predictions": len(predictions),
        "metrics": {
            "brier_score_5d": brier_score(probabilities, outcomes) if outcomes else None,
            "baseline_probability_5d": baseline, "baseline_brier_score_5d": baseline_brier,
            "signal_thresholds_5d": thresholds, "friction": friction.__dict__,
        },
        "hyperparameters": {"n_estimators": 240, "max_depth": 3, "learning_rate": 0.04,
                             "min_child_weight": 20, "reg_lambda": 10.0, "reg_alpha": 0.1,
                             "feature_profile": feature_profile, "balance_groups": True},
    }


def compare_tree_challengers(rows: list[PointInTimeSnapshot], *, friction: Friction | None = None) -> dict[str, Any]:
    """Run every installed tree backend/profile without activating anything."""
    results: dict[str, Any] = {"available_backends": available_backends(), "results": {}, "unavailable": {}}
    for backend in TREE_BACKENDS:
        if backend not in available_backends():
            results["unavailable"][backend] = "optional dependency is not installed"
            continue
        if backend == "xgboost":
            for profile in ("price_volume", "all"):
                results["results"][f"xgboost:{profile}"] = walk_forward_xgboost(
                    rows, friction=friction, feature_profile=profile)
        else:
            results["unavailable"][backend] = "challenger adapter not yet enabled"
    return results
