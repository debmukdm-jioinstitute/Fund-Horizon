"""Unit tests for sequential screening funnel logic."""
from __future__ import annotations

from app.backoffice.screening.funnel import apply_funnel


def _dummy_row(
    code: str,
    cat: str = "large_cap",
    manager_name: str | None = "Manager X",
    manager_tenure_years: float | None = 4.0,
    tenure_ratio: float | None = 1.2,
    sharpe: float | None = 1.2,
    sortino: float | None = 1.5,
    up_capture: float | None = 1.05,
    down_capture: float | None = 0.90,
    quartile_2y: int | None = 2,
    expense_ratio: float | None = 1.50,
) -> dict:
    return {
        "scheme_code": code,
        "scheme_name": f"Scheme {code}",
        "cat": cat,
        "manager_name": manager_name,
        "manager_tenure_years": manager_tenure_years,
        "tenure_ratio": tenure_ratio,
        "sharpe": sharpe,
        "sortino": sortino,
        "up_capture": up_capture,
        "down_capture": down_capture,
        "quartile_2y": quartile_2y,
        "expense_ratio": expense_ratio,
    }


def test_funnel_sequential_subset_and_s1_drop():
    # Row 1: Valid all pass
    r1 = _dummy_row("1", expense_ratio=1.40)
    # Row 2: Unknown manager (no manager_name) -> insufficient at S1
    r2 = _dummy_row("2", manager_name=None)
    # Row 3: Manager tenure < 3 years -> dropped at S1
    r3 = _dummy_row("3", manager_tenure_years=2.0)
    # Row 4: Fails S3 capture (up_capture <= 1)
    r4 = _dummy_row("4", up_capture=0.95)
    # Row 5: Q1 retain -> goes to retain list, not in action list
    r5 = _dummy_row("5", quartile_2y=1)
    # Row 6: Q4 dropped at S3
    r6 = _dummy_row("6", quartile_2y=4)
    # Row 7: Fails S4a Sharpe < 1.0
    r7 = _dummy_row("7", sharpe=0.8)
    # Row 8: Fails S4c TER > category median (median=1.50, exp=1.80)
    r8 = _dummy_row("8", expense_ratio=1.80)

    rows = [r1, r2, r3, r4, r5, r6, r7, r8]
    cat_median_ters = {"large_cap": 1.50}

    res = apply_funnel(rows, filters={"include_missing": False}, cat_median_ters=cat_median_ters)
    counts = res["counts"]

    # S0 universe = 8
    assert counts["universe"] == 8
    # S1 pass = rows 1, 4, 5, 6, 7, 8 (6 rows). row 2 is insufficient, row 3 is dropped
    assert counts["s1"] == 6
    assert counts["insufficient_by_stage"]["s1"] == 1

    # S2 bounds not configured -> all 6 pass S2
    assert counts["s2"] == 6

    # S3:
    # r4: up_capture 0.95 -> dropped
    # r5: Q1 -> retain (1 row)
    # r6: Q4 -> dropped
    # r1, r7, r8: Q2 review -> pass to S3 action (3 rows)
    assert counts["s3_action"] == 3
    assert counts["s3_retain"] == 1
    assert len(res["retain"]) == 1
    assert res["retain"][0]["scheme_code"] == "5"

    # S4a:
    # r1: pass
    # r7: fails sharpe 0.8 -> dropped
    # r8: pass
    # S4a pass = 2
    assert counts["s4a"] == 2

    # S4c:
    # r1: TER 1.40 <= 1.50 -> pass
    # r8: TER 1.80 > 1.50 -> dropped
    # Final action = 1 row (r1)
    assert counts["final"] == 1
    assert len(res["action"]) == 1
    assert res["action"][0]["scheme_code"] == "1"


def test_funnel_missing_ter_marked_insufficient():
    # Fund with missing TER
    r1 = _dummy_row("1", expense_ratio=None)
    res = apply_funnel([r1], filters={"include_missing": False}, cat_median_ters={"large_cap": 1.50})
    assert res["counts"]["final"] == 0
    assert res["counts"]["insufficient_by_stage"]["s4c"] == 1


def test_missing_data_passes_flagged_and_drops_are_explained():
    rows = [_dummy_row("1", manager_name=None, manager_tenure_years=None, tenure_ratio=None),
            _dummy_row("2", up_capture=1.0), _dummy_row("3", sharpe=0.5)]
    res = apply_funnel(rows, cat_median_ters={"large_cap": 2.0})
    assert [r["scheme_code"] for r in res["action"]] == ["1"]
    assert res["action"][0]["needs_data"] == ["manager_name", "manager_tenure_years", "tenure_ratio"]
    reasons = {d["scheme_code"]: (d["drop_stage"], d["drop_reason"]) for d in res["dropped"]}
    assert reasons["2"][0] == "s3" and reasons["3"][0] == "s4a"  # up_capture == 1.0 fails strict >
    off = apply_funnel(rows[:1], filters={"include_missing": False})
    assert off["counts"]["zeroed_stage"] == "s1"
    assert off["counts"]["missing_by_stage"]["s1"]["manager_name"] == 1


def test_uncomputable_metrics_drop_as_insufficient_history_even_when_missing_included():
    young = _dummy_row("9", sharpe=None, quartile_2y=None)
    res = apply_funnel([young, _dummy_row("1")], cat_median_ters={"large_cap": 2.0})
    assert [r["scheme_code"] for r in res["action"]] == ["1"]
    assert res["dropped"][0]["drop_reason"].startswith("insufficient history")


def test_score_is_per_category_and_unscorable_rows_sort_last():
    rows = [_dummy_row("a", cat="liquid", sharpe=6.0), _dummy_row("b", cat="liquid", sharpe=5.0),
            _dummy_row("c", sharpe=1.3), _dummy_row("d", sharpe=1.1)]
    res = apply_funnel(rows, cat_median_ters={"large_cap": 2.0, "liquid": 2.0})
    by = {r["scheme_code"]: r["score"] for r in res["action"]}
    assert by["a"] > by["b"] and by["c"] > by["d"]
    assert abs(by["a"] - by["c"]) < 1e-9  # same relative standing in different categories -> same score


def test_zero_threshold_is_honoured_and_zeroed_reasons_name_the_rule():
    row = _dummy_row("1", sharpe=0.1)
    ok = apply_funnel([row], filters={"bounds": {"sharpe": {"min": 0.0}}}, cat_median_ters={"large_cap": 2.0})
    assert ok["counts"]["final"] == 1
    bad = apply_funnel([row], cat_median_ters={"large_cap": 2.0})
    assert bad["counts"]["zeroed_stage"] == "s4a" and bad["counts"]["zeroed_reasons"][0]["rule"] == "sharpe < 1"
