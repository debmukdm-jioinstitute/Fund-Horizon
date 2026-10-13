"""Pure sequential funnel engine for mutual fund screening."""
from __future__ import annotations

import math
from typing import Any

# Gaps in these come from imports/feeds and are flagged `needs_data`. Any other gap is a metric that could not be
# computed (history shorter than its window), so the fund cannot be ranked: it is dropped as insufficient history.
IMPORTED_FIELDS = {"manager_name", "manager_tenure_years", "tenure_ratio", "expense_ratio", "cat_median_ter"}
DEFAULT_WEIGHTS = {"sharpe": 1.0, "sortino": 1.0, "capture_spread": 1.0, "roll_consistency": 1.0}


def _missing(r: dict[str, Any], fields: tuple[str, ...]) -> list[str]:
    out = []
    for f in fields:
        v = r.get(f)
        if v is None or v == "" or (isinstance(v, float) and math.isnan(v)):
            out.append(f)
    return out


def _z(vals: list[float | None]) -> list[float]:
    """Z-score; missing values and zero-variance sets score 0."""
    xs = [v for v in vals if v is not None]
    if len(xs) < 2:
        return [0.0] * len(vals)
    mu = sum(xs) / len(xs)
    sd = math.sqrt(sum((x - mu) ** 2 for x in xs) / len(xs))
    return [0.0 if v is None or sd == 0 else (v - mu) / sd for v in vals]


def _score(rows: list[dict[str, Any]], weights: dict[str, float]) -> None:
    def spread(r):
        u, d = r.get("up_capture"), r.get("down_capture")
        return None if u is None or d is None else float(u) - float(d)

    def num(r, k):
        v = r.get(k)
        return None if v is None else float(v)

    cols = {
        "sharpe": [num(r, "sharpe") for r in rows],
        "sortino": [num(r, "sortino") for r in rows],
        "capture_spread": [spread(r) for r in rows],
        "roll_consistency": [num(r, "roll_consistency") for r in rows],
    }
    zs = {k: _z(v) for k, v in cols.items()}
    for i, r in enumerate(rows):
        r["score"] = round(sum(float(weights.get(k, 0.0)) * zs[k][i] for k in zs), 3)
    rows.sort(key=lambda r: r["score"], reverse=True)


def apply_funnel(
    rows: list[dict[str, Any]],
    filters: dict[str, Any] | None = None,
    cat_median_ters: dict[str, float] | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Execute sequential 5-stage screening funnel.

    Stages:
    S0: Universe (input rows)
    S1: Manager named and tenure > min_tenure_years (default 3)
    S2: Selected ratio bounds (all pass if no bounds)
    S3: Up capture > 1, down capture < 1, quartile Q1 (retain) vs Q2/Q3 (review)
    S4a: Sortino >= 1, Sharpe >= 1, tenure_ratio >= 1
    S4c: Regular TER <= category median Regular TER

    A missing field never fails a fund: with include_missing (default) the fund
    passes flagged `needs_data`, otherwise it is dropped. Every drop records
    drop_stage and drop_reason.
    """
    filters = filters or {}
    min_tenure_years = float(filters.get("min_tenure_years", 3.0))
    bounds = filters.get("bounds") or {}
    quartiles_action = filters.get("quartiles_action", [2, 3])
    include_missing = bool(filters.get("include_missing", True))
    cat_median_ters = cat_median_ters or {}

    missing_by_stage: dict[str, dict[str, int]] = {s: {} for s in ("s1", "s2", "s3", "s4a", "s4c")}
    funds_missing = dict.fromkeys(missing_by_stage, 0)  # funds (not fields) with a gap, per stage
    sharpe_min = float((bounds.get("sharpe") or {}).get("min") or 1.0)
    sortino_min = float((bounds.get("sortino") or {}).get("min") or 1.0)
    use_ter = bool(filters.get("filter_ter_median", True))
    dropped: list[dict[str, Any]] = []

    def drop(r: dict[str, Any], stage: str, reason: str) -> None:
        dropped.append({
            "scheme_code": r.get("scheme_code"), "scheme_name": r.get("scheme_name"), "cat": r.get("cat"),
            "drop_stage": stage, "drop_reason": reason,
        })

    def gap(r: dict[str, Any], stage: str, fields: tuple[str, ...]) -> bool:
        """Record missing fields; True when the fund must be dropped for them."""
        miss = _missing(r, fields)
        if not miss:
            return False
        funds_missing[stage] += 1
        for f in miss:
            missing_by_stage[stage][f] = missing_by_stage[stage].get(f, 0) + 1
        short = [f for f in miss if f not in IMPORTED_FIELDS]
        if short:
            drop(r, stage, "insufficient history: " + ", ".join(short))
            return True
        if include_missing:
            r["needs_data"] = sorted(set(r.get("needs_data", [])) | set(miss))
            return False
        drop(r, stage, "missing " + ", ".join(miss))
        return True

    s0_rows = [dict(r) for r in rows]

    # S1: Manager filter
    s1_pass: list[dict[str, Any]] = []
    for r in s0_rows:
        if gap(r, "s1", ("manager_name", "manager_tenure_years")):
            continue
        t = r.get("manager_tenure_years")
        if t is not None and float(t) < min_tenure_years:
            drop(r, "s1", f"manager tenure {float(t):.1f}y < {min_tenure_years:g}y")
            continue
        s1_pass.append(r)

    # S2: Ratios filter (subset of S1)
    s2_pass: list[dict[str, Any]] = []
    active_bounds = {k: v for k, v in bounds.items() if isinstance(v, dict) and (v.get("min") is not None or v.get("max") is not None)}
    for r in s1_pass:
        if gap(r, "s2", tuple(active_bounds)):
            continue
        reason = None
        for k, b in active_bounds.items():
            if k in _missing(r, (k,)):
                continue
            fval = float(r[k])
            if b.get("min") is not None and fval < float(b["min"]):
                reason = f"{k} {fval:.2f} < {float(b['min']):g}"
                break
            if b.get("max") is not None and fval > float(b["max"]):
                reason = f"{k} {fval:.2f} > {float(b['max']):g}"
                break
        if reason:
            drop(r, "s2", reason)
        else:
            s2_pass.append(r)

    # S3: Capture + Quartile (subset of S2)
    s3_action: list[dict[str, Any]] = []
    s3_retain: list[dict[str, Any]] = []
    up_bound = float((bounds.get("up_capture") or {}).get("min") or 1.0)
    down_bound = float((bounds.get("down_capture") or {}).get("max") or 1.0)

    for r in s2_pass:
        if gap(r, "s3", ("up_capture", "down_capture", "quartile_2y")):
            continue
        up, down, q = r.get("up_capture"), r.get("down_capture"), r.get("quartile_2y")
        if up is not None and not float(up) > up_bound:
            drop(r, "s3", f"up_capture {float(up):.2f} <= {up_bound:g}")
        elif down is not None and not float(down) < down_bound:
            drop(r, "s3", f"down_capture {float(down):.2f} >= {down_bound:g}")
        elif q is not None and int(q) == 1:
            r["stage_flags"] = {"s1": True, "s2": True, "s3": True, "s4a": False, "s4c": False}
            r["action_status"] = "retain"
            s3_retain.append(r)
        elif q is not None and int(q) not in quartiles_action:
            drop(r, "s3", f"quartile {int(q)} not in action set")
        else:
            s3_action.append(r)

    # S4a: Sortino >= 1, Sharpe >= 1, tenure_ratio >= 1 (subset of S3 action)
    s4a_pass: list[dict[str, Any]] = []
    for r in s3_action:
        if gap(r, "s4a", ("sharpe", "sortino", "tenure_ratio")):
            continue
        mins = {"sharpe": sharpe_min, "sortino": sortino_min, "tenure_ratio": 1.0}
        fail = next((f"{k} {float(r[k]):.2f} < {m:g}" for k, m in mins.items() if r.get(k) is not None and float(r[k]) < m), None)
        if fail:
            drop(r, "s4a", fail)
        else:
            s4a_pass.append(r)

    # S4c: TER <= category median Regular TER (subset of S4a)
    final_action: list[dict[str, Any]] = []
    for r in s4a_pass:
        med_ter = cat_median_ters.get(r.get("cat", ""))
        if use_ter:
            miss = _missing(r, ("expense_ratio",)) + ([] if med_ter is not None else ["cat_median_ter"])
            if miss:
                funds_missing["s4c"] += 1
                for f in miss:
                    missing_by_stage["s4c"][f] = missing_by_stage["s4c"].get(f, 0) + 1
                if not include_missing:
                    drop(r, "s4c", "missing " + ", ".join(miss))
                    continue
                r["needs_data"] = sorted(set(r.get("needs_data", [])) | set(miss))
            elif float(r["expense_ratio"]) > float(med_ter):
                drop(r, "s4c", f"TER {float(r['expense_ratio']):.2f} > category median {float(med_ter):.2f}")
                continue
        r["stage_flags"] = {"s1": True, "s2": True, "s3": True, "s4a": True, "s4c": True}
        r["action_status"] = "review"
        final_action.append(r)

    _score(final_action, weights or DEFAULT_WEIGHTS)

    stage_n = {"s1": len(s1_pass), "s2": len(s2_pass), "s3": len(s3_action) + len(s3_retain),
               "s4a": len(s4a_pass), "s4c": len(final_action)}
    prev, zeroed = len(s0_rows), None
    for s, n in stage_n.items():
        if n == 0 and prev > 0:
            zeroed = s
            break
        prev = n

    counts = {
        "universe": len(s0_rows),
        "s1": len(s1_pass),
        "s2": len(s2_pass),
        "s3_action": len(s3_action),
        "s3_retain": len(s3_retain),
        "s3_dropped": sum(1 for d in dropped if d["drop_stage"] == "s3"),
        "s4a": len(s4a_pass),
        "final": len(final_action),
        "needs_data": sum(1 for r in final_action + s3_retain if r.get("needs_data")),
        "zeroed_stage": zeroed,
        "missing_by_stage": missing_by_stage,
        # kept for older saved runs / clients
        "insufficient_by_stage": funds_missing,
    }

    return {
        "counts": counts,
        "action": final_action,
        "retain": s3_retain,
        "dropped": dropped,
    }
