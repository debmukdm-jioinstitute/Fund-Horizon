#!/usr/bin/env python3
"""Build a RAG-ready Indian mutual fund dataset from AMFI NAVAll + mfapi.in.

Scope: Regular-plan Growth-option schemes (Fund Horizon is a regular-plan distributor).
Usage: build_dataset.py OUT_DIR [--limit N] [--workers N] [--include-direct]
"""
import argparse, csv, json, math, os, re, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
import urllib.request

import numpy as np
import pandas as pd

NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"
API = "https://api.mfapi.in/mf/{}"
UA = {"User-Agent": "Mozilla/5.0 (research; fundhorizon-rag)"}


def http_get(url, tries=4, timeout=40):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def parse_master(raw: str):
    rows, category, amc = [], None, None
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("Scheme Code"):
            continue
        if ";" not in line:
            m = re.match(r"^(Open Ended|Close Ended|Interval Fund)\s*Schemes?\s*\((.*)\)\s*$", line, re.I)
            if m:
                category = (m.group(1).strip(), m.group(2).strip())
            else:
                amc = line
            continue
        p = line.split(";")
        if len(p) < 8:
            continue
        code, isin1, isin2, name, plan, option, nav, date = [x.strip() for x in p[:8]]
        rows.append(dict(
            scheme_code=code, isin_growth_or_payout=isin1, isin_reinvest=isin2, scheme_name=name,
            plan_raw=plan, option_raw=option,
            latest_nav=nav, latest_nav_date=date,
            amc=amc, structure=category[0] if category else None, category=category[1] if category else None))
    return pd.DataFrame(rows)


def classify(df):
    pl = df["plan_raw"].str.lower()
    op = df["option_raw"].str.lower()
    df["plan"] = np.where(pl.str.contains("direct"), "Direct", "Regular")
    df["option"] = np.where(op.str.contains("growth"), "Growth",
                    np.where(op.str.contains("idcw|dividend|payout|reinvest|bonus"), "IDCW", "Other"))
    # full display name incl. plan/option, so docs are unambiguous
    df["scheme_name"] = df["scheme_name"] + " - " + df["plan"] + " Plan - " + df["option"]
    return df


def to_series(payload):
    d = pd.DataFrame(payload["data"])
    if d.empty:
        return None
    d["date"] = pd.to_datetime(d["date"], format="%d-%m-%Y", errors="coerce")
    d["nav"] = pd.to_numeric(d["nav"], errors="coerce")
    d = d.dropna().sort_values("date").drop_duplicates("date")
    d = d[d["nav"] > 0]
    return d.set_index("date")["nav"] if len(d) else None


def clean_series(s):
    """Splice out splits/consolidations (single-day jumps at ~integer ratios). Returns (series, adjustments, shocks)."""
    ratio = (s / s.shift(1)).dropna()
    ev = ratio[(ratio < 0.70) | (ratio > 1.43)]
    adj, shocks = [], []
    s = s.copy()
    for dt, r in ev.items():
        factor = None
        # integer-ratio re-basing only for k>=5 (2x-4x ratios are too easily genuine crashes/recoveries)
        best = None
        for k in range(5, 1001):
            for cand, tgt in ((1 / k, r), (float(k), r)):
                err = abs(tgt - cand) / cand
                if best is None or err < best[0]: best = (err, cand)
        if best and best[0] < 0.03:
            factor = best[1]
            if factor >= 1:   # consolidation: NAV jumped up by k -> scale earlier NAVs up
                factor = float(round(factor))
            else:             # split: NAV dropped to 1/k -> scale earlier NAVs down
                factor = 1.0 / round(1 / factor)
        if factor:
            s.loc[s.index < dt] *= factor
            adj.append(f"{dt.strftime('%Y-%m-%d')}: x{factor:.4g}")
        else:
            shocks.append(f"{dt.strftime('%Y-%m-%d')}: {r-1:+.1%}")
    return s, adj, shocks


def nav_at(s, ts):
    """NAV on or before ts."""
    i = s.index.searchsorted(ts, side="right") - 1
    return s.iloc[i] if i >= 0 else np.nan


def trailing(s, years=None, months=None, days=None):
    end = s.index[-1]
    if years: start = end - pd.DateOffset(years=years)
    elif months: start = end - pd.DateOffset(months=months)
    else: start = end - pd.DateOffset(days=days)
    if start < s.index[0]:
        return np.nan
    v0, v1 = nav_at(s, start), s.iloc[-1]
    if not v0 or math.isnan(v0):
        return np.nan
    if years and years > 1:
        return (v1 / v0) ** (1 / years) - 1  # CAGR
    return v1 / v0 - 1


def rolling_stats(s, years):
    """Rolling CAGR stats using monthly sampling."""
    if (s.index[-1] - s.index[0]).days < years * 365 + 60:
        return None
    m = s.resample("ME").last().dropna()
    k = years * 12
    if len(m) <= k:
        return None
    r = (m / m.shift(k)) ** (1 / years) - 1
    r = r.dropna()
    if r.empty:
        return None
    return dict(min=r.min(), median=r.median(), max=r.max(), pct_positive=(r > 0).mean(), n=len(r))


def risk_stats(s, years=3, rf=0.065):
    end = s.index[-1]
    start = end - pd.DateOffset(years=years)
    if start < s.index[0]:
        return {}
    w = s[s.index >= start]
    ret = w.pct_change().dropna()
    if len(ret) < 100:
        return {}
    ann_vol = ret.std() * math.sqrt(252)
    cagr = (w.iloc[-1] / w.iloc[0]) ** (1 / years) - 1
    sharpe = (cagr - rf) / ann_vol if ann_vol else np.nan
    dn = ret[ret < 0].std() * math.sqrt(252)
    sortino = (cagr - rf) / dn if dn and not math.isnan(dn) else np.nan
    dd = (w / w.cummax() - 1).min()
    return dict(vol_3y=ann_vol, sharpe_3y=sharpe, sortino_3y=sortino, max_drawdown_3y=dd)


def risk_window(s, years, rf=0.065):
    """Annualised vol, Sharpe, Sortino over the trailing window; empty when history is shorter than the window."""
    start = s.index[-1] - pd.DateOffset(years=years)
    if start < s.index[0]:
        return {}
    w = s[s.index >= start]
    ret = w.pct_change().dropna()
    if len(ret) < 20:
        return {}
    vol = ret.std() * math.sqrt(252)
    cagr = (w.iloc[-1] / w.iloc[0]) ** (1 / years) - 1
    dn = ret[ret < 0].std() * math.sqrt(252)
    return {f"vol_{years}y": vol, f"sharpe_{years}y": (cagr - rf) / vol if vol else np.nan,
            f"sortino_{years}y": (cagr - rf) / dn if dn and not math.isnan(dn) else np.nan}


def short_moves(s):
    """Day/week change and 52-week NAV range from the daily series."""
    last = s.iloc[-1]
    w = s[s.index >= s.index[-1] - pd.DateOffset(years=1)]
    return dict(
        day_chg=last / s.iloc[-2] - 1 if len(s) > 1 else np.nan,
        week_chg=last / nav_at(s, s.index[-1] - pd.DateOffset(days=7)) - 1,
        hi52=w.max(), hi52_date=w.idxmax().strftime("%Y-%m-%d"),
        lo52=w.min(), lo52_date=w.idxmin().strftime("%Y-%m-%d"),
        cagr_2y=trailing(s, years=2),
    )


def max_dd_all(s):
    return (s / s.cummax() - 1).min()


def calendar_returns(s, n=10):
    out = {}
    last_year = s.index[-1].year
    for y in range(last_year, last_year - n, -1):
        a, b = pd.Timestamp(y - 1, 12, 31), pd.Timestamp(y, 12, 31)
        if a < s.index[0]:
            continue
        v0 = nav_at(s, a)
        v1 = s.iloc[-1] if y == last_year else nav_at(s, b)
        if v0 and not math.isnan(v0) and not math.isnan(v1):
            out[y] = v1 / v0 - 1
    return out


def metrics(s):
    m = dict(
        first_nav_date=s.index[0].strftime("%Y-%m-%d"), last_nav_date=s.index[-1].strftime("%Y-%m-%d"),
        history_years=round((s.index[-1] - s.index[0]).days / 365.25, 2), nav_points=len(s),
        ret_1m=trailing(s, months=1), ret_3m=trailing(s, months=3), ret_6m=trailing(s, months=6),
        ret_1y=trailing(s, years=1), cagr_3y=trailing(s, years=3), cagr_5y=trailing(s, years=5),
        cagr_7y=trailing(s, years=7), cagr_10y=trailing(s, years=10),
        max_drawdown_all=max_dd_all(s),
    )
    yrs = (s.index[-1] - s.index[0]).days / 365.25
    m["cagr_since_inception"] = (s.iloc[-1] / s.iloc[0]) ** (1 / yrs) - 1 if yrs >= 1 else np.nan
    m.update(risk_stats(s))
    m.update(short_moves(s))
    for y in (1, 5, 10):
        m.update(risk_window(s, y))
    for y in (1, 3, 5):
        rs = rolling_stats(s, y)
        for k in ("min", "median", "max", "pct_positive"):
            m[f"roll{y}y_{k}"] = rs[k] if rs else np.nan
    return m


def fetch_one(row, asof):
    code = row["scheme_code"]
    try:
        raw = http_get(API.format(code))
        payload = json.loads(raw)
        s = to_series(payload)
        if s is None or len(s) < 30:
            return code, None, None, "no-data"
        meta = payload.get("meta", {})
        s, adj, shocks = clean_series(s)
        m = metrics(s)
        m["calendar_returns"] = calendar_returns(s)
        stale = (asof - s.index[-1]).days > 7
        if stale:
            keep = {"first_nav_date", "last_nav_date", "history_years", "nav_points", "calendar_returns"}
            for k in list(m):
                if k not in keep: m[k] = np.nan
            m["calendar_returns"] = {}
            dq = "inactive_or_stale"
        elif "segregated" in row["scheme_name"].lower():
            dq = "segregated_portfolio"
        elif shocks:
            dq = "nav_shock"
        elif adj:
            dq = "split_adjusted"
        else:
            dq = "ok"
        if dq == "ok" and m.get("vol_3y") is not None and m.get("vol_3y") < 1e-4:
            dq = "flat_nav"
            for k in ("vol_3y", "sharpe_3y", "sortino_3y", "max_drawdown_3y"): m[k] = np.nan
        m["data_quality"] = dq
        m["extreme_return_flag"] = bool(abs(m.get("ret_1y") or 0) > 1.0) if not stale else False
        m["nav_adjustments"] = "; ".join(adj)
        m["nav_shocks"] = "; ".join(shocks)
        monthly = s.resample("ME").last().dropna()
        daily = s.pct_change().dropna().astype("float32") if dq in ("ok", "split_adjusted") else None
        return code, m, (meta, monthly, daily), None
    except Exception as e:  # noqa
        return code, None, None, f"err:{e}"


def base_key(name):
    """Scheme identity shared by NAV names and AUM names (drops the ' - Direct Plan - Growth' tail)."""
    return re.sub(r"[^a-z0-9]+", "", re.split(r"\s+-\s+", name or "", maxsplit=1)[0].lower())


AUM_API = "https://www.amfiindia.com/api/average-aum-schemewise?strType=Categorywise&fyId={}&periodId={}&MF_ID=0"


def fetch_aum():
    """Latest quarterly average AUM per AMFI scheme code (Rs crore), from AMFI. {} if unavailable."""
    for fy in (1, 2):
        for period in (1, 2, 3, 4):
            try:
                data = json.loads(http_get(AUM_API.format(fy, period), timeout=90)).get("data") or []
            except Exception as e:  # noqa
                print("AUM fetch failed", fy, period, e)
                continue
            out = {}
            for g in data:
                for sc in g.get("schemes", []):
                    v = sc.get("AverageAumForTheMonth") or {}
                    lakh = sum(x for x in v.values() if isinstance(x, (int, float)))
                    if sc.get("AMFI_Code") and lakh:
                        out[str(sc["AMFI_Code"])] = lakh / 100  # Rs lakh -> Rs crore
            if out:
                print("AUM period", fy, period, "schemes", len(out))
                return out
    return {}


def add_benchmark_stats(results, dailies, rf=0.065, min_peers=5):
    """Alpha, beta, Treynor vs the median daily return of the scheme's AMFI category and plan (no index data is used)."""
    groups = {}
    for r in results:
        if r["scheme_code"] in dailies:
            groups.setdefault((r["category"], r["plan"]), []).append(r["scheme_code"])
    by_code = {r["scheme_code"]: r for r in results}
    for codes in groups.values():
        if len(codes) < min_peers:
            continue
        frame = pd.concat({c: dailies[c] for c in codes}, axis=1)
        bench = frame.median(axis=1).where(frame.count(axis=1) >= min_peers).dropna()
        for c in codes:
            ret = dailies[c]
            for y in (1, 3, 5, 10):
                start = ret.index[-1] - pd.DateOffset(years=y)
                if start < ret.index[0]:
                    continue
                w = pd.concat([ret[ret.index > start], bench], axis=1, join="inner").dropna()
                if len(w) < 0.8 * 252 * y:
                    continue
                f, b = w.iloc[:, 0].astype(float), w.iloc[:, 1].astype(float)
                if b.var() == 0:
                    continue
                beta = f.cov(b) / b.var()
                fa = (1 + f).prod() ** (1 / y) - 1
                ba = (1 + b).prod() ** (1 / y) - 1
                row = by_code[c]
                row[f"beta_{y}y"] = beta
                row[f"alpha_{y}y"] = (fa - rf) - beta * (ba - rf)
                row[f"treynor_{y}y"] = (fa - rf) / beta if abs(beta) > 0.05 else np.nan


def pct(x, d=2):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x*100:.{d}f}%"


def num(x, d=2):
    return "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.{d}f}"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:90]


def scheme_md(r, m, meta, asof):
    dq = m["data_quality"]
    notes = {
        "ok": "",
        "split_adjusted": f"> DATA NOTE: NAV history had split/consolidation-type jumps ({m['nav_adjustments']}); earlier NAVs were rescaled so returns are continuous.\n\n",
        "nav_shock": f"> DATA WARNING: unexplained single-day NAV jump(s) in history ({m['nav_shocks']}). These may be genuine credit events or data errors; verify before quoting returns.\n\n",
        "segregated_portfolio": "> DATA NOTE: segregated portfolio (side pocket) units; not comparable with normal schemes. Excluded from rankings.\n\n",
        "flat_nav": "> DATA NOTE: NAV is (almost) constant over the last 3 years, so risk ratios are not meaningful. Excluded from rankings.\n\n",
        "inactive_or_stale": f"> DATA NOTE: no NAV since {m['last_nav_date']}; scheme appears inactive/wound up. Return and risk metrics are not computed and the scheme is excluded from rankings.\n\n",
    }
    banner = notes.get(dq, "")
    if m.get("extreme_return_flag"):
        banner += "> REVIEW FLAG: 1-year return is above +100% or below -100%-equivalent extremes; verify against the AMC factsheet before quoting.\n\n"
    cal = m.get("calendar_returns", {})
    cal_tbl = "\n".join(f"| {y} | {pct(v)} |" for y, v in cal.items()) or "| n/a | n/a |"
    return f"""---
doc_type: mutual_fund_scheme
scheme_code: {r['scheme_code']}
scheme_name: "{r['scheme_name']}"
amc: "{r['amc']}"
category: "{r['category']}"
plan: {r['plan']}
option: {r['option']}
isin_growth: {r['isin_growth_or_payout'] or 'n/a'}
latest_nav: {r['latest_nav']}
latest_nav_date: {m['last_nav_date']}
data_asof: {asof}
data_quality: {m['data_quality']}
---

# {r['scheme_name']}

{banner}**AMC:** {r['amc']} | **Category:** {r['category']} | **Plan/Option:** {r['plan']} {r['option']} | **Scheme code:** {r['scheme_code']}
**Latest NAV:** {r['latest_nav']} on {m['last_nav_date']} | **Launch/first NAV date in data:** {m['first_nav_date']} ({m['history_years']} years of history)

## Returns (computed from NAV; periods over 1 year are annualised CAGR)

| Period | Return |
|---|---|
| 1 month | {pct(m['ret_1m'])} |
| 3 months | {pct(m['ret_3m'])} |
| 6 months | {pct(m['ret_6m'])} |
| 1 year | {pct(m['ret_1y'])} |
| 3 years CAGR | {pct(m['cagr_3y'])} |
| 5 years CAGR | {pct(m['cagr_5y'])} |
| 7 years CAGR | {pct(m['cagr_7y'])} |
| 10 years CAGR | {pct(m['cagr_10y'])} |
| Since inception CAGR | {pct(m['cagr_since_inception'])} |

## Risk (3-year window, risk-free rate assumed 6.5%)

- Annualised volatility: {pct(m.get('vol_3y'))}
- Sharpe ratio: {num(m.get('sharpe_3y'))} | Sortino ratio: {num(m.get('sortino_3y'))}
- Max drawdown (3Y): {pct(m.get('max_drawdown_3y'))} | Max drawdown (full history): {pct(m['max_drawdown_all'])}

## Rolling returns (monthly sampling, CAGR)

| Window | Min | Median | Max | % of periods positive |
|---|---|---|---|---|
| 1 year | {pct(m['roll1y_min'])} | {pct(m['roll1y_median'])} | {pct(m['roll1y_max'])} | {pct(m['roll1y_pct_positive'],0)} |
| 3 years | {pct(m['roll3y_min'])} | {pct(m['roll3y_median'])} | {pct(m['roll3y_max'])} | {pct(m['roll3y_pct_positive'],0)} |
| 5 years | {pct(m['roll5y_min'])} | {pct(m['roll5y_median'])} | {pct(m['roll5y_max'])} | {pct(m['roll5y_pct_positive'],0)} |

## Calendar-year returns

| Year | Return |
|---|---|
{cal_tbl}

> Source: AMFI NAV master + mfapi.in NAV history; metrics computed by script. Past performance may or may not be sustained. Not investment advice.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--include-direct", action="store_true")
    a = ap.parse_args()
    out = a.out
    for d in ("schemes_md", "schemes_json", "nav_monthly", "categories", "amcs"):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    raw = http_get(NAV_URL).decode("utf-8", "ignore")
    open(os.path.join(out, "amfi_navall_raw.txt"), "w").write(raw)
    master = classify(parse_master(raw))
    master.to_csv(os.path.join(out, "all_schemes_master.csv"), index=False)
    print("master rows", len(master), "| categories", master["category"].nunique(), "| AMCs", master["amc"].nunique())

    sel = master[master["option"] == "Growth"]
    if not a.include_direct:
        sel = sel[sel["plan"] == "Regular"]
    if a.limit:
        sel = sel.sample(a.limit, random_state=1) if a.limit < len(sel) else sel
    print("schemes to fetch", len(sel))

    asof_ts = pd.to_datetime(master["latest_nav_date"], format="%d-%b-%Y", errors="coerce").max()
    asof = asof_ts.strftime("%Y-%m-%d")
    print("as-of date", asof)
    results, fails, dailies = [], [], {}
    t0 = time.time()
    with ThreadPoolExecutor(a.workers) as ex:
        futs = {ex.submit(fetch_one, r, asof_ts): r for r in sel.to_dict("records")}
        for i, f in enumerate(as_completed(futs), 1):
            r = futs[f]
            code, m, extra, err = f.result()
            if err:
                fails.append((code, err)); continue
            meta, monthly, daily = extra
            if daily is not None: dailies[code] = daily
            base = f"{code}_{slug(r['scheme_name'])}"
            open(os.path.join(out, "schemes_md", base + ".md"), "w").write(scheme_md(r, m, meta, asof))
            flat = {**r, **{k: v for k, v in m.items() if k != "calendar_returns"}}
            js = {**r, "metrics": {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in m.items() if k != "calendar_returns"},
                  "calendar_returns": m["calendar_returns"], "mfapi_meta": meta}
            json.dump(js, open(os.path.join(out, "schemes_json", base + ".json"), "w"), default=str)
            monthly.rename("nav").to_csv(os.path.join(out, "nav_monthly", f"{code}.csv"), date_format="%Y-%m-%d")
            results.append(flat)
            if i % 250 == 0:
                print(f"{i}/{len(sel)} done, {len(fails)} failed, {time.time()-t0:.0f}s", flush=True)

    add_benchmark_stats(results, dailies)
    aum = fetch_aum()
    # AMFI reports AUM per plan/option; a scheme's AUM is the sum over its siblings (same AMC and base name).
    scheme_aum = {}
    for r in master.to_dict("records"):
        scheme_aum[(r["amc"], base_key(r["scheme_name"]))] = scheme_aum.get((r["amc"], base_key(r["scheme_name"])), 0) + aum.get(r["scheme_code"], 0)
    for r in results:
        r["aum_cr"] = scheme_aum.get((r["amc"], base_key(r["scheme_name"]))) or np.nan
    print("AUM matched", sum(1 for r in results if r["aum_cr"] == r["aum_cr"]), "of", len(results))
    df = pd.DataFrame(results)
    df.to_csv(os.path.join(out, "all_schemes_metrics.csv"), index=False)
    pd.DataFrame(fails, columns=["scheme_code", "reason"]).to_csv(os.path.join(out, "fetch_failures.csv"), index=False)
    print("ok", len(df), "fail", len(fails), f"{time.time()-t0:.0f}s")

    # Category + AMC summaries
    agg_cols = ["ret_1y", "cagr_3y", "cagr_5y", "cagr_10y", "vol_3y", "sharpe_3y", "max_drawdown_3y"]
    okdf = df[df["data_quality"].isin(["ok", "split_adjusted"])]
    cat = okdf.groupby("category")[agg_cols].median().round(4)
    cat.insert(0, "n_schemes", okdf.groupby("category").size())
    cat.to_csv(os.path.join(out, "category_summary.csv"))

    for c, g in okdf.groupby("category"):
        g = g.sort_values("cagr_3y", ascending=False)
        lines = [f"# Category: {c}", f"Schemes (Regular, Growth): {len(g)}  |  data as of {asof}", "",
                 f"Median 1Y: {pct(g['ret_1y'].median())} | 3Y CAGR: {pct(g['cagr_3y'].median())} | 5Y CAGR: {pct(g['cagr_5y'].median())} | 10Y CAGR: {pct(g['cagr_10y'].median())}",
                 f"Median 3Y volatility: {pct(g['vol_3y'].median())} | median Sharpe: {num(g['sharpe_3y'].median())}", "",
                 "## Ranked by 3-year CAGR", "",
                 "| Rank | Code | Scheme | AMC | 1Y | 3Y | 5Y | 10Y | Vol 3Y | Sharpe 3Y | Max DD 3Y |", "|---|---|---|---|---|---|---|---|---|---|---|"]
        for k, (_, r) in enumerate(g.iterrows(), 1):
            lines.append(f"| {k} | {r['scheme_code']} | {r['scheme_name']} | {r['amc']} | {pct(r['ret_1y'])} | {pct(r['cagr_3y'])} | {pct(r['cagr_5y'])} | {pct(r['cagr_10y'])} | {pct(r['vol_3y'])} | {num(r['sharpe_3y'])} | {pct(r['max_drawdown_3y'])} |")
        open(os.path.join(out, "categories", slug(c) + ".md"), "w").write("\n".join(lines))

    for amc, g in okdf.groupby("amc"):
        g = g.sort_values("cagr_3y", ascending=False)
        lines = [f"# AMC: {amc}", f"Schemes (Regular, Growth): {len(g)}  |  data as of {asof}", "",
                 "| Code | Scheme | Category | 1Y | 3Y | 5Y | 10Y |", "|---|---|---|---|---|---|---|"]
        for _, r in g.iterrows():
            lines.append(f"| {r['scheme_code']} | {r['scheme_name']} | {r['category']} | {pct(r['ret_1y'])} | {pct(r['cagr_3y'])} | {pct(r['cagr_5y'])} | {pct(r['cagr_10y'])} |")
        open(os.path.join(out, "amcs", slug(amc) + ".md"), "w").write("\n".join(lines))
    print("done")


if __name__ == "__main__":
    main()
