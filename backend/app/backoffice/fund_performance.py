from __future__ import annotations
"""Fund performance reports (reverse-engineered from the advisor tool's Fund Performance tabs): trailing returns, annual returns,
returns comparison, lumpsum returns, consistent performers, comparison with asset classes, monthly/quarterly returns, best performing
fund and point-to-point returns. Every report returns one generic table: columns (with optional group), rows, note.

Differences from the original: dates work on month-end NAV (the dataset has no daily NAV), categories are Fund Horizon's own, the
asset-class comparison uses index-fund / gold-fund / debt-category proxies, and risk ratios are computed from monthly returns.
"""

import math
from datetime import date, datetime
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd

RF = 6.0  # annual risk-free rate (%) for Sharpe and alpha
MAX_FUNDS = 5
MAX_RANGES = 5
TAB_NOTE = "Returns under 1 year are absolute; 1 year and over are annualised (CAGR). Dates use month-end NAV. Past performance may not be sustained."


class PerfError(ValueError):
    """Bad input; the message is safe to show."""


# ---------------------------------------------------------------- shared helpers
def _short(name: str) -> str:
    return str(name).replace(" - Regular Plan - Growth", " Reg Gr").replace(" - Direct Plan - Growth", " Dir Gr").replace(" - Growth", " Gr").strip()


def dmy(d: Any) -> str:
    if d is None or (isinstance(d, float) and math.isnan(d)):
        return "-"
    return pd.Timestamp(d).strftime("%d-%m-%Y")


@lru_cache(maxsize=1)
def _launch_dates() -> dict[str, str]:
    from app.data.loader import load_metrics
    m = load_metrics()
    return dict(zip(m["scheme_code"].astype(str), m["first_nav_date"].astype(str)))


def _nav(code: str) -> pd.Series | None:
    from app.data.loader import load_nav
    try:
        s = load_nav(str(code))
    except (OSError, ValueError, KeyError):
        return None
    return s if len(s) > 1 else None


def _labelled(frame: pd.DataFrame) -> pd.DataFrame:
    from app.backoffice.category_returns import _label
    from app.backoffice.mf_screener import CATEGORY_GROUPS
    groups = {k: f"{g}: {lbl}" for g, items in CATEGORY_GROUPS.items() for k, lbl in items}
    if "_cat" not in frame.columns:
        frame = frame.assign(_cat=[_label(r, groups) for _, r in frame.iterrows()])
    return frame


_LAB: dict[int, pd.DataFrame] = {}


def labelled(frame: pd.DataFrame) -> pd.DataFrame:
    if id(frame) not in _LAB:
        _LAB.clear()
        _LAB[id(frame)] = _labelled(frame)
    return _LAB[id(frame)]


def meta(frame: pd.DataFrame) -> dict[str, Any]:
    f = labelled(frame)
    aum = f.groupby("amc")["aum_cr"].sum().sort_values(ascending=False)
    return {"categories": sorted(f["_cat"].unique()), "amcs": ["5 Largest Fund Houses", "10 Largest Fund Houses", "15 Largest Fund Houses"] + sorted(aum.index),
            "periods": ["ytd", "1w", "1m", "3m", "6m", "1y", "3y", "5y", "10y", "si"], "as_of": str(frame["nav_date"].max())}


def _scope(frame: pd.DataFrame, category: str, plan: str, open_only: bool = False) -> pd.DataFrame:
    f = labelled(frame)
    if category not in set(f["_cat"]):
        raise PerfError("Please select category")
    if plan not in ("Regular", "Direct"):
        raise PerfError("Plan must be Regular or Direct.")
    f = f[(f["_cat"] == category) & (f["plan"] == plan)]
    return f[f["structure"].fillna("Open Ended").str.startswith("Open")] if open_only else f


def _r(v: Any, d: int = 2) -> float | None:
    return None if v is None or pd.isna(v) or not np.isfinite(v) else round(float(v), d)


def _table(title: str, cols: list[tuple], rows: list[dict[str, Any]], note: str = TAB_NOTE, **extra: Any) -> dict[str, Any]:
    """cols: (key, label[, group[, kind]]); kind 'ret' gets red/green tone in the UI."""
    return {"title": title, "columns": [{"key": c[0], "label": c[1], "group": c[2] if len(c) > 2 else None, "kind": c[3] if len(c) > 3 else None} for c in cols], "rows": rows, "note": note, **extra}


def _date(s: str, name: str) -> pd.Timestamp:
    try:
        return pd.Timestamp(datetime.strptime(s, "%Y-%m-%d"))
    except (TypeError, ValueError):
        raise PerfError(f"{name}: enter a valid date.") from None


def _at(s: pd.Series, d: pd.Timestamp, latest: pd.Timestamp) -> float | None:
    """NAV on or before `d` (month-end); a date at or after the latest NAV date uses the latest NAV."""
    if d >= latest:
        return float(s.iloc[-1])
    p = s[s.index <= d]
    return float(p.iloc[-1]) if len(p) else None


def _ret(a: float | None, b: float | None, years: float) -> tuple[float | None, float | None]:
    """(absolute %, CAGR %) from start NAV a to end NAV b; CAGR only for 1 year or more."""
    if not a or not b or a <= 0:
        return None, None
    ab = (b / a - 1) * 100
    return ab, (((b / a) ** (1 / years) - 1) * 100 if years >= 1 else ab)


def _ytd(s: pd.Series) -> float | None:
    prior = s[s.index.year < s.index[-1].year]
    return (s.iloc[-1] / prior.iloc[-1] - 1) * 100 if len(prior) and s.index[-1].year == prior.index[-1].year + 1 else None


def _rank(vals: pd.Series, v: float | None) -> str:
    have = vals.dropna()
    return "-" if v is None or pd.isna(v) else f"{int((have > v).sum() + 1)}/{len(have)}"


def _cols_for(frame: pd.DataFrame, codes: list[str]) -> pd.DataFrame:
    if not codes:
        raise PerfError("Please select a fund.")
    if len(codes) > MAX_FUNDS:
        raise PerfError(f"Select at most {MAX_FUNDS} funds.")
    f = frame.drop_duplicates("code").set_index("code")
    miss = [c for c in codes if c not in f.index]
    if miss:
        raise PerfError(f"Unknown scheme code {miss[0]}.")
    return f.loc[codes]


# ---------------------------------------------------------------- reports
_GT = [("1y", "ret_1y", "1 Year"), ("3y", "cagr_3y", "3 Years"), ("5y", "cagr_5y", "5 Years"), ("10y", "cagr_10y", "10 Years")]
_LT = [("1m", "ret_1m", "1 Month"), ("3m", "ret_3m", "3 Months"), ("6m", "ret_6m", "6 Months"), ("ytd", None, "YTD")]


def trailing(frame: pd.DataFrame, category: str, period: str = "gt1y", rank: bool = True, plan: str = "Regular") -> dict[str, Any]:
    f = _scope(frame, category, plan)
    spec = _LT if period == "lt1y" else _GT
    if period not in ("gt1y", "lt1y"):
        raise PerfError("Period must be gt1y or lt1y.")
    vals = {k: (pd.Series({c: _ytd(s) for c in f["code"] if (s := _nav(c)) is not None}).reindex(f["code"]).set_axis(f.index) if col is None else pd.to_numeric(f[col], errors="coerce")) for k, col, _ in spec}
    launch = _launch_dates()
    rows = []
    for i, r in f.iterrows():
        row = {"scheme": _short(r["name"]), "code": r["code"], "nav": _r(r["nav"]), "launch": dmy(launch.get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"]), "si": _r(r["cagr_si"])}
        for k, _, _ in spec:
            row[k] = _r(vals[k].loc[i])
            row[k + "_rank"] = _rank(vals[k], vals[k].loc[i])
        rows.append(row)
    rows.sort(key=lambda x: (x[spec[0][0]] is None, -(x[spec[0][0]] or 0)))
    cols: list[tuple] = [("scheme", "Scheme Name"), ("nav", "NAV"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)")]
    for k, _, lbl in spec:
        cols.append((k, "Rtn (%)", lbl, "ret"))
        if rank:
            cols.append((k + "_rank", "Rank", lbl))
    cols.append(("si", "Rtn (%)", "Launch", "ret"))
    return _table("Trailing returns", cols, rows)


def annual(frame: pd.DataFrame, category: str, plan: str = "Regular") -> dict[str, Any]:
    f = _scope(frame, category, plan)
    last = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    years = list(range(last.year, last.year - 10, -1))
    launch = _launch_dates()
    rows = []
    for _, r in f.iterrows():
        s = _nav(r["code"])
        row = {"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(launch.get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"])}
        for y in years:
            end = s[(s.index.year == y)] if s is not None else None
            prev = s[s.index.year < y] if s is not None else None
            row[str(y)] = _r((end.iloc[-1] / prev.iloc[-1] - 1) * 100) if s is not None and len(end) and len(prev) and prev.index[-1].year == y - 1 else None
        rows.append(row)
    rows.sort(key=lambda x: (x[str(years[0])] is None, -(x[str(years[0])] or 0)))
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)")] + [(str(y), f"{y} YTD" if y == last.year else str(y), "Calendar year returns (%)", "ret") for y in years]
    return _table("Annual returns", cols, rows, "Calendar-year returns from month-end NAV; the current year is year to date. " + TAB_NOTE)


def _monthly_returns(s: pd.Series) -> pd.Series:
    return s.pct_change().dropna()


def _risk(s: pd.Series, bench: pd.Series | None, start: pd.Timestamp, end: pd.Timestamp) -> dict[str, float | None]:
    r = _monthly_returns(s[(s.index >= start - pd.offsets.MonthEnd(1)) & (s.index <= end)])
    out: dict[str, float | None] = {"mean": None, "sharpe": None, "alpha": None, "beta": None, "std": None}
    if len(r) < 6:
        return out
    mean, std = r.mean() * 12 * 100, r.std() * math.sqrt(12) * 100
    out["mean"], out["std"] = _r(mean), _r(std)
    out["sharpe"] = _r((mean - RF) / std) if std > 0 else None
    if bench is not None:
        b = bench.reindex(r.index).dropna()
        x = r.reindex(b.index)
        if len(b) >= 6 and b.var() > 0:
            beta = np.cov(x, b)[0, 1] / b.var()
            out["beta"] = _r(beta)
            out["alpha"] = _r(x.mean() * 1200 - (RF + beta * (b.mean() * 1200 - RF)))
    return out


def _bench(frame: pd.DataFrame, code: str) -> pd.Series | None:
    """Equal-weight average monthly return of the fund's category and plan (the dataset has no index series)."""
    f = labelled(frame)
    row = f[f["code"] == code].iloc[0]
    peers = f[(f["_cat"] == row["_cat"]) & (f["plan"] == row["plan"])].sort_values("aum_cr", ascending=False).head(40)
    ser = [x for c in peers["code"] if (s := _nav(c)) is not None and (x := _monthly_returns(s)) is not None]
    return pd.concat(ser, axis=1).mean(axis=1) if len(ser) >= 3 else None


def compare(frame: pd.DataFrame, codes: list[str], amount: float, start: str, end: str) -> dict[str, Any]:
    f = _cols_for(frame, codes)
    a, b = _date(start, "Start date"), _date(end, "End date")
    if b <= a:
        raise PerfError("End date must be after the start date.")
    if not (amount > 0):
        raise PerfError("Please enter a valid amount.")
    latest = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    years = (b - a).days / 365.25
    launch = _launch_dates()
    rows = []
    for code, r in f.iterrows():
        s = _nav(code)
        n0, n1 = (_at(s, a, latest), _at(s, b, latest)) if s is not None else (None, None)
        ab, cg = _ret(n0, n1, years)
        row = {"scheme": _short(r["name"]), "code": code, "launch": dmy(launch.get(code)), "value": _r(amount * n1 / n0) if n0 and n1 else None, "abs": _r(ab), "cagr": _r(cg)}
        row.update(_risk(s, _bench(frame, code), a, min(b, latest)) if s is not None and ab is not None else {"mean": None, "sharpe": None, "alpha": None, "beta": None, "std": None})
        rows.append(row)
    g = f"{dmy(a)} to {dmy(b)}"
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("value", "Growth Value", g), ("abs", "Abs Ret. (%)", g, "ret"), ("cagr", "CAGR (%)", g, "ret"),
            ("mean", "Mean (% p.a.)", "Risk ratios"), ("sharpe", "Sharpe Ratio", "Risk ratios"), ("alpha", "Alpha", "Risk ratios"), ("beta", "Beta", "Risk ratios"), ("std", "Std. Deviation", "Risk ratios")]
    return _table("Returns comparison", cols, rows, f"Growth of Rs.{amount:,.0f}. Risk ratios use monthly returns in the period (risk-free {RF:g}%, beta and alpha against the category's average). " + TAB_NOTE)


def lumpsum(frame: pd.DataFrame, codes: list[str], amount: float, start: str, end: str) -> dict[str, Any]:
    f = _cols_for(frame, codes)
    a, b = _date(start, "Start date"), _date(end, "End date")
    if b <= a:
        raise PerfError("End date must be after the start date.")
    if not (amount >= 1):
        raise PerfError("Please enter a valid amount.")
    latest = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    years = (b - a).days / 365.25
    launch = _launch_dates()
    lab = labelled(frame).set_index("code")["_cat"]
    rows = []
    for code, r in f.iterrows():
        s = _nav(code)
        n0, n1 = (_at(s, a, latest), _at(s, b, latest)) if s is not None else (None, None)
        _, cg = _ret(n0, n1, years)
        v = amount * n1 / n0 if n0 and n1 else None
        rows.append({"scheme": _short(r["name"]), "code": code, "category": lab.get(code, ""), "launch": dmy(launch.get(code)), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"]),
                     "invested": amount, "value": _r(v), "profit": _r(v - amount) if v else None, "ret": _r(cg),
                     "note": "Fund started after the start date" if n0 is None and s is not None else None})
    cols = [("scheme", "Scheme Name"), ("category", "Category"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)"), ("invested", "Amount Invested"),
            ("value", f"Value as on {dmy(min(b, latest))}"), ("profit", "Profit"), ("ret", "Returns (%)", None, "ret")]
    return _table("Lumpsum returns", cols, rows)


def consistent(frame: pd.DataFrame, category: str, plan: str = "Regular") -> dict[str, Any]:
    f = _scope(frame, category, plan)
    spec = [("1y", "ret_1y"), ("3y", "cagr_3y"), ("5y", "cagr_5y"), ("10y", "cagr_10y")]
    med = {k: pd.to_numeric(f[c], errors="coerce").median() for k, c in spec}
    launch = _launch_dates()
    rows = []
    for _, r in f.iterrows():
        have = [(k, float(r[c])) for k, c in spec if pd.notna(r[c]) and pd.notna(med[k])]
        beats = sum(1 for k, v in have if v > med[k])
        top = len(have) >= 3 and beats == len(have)
        above = len(have) >= 3 and not top and beats >= len(have) - 1 and any(k == "3y" and v > med["3y"] for k, v in have)
        if not (top or above):
            continue
        s = _nav(r["code"])
        m = _monthly_returns(s.iloc[-37:]).mean() * 12 * 100 if s is not None and len(s) > 12 else None
        rows.append({"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(launch.get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"]), "rating": "Top Performer" if top else "Above Average Performer",
                     "1y": _r(r["ret_1y"]), "3y": _r(r["cagr_3y"]), "5y": _r(r["cagr_5y"]), "10y": _r(r["cagr_10y"]), "mean": _r(m), "sharpe": _r(r["sharpe_3y"]), "alpha": _r(r["alpha_3y"]), "beta": _r(r["beta_3y"]), "std": _r(r["vol_3y"])})
    rows.sort(key=lambda x: (x["rating"] != "Top Performer", -(x["3y"] or -1e9)))
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)"), ("rating", "Rating")] + [(k, lbl, "Rtn (%)", "ret") for k, lbl in (("1y", "1 Yr"), ("3y", "3 Yrs"), ("5y", "5 Yrs"), ("10y", "10 Yrs"))] + \
           [("mean", "Mean", "Risk ratios (3 years)"), ("sharpe", "Sharpe Ratio", "Risk ratios (3 years)"), ("alpha", "Alpha", "Risk ratios (3 years)"), ("beta", "Beta", "Risk ratios (3 years)"), ("std", "Std. Deviation", "Risk ratios (3 years)")]
    return _table("Consistent performers", cols, rows, "Top Performer: beat the category median in every period with data (at least 3). Above Average: beat it in all but one, including 3 years. " + TAB_NOTE)


def monthly(frame: pd.DataFrame, category: str, mode: str, years: list[int], plan: str = "Regular") -> dict[str, Any]:
    f = _scope(frame, category, plan)
    if mode not in ("Monthly", "Quarterly"):
        raise PerfError("Mode must be Monthly or Quarterly.")
    if not years or len(years) > 3 or any(not 1990 <= y <= date.today().year for y in years):
        raise PerfError("Select one to three valid years.")
    heads = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] if mode == "Monthly" else ["Q1", "Q2", "Q3", "Q4"]
    step = 1 if mode == "Monthly" else 3
    rows = []
    for _, r in f.iterrows():
        s = _nav(r["code"])
        if s is None:
            continue
        for y in sorted(years, reverse=True):
            row: dict[str, Any] = {"scheme": _short(r["name"]), "code": r["code"], "year": y}
            for i, h in enumerate(heads):
                end_m, start_m = (i + 1) * step, i * step
                e = s[(s.index.year == y) & (s.index.month == end_m)]
                p = s[(s.index.year == y) & (s.index.month == start_m)] if start_m else s[(s.index.year == y - 1) & (s.index.month == 12)]
                row[h] = _r((e.iloc[0] / p.iloc[0] - 1) * 100) if len(e) and len(p) else None
            if any(row[h] is not None for h in heads):
                rows.append(row)
    rows.sort(key=lambda x: (-x["year"], x[heads[0]] is None, -(x[heads[0]] or 0)))
    cols = [("scheme", "Scheme Name"), ("year", "Year")] + [(h, h, None, "ret") for h in heads]
    return _table(f"{mode} returns", cols, rows, f"{mode} returns (%) from month-end NAV, sorted by the first period. " + TAB_NOTE)


def best(frame: pd.DataFrame, amcs: list[str], category: str, period: str = "1y", ftype: str = "Open", plan: str = "Regular") -> dict[str, Any]:
    col = {"ytd": None, "1w": "week_chg", "1m": "ret_1m", "3m": "ret_3m", "6m": "ret_6m", "1y": "ret_1y", "3y": "cagr_3y", "5y": "cagr_5y", "10y": "cagr_10y", "si": "cagr_si"}
    if period not in col:
        raise PerfError("Unknown period.")
    if not amcs:
        raise PerfError("Please select a fund house.")
    f = _scope(frame, category, plan)
    f = f[f["structure"].fillna("Open Ended").str.startswith("Open" if ftype == "Open" else "Close")] if ftype in ("Open", "Close") else f
    full = labelled(frame)
    totals = full.groupby("amc")["aum_cr"].sum().sort_values(ascending=False)
    names: list[str] = []
    for a in amcs:
        n = {"5 Largest Fund Houses": 5, "10 Largest Fund Houses": 10, "15 Largest Fund Houses": 15}.get(a)
        names += list(totals.index[:n]) if n else [a]
    f = f[f["amc"].isin(names)]
    f = f.assign(_p=pd.Series({i: _ytd(s) if (s := _nav(c)) is not None else None for i, c in zip(f.index, f["code"])}) if col[period] is None else pd.to_numeric(f[col[period]], errors="coerce"))
    f = f.dropna(subset=["_p"])
    launch = _launch_dates()
    rows = []
    for amc, g in f.groupby("amc"):
        r = g.sort_values("_p", ascending=False).iloc[0]
        rows.append({"scheme": _short(r["name"]), "code": r["code"], "category": r["_cat"], "launch": dmy(launch.get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"]), "1y": _r(r["ret_1y"]), "3y": _r(r["cagr_3y"]),
                     "5y": _r(r["cagr_5y"]), "10y": _r(r["cagr_10y"]), "si": _r(r["cagr_si"]), "amc": amc, "_p": r["_p"]})
    rows.sort(key=lambda x: -x["_p"])
    for x in rows:
        x.pop("_p")
    cols = [("scheme", "Scheme Name"), ("amc", "Fund House"), ("category", "Category"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)")] + [(k, f"{l} Ret (%)", None, "ret") for k, l in (("1y", "1-Year"), ("3y", "3-Yrs"), ("5y", "5-Yrs"), ("10y", "10-Yrs"), ("si", "Since Launch"))]
    return _table("Best performing fund", cols, rows, f"Best fund of each selected fund house in the category by {period.upper()} return; 5/10/15 largest fund houses are ranked by total AUM. " + TAB_NOTE)


def p2p(frame: pd.DataFrame, category: str, ranges: list[tuple[str, str]], plan: str = "Regular") -> dict[str, Any]:
    f = _scope(frame, category, plan)
    if not ranges or len(ranges) > MAX_RANGES:
        raise PerfError(f"Enter one to {MAX_RANGES} date ranges.")
    spans = []
    for a, b in ranges:
        x, y = _date(a, "Start date"), _date(b, "End date")
        if y <= x:
            raise PerfError("End date must be after the start date.")
        spans.append((x, y))
    latest = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    launch = _launch_dates()
    rows = []
    for _, r in f.iterrows():
        s = _nav(r["code"])
        row: dict[str, Any] = {"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(launch.get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"])}
        for i, (x, y) in enumerate(spans):
            ab, cg = _ret(_at(s, x, latest), _at(s, y, latest), (y - x).days / 365.25) if s is not None else (None, None)
            row[f"abs{i}"], row[f"xirr{i}"] = _r(ab), _r(cg)
        rows.append(row)
    rows.sort(key=lambda x: (x["abs0"] is None, -(x["abs0"] or 0)))
    cols: list[tuple] = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Cr)"), ("ter", "TER (%)")]
    for i, (x, y) in enumerate(spans):
        g = f"{dmy(x)} to {dmy(y)}"
        cols += [(f"abs{i}", "Abs Ret (%)", g, "ret"), (f"xirr{i}", "XIRR (%)", g, "ret")]
    return _table("Point to point returns", cols, rows)


_ASSETS = [("Equity: NIFTY 100 (index fund proxy)", "147666"), ("Equity: NIFTY 500 (index fund proxy)", "147625"), ("Equity: NIFTY Midcap 150 (index fund proxy)", "147622")]


def _category_avg_series(frame: pd.DataFrame, cat: str) -> pd.Series | None:
    f = labelled(frame)
    f = f[(f["_cat"] == cat) & (f["plan"] == "Regular")].sort_values("aum_cr", ascending=False).head(10)
    ser = [s for c in f["code"] if (s := _nav(c)) is not None]
    if len(ser) < 3:
        return None
    r = pd.concat([_monthly_returns(s) for s in ser], axis=1).mean(axis=1).dropna()
    return (1 + r).cumprod()


def assets(frame: pd.DataFrame, code: str, amount: float, start_year: int) -> dict[str, Any]:
    f = _cols_for(frame, [code])
    if not (amount >= 1):
        raise PerfError("Please enter a valid amount.")
    if not 1990 <= start_year <= date.today().year - 1:
        raise PerfError("Select a valid start year.")
    latest = pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()
    start = pd.Timestamp(year=start_year, month=1, day=1)
    series: list[tuple[str, pd.Series | None]] = [(_short(f.iloc[0]["name"]), _nav(code))] + [(n, _nav(c)) for n, c in _ASSETS]
    gold = labelled(frame)
    gold = gold[(gold["_cat"].str.contains("Gold")) & (gold["plan"] == "Regular")].sort_values("aum_cr", ascending=False)
    series.append(("Gold (largest gold fund)", _nav(gold.iloc[0]["code"]) if len(gold) else None))
    series += [("Debt: Liquid funds (category average)", _category_avg_series(frame, "Debt: Liquid")), ("Debt: Gilt funds (category average)", _category_avg_series(frame, "Debt: Gilt"))]
    rows = []
    for name, s in series:
        row: dict[str, Any] = {"scheme": name, "start": "-", "end": "-", "invested": amount, "value": None, "cagr": None, "note": None}
        if s is not None:
            p = s[s.index <= start - pd.offsets.MonthEnd(1)]
            first = p.index[-1] if len(p) else s.index[0]
            n0 = float(p.iloc[-1]) if len(p) else float(s.iloc[0])
            n1, yrs = float(s.iloc[-1]), (min(s.index[-1], latest) - first).days / 365.25
            row.update(start=dmy(first), end=dmy(min(s.index[-1], latest)), value=_r(amount * n1 / n0, 0), cagr=_r(_ret(n0, n1, max(yrs, 1e-9))[1]), note=None if len(p) else "Starts later than the chosen year (history begins here)")
        rows.append(row)
    cols = [("scheme", "Asset Class"), ("start", "Start Date"), ("end", "End Date"), ("invested", "Invested Amount"), ("value", "Current Value"), ("cagr", "CAGR (%)", None, "ret")]
    return _table("Comparison with asset classes", cols, rows, "Index and gold rows use the NAV of an index fund / gold fund, and debt rows the average of the largest funds in the category, so they trail the true index slightly (fees). " + TAB_NOTE)
