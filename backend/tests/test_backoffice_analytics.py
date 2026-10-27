"""Tests for pure backoffice financial and statistical calculations."""
from __future__ import annotations

import math

from app.backoffice.analytics.derivatives_math import calculate_pcr
from app.backoffice.analytics.pms_math import (
    calculate_cagr,
    calculate_modified_dietz,
    calculate_xirr,
    estimate_hwm_fee,
)
from app.backoffice.analytics.yields_math import (
    calculate_spread_bps,
    compute_cross_country_spread,
    compute_yield_curve_summary,
)


def test_spread_bps_exact_300_bps_example():
    # As explicitly specified in the brief:
    # 7.0% - 4.0% = 300 bps
    spread = calculate_spread_bps(7.0, 4.0)
    assert spread == 300.0

    cross = compute_cross_country_spread(7.0, 4.0, "India", "US")
    assert cross["spread_bps"] == 300.0
    assert cross["status"] == "current"


def test_yield_curve_summary():
    tenors = [
        {"tenor": "2Y", "yield_pct": 6.85},
        {"tenor": "10Y", "yield_pct": 7.15},
    ]
    summary = compute_yield_curve_summary(tenors)
    assert summary["slope_10y_2y_bps"] == 30.0
    assert summary["inverted"] is False

    inverted_tenors = [
        {"tenor": "2Y", "yield_pct": 7.20},
        {"tenor": "10Y", "yield_pct": 6.80},
    ]
    inv_summary = compute_yield_curve_summary(inverted_tenors)
    assert inv_summary["slope_10y_2y_bps"] == -40.0
    assert inv_summary["inverted"] is True


def test_cagr_calculation():
    # Double in 3 years (~365.25 * 3 days): 2^(1/3) - 1 ≈ 25.99%
    cagr = calculate_cagr(100.0, 200.0, 365.25 * 3)
    assert cagr is not None
    assert round(cagr * 100.0, 2) == 25.99

    # Zero or negative inputs return None
    assert calculate_cagr(-10.0, 100.0, 365) is None
    assert calculate_cagr(100.0, 0.0, 365) is None
    assert calculate_cagr(100.0, 120.0, 2) is None  # too short


def test_xirr_solver_known_cashflows():
    # 1 year 10% return: invest 100 on Jan 1, receive 110 on Dec 31
    flows = [
        ("2025-01-01", -100.0),
        ("2026-01-01", 110.0),
    ]
    res = calculate_xirr(flows)
    assert res["status"] == "converged"
    assert abs(res["xirr"] - 0.10) < 0.005


def test_xirr_diagnostics_on_invalid_inputs():
    # Missing opposite signs
    res_no_sign = calculate_xirr([("2025-01-01", 100.0), ("2026-01-01", 120.0)])
    assert res_no_sign["status"] == "no_sign_change"
    assert res_no_sign["xirr"] is None

    # Insufficient rows
    res_insuf = calculate_xirr([("2025-01-01", -100.0)])
    assert res_insuf["status"] == "insufficient_data"


def test_modified_dietz():
    # Start: 100k, End: 120k. Inflow of 10k at mid-year (t = 180 of 360 days)
    # Gain = 120k - 100k - 10k = 10k
    # Denom = 100k + (0.5 * 10k) = 105k
    # Return = 10k / 105k ≈ 9.5238%
    cashflows = [("2026-07-01", 10000.0)]
    res = calculate_modified_dietz(
        v_start=100000.0,
        v_end=120000.0,
        cashflows=cashflows,
        period_start="2026-01-01",
        period_end="2026-12-27",
    )
    assert res["return"] is not None
    assert round(res["return_pct"], 1) == 9.5


def test_hwm_fee_estimation():
    # Current value = 1.2 Crore (12,000,00000 paise), HWM = 1.0 Crore (10,000,00000 paise)
    # Gain = 20,00000 paise. 20% perf fee = 4,00000 paise
    res = estimate_hwm_fee(
        current_value_paise=1200000000,
        high_water_mark_paise=1000000000,
        perf_fee_pct=20.0,
    )
    assert res["eligible"] is True
    assert res["hwm_exceeded"] is True
    assert res["gain_above_hwm_paise"] == 200000000
    assert res["estimated_fee_paise"] == 40000000

    # Below HWM
    res_below = estimate_hwm_fee(
        current_value_paise=900000000,
        high_water_mark_paise=1000000000,
        perf_fee_pct=20.0,
    )
    assert res_below["hwm_exceeded"] is False
    assert res_below["estimated_fee_paise"] == 0


def test_derivatives_pcr_calculation():
    contracts = [
        {"strike_price": 25000, "option_type": "CE", "oi": 1000, "volume": 500, "expiry_date": "2026-10-29"},
        {"strike_price": 25000, "option_type": "PE", "oi": 1200, "volume": 750, "expiry_date": "2026-10-29"},
        {"strike_price": 25100, "option_type": "CE", "oi": 1000, "volume": 500, "expiry_date": "2026-10-29"},
        {"strike_price": 25100, "option_type": "PE", "oi": 800, "volume": 250, "expiry_date": "2026-10-29"},
    ]
    # Total Call OI = 2000, Put OI = 2000 => PCR OI = 1.0
    # Total Call Vol = 1000, Put Vol = 1000 => PCR Vol = 1.0
    res = calculate_pcr(contracts)
    assert res["pcr_oi"] == 1.0
    assert res["pcr_volume"] == 1.0
    assert res["status"] == "ready"

    # Zero denominator
    call_zero = [
        {"strike_price": 25000, "option_type": "CE", "oi": 0, "volume": 0},
        {"strike_price": 25000, "option_type": "PE", "oi": 100, "volume": 50},
    ]
    res_zero = calculate_pcr(call_zero)
    assert res_zero["pcr_oi"] is None
    assert "Zero call open interest" in res_zero["pcr_oi_reason"]
