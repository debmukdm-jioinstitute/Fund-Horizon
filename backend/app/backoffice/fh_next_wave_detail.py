from __future__ import annotations
"""Drill-down data behind the FH Next Wave breakdown, for every input of every part (Momentum, Acceleration, Consistency,
Risk skill, Cost): the history behind the number (tiles, plain insights, a chart and a table) and the peer ranking.

History comes from month-end NAVs of the fund and the monthly median return of its category, the same basis as the
precomputed consistency metrics (mf_research_v2.compute_consistency), so the totals here match the table."""
from functools import lru_cache

import numpy as np
import pandas as pd

from app.backoffice.mf_research_v2 import calendar_year_returns

ROLLING_YEARS = 5
# input -> (higher is better, unit shown beside the value)
PEER_INPUTS: dict[str, tuple[bool, str]] = {
    "ret_1y": (True, "%"), "cagr_3y": (True, "%"), "accel_3y_5y": (True, " points"), "roll_win_pct": (True, "%"), "cal_win_pct": (True, "%"),
    "alpha_3y": (True, "%"), "sortino_3y": (True, ""), "max_dd_3y": (True, "%"), "ter": (False, "%"),
    "q_level": (True, " of 1"), "q_trend": (True, " of 1"), "aum_fit": (True, " of 1"),
}
_PARTS = ("quartile", "momentum", "acceleration", "consistency", "risk", "size", "cost")
ROW_ONLY = ("q_level", "q_trend", "aum_fit")  # explained from the fund's own row, no NAV history needed
POS, NEG = "pos", "neg"


def _ms(d) -> str:
    return pd.Timestamp(d).strftime("%b %Y")


def _p(x: float, d: int = 1, sign: bool = True) -> str:
    return f"{x:+.{d}f}%" if sign else f"{x:.{d}f}%"


def _num(row, k):
    v = row.get(k)
    return None if v is None or pd.isna(v) else float(v)


def _out(inp, title, basis, tiles, insights, chart=None, table=None, reason=None) -> dict:
    if reason:
        return {"input": inp, "title": title, "available": False, "reason": reason, "basis": basis}
    return {"input": inp, "title": title, "available": True, "basis": basis, "tiles": [{"label": a, "value": b, "hint": c} for a, b, c in tiles],
            "insights": insights, "chart": chart, "table": table}


def _signed_bars(title, x, y, unit="%") -> dict:
    return {"kind": "bars", "title": title, "unit": unit, "x": x, "series": [{"name": "Edge", "values": y}]}


def _lines(title, x, fund, med, unit="%", names=("Fund", "Category median")) -> dict:
    return {"kind": "lines", "title": title, "unit": unit, "x": x, "series": [{"name": names[0], "values": fund}, {"name": names[1], "values": med}]}


def _streaks(won: list[bool], dates: list[pd.Timestamp]) -> dict:
    """Longest winning and losing runs (consecutive windows, oldest first) and the run in progress."""
    best: dict[bool, tuple[int, int]] = {True: (0, 0), False: (0, 0)}
    i = 0
    while i < len(won):
        j = i
        while j + 1 < len(won) and won[j + 1] == won[i]:
            j += 1
        if j - i + 1 > best[won[i]][0]:
            best[won[i]] = (j - i + 1, i)
        i = j + 1
    out: dict = {}
    for key, flag in (("win", True), ("loss", False)):
        n, s = best[flag]
        out[key] = {"length": n, "from": _ms(dates[s]) if n else None, "to": _ms(dates[s + n - 1]) if n else None}
    k = len(won) - 1
    while k > 0 and won[k - 1] == won[-1]:
        k -= 1
    out["current"] = {"won": bool(won[-1]), "length": len(won) - k}
    return out


def _roll(m: pd.Series, d: pd.Series, n: int) -> pd.DataFrame:
    """Rolling n-month return of the fund and of the category median, aligned."""
    return pd.DataFrame({"f": m / m.shift(n) - 1.0, "m": (1.0 + d).rolling(n).apply(lambda x: float(np.prod(x)) - 1.0, raw=True)}).dropna()


def rolling_detail(m: pd.Series, d: pd.Series, row) -> dict:
    basis = "A window is won when the fund's 12 month return beats the median fund of the same category over the same 12 months. Windows end every month for the last 5 years."
    both = _roll(m, d, 12)
    both = both[(both.index > m.index[-1] - pd.DateOffset(years=ROLLING_YEARS)) & (both.index <= m.index[-1])]
    if len(both) < 12:
        return _out("roll_win_pct", "Rolling windows won", basis, [], [], reason="Fewer than 12 rolling windows with both fund and category data.")
    won = (both["f"] > both["m"]).tolist()
    dates = list(both.index)
    edge = (both["f"] - both["m"]) * 100
    n_won, pct = sum(won), round(sum(won) / len(won) * 100, 1)
    st = _streaks(won, dates)
    bi, wi = int(edge.values.argmax()), int(edge.values.argmin())
    insights = [f"Won {n_won} of {len(won)} rolling 12 month windows ({pct}%) against the category median, windows ending {_ms(dates[0])} to {_ms(dates[-1])}."]
    if st["win"]["length"]:
        insights.append(f"Longest winning run: {st['win']['length']} months in a row, windows ending {st['win']['from']} to {st['win']['to']}.")
    if st["loss"]["length"]:
        insights.append(f"Longest losing run: {st['loss']['length']} months in a row, windows ending {st['loss']['from']} to {st['loss']['to']}.")
    insights.append(f"Biggest lead: {edge.iloc[bi]:+.1f} points in the year ending {_ms(dates[bi])}. Biggest lag: {edge.iloc[wi]:+.1f} points in the year ending {_ms(dates[wi])}.")
    c = st["current"]
    insights.append(f"Right now the fund is {'ahead of' if c['won'] else 'behind'} the category median and has been for {c['length']} month{'s' if c['length'] != 1 else ''}.")
    by_year = []
    for y in sorted({x.year for x in dates}):
        idx = [i for i, x in enumerate(dates) if x.year == y]
        by_year.append((y, sum(won[i] for i in idx), len(idx)))
    insights.append("By year of window end: " + ", ".join(f"{y}: {w} of {n}" for y, w, n in by_year) + ".")
    tiles = [("Windows won", f"{n_won} of {len(won)}", f"{pct}%"), ("Windows lost", str(len(won) - n_won), None), ("Average lead", _p(float(edge.mean())) .replace("%", " pts"), "per window"),
             ("Longest winning run", f"{st['win']['length']} months", f"{st['win']['from']} to {st['win']['to']}" if st["win"]["length"] else None)]
    table = {"columns": ["Window (12 months ending)", "Fund", "Category median", "Lead", "Result"],
             "rows": [[f"{_ms(x - pd.DateOffset(months=12))} to {_ms(x)}", _p(f * 100, 2), _p(mm * 100, 2), [f"{e:+.2f} pts", POS if w else NEG], ["Won" if w else "Lost", POS if w else NEG]]
                      for x, f, mm, e, w in zip(dates[::-1], both["f"][::-1], both["m"][::-1], edge[::-1], won[::-1])]}
    return _out("roll_win_pct", "Rolling windows won", basis, tiles, insights, _signed_bars("Lead over the category median in each rolling 12 month window (points)", [_ms(x) for x in dates], [round(float(e), 2) for e in edge], " pts"), table)


def calendar_detail(m: pd.Series, d: pd.Series, row) -> dict:
    basis = "A year is won when the fund's calendar year return beats the compounded return of the median fund of the same category. Only full calendar years count."
    fc = calendar_year_returns(m)
    rows = []
    for y in sorted(fc):
        seg = d[d.index.year == y]
        if len(seg) >= 12:
            mm = float((1.0 + seg).prod() - 1.0)
            rows.append((y, fc[y] * 100, mm * 100, (fc[y] - mm) * 100, fc[y] > mm))
    if len(rows) < 3:
        return _out("cal_win_pct", "Calendar years won", basis, [], [], reason="Fewer than 3 full calendar years with both fund and category data.")
    n_won = sum(r[4] for r in rows)
    best, worst = max(rows, key=lambda r: r[3]), min(rows, key=lambda r: r[3])
    lost = [str(r[0]) for r in rows if not r[4]]
    insights = [f"Beat the category median in {n_won} of {len(rows)} full calendar years ({round(n_won / len(rows) * 100, 1)}%).",
                f"Best year: {best[0]}, {best[3]:+.1f} points ahead ({_p(best[1])} against {_p(best[2])}).",
                f"Weakest year: {worst[0]}, {worst[3]:+.1f} points ({_p(worst[1])} against {_p(worst[2])}).",
                ("Years it did not beat the median: " + ", ".join(lost) + ".") if lost else "It beat the median in every full calendar year."]
    top = _num(row, "cal_topq_years")
    if top is not None:
        insights.append(f"In {int(top)} of those years it also finished in the top quarter of its category and plan.")
    tiles = [("Years won", f"{n_won} of {len(rows)}", f"{round(n_won / len(rows) * 100, 1)}%"), ("Years lost", str(len(rows) - n_won), None),
             ("Average lead", f"{sum(r[3] for r in rows) / len(rows):+.1f} pts", "per year"), ("Best year", f"{best[0]}", f"{best[3]:+.1f} pts")]
    table = {"columns": ["Calendar year", "Fund", "Category median", "Lead", "Result"],
             "rows": [[str(y), _p(f, 2), _p(mm, 2), [f"{e:+.2f} pts", POS if w else NEG], ["Won" if w else "Lost", POS if w else NEG]] for y, f, mm, e, w in rows[::-1]]}
    return _out("cal_win_pct", "Calendar years won", basis, tiles, insights, _signed_bars("Lead over the category median in each calendar year (points)", [str(r[0]) for r in rows], [round(r[3], 2) for r in rows], " pts"), table)


def return_1y_detail(m, d, row) -> dict:
    basis = "Month-end values. The headline figure is the 1 year return in the table; the chart shows how it built up month by month against the category median."
    r12 = _roll(m, d, 12).tail(36)
    mon = pd.DataFrame({"f": m.pct_change(), "m": d}).dropna().tail(12)
    if len(r12) < 12 or len(mon) < 12:
        return _out("ret_1y", "1 year return", basis, [], [], reason="Fewer than 12 months of fund and category data.")
    ahead = int((mon["f"] > mon["m"]).sum())
    r1, c1, pc = _num(row, "ret_1y"), _num(row, "ret_1y_cat"), _num(row, "nw_pct_ret_1y")
    bm, wm = mon["f"].idxmax(), mon["f"].idxmin()
    insights = [f"The fund returned {r1:.2f}% over the last 12 months" + (f", against {c1:.2f}% for the average fund in its category and plan." if c1 is not None else "."),
                f"It beat the category median in {ahead} of the last 12 months.",
                f"Best month: {_ms(bm)} ({_p(mon['f'][bm] * 100)}). Weakest month: {_ms(wm)} ({_p(mon['f'][wm] * 100)}).",
                f"The 12 month return was ahead of the category median at {int((r12['f'] > r12['m']).sum())} of the last {len(r12)} month ends."]
    tiles = [("1 year return", f"{r1:.2f}%" if r1 is not None else "n/a", None), ("Category average", f"{c1:.2f}%" if c1 is not None else "n/a", None),
             ("Rank against peers", f"better than {pc:.0f}%" if pc is not None else "n/a", None), ("Months ahead (last 12)", f"{ahead} of 12", None)]
    table = {"columns": ["Month", "Fund", "Category median", "Lead", "Result"],
             "rows": [[_ms(x), _p(f * 100, 2), _p(mm * 100, 2), [f"{(f - mm) * 100:+.2f} pts", POS if f > mm else NEG], ["Ahead" if f > mm else "Behind", POS if f > mm else NEG]]
                      for x, f, mm in zip(mon.index[::-1], mon["f"][::-1], mon["m"][::-1])]}
    return _out("ret_1y", "1 year return", basis, tiles, insights,
                _lines("Rolling 12 month return, fund and category median (last 3 years)", [_ms(x) for x in r12.index], [round(v * 100, 2) for v in r12["f"]], [round(v * 100, 2) for v in r12["m"]]), table)


def cagr_3y_detail(m, d, row) -> dict:
    basis = "Yearly return that would turn the starting value into today's value over 3 years, from month-end values. The chart shows growth of 100 over the 3 years."
    if len(m) < 37:
        return _out("cagr_3y", "3 year yearly return", basis, [], [], reason="Fewer than 3 years of month-end values.")
    seg = m.iloc[-37:]
    dd = d.reindex(seg.index[1:])
    if dd.isna().any():
        return _out("cagr_3y", "3 year yearly return", basis, [], [], reason="Category median is missing for part of the 3 years.")
    growth = seg / seg.iloc[0] * 100
    mg = pd.concat([pd.Series([100.0], index=[seg.index[0]]), (1 + dd).cumprod() * 100])
    c3, cc, pc = _num(row, "cagr_3y"), _num(row, "cagr_3y_cat"), _num(row, "nw_pct_cagr_3y")
    segs = []
    for a, b in ((0, 12), (12, 24), (24, 36)):
        f = seg.iloc[b] / seg.iloc[a] - 1
        mm = float((1 + dd.iloc[a:b]).prod() - 1)
        segs.append((f"Year {a // 12 + 1}: {_ms(seg.index[a])} to {_ms(seg.index[b])}", f * 100, mm * 100))
    ahead = sum(1 for s_ in segs if s_[1] > s_[2])
    insights = [f"The fund grew {c3:.2f}% a year over 3 years" + (f", against {cc:.2f}% for the average fund in its category and plan." if cc is not None else "."),
                f"100,000 rupees invested 3 years ago would be about {100000 * (1 + (c3 or 0) / 100) ** 3:,.0f} rupees today.",
                f"It beat the category median in {ahead} of the 3 individual years.",
                f"Growth of 100 over 3 years: fund {growth.iloc[-1]:.1f}, category median {mg.iloc[-1]:.1f}."]
    tiles = [("3 year yearly return", f"{c3:.2f}%" if c3 is not None else "n/a", None), ("Category average", f"{cc:.2f}%" if cc is not None else "n/a", None),
             ("Rank against peers", f"better than {pc:.0f}%" if pc is not None else "n/a", None), ("Years ahead", f"{ahead} of 3", None)]
    table = {"columns": ["Year", "Fund", "Category median", "Lead", "Result"],
             "rows": [[n, _p(f, 2), _p(mm, 2), [f"{f - mm:+.2f} pts", POS if f > mm else NEG], ["Ahead" if f > mm else "Behind", POS if f > mm else NEG]] for n, f, mm in segs]}
    return _out("cagr_3y", "3 year yearly return", basis, tiles, insights,
                _lines("Growth of 100 over the last 3 years", [_ms(x) for x in seg.index], [round(v, 2) for v in growth], [round(v, 2) for v in mg], ""), table)


def acceleration_detail(m, d, row) -> dict:
    basis = "Acceleration is the 3 year yearly return minus the 5 year yearly return. Above zero means the recent years have been better than the longer record. The chart shows the rolling 3 year yearly return over time."
    c3, c5 = _num(row, "cagr_3y"), _num(row, "cagr_5y")
    if c3 is None or c5 is None:
        return _out("accel_3y_5y", "3 year minus 5 year yearly return", basis, [], [], reason="Needs 5 years of history. Without it this part is dropped and its points are spread over the other parts.")
    r3 = _roll(m, d, 36)
    r3 = (r3.clip(lower=-0.99) + 1) ** (1 / 3) - 1
    r3 = r3.tail(60)
    diff = c3 - c5
    insights = [f"3 year yearly return {c3:.2f}% minus 5 year yearly return {c5:.2f}% = {diff:+.2f} points." + (" Recent years are better than the longer record." if diff > 0 else " Recent years are weaker than the longer record.")]
    if len(r3) >= 25:
        now, y1, y2 = r3["f"].iloc[-1], r3["f"].iloc[-13], r3["f"].iloc[-25]
        insights.append(f"Rolling 3 year yearly return: {now * 100:.1f}% now, {y1 * 100:.1f}% a year ago, {y2 * 100:.1f}% two years ago, so the trend is {'rising' if now > y1 > y2 else 'falling' if now < y1 < y2 else 'mixed'}.")
        insights.append(f"Against the category median ({r3['m'].iloc[-1] * 100:.1f}% now) the fund is {'ahead' if now > r3['m'].iloc[-1] else 'behind'}.")
    pc = _num(row, "nw_pct_accel_3y_5y")
    tiles = [("3 year yearly return", f"{c3:.2f}%", None), ("5 year yearly return", f"{c5:.2f}%", None), ("Difference", f"{diff:+.2f} pts", "Rising" if diff > 0 else "Slowing"),
             ("Rank against peers", f"better than {pc:.0f}%" if pc is not None else "n/a", None)]
    pts = r3.iloc[::-6]
    table = {"columns": ["Month end", "Fund 3 year yearly return", "Category median", "Lead"],
             "rows": [[_ms(x), _p(f * 100, 2), _p(mm * 100, 2), [f"{(f - mm) * 100:+.2f} pts", POS if f > mm else NEG]] for x, f, mm in zip(pts.index, pts["f"], pts["m"])]}
    return _out("accel_3y_5y", "3 year minus 5 year yearly return", basis, tiles, insights,
                _lines("Rolling 3 year yearly return, fund and category median (last 5 years)", [_ms(x) for x in r3.index], [round(v * 100, 2) for v in r3["f"]], [round(v * 100, 2) for v in r3["m"]]), table)


def alpha_detail(m, d, row) -> dict:
    basis = "Alpha is the extra return after adjusting for how much the fund moved with its category (beta). The chart shows each month's return minus the category median over 3 years."
    b = pd.DataFrame({"f": m.pct_change(), "m": d}).dropna().tail(36)
    if len(b) < 24:
        return _out("alpha_3y", "3 year alpha", basis, [], [], reason="Fewer than 24 months of fund and category data.")
    e = (b["f"] - b["m"]) * 100
    a, beta, pc = _num(row, "alpha_3y"), _num(row, "beta_3y"), _num(row, "nw_pct_alpha_3y")
    ahead = int((e > 0).sum())
    insights = [f"3 year alpha is {a:+.2f}% a year." if a is not None else "3 year alpha is not available.",
                f"The fund beat the category median in {ahead} of the last {len(e)} months, with an average monthly lead of {e.mean():+.2f} points ({e.mean() * 12:+.1f} points over a year).",
                f"Best month: {_ms(e.idxmax())} ({e.max():+.2f} points). Weakest month: {_ms(e.idxmin())} ({e.min():+.2f} points)."]
    if beta is not None:
        insights.append(f"Beta is {beta:.2f}: the fund moved {'less' if beta < 1 else 'more'} than the category median, so alpha can differ from the simple average lead.")
    tiles = [("3 year alpha", f"{a:+.2f}%" if a is not None else "n/a", None), ("Beta", f"{beta:.2f}" if beta is not None else "n/a", "1.0 moves with category"),
             ("Months ahead", f"{ahead} of {len(e)}", None), ("Rank against peers", f"better than {pc:.0f}%" if pc is not None else "n/a", None)]
    srt = e.sort_values()
    pick = pd.concat([srt.tail(5)[::-1], srt.head(5)])
    table = {"columns": ["Month", "Fund", "Category median", "Lead"],
             "rows": [[("Best: " if x in srt.tail(5).index else "Weakest: ") + _ms(x), _p(b["f"][x] * 100, 2), _p(b["m"][x] * 100, 2), [f"{v:+.2f} pts", POS if v > 0 else NEG]] for x, v in pick.items()]}
    return _out("alpha_3y", "3 year alpha", basis, tiles, insights, _signed_bars("Monthly lead over the category median (points)", [_ms(x) for x in e.index], [round(float(v), 2) for v in e], " pts"), table)


def sortino_detail(m, d, row) -> dict:
    basis = "The Sortino ratio is the return earned for each unit of downside risk. Only months that lost money count as risk. The chart shows monthly returns over 3 years."
    r = (m.pct_change().dropna().tail(36)) * 100
    if len(r) < 24:
        return _out("sortino_3y", "3 year Sortino ratio", basis, [], [], reason="Fewer than 24 months of month-end values.")
    s, dd, pc = _num(row, "sortino_3y"), _num(row, "downside_dev_3y"), _num(row, "nw_pct_sortino_3y")
    bad = r[r < 0]
    insights = [f"Sortino ratio {s:.2f}: " + ("above 1 is good, so the return was well paid for the downside risk." if s and s > 1 else "below 1, so the return was not strongly paid for the downside risk.") if s is not None else "Sortino ratio is not available.",
                f"{len(bad)} of the last {len(r)} months lost money; the average losing month was {bad.mean():.2f}%." if len(bad) else f"None of the last {len(r)} months lost money.",
                f"Worst month: {_ms(r.idxmin())} ({r.min():+.2f}%). Best month: {_ms(r.idxmax())} ({r.max():+.2f}%).",
                f"Average month: {r.mean():+.2f}% (about {r.mean() * 12:+.1f}% over a year, before compounding)."]
    tiles = [("3 year Sortino ratio", f"{s:.2f}" if s is not None else "n/a", None), ("Downside deviation", f"{dd:.2f}%" if dd is not None else "n/a", "yearly, bad months only"),
             ("Losing months", f"{len(bad)} of {len(r)}", None), ("Rank against peers", f"better than {pc:.0f}%" if pc is not None else "n/a", None)]
    worst = r.sort_values().head(6)
    table = {"columns": ["Worst months", "Fund return"], "rows": [[_ms(x), [f"{v:+.2f}%", NEG]] for x, v in worst.items()]}
    return _out("sortino_3y", "3 year Sortino ratio", basis, tiles, insights, _signed_bars("Monthly return of the fund (%)", [_ms(x) for x in r.index], [round(float(v), 2) for v in r]), table)


def drawdown_detail(m, d, row) -> dict:
    basis = "Maximum drawdown is the biggest fall from a peak to a later low over 3 years. Closer to zero is better. The chart shows how far below its last peak the fund and the category median stood each month."
    w = m.iloc[-37:]
    dm = d.reindex(w.index[1:])
    if len(w) < 25 or dm.isna().any():
        return _out("max_dd_3y", "3 year worst fall", basis, [], [], reason="Fewer than 24 months of fund and category data.")
    dd = (w / w.cummax() - 1) * 100
    mc = pd.concat([pd.Series([1.0], index=[w.index[0]]), (1 + dm).cumprod()])
    mdd = (mc / mc.cummax() - 1) * 100
    tro = dd.idxmin()
    peak = w[:tro].idxmax()
    after = w[tro:]
    rec = after[after >= w[peak]]
    mx, pc = _num(row, "max_dd_3y"), _num(row, "nw_pct_max_dd_3y")
    insights = [f"Worst fall in 3 years: {dd.min():.1f}%, from the peak in {_ms(peak)} to the low in {_ms(tro)} ({max(1, (tro.year - peak.year) * 12 + tro.month - peak.month)} months).",
                (f"It recovered to the old peak by {_ms(rec.index[0])}." if len(rec) else "It has not yet recovered to the old peak."),
                f"The category median's worst fall over the same period was {mdd.min():.1f}%, so the fund fell {'less' if dd.min() > mdd.min() else 'more'}.",
                f"Today the fund is {abs(dd.iloc[-1]):.1f}% below its 3 year peak." if dd.iloc[-1] < -0.05 else "Today the fund is at its 3 year peak."]
    tiles = [("3 year worst fall", f"{mx:.2f}%" if mx is not None else f"{dd.min():.2f}%", None), ("Category median worst fall", f"{mdd.min():.2f}%", None),
             ("Peak to low", f"{_ms(peak)} to {_ms(tro)}", None), ("Recovered", _ms(rec.index[0]) if len(rec) else "Not yet", None)]
    top = dd.sort_values().head(6)
    table = {"columns": ["Deepest month ends", "Below the peak", "Category median"], "rows": [[_ms(x), [f"{v:.2f}%", NEG], f"{mdd[x]:.2f}%"] for x, v in top.items()]}
    return _out("max_dd_3y", "3 year worst fall", basis, tiles, insights,
                _lines("Distance below the latest peak (%)", [_ms(x) for x in dd.index], [round(float(v), 2) for v in dd], [round(float(v), 2) for v in mdd]), table)


def cost_detail(m, d, row) -> dict:
    basis = "The expense ratio is the yearly fee taken from the fund's assets. The table assumes 12% a year before fees, an assumption for illustration only."
    ter, gap, pc = _num(row, "ter"), _num(row, "ter_gap_pp"), _num(row, "nw_pct_ter")
    if ter is None:
        return _out("ter", "Expense ratio", basis, [], [], reason="Expense ratio is not available for this fund.")
    med = ter - gap if gap is not None else None
    fv = lambda t, y: 100000 * (1 + (12 - t) / 100) ** y  # noqa: E731
    insights = [f"The fund charges {ter:.2f}% a year, about {ter * 1000:,.0f} rupees a year on 1,00,000 rupees invested."]
    if med is not None:
        insights.append(f"The median fund in its category and plan charges {med:.2f}%, so this fund is {abs(gap):.2f} points {'cheaper' if gap < 0 else 'costlier'}.")
        insights.append(f"Over 10 years at the same 12% before fees, that gap is worth about {abs(fv(ter, 10) - fv(med, 10)):,.0f} rupees on 1,00,000 rupees, in favour of the {'fund' if gap < 0 else 'median fund'}.")
    insights.append("Regular plans pay a distributor commission that Direct plans do not, which is why the same scheme costs more in the Regular plan.")
    tiles = [("Expense ratio", f"{ter:.2f}%", None), ("Category and plan median", f"{med:.2f}%" if med is not None else "n/a", None),
             ("Gap to median", f"{gap:+.2f} pts" if gap is not None else "n/a", "negative is cheaper"), ("Rank against peers", f"cheaper than {pc:.0f}%" if pc is not None else "n/a", None)]
    rows = []
    for y in (1, 3, 5, 10):
        a = fv(ter, y)
        rows.append([f"{y} year{'s' if y > 1 else ''}", f"{a:,.0f}"] + ([f"{fv(med, y):,.0f}", [f"{a - fv(med, y):+,.0f}", POS if a >= fv(med, y) else NEG]] if med is not None else ["n/a", "n/a"]))
    return _out("ter", "Expense ratio", basis, tiles, insights, None,
                {"columns": ["After", "1,00,000 rupees at this fund's fee", "At the median fee", "Difference"], "rows": rows})


def _periods(row):
    """(label, quartile or None) from oldest to latest calendar period."""
    return [("Two years ago", _num(row, "cal_q_py2")), ("Last calendar year", _num(row, "cal_q_py1")), ("This year so far", _num(row, "cal_q_ytd"))]


def quartile_level_detail(m, d, row) -> dict:
    from app.backoffice.fh_next_wave import QUARTILE_PERIOD_WEIGHTS, QUARTILE_POINTS

    basis = "Each calendar period gives points by the quartile the fund finished in within its category and plan (Q1 is the top quarter): Q2 = 1.0, Q3 = 0.9, Q1 = 0.75, Q4 = 0.2. Q2 and Q3 score highest because those funds can still climb. Periods are weighted 37.5%, 37.5% and 25%."
    ps = [(lab, q, w) for (lab, q), w in zip(_periods(row), (QUARTILE_PERIOD_WEIGHTS["cal_q_py2"], QUARTILE_PERIOD_WEIGHTS["cal_q_py1"], QUARTILE_PERIOD_WEIGHTS["cal_q_ytd"])) if q is not None]
    if not ps:
        return _out("q_level", "Quartile level", basis, [], [], reason="No calendar year quartile is available for this fund.")
    lv = _num(row, "q_level")
    insights = [f"Quartile level {lv:.2f} of 1 (peer weighting {sum(w for *_, w in ps):.0%} of periods present)." if lv is not None else "Quartile level is not available.",
                "Quartiles: " + ", ".join(f"{lab} Q{int(q)}" for lab, q, _ in ps) + ".",
                "Q2 and Q3 funds score highest because they have room to climb; Q1 funds still score well; Q4 funds score low."]
    tiles = [(lab, f"Q{int(q)}", f"{QUARTILE_POINTS[int(q)]} points") for lab, q, _ in ps] + [("Quartile level", f"{lv:.2f}" if lv is not None else "n/a", "0 to 1")]
    table = {"columns": ["Period", "Quartile", "Points", "Weight"], "rows": [[lab, f"Q{int(q)}", f"{QUARTILE_POINTS[int(q)]}", f"{w:.1%}"] for lab, q, w in ps]}
    return _out("q_level", "Quartile level", basis, tiles[:4], insights, None, table)


def quartile_trend_detail(m, d, row) -> dict:
    basis = "Trend is how many quartiles the fund moved up between its oldest and latest period: Q4 to Q1 = 1, no move = 0.5, Q1 to Q4 = 0. It needs at least two periods. A fund already in Q1 cannot move up, so it sits at 0.5 here and earns its credit in the level."
    ps = [(lab, q) for lab, q in _periods(row) if q is not None]
    tr = _num(row, "q_trend")
    if tr is None:
        return _out("q_trend", "Quartile trend", basis, [], [], reason="Needs quartiles for at least two calendar periods.")
    moved = int(round((tr - 0.5) * 6))
    word = f"climbed {moved} quartile{'s' if moved != 1 else ''}" if moved > 0 else f"slipped {-moved} quartile{'s' if moved != -1 else ''}" if moved < 0 else "stayed in the same quartile"
    insights = [f"From {ps[0][0].lower()} (Q{int(ps[0][1])}) to {ps[-1][0].lower()} (Q{int(ps[-1][1])}) the fund {word}.", f"Trend score {tr:.2f} of 1."]
    tiles = [(lab, f"Q{int(q)}", None) for lab, q in ps] + [("Trend score", f"{tr:.2f}", "0.5 = no move")]
    table = {"columns": ["Period", "Quartile"], "rows": [[lab, f"Q{int(q)}"] for lab, q in ps]}
    return _out("q_trend", "Quartile trend", basis, tiles[:4], insights, None, table)


def aum_detail(m, d, row) -> dict:
    from app.backoffice.fh_next_wave import AUM_BANDS, AUM_DEFAULT

    lo, hi = AUM_BANDS.get(str(row.get("cat")), AUM_DEFAULT)
    basis = f"Fund size should be considerable, not too small and not too large for the category. For this category the sweet spot is Rs {lo:,} to {hi:,} crore. Inside it the score is 1; smaller funds fade linearly, larger ones lose 0.4 for every doubling (floor 0.2)."
    a, fit = _num(row, "aum_cr"), _num(row, "aum_fit")
    if a is None or fit is None:
        return _out("aum_fit", "Fund size fit", basis, [], [], reason="Fund size (AUM) is not available for this fund, so this part is dropped.")
    where = "inside" if lo <= a <= hi else "below" if a < lo else "above"
    insights = [f"The fund manages Rs {a:,.0f} crore, {where} the sweet spot of Rs {lo:,} to {hi:,} crore for its category.",
                {"inside": "Full score.", "below": "Small funds can be volatile in flows and carry higher costs, so the score is reduced.", "above": "Large funds find it harder to add value in this category, so the score is reduced."}[where]]
    tiles = [("Fund size", f"Rs {a:,.0f} crore", None), ("Sweet spot", f"{lo:,} to {hi:,} crore", None), ("Size fit", f"{fit:.2f}", "0.2 to 1")]
    return _out("aum_fit", "Fund size fit", basis, tiles, insights, None, None)


BUILDERS = {"roll_win_pct": rolling_detail, "cal_win_pct": calendar_detail, "ret_1y": return_1y_detail, "cagr_3y": cagr_3y_detail, "accel_3y_5y": acceleration_detail,
            "alpha_3y": alpha_detail, "sortino_3y": sortino_detail, "max_dd_3y": drawdown_detail, "ter": cost_detail,
            "q_level": quartile_level_detail, "q_trend": quartile_trend_detail, "aum_fit": aum_detail}


@lru_cache(maxsize=64)
def _category_median(cat: str, stamp: str) -> pd.Series:
    """Median monthly return of the Regular Growth funds in a category, exactly as the nightly screening job builds it."""
    from app.backoffice.screening.jobs import with_live_tail  # lazy: keeps this module's import light
    from app.data.loader import eligible_funds, load_nav

    peers = eligible_funds()
    peers = peers[peers["cat"] == cat]
    last = dict(zip(peers["scheme_code"].astype(str), peers["last_nav_date"]))
    today = pd.Timestamp.now().normalize()
    cols = {}
    for c in peers["scheme_code"].astype(str):
        try:
            s = with_live_tail(load_nav(c), last.get(c), today)
        except (OSError, ValueError, KeyError):
            continue
        if len(s) >= 2:
            cols[c] = s.pct_change()
    return pd.concat(cols, axis=1).median(axis=1).dropna() if len(cols) >= 3 else pd.Series(dtype=float)


def nightly_basis(code: str, cat: str) -> tuple[pd.Series, pd.Series]:
    """The fund's month-end NAV and its category median return on the same basis as the precomputed consistency metrics."""
    from app.backoffice.screening.jobs import with_live_tail
    from app.data.loader import eligible_funds, load_metrics, load_nav

    m = load_metrics()
    last = dict(zip(m["scheme_code"].astype(str), m["last_nav_date"])).get(code)
    fund = with_live_tail(load_nav(code), last, pd.Timestamp.now().normalize())
    return fund, _category_median(cat, str(eligible_funds()["last_nav_date"].max()))


_NEEDS_NIGHTLY = {"roll_win_pct": "rolling windows", "cal_win_pct": "calendar years"}


def history(inp: str, row, monthly: pd.Series, median_monthly_returns: pd.Series) -> dict | None:
    """History behind one Next Wave input, or None for an unknown input."""
    fn = BUILDERS.get(inp)
    if fn is None:
        return None
    if inp in _NEEDS_NIGHTLY and _num(row, inp) is None:
        # The table has no figure for this fund, so showing one here would disagree with it.
        return _out(inp, inp, "", [], [], reason=f"The nightly refresh has no {_NEEDS_NIGHTLY[inp]} figure for this fund (it covers Regular Growth plans with enough history), so this part is dropped.")
    if inp in ROW_ONLY:
        return fn(None, None, row)
    return fn(monthly.sort_index(), median_monthly_returns.dropna(), row)


def peer_table(frame: pd.DataFrame, code: str, inp: str) -> dict | None:
    """All funds in this fund's category and plan ranked on one Next Wave input, with each peer's Next Wave score and parts."""
    if inp not in PEER_INPUTS or code not in set(frame["code"]):
        return None
    higher, unit = PEER_INPUTS[inp]
    me = frame[frame["code"] == code].iloc[0]
    g = frame[(frame["cat"] == me["cat"]) & (frame["plan"] == me["plan"])].copy()
    g["_v"] = (pd.to_numeric(g["cagr_3y"], errors="coerce") - pd.to_numeric(g["cagr_5y"], errors="coerce")) if inp == "accel_3y_5y" else pd.to_numeric(g[inp], errors="coerce")
    ranked = g[g["_v"].notna()].sort_values("_v", ascending=not higher, kind="stable").copy()
    ranked["_rank"] = range(1, len(ranked) + 1)
    n = len(ranked)
    cell = lambda r, k: None if k not in r or pd.isna(r[k]) else round(float(r[k]), 1)  # noqa: E731
    rows = [{"rank": int(r["_rank"]), "code": r["code"], "name": r["name"], "amc": r.get("amc"), "value": round(float(r["_v"]), 2), "this": r["code"] == code,
             "nw_score": cell(r, "nw_score"), "nw_pass": bool(r.get("nw_pass")), "history_years": cell(r, "history_years"),
             "parts": {p: cell(r, f"nw_pts_{p}") for p in _PARTS}} for _, r in ranked.iterrows()]
    mine = next((r for r in rows if r["this"]), None)
    vals = ranked["_v"]
    return {"input": inp, "unit": unit, "higher_is_better": higher, "category": me.get("cat_label") or me["cat"], "plan": me["plan"], "peers_with_data": n,
            "peers_total": int(len(g)), "this_rank": mine["rank"] if mine else None, "this_value": mine["value"] if mine else None,
            "percentile": round((n - mine["rank"]) / (n - 1) * 100, 1) if mine and n > 1 else None,
            "median": round(float(vals.median()), 2) if n else None, "best": round(float(vals.iloc[0]), 2) if n else None, "worst": round(float(vals.iloc[-1]), 2) if n else None,
            "rows": rows}
