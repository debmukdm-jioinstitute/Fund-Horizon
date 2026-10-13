"""Pure sequential funnel engine for mutual fund screening."""
from __future__ import annotations

import math
from typing import Any


def apply_funnel(
    rows: list[dict[str, Any]],
    filters: dict[str, Any] | None = None,
    cat_median_ters: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Execute sequential 5-stage screening funnel.

    Stages:
    S0: Universe (input rows)
    S1: Manager named and tenure >= min_tenure_years (default 3)
    S2: Selected ratio bounds (all pass if no bounds)
    S3: Up capture > 1, down capture < 1, quartile Q1 (retain) vs Q2/Q3 (review)
    S4a: Sortino >= 1, Sharpe >= 1, tenure_ratio >= 1
    S4c: Regular TER <= category median Regular TER
    """
    filters = filters or {}
    min_tenure_years = float(filters.get("min_tenure_years", 3.0))
    bounds = filters.get("bounds") or {}
    quartiles_action = filters.get("quartiles_action", [2, 3])
    cat_median_ters = cat_median_ters or {}

    # Initialize counters
    insufficient_by_stage = {"s1": 0, "s2": 0, "s3": 0, "s4a": 0, "s4c": 0}

    s0_rows = rows
    s1_pass: list[dict[str, Any]] = []

    # S1: Manager filter
    for r in s0_rows:
        mgr_name = r.get("manager_name")
        tenure = r.get("manager_tenure_years")
        if not mgr_name or tenure is None:
            insufficient_by_stage["s1"] += 1
            continue
        if float(tenure) >= min_tenure_years:
            s1_pass.append(r)

    # S2: Ratios filter (subset of S1)
    s2_pass: list[dict[str, Any]] = []
    active_bounds = {k: v for k, v in bounds.items() if isinstance(v, dict) and (v.get("min") is not None or v.get("max") is not None)}

    for r in s1_pass:
        passes_s2 = True
        is_insufficient = False
        for k, b in active_bounds.items():
            val = r.get(k)
            if val is None or (isinstance(val, float) and math.isnan(val)):
                is_insufficient = True
                passes_s2 = False
                break
            fval = float(val)
            if b.get("min") is not None and fval < float(b["min"]):
                passes_s2 = False
                break
            if b.get("max") is not None and fval > float(b["max"]):
                passes_s2 = False
                break
        if is_insufficient:
            insufficient_by_stage["s2"] += 1
        elif passes_s2:
            s2_pass.append(r)

    # S3: Capture + Quartile (subset of S2)
    s3_action: list[dict[str, Any]] = []
    s3_retain: list[dict[str, Any]] = []
    s3_dropped_count = 0

    up_bound = float(bounds.get("up_capture", {}).get("min", 1.0) or 1.0)
    down_bound = float(bounds.get("down_capture", {}).get("max", 1.0) or 1.0)

    for r in s2_pass:
        up_cap = r.get("up_capture")
        down_cap = r.get("down_capture")
        q = r.get("quartile_2y")

        if up_cap is None or down_cap is None or q is None:
            insufficient_by_stage["s3"] += 1
            continue

        up_val = float(up_cap)
        down_val = float(down_cap)
        q_val = int(q)

        # Rule: up_capture > 1.0 and down_capture < 1.0 (or custom bounds)
        if up_val > up_bound and down_val < down_bound:
            if q_val == 1:
                # Q1 retain list (excluded from action list)
                row_copy = dict(r)
                row_copy["stage_flags"] = {"s1": True, "s2": True, "s3": True, "s4a": False, "s4c": False}
                row_copy["action_status"] = "retain"
                s3_retain.append(row_copy)
            elif q_val in quartiles_action:
                s3_action.append(r)
            else:
                s3_dropped_count += 1
        else:
            s3_dropped_count += 1

    # S4a: Sortino >= 1, Sharpe >= 1, tenure_ratio >= 1 (subset of S3 action)
    s4a_pass: list[dict[str, Any]] = []
    for r in s3_action:
        sh = r.get("sharpe")
        so = r.get("sortino")
        tr = r.get("tenure_ratio")

        if sh is None or so is None or tr is None:
            insufficient_by_stage["s4a"] += 1
            continue

        if float(sh) >= 1.0 and float(so) >= 1.0 and float(tr) >= 1.0:
            s4a_pass.append(r)

    # S4c: TER <= category median Regular TER (subset of S4a)
    final_action: list[dict[str, Any]] = []
    for r in s4a_pass:
        exp = r.get("expense_ratio")
        cat = r.get("cat", "")
        med_ter = cat_median_ters.get(cat)

        if exp is None or med_ter is None:
            insufficient_by_stage["s4c"] += 1
            continue

        if float(exp) <= float(med_ter):
            row_copy = dict(r)
            row_copy["stage_flags"] = {"s1": True, "s2": True, "s3": True, "s4a": True, "s4c": True}
            row_copy["action_status"] = "review"
            final_action.append(row_copy)

    counts = {
        "universe": len(s0_rows),
        "s1": len(s1_pass),
        "s2": len(s2_pass),
        "s3_action": len(s3_action),
        "s3_retain": len(s3_retain),
        "s3_dropped": s3_dropped_count,
        "s4a": len(s4a_pass),
        "final": len(final_action),
        "insufficient_by_stage": insufficient_by_stage,
    }

    return {
        "counts": counts,
        "action": final_action,
        "retain": s3_retain,
    }
