"""Optional tree backend discovery.

The installed baseline needs no third-party ML package. If a deployment adds
LightGBM, XGBoost, or CatBoost, training jobs can select it explicitly rather
than silently changing the production model family.
"""

from __future__ import annotations

import importlib.util


TREE_BACKENDS = ("lightgbm", "xgboost", "catboost")


def available_backends() -> list[str]:
    return [name for name in TREE_BACKENDS if importlib.util.find_spec(name) is not None]


def require_backend(name: str) -> str:
    if name not in TREE_BACKENDS:
        raise ValueError(f"Unsupported tree backend: {name}")
    if name not in available_backends():
        raise RuntimeError(f"{name} is not installed; baseline logistic/linear training remains available.")
    return name
