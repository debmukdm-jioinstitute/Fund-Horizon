from __future__ import annotations
"""Past-data backtest of a fund split: the picks held at fixed weights, rebalanced every month, on month-end NAVs.

Only the months every chosen fund has NAV for are used, so the window is reported with the result. Past data only.
"""

import math

import pandas as pd

from app.data.loader import data_dir


def _series(code: str) -> pd.Series:
    df = pd.read_csv(data_dir() / "nav_monthly" / f"{code}.csv", parse_dates=["date"])
    return df.set_index("date")["nav"].astype(float).sort_index()


def _cagr(growth: pd.Series, months: int) -> float | None:
    if len(growth) <= months:
        return None
    return float((growth.iloc[-1] / growth.iloc[-1 - months]) ** (12 / months) - 1)


def backtest(picks: list[dict]) -> dict | None:
    """picks: [{scheme_code, weight_pct}]. Returns None when no common history of at least 12 months exists."""
    try:
        navs = pd.concat({p["scheme_code"]: _series(p["scheme_code"]) for p in picks}, axis=1).dropna()
    except (FileNotFoundError, ValueError):
        return None
    if len(navs) < 13:
        return None
    w = pd.Series({p["scheme_code"]: p["weight_pct"] / 100 for p in picks})
    rets = navs.pct_change().dropna()
    port = (rets * w).sum(axis=1)  # monthly rebalanced to the chosen weights
    growth = (1 + port).cumprod() * 100
    growth = pd.concat([pd.Series([100.0], index=[navs.index[0]]), growth])
    dd = growth / growth.cummax() - 1
    roll12 = (growth / growth.shift(12) - 1).dropna()
    monthly = growth.iloc[::6] if len(growth) > 130 else growth  # keep the chart payload small
    if monthly.index[-1] != growth.index[-1]:
        monthly = pd.concat([monthly, growth.iloc[[-1]]])
    return {
        "start": growth.index[0].strftime("%b %Y"), "end": growth.index[-1].strftime("%b %Y"), "months": len(growth) - 1,
        "cagr": {"1y": _cagr(growth, 12), "3y": _cagr(growth, 36), "5y": _cagr(growth, 60), "all": _cagr(growth, len(growth) - 1)},
        "vol": float(port.std() * math.sqrt(12)),
        "max_drawdown": float(dd.min()),
        "worst_12m": float(roll12.min()) if len(roll12) else None,
        "growth": [{"d": d.strftime("%Y-%m"), "v": round(float(v), 2)} for d, v in monthly.items()],
    }
