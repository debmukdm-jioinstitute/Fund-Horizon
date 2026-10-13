"""Unit tests for screening ratios and statistical formulas."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.engine import analytics as an


def test_beta_and_r_squared():
    dates = pd.date_range("2021-01-31", periods=24, freq="ME")
    # Benchmark returns: periodic returns with mean 0.01, std 0.03
    np.random.seed(42)
    b_rets = np.random.normal(0.01, 0.03, 24)
    # Fund returns: beta = 1.2, plus idiosyncratic noise
    f_rets = 1.2 * b_rets + np.random.normal(0.0, 0.005, 24)

    b_nav = pd.Series(100.0 * np.cumprod(1.0 + b_rets), index=dates)
    f_nav = pd.Series(100.0 * np.cumprod(1.0 + f_rets), index=dates)

    b_val = an.beta(f_nav, b_nav)
    assert b_val is not None
    assert abs(b_val - 1.2) < 0.10

    r2 = an.r_squared(f_nav, b_nav)
    assert r2 is not None
    assert 0.80 <= r2 <= 1.0

    # Test insufficient periods (< 12)
    short_f = f_nav.iloc[:10]
    short_b = b_nav.iloc[:10]
    assert an.beta(short_f, short_b) is None
    assert an.r_squared(short_f, short_b) is None


def test_jensen_alpha():
    # cagr_p = 15%, cagr_b = 12%, rf = 6.5%, beta = 1.1
    # Expected return = 6.5% + 1.1 * (12% - 6.5%) = 6.5% + 6.05% = 12.55%
    # Alpha = 15% - 12.55% = 2.45% = 0.0245
    alpha = an.jensen_alpha(0.15, 0.12, 1.1, rf=0.065)
    assert alpha is not None
    assert abs(alpha - 0.0245) < 1e-6

    # None handling
    assert an.jensen_alpha(None, 0.12, 1.1) is None
    assert an.jensen_alpha(0.15, None, 1.1) is None
    assert an.jensen_alpha(0.15, 0.12, None) is None


def test_tracking_error_and_information_ratio():
    dates = pd.date_range("2021-01-31", periods=24, freq="ME")
    b_rets = np.zeros(24)
    f_rets = np.zeros(24)
    # Add varying differences
    np.random.seed(123)
    diffs = np.random.normal(0.005, 0.02, 24)
    f_rets = b_rets + diffs

    b_nav = pd.Series(100.0 * np.cumprod(1.0 + b_rets), index=dates)
    f_nav = pd.Series(100.0 * np.cumprod(1.0 + f_rets), index=dates)

    te = an.tracking_error(f_nav, b_nav)
    assert te is not None
    # NAV pct_change has length len(navs) - 1
    actual_diffs = f_nav.pct_change().dropna() - b_nav.pct_change().dropna()
    expected_te = float(actual_diffs.std() * math.sqrt(12))
    assert abs(te - expected_te) < 1e-6

    # Information ratio: (CAGR_p - CAGR_b) / TE
    ir = an.information_ratio(0.14, 0.10, te)
    assert ir is not None
    assert abs(ir - (0.04 / te)) < 1e-6

    # Small TE (< 1e-4) returns None
    assert an.information_ratio(0.14, 0.10, 1e-5) is None
    assert an.information_ratio(None, 0.10, te) is None


def test_treynor_ratio():
    # cagr = 15%, beta = 1.2, rf = 6.5% -> (0.15 - 0.065) / 1.2 = 0.070833
    treynor = an.treynor_ratio(0.15, 1.2, rf=0.065)
    assert treynor is not None
    assert abs(treynor - (0.085 / 1.2)) < 1e-6

    # Zero or negligible beta returns None
    assert an.treynor_ratio(0.15, 1e-7) is None
    assert an.treynor_ratio(None, 1.2) is None


def test_tenure_ratio():
    # 3 years exactly (1095 days vs 3 * 365.25 = 1095.75 days)
    tr = an.tenure_ratio("2023-01-01", "2026-01-01", window_years=3.0)
    assert tr is not None
    assert abs(tr - 1.0) < 0.01

    # Less than 3 years (e.g. 1.5 years)
    tr_short = an.tenure_ratio("2024-07-01", "2026-01-01", window_years=3.0)
    assert tr_short is not None
    assert abs(tr_short - 0.5) < 0.05

    # Young fund (fund age 2 years, manager started with fund)
    tr_young = an.tenure_ratio(
        "2024-01-01",
        "2026-01-01",
        window_years=3.0,
        fund_first_date="2024-01-01",
    )
    assert tr_young is not None
    assert abs(tr_young - 1.0) < 0.01

    # Missing manager start returns None
    assert an.tenure_ratio(None, "2026-01-01") is None


def test_capture_ratio_wrap_and_match():
    dates = pd.date_range("2022-01-31", periods=24, freq="ME")
    # Positive months: fund outperforming
    b_rets = np.array([0.02 if i % 2 == 0 else -0.02 for i in range(24)])
    f_rets = np.array([0.025 if i % 2 == 0 else -0.015 for i in range(24)])

    b_nav = pd.Series(100.0 * np.cumprod(1.0 + b_rets), index=dates)
    f_nav = pd.Series(100.0 * np.cumprod(1.0 + f_rets), index=dates)

    caps = an.capture_ratios(f_nav, b_nav)
    assert caps["upside_capture"] is not None
    assert caps["downside_capture"] is not None

    # Wrapping percent to ratio units: 100 -> 1.00
    up_ratio = caps["upside_capture"] / 100.0
    down_ratio = caps["downside_capture"] / 100.0
    assert up_ratio > 1.0
    assert down_ratio < 1.0


def test_sharpe_and_sortino_consistency():
    dates = pd.date_range("2020-01-31", periods=37, freq="ME")
    np.random.seed(99)
    rets = np.random.normal(0.01, 0.04, 37)
    s_rand = pd.Series(100.0 * np.cumprod(1.0 + rets), index=dates)
    cagr_rand = an.trailing_return(s_rand, years=3)
    vol_rand = an.annualized_volatility(s_rand)
    sh_rand = an.sharpe_ratio(cagr_rand, vol_rand, rf=0.065)
    so_rand = an.sortino_ratio(s_rand, cagr_rand, rf=0.065)

    assert sh_rand is not None
    expected_sharpe = (cagr_rand - 0.065) / vol_rand
    assert abs(sh_rand - expected_sharpe) < 1e-6
    if so_rand is not None:
        downside = s_rand.pct_change().dropna()
        down = downside[downside < 0]
        down_vol = float(down.std() * math.sqrt(12))
        assert abs(so_rand - ((cagr_rand - 0.065) / down_vol)) < 1e-6
