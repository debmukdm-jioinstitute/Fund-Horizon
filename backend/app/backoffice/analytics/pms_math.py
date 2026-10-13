"""Mathematical calculation engine for PMS & Portfolio accounting.

Calculations:
- CAGR with positive basis and actual calendar day count
- XIRR solver with Newton-Raphson + Bisection fallback and convergence diagnostics
- TWR with valuation boundaries and Modified Dietz fallback
- Flow-adjusted High-Water Mark (HWM) and performance fee estimates
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any


def calculate_cagr(start_val: float, end_val: float, days: float) -> float | None:
    """Calculate CAGR: (end_val / start_val) ** (365.25 / days) - 1.

    Returns None if start_val <= 0, end_val <= 0, or duration is invalid.
    """
    if start_val <= 0 or end_val <= 0 or days <= 0:
        return None
    years = days / 365.25
    if years < 0.05:  # Less than ~18 days has no meaningful annualized compounding
        return None
    try:
        return math.pow(end_val / start_val, 1.0 / years) - 1.0
    except (ValueError, OverflowError):
        return None


def calculate_xirr(
    cashflows: list[tuple[str, float]],
    terminal_value: float | None = None,
    terminal_date: str | None = None,
    tol: float = 1e-6,
    max_iter: int = 100,
) -> dict[str, Any]:
    """Calculate XIRR from dated cash flows.

    Convention:
    - Investor contributions/inflows: negative
    - Investor withdrawals/distributions: positive
    - Terminal valuation at terminal_date: positive

    Returns a dict with `xirr` (float or None), `status` ("converged", "insufficient_data", "no_sign_change", "did_not_converge"),
    `iterations`, and `residual`.
    """
    flows = list(cashflows)
    if terminal_value is not None and terminal_date is not None and terminal_value > 0:
        flows.append((terminal_date, terminal_value))

    if len(flows) < 2:
        return {
            "xirr": None,
            "status": "insufficient_data",
            "message": "At least 2 dated cash flows are required.",
            "iterations": 0,
            "residual": None,
        }

    # Parse and sort dates
    parsed_flows: list[tuple[datetime, float]] = []
    has_positive = False
    has_negative = False

    for date_str, amount in flows:
        if amount == 0:
            continue
        if amount > 0:
            has_positive = True
        else:
            has_negative = True
        dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        parsed_flows.append((dt, amount))

    if not (has_positive and has_negative):
        return {
            "xirr": None,
            "status": "no_sign_change",
            "message": "Cash flows must contain at least one positive and one negative amount.",
            "iterations": 0,
            "residual": None,
        }

    parsed_flows.sort(key=lambda x: x[0])
    base_date = parsed_flows[0][0]
    dates_in_years = [(dt - base_date).days / 365.25 for dt, _ in parsed_flows]
    amounts = [amt for _, amt in parsed_flows]

    def npv(rate: float) -> float:
        if rate <= -0.9999:
            return float("inf")
        val = 0.0
        for y, c in zip(dates_in_years, amounts):
            val += c / math.pow(1.0 + rate, y)
        return val

    def npv_prime(rate: float) -> float:
        if rate <= -0.9999:
            return float("-inf")
        val = 0.0
        for y, c in zip(dates_in_years, amounts):
            if y == 0:
                continue
            val -= y * c / math.pow(1.0 + rate, y + 1.0)
        return val

    # 1. Newton-Raphson starting at 10%
    rate = 0.10
    for i in range(max_iter):
        f = npv(rate)
        if abs(f) < tol:
            return {
                "xirr": round(rate, 6),
                "status": "converged",
                "iterations": i + 1,
                "residual": abs(f),
            }
        f_prime = npv_prime(rate)
        if abs(f_prime) < 1e-12:
            break
        new_rate = rate - f / f_prime
        if new_rate <= -0.99 or new_rate > 10.0:
            break
        rate = new_rate

    # 2. Bisection fallback in [-0.95, 5.0]
    low = -0.95
    high = 5.0
    f_low = npv(low)
    f_high = npv(high)

    if f_low * f_high <= 0:
        for i in range(max_iter):
            mid = (low + high) / 2.0
            f_mid = npv(mid)
            if abs(f_mid) < tol or (high - low) / 2.0 < tol:
                return {
                    "xirr": round(mid, 6),
                    "status": "converged",
                    "iterations": i + 1,
                    "residual": abs(f_mid),
                }
            if f_low * f_mid <= 0:
                high = mid
                f_high = f_mid
            else:
                low = mid
                f_low = f_mid

    return {
        "xirr": None,
        "status": "did_not_converge",
        "message": "Solver did not converge within acceptable bounds.",
        "iterations": max_iter,
        "residual": abs(npv(rate)),
    }


def calculate_modified_dietz(
    v_start: float,
    v_end: float,
    cashflows: list[tuple[str, float]],
    period_start: str,
    period_end: str,
) -> dict[str, Any]:
    """Calculate Modified Dietz return:

    R = (V_end - V_start - sum(CF)) / (V_start + sum(W_i * CF))
    where W_i = (T - t_i) / T, and CF > 0 represents capital additions.
    """
    dt_start = datetime.strptime(period_start[:10], "%Y-%m-%d")
    dt_end = datetime.strptime(period_end[:10], "%Y-%m-%d")
    total_days = (dt_end - dt_start).days
    if total_days <= 0:
        return {"return": None, "method": "Modified Dietz", "error": "Invalid period dates"}

    sum_flows = 0.0
    weighted_flows = 0.0

    for flow_date, amount in cashflows:
        dt_flow = datetime.strptime(flow_date[:10], "%Y-%m-%d")
        days_from_start = (dt_flow - dt_start).days
        weight = (total_days - days_from_start) / total_days
        sum_flows += amount
        weighted_flows += weight * amount

    denominator = v_start + weighted_flows
    if abs(denominator) < 1e-6:
        return {"return": None, "method": "Modified Dietz", "error": "Zero or near-zero weighted denominator"}

    numerator = v_end - v_start - sum_flows
    r = numerator / denominator
    return {
        "return": round(r, 6),
        "return_pct": round(r * 100.0, 4),
        "method": "Modified Dietz (Estimated)",
        "numerator": round(numerator, 2),
        "weighted_denominator": round(denominator, 2),
    }


def estimate_hwm_fee(
    current_value_paise: int,
    high_water_mark_paise: int,
    perf_fee_pct: float | None,
    hurdle_pct: float | None = 0.0,
    hurdle_amount_paise: int = 0,
) -> dict[str, Any]:
    """Estimate PMS performance fee above High-Water Mark."""
    if not perf_fee_pct or perf_fee_pct <= 0:
        return {
            "eligible": False,
            "estimated_fee_paise": 0,
            "hwm_exceeded": False,
            "gain_above_hwm_paise": 0,
            "label": "No performance fee configured",
        }

    effective_benchmark = max(high_water_mark_paise, hurdle_amount_paise)
    gain_paise = current_value_paise - effective_benchmark

    if gain_paise > 0:
        fee_paise = int(round(gain_paise * (perf_fee_pct / 100.0)))
        return {
            "eligible": True,
            "hwm_exceeded": True,
            "gain_above_hwm_paise": gain_paise,
            "estimated_fee_paise": fee_paise,
            "label": f"Estimated performance fee ({perf_fee_pct}%) above HWM",
        }
    else:
        return {
            "eligible": False,
            "hwm_exceeded": False,
            "gain_above_hwm_paise": 0,
            "estimated_fee_paise": 0,
            "label": "Valuation below High-Water Mark / Hurdle",
        }
