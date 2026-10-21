from __future__ import annotations
from app.db.d1 import on_workers
"""Reproducible, Explainable Impact Engine and Deterministic Research Briefing.

Key invariants:
- Zero paid LLM calls: pure deterministic math and structured factual templates.
- Log returns for asset prices: ln(P_t / P_{t-1}).
- Basis point changes for yields and spreads: (Y_t - Y_{t-1}) * 100.
- Strict date alignment: require >=80% paired observations, actual sample size n reported.
- Zero forward-filling of lower-frequency data into higher-frequency samples.
- Bond price duration + convexity sensitivity:
  ΔP/P ≈ -modified_duration * Δyield_decimal + 0.5 * convexity * (Δyield_decimal ** 2)
  (+25 bps shock => +0.0025, NOT 0.25).
"""

import math
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
if not on_workers():
    import statsmodels.api as sm

_SCENARIO_COEFF_CACHE: dict[str, tuple[float, str]] = {}


def calculate_log_returns(dated_prices: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Compute log returns: ln(P_t / P_{t-1}) for sorted chronological prices."""
    sorted_prices = sorted(dated_prices, key=lambda x: x[0])
    returns: list[tuple[str, float]] = []
    for i in range(1, len(sorted_prices)):
        prev_p = sorted_prices[i - 1][1]
        curr_p = sorted_prices[i][1]
        if prev_p > 0 and curr_p > 0:
            ret = math.log(curr_p / prev_p)
            returns.append((sorted_prices[i][0], ret))
    return returns


def calculate_bps_changes(dated_yields: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Compute yield changes in basis points: (Y_t - Y_{t-1}) * 100."""
    sorted_yields = sorted(dated_yields, key=lambda x: x[0])
    changes: list[tuple[str, float]] = []
    for i in range(1, len(sorted_yields)):
        prev_y = sorted_yields[i - 1][1]
        curr_y = sorted_yields[i][1]
        bps_diff = (curr_y - prev_y) * 100.0
        changes.append((sorted_yields[i][0], bps_diff))
    return changes


def shift_series_dates(
    series: list[tuple[str, float]],
    lag_days: int,
) -> list[tuple[str, float]]:
    """Apply lag by shifting series X dates forward by lag_days calendar days before the date join."""
    if not lag_days:
        return list(series)
    shifted: list[tuple[str, float]] = []
    for date_str, val in series:
        try:
            d = datetime.strptime(date_str[:10], "%Y-%m-%d").date()
            new_d = (d + timedelta(days=lag_days)).strftime("%Y-%m-%d")
            shifted.append((new_d, val))
        except (ValueError, TypeError):
            shifted.append((date_str, val))
    return shifted


def align_paired_series(
    series_x: list[tuple[str, float]],
    series_y: list[tuple[str, float]],
    min_coverage_pct: float = 80.0,
) -> dict[str, Any]:
    """Align two dated series by exact calendar date.
    Measures coverage against the shorter series so the result does not depend on order of A and B.
    """
    dict_x = dict(series_x)
    dict_y = dict(series_y)
    common_dates = sorted(set(dict_x.keys()).intersection(set(dict_y.keys())))

    shorter_len = min(len(dict_x), len(dict_y))
    if shorter_len == 0:
        return {
            "paired_x": [],
            "paired_y": [],
            "dates": [],
            "n": 0,
            "coverage_pct": 0.0,
            "status": "insufficient_data",
            "reason": "no_data",
        }

    coverage = (len(common_dates) / shorter_len) * 100.0
    status = "ready" if coverage >= min_coverage_pct else "low_coverage"
    reason = None
    if status == "low_coverage":
        reason = "low_overlap"
    elif len(common_dates) < 5:
        reason = "n<5"

    paired_x = [dict_x[d] for d in common_dates]
    paired_y = [dict_y[d] for d in common_dates]

    return {
        "paired_x": paired_x,
        "paired_y": paired_y,
        "dates": common_dates,
        "n": len(common_dates),
        "coverage_pct": round(coverage, 2),
        "status": status,
        "reason": reason,
    }


def get_beta_unit(series_x_id: str, series_y_id: str) -> str:
    """Format human-readable unit of beta elasticity (e.g. 'bps per 1% FX')."""
    is_yield_y = "YIELD" in series_y_id.upper()
    is_yield_x = "YIELD" in series_x_id.upper()
    is_fx_x = "FX:" in series_x_id.upper()

    y_unit = "bps" if is_yield_y else "%"
    if is_yield_x:
        x_unit = "100 bps yield"
    elif is_fx_x:
        x_unit = "1% FX"
    else:
        x_unit = "1%"

    return f"{y_unit} per {x_unit}"


def compute_rolling_beta(
    x_vals: list[float],
    y_vals: list[float],
    dates: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Compute rolling OLS beta with window = min(20, n), returning up to the last 30 points."""
    n = len(x_vals)
    if n < 5:
        return []
    w = min(20, n)
    results: list[dict[str, Any]] = []

    for i in range(w, n + 1):
        sub_x = x_vals[i - w : i]
        sub_y = y_vals[i - w : i]
        mean_x = sum(sub_x) / w
        mean_y = sum(sub_y) / w
        cov_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(sub_x, sub_y))
        var_x = sum((x - mean_x) ** 2 for x in sub_x)
        if var_x > 1e-12:
            b = cov_xy / var_x
            if not (math.isnan(b) or math.isinf(b)):
                dt = dates[i - 1] if dates and i - 1 < len(dates) else f"t-{n - i}"
                results.append({"date": dt, "beta": round(b, 4)})

    return results[-30:]


def compute_correlation_and_beta(
    x_vals: list[float],
    y_vals: list[float],
    dates: list[str] | None = None,
    series_x_id: str = "",
    series_y_id: str = "",
) -> dict[str, Any]:
    """Compute OLS regression using statsmodels with HAC standard errors (maxlags=5)."""
    n = len(x_vals)
    unit = get_beta_unit(series_x_id, series_y_id)

    if n < 5:
        return {
            "correlation": None,
            "beta": None,
            "beta_se": None,
            "p_value": None,
            "r_squared": None,
            "r2": None,
            "ci95": None,
            "beta_unit": unit,
            "rolling_beta": [],
            "n": n,
            "status": "sample_too_small",
            "reason": "n<5",
            "message": f"Sample size n={n} is too small for meaningful regression (min 5).",
        }

    x_arr = np.array(x_vals, dtype=float)
    y_arr = np.array(y_vals, dtype=float)

    var_x = float(np.var(x_arr, ddof=1)) if n > 1 else 0.0
    var_y = float(np.var(y_arr, ddof=1)) if n > 1 else 0.0

    if var_x < 1e-12 or var_y < 1e-12 or np.isnan(var_x) or np.isnan(var_y):
        return {
            "correlation": None,
            "beta": None,
            "beta_se": None,
            "p_value": None,
            "r_squared": None,
            "r2": None,
            "ci95": None,
            "beta_unit": unit,
            "rolling_beta": [],
            "n": n,
            "status": "zero_variance",
            "reason": "zero_variance",
            "message": "Zero or near-zero variance in one of the series.",
        }

    # Pearson linear correlation
    corr = float(np.corrcoef(x_arr, y_arr)[0, 1])
    if np.isnan(corr) or np.isinf(corr):
        corr = None

    # statsmodels.OLS with HAC standard errors (maxlags=5)
    X = sm.add_constant(x_arr)
    if X.ndim < 2 or X.shape[1] < 2:
        return {
            "correlation": None,
            "beta": None,
            "beta_se": None,
            "p_value": None,
            "r_squared": None,
            "r2": None,
            "ci95": None,
            "beta_unit": unit,
            "rolling_beta": [],
            "n": n,
            "status": "zero_variance",
            "reason": "zero_variance",
            "message": "Zero variance in independent variable.",
        }

    maxlags = min(5, max(1, n - 2))
    model = sm.OLS(y_arr, X)
    try:
        fit = model.fit(cov_type="HAC", cov_kwds={"maxlags": maxlags})
        beta = float(fit.params[1])
        beta_se = float(fit.bse[1])
        p_val = float(fit.pvalues[1])
        r2 = float(fit.rsquared)
        ci_bounds = fit.conf_int()
        ci95 = [float(ci_bounds[1, 0]), float(ci_bounds[1, 1])]
    except Exception:
        fit = model.fit()
        beta = float(fit.params[1])
        beta_se = float(fit.bse[1]) if len(fit.bse) > 1 else 0.0
        p_val = float(fit.pvalues[1]) if len(fit.pvalues) > 1 else 1.0
        r2 = float(fit.rsquared)
        ci_bounds = fit.conf_int()
        ci95 = [float(ci_bounds[1, 0]), float(ci_bounds[1, 1])]

    def _clean(val: float | None, digits: int = 4) -> float | None:
        if val is None or np.isnan(val) or np.isinf(val):
            return None
        return round(val, digits)

    beta = _clean(beta, 4)
    beta_se = _clean(beta_se, 4)
    p_val = _clean(p_val, 4)
    r2 = _clean(r2, 4)
    clean_ci95 = [_clean(ci95[0], 4), _clean(ci95[1], 4)] if ci95 and not any(np.isnan(ci95)) else None
    corr = _clean(corr, 4)

    rolling_beta = compute_rolling_beta(x_vals, y_vals, dates)

    return {
        "correlation": corr,
        "beta": beta,
        "beta_se": beta_se,
        "p_value": p_val,
        "r_squared": r2,
        "r2": r2,
        "ci95": clean_ci95,
        "beta_unit": unit,
        "rolling_beta": rolling_beta,
        "n": n,
        "std_x": _clean(float(np.sqrt(var_x)), 4),
        "std_y": _clean(float(np.sqrt(var_y)), 4),
        "status": "computed",
    }


def compute_bond_price_sensitivity(
    modified_duration: float,
    yield_change_bps: float,
    convexity: float | None = 0.0,
) -> dict[str, Any]:
    """Calculate bond price percentage impact from yield shift:
    ΔP/P ≈ -modified_duration * Δyield_decimal + 0.5 * convexity * (Δyield_decimal ** 2)
    Example: 25 bps shift => Δyield_decimal = 0.0025 (NOT 0.25).
    """
    if modified_duration < 0:
        raise ValueError("Modified duration must be non-negative")

    c = convexity if (convexity is not None and convexity >= 0) else 0.0
    delta_yield_decimal = yield_change_bps / 10000.0  # 1 bp = 0.0001
    duration_effect = -modified_duration * delta_yield_decimal
    convexity_effect = 0.5 * c * (delta_yield_decimal ** 2)

    total_delta_p_pct = (duration_effect + convexity_effect) * 100.0

    return {
        "yield_change_bps": yield_change_bps,
        "delta_yield_decimal": delta_yield_decimal,
        "modified_duration": modified_duration,
        "convexity": c,
        "duration_effect_pct": round(duration_effect * 100.0, 4),
        "convexity_effect_pct": round(convexity_effect * 100.0, 4) if c > 0 else 0.0,
        "estimated_price_change_pct": round(total_delta_p_pct, 4),
        "formula": "ΔP/P ≈ -D_mod * (Δbps / 10000) + 0.5 * C * (Δbps / 10000)^2",
    }


def fetch_series_data(
    repo: Any,
    series_id: str,
    horizon_days: int,
) -> tuple[list[tuple[str, float]], str | None]:
    """Fetch dated observations for a series over the calendar window [today - horizon_days, today].
    Returns (dated_values, as_of).
    Supports:
    - mutual fund NAV via mftool (scheme code: e.g. 'MF:119551' or '119551')
    - standard repo observations (FX, YIELD, VOL, MACRO, INDEX:IN:NIFTY50)
    """
    today = datetime.now(UTC).date()
    start_date = (today - timedelta(days=horizon_days)).strftime("%Y-%m-%d")

    clean_id = series_id.strip()

    # Case 1: Mutual fund via mftool
    if clean_id.startswith("MF:") or clean_id.isdigit():
        code = clean_id.removeprefix("MF:").strip()
        try:
            from mftool import Mftool

            mf = Mftool()
            hist = mf.get_scheme_historical_nav(code)
            if not hist or not isinstance(hist, dict) or not hist.get("data"):
                return [], None
            rows: list[tuple[str, float]] = []
            for item in hist["data"]:
                raw_d = item.get("date", "")
                raw_nav = item.get("nav")
                if not raw_d or raw_nav is None:
                    continue
                try:
                    dt = datetime.strptime(raw_d.strip(), "%d-%m-%Y").strftime("%Y-%m-%d")
                    val = float(str(raw_nav).replace(",", ""))
                    rows.append((dt, val))
                except (ValueError, TypeError):
                    continue
            rows.sort(key=lambda x: x[0])
            as_of = rows[-1][0] if rows else None
            # Filter starting slightly before start_date to allow return computation for the first day
            idx_start = 0
            for i, (d, _) in enumerate(rows):
                if d >= start_date:
                    idx_start = max(0, i - 1)
                    break
            return rows[idx_start:], as_of
        except Exception:
            return [], None

    # Case 2: Repository observations
    buffer_start = (today - timedelta(days=horizon_days + 7)).strftime("%Y-%m-%d")
    obs = repo.get_observations_series(clean_id, start_date=buffer_start, limit=1000)
    data = [(o["observed_at"][:10], float(o["value_numeric"])) for o in obs if o.get("value_numeric") is not None]
    data.sort(key=lambda x: x[0])
    as_of = data[-1][0] if data else None

    idx_start = 0
    for i, (d, _) in enumerate(data):
        if d >= start_date:
            idx_start = max(0, i - 1)
            break
    return data[idx_start:], as_of


def analyze_impact(
    repo: Any,
    series_x_id: str,
    series_y_id: str,
    horizon_days: int = 60,
    lag_days: int = 0,
) -> dict[str, Any]:
    """Perform empirical OLS elasticity, rolling correlation, and lag analysis between pairs."""
    data_x, asof_x = fetch_series_data(repo, series_x_id, horizon_days)
    data_y, asof_y = fetch_series_data(repo, series_y_id, horizon_days)

    today = datetime.now(UTC).date()
    start_date = (today - timedelta(days=horizon_days)).strftime("%Y-%m-%d")

    # Use log returns if prices/FX/funds/indices, or bps changes if yields
    ret_x_full = calculate_bps_changes(data_x) if "YIELD" in series_x_id.upper() else calculate_log_returns(data_x)
    ret_y_full = calculate_bps_changes(data_y) if "YIELD" in series_y_id.upper() else calculate_log_returns(data_y)

    ret_x = [r for r in ret_x_full if r[0] >= start_date]
    ret_y = [r for r in ret_y_full if r[0] >= start_date]

    if not ret_x or not ret_y:
        unit = get_beta_unit(series_x_id, series_y_id)
        return {
            "series_x_id": series_x_id,
            "series_y_id": series_y_id,
            "horizon_days": horizon_days,
            "lag_days": lag_days,
            "reason": "no_data",
            "n": 0,
            "coverage": 0.0,
            "asof_x": asof_x,
            "asof_y": asof_y,
            "alignment": {
                "n": 0,
                "coverage_pct": 0.0,
                "status": "insufficient_data",
            },
            "statistics": {
                "correlation": None,
                "beta": None,
                "beta_se": None,
                "p_value": None,
                "r_squared": None,
                "r2": None,
                "ci95": None,
                "beta_unit": unit,
                "rolling_beta": [],
                "n": 0,
                "status": "sample_too_small",
                "reason": "no_data",
            },
            "paired_sample": [],
            "method_version": "OLS Empirical Elasticity Engine 2.0 (HAC maxlags=5)",
        }

    # Apply lag: shift X's dates by lag_days before the date join
    shifted_ret_x = shift_series_dates(ret_x, lag_days)
    alignment = align_paired_series(shifted_ret_x, ret_y)

    reason = alignment.get("reason")
    if reason:
        stats = {
            "correlation": None,
            "beta": None,
            "beta_se": None,
            "p_value": None,
            "r_squared": None,
            "r2": None,
            "ci95": None,
            "beta_unit": get_beta_unit(series_x_id, series_y_id),
            "rolling_beta": [],
            "n": alignment["n"],
            "status": alignment["status"],
            "reason": reason,
        }
    else:
        stats = compute_correlation_and_beta(
            alignment["paired_x"],
            alignment["paired_y"],
            dates=alignment["dates"],
            series_x_id=series_x_id,
            series_y_id=series_y_id,
        )

    return {
        "series_x_id": series_x_id,
        "series_y_id": series_y_id,
        "horizon_days": horizon_days,
        "lag_days": lag_days,
        "reason": reason,
        "n": alignment["n"],
        "coverage": alignment["coverage_pct"],
        "asof_x": asof_x,
        "asof_y": asof_y,
        "alignment": {
            "n": alignment["n"],
            "coverage_pct": alignment["coverage_pct"],
            "status": alignment["status"],
        },
        "statistics": stats,
        "paired_sample": [
            {"date": d, "x": round(x, 6), "y": round(y, 6)}
            for d, x, y in zip(alignment["dates"][-30:], alignment["paired_x"][-30:], alignment["paired_y"][-30:])
        ],
        "method_version": "OLS Empirical Elasticity Engine 2.0 (HAC maxlags=5)",
    }


def simulate_scenario(
    repo: Any,
    usd_shock_pct: float,
    us_yield_shock_bps: float,
    oil_shock_pct: float,
    modified_duration: float = 6.5,
    convexity: float = 0.0,
) -> dict[str, Any]:
    """Macroeconomic shock scenario simulation with empirical OLS sensitivities and convexity."""
    # 1. Bond price impact with duration + convexity
    bond_impact = compute_bond_price_sensitivity(modified_duration, us_yield_shock_bps, convexity=convexity)

    # 2. Macro pass-through coefficients (OLS over 250 days or heuristic fallback)
    today_str = datetime.now(UTC).strftime("%Y-%m-%d")

    def _get_beta(dep_id: str, driver_id: str, default_beta: float) -> tuple[float, str]:
        cache_key = f"{dep_id}:{driver_id}:{today_str}"
        if cache_key in _SCENARIO_COEFF_CACHE:
            return _SCENARIO_COEFF_CACHE[cache_key]

        data_dep, _ = fetch_series_data(repo, dep_id, horizon_days=250)
        data_drv, _ = fetch_series_data(repo, driver_id, horizon_days=250)
        if len(data_dep) >= 5 and len(data_drv) >= 5:
            r_dep = calculate_bps_changes(data_dep) if "YIELD" in dep_id else calculate_log_returns(data_dep)
            r_drv = calculate_bps_changes(data_drv) if "YIELD" in driver_id else calculate_log_returns(data_drv)
            aligned = align_paired_series(r_drv, r_dep)
            if aligned["n"] >= 5 and aligned["coverage_pct"] >= 50.0:
                stats = compute_correlation_and_beta(aligned["paired_x"], aligned["paired_y"])
                if stats["beta"] is not None:
                    res = (float(stats["beta"]), "empirical")
                    _SCENARIO_COEFF_CACHE[cache_key] = res
                    return res

        res = (default_beta, "heuristic")
        _SCENARIO_COEFF_CACHE[cache_key] = res
        return res

    beta_inr, src_inr = _get_beta("FX:USDINR", "MACRO:US:BROAD_USD", default_beta=-0.45)
    inr_move = round(beta_inr * usd_shock_pct, 4)

    beta_eq, src_eq = _get_beta("INDEX:IN:NIFTY50", "MACRO:US:BROAD_USD", default_beta=-0.65)
    equity_proxy_move = round(beta_eq * usd_shock_pct, 4)

    beta_yield, src_yield = _get_beta("YIELD:IN:10Y", "YIELD:US:10Y", default_beta=0.30)
    india_yield_move_bps = round(beta_yield * us_yield_shock_bps, 2)

    # Oil-to-CPI inflation pass-through
    oil_cpi_bps = round(oil_shock_pct * 1.8, 2)

    return {
        "shocks": {
            "usd_rally_pct": usd_shock_pct,
            "us_10y_yield_shift_bps": us_yield_shock_bps,
            "crude_oil_shock_pct": oil_shock_pct,
            "assumed_portfolio_duration": modified_duration,
            "assumed_portfolio_convexity": convexity,
        },
        "impacts": {
            "bond_portfolio_price_change_pct": bond_impact["estimated_price_change_pct"],
            "bond_duration_effect_pct": bond_impact["duration_effect_pct"],
            "bond_convexity_effect_pct": bond_impact["convexity_effect_pct"],
            "inr_move": inr_move,
            "inr_fx_shift_pct": inr_move,
            "equity_proxy_move": equity_proxy_move,
            "india_yield_move_bps": india_yield_move_bps,
            "oil_cpi_inflation_impact_bps": oil_cpi_bps,
            "oil_to_cpi_bps": oil_cpi_bps,
        },
        "sources": {
            "inr": src_inr,
            "equity": src_eq,
            "india_yield": src_yield,
        },
        "explanation": (
            f"A +{us_yield_shock_bps} bps US yield shock passes through {india_yield_move_bps:+.1f} bps to India 10Y "
            f"and moves a {modified_duration:.1f}y duration (convexity {convexity:.1f}) bond portfolio by "
            f"{bond_impact['estimated_price_change_pct']:+.2f}%. "
            f"A {usd_shock_pct:+.1f}% USD rally transmits to {inr_move:+.2f}% INR FX shift and "
            f"{equity_proxy_move:+.2f}% equity proxy move ({src_inr}/{src_eq})."
        ),
    }

