"""Pure analytics engine functions on NAV series. Money in rupees.

All calculations take clean NAV series and/or parameters and return plain Python dicts/floats.
Numbers are deterministic; no LLM and no network calls.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

# Compatibility shim for PyPortfolioOpt HRPOpt on SciPy >= 1.18
import scipy.cluster.hierarchy as sch
from scipy.optimize import brentq

if not hasattr(sch, "_LINKAGE_METHODS"):
    sch._LINKAGE_METHODS = ["single", "complete", "average", "weighted", "centroid", "median", "ward"]

from pypfopt import EfficientFrontier, HRPOpt, expected_returns, risk_models


def nav_at(s: pd.Series, ts: pd.Timestamp) -> float:
    """NAV on or immediately before timestamp ts. Returns NaN if before first date."""
    if s.empty:
        return float("nan")
    i = s.index.searchsorted(ts, side="right") - 1
    return float(s.iloc[i]) if i >= 0 else float("nan")


def trailing_return(s: pd.Series, years: float | None = None, months: int | None = None) -> float | None:
    """Trailing return over specified years or months.

    For periods > 1 year, returns annualised CAGR: (v1/v0)^(1/years) - 1.
    For periods <= 1 year, returns absolute return: v1/v0 - 1.
    """
    if len(s) < 2:
        return None
    end = s.index[-1]
    if years is not None:
        start = end - pd.DateOffset(years=years)
    elif months is not None:
        start = end - pd.DateOffset(months=months)
    else:
        return None

    if start < s.index[0]:
        return None
    v0 = nav_at(s, start)
    v1 = float(s.iloc[-1])
    if math.isnan(v0) or v0 <= 0 or v1 <= 0:
        return None
    if years is not None and years > 1:
        return float((v1 / v0) ** (1.0 / years) - 1.0)
    return float(v1 / v0 - 1.0)


def cagr(s: pd.Series, years: float | None = None) -> float | None:
    """Annualised CAGR over years (or full series length if years is None)."""
    if len(s) < 2:
        return None
    if years is None:
        span_years = (s.index[-1] - s.index[0]).days / 365.25
        if span_years < 1.0:
            return None
        v0, v1 = float(s.iloc[0]), float(s.iloc[-1])
        if v0 <= 0 or v1 <= 0:
            return None
        return float((v1 / v0) ** (1.0 / span_years) - 1.0)
    return trailing_return(s, years=years)


def rolling_returns(s: pd.Series, window_years: int = 1) -> pd.Series:
    """Monthly-sampled rolling CAGR series for a given window in years."""
    if s.empty:
        return pd.Series(dtype=float)
    m = s.resample("ME").last().dropna()
    k = window_years * 12
    if len(m) <= k:
        return pd.Series(dtype=float)
    r = (m / m.shift(k)) ** (1.0 / window_years) - 1.0
    return r.dropna()


def rolling_return_stats(s: pd.Series, window_years: int = 1) -> dict[str, float | None]:
    """Summary statistics of rolling CAGR: min, median, max, pct_positive, and dispersion."""
    r = rolling_returns(s, window_years)
    if r.empty:
        return {
            "min": None,
            "median": None,
            "max": None,
            "pct_positive": None,
            "dispersion": None,
            "n": 0,
        }
    r_min = float(r.min())
    r_max = float(r.max())
    r_med = float(r.median())
    pct_pos = float((r > 0).mean())
    disp = float(r_max - r_min)
    return {
        "min": r_min,
        "median": r_med,
        "max": r_max,
        "pct_positive": pct_pos,
        "dispersion": disp,
        "n": len(r),
    }


def annualized_volatility(s: pd.Series, periods_per_year: int = 12) -> float:
    """Annualised volatility of percentage changes in NAV."""
    ret = s.pct_change().dropna()
    if len(ret) < 2:
        return 0.0
    return float(ret.std() * math.sqrt(periods_per_year))


def sharpe_ratio(cagr_val: float | None, ann_vol: float, rf: float = 0.065) -> float | None:
    """Annualised Sharpe ratio: (CAGR - rf) / volatility. Returns None if vol is negligible."""
    if cagr_val is None or ann_vol < 1e-4:
        return None
    return float((cagr_val - rf) / ann_vol)


def sortino_ratio(
    s: pd.Series, cagr_val: float | None, rf: float = 0.065, periods_per_year: int = 12
) -> float | None:
    """Annualised Sortino ratio using downside standard deviation."""
    if cagr_val is None:
        return None
    ret = s.pct_change().dropna()
    downside = ret[ret < 0]
    if len(downside) < 2:
        return None
    down_vol = float(downside.std() * math.sqrt(periods_per_year))
    if down_vol < 1e-4:
        return None
    return float((cagr_val - rf) / down_vol)


def max_drawdown(s: pd.Series) -> float:
    """Maximum peak-to-trough decline (negative or 0.0)."""
    if len(s) < 2:
        return 0.0
    cum_max = s.cummax()
    dd = s / cum_max - 1.0
    return float(dd.min())


def max_drawdown_duration(s: pd.Series) -> dict[str, Any]:
    """Find the longest underwater period and the duration of the deepest drawdown.

    Returns max duration in months and drawdown episode details.
    """
    if len(s) < 2:
        return {"longest_underwater_months": 0, "max_drawdown": 0.0, "trough_date": None, "peak_date": None}
    cum_max = s.cummax()
    dd = s / cum_max - 1.0
    worst_dd = float(dd.min())
    worst_idx = dd.idxmin()

    # Find the peak date preceding the worst trough
    peak_date = s.loc[:worst_idx].idxmax()

    # Calculate longest consecutive underwater period in months
    underwater = dd < 0
    longest_months = 0
    cur_streak = 0
    for is_under in underwater:
        if is_under:
            cur_streak += 1
            if cur_streak > longest_months:
                longest_months = cur_streak
        else:
            cur_streak = 0

    return {
        "longest_underwater_months": int(longest_months),
        "max_drawdown": worst_dd,
        "peak_date": str(peak_date.date()) if peak_date is not None else None,
        "trough_date": str(worst_idx.date()) if worst_idx is not None else None,
    }


def sip_xirr(
    s: pd.Series, pmt: float = 1000.0, cash_flows: list[tuple[date | pd.Timestamp, float]] | None = None
) -> float | None:
    """Calculate annualised XIRR for a regular monthly SIP (or arbitrary cash flows).

    If cash_flows is provided, solves for the internal rate of return of those dated flows.
    Otherwise, simulates investing `pmt` at each date in `s`, redeeming at final NAV.
    """
    if cash_flows is not None:
        if len(cash_flows) < 2:
            return None
        d0 = pd.Timestamp(cash_flows[0][0])
        t_years = np.array([(pd.Timestamp(d) - d0).days / 365.25 for d, _ in cash_flows])
        amounts = np.array([amt for _, amt in cash_flows])

        def npv_custom(r: float) -> float:
            df = (1.0 + r) ** (-t_years)
            return float(np.sum(amounts * df))

        try:
            return float(brentq(npv_custom, -0.95, 10.0))
        except Exception:
            return None

    if len(s) < 3:
        return None
    dates = s.index
    navs = s.to_numpy(dtype=float)
    if (navs <= 0).any():
        return None
    units = pmt / navs
    total_units = float(units[:-1].sum())
    final_val = float(total_units * navs[-1])

    d0 = dates[0]
    t_years = np.array([(d - d0).days / 365.25 for d in dates])

    def npv_sip(r: float) -> float:
        df = (1.0 + r) ** (-t_years)
        return float(-pmt * np.sum(df[:-1]) + final_val * df[-1])

    try:
        return float(brentq(npv_sip, -0.90, 5.0))
    except Exception:
        return None


def capture_ratios(fund_series: pd.Series, benchmark_series: pd.Series) -> dict[str, float | None]:
    """Compute upside and downside capture ratio of fund vs benchmark series over common dates."""
    common_idx = fund_series.index.intersection(benchmark_series.index)
    if len(common_idx) < 12:
        return {"upside_capture": None, "downside_capture": None, "common_periods": len(common_idx)}

    f_ret = fund_series.loc[common_idx].pct_change().dropna()
    b_ret = benchmark_series.loc[common_idx].pct_change().dropna()
    aligned_idx = f_ret.index.intersection(b_ret.index)
    if len(aligned_idx) < 6:
        return {"upside_capture": None, "downside_capture": None, "common_periods": len(aligned_idx)}

    f = f_ret.loc[aligned_idx]
    b = b_ret.loc[aligned_idx]

    # Up periods: where benchmark return > 0
    up_mask = b > 0
    up_count = int(up_mask.sum())
    upside_ratio: float | None = None
    if up_count >= 3:
        f_up = float(np.prod(1.0 + f[up_mask]) - 1.0)
        b_up = float(np.prod(1.0 + b[up_mask]) - 1.0)
        if abs(b_up) > 1e-6:
            upside_ratio = float((f_up / b_up) * 100.0)

    # Down periods: where benchmark return < 0
    down_mask = b < 0
    down_count = int(down_mask.sum())
    downside_ratio: float | None = None
    if down_count >= 3:
        f_down = float(np.prod(1.0 + f[down_mask]) - 1.0)
        b_down = float(np.prod(1.0 + b[down_mask]) - 1.0)
        if abs(b_down) > 1e-6:
            downside_ratio = float((f_down / b_down) * 100.0)

    return {
        "upside_capture": upside_ratio,
        "downside_capture": downside_ratio,
        "up_periods": up_count,
        "down_periods": down_count,
        "common_periods": len(aligned_idx),
    }


def return_correlation_matrix(
    schemes_navs: dict[str, pd.Series], threshold: float = 0.80
) -> dict[str, Any]:
    """Correlation matrix of monthly NAV returns and high-overlap pairs.

    Labelled clearly as 'return-correlation overlap, not holdings overlap'.
    """
    if len(schemes_navs) < 2:
        codes = list(schemes_navs.keys())
        return {
            "codes": codes,
            "matrix": [[1.0]] if codes else [],
            "flagged_pairs": [],
            "label": "return-correlation overlap, not holdings overlap",
        }

    # Extract percentage changes for each fund
    rets_dict = {code: s.pct_change().dropna() for code, s in schemes_navs.items() if len(s) >= 6}
    if len(rets_dict) < 2:
        return {
            "codes": list(schemes_navs.keys()),
            "matrix": [],
            "flagged_pairs": [],
            "label": "return-correlation overlap, not holdings overlap",
        }

    df_rets = pd.DataFrame(rets_dict).dropna(how="all")
    corr = df_rets.corr()
    codes = list(corr.columns)
    matrix = [[round(float(corr.iloc[i, j]), 4) if pd.notna(corr.iloc[i, j]) else 0.0
               for j in range(len(codes))] for i in range(len(codes))]

    flagged_pairs = []
    for i in range(len(codes)):
        for j in range(i + 1, len(codes)):
            val = float(corr.iloc[i, j])
            if pd.notna(val) and val >= threshold:
                flagged_pairs.append({
                    "scheme_1": codes[i],
                    "scheme_2": codes[j],
                    "correlation": round(val, 4),
                    "note": f"High return correlation ({val:.2f} >= {threshold:.2f}); return-correlation overlap, not holdings overlap",
                })

    return {
        "codes": codes,
        "matrix": matrix,
        "flagged_pairs": flagged_pairs,
        "label": "return-correlation overlap, not holdings overlap",
    }


def optimize_portfolio_weights(
    schemes_navs: dict[str, pd.Series],
    min_weight: float = 0.02,
    max_weight: float = 0.40,
    rf: float = 0.065,
) -> dict[str, Any]:
    """Illustrative alternative weights view via PyPortfolioOpt (Max Sharpe, Min Volatility, HRP).

    Does NOT replace risk-band asset allocation tables; labelled as illustrative.
    """
    codes = [c for c, s in schemes_navs.items() if len(s) >= 12]
    if len(codes) < 2:
        return {
            "max_sharpe": None,
            "min_volatility": None,
            "hrp": None,
            "disclaimer": "Illustrative alternative weights; does not replace risk-band allocation.",
        }

    # Align prices
    price_df = pd.DataFrame({c: schemes_navs[c] for c in codes}).dropna(how="any")
    if len(price_df) < 12:
        return {
            "max_sharpe": None,
            "min_volatility": None,
            "hrp": None,
            "disclaimer": "Insufficient common price history for portfolio optimization.",
        }

    out: dict[str, Any] = {
        "disclaimer": "Illustrative alternative weights; does not replace risk-band allocation.",
    }

    try:
        mu = expected_returns.mean_historical_return(price_df, frequency=12)
        S = risk_models.sample_cov(price_df, frequency=12)

        # Max Sharpe
        bounds = (min_weight, max_weight)
        ef_sharpe = EfficientFrontier(mu, S, weight_bounds=bounds)
        ef_sharpe.max_sharpe(risk_free_rate=rf)
        out["max_sharpe"] = {k: round(float(v), 4) for k, v in ef_sharpe.clean_weights().items()}

        # Min Volatility
        ef_vol = EfficientFrontier(mu, S, weight_bounds=bounds)
        ef_vol.min_volatility()
        out["min_volatility"] = {k: round(float(v), 4) for k, v in ef_vol.clean_weights().items()}

        # HRP
        rets = price_df.pct_change().dropna()
        hrp = HRPOpt(rets)
        out["hrp"] = {k: round(float(v), 4) for k, v in hrp.optimize().items()}
    except Exception as e:
        out["error"] = str(e)
        out["max_sharpe"] = None
        out["min_volatility"] = None
        out["hrp"] = None

    return out
