from __future__ import annotations
"""Brinson-Fachler attribution & portfolio contribution engine.

Implements standard benchmark-relative Brinson-Fachler performance attribution:
- Allocation Effect: A_i = (w_p,i - w_b,i) * (R_b,i - R_b)
- Selection Effect:  S_i = w_b,i * (R_p,i - R_b,i)
- Interaction Effect: I_i = (w_p,i - w_b,i) * (R_p,i - R_b,i)

Total Active Return:
  Active Return = R_p - R_b = sum(A_i + S_i + I_i)

Multi-period linking:
  Uses GRAP (Geometric Return Attribution Program) / Menchero linking coefficients:
  L_t = (ln(1 + R_p,t) - ln(1 + R_b,t)) / (R_p,t - R_b,t)
"""

from typing import Any


def calculate_brinson_fachler(
    portfolio_sectors: list[dict[str, Any]],
    benchmark_sectors: list[dict[str, Any]],
    total_portfolio_return: float | None = None,
    total_benchmark_return: float | None = None,
) -> dict[str, Any]:
    """Calculate single-period Brinson-Fachler attribution across sectors.

    Each sector dict requires:
    - `sector`: str (e.g. "Financials", "Information Technology")
    - `weight`: float (between 0.0 and 1.0, summing to 1.0)
    - `return`: float (percentage return or decimal; must be consistent across portfolio and benchmark)
    """
    b_map = {s["sector"]: s for s in benchmark_sectors}
    p_map = {s["sector"]: s for s in portfolio_sectors}
    all_sectors = sorted(set(b_map.keys()) | set(p_map.keys()))

    # Compute overall benchmark return if not provided
    R_b = total_benchmark_return
    if R_b is None:
        R_b = sum(s["weight"] * s["return"] for s in benchmark_sectors)

    # Compute overall portfolio return if not provided
    R_p = total_portfolio_return
    if R_p is None:
        R_p = sum(s["weight"] * s["return"] for s in portfolio_sectors)

    active_return = R_p - R_b

    breakdown = []
    sum_alloc = 0.0
    sum_select = 0.0
    sum_interact = 0.0

    for sec in all_sectors:
        p_sec = p_map.get(sec, {"weight": 0.0, "return": 0.0})
        b_sec = b_map.get(sec, {"weight": 0.0, "return": 0.0})

        wp = float(p_sec.get("weight") or 0.0)
        rp = float(p_sec.get("return") or 0.0)
        wb = float(b_sec.get("weight") or 0.0)
        rb = float(b_sec.get("return") or 0.0)

        # Brinson-Fachler formulas:
        # Allocation: (wp - wb) * (rb - R_b)
        alloc = (wp - wb) * (rb - R_b)
        # Selection: wb * (rp - rb)
        select = wb * (rp - rb)
        # Interaction: (wp - wb) * (rp - rb)
        interact = (wp - wb) * (rp - rb)
        total_effect = alloc + select + interact

        sum_alloc += alloc
        sum_select += select
        sum_interact += interact

        breakdown.append({
            "sector": sec,
            "portfolio_weight": round(wp, 4),
            "benchmark_weight": round(wb, 4),
            "portfolio_return": round(rp, 4),
            "benchmark_return": round(rb, 4),
            "allocation_effect": round(alloc, 4),
            "selection_effect": round(select, 4),
            "interaction_effect": round(interact, 4),
            "total_effect": round(total_effect, 4),
        })

    sum_effects = sum_alloc + sum_select + sum_interact
    residual = active_return - sum_effects

    return {
        "status": "calculated",
        "methodology": "Brinson-Fachler",
        "portfolio_return": round(R_p, 4),
        "benchmark_return": round(R_b, 4),
        "active_return": round(active_return, 4),
        "allocation_effect": round(sum_alloc, 4),
        "selection_effect": round(sum_select, 4),
        "interaction_effect": round(sum_interact, 4),
        "sum_effects": round(sum_effects, 4),
        "residual": round(residual, 6) if abs(residual) > 1e-6 else 0.0,
        "sectors": breakdown,
    }


def calculate_portfolio_contribution(
    holdings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Calculate security / asset-level weighted contribution:
    Contribution_i = Weight_i * Return_i.
    """
    contributions = []
    for h in holdings:
        weight = float(h.get("weight") or 0.0)
        ret = float(h.get("return") or 0.0)
        contrib = weight * ret
        contributions.append({
            "security": h.get("security") or h.get("name") or "Unknown",
            "sector": h.get("sector") or "Unclassified",
            "weight": round(weight, 4),
            "return": round(ret, 4),
            "contribution": round(contrib, 4),
            "shares": h.get("shares"),
            "value": h.get("value"),
        })

    # Sort descending by contribution
    contributions.sort(key=lambda x: x["contribution"], reverse=True)
    return contributions
