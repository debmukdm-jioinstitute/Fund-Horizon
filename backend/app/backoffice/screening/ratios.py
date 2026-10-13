"""Calculation of screening ratios and metrics per mutual fund scheme."""
from __future__ import annotations

from datetime import date
from typing import Any

import pandas as pd

from app.engine import analytics as an


def rolling_consistency(fund: pd.Series, bench: pd.Series | None) -> float | None:
    """Share of rolling 1Y windows (monthly step, last 5Y) where the fund beat the benchmark."""
    if bench is None or bench.empty:
        return None
    start = fund.index[-1] - pd.DateOffset(years=5)
    m = pd.concat([fund, bench], axis=1, join="inner").loc[start:].resample("ME").last().dropna()
    r = m.pct_change(12).dropna()
    return float((r.iloc[:, 0] > r.iloc[:, 1]).mean()) if len(r) >= 12 else None


def compute_scheme_metrics(
    scheme_code: str,
    fund_nav: pd.Series,
    cat: str,
    amc: str | None,
    scheme_name: str,
    bench_nav: pd.Series | None,
    rf: float = 0.065,
    manager_info: dict[str, Any] | None = None,
    expense_ratio: float | None = None,
    first_nav_date: str | date | None = None,
    cat_medians_dict: dict[str, float | None] | None = None,
    benchmark_source: str = "category_median",
    rf_source: str = "assumptions_fixed",
) -> dict[str, Any]:
    """Compute full metrics row for mf_screening_metrics table."""
    if fund_nav.empty or len(fund_nav) < 2:
        return {}

    as_of_str = fund_nav.index[-1].strftime("%Y-%m-%d")
    history_years = float((fund_nav.index[-1] - fund_nav.index[0]).days / 365.25)

    # Return series
    ret_1y = an.trailing_return(fund_nav, years=1)
    cagr_3y = an.trailing_return(fund_nav, years=3)
    cagr_5y = an.trailing_return(fund_nav, years=5)
    cagr_si = an.cagr(fund_nav)

    # Benchmark returns
    bench_1y = an.trailing_return(bench_nav, years=1) if bench_nav is not None and len(bench_nav) >= 2 else None
    bench_3y = an.trailing_return(bench_nav, years=3) if bench_nav is not None and len(bench_nav) >= 2 else None
    bench_5y = an.trailing_return(bench_nav, years=5) if bench_nav is not None and len(bench_nav) >= 2 else None
    bench_si = an.cagr(bench_nav) if bench_nav is not None and len(bench_nav) >= 2 else None

    # Risk window: 3Y
    start_3y = fund_nav.index[-1] - pd.DateOffset(years=3)
    nav_3y = fund_nav.loc[fund_nav.index >= start_3y]
    b_3y = bench_nav.loc[bench_nav.index >= start_3y] if bench_nav is not None and not bench_nav.empty else pd.Series(dtype=float)

    std_dev = an.annualized_volatility(nav_3y) if len(nav_3y) >= 12 else None
    beta_val = an.beta(nav_3y, b_3y) if len(b_3y) >= 12 else None
    alpha_val = an.jensen_alpha(cagr_3y, bench_3y, beta_val, rf=rf)
    r2_val = an.r_squared(nav_3y, b_3y) if len(b_3y) >= 12 else None
    te_val = an.tracking_error(nav_3y, b_3y) if len(b_3y) >= 12 else None
    ir_val = an.information_ratio(cagr_3y, bench_3y, te_val)
    treynor_val = an.treynor_ratio(cagr_3y, beta_val, rf=rf)
    sharpe_val = an.sharpe_ratio(cagr_3y, std_dev, rf=rf) if std_dev is not None else None
    sortino_val = an.sortino_ratio(nav_3y, cagr_3y, rf=rf) if len(nav_3y) >= 12 else None
    mdd_val = an.max_drawdown(nav_3y) if len(nav_3y) >= 2 else None

    # Capture window: 2Y
    start_2y = fund_nav.index[-1] - pd.DateOffset(years=2)
    nav_2y = fund_nav.loc[fund_nav.index >= start_2y]
    b_2y = bench_nav.loc[bench_nav.index >= start_2y] if bench_nav is not None and not bench_nav.empty else pd.Series(dtype=float)
    caps = an.capture_ratios(nav_2y, b_2y) if len(b_2y) >= 12 else {"upside_capture": None, "downside_capture": None}
    up_capture = caps["upside_capture"] / 100.0 if caps.get("upside_capture") is not None else None
    down_capture = caps["downside_capture"] / 100.0 if caps.get("downside_capture") is not None else None

    # Manager details
    mgr_name = manager_info.get("manager_name") if manager_info else None
    mgr_start = manager_info.get("manager_start") if manager_info else None
    mgr_tenure = None
    if mgr_start:
        try:
            d_start = pd.Timestamp(mgr_start).date()
            d_asof = pd.Timestamp(as_of_str).date()
            if d_start <= d_asof:
                mgr_tenure = float((d_asof - d_start).days / 365.25)
        except Exception:
            pass

    t_ratio = an.tenure_ratio(mgr_start, as_of_str, window_years=3.0, fund_first_date=first_nav_date)

    cat_medians_dict = cat_medians_dict or {}

    return {
        "scheme_code": scheme_code,
        "as_of": as_of_str,
        "cat": cat,
        "amc": amc,
        "scheme_name": scheme_name,
        "manager_name": mgr_name,
        "manager_tenure_years": mgr_tenure,
        "tenure_ratio": t_ratio,
        "alpha": alpha_val,
        "beta": beta_val,
        "std_dev": std_dev,
        "r_squared": r2_val,
        "information_ratio": ir_val,
        "tracking_error": te_val,
        "treynor": treynor_val,
        "sharpe": sharpe_val,
        "sortino": sortino_val,
        "up_capture": up_capture,
        "down_capture": down_capture,
        "max_drawdown": mdd_val,
        "expense_ratio": expense_ratio,
        "ret_1y": ret_1y,
        "cagr_3y": cagr_3y,
        "cagr_5y": cagr_5y,
        "cagr_si": cagr_si,
        "bench_1y": bench_1y,
        "bench_3y": bench_3y,
        "bench_5y": bench_5y,
        "bench_si": bench_si,
        "cat_avg_1y": cat_medians_dict.get("1y"),
        "cat_avg_3y": cat_medians_dict.get("3y"),
        "cat_avg_5y": cat_medians_dict.get("5y"),
        "cat_avg_si": cat_medians_dict.get("si"),
        "roll_consistency": rolling_consistency(fund_nav, bench_nav),
        "quartile_2y": None,  # to be set by cascade
        "quartile_source": None,
        "rf_source": rf_source,
        "benchmark_source": benchmark_source,
        "history_years": history_years,
        "quality_flags": "ok",
        "provenance_json": "{}",
    }
