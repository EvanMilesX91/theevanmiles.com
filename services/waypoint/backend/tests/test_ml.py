from datetime import UTC, datetime, timedelta

import pytest

from app.ml.calibration import brier_score, reliability_curve
from app.ml.datasets import PointInTimeSnapshot, assert_no_lookahead, make_snapshot
from app.ml.decision import combine_decision
from app.ml.labels import make_labels
from app.ml.predict import predict_with_model, similar_setups
from app.ml.registry import ModelRegistry
from app.ml.train import train


def _bars(start: datetime, count: int = 30) -> list[dict[str, object]]:
    return [{"timestamp": (start + timedelta(days=index + 1)).isoformat(), "open": 100 + index,
             "high": 102 + index, "low": 99 + index, "close": 101 + index, "volume": 1000 + index * 10}
            for index in range(count)]


def _row(index: int, labels: bool = True) -> PointInTimeSnapshot:
    as_of = datetime(2020, 1, 1, tzinfo=UTC) + timedelta(days=index)
    values = {f: ((index % 7) / 10) for f in __import__("app.ml.features", fromlist=["FEATURE_NAMES"]).FEATURE_NAMES}
    actual = {"return_5d": 0.02 if index % 2 else -0.01, "return_10d": 0.04 if index % 2 else -0.02,
              "return_20d": 0.05 if index % 2 else -0.03, "max_upside_20d": 0.08,
              "max_drawdown_20d": -0.04, "barrier_outcome_20d": "TARGET_FIRST" if index % 2 else "RECONSIDER_FIRST"}
    return PointInTimeSnapshot("TEST", as_of.isoformat(), values, actual if labels else None, [], "bull")


def test_point_in_time_features_ignore_future_rows_and_labels_use_forward_window():
    as_of = datetime(2024, 6, 10, 15, tzinfo=UTC)
    snapshot = {"price": 100, "history_rows": [
        {"timestamp": "2024-06-09T15:00:00+00:00", "close": 98, "volume": 100},
        {"timestamp": "2024-06-10T14:00:00+00:00", "close": 100, "volume": 120},
        {"timestamp": "2024-06-11T14:00:00+00:00", "close": 999, "volume": 99999},
    ], "provenance": [{"field": "future", "available_at": "2024-06-11T12:00:00+00:00"}]}
    row = make_snapshot(snapshot, symbol="TEST", as_of=as_of)
    assert row.features["return_1d"] == pytest.approx(100 / 98 - 1)
    with pytest.raises(ValueError, match="future information"):
        assert_no_lookahead(row.__class__(row.symbol, row.as_of, row.features,
                                          row.labels, [{"field": "future", "available_at": "2024-06-11T12:00:00+00:00"}], row.regime))
    labels = make_labels(as_of=as_of, entry_price=100, bars=_bars(as_of), target=103, reconsider=97)
    assert labels["return_5d"] is not None and labels["barrier_outcome_20d"] == "TARGET_FIRST"


def test_baseline_training_prediction_and_registry_are_explicit(tmp_path):
    rows = [_row(index) for index in range(20)]
    model = train(rows, version="baseline-test-v1")
    prediction = predict_with_model(model, _row(21, labels=False))
    assert model.model_family == "baseline-logistic-linear"
    assert 0 <= prediction["probability_positive_10d"] <= 1
    assert prediction["model_confidence"] in {"HIGH", "MEDIUM", "LOW"}
    registry = ModelRegistry(tmp_path / "registry.json")
    registry.register(model.to_dict(), activate=True)
    assert registry.active()["version"] == "baseline-test-v1"
    with pytest.raises(ValueError, match="never silently"):
        registry.register(model.to_dict())


def test_walk_forward_inputs_never_randomly_mix_time_and_probability_metrics():
    from app.ml.evaluate import promotion_gate, walk_forward

    result = walk_forward([_row(index) for index in range(24)])
    assert result["method"] == "chronological_walk_forward"
    assert result["folds"] >= 1
    assert 0 <= result["metrics"]["brier_score_5d"] <= 1
    assert result["metrics"]["friction"]["spread_bps"] > 0
    assert "baseline_brier_score_5d" in result["metrics"]
    assert "calibration_gap_5d" in result["metrics"]
    assert "feature_coverage" in result["metrics"]
    assert "by_symbol" in result["metrics"]
    assert promotion_gate(result["metrics"])["eligible"] is False


def test_calibration_and_similarity_are_explanatory_not_authoritative():
    assert brier_score([0.7, 0.2], [1, 0]) == pytest.approx(0.065)
    assert len(reliability_curve([0.7, 0.2], [1, 0])) == 10
    model = train([_row(index) for index in range(20)], version="similarity-v1")
    result = similar_setups(model, _row(21, labels=False), [_row(index) for index in range(20)])
    assert result["count"] <= 10


def test_ml_can_only_narrow_an_existing_decision_and_never_bypass_risk_controls():
    prediction = {"probability_positive_10d": 0.9, "probability_target_first": 0.9}
    assert combine_decision(deterministic_state="BUY_AREA", opportunity=90, risk=92, prediction=prediction,
                            influence_enabled=True, fresh=True)["state"] == "SKIP"
    assert combine_decision(deterministic_state="BUY_AREA", opportunity=90, risk=30, prediction=prediction,
                            influence_enabled=False, fresh=True)["state"] == "BUY_AREA"


def test_feature_coverage_is_explicit_when_inputs_are_missing():
    from app.ml.features import build_features

    features = build_features({"price": 100, "history_rows": []}, "2026-01-02T00:00:00+00:00")
    assert features["history_coverage"] == 0
    assert features["fundamental_coverage"] == 0
    assert features["news_coverage"] == 0
    assert features["event_coverage"] == 0
