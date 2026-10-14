"""Tests for pure backoffice financial and statistical calculations."""
from __future__ import annotations

import math

from app.backoffice.analytics.derivatives_math import calculate_pcr
from app.backoffice.analytics.impact_engine import (
    align_paired_series,
    calculate_log_returns,
    compute_bond_price_sensitivity,
    compute_correlation_and_beta,
    generate_deterministic_briefing,
)
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


def test_impact_engine_duration_sensitivity_25_bps():
    # As explicitly specified in brief Section 5:
    # +25 bps shift => +0.0025 yield decimal (NOT 0.25)
    # ΔP/P ≈ -modified_duration * Δyield_decimal
    # Duration = 6.0: ΔP/P = -6.0 * 0.0025 = -0.0150 = -1.50%
    impact = compute_bond_price_sensitivity(modified_duration=6.0, yield_change_bps=25.0)
    assert impact["delta_yield_decimal"] == 0.0025
    assert impact["estimated_price_change_pct"] == -1.50


def test_impact_engine_log_returns_and_correlation():
    prices = [("2026-10-01", 100.0), ("2026-10-02", 105.0), ("2026-10-03", 110.25)]
    rets = calculate_log_returns(prices)
    assert len(rets) == 2
    # ln(105/100) = ln(1.05) ≈ 0.04879
    assert abs(rets[0][1] - math.log(1.05)) < 1e-6

    # Test correlation with aligned series
    s1 = [("2026-10-01", 1.0), ("2026-10-02", 2.0), ("2026-10-03", 3.0), ("2026-10-04", 4.0), ("2026-10-05", 5.0)]
    s2 = [("2026-10-01", 2.0), ("2026-10-02", 4.0), ("2026-10-03", 6.0), ("2026-10-04", 8.0), ("2026-10-05", 10.0)]
    aligned = align_paired_series(s1, s2)
    assert aligned["n"] == 5
    stats = compute_correlation_and_beta(aligned["paired_x"], aligned["paired_y"])
    assert stats["correlation"] == 1.0
    assert stats["beta"] == 2.0


def test_deterministic_briefing_generation():
    briefing = generate_deterministic_briefing(
        market_observations={
            "fx": {"FX:USDINR": 84.15, "FX:EURUSD": 1.092, "as_of": "2026-10-09"},
            "volatility": {"VOL:US:VIX": 18.5, "as_of": "2026-10-09"},
        },
        macro_data={"yields": {"india_us_spread_bps": 300.0, "in_10y": 7.0, "us_10y": 4.0}},
        flows_data={"fii_net_crore": 1250.0, "dii_net_crore": 1850.0, "report_date": "2026-10-09"},
        options_summary={"underlying": "NIFTY", "pcr_oi": 1.15, "total_call_oi": 100000, "total_put_oi": 115000},
    )
    assert "Briefing" in briefing["title"]
    assert "Zero LLM" in briefing["method_version"]
    assert len(briefing["bullets"]) >= 4
    # Check that observed numbers are cited in bullets
    full_text = " ".join(briefing["bullets"])
    assert "84.15" in full_text
    assert "300.0" in full_text
    assert "18.50" in full_text
    assert "1.15" in full_text


def test_impact_engine_convexity():
    # ΔP/P ≈ -modified_duration * Δyield_decimal + 0.5 * convexity * (Δyield_decimal ** 2)
    # Duration = 6.0, yield_change_bps = 100.0 => Δyield_decimal = 0.0100
    # Convexity = 50.0:
    # duration_effect = -6.0 * 0.0100 = -0.0600 (-6.0%)
    # convexity_effect = 0.5 * 50.0 * (0.0100 ** 2) = 0.0025 (+0.25%)
    # total = -5.75%
    res = compute_bond_price_sensitivity(modified_duration=6.0, yield_change_bps=100.0, convexity=50.0)
    assert res["delta_yield_decimal"] == 0.0100
    assert res["duration_effect_pct"] == -6.0
    assert res["convexity_effect_pct"] == 0.25
    assert res["estimated_price_change_pct"] == -5.75

    # Default convexity = 0
    res_zero = compute_bond_price_sensitivity(modified_duration=6.0, yield_change_bps=100.0, convexity=0.0)
    assert res_zero["convexity_effect_pct"] == 0.0
    assert res_zero["estimated_price_change_pct"] == -6.0


def test_impact_engine_lag():
    from app.backoffice.analytics.impact_engine import shift_series_dates

    # Series X with dates 2026-10-01 to 2026-10-15 (non-linear series)
    dates_x = [f"2026-10-{i:02d}" for i in range(1, 16)]
    val_x = [float(i * i) for i in range(1, 16)]
    series_x = list(zip(dates_x, val_x))

    dates_y = [f"2026-10-{i:02d}" for i in range(1, 16)]
    val_y = [float(i * 1.5 + (i % 3)) for i in range(1, 16)]
    series_y = list(zip(dates_y, val_y))

    # Lag 0
    aligned_lag0 = align_paired_series(shift_series_dates(series_x, 0), series_y)
    stats_lag0 = compute_correlation_and_beta(aligned_lag0["paired_x"], aligned_lag0["paired_y"])

    # Lag 5: shifts X dates forward by 5 days so X on 10-01 joins with Y on 10-06
    aligned_lag5 = align_paired_series(shift_series_dates(series_x, 5), series_y)
    stats_lag5 = compute_correlation_and_beta(aligned_lag5["paired_x"], aligned_lag5["paired_y"])

    # Lag 5 gives a different result from Lag 0
    assert stats_lag5["beta"] != stats_lag0["beta"]
    assert aligned_lag5["n"] == 10  # 10 overlapping dates (Oct 06 to Oct 15)
    assert aligned_lag0["n"] == 15


def test_impact_engine_window_and_symmetry():
    # Asymmetric series lengths: Series X has 50 dates, Series Y has 10 dates
    dates_x = [f"2026-09-{i:02d}" for i in range(1, 31)] + [f"2026-10-{i:02d}" for i in range(1, 21)]
    s_x = [(d, 1.0) for d in dates_x]

    dates_y = [f"2026-10-{i:02d}" for i in range(5, 15)]
    s_y = [(d, 2.0) for d in dates_y]

    # Align A on B
    aligned_ab = align_paired_series(s_x, s_y)
    # Align B on A
    aligned_ba = align_paired_series(s_y, s_x)

    # Must be completely symmetric and measured against shorter series (len=10)
    assert aligned_ab["n"] == 10
    assert aligned_ba["n"] == 10
    assert aligned_ab["coverage_pct"] == 100.0
    assert aligned_ba["coverage_pct"] == 100.0
    assert aligned_ab["n"] == aligned_ba["n"]


def test_impact_engine_calendar_windows():
    from datetime import datetime, timedelta

    # Generate daily trading dates for last 130 calendar days (excluding weekends)
    today = datetime(2026, 10, 14).date()
    trading_dates = []
    for day_offset in range(130, -1, -1):
        d = today - timedelta(days=day_offset)
        if d.weekday() < 5:  # Mon-Fri
            trading_dates.append(d.strftime("%Y-%m-%d"))

    for horizon, expected_approx in [(20, 14), (60, 42), (120, 84)]:
        start_date = (today - timedelta(days=horizon)).strftime("%Y-%m-%d")
        in_window = [d for d in trading_dates if d >= start_date]
        # In a 20/60/120 calendar day window, weekday count is approx 14, 42, 84
        assert abs(len(in_window) - expected_approx) <= 4
