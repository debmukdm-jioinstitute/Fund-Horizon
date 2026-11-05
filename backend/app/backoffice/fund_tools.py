from __future__ import annotations
"""More fund research tools (reverse-engineered from the advisor tool's SIP/STP/SWP, Rolling Returns, Advanced Tools, Benchmark and Ranking sections).

Each tool is described once in TOOLS (id, group, title, fields) and implemented by one function returning the generic report table of
fund_performance. The UI is built from that description, so the page and the API cannot drift apart.

Differences from the original: everything runs on month-end NAV (no daily NAV), so SIP/STP/SWP run monthly, quarterly or yearly; the
benchmark tools use index funds that track each index as the series (no TRI data is ingested); dividends, debt maturity/YTM and
credit-quality ratings are not in the dataset and are not built.
"""

import math
from datetime import datetime
from typing import Any, Callable

import numpy as np
import pandas as pd

from app.backoffice import fund_performance as fp
from app.backoffice.fund_performance import PerfError, _at, _date, _launch_dates, _nav, _r, _short, _table, dmy, labelled

NOTE = "Month-end NAV is used for every date (the dataset has no daily NAV). Past performance may not be sustained."
BENCH = {"NIFTY 100 (index fund proxy)": "147666", "NIFTY 500 (index fund proxy)": "147625", "NIFTY Midcap 150 (index fund proxy)": "147622", "NIFTY Smallcap 250 (index fund proxy)": "147623",
         "NIFTY LargeMidcap 250 (index fund proxy)": "152156", "NIFTY 500 Multicap 50:25:25 (index fund proxy)": "152751"}
FREQ = {"Monthly": 1, "Quarterly": 3, "Yearly": 12}
BUCKETS = (-np.inf, 0, 8, 12, 15, 20, np.inf)
BNAMES = ["negative", "0-8", "8-12", "12-15", "15-20", ">20"]


# PPF interest by calendar year (same table as the PPF calculator), 2026 onward assumed unchanged.
PPF_RATE = {2001: 9.5, 2002: 9, 2003: 8, 2004: 8, 2005: 8, 2006: 8, 2007: 8, 2008: 8, 2009: 8, 2010: 8, 2011: 8.6, 2012: 8.8, 2013: 8.7, 2014: 8.7, 2015: 8.7, 2016: 8.225, 2017: 7.875, 2018: 7.6,
            2019: 8, 2020: 7.3, 2021: 7.1, 2022: 7.1, 2023: 7.1, 2024: 7.1, 2025: 7.1, 2026: 7.1}


# ---------------------------------------------------------------- engine
def xirr(flows: list[tuple[pd.Timestamp, float]]) -> float | None:
    """Annualised return (%) of dated cash flows; needs at least one outflow and one inflow."""
    if not flows or not any(a < 0 for _, a in flows) or not any(a > 0 for _, a in flows):
        return None
    t0 = min(d for d, _ in flows)
    ts = [((d - t0).days / 365.0, a) for d, a in flows]
    f = lambda r: sum(a / (1 + r) ** t for t, a in ts)  # noqa: E731
    lo, hi = -0.99, 10.0
    if f(lo) * f(hi) > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if f(lo) * f(mid) > 0 else (lo, mid)
    return ((lo + hi) / 2) * 100


def _latest(frame: pd.DataFrame) -> pd.Timestamp:
    return pd.to_datetime(frame["nav_date"], format="%d-%b-%Y", errors="coerce").max()


def _end_date(s: pd.Series, d: pd.Timestamp, latest: pd.Timestamp) -> pd.Timestamp:
    p = s[s.index <= d]
    return min(latest, d) if len(p) and d >= s.index[-1] else (p.index[-1] if len(p) else s.index[0])


def _dates(s: pd.Series, start: pd.Timestamp, end: pd.Timestamp, step: int) -> pd.Series:
    """Month-end NAV points from the start month to the end month, every `step` months."""
    p = s[(s.index >= start + pd.offsets.MonthEnd(0)) & (s.index <= end)]
    return p.iloc[::step]


def _flow_date(i: pd.Timestamp, s: pd.Series, latest: pd.Timestamp) -> pd.Timestamp:
    return min(i, latest) if i == s.index[-1] else i


def _one(frame: pd.DataFrame, code: str):
    return fp._cols_for(frame, [code]).iloc[0]


def _since(s: pd.Series, name: str, d: pd.Timestamp, what: str = "the start date") -> None:
    if s.index[0] > d + pd.offsets.MonthEnd(0):
        raise PerfError(f"{_short(name)} has NAV only from {dmy(s.index[0])}; choose {what} after that.")


def _need(s: pd.Series | None, name: str) -> pd.Series:
    if s is None:
        raise PerfError(f"No NAV history for {name}.")
    return s


def _sip(s: pd.Series, amount: float, start: pd.Timestamp, end: pd.Timestamp, step: int, topup: float, latest: pd.Timestamp) -> dict[str, Any]:
    pts = _dates(s, start, end, step)
    if len(pts) < 1:
        raise PerfError("The fund has no NAV in that period.")
    inv = units = 0.0
    flows = []
    for k, (d, nav) in enumerate(pts.items()):
        a = amount * (1 + topup / 100) ** (k * step // 12)
        inv += a
        units += a / nav
        flows.append((_flow_date(d, s, latest), -a))
    last_d = _flow_date(pts.index[-1], s, latest)
    val = units * float(pts.iloc[-1])
    flows.append((last_d + pd.Timedelta(days=1), val))
    return {"n": len(pts), "invested": inv, "value": val, "xirr": xirr(flows)}


def _ranges(start: pd.Timestamp, end: pd.Timestamp) -> None:
    if end <= start:
        raise PerfError("End date must be after the start date.")


def _freq(v: str) -> int:
    if v not in FREQ:
        raise PerfError("Frequency must be Monthly, Quarterly or Yearly (the dataset has month-end NAV only).")
    return FREQ[v]


def _amount(v: float, lo: float = 1) -> float:
    if not (v >= lo):
        raise PerfError("Please enter a valid amount.")
    return v


def _fields(f: pd.DataFrame, codes: list[str]) -> pd.DataFrame:
    return fp._cols_for(f, codes)


# ---------------------------------------------------------------- SIP / STP / SWP
def sip_returns(frame, codes, amount, frequency, start, end):
    f, step, a, b, lat = _fields(frame, codes), _freq(frequency), _date(start, "Start date"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    amount = _amount(amount)
    cats = labelled(frame).set_index("code")["_cat"]
    rows = []
    for code, r in f.iterrows():
        s = _need(_nav(code), r["name"])
        x = _sip(s, amount, a, b, step, 0, lat)
        rows.append({"scheme": _short(r["name"]), "code": code, "category": cats.get(code, ""), "launch": dmy(_launch_dates().get(code)), "ter": _r(r["ter"]), "nav": _r(r["nav"]), "n": x["n"],
                     "invested": _r(x["invested"], 0), "value": _r(x["value"], 0), "gain": _r(x["value"] - x["invested"], 0), "xirr": _r(x["xirr"])})
    cols = [("scheme", "Fund Name"), ("category", "Scheme Category"), ("launch", "Launch Date"), ("ter", "TER (%)"), ("nav", "NAV"), ("n", "No. of Installments"), ("invested", "Investment Amount"),
            ("value", "SIP Value"), ("gain", "Gain"), ("xirr", "XIRR (%)", None, "ret")]
    return _table("SIP returns", cols, rows, NOTE)


def sip_topup(frame, code, amount, frequency, start, end, topup):
    r, step, a, b, lat = _one(frame, code), _freq(frequency), _date(start, "Start date"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    amount = _amount(amount)
    if not 0 <= topup <= 100:
        raise PerfError("Top-up must be between 0 and 100%.")
    s = _need(_nav(code), r["name"])
    flat, up = _sip(s, amount, a, b, step, 0, lat), _sip(s, amount, a, b, step, topup, lat)
    row = {"scheme": _short(r["name"]), "n": up["n"], "inv_flat": _r(flat["invested"], 0), "val_flat": _r(flat["value"], 0), "growth_flat": _r(flat["value"] - flat["invested"], 0),
           "inv_up": _r(up["invested"], 0), "val_up": _r(up["value"], 0), "growth_up": _r(up["value"] - up["invested"], 0), "extra": _r((up["value"] / up["invested"] - flat["value"] / flat["invested"]) * 100),
           "xirr_flat": _r(flat["xirr"]), "xirr_up": _r(up["xirr"])}
    cols = [("scheme", "Scheme"), ("n", "No. of Installments"), ("inv_flat", "Investment", "Fixed SIP"), ("val_flat", "Value", "Fixed SIP"), ("growth_flat", "Growth", "Fixed SIP"), ("xirr_flat", "XIRR (%)", "Fixed SIP", "ret"),
            ("inv_up", "Investment", f"SIP with {topup:g}% yearly top-up"), ("val_up", "Value", f"SIP with {topup:g}% yearly top-up"), ("growth_up", "Growth", f"SIP with {topup:g}% yearly top-up"),
            ("xirr_up", "XIRR (%)", f"SIP with {topup:g}% yearly top-up", "ret"), ("extra", "Extra return multiple (points)")]
    return _table("SIP with annual increase", cols, [row], "The top-up raises each year's instalment by the chosen %. " + NOTE)


def sip_top(frame, category, amount, plan):
    f = fp._scope(frame, category, plan)
    amount, lat = _amount(amount), _latest(frame)
    rows = []
    for _, r in f.iterrows():
        s = _nav(r["code"])
        if s is None:
            continue
        row: dict[str, Any] = {"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(_launch_dates().get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"])}
        for y in (1, 3, 5):
            st = lat - pd.DateOffset(years=y)
            ok = s.index[0] <= st
            x = _sip(s, amount, st, lat, 1, 0, lat) if ok else None
            row[f"i{y}"], row[f"v{y}"], row[f"x{y}"] = (_r(x["invested"], 0), _r(x["value"], 0), _r(x["xirr"])) if x else (None, None, None)
        rows.append(row)
    rows.sort(key=lambda x: (x["x3"] is None, -(x["x3"] or 0)))
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)")]
    for y in (1, 3, 5):
        cols += [(f"i{y}", "Invested Amt", f"{y} Yr"), (f"v{y}", "Curr Value", f"{y} Yr"), (f"x{y}", "XIRR (%)", f"{y} Yr", "ret")]
    return _table("Top performing SIP funds", cols, rows, f"Monthly SIP of Rs.{amount:,.0f} ending on the latest NAV date; funds younger than the period show a dash. " + NOTE)


def _swp(s: pd.Series, units: float, amount: float, start: pd.Timestamp, end: pd.Timestamp, step: int, inc: float, latest: pd.Timestamp) -> dict[str, Any]:
    pts = _dates(s, start, end, step)
    taken = n = 0
    flows = []
    for k, (d, nav) in enumerate(pts.items()):
        a = amount * (1 + inc / 100) ** (k * step // 12)
        sell = min(units, a / nav)
        if sell <= 1e-9:
            break
        units -= sell
        taken += sell * nav
        n += 1
        flows.append((_flow_date(d, s, latest), sell * nav))
    return {"n": n, "taken": taken, "units": units, "flows": flows, "end": pts.index[-1] if len(pts) else None}


def _swp_row(s, nm, lump, amount, step, inc, a0, a, b, lat):
    _since(s, nm, a0, "an investment date")
    nav0 = _at(s, a0, lat)
    x = _swp(s, lump / nav0, amount, a, b, step, inc, lat)
    val = x["units"] * _at(s, b, lat)
    flows = [(a0, -lump)] + x["flows"] + [(max(b, a0 + pd.Timedelta(days=1)), val)]
    return {"n": x["n"], "taken": x["taken"], "value": val, "xirr": xirr(flows)}


def swp_returns(frame, code, lumpsum, invest_date, amount, frequency, start, end, increase=0.0):
    r, step, a0, a, b, lat = _one(frame, code), _freq(frequency), _date(invest_date, "Investment date"), _date(start, "Withdrawal start"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    if a < a0:
        raise PerfError("Withdrawals cannot start before the investment date.")
    lumpsum, amount = _amount(lumpsum), _amount(amount)
    x = _swp_row(_need(_nav(code), r["name"]), r["name"], lumpsum, amount, step, increase, a0, a, b, lat)
    row = {"scheme": _short(r["name"]), "period": frequency, "n": x["n"], "invested": _r(lumpsum, 0), "taken": _r(x["taken"], 0), "value": _r(x["value"], 0), "xirr": _r(x["xirr"])}
    cols = [("scheme", "Scheme"), ("period", "Withdrawal Period"), ("n", "No. of Installments"), ("invested", "Investment Amount"), ("taken", "Total Withdrawal Amount"), ("value", "Current Value"), ("xirr", "Return (XIRR %)", None, "ret")]
    return _table("SWP returns" + (f" with {increase:g}% annual increase" if increase else ""), cols, [row], NOTE + " Withdrawals stop when the units run out.")


def swp_top(frame, category, lumpsum, invest_date, amount, frequency, start, end, plan):
    f, step, a0, a, b, lat = fp._scope(frame, category, plan), _freq(frequency), _date(invest_date, "Investment date"), _date(start, "Withdrawal start"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    lumpsum, amount = _amount(lumpsum), _amount(amount)
    rows = []
    for _, r in f.iterrows():
        s = _nav(r["code"])
        if s is None or s.index[0] > a0 or _at(s, a0, lat) is None:
            continue
        x = _swp_row(s, r["name"], lumpsum, amount, step, 0, a0, a, b, lat)
        rows.append({"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(_launch_dates().get(r["code"])), "invested": _r(lumpsum, 0), "period": frequency, "n": x["n"], "taken": _r(x["taken"], 0), "value": _r(x["value"], 0), "xirr": _r(x["xirr"])})
    rows.sort(key=lambda x: (x["xirr"] is None, -(x["xirr"] or 0)))
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("invested", "Lumpsum Amount"), ("period", "Withdrawal Period"), ("n", "No of Installments"), ("taken", "Total Withdrawal Amount"), ("value", "Current Value"), ("xirr", "Return XIRR %", None, "ret")]
    return _table("Best SWP funds", cols, rows, "Funds launched after the investment date are left out. " + NOTE)


def swp_multi(frame, code1, amount1, code2, amount2, invest_date, withdrawal, frequency, start, end):
    f, step, a0, a, b, lat = _fields(frame, [code1, code2]), _freq(frequency), _date(invest_date, "Investment date"), _date(start, "Withdrawal start"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    if a < a0:
        raise PerfError("Withdrawals cannot start before the investment date.")
    amounts, withdrawal = [_amount(amount1), _amount(amount2)], _amount(withdrawal)
    ss = [_need(_nav(c), n) for c, n in zip((code1, code2), f["name"])]
    units = []
    for s, amt, n in zip(ss, amounts, f["name"]):
        _since(s, n, a0, "an investment date")
        units.append(amt / _at(s, a0, lat))
    pts = ss[0][(ss[0].index >= a + pd.offsets.MonthEnd(0)) & (ss[0].index <= b)].iloc[::step].index
    flows, taken, n = [(a0, -sum(amounts))], 0.0, 0
    for d in pts:
        navs = [_at(s, d, lat) for s in ss]
        tot = sum(u * v for u, v in zip(units, navs))
        if tot <= 0:
            break
        take = min(withdrawal, tot)
        units = [u * (1 - take / tot) for u in units]  # sold in proportion to what each scheme is worth
        taken += take
        n += 1
        flows.append((_flow_date(d, ss[0], lat), take))
    end_vals = [u * _at(s, b, lat) for u, s in zip(units, ss)]
    flows.append((max(b, a0 + pd.Timedelta(days=1)), sum(end_vals)))
    rows = [{"scheme": _short(nm), "amc": r["amc"], "period": frequency, "invested": _r(amt, 0), "value": _r(v, 0)} for (_, r), nm, amt, v in zip(f.iterrows(), f["name"], amounts, end_vals)]
    rows.append({"scheme": "Total", "amc": "", "period": frequency, "n": n, "invested": _r(sum(amounts), 0), "taken": _r(taken, 0), "value": _r(sum(end_vals), 0), "xirr": _r(xirr(flows))})
    cols = [("scheme", "Scheme"), ("amc", "AMC Name"), ("period", "Withdrawal Period"), ("n", "No. of Installments"), ("invested", "Investment Amount"), ("taken", "Total Withdrawal Amount"), ("value", "Current Value"), ("xirr", "Return (XIRR %)", None, "ret")]
    return _table("SWP with multiple schemes", cols, rows, "Each withdrawal is taken from the two schemes in proportion to their value. " + NOTE)


def _stp(frame, code_from, code_to, init, invest_date, transfer, frequency, start, end, increase, profit_only, title):
    f, step, a0, a, b, lat = _fields(frame, [code_from, code_to]), _freq(frequency), _date(invest_date, "Investment date"), _date(start, "Transfer start"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    if a < a0:
        raise PerfError("Transfers cannot start before the investment date.")
    if code_from == code_to:
        raise PerfError("Pick two different funds.")
    init, transfer = _amount(init), (0.0 if profit_only else _amount(transfer))
    sa, sb = _need(_nav(code_from), f.iloc[0]["name"]), _need(_nav(code_to), f.iloc[1]["name"])
    _since(sa, f.iloc[0]["name"], a0, "an investment date")
    n0 = _at(sa, a0, lat)
    ua, ub, cost, moved, n = init / n0, 0.0, init, 0.0, 0
    for k, (d, nav) in enumerate(_dates(sa, a, b, step).items()):
        nb = _at(sb, d, lat)
        if not nb or sb.index[0] > d:
            continue
        va = ua * nav
        amt = max(0.0, va - cost) if profit_only else min(va, transfer * (1 + increase / 100) ** (k * step // 12))
        if amt <= 1e-9:
            continue
        ua -= amt / nav
        ub += amt / nb
        moved += amt
        n += 1
    va, vb = ua * _at(sa, b, lat), ub * _at(sb, b, lat)
    flows = [(a0, -init), (max(b, a0 + pd.Timedelta(days=1)), va + vb)]
    row = {"init": _r(init, 0), "period": frequency, "n": n, "moved": _r(moved, 0), "left": _r(va, 0), "to_value": _r(vb, 0), "value": _r(va + vb, 0), "profit": _r(va + vb - init, 0), "xirr": _r(xirr(flows))}
    cols = [("init", "Total Initial Investment"), ("period", "STP Period"), ("n", "No. of Installments"), ("moved", "Total Amount Transferred"), ("left", f"Left in {_short(f.iloc[0]['name'])}"), ("to_value", f"Value in {_short(f.iloc[1]['name'])}"),
            ("value", "Current Value"), ("profit", "Profit"), ("xirr", "Returns (XIRR %)", None, "ret")]
    return _table(title, cols, [row], NOTE)


def stp_returns(frame, code_from, code_to, init, invest_date, transfer, frequency, start, end, increase=0.0):
    return _stp(frame, code_from, code_to, init, invest_date, transfer, frequency, start, end, increase, False, "STP returns" + (f" with {increase:g}% annual increase" if increase else ""))


def stp_profit(frame, code_from, code_to, init, invest_date, frequency, start, end):
    return _stp(frame, code_from, code_to, init, invest_date, 0, frequency, start, end, 0, True, "STP: profit transfer")


# ---------------------------------------------------------------- rolling returns
def _monthly(s: pd.Series) -> pd.Series:
    """One point per month (missing months carried forward up to two months) so a 12-step shift is exactly one year."""
    m = s.groupby(s.index.to_period("M")).last()
    m = m.reindex(pd.period_range(m.index[0], m.index[-1], freq="M")).ffill(limit=2).dropna()
    m.index = m.index.to_timestamp("M")
    return m


def _roll(s: pd.Series, years: int, start: pd.Timestamp) -> pd.Series:
    s = _monthly(s)
    n = years * 12
    r = (s / s.shift(n)) ** (1 / years) - 1
    return (r[r.index >= start + pd.DateOffset(years=years)].dropna()) * 100


def _roll_row(name: str, r: pd.Series) -> dict[str, Any]:
    if r.empty:
        return {"scheme": name, "n": 0}
    d = (pd.cut(r, list(BUCKETS), right=False).value_counts(normalize=True).sort_index() * 100).round(2).tolist()
    return {"scheme": name, "n": int(len(r)), "avg": _r(r.mean()), "median": _r(r.median()), "max": _r(r.max()), "min": _r(r.min()), "std": _r(r.std()), **dict(zip(BNAMES, d))}


_ROLL_COLS = [("scheme", "Scheme / Category"), ("n", "Windows"), ("avg", "Average", "Return statistics (%)"), ("median", "Median", "Return statistics (%)"), ("max", "Maximum", "Return statistics (%)"),
              ("min", "Minimum", "Return statistics (%)"), ("std", "Std. Dev", "Return statistics (%)")] + [(k, l, "Return distribution (% of times)") for k, l in
              (("negative", "Negative"), ("0-8", "0 - 8%"), ("8-12", "8 - 12%"), ("12-15", "12 - 15%"), ("15-20", "15 - 20%"), (">20", "Greater than 20%"))]


def _cat_index(frame: pd.DataFrame, cat: str) -> pd.Series | None:
    return fp._category_avg_series(frame, cat)


def rolling_category(frame, codes, start, years):
    if years not in (1, 3, 5, 7, 10, 15):
        raise PerfError("Select a valid rolling period.")
    f, a = _fields(frame, codes), _date(start, "Start date")
    lab = labelled(frame).set_index("code")["_cat"]
    rows, cats = [], []
    for code, r in f.iterrows():
        rows.append(_roll_row(_short(r["name"]), _roll(_need(_nav(code), r["name"]), years, a)))
        if lab.get(code) not in cats:
            cats.append(lab.get(code))
    for c in cats:
        idx = _cat_index(frame, c)
        if idx is not None:
            rows.append(_roll_row(f"Category average: {c}", _roll(idx, years, a)))
    return _table(f"{years}-year rolling returns vs category", _ROLL_COLS, rows, "Rolling CAGR over every month-end window; the category line is the equal-weight average of its ten largest funds. " + NOTE)


def _bench_series(frame, name: str) -> pd.Series:
    if name not in BENCH:
        raise PerfError("Select a benchmark.")
    return _need(_nav(BENCH[name]), name)


def rolling_benchmark(frame, code, benchmark, start, years):
    if years not in (1, 3, 5, 10, 15):
        raise PerfError("Select a valid rolling period.")
    r, a = _one(frame, code), _date(start, "Start date")
    fund, bm = _roll(_need(_nav(code), r["name"]), years, a), _roll(_bench_series(frame, benchmark), years, a)
    j = pd.concat([fund, bm], axis=1, keys=["f", "b"]).dropna()
    rows = [_roll_row(_short(r["name"]), fund), _roll_row(benchmark, bm)]
    rows[0]["beat"] = _r((j["f"] > j["b"]).mean() * 100) if len(j) else None
    cols = _ROLL_COLS + [("beat", "Fund beat benchmark (% of times)")]
    return _table(f"{years}-year rolling returns vs benchmark", cols, rows, "The benchmark line is an index fund tracking the index, so it trails the true index slightly. " + NOTE)


def rolling_multi(frame, codes, start, years):
    if years not in (1, 3, 5, 10, 15):
        raise PerfError("Select a valid rolling period.")
    f, a = _fields(frame, codes), _date(start, "Start date")
    gold = labelled(frame)
    gold = gold[gold["_cat"].str.contains("Gold") & (gold["plan"] == "Regular")].sort_values("aum_cr", ascending=False)
    bms = {n: _bench_series(frame, n) for n in ("NIFTY 100 (index fund proxy)", "NIFTY 500 (index fund proxy)")}
    if len(gold) and (g := _nav(gold.iloc[0]["code"])) is not None:
        bms["Gold (largest gold fund)"] = g
    bm_roll = {n: _roll(s, years, a) for n, s in bms.items()}
    rows = []
    for code, r in f.iterrows():
        x = _roll(_need(_nav(code), r["name"]), years, a)
        row = _roll_row(_short(r["name"]), x)
        for i, (n, b) in enumerate(bm_roll.items()):
            j = pd.concat([x, b], axis=1, keys=["f", "b"]).dropna()
            row[f"beat{i}"] = _r((j["f"] > j["b"]).mean() * 100) if len(j) else None
        rows.append(row)
    for n, b in bm_roll.items():
        rows.append(_roll_row(n, b))
    cols = [c for c in _ROLL_COLS if c[0] != "std"] + [(f"beat{i}", f"Beat {n.split(' (')[0]} (%)", "Fund beat the market index (% of times)") for i, n in enumerate(bm_roll)]
    return _table(f"{years}-year rolling returns vs benchmarks", cols, rows, NOTE)


# ---------------------------------------------------------------- advanced tools
def _holdings(frame, codes):
    from app.api.backoffice import _holdings_snapshot
    from app.backoffice.mf_holdings import normalize_holding_name
    snap = (_holdings_snapshot().get("schemes") or {})
    out = {}
    for c in codes:
        w: dict[str, float] = {}
        for h in (snap.get(c) or {}).get("holdings", []):
            if h.get("instrument_type") == "equity" and (h.get("weight_pct") or 0) > 0:
                k = normalize_holding_name(h.get("name"))
                w[k] = w.get(k, 0) + h["weight_pct"]
        out[c] = w
    return out


def _display_names(frame, codes) -> dict[str, str]:
    from app.api.backoffice import _holdings_snapshot
    from app.backoffice.mf_holdings import normalize_holding_name
    snap = (_holdings_snapshot().get("schemes") or {})
    return {normalize_holding_name(h.get("name")): h["name"] for c in codes for h in (snap.get(c) or {}).get("holdings", []) if h.get("name")}


def common_stocks(frame, category, codes, plan):
    f = fp._scope(frame, category, plan)
    pick = _fields(frame, codes) if codes else f.sort_values("aum_cr", ascending=False).head(6).set_index("code")
    cs = list(pick.index)
    if len(cs) < 2:
        raise PerfError("Select at least two funds.")
    hold, names = _holdings(frame, cs), _display_names(frame, cs)
    stocks = sorted({k for c in cs for k in hold[c]}, key=lambda k: -sum(1 for c in cs if k in hold[c]))
    rows = []
    for k in stocks:
        n = sum(1 for c in cs if k in hold[c])
        if n >= 2:
            row = {"scheme": names.get(k, k), "count": n}
            row.update({c: _r(hold[c].get(k)) for c in cs})
            rows.append(row)
    rows.sort(key=lambda x: (-x["count"], -sum((x[c] or 0) for c in cs)))
    cols = [("scheme", "Company Name"), ("count", "Held by")] + [(c, _short(pick.loc[c, "name"]), "Holding (%)") for c in cs]
    return _table("Common stocks across schemes", cols, rows, "Stocks held by at least two of the funds, from the latest portfolio disclosures (partial coverage). " + NOTE)


def overlap(frame, codes):
    pick = _fields(frame, codes)
    if len(pick) < 2:
        raise PerfError("Select at least two funds.")
    hold, names = _holdings(frame, list(pick.index)), _display_names(frame, list(pick.index))
    cs = list(pick.index)
    miss = [pick.loc[c, "name"] for c in cs if not hold[c]]
    if miss:
        raise PerfError(f"No portfolio disclosure for {_short(miss[0])}.")
    pair = lambda a, b: sum(min(hold[a][k], hold[b][k]) for k in hold[a] if k in hold[b])  # noqa: E731
    rows = [{"scheme": "Overall overlap of all funds", **({"all": _r(sum(min(hold[c].get(k, 0) for c in cs) for k in hold[cs[0]]))})}]
    for k in sorted({k for c in cs for k in hold[c] if all(k in hold[x] for x in cs)} or {k for c in cs[:2] for k in hold[c] if k in hold[cs[0]] and k in hold[cs[1]]},
                    key=lambda k: -sum(hold[c].get(k, 0) for c in cs))[:50]:
        row = {"scheme": names.get(k, k), "all": _r(min(hold[c].get(k, 0) for c in cs))}
        row.update({c: _r(hold[c].get(k)) for c in cs})
        rows.append(row)
    matrix = [{"scheme": _short(pick.loc[a, "name"]), **{b: _r(pair(a, b)) if a != b else 100.0 for b in cs}} for a in cs]
    cols = [("scheme", "Fund / Stock"), ("all", "Overlap (%)")] + [(c, _short(pick.loc[c, "name"]), "Holding (%) / pairwise overlap (%)") for c in cs]
    return _table("Portfolio overlap", cols, rows + [{"scheme": "Pairwise overlap (%)"}] + matrix, "Overlap = the sum, over shared stocks, of the smaller of the two weights. " + NOTE)


def capture(frame, category, period, plan):
    f = fp._scope(frame, category, plan)
    if period not in (1, 3, 5, 10):
        raise PerfError("Select 1, 3, 5 or 10 years.")
    ret = {1: "ret_1y", 3: "cagr_3y", 5: "cagr_5y", 10: "cagr_10y"}[period]
    from app.backoffice.mf_screener import BENCHMARKS
    rows = [{"scheme": _short(r["name"]), "code": r["code"], "bench": BENCHMARKS.get(r["cat"], "Category average"), "launch": dmy(_launch_dates().get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"]),
             "cagr": _r(r[ret]), "up": _r(r[f"cap_up_{period}y"]), "down": _r(r[f"cap_down_{period}y"]), "ratio": _r(r[f"cap_ratio_{period}y"])} for _, r in f.iterrows() if pd.notna(r.get(f"cap_up_{period}y"))]
    rows.sort(key=lambda x: (x["ratio"] is None, -(x["ratio"] or 0)))
    cols = [("scheme", "Scheme Name"), ("bench", "Benchmark Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)"), ("cagr", "CAGR (%)", None, "ret"), ("up", "Up Market Capture"), ("down", "Down Market Capture"), ("ratio", "Capture Ratio")]
    return _table("Market capture ratio", cols, rows, "Capture ratios are from Advisorkhoj's published figures (equity categories only). " + NOTE)


def nav_changes(frame, category, plan, amc=None):
    f = fp._scope(frame, category, plan)
    if amc:
        f = f[f["amc"] == amc]
    rows = []
    for _, r in f.iterrows():
        s = _nav(r["code"])
        hi, lo = (float(s.max()), float(s.min())) if s is not None else (None, None)
        rows.append({"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(_launch_dates().get(r["code"])), "date": r["nav_date"], "nav": _r(r["nav"]), "hi": _r(hi), "lo": _r(lo),
                     "hi52": _r(r["hi52"]), "below": _r((r["nav"] / r["hi52"] - 1) * 100) if r["hi52"] else None, "lo52": _r(r["lo52"]), "above": _r((r["nav"] / r["lo52"] - 1) * 100) if r["lo52"] else None})
    rows.sort(key=lambda x: (x["below"] is None, -(x["below"] or -1e9)))
    cols = [("scheme", "Scheme Name"), ("launch", "Inception Date"), ("date", "Latest NAV Date"), ("nav", "Latest NAV"), ("hi", "Highest NAV (month-end)"), ("lo", "Lowest NAV (month-end)"), ("hi52", "52 Week Highest NAV"),
            ("below", "% below 52w high", None, "ret"), ("lo52", "52 Week Lowest NAV"), ("above", "% above 52w low", None, "ret")]
    return _table("NAV changes", cols, rows, "Highest and lowest NAV use month-end points; the 52-week figures use the daily series. " + NOTE)


def latest_nav(frame, category, plan, amc=None):
    f = fp._scope(frame, category, plan)
    if amc:
        f = f[f["amc"] == amc]
    rows = [{"scheme": _short(r["name"]), "code": r["code"], "amc": r["amc"], "date": r["nav_date"], "nav": _r(r["nav"], 4)} for _, r in f.sort_values("name").iterrows()]
    return _table("Mutual fund latest NAV", [("scheme", "Scheme Name"), ("amc", "AMC Name"), ("date", "Latest NAV Date"), ("nav", "Latest NAV (Rs)")], rows, "NAV of the Growth option of each scheme.")


def historical_nav(frame, code, start, end):
    r, a, b = _one(frame, code), _date(start, "Start date"), _date(end, "End date")
    _ranges(a, b)
    s = _need(_nav(code), r["name"])
    p = s[(s.index >= a + pd.offsets.MonthEnd(0)) & (s.index <= b + pd.offsets.MonthEnd(0))]
    lat = _latest(frame)
    rows = [{"scheme": dmy(min(d, lat) if d == s.index[-1] else d), "nav": _r(v, 4), "chg": _r((v / p.iloc[i - 1] - 1) * 100) if i else None} for i, (d, v) in enumerate(p.items())]
    return _table(f"Historical NAV of {_short(r['name'])}", [("scheme", "NAV Date"), ("nav", "NAV (Rs)"), ("chg", "Change vs previous (%)", None, "ret")], rows[::-1], "Month-end NAV only: the dataset has no daily NAV.")


def drawdown_now(frame, codes, start, end):
    f, a, b, lat = _fields(frame, codes), _date(start, "Start date"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    rows = []
    for code, r in f.iterrows():
        s = _need(_nav(code), r["name"])
        p = s[(s.index >= a + pd.offsets.MonthEnd(0)) & (s.index <= b + pd.offsets.MonthEnd(0))]
        if len(p) < 2:
            raise PerfError(f"Not enough NAV history for {_short(r['name'])} in that period.")
        peak = p.cummax()
        dd = (p / peak - 1) * 100
        pk = p.idxmax()
        rows.append({"scheme": _short(r["name"]), "peak": _r(p.max(), 4), "peak_date": dmy(pk), "nav": _r(p.iloc[-1], 4), "now": _r(dd.iloc[-1]), "max": _r(dd.min()), "max_date": dmy(dd.idxmin()),
                     "months": int(len(p[p.index > pk]))})
    cols = [("scheme", "Scheme"), ("peak", "Peak NAV"), ("peak_date", "Peak date"), ("nav", "NAV at end"), ("now", "Current drawdown (%)", None, "ret"), ("max", "Maximum drawdown (%)", None, "ret"), ("max_date", "Maximum drawdown at"), ("months", "Months since peak")]
    return _table("Current drawdown", cols, rows, NOTE)


def drawdown_recovery(frame, code, benchmark, threshold):
    r = _one(frame, code)
    if not 5 <= threshold <= 90:
        raise PerfError("Drawdown threshold must be between 5% and 90%.")
    sets = {_short(r["name"]): _need(_nav(code), r["name"]), benchmark: _bench_series(frame, benchmark)}
    rows = []
    for name, s in sets.items():
        peak, pk_d, trough, tr_d, in_dd = float(s.iloc[0]), s.index[0], None, None, False
        for d, v in s.items():
            v = float(v)
            if v >= peak:
                if in_dd:
                    rows.append({"scheme": name, "peak_date": dmy(pk_d), "trough_date": dmy(tr_d), "fall": _r((trough / peak - 1) * 100), "rec_date": dmy(d), "months": int((d.year - pk_d.year) * 12 + d.month - pk_d.month)})
                    in_dd = False
                peak, pk_d, trough, tr_d = v, d, None, None
            elif v / peak - 1 <= -threshold / 100:
                in_dd = True
                if trough is None or v < trough:
                    trough, tr_d = v, d
        if in_dd:
            rows.append({"scheme": name, "peak_date": dmy(pk_d), "trough_date": dmy(tr_d), "fall": _r((trough / peak - 1) * 100), "rec_date": "Not yet recovered", "months": None})
    cols = [("scheme", "Scheme / Benchmark"), ("peak_date", "Peak date"), ("trough_date", "Trough date"), ("fall", "Fall (%)", None, "ret"), ("rec_date", "Recovered on"), ("months", "Months peak to recovery")]
    return _table("Scheme and benchmark drawdown recovery", cols, rows, f"Every fall of {threshold:g}% or more from a peak, until the previous peak is regained. " + NOTE)


def elss_vs_ppf(frame, codes, mode, amount, frequency, start):
    f, a, lat = _fields(frame, codes), _date(start, "Start date"), _latest(frame)
    if mode not in ("lumpsum", "sip"):
        raise PerfError("Choose lumpsum or SIP.")
    amount = _amount(amount)
    step = {"Monthly": 1, "Quarterly": 3, "Half-yearly": 6, "Yearly": 12}.get(frequency)
    if step is None:
        raise PerfError("Choose a frequency.")
    ppf_flows, deposits = [], []

    def ppf_value(dates: list[pd.Timestamp], amts: list[float]) -> float:
        total = 0.0
        for d, am in zip(dates, amts):
            v, t = am, d
            while t < lat:
                nxt = min(pd.Timestamp(year=t.year + 1, month=1, day=1), lat)
                v *= 1 + PPF_RATE.get(t.year, 7.1) / 100 * ((nxt - t).days / 365.25)
                t = nxt
            total += v
        return total
    rows = []
    for code, r in f.iterrows():
        s = _need(_nav(code), r["name"])
        if mode == "lumpsum":
            _since(s, r["name"], a)
            n0 = _at(s, a, lat)
            val, inv, ds, ams = amount * s.iloc[-1] / n0, amount, [a], [amount]
        else:
            x = _sip(s, amount, a, lat, step, 0, lat)
            pts = _dates(s, a, lat, step)
            val, inv, ds, ams = x["value"], x["invested"], [_flow_date(d, s, lat) for d in pts.index], [amount] * len(pts)
        pv = ppf_value(ds, ams)
        yrs = max((lat - a).days / 365.25, 1e-9)
        f1 = xirr([(d, -am) for d, am in zip(ds, ams)] + [(lat + pd.Timedelta(days=1), val)])
        f2 = xirr([(d, -am) for d, am in zip(ds, ams)] + [(lat + pd.Timedelta(days=1), pv)])
        rows.append({"scheme": _short(r["name"]), "launch": dmy(_launch_dates().get(code)), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"]), "start": dmy(a), "inv": _r(inv, 0), "v_s": _r(val, 0), "v_p": _r(pv, 0),
                     "r_s": _r(f1), "r_p": _r(f2), "ex_a": _r(val - pv, 0), "ex_r": _r((f1 or 0) - (f2 or 0)) if f1 is not None and f2 is not None else None})
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)"), ("start", "Start Date"), ("inv", "Amount Invested"), ("v_s", "Scheme", "Value now"), ("v_p", "PPF", "Value now"),
            ("r_s", "Scheme", "Return (XIRR %)", "ret"), ("r_p", "PPF", "Return (XIRR %)", "ret"), ("ex_a", "Amount", "Excess by scheme", "ret"), ("ex_r", "Rtn points", "Excess by scheme", "ret")]
    return _table("ELSS vs PPF", cols, rows, "PPF is shown at each calendar year's notified rate, with every deposit earning interest for its time in the year (the real PPF averages the monthly lowest balance). " + NOTE)


# ---------------------------------------------------------------- benchmark proxies
def bench_returns(frame, benchmark, mode, amount, frequency, start, end):
    a, b, lat = _date(start, "Start date"), _date(end, "End date"), _latest(frame)
    _ranges(a, b)
    s = _bench_series(frame, benchmark)
    amount = _amount(amount)
    if mode == "Lumpsum":
        _since(s, benchmark, a)
        n0, n1 = _at(s, a, lat), _at(s, b, lat)
        val = amount * n1 / n0
        row = {"scheme": benchmark, "amount": _r(amount, 0), "invested": _r(amount, 0), "value": _r(val, 0), "gain": _r(val - amount, 0), "xirr": _r(xirr([(a, -amount), (b, val)]))}
    elif mode == "SIP":
        x = _sip(s, amount, a, b, _freq(frequency), 0, lat)
        row = {"scheme": benchmark, "amount": _r(amount, 0), "invested": _r(x["invested"], 0), "value": _r(x["value"], 0), "gain": _r(x["value"] - x["invested"], 0), "xirr": _r(x["xirr"])}
    else:
        raise PerfError("Choose SIP or Lumpsum.")
    cols = [("scheme", "Benchmark Name"), ("amount", "Amount"), ("invested", "Total Invested"), ("value", "Total Amount incl. Growth"), ("gain", "Growth Amount"), ("xirr", "XIRR (%)", None, "ret")]
    return _table(f"Benchmark {mode.lower()} return", cols, [row], "The benchmark is an index fund tracking the index, so it trails the true index slightly. " + NOTE)


def bench_nav(frame, benchmark, start, end):
    a, b = _date(start, "Start date"), _date(end, "End date")
    _ranges(a, b)
    s = _bench_series(frame, benchmark)
    p = s[(s.index >= a + pd.offsets.MonthEnd(0)) & (s.index <= b + pd.offsets.MonthEnd(0))]
    lat = _latest(frame)
    return _table(f"Benchmark NAV: {benchmark}", [("d", "NAV Date"), ("v", "NAV (Rs)")], [{"d": dmy(min(d, lat) if d == s.index[-1] else d), "v": _r(v, 4)} for d, v in p.items()][::-1], "Value of the index fund tracking the index, at month-end. " + NOTE)


# ---------------------------------------------------------------- ranking
def _quart(vals: pd.Series, higher_better: bool = True) -> pd.Series:
    """1 = best quarter of the peer group, 4 = worst."""
    r = vals.rank(pct=True, ascending=not higher_better, method="min")
    return r.apply(lambda p: np.nan if pd.isna(p) else min(4, max(1, math.ceil(p * 4))))


def _rank_table(frame, category, plan, spec, title, note):
    f = fp._scope(frame, category, plan)
    rows = []
    q = {c: _quart(pd.to_numeric(f[c], errors="coerce"), hb) for _, c, _, hb in spec}
    for i, r in f.iterrows():
        row = {"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(_launch_dates().get(r["code"])), "aum": _r(r["aum_cr"], 0), "ter": _r(r["ter"])}
        for key, c, _, _ in spec:
            row[key], row[key + "_q"] = _r(r[c]), (None if pd.isna(q[c].loc[i]) else int(q[c].loc[i]))
        rows.append(row)
    rows.sort(key=lambda x: (x[spec[0][0] + "_q"] is None, x[spec[0][0] + "_q"] or 9, x[spec[0][0]] or 0))
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)"), ("ter", "TER (%)")]
    for key, _, label, _ in spec:
        cols += [(key, label), (key + "_q", f"Quartile Rank - {label.split()[0]}")]
    return _table(title, cols, rows, note)


def rank_volatility(frame, category, plan):
    return _rank_table(frame, category, plan, [("sd", "vol_3y", "Standard Deviation (3Y)", False), ("beta", "beta_3y", "Beta (3Y)", False)], "Mutual fund volatility ranking", "Quartile 1 = least volatile quarter of the category. " + NOTE)


def rank_risk_adjusted(frame, category, plan):
    return _rank_table(frame, category, plan, [("sharpe", "sharpe_3y", "Sharpe Ratio (3Y)", True), ("alpha", "alpha_3y", "Alpha (3Y)", True)], "Mutual fund risk adjusted returns ranking", "Quartile 1 = best quarter of the category. " + NOTE)


def _calendar_quartiles(f: pd.DataFrame, labels: list[tuple[str, Callable]], title: str, details: str) -> dict[str, Any]:
    series = {c: _nav(c) for c in f["code"]}
    rets = pd.DataFrame({c: {k: fn(s) for k, fn in labels} for c, s in series.items() if s is not None}).T
    qs = rets.apply(lambda col: _quart(col.astype(float), True))
    rows = []
    for _, r in f.iterrows():
        if r["code"] not in rets.index:
            continue
        row = {"scheme": _short(r["name"]), "code": r["code"], "launch": dmy(_launch_dates().get(r["code"])), "aum": _r(r["aum_cr"], 0)}
        for k, _ in labels:
            v = qs.loc[r["code"], k]
            row[k] = None if pd.isna(v) else int(v)
            row[k + "_r"] = _r(rets.loc[r["code"], k])
        rows.append(row)
    rows.sort(key=lambda x: (x[labels[-1][0]] is None, x[labels[-1][0]] or 9, x["scheme"]))
    cols = [("scheme", "Scheme Name"), ("launch", "Launch Date"), ("aum", "AUM (Crore)")] + [(k, k, details) for k, _ in labels]
    return _table(title, cols, rows, "Cells show the quartile (1 = top quarter, 4 = bottom) of the fund's return among the category's funds; hover a row's data in the export for the return. " + NOTE)


def quartile_annual(frame, category, plan):
    f = fp._scope(frame, category, plan)
    last = _latest(frame)
    ys = list(range(last.year - 10, last.year + 1))

    def fn(y):
        def g(s):
            e, p = s[s.index.year == y], s[s.index.year < y]
            return (e.iloc[-1] / p.iloc[-1] - 1) * 100 if len(e) and len(p) and p.index[-1].year == y - 1 else np.nan
        return g
    return _calendar_quartiles(f, [(f"{y} YTD" if y == last.year else str(y), fn(y)) for y in ys], "Mutual fund quartile ranking", "Calendar-year quartile")


def quartile_quarterly(frame, category, plan):
    f = fp._scope(frame, category, plan)
    last = _latest(frame)
    qe = [d for d in pd.date_range(end=last, periods=14, freq="QE")][-12:]

    def fn(d):
        def g(s):
            p = s[(s.index.year == d.year) & (s.index.month == d.month)]
            q = s[(s.index <= d - pd.offsets.QuarterEnd(1))]
            return (p.iloc[0] / q.iloc[-1] - 1) * 100 if len(p) and len(q) and (d - q.index[-1]).days < 130 else np.nan
        return g
    return _calendar_quartiles(f, [(d.strftime("%b %Y"), fn(d)) for d in qe], "Mutual fund quartile ranking for quarterly returns", "Quarter ending")


def top_quartile(frame, category, plan):
    f = fp._scope(frame, category, plan)
    spec = [("1y", "ret_1y", "1 Year"), ("2y", "ret_2y", "2 Year"), ("3y", "cagr_3y", "3 Year"), ("5y", "cagr_5y", "5 Year"), ("10y", "cagr_10y", "10 Year")]
    rows = [{"scheme": "Average of top-quartile funds"}, {"scheme": "Category average"}, {"scheme": "Best fund"}, {"scheme": "Funds with data"}]
    for k, c, _ in spec:
        v = pd.to_numeric(f[c], errors="coerce").dropna()
        if len(v) < 4:
            continue
        top = v[v >= v.quantile(0.75)]
        rows[0][k], rows[1][k], rows[2][k], rows[3][k] = _r(top.mean()), _r(v.mean()), _r(v.max()), int(len(v))
    return _table("Average top quartile funds trailing returns", [("scheme", "Performance")] + [(k, l, None, "ret") for k, _, l in spec], rows, "Top quartile = funds at or above the 75th percentile of the category for that period. " + NOTE)


# ---------------------------------------------------------------- benchmark wrappers
def bench_swp(frame, benchmark, lumpsum, invest_date, amount, frequency, start, end, increase=0.0):
    t = swp_returns(frame, BENCH_CODE(benchmark), lumpsum, invest_date, amount, frequency, start, end, increase)
    t["title"] = "Benchmark SWP return"
    t["rows"][0]["scheme"] = benchmark
    return t


def bench_stp(frame, benchmark_from, benchmark_to, init, invest_date, transfer, frequency, start, end):
    t = stp_returns(frame, BENCH_CODE(benchmark_from), BENCH_CODE(benchmark_to), init, invest_date, transfer, frequency, start, end)
    t["title"] = "Benchmark STP return"
    return t


def bench_rolling(frame, benchmarks, start, years):
    if years not in (1, 2, 3, 5, 7, 10, 15):
        raise PerfError("Select a valid rolling period.")
    a = _date(start, "Start date")
    rows = [_roll_row(b, _roll(_bench_series(frame, b), years, a)) for b in benchmarks]
    return _table(f"{years}-year rolling returns of benchmarks", _ROLL_COLS, rows, "Benchmarks are index funds tracking the index. " + NOTE)


def BENCH_CODE(name: str) -> str:
    if name not in BENCH:
        raise PerfError("Select a benchmark.")
    return BENCH[name]


# ---------------------------------------------------------------- the tools (one description drives the API and the page)
def _f(key, label, type_, **kw):
    return {"key": key, "label": label, "type": type_, **kw}


_FREQ = dict(options=list(FREQ), default="Monthly")
_START = lambda y: dict(default=f"-{y}y")  # noqa: E731
_B = list(BENCH)
TOOLS: list[dict[str, Any]] = [
    {"id": "sip-returns", "group": "SIP / STP / SWP", "title": "SIP returns", "blurb": "Value and XIRR of a SIP in up to 5 funds.", "fn": sip_returns, "fields": [
        _f("codes", "Funds", "funds", max=5), _f("amount", "SIP amount (Rs.)", "number", default=3000), _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Start date", "date", **_START(3)), _f("end", "End date", "date", default="today")]},
    {"id": "sip-topup", "group": "SIP / STP / SWP", "title": "SIP with annual increase", "blurb": "A SIP whose instalment rises every year, against a fixed SIP.", "fn": sip_topup, "fields": [
        _f("code", "Fund", "fund"), _f("amount", "SIP amount (Rs.)", "number", default=5000), _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Start date", "date", **_START(10)), _f("end", "End date", "date", default="today"),
        _f("topup", "Yearly increase (%)", "select", options=["5", "10", "15", "20", "25"], default="10", cast="float")]},
    {"id": "sip-top", "group": "SIP / STP / SWP", "title": "Top performing SIP funds", "blurb": "SIP return of every fund in a category over 1, 3 and 5 years.", "fn": sip_top, "fields": [
        _f("category", "Category", "category"), _f("amount", "Monthly SIP (Rs.)", "number", default=10000), _f("plan", "Plan", "plan")]},
    {"id": "swp-returns", "group": "SIP / STP / SWP", "title": "SWP returns", "blurb": "Withdrawals from a lumpsum: what was taken, what is left, and the return.", "fn": swp_returns, "fields": [
        _f("code", "Fund", "fund"), _f("lumpsum", "Lumpsum (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(10)), _f("amount", "Withdrawal (Rs.)", "number", default=5000),
        _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Withdrawals start", "date", **_START(10)), _f("end", "End date", "date", default="today")]},
    {"id": "swp-increase", "group": "SIP / STP / SWP", "title": "SWP with annual increase", "blurb": "A withdrawal that rises every year.", "fn": swp_returns, "fields": [
        _f("code", "Fund", "fund"), _f("lumpsum", "Lumpsum (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(10)), _f("amount", "Withdrawal (Rs.)", "number", default=5000),
        _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Withdrawals start", "date", **_START(10)), _f("end", "End date", "date", default="today"),
        _f("increase", "Yearly increase (%)", "select", options=["5", "10", "15", "20", "25"], default="10", cast="float")]},
    {"id": "swp-top", "group": "SIP / STP / SWP", "title": "Best SWP funds", "blurb": "The same SWP run on every fund of a category.", "fn": swp_top, "fields": [
        _f("category", "Category", "category"), _f("lumpsum", "Lumpsum (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(10)), _f("amount", "Withdrawal (Rs.)", "number", default=5000),
        _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Withdrawals start", "date", **_START(10)), _f("end", "End date", "date", default="today"), _f("plan", "Plan", "plan")]},
    {"id": "swp-multi", "group": "SIP / STP / SWP", "title": "SWP with multiple schemes", "blurb": "One withdrawal drawn from two schemes in proportion to their value.", "fn": swp_multi, "fields": [
        _f("code1", "Scheme 1", "fund"), _f("amount1", "Lumpsum 1 (Rs.)", "number", default=600000), _f("code2", "Scheme 2", "fund"), _f("amount2", "Lumpsum 2 (Rs.)", "number", default=400000),
        _f("invest_date", "Investment date", "date", **_START(10)), _f("withdrawal", "Withdrawal (Rs.)", "number", default=5000), _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Withdrawals start", "date", **_START(10)), _f("end", "End date", "date", default="today")]},
    {"id": "stp-returns", "group": "SIP / STP / SWP", "title": "STP returns", "blurb": "A lumpsum moved into another fund in instalments.", "fn": stp_returns, "fields": [
        _f("code_from", "From fund", "fund"), _f("code_to", "To fund", "fund"), _f("init", "Initial investment (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(5)),
        _f("transfer", "Transfer (Rs.)", "number", default=20000), _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Transfers start", "date", **_START(5)), _f("end", "End date", "date", default="today")]},
    {"id": "stp-increase", "group": "SIP / STP / SWP", "title": "STP with annual increase", "blurb": "A transfer that rises every year.", "fn": stp_returns, "fields": [
        _f("code_from", "From fund", "fund"), _f("code_to", "To fund", "fund"), _f("init", "Initial investment (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(5)),
        _f("transfer", "Transfer (Rs.)", "number", default=10000), _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Transfers start", "date", **_START(5)), _f("end", "End date", "date", default="today"),
        _f("increase", "Yearly increase (%)", "select", options=["5", "10", "15", "20", "25", "50", "75", "100"], default="10", cast="float")]},
    {"id": "stp-profit", "group": "SIP / STP / SWP", "title": "STP: profit transfer", "blurb": "Only the gains of a low-risk fund are moved into a growth fund.", "fn": stp_profit, "fields": [
        _f("code_from", "From fund", "fund"), _f("code_to", "To fund", "fund"), _f("init", "Initial investment (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(3)),
        _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Transfers start", "date", **_START(3)), _f("end", "End date", "date", default="today")]},
    {"id": "rolling-category", "group": "Rolling returns", "title": "Rolling return vs category", "blurb": "Rolling return statistics and distribution of funds against their category.", "fn": rolling_category, "fields": [
        _f("codes", "Funds", "funds", max=5), _f("start", "Windows start from", "date", **_START(10)), _f("years", "Rolling period", "select", options=["1", "3", "5", "7", "10", "15"], default="3", cast="int")]},
    {"id": "rolling-benchmark", "group": "Rolling returns", "title": "Rolling return vs benchmark", "blurb": "Rolling returns of a fund against an index fund proxy.", "fn": rolling_benchmark, "fields": [
        _f("code", "Fund", "fund"), _f("benchmark", "Benchmark", "select", options=_B, default=_B[1]), _f("start", "Windows start from", "date", **_START(10)), _f("years", "Rolling period", "select", options=["1", "3", "5", "10", "15"], default="3", cast="int")]},
    {"id": "rolling-multi", "group": "Rolling returns", "title": "Rolling return vs multiple benchmarks", "blurb": "How often a fund beat NIFTY 100, NIFTY 500 and gold.", "fn": rolling_multi, "fields": [
        _f("codes", "Funds", "funds", max=5), _f("start", "Windows start from", "date", **_START(10)), _f("years", "Rolling period", "select", options=["1", "3", "5", "10", "15"], default="3", cast="int")]},
    {"id": "common-stocks", "group": "Advanced tools", "title": "Common stocks across schemes", "blurb": "Stocks held by several funds of a category.", "fn": common_stocks, "fields": [
        _f("category", "Category", "category"), _f("codes", "Funds (optional: leave empty for the six largest)", "funds", max=8, optional=True), _f("plan", "Plan", "plan")]},
    {"id": "overlap", "group": "Advanced tools", "title": "Portfolio overlap", "blurb": "How much of two to five funds' portfolios is the same.", "fn": overlap, "fields": [_f("codes", "Funds", "funds", max=5)]},
    {"id": "capture", "group": "Advanced tools", "title": "Market capture ratio", "blurb": "Up and down market capture of every fund in a category.", "fn": capture, "fields": [
        _f("category", "Category", "category"), _f("period", "Period (years)", "select", options=["1", "3", "5", "10"], default="3", cast="int"), _f("plan", "Plan", "plan")]},
    {"id": "nav-changes", "group": "Advanced tools", "title": "NAV changes", "blurb": "Latest NAV against its highest, lowest and 52-week range.", "fn": nav_changes, "fields": [
        _f("category", "Category", "category"), _f("amc", "Fund house (optional)", "amc", optional=True), _f("plan", "Plan", "plan")]},
    {"id": "latest-nav", "group": "Advanced tools", "title": "Latest NAV", "blurb": "Latest NAV of every scheme in a category.", "fn": latest_nav, "fields": [
        _f("category", "Category", "category"), _f("amc", "Fund house (optional)", "amc", optional=True), _f("plan", "Plan", "plan")]},
    {"id": "historical-nav", "group": "Advanced tools", "title": "Historical NAV", "blurb": "Month-end NAV of a fund between two dates.", "fn": historical_nav, "fields": [
        _f("code", "Fund", "fund"), _f("start", "Start date", "date", **_START(3)), _f("end", "End date", "date", default="today")]},
    {"id": "drawdown-now", "group": "Advanced tools", "title": "Current drawdown", "blurb": "How far funds are below their peak, and their worst fall in the period.", "fn": drawdown_now, "fields": [
        _f("codes", "Funds", "funds", max=5), _f("start", "Start date", "date", **_START(3)), _f("end", "End date", "date", default="today")]},
    {"id": "drawdown-recovery", "group": "Advanced tools", "title": "Scheme vs benchmark drawdown recovery", "blurb": "Every big fall and how long the fund and the benchmark took to recover.", "fn": drawdown_recovery, "fields": [
        _f("code", "Fund", "fund"), _f("benchmark", "Benchmark", "select", options=_B, default=_B[1]), _f("threshold", "Fall of at least (%)", "number", default=15)]},
    {"id": "elss-vs-ppf", "group": "Advanced tools", "title": "ELSS vs PPF", "blurb": "Lumpsum or SIP in ELSS funds against the same money in PPF.", "fn": elss_vs_ppf, "fields": [
        _f("codes", "ELSS funds", "funds", max=5), _f("mode", "Mode", "select", options=["lumpsum", "sip"], default="sip"), _f("amount", "Amount (Rs.)", "number", default=5000),
        _f("frequency", "Frequency (SIP)", "select", options=["Monthly", "Quarterly", "Half-yearly", "Yearly"], default="Monthly"), _f("start", "Start date", "date", **_START(10))]},
    {"id": "bench-returns", "group": "Benchmark", "title": "Benchmark lumpsum and SIP returns", "blurb": "Lumpsum or SIP return of an index.", "fn": bench_returns, "fields": [
        _f("benchmark", "Benchmark", "select", options=_B, default=_B[1]), _f("mode", "Mode", "select", options=["SIP", "Lumpsum"], default="SIP"), _f("amount", "Amount (Rs.)", "number", default=3000),
        _f("frequency", "Frequency (SIP)", "select", **_FREQ), _f("start", "Start date", "date", **_START(10)), _f("end", "End date", "date", default="today")]},
    {"id": "bench-nav", "group": "Benchmark", "title": "Benchmark NAV", "blurb": "Month-end value of the index fund tracking each benchmark.", "fn": bench_nav, "fields": [
        _f("benchmark", "Benchmark", "select", options=_B, default=_B[1]), _f("start", "Start date", "date", **_START(3)), _f("end", "End date", "date", default="today")]},
    {"id": "bench-swp", "group": "Benchmark", "title": "Benchmark SWP return", "blurb": "A withdrawal plan run on an index.", "fn": bench_swp, "fields": [
        _f("benchmark", "Benchmark", "select", options=_B, default=_B[1]), _f("lumpsum", "Lumpsum (Rs.)", "number", default=1000000), _f("invest_date", "Investment date", "date", **_START(5)), _f("amount", "Withdrawal (Rs.)", "number", default=5000),
        _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Withdrawals start", "date", **_START(5)), _f("end", "End date", "date", default="today")]},
    {"id": "bench-stp", "group": "Benchmark", "title": "Benchmark STP", "blurb": "A transfer plan between two indices.", "fn": bench_stp, "fields": [
        _f("benchmark_from", "From", "select", options=_B, default=_B[0]), _f("benchmark_to", "To", "select", options=_B, default=_B[2]), _f("init", "Initial investment (Rs.)", "number", default=1000000),
        _f("invest_date", "Investment date", "date", **_START(5)), _f("transfer", "Transfer (Rs.)", "number", default=20000), _f("frequency", "Frequency", "select", **_FREQ), _f("start", "Transfers start", "date", **_START(5)), _f("end", "End date", "date", default="today")]},
    {"id": "bench-rolling", "group": "Benchmark", "title": "Rolling returns of benchmark", "blurb": "Rolling return statistics of indices.", "fn": bench_rolling, "fields": [
        _f("benchmarks", "Benchmarks", "multi", options=_B, default=_B[:2]), _f("start", "Windows start from", "date", **_START(10)), _f("years", "Rolling period", "select", options=["1", "2", "3", "5", "7", "10", "15"], default="3", cast="int")]},
    {"id": "rank-volatility", "group": "Ranking", "title": "Volatility ranking", "blurb": "Standard deviation and beta with quartile ranks.", "fn": rank_volatility, "fields": [_f("category", "Category", "category"), _f("plan", "Plan", "plan")]},
    {"id": "rank-risk", "group": "Ranking", "title": "Risk adjusted returns ranking", "blurb": "Sharpe ratio and alpha with quartile ranks.", "fn": rank_risk_adjusted, "fields": [_f("category", "Category", "category"), _f("plan", "Plan", "plan")]},
    {"id": "quartile-annual", "group": "Ranking", "title": "Quartile ranking, annual returns", "blurb": "Quartile of each fund in every calendar year.", "fn": quartile_annual, "fields": [_f("category", "Category", "category"), _f("plan", "Plan", "plan")]},
    {"id": "quartile-quarterly", "group": "Ranking", "title": "Quartile ranking, quarterly returns", "blurb": "Quartile of each fund in each of the last 12 quarters.", "fn": quartile_quarterly, "fields": [_f("category", "Category", "category"), _f("plan", "Plan", "plan")]},
    {"id": "top-quartile", "group": "Ranking", "title": "Average top quartile funds trailing returns", "blurb": "What top-quartile funds of a category returned over each period.", "fn": top_quartile, "fields": [_f("category", "Category", "category"), _f("plan", "Plan", "plan")]},
]
BY_ID = {t["id"]: t for t in TOOLS}


def spec() -> list[dict[str, Any]]:
    return [{k: v for k, v in t.items() if k != "fn"} for t in TOOLS]


def _parse(f: dict[str, Any], raw: str | None) -> Any:
    if raw is None or raw == "":
        if f.get("optional"):
            return None
        raise PerfError(f"{f['label']}: please select or enter a value.")
    t = f["type"]
    try:
        if t == "number":
            v = float(raw)
            if not math.isfinite(v):
                raise ValueError
            return v
        if t == "funds":
            codes = [c.strip() for c in raw.split(",") if c.strip()]
            if len(codes) > f.get("max", 5):
                raise PerfError(f"{f['label']}: select at most {f.get('max', 5)}.")
            return codes
        if t == "multi":
            vals = [c.strip() for c in raw.split("|") if c.strip()]
            bad = [v for v in vals if v not in f["options"]]
            if bad:
                raise PerfError(f"{f['label']}: unknown choice {bad[0]}.")
            return vals
        if t == "select":
            if raw not in f["options"]:
                raise PerfError(f"{f['label']}: choose one of the options.")
            return {"int": int, "float": float}.get(f.get("cast"), str)(raw)
        if t == "date":
            datetime.strptime(raw, "%Y-%m-%d")
        return raw
    except (TypeError, ValueError):
        raise PerfError(f"{f['label']}: enter a valid value.") from None


def run(frame: pd.DataFrame, tool_id: str, params: dict[str, str]) -> dict[str, Any]:
    t = BY_ID.get(tool_id)
    if t is None:
        raise PerfError("Unknown tool.")
    kw = {}
    for f in t["fields"]:
        v = _parse(f, params.get(f["key"]))
        if v is not None:
            kw[f["key"]] = v
    if tool_id == "swp-returns":
        kw["increase"] = 0.0
    return t["fn"](frame, **kw)
