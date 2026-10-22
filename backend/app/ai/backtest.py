from __future__ import annotations
"""Past-data backtest of a fund split: the funds held at the chosen weights and rebalanced every period.

Prefers daily NAVs fetched from mfapi.in (cached for the day); if any fetch fails it falls back to the monthly NAV
files shipped with the app. A fund that did not exist yet is left out of the early months and the weights of the
others are rescaled, so the window is as long as the oldest chosen fund's history. Past data only.
"""

import json
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pandas as pd

from app.data.loader import data_dir

_DAILY: dict[str, tuple[date, pd.Series]] = {}  # code -> (day fetched, NAV series); refreshed once per day


def _daily(code: str) -> pd.Series | None:
    hit = _DAILY.get(code)
    if hit and hit[0] == date.today():
        return hit[1]
    try:
        with urllib.request.urlopen(f"https://api.mfapi.in/mf/{code}", timeout=20) as r:  # noqa: S310 - fixed host
            rows = json.loads(r.read())["data"]
        s = pd.Series({pd.to_datetime(x["date"], format="%d-%m-%Y"): float(x["nav"]) for x in rows}).sort_index()
        s = s[s > 0]
    except Exception:
        return hit[1] if hit else None  # stale beats nothing
    _DAILY[code] = (date.today(), s)
    return s


def _monthly(code: str) -> pd.Series:
    df = pd.read_csv(data_dir() / "nav_monthly" / f"{code}.csv", parse_dates=["date"])
    return df.set_index("date")["nav"].astype(float).sort_index()


def _navs(codes: list[str]) -> tuple[pd.DataFrame, str] | None:
    with ThreadPoolExecutor(max_workers=6) as ex:
        daily = list(ex.map(_daily, codes))
    try:
        if all(s is not None and len(s) > 250 for s in daily):
            return pd.concat(dict(zip(codes, daily)), axis=1), "daily"
        return pd.concat({c: _monthly(c) for c in codes}, axis=1), "monthly"
    except (FileNotFoundError, ValueError):
        return None


def _trailing(growth: pd.Series, years: int) -> float | None:
    target = growth.index[-1] - pd.DateOffset(years=years)
    if growth.index[0] > target + pd.Timedelta(days=10):
        return None
    start = growth[:target].iloc[-1]
    return float((growth.iloc[-1] / start) ** (1 / years) - 1)


def backtest(picks: list[dict]) -> dict | None:
    """picks: [{scheme_code, weight_pct}]. None when the oldest fund has under a year of NAVs."""
    codes = [p["scheme_code"] for p in picks]
    got = _navs(codes)
    if got is None:
        return None
    navs, basis = got
    rets = navs.pct_change(fill_method=None)  # a return needs the fund's NAV on both days
    have = rets.notna()
    w = pd.Series({p["scheme_code"]: p["weight_pct"] / 100 for p in picks})
    wa = have.mul(w, axis=1)
    live = wa.sum(axis=1) > 0
    port = (rets.fillna(0) * wa).sum(axis=1)[live] / wa.sum(axis=1)[live]
    if len(port) < (250 if basis == "daily" else 12):
        return None
    growth = pd.concat([pd.Series([100.0], index=[port.index[0] - pd.Timedelta(days=1)]), (1 + port).cumprod() * 100])
    per_year = 252 if basis == "daily" else 12
    month_end = growth.resample("ME").last().dropna()
    roll12 = (month_end / month_end.shift(12) - 1).dropna()
    first = {c: navs[c].first_valid_index() for c in codes}
    from app.ai.picks import candidates  # lazy: picks imports this module's package

    names = {c["scheme_code"]: c["scheme_name"].split(" - ")[0] for c in candidates()}
    joins = [f"{names.get(c, c)} from {d:%b %Y}" for c, d in first.items() if d > navs.index[0] + pd.Timedelta(days=31)]
    sample = growth.iloc[:: max(len(growth) // 150, 1)]
    if sample.index[-1] != growth.index[-1]:
        sample = pd.concat([sample, growth.iloc[[-1]]])
    return {
        "start": growth.index[1].strftime("%b %Y"), "end": growth.index[-1].strftime("%d %b %Y"), "basis": basis,
        "months": int(len(month_end)) - 1, "joins": joins,
        "cagr": {"1y": _trailing(growth, 1), "3y": _trailing(growth, 3), "5y": _trailing(growth, 5), "10y": _trailing(growth, 10),
                 "all": float((growth.iloc[-1] / 100) ** (365.25 / max((growth.index[-1] - growth.index[0]).days, 1)) - 1)},
        "vol": float(port.std() * math.sqrt(per_year)),
        "max_drawdown": float((growth / growth.cummax() - 1).min()),
        "worst_12m": float(roll12.min()) if len(roll12) else None,
        "growth": [{"d": d.strftime("%Y-%m-%d"), "v": round(float(v), 2)} for d, v in sample.items()],
    }
