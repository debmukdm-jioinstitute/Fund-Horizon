"""Backoffice > Operations > Portfolio review: parse uploaded client statements, compute same-instalment market comparisons
and live Fund Horizon analysis, render the 16:9 Portfolio Review PDF deck, and save/email it to the client's CRM record."""
from __future__ import annotations

import difflib
import io
import json
import math
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any

import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api.crm_core import Me, _optouts, _visible_customer
from app.backoffice import portfolio_screen
from app.backoffice.valuation import bundle, layouts
from app.backoffice.valuation import ingestion as ing
from app.data.loader import load_metrics, load_nav
from app.db import sqlite
from app.engine import analytics as an
from app.engine import cas
from app.mailer import MailerError, send_email
from app.repo_crm_core import get_crm_repository
from app.report import client_report, statements
from app.report.portfolio_review import STRESS_WINDOWS, build_portfolio_review, summarize_review, window_fall

router = APIRouter(prefix="/api/backoffice/portfolio-review", tags=["portfolio-review"])
MAX_FILES, MAX_BYTES = 10, 15 * 1024 * 1024
_SCHEMA = """CREATE TABLE IF NOT EXISTS portfolio_reviews (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, report_date TEXT, data TEXT NOT NULL, pdf BLOB NOT NULL,
    emailed_at TEXT, created_at TEXT NOT NULL, created_by TEXT)"""
_LIVE_COLS = ("name", "cat", "cat_label", "nav_date", "cagr_3y", "cap_up_3y", "cap_down_3y", "cap_ratio_3y", "max_dd_3y", "max_dd_all",
              "history_years", "fh_score", "fh_signal", "is_fh_recommended")
_MON = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
FOUR_INDICES: tuple[tuple[str, str, str], ...] = (
    ("n50", "120716", "Nifty 50"),
    ("n500", "147625", "Nifty 500 TRI"),
    ("mid150", "147622", "Nifty Midcap 150 TRI"),
    ("small250", "147623", "Nifty Smallcap 250 TRI"),
)
_CAT_INDEX: dict[str, tuple[str, str, str]] = {
    "large_cap": ("120716", "Nifty 50", "n50"),
    "index_equity": ("120716", "Nifty 50", "n50"),
    "etf_other": ("120716", "Nifty 50", "n50"),
    "mid_cap": ("147622", "Nifty Midcap 150 TRI", "mid150"),
    "small_cap": ("147623", "Nifty Smallcap 250 TRI", "small250"),
    "large_mid_cap": ("152156", "Nifty LargeMidcap 250 TRI", "n500"),
    "multi_cap": ("152751", "Nifty 500 Multicap TRI", "n500"),
    **{c: ("147625", "Nifty 500 TRI", "n500") for c in ("flexi_cap", "elss", "focused", "value", "contra", "dividend_yield", "sectoral_thematic")},
}


def _infer_benchmark(cat: str, name: str, typ: str = "") -> tuple[str, str, str] | None:
    """Resolve (proxy_code, official_benchmark_label, four_index_key) from fund name/type first, then canonical category."""
    hay = f"{name} {typ}".lower()
    if any(k in hay for k in ("gold", "silver", "commodity", "liquid", "overnight", "money market", "gilt", "corporate bond", "banking & psu", "banking and psu", "short duration", "arbitrage", "debt")):
        return None
    if re.search(r"\b(small\s*cap|smallcap|micro\s*cap|microcap)\b", hay):
        return ("147623", "Nifty Smallcap 250 TRI", "small250")
    if re.search(r"\b(mid\s*cap|midcap)\b", hay) and not re.search(r"large\s*(&|and)\s*mid", hay):
        return ("147622", "Nifty Midcap 150 TRI", "mid150")
    if re.search(r"\b(large\s*(&|and)\s*mid|largemid)\b", hay):
        return ("152156", "Nifty LargeMidcap 250 TRI", "n500")
    if re.search(r"\b(multi\s*cap|multicap)\b", hay):
        return ("152751", "Nifty 500 Multicap TRI", "n500")
    if re.search(r"\b(large\s*cap|largecap|bluechip|top\s*100|nifty\s*50\b|sensex)\b", hay) and "500" not in hay:
        return ("120716", "Nifty 50", "n50")
    if cat in _CAT_INDEX:
        return _CAT_INDEX[cat]
    return ("147625", "Nifty 500 TRI", "n500")


class Holding(BaseModel):
    code: str = Field(pattern=r"^\d{4,8}$")
    invested: float = Field(ge=0)
    value: float = Field(ge=0)
    name: str = Field(default="", max_length=200)
    typ: str = Field(default="", max_length=60)
    period: str = Field(default="", max_length=40)
    inst: str = Field(default="", max_length=10)
    ret: float | None = None
    flag: str = Field(default="", pattern="^(\u2020|\\*)?$")  # glyphs Google Sans has: dagger (under 1 yr), asterisk (estimated)


class PerFund(BaseModel):
    pct: float | None = None
    inr: float | None = None


class IndexRow(BaseModel):
    name: str = Field(max_length=120)
    index: str = Field(max_length=60)
    period: str = Field(max_length=40)
    ret: float
    idx: float
    lead: float
    inr: float


class MatrixCell(BaseModel):
    idx: float
    lead: float
    val: float = 0
    inr: float = 0


class MatrixRow(BaseModel):
    code: str = Field(default="", max_length=16)
    name: str = Field(max_length=120)
    period: str = Field(default="", max_length=40)
    ret: float
    invested: float = 0
    value: float = 0
    bench_key: str = Field(default="", max_length=20)
    bench_label: str = Field(default="", max_length=60)
    beaten: int = 0
    cells: dict[str, MatrixCell] = Field(default_factory=dict)


class Compare(BaseModel):
    """Optional, computed from instalment-level data (CAS): without it the same-instalment index slides are left out."""
    portfolio_xirr: float | None = None
    nifty50_xirr: float = 0
    nifty500_xirr: float = 0
    mid150_xirr: float = 0
    small250_xirr: float = 0
    ahead_inr_500: float = 0
    ahead_inr_50: float = 0
    ahead_inr_mid150: float = 0
    ahead_inr_small250: float = 0
    funds_ahead_50: int = 0
    indices_beaten: int = 0
    primary_bench_key: str = Field(default="n500", max_length=20)
    primary_bench_label: str = Field(default="Nifty 500 TRI", max_length=60)
    primary_bench_ahead_inr: float = 0
    benchmark_note: str = Field(default="", max_length=240)
    total_invested: float = 0
    total_value: float = 0
    index_totals: dict[str, MatrixCell] = Field(default_factory=dict)
    per_fund: dict[str, PerFund] = Field(default_factory=dict)
    index_rows: list[IndexRow] = Field(default_factory=list, max_length=30)
    matrix_rows: list[MatrixRow] = Field(default_factory=list, max_length=50)


class Client(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    date: str = Field(min_length=1, max_length=20)


class Review(BaseModel):
    client: Client
    holdings: list[Holding] = Field(min_length=1, max_length=200)
    compare: Compare | None = None
    branding: bool = True  # False: PDF has no Fund Horizon logo or footer name


class PushIn(BaseModel):
    customer_id: str
    review: Review
    send_email: bool = False


class AnalyzeHolding(BaseModel):
    code: str = Field(pattern=r"^\d{4,8}$")
    name: str = Field(default="", max_length=200)
    typ: str = Field(default="", max_length=60)
    invested: float = Field(default=0, ge=0)
    value: float = Field(default=0, ge=0)
    from_month: str = Field(default="", max_length=10)
    to_month: str = Field(default="", max_length=10)
    period: str = Field(default="", max_length=40)
    inst: str = Field(default="", max_length=10)
    ret: float | None = None
    flag: str = Field(default="", pattern="^(\u2020|\\*)?$")
    flows: list[tuple[str, float]] = Field(default_factory=list, max_length=1000)


class AnalyzeIn(BaseModel):
    date: str = Field(default="", max_length=30)
    portfolio_xirr: float | None = None
    holdings: list[AnalyzeHolding] = Field(default_factory=list, max_length=200)


def _frame():
    from app.api.backoffice import _fh_frame
    return _fh_frame()


def _nav(code: str):
    try:
        return load_nav(code)
    except (FileNotFoundError, KeyError):
        return None


def _ym_label(ym: str) -> str:
    return f"{_MON[int(ym[5:7]) - 1]}-{ym[2:4]}" if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", ym or "") else ""


def _period_label(from_ym: str, to_ym: str) -> str:
    if not from_ym:
        return ""
    if not to_ym:
        return f"Since {_ym_label(from_ym)}"
    return f"{_ym_label(from_ym)} (one-time)" if from_ym == to_ym else f"{_ym_label(from_ym)} – {_ym_label(to_ym)}"


def live_data(codes: list[str]) -> dict[str, dict]:
    """Per scheme code: screener fields + each fund's own fall in the stress windows. Unknown codes are simply absent."""
    fr = _frame()
    fr = fr[fr["code"].isin(codes)].drop_duplicates("code").set_index("code")
    out: dict[str, dict] = {}
    for code, r in fr.iterrows():
        d = {k: (None if r.get(k) != r.get(k) else r.get(k)) for k in _LIVE_COLS}
        d["name"] = re.sub(r" - (Regular|Direct) Plan.*$", "", str(d["name"] or ""))
        if isinstance(r.get("quality"), str) and r["quality"] != "ok":  # never show metrics the FH data-quality check excluded
            out[code] = {"name": d["name"], "cat": d["cat"], "cat_label": d["cat_label"], "nav_date": d["nav_date"], "reason": "Excluded by the FH data-quality check", "falls": {}}
            continue
        reasons = r.get("fh_signal_reasons")
        d["reason"] = reasons[0] if isinstance(reasons, (list, tuple)) and reasons else ""
        d["recommended"] = bool(d.pop("is_fh_recommended"))
        nav = _nav(code)
        d["falls"] = {k: window_fall(nav, a, b) for k, (a, b, _) in STRESS_WINDOWS.items()}
        out[code] = d
    return out


# ---------- index NAV series & same-instalment comparison ----------

def _back_extend(primary: pd.Series | None, earlier: pd.Series | None) -> pd.Series | None:
    if primary is None or primary.empty:
        return earlier
    if earlier is None or earlier.empty or earlier.index[0] >= primary.index[0]:
        return primary
    first_dt = primary.index[0]
    ref = earlier.asof(first_dt)
    if pd.isna(ref) or not ref:
        return primary
    pre = earlier[earlier.index < first_dt] * (float(primary.iloc[0]) / float(ref))
    return pd.concat([pre, primary]).sort_index()


def _index_series(code: str) -> pd.Series | None:
    """Month-end index-fund NAV series for `code`, back-extended for pre-inception dates so early SIPs are priced accurately."""
    s50 = _back_extend(_nav("120716"), _nav("100822"))
    if code in ("120716", "100822"):
        return s50
    s500 = _back_extend(_nav("147625"), s50)
    if code == "147625":
        return s500
    return _back_extend(_nav(code), s500)


def _nav_on(s: pd.Series, d: date) -> float:
    """Exact-date NAV lookup on `s`: interpolates linearly between adjacent NAV observations (or uses exact trading day
    when present), so an investment on Jan 1 uses the start-of-January NAV (= Dec 31 close) rather than Jan 31's month-end NAV."""
    if s is None or s.empty:
        return 1.0
    ts = pd.Timestamp(d)
    if ts <= s.index[0]:
        return float(s.iloc[0])
    if ts >= s.index[-1]:
        return float(s.iloc[-1])
    pos = int(s.index.searchsorted(ts, side="left"))
    if s.index[pos] == ts:
        return float(s.iloc[pos])
    t0, t1 = s.index[pos - 1], s.index[pos]
    v0, v1 = float(s.iloc[pos - 1]), float(s.iloc[pos])
    span = (t1 - t0).days
    if span <= 0:
        return v1
    w = (ts - t0).days / span
    return v0 + w * (v1 - v0)


def _solve_implied_date(code: str, val_d: date, inv: float, val: float) -> date | None:
    """For a holding without explicit transaction dates (e.g. a < 1 year folio-wise row where XIRR == Absolute Return),
    find the most recent date `d` in the scheme's own NAV history where `NAV(val_d) / NAV(d) == val / inv`."""
    if inv <= 0 or val <= 0 or not code:
        return None
    s = _nav(str(code))
    if s is None or len(s) < 2:
        return None
    nav_end = _nav_on(s, val_d)
    target_nav = nav_end * (inv / val)
    ts_val = pd.Timestamp(val_d)
    sub = s[s.index <= ts_val]
    if len(sub) < 2:
        sub = s
    # Search backwards from the valuation date over the last 18 months for a crossing of `target_nav`
    pts = list(zip(sub.index, [float(x) for x in sub.values]))
    if pts[-1][0].date() < val_d:
        pts.append((ts_val, nav_end))
    cutoff = ts_val - pd.Timedelta(days=545)
    best_d: date | None = None
    best_err = float("inf")
    for k in range(len(pts) - 1, 0, -1):
        t0, v0 = pts[k - 1]
        t1, v1 = pts[k]
        if t1 < cutoff:
            break
        lo, hi = min(v0, v1), max(v0, v1)
        if lo <= target_nav <= hi and abs(v1 - v0) > 1e-9:
            frac = (target_nav - v0) / (v1 - v0)
            cand_ts = t0 + pd.Timedelta(days=round(frac * max((t1 - t0).days, 1)))
            cand_d = min(cand_ts.date(), val_d - timedelta(days=7))
            return cand_d
        for t_pt, v_pt in ((t1, v1), (t0, v0)):
            err = abs(v_pt - target_nav) / max(target_nav, 1e-9)
            if err < best_err and t_pt >= cutoff:
                best_err = err
                best_d = min(t_pt.date(), val_d - timedelta(days=7))
    return best_d if best_err <= 0.08 else None


def _synth_monthly_flows(invested: float, from_ym: str, to_ym: str, inst_str: str, val_d: date) -> list[tuple[date, float]]:
    if invested <= 0 or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", from_ym or ""):
        return []
    sy, sm = int(from_ym[:4]), int(from_ym[5:7])
    n = int(inst_str) if str(inst_str or "").strip().isdigit() and int(inst_str) > 0 else 0
    if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", to_ym or ""):
        ey, em = int(to_ym[:4]), int(to_ym[5:7])
    elif n > 1:
        ey, em = val_d.year, val_d.month
    else:
        ey, em = sy, sm
    months: list[date] = []
    y, m = sy, sm
    while (y, m) <= (ey, em) and len(months) < 480:
        d = min(date(y, m, 1), val_d)
        months.append(d)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    if not months:
        months = [min(date(sy, sm, 1), val_d)]
    if n <= 0:
        n = len(months)
    if n == 1:
        return [(months[0], float(invested))]
    amt = float(invested) / n
    return [(months[min(round(i * (len(months) - 1) / max(n - 1, 1)), len(months) - 1)], amt) for i in range(n)]


def _active_flows(h: dict[str, Any], val_d: date) -> list[tuple[date, float]]:
    """Dated purchase instalments summing to `h['invested']` (FIFO for redemptions; month range or XIRR-derived date fallback)."""
    inv, val = float(h.get("invested") or 0), float(h.get("value") or 0)
    raw_flows = []
    for dt_s, amt in h.get("flows") or []:
        iso = ing.parse_date(dt_s)
        if iso and amt:
            d = min(date.fromisoformat(iso), val_d)
            raw_flows.append((d, float(amt)))
    purchases = sorted([(d, a) for d, a in raw_flows if a > 0], key=lambda x: x[0])
    redemptions = [abs(a) for _, a in raw_flows if a < 0]
    if purchases:
        if inv <= 0:
            inv = round(max(0.0, sum(a for _, a in purchases) - sum(redemptions)), 2) or round(sum(a for _, a in purchases), 2)
            h["invested"] = inv
        if redemptions and inv > 0:
            rem, kept = inv, []
            for d, a in reversed(purchases):
                if rem <= 1e-6:
                    break
                take = min(a, rem)
                kept.append((d, take))
                rem -= take
            kept.reverse()
            s = sum(a for _, a in kept)
            active = [(d, a * inv / s) for d, a in kept] if s > 0 else []
        else:
            s = sum(a for _, a in purchases)
            active = [(d, a * (inv / s if s > 0 and inv > 0 else 1.0)) for d, a in purchases]
        if active:
            f_ym, l_ym = active[0][0].strftime("%Y-%m"), active[-1][0].strftime("%Y-%m")
            h["from"] = h.get("from") or f_ym
            h["to"] = h.get("to") or (f_ym if len(active) == 1 else l_ym)
            h["inst"] = h.get("inst") or str(len(active))
            h["period"] = _period_label(h["from"], h["to"])
            return active
    if h.get("from"):
        active = _synth_monthly_flows(inv, h["from"], h.get("to") or "", str(h.get("inst") or ""), val_d)
        if active:
            h["period"] = h.get("period") or _period_label(h["from"], h.get("to") or "")
            return active
    ret = h.get("ret")
    if ret is not None and inv > 0 and val > 0:
        abs_ret = (val / inv - 1) * 100
        if abs(ret - abs_ret) <= 0.06 and abs(abs_ret) > 0.1:
            h["flag"] = h.get("flag") or "†"
            eff_d = _solve_implied_date(str(h.get("code") or ""), val_d, inv, val) or (val_d - timedelta(days=180))
            h["from"] = h.get("from") or eff_d.strftime("%Y-%m")
            h["to"] = h.get("to") or ""
            h["period"] = h.get("period") or _period_label(h["from"], h["to"])
            return [(eff_d, inv)]
        if 1 + ret / 100 > 0.1 and val / inv > 0 and abs(ret) > 0.05:
            try:
                years = math.log(val / inv) / math.log(1 + ret / 100)
            except (ValueError, ZeroDivisionError):
                years = 0.0
            if 0.15 <= years <= 30:
                eff_d = val_d - timedelta(days=max(30, round(years * 365.25)))
                h["from"] = eff_d.strftime("%Y-%m")
                h["to"] = ""
                h["period"] = h.get("period") or _period_label(h["from"], "")
                h["flag"] = h.get("flag") or ("†" if years < 1.0 else "*")
                return [(eff_d, inv)]
    if inv > 0 and val > 0:
        eff_d = _solve_implied_date(str(h.get("code") or ""), val_d, inv, val)
        if eff_d is not None:
            h["from"] = h.get("from") or eff_d.strftime("%Y-%m")
            h["to"] = h.get("to") or ""
            h["period"] = h.get("period") or _period_label(h["from"], h["to"])
            h["flag"] = h.get("flag") or ("†" if (val_d - eff_d).days < 365 else "*")
            return [(eff_d, inv)]
    return []


def _flow_return(flows: list[tuple[date, float]], terminal_val: float, val_d: date, span_days: int) -> float:
    inv = sum(a for _, a in flows if a > 0)
    if inv <= 0:
        return 0.0
    if span_days >= 365:
        cf = [(d, -a) for d, a in flows if d < val_d] or [(val_d - timedelta(days=365), -inv)]
        cf.append((val_d, float(terminal_val)))
        x = an.xirr(cf)
        if x is not None:
            return round(float(x) * 100, 2)
    return round((terminal_val / inv - 1) * 100, 2)


def compute_compare(holdings: list[dict[str, Any]], val_date_str: str, portfolio_xirr: float | None = None,
                    live: dict[str, dict] | None = None) -> dict[str, Any] | None:
    """Compute same-instalment comparison against all 4 core Nifty indices (Nifty 50, Nifty 500 TRI, Nifty Midcap 150 TRI,
    Nifty Smallcap 250 TRI) and each fund's official SEBI benchmark."""
    iso_v = ing.parse_date(val_date_str)
    val_d = date.fromisoformat(iso_v) if iso_v else date.today()
    four_series: dict[str, pd.Series] = {}
    for ikey, icode, _ilbl in FOUR_INDICES:
        s = _index_series(icode)
        if s is not None and not s.empty:
            four_series[ikey] = s
    if "n500" not in four_series or "n50" not in four_series:
        return None
    live = live if live is not None else live_data([str(h["code"]) for h in holdings if h.get("code")])
    per_fund: dict[str, dict[str, float]] = {}
    index_rows: list[dict[str, Any]] = []
    matrix_rows: list[dict[str, Any]] = []
    all_flows: list[tuple[date, float]] = []
    tot_val = tot_inv = 0.0
    tot_idx_val: dict[str, float] = {k: 0.0 for k in four_series}
    bench_val_by_key: dict[str, float] = {k: 0.0 for k, _, _ in FOUR_INDICES}
    bench_funds_by_key: dict[str, list[str]] = {k: [] for k, _, _ in FOUR_INDICES}
    ahead_50 = 0
    max_span = 0
    end_navs = {k: _nav_on(s, val_d) for k, s in four_series.items()}

    for h in holdings:
        inv, val = float(h.get("invested") or 0), float(h.get("value") or 0)
        active = _active_flows(h, val_d)
        if not active or inv <= 0:
            continue
        span = max((val_d - active[0][0]).days, 1)
        max_span = max(max_span, span)
        if span < 365 and not h.get("flag"):
            h["flag"] = "†"
        f_ret = float(h["ret"]) if h.get("ret") is not None else _flow_return(active, val, val_d, span)
        h["ret"] = round(f_ret, 2)
        code = str(h["code"])
        lv = live.get(code) or {}
        fname_base = str(h.get("name") or lv.get("name") or code)
        fname = fname_base + (f" {h['flag']}" if h.get("flag") else "")

        cells: dict[str, dict[str, float]] = {}
        beaten_cnt = 0
        for ikey, _icode, _ilbl in FOUR_INDICES:
            s_idx = four_series.get(ikey)
            if s_idx is None:
                continue
            v_idx = sum(a * (end_navs[ikey] / _nav_on(s_idx, d)) for d, a in active)
            r_idx = _flow_return(active, v_idx, val_d, span)
            lead = round(f_ret - r_idx, 2)
            inr_diff = float(round(val - v_idx))
            if f_ret > r_idx:
                beaten_cnt += 1
            cells[ikey] = {"idx": round(r_idx, 2), "lead": lead, "val": float(round(v_idx)), "inr": inr_diff}
            tot_idx_val[ikey] = tot_idx_val.get(ikey, 0.0) + v_idx

        c500 = cells["n500"]
        c50 = cells["n50"]
        per_fund[code] = {"pct": round(c500["lead"], 1), "inr": c500["inr"]}
        if f_ret > c50["idx"]:
            ahead_50 += 1

        cat = str(lv.get("cat") or "")
        bm = _infer_benchmark(cat, fname_base, str(h.get("typ") or lv.get("cat_label") or ""))
        b_key, b_label = "", ""
        if bm is not None:
            p_code, idx_label, b_key = bm
            b_label = idx_label
            bench_val_by_key[b_key] = bench_val_by_key.get(b_key, 0.0) + val
            bench_funds_by_key.setdefault(b_key, []).append(fname_base)
            s_cat = _index_series(p_code)
            if s_cat is not None and not s_cat.empty:
                v_cat = sum(a * (_nav_on(s_cat, val_d) / _nav_on(s_cat, d)) for d, a in active)
                r_cat = _flow_return(active, v_cat, val_d, span)
                index_rows.append({
                    "_val": val, "name": fname[:120], "index": idx_label[:60], "period": (h.get("period") or "")[:40],
                    "ret": round(f_ret, 2), "idx": round(r_cat, 2), "lead": round(f_ret - r_cat, 1), "inr": float(round(val - v_cat)),
                })

        matrix_rows.append({
            "_val": val, "code": code, "name": fname[:120], "period": (h.get("period") or "")[:40], "ret": round(f_ret, 2),
            "invested": round(inv, 2), "value": round(val, 2),
            "bench_key": b_key, "bench_label": b_label, "beaten": beaten_cnt, "cells": cells,
        })
        all_flows.extend(active)
        tot_inv += inv
        tot_val += val

    if not per_fund or tot_inv <= 0:
        return None
    p_xirr = _flow_return(all_flows, tot_val, val_d, max_span)
    if portfolio_xirr is not None:
        p_xirr = round(float(portfolio_xirr), 2)

    index_totals: dict[str, dict[str, float]] = {}
    indices_beaten = 0
    for ikey, _icode, _ilbl in FOUR_INDICES:
        if ikey not in tot_idx_val:
            continue
        tv = tot_idx_val[ikey]
        tx = _flow_return(all_flows, tv, val_d, max_span)
        lead = round(p_xirr - tx, 2)
        if p_xirr > tx:
            indices_beaten += 1
        index_totals[ikey] = {"idx": round(tx, 2), "lead": lead, "val": float(round(tv)), "inr": float(round(tot_val - tv))}

    # Primary portfolio benchmark: the 4-index column carrying the highest matched portfolio value (default n500)
    primary_key = max(bench_val_by_key.items(), key=lambda kv: (kv[1], kv[0] == "n500"))[0] if any(bench_val_by_key.values()) else "n500"
    key_to_label = {k: lbl for k, _, lbl in FOUR_INDICES}
    primary_label = key_to_label.get(primary_key, "Nifty 500 TRI")
    primary_ahead_inr = index_totals.get(primary_key, index_totals["n500"])["inr"]
    b_funds = bench_funds_by_key.get(primary_key) or []
    bench_note = (
        f"* Official benchmark of {', '.join(b_funds[:4])}" + (f" and {len(b_funds) - 4} more." if len(b_funds) > 4 else ".")
        if b_funds else f"* {primary_label} is the primary benchmark for this portfolio."
    )

    index_rows.sort(key=lambda r: -r.pop("_val", 0))
    for mr in matrix_rows:
        mr.pop("_val", None)
    return Compare(
        portfolio_xirr=p_xirr,
        nifty50_xirr=index_totals["n50"]["idx"],
        nifty500_xirr=index_totals["n500"]["idx"],
        mid150_xirr=index_totals.get("mid150", {}).get("idx", 0.0),
        small250_xirr=index_totals.get("small250", {}).get("idx", 0.0),
        ahead_inr_500=index_totals["n500"]["inr"],
        ahead_inr_50=index_totals["n50"]["inr"],
        ahead_inr_mid150=index_totals.get("mid150", {}).get("inr", 0.0),
        ahead_inr_small250=index_totals.get("small250", {}).get("inr", 0.0),
        funds_ahead_50=ahead_50,
        indices_beaten=indices_beaten,
        primary_bench_key=primary_key,
        primary_bench_label=primary_label,
        primary_bench_ahead_inr=primary_ahead_inr,
        benchmark_note=bench_note[:240],
        total_invested=round(tot_inv, 2),
        total_value=round(tot_val, 2),
        index_totals=index_totals,
        per_fund=per_fund,
        index_rows=index_rows[:25],
        matrix_rows=matrix_rows[:50],
    ).model_dump()


# ---------- scheme matching ----------

_AMC_ALIASES = (
    (r"\bppfas\b", "parag parikh"), (r"\babsl\b", "aditya birla sun life"),
    (r"\baditya\s+birla\b(?!\s+sun)", "aditya birla sun life"), (r"\bwoc\b|\bwhite\s*oak\b", "whiteoak capital"),
    (r"\bmosl\b", "motilal oswal"), (r"\bsbi\s+magnum\b", "sbi"),
    (r"\bcanara\s+rob\b(?!\s*eco)", "canara robeco"),
    (r"\bnatural\s+res\b(?!\s*ources)", "natural resources"),
)
_AMFI_PREFIX = re.compile(
    r"^(axis|bandhan|baroda|bajaj|canara|dsp|edelweiss|franklin|groww|hdfc|helios|hsbc|icici|invesco|iti|jm|jio|"
    r"kotak|lic|mahindra|mirae|motilal|navi|nippon|parag|pgim|ppfas|quant|quantum|samco|sbi|shriram|sundaram|tata|"
    r"taurus|trust|trustmf|union|uti|whiteoak|woc|zerodha|360|aditya)\b"
)


def _norm_scheme(text: str) -> str:
    t = portfolio_screen.normalize_scheme_text(text)
    for rx, rep in _AMC_ALIASES:
        t = re.sub(rx, rep, t)
    return " ".join(t.split())


def _lookup_casparser_isin_by_name(raw_name: str, det_plan: str) -> dict[str, Any] | None:
    """Query `casparser_isin` SQLite catalog for renamed or unlisted AMFI schemes (e.g. HSBC Small Cap Fund)."""
    raw_low = raw_name.lower()
    words = [w for w in re.findall(r"[a-z0-9]+", raw_low) if w not in ("mutual", "fund", "plan", "option", "growth", "regular", "direct", "reg", "dir", "idcw", "dividend", "payout", "reinvestment", "the", "and", "of") and len(w) >= 2]
    if len(words) < 2:
        return None
    try:
        from casparser_isin import MFISINDb

        where = [" AND ".join(f"LOWER(name) LIKE :w{i}" for i in range(min(len(words), 4)))]
        args: dict[str, Any] = {f"w{i}": f"%{words[i]}%" for i in range(min(len(words), 4))}
        if det_plan == "Direct":
            where.append("LOWER(name) LIKE '%direct%'")
        else:
            where.append("LOWER(name) NOT LIKE '%direct%'")
        where.append("LOWER(name) LIKE '%growth%'")
        sql = f"SELECT name, isin, amfi_code, type FROM scheme WHERE {' AND '.join(where)} ORDER BY id DESC LIMIT 10"
        with MFISINDb() as db:
            rows = db.run_query(sql, args)
        for r in rows or []:
            ac = str(r.get("amfi_code") or "").strip()
            if re.fullmatch(r"\d{4,8}", ac):
                return r
    except Exception:
        pass
    return None


_LOOKUPS_CACHE: tuple[int, tuple] | None = None


def _build_lookups(frame: pd.DataFrame):
    global _LOOKUPS_CACHE
    if _LOOKUPS_CACHE is not None and _LOOKUPS_CACHE[0] == id(frame):
        return _LOOKUPS_CACHE[1]
    code_map: dict[str, dict[str, Any]] = {}
    isin_map: dict[str, dict[str, Any]] = {}
    pools: dict[str, list[tuple[str, str, set[str], dict[str, Any]]]] = {"Direct": [], "Regular": [], "All": []}
    for row in frame.to_dict("records"):
        c = str(row.get("code") or "").strip()
        if not c:
            continue
        row["_from_frame"] = True
        code_map[c] = row
        isin = portfolio_screen.clean_isin(row.get("isin"))
        if isin and isin not in isin_map:
            isin_map[isin] = row
        norm = _norm_scheme(str(row.get("name") or ""))
        entry = (c, norm, set(norm.split()), row)
        plan = str(row.get("plan") or "")
        if plan in pools:
            pools[plan].append(entry)
        pools["All"].append(entry)
    try:
        mdf = load_metrics()
        for _, mrow in mdf.iterrows():
            sc = str(mrow.get("scheme_code") or "").strip()
            if not sc:
                continue
            if sc not in code_map:
                sname = str(mrow.get("scheme_name") or "")
                splan = str(mrow.get("plan") or "")
                scat = str(mrow.get("cat") or "")
                cat_lbl = str(mrow.get("category") or "").split("-")[-1].strip() or scat.replace("_", " ").title()
                entry_row = {"code": sc, "name": sname, "plan": splan, "cat": scat, "cat_label": cat_lbl}
                code_map[sc] = entry_row
                norm = _norm_scheme(sname)
                entry = (sc, norm, set(norm.split()), entry_row)
                if splan in pools:
                    pools[splan].append(entry)
                pools["All"].append(entry)
            for col in ("isin_growth_or_payout", "isin_reinvest"):
                iv = portfolio_screen.clean_isin(mrow.get(col))
                if iv and iv not in isin_map:
                    isin_map[iv] = code_map[sc]
    except Exception:
        pass
    res = (code_map, isin_map, pools)
    _LOOKUPS_CACHE = (id(frame), res)
    return res


def _match_scheme(raw_name: str, isin: str | None, amfi: str | None, lookups: tuple, fallback_seq: int) -> tuple[dict[str, Any], str, str | None]:
    code_map, isin_map, pools = lookups
    c_amfi = str(amfi).strip() if amfi and re.fullmatch(r"\d{4,8}", str(amfi).strip()) else None
    c_isin = portfolio_screen.clean_isin(isin) or portfolio_screen.clean_isin((re.search(r"INF[A-Z0-9]{9}", (raw_name or "").upper()) or [None])[0])
    if c_amfi and c_amfi in code_map:
        return code_map[c_amfi], "exact_code", None
    if c_isin and c_isin in isin_map:
        return isin_map[c_isin], "exact_isin", None
    meta = cas.resolve_isin_metadata(c_isin) if c_isin else None
    if meta:
        m_code = str(meta.get("amfi_code") or "").strip()
        if m_code in code_map:
            return code_map[m_code], "exact_isin", None
        if not c_amfi and re.fullmatch(r"\d{4,8}", m_code):
            c_amfi = m_code
    names_to_try = [n for n in (meta.get("name") if meta else None, raw_name) if n]
    det_plan = portfolio_screen.detect_plan(raw_name or (meta.get("name") if meta else "") or "")
    pool = pools.get(det_plan if det_plan in ("Direct", "Regular") else "All") or pools["All"]
    prefer_reg = det_plan == "Unknown"
    best_score, best_row = 0.0, None
    for q_name in names_to_try:
        norm_q = _norm_scheme(q_name)
        q_toks = set(norm_q.split())
        if not norm_q:
            continue
        q_amc = ( _AMFI_PREFIX.match(norm_q).group(1) if _AMFI_PREFIX.match(norm_q) else None )
        for _c, c_norm, c_toks, c_row in pool:
            if not c_norm:
                continue
            c_amc = (_AMFI_PREFIX.match(c_norm).group(1) if _AMFI_PREFIX.match(c_norm) else None)
            if q_amc and c_amc and q_amc != c_amc:
                continue  # never cross-match one AMC's fund to another AMC's fund
            seq = difflib.SequenceMatcher(None, norm_q, c_norm).ratio()
            overlap = len(q_toks & c_toks) / max(len(q_toks), 1) if q_toks else 0.0
            sc = max(seq, 0.55 * seq + 0.45 * overlap)
            if (c_norm in norm_q or norm_q in c_norm) and (len(c_toks) >= 2 and len(q_toks) >= 2 or c_norm == norm_q):
                sc = min(1.0, sc + 0.12)
            if prefer_reg and c_row.get("plan") == "Regular":
                sc += 0.005
            if c_row.get("_from_frame"):
                sc += 0.002
            if sc > best_score:
                best_score, best_row = sc, c_row
    if best_row and best_score >= 0.78:
        return best_row, "matched_name", None
    # Try casparser_isin SQLite DB before accepting a low-confidence match
    cp_row = _lookup_casparser_isin_by_name(raw_name, det_plan)
    if cp_row:
        cp_code = str(cp_row["amfi_code"]).strip()
        if cp_code in code_map:
            return code_map[cp_code], "matched_name", None
        clean_cp = re.sub(r" - (Regular|Direct) Plan.*$", "", cas.format_scheme_name(raw_name or cp_row.get("name") or cp_code))
        return {"code": cp_code, "name": clean_cp, "cat_label": cas.infer_scheme_category(clean_cp)}, "matched_name", None
    if best_row and best_score >= 0.62:
        clean_n = re.sub(r" - (Regular|Direct) Plan.*$", "", str(best_row.get("name") or ""))
        return best_row, "ambiguous", f"'{raw_name}' was matched to {clean_n} ({best_row['code']}); please verify."
    code = c_amfi or f"{990000 + fallback_seq}"
    clean_raw = re.sub(r" - (Regular|Direct) Plan.*$", "", cas.format_scheme_name(raw_name or (meta.get("name") if meta else "") or code))
    return {"code": code, "name": clean_raw, "cat_label": cas.infer_scheme_category(clean_raw)}, "unmatched", (
        f"'{raw_name}' could not be matched to a scored AMFI scheme (assigned code {code}); use the search bar if you wish to replace it."
    )


# ---------- statement extractors ----------

_TX_SCHEME = re.compile(r"^\s*(?P<name>.+?)\s*\|\s*(?P<isin>IN[A-Z0-9]{10})\s+Avg NAV:\s*[\d.,]+\s*\|\s*Curt NAV:\s*(?P<nav>[\d.,]+)(?:\s*\|\s*NAV as on\s*(?P<ndate>\d{1,2}[-/]\d{1,2}[-/]\d{4}))?")
_TX_VAL = re.compile(r"Amt inv:\s*₹?\s*(?P<inv>[\d,.]+)\s*\|\s*Curt val:\s*₹?\s*(?P<cur>[\d,.]+)")
_TX_FOLIO = re.compile(r"^\s*(?P<holder>[^(\n]+?)\s*\(PAN:[^)]*\)\s*\|\s*(?P<folio>[A-Za-z0-9/\-]+)\s*$")
_TX_ROW = re.compile(r"^\s*\d+\s+(?P<type>[A-Za-z][A-Za-z ./-]*?)\s+(?P<date>\d{1,2}-\d{1,2}-\d{4})\s+₹\s*(?P<amt>[\d,]+(?:\.\d+)?)"
                     r"\s+(?P<nav>[\d,]+\.?\d*)\s+(?P<units>[\d,]+\.?\d*)\s+(?P<bal>[\d,]+\.?\d*)\s+\d+")


def _parse_mf_txn_report(pages: list[str]) -> dict[str, Any] | None:
    """ProAffluence 'MF Transaction Report': per-scheme holdings + dated purchase/SIP/redemption cash flows."""
    holdings: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    client_name, val_date = "", ""
    full = "\n".join(pages[:2])
    if m := re.search(r"Report\s+as\s+on:?\s*(" + ing.DATE_RE + ")", full, re.I):
        val_date = ing.parse_date(m.group(1)) or ""
    for text in pages:
        for line in text.splitlines():
            if m := _TX_SCHEME.match(line):
                if m.group("ndate") and not val_date:
                    val_date = ing.parse_date(m.group("ndate")) or ""
                cur = {"raw_name": m["name"].strip(), "isin": m["isin"], "amfi_code": None, "folio": None,
                       "nav": ing.to_num(m["nav"]), "units": None, "invested": None, "value": None, "flows": []}
                holdings.append(cur)
            elif cur is None:
                continue
            elif m := _TX_VAL.search(line):
                cur["invested"], cur["value"] = ing.to_num(m["inv"]), ing.to_num(m["cur"])
            elif m := _TX_FOLIO.search(line):
                cur["folio"] = m["folio"].strip()
                if not client_name and m["holder"].strip():
                    client_name = m["holder"].strip().title()
            elif m := _TX_ROW.match(line):
                cur["units"] = ing.to_num(m["bal"])
                kind, amt, dt = ing.classify_flow(m["type"]), ing.to_num(m["amt"]), ing.parse_date(m["date"])
                if dt and amt and kind in ("deposit", "transfer_in", "withdrawal", "transfer_out"):
                    cur["flows"].append((dt, round(amt if kind in ("deposit", "transfer_in") else -amt, 2)))
    holdings = [h for h in holdings if (h.get("value") or 0) > 0 or (h.get("units") or 0) > 0]
    return {"client_name": client_name, "val_date": val_date, "portfolio_xirr": None, "holdings": holdings, "kind": "mf_txn"} if holdings else None


_SUM_HDR = re.compile(r"^\s*(?P<name>.+?\S)\s*\|\s*(?P<folio>[A-Za-z0-9/\-]+)\s*\|\s*(?P<holder>[A-Za-z][A-Za-z .]+?)\s*$")


def _parse_mf_summary_report(text: str) -> dict[str, Any] | None:
    """ProAffluence 'MF Summary Report' (single-line or multi-line layout): holdings with start date, invested, value, XIRR and holding days."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    holdings: list[dict[str, Any]] = []
    client_name, val_date, p_xirr = "", "", None
    if m := re.search(r"Report\s+as\s+on:?\s*(" + ing.DATE_RE + ")", text, re.I):
        val_date = ing.parse_date(m.group(1)) or ""
    if m := re.search(r"^[ \t]*([A-Za-z][A-Za-z .]{2,50}?)\s*\(([A-Z]{5}\d{4}[A-Z])\)", text, re.M):
        client_name = m.group(1).strip()
    if g := re.search(r"Grand\s+total[^\n₹]*₹\s*([^\n]+)", text, re.I):
        g_nums = [ing.to_num(t) for t in re.findall(r"-?[\d,]+(?:\.\d+)?", g.group(1))]
        if len(g_nums) >= 6 and g_nums[5] is not None:
            p_xirr = g_nums[5]
    i = 0
    while i < len(lines):
        m = _SUM_HDR.match(lines[i])
        if not m or any(k in m["folio"].lower() for k in ("folio", "scheme", "units")):
            i += 1
            continue
        name, folio, holder = m["name"].strip(), m["folio"].strip(), m["holder"].strip()
        if not client_name and holder and not re.search(r"\d", holder):
            client_name = holder
        block = lines[i + 1 : min(len(lines), i + 5)]
        fig_line = next((ln for ln in block if "₹" in ln), None)
        if not fig_line:
            i += 1
            continue
        pre, post = fig_line.split("₹", 1)
        all_dates = [ing.parse_date(d) for ln in block[: block.index(fig_line) + 1] for d in re.findall(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", ln)]
        all_dates = [d for d in all_dates if d]
        pre_dates = [ing.parse_date(d) for d in re.findall(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", pre)]
        pre_dates = [d for d in pre_dates if d]
        start_iso = pre_dates[-1] if pre_dates else (min(all_dates) if len(all_dates) >= 2 else None)
        if not val_date and all_dates:
            val_date = max(all_dates)
        pre_clean = re.sub(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b", " ", pre)
        pre_nums = [ing.to_num(t) for t in re.findall(r"\d[\d,]*(?:\.\d+)?", pre_clean)]
        pre_nums = [x for x in pre_nums if x is not None]
        units = pre_nums[-1] if pre_nums else None
        nav = pre_nums[0] if len(pre_nums) >= 2 else (ing.to_num(block[0]) if block and block[0] != fig_line else None)
        post_nums = [ing.to_num(t) for t in re.findall(r"-?[\d,]+(?:\.\d+)?", post)]
        post_nums = [x for x in post_nums if x is not None]
        if len(post_nums) >= 2:
            inv, cur = post_nums[0], post_nums[1]
            ret = post_nums[5] if len(post_nums) >= 6 else None
            days = post_nums[6] if len(post_nums) >= 7 else None
            if not start_iso and days and days > 0 and val_date:
                start_iso = (date.fromisoformat(val_date) - timedelta(days=int(days))).isoformat()
            holdings.append({
                "raw_name": name, "isin": None, "amfi_code": None, "folio": folio,
                "units": units, "nav": nav, "invested": inv, "value": cur,
                "from": start_iso[:7] if start_iso else "", "to": "", "inst": "",
                "ret": ret, "flag": "†" if days is not None and 0 < days < 365 else "", "flows": [],
            })
        i += block.index(fig_line) + 2
    return {"client_name": client_name, "val_date": val_date, "portfolio_xirr": p_xirr, "holdings": holdings, "kind": "mf_summary"} if holdings else None


def _cas_scheme_cost_and_flows(s: dict[str, Any]) -> tuple[float | None, list[tuple[str, float]]]:
    val_obj = s.get("valuation") or {}
    printed_cost = ing.to_num(val_obj.get("cost")) or ing.to_num(s.get("invested_value"))
    flows: list[tuple[str, float]] = []
    run_units = 0.0
    run_cost = 0.0
    for tx in s.get("transactions") or []:
        dt = ing.parse_date(tx.get("date"))
        amt = ing.to_num(tx.get("amount"))
        u = ing.to_num(tx.get("units"))
        tt = str(tx.get("type") or tx.get("description") or "").upper()
        if not dt or not amt or any(k in tt for k in ("STAMP", "STT", "TAX", "MISC", "REVERSAL", "SEGREGAT")):
            continue
        if any(k in tt for k in ("PURCHASE", "SIP", "SWITCH_IN", "SWITCH IN", "ADDITIONAL", "INFUSION", "NEW", "REINVEST")):
            flows.append((dt, round(abs(amt), 2)))
            run_cost += abs(amt)
            if u:
                run_units += abs(u)
        elif any(k in tt for k in ("REDEMPTION", "SWITCH_OUT", "SWITCH OUT", "SWP", "WITHDRAW", "PAYOUT")):
            flows.append((dt, -round(abs(amt), 2)))
            if u and run_units > 1e-6:
                frac = min(1.0, abs(u) / run_units)
                run_cost = max(0.0, run_cost * (1.0 - frac))
                run_units = max(0.0, run_units - abs(u))
            else:
                run_cost = max(0.0, run_cost - abs(amt))
    if printed_cost is not None and printed_cost > 0:
        return round(printed_cost, 2), flows
    if run_cost > 0:
        return round(run_cost, 2), flows
    pos_sum = sum(a for _, a in flows if a > 0)
    return (round(pos_sum, 2) if pos_sum > 0 else None), flows


def _parse_cas_pdf(data: bytes, password: str) -> dict[str, Any] | None:
    """Parse CAMS / KFintech / NSDL / CDSL CAS PDF via casparser (including cost and dated transactions)."""
    import casparser
    from casparser.enums import FileType

    cas._apply_casparser_patches()
    parsed = None
    for fn in (
        lambda: casparser.read_cas_pdf(io.BytesIO(data), password=password, output="dict"),
        lambda: __import__("casparser.parsers.cams_detailed", fromlist=["parse"]).parse(io.BytesIO(data), password, file_type=FileType.CAMS),
        lambda: __import__("casparser.parsers.cdsl", fromlist=["parse_cdsl"]).parse_cdsl(io.BytesIO(data), password, file_type=FileType.CDSL),
        lambda: __import__("casparser.parsers.nsdl", fromlist=["parse_nsdl"]).parse_nsdl(io.BytesIO(data), password, file_type=FileType.NSDL),
        lambda: __import__("casparser.parsers.cams_summary", fromlist=["parse"]).parse(io.BytesIO(data), password, file_type=FileType.CAMS),
    ):
        try:
            cand = cas.normalize_cas_dict(fn())
            if cand and cand.get("folios"):
                parsed = cand
                break
        except Exception as e:
            if "password" in str(e).lower():
                raise
    if not parsed:
        return None
    inv_name = str((parsed.get("investor_info") or {}).get("name") or "").strip()
    if inv_name.lower() in ("valued investor", "none", "null"):
        inv_name = ""
    elif inv_name.isupper():
        inv_name = inv_name.title()
    val_date = ing.parse_date((parsed.get("statement_period") or {}).get("to")) or ""
    holdings: list[dict[str, Any]] = []
    for folio_obj in parsed.get("folios") or []:
        f_no = str(folio_obj.get("folio") or "").strip() or None
        for s in folio_obj.get("schemes") or []:
            name = str(s.get("scheme") or "").strip()
            if not name:
                continue
            units = float(s.get("close") or 0.0)
            val_obj = s.get("valuation") or {}
            nav = float(val_obj.get("nav") or 0.0)
            val = float(val_obj.get("value") or 0.0)
            if val <= 0 and units > 0 and nav > 0:
                val = round(units * nav, 2)
            if units <= 0 and val <= 0:
                continue
            s_date = ing.parse_date(val_obj.get("date"))
            if s_date and s_date > val_date:
                val_date = s_date
            cost, flows = _cas_scheme_cost_and_flows(s)
            holdings.append({
                "raw_name": name, "isin": portfolio_screen.clean_isin(s.get("isin")),
                "amfi_code": portfolio_screen.clean_code(s.get("amfi")), "folio": f_no,
                "units": round(units, 4) if units > 0 else None, "nav": round(nav, 4) if nav > 0 else None,
                "invested": cost, "value": round(val, 2), "from": "", "to": "", "inst": "",
                "ret": None, "flag": "", "flows": flows,
            })
    return {"client_name": inv_name, "val_date": val_date, "portfolio_xirr": None, "holdings": holdings, "kind": "cas"} if holdings else None


def _col_role(header: Any) -> str | None:
    h = re.sub(r"\s+", " ", str(header or "").strip().lower())
    if not h:
        return None
    if re.search(r"\b(scheme\s*code|amfi(\s*code)?|^code$)\b", h):
        return "amfi_code"
    if "isin" in h:
        return "isin"
    if re.search(r"\b(first\s*month|from(\s*month)?|start(\s*date|\s*month)?|period\s*from|inception)\b", h):
        return "from"
    if re.search(r"\b(last\s*month|to(\s*month)?|end(\s*date|\s*month)?|period\s*to)\b", h):
        return "to"
    if re.search(r"\b(instalments?|installments?|#?\s*inst\.?)\b", h):
        return "inst"
    if re.search(r"\b(xirr|ann\.?\s*ret|annuali[sz]ed\s*ret|cagr)\b", h):
        return "ret"
    return ing.classify_header(h)


def _norm_ym(v: Any) -> str:
    s = str(v or "").strip()
    if re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", s):
        return s
    iso = ing.parse_date(s)
    return iso[:7] if iso else ""


def _extract_table_rows(rows: list[list[Any]]) -> tuple[list[dict[str, Any]], str, str]:
    """Spreadsheet / CSV / Word / JSON rows -> holdings, client name and statement date."""
    head_txt = "\n".join("   ".join(str(c) for c in r if c is not None) for r in rows[:15])
    _, meta, _ = ing.scan_scalars(head_txt.splitlines())
    st_date = meta.get("statement_date") or ""
    if not st_date and (m := portfolio_screen._STMT_DATE.search(head_txt)):
        st_date = ing.parse_date(m.group(1)) or ""
    client_name = ""
    if m := re.search(r"(?:Client|Investor)(?:\s*Name)?\s*[:\-]\s*([A-Za-z][A-Za-z .]{2,50})", head_txt, re.I):
        client_name = m.group(1).strip()
    holdings: list[dict[str, Any]] = []
    cols: dict[str, int] = {}
    for r in rows:
        mapped: dict[str, int] = {}
        for i, c in enumerate(r):
            f = _col_role(c)
            if f and f not in mapped:
                mapped[f] = i
        if ("security_name" in mapped or "amfi_code" in mapped) and any(k in mapped for k in ("market_value", "quantity", "invested_amount")):
            cols = mapped
            continue
        if not cols:
            # Check for headerless pasted code rows: code, invested, value[, from, to, inst]
            cells = [str(c).strip().replace("₹", "") for c in r if c is not None and str(c).strip() != ""]
            if len(cells) >= 3 and re.fullmatch(r"\d{4,8}", cells[0]):
                inv, val = ing.to_num(cells[1]), ing.to_num(cells[2])
                if inv is not None and val is not None and (inv > 0 or val > 0):
                    holdings.append({
                        "raw_name": "", "isin": None, "amfi_code": cells[0], "folio": None,
                        "units": None, "nav": None, "invested": inv, "value": val,
                        "from": _norm_ym(cells[3]) if len(cells) > 3 else "",
                        "to": _norm_ym(cells[4]) if len(cells) > 4 else "",
                        "inst": cells[5] if len(cells) > 5 and cells[5].isdigit() else "",
                        "ret": None, "flag": "", "flows": [],
                    })
            continue
        cell = {f: (r[i] if i < len(r) else None) for f, i in cols.items()}
        name = str(cell.get("security_name") or "").strip()
        amfi = str(cell.get("amfi_code") or "").strip()
        amfi = amfi if re.fullmatch(r"\d{4,8}", amfi) else None
        if not amfi and (len(name) < 3 or not re.search(r"[A-Za-z]{2}", name) or ing._TOTAL_NAME.match(name)):
            continue
        if cell.get("asset_type") and re.search(r"^(equity\s*share|stock|bond|debenture|cash|pms)", str(cell["asset_type"]).strip(), re.I):
            continue
        units, nav = ing.to_num(cell.get("quantity")), ing.to_num(cell.get("price"))
        inv, val = ing.to_num(cell.get("invested_amount")), ing.to_num(cell.get("market_value"))
        if val is None and units and nav:
            val = round(units * nav, 2)
        if inv is None and units and ing.to_num(cell.get("avg_cost")):
            inv = round(units * float(ing.to_num(cell.get("avg_cost"))), 2)
        if (units or 0) <= 0 and (val or 0) <= 0:
            continue
        isin = portfolio_screen.clean_isin(cell.get("isin")) or portfolio_screen.clean_isin((re.search(r"INF[A-Z0-9]{9}", name.upper()) or [None])[0])
        ret_raw = str(cell.get("ret") or "").rstrip("%").strip()
        holdings.append({
            "raw_name": name or amfi or "", "isin": isin, "amfi_code": amfi,
            "folio": str(cell.get("folio") or "").strip() or None,
            "units": units if units and units > 0 else None, "nav": nav if nav and nav > 0 else None,
            "invested": inv if inv is not None and inv >= 0 else None,
            "value": val if val is not None and val >= 0 else 0.0,
            "from": _norm_ym(cell.get("from")), "to": _norm_ym(cell.get("to")),
            "inst": str(int(float(cell["inst"]))) if ing.to_num(cell.get("inst")) else "",
            "ret": ing.to_num(ret_raw), "flag": "", "flows": [],
        })
    return holdings, client_name, st_date


def _extract_single_file(name: str, data: bytes, password: str) -> dict[str, Any]:
    """Extract holdings, flows, client metadata and optional explicit compare JSON from one uploaded file."""
    if not data:
        raise ValueError(f"{name}: the file is empty.")
    # Check if the file is a JSON comparison or review payload
    if name.lower().endswith(".json") or data.lstrip()[:1] == b"{":
        try:
            obj = json.loads(data.decode("utf-8-sig"))
            if isinstance(obj, dict) and ("per_fund" in obj or "portfolio_xirr" in obj or "nifty500_xirr" in obj) and "holdings" not in obj:
                return {"client_name": "", "val_date": "", "portfolio_xirr": obj.get("portfolio_xirr"), "holdings": [],
                        "explicit_compare": Compare(**obj).model_dump(), "kind": "compare_json", "warnings": []}
        except Exception:
            pass
    if not client_report.is_pdf(name, data):
        sheet_list = portfolio_screen.read_table_rows(name, data)
        if sheet_list:
            all_h: list[dict[str, Any]] = []
            all_flows: list[ing.FlowRec] = []
            c_name, st_date, warns = "", "", []
            for idx, rows in enumerate(sheet_list):
                h, cn, sd = _extract_table_rows(rows)
                if not h:
                    l_h, l_sd = portfolio_screen.extract_from_layout_text("\n".join("   ".join(str(c) for c in r if c is not None and str(c).strip()) for r in rows))
                    h = [{"raw_name": x["raw_name"], "isin": x.get("isin"), "amfi_code": x.get("amfi_code"), "folio": x.get("folio"),
                          "units": x.get("units"), "nav": x.get("statement_nav"), "invested": None, "value": x.get("statement_value") or 0.0,
                          "from": "", "to": "", "inst": "", "ret": None, "flag": "", "flows": []} for x in l_h]
                    sd = sd or (ing.parse_date(l_sd) if l_sd else "")
                all_h.extend(h)
                c_name = c_name or cn
                st_date = st_date or sd
                fl, fw = ing.flows_from_rows(rows, f"sheet{idx + 1}")
                all_flows.extend(fl)
                warns.extend(fw)
            if all_h:
                if all_flows and len(all_h) == 1:
                    all_h[0]["flows"].extend((f.flow_date, f.amount if f.kind in ("deposit", "transfer_in") else -f.amount) for f in all_flows if f.flow_date and f.amount)
                return {"client_name": c_name, "val_date": st_date, "portfolio_xirr": None, "holdings": all_h, "kind": "spreadsheet", "warnings": warns}
        text = client_report.extract_text(name, data)
        for fn in (
            _parse_mf_summary_report,
            lambda t: _parse_mf_txn_report([t]),
        ):
            res = fn(text)
            if res:
                return {**res, "warnings": []}
        st = client_report.parse_statement(text)
        if st:
            return {
                "client_name": st["client"]["name"], "val_date": ing.parse_date(st["client"]["date"]) or "",
                "portfolio_xirr": st["xirr"], "kind": "folio_wise", "warnings": [],
                "holdings": [{"raw_name": r["name"], "isin": None, "amfi_code": None, "folio": r["folio"], "units": r["units"], "nav": r["nav"],
                              "invested": r["invested"], "value": r["value"], "from": "", "to": "", "inst": "", "ret": r["ann_ret"], "flag": "", "flows": []}
                             for r in st["rows"] if (r["value"] or 0) > 0 or (r["units"] or 0) > 0],
            }
        # Pasted code rows in plain text
        t_rows = [[c.strip() for c in re.split(r"[,\t]", ln)] for ln in text.splitlines() if ln.strip()]
        h_paste, cn_p, sd_p = _extract_table_rows(t_rows)
        if h_paste:
            return {"client_name": cn_p, "val_date": sd_p, "portfolio_xirr": None, "holdings": h_paste, "kind": "text", "warnings": []}
        for ext in (portfolio_screen.extract_from_layout_text, portfolio_screen.extract_universal_from_text):
            eh, esd = ext(text)
            if eh:
                return {
                    "client_name": "", "val_date": ing.parse_date(esd) or "", "portfolio_xirr": None, "kind": "text", "warnings": [],
                    "holdings": [{"raw_name": x["raw_name"], "isin": x.get("isin"), "amfi_code": x.get("amfi_code"), "folio": x.get("folio"),
                                  "units": x.get("units"), "nav": x.get("statement_nav"), "invested": None, "value": x.get("statement_value") or 0.0,
                                  "from": "", "to": "", "inst": "", "ret": None, "flag": "", "flows": []} for x in eh],
                }
        raise ValueError(f"{name}: no mutual fund holdings found in this file.")

    # PDF path: check encryption first
    try:
        pages = ing.read_pdf_pages(data, password, "layout")
        plain = ing.read_pdf_pages(data, password, "plain")
    except ing.ExtractionError as e:
        if e.code == "password_required":
            raise PermissionError(f"{name}: PDF is password-protected; enter the password and click Unlock & parse.") from e
        raise ValueError(f"{name}: {e.args[0]}") from e
    ptxt = ing.pdfium_pages(data, password)
    full_layout = "\n".join(pages)
    full_pdfium = "\n".join(ptxt)

    # 1. ProAffluence MF Transaction Report
    if txn := _parse_mf_txn_report(pages) or _parse_mf_txn_report(ptxt):
        return {**txn, "warnings": []}

    # 2. ProAffluence MF Summary Report
    if mfs := _parse_mf_summary_report(full_layout) or _parse_mf_summary_report(full_pdfium):
        return {**mfs, "warnings": []}

    # 2.5. 'Portfolio Valuation Report - Transaction Wise' (per-scheme section headers + dated purchase rows + Sub Total)
    tx_w_h, tx_w_tot, tx_w_warns, _, tx_w_flows, _ = layouts.transaction_wise_mf(plain)
    if tx_w_h:
        c_name = ""
        title_i = next((i for i, ln in enumerate((plain[0] if plain else "").splitlines()) if "valuation report" in ln.lower()), -1)
        p0_lines = [ln.strip() for ln in (plain[0] if plain else "").splitlines() if ln.strip()]
        if title_i >= 0 and title_i + 1 < len(p0_lines):
            c_name = p0_lines[title_i + 1]
        v_date = layouts.folio_date(plain) or ""
        p_xirr = tx_w_tot.get("reported_xirr")
        # Group dated flows per (security_name, account_no)
        hs_tx: list[dict[str, Any]] = []
        flow_idx = 0
        for h in tx_w_h:
            my_flows: list[tuple[str, float]] = []
            while flow_idx < len(tx_w_flows) and tx_w_flows[flow_idx].account_no == h.account_no and tx_w_flows[flow_idx].description.startswith(h.security_name[:60]):
                fl = tx_w_flows[flow_idx]
                if fl.flow_date and fl.amount:
                    my_flows.append((fl.flow_date, fl.amount))
                flow_idx += 1
            f_ym = my_flows[0][0][:7] if my_flows else ""
            l_ym = my_flows[-1][0][:7] if my_flows else ""
            hs_tx.append({
                "raw_name": h.security_name, "isin": h.isin, "amfi_code": None, "folio": h.account_no,
                "units": h.quantity, "nav": h.price, "invested": h.invested_amount, "value": h.market_value or 0.0,
                "from": f_ym, "to": f_ym if len(my_flows) == 1 else l_ym,
                "inst": str(len(my_flows)) if my_flows else "",
                "ret": h.reported_xirr, "flag": "†" if h.reported_xirr is None else "",
                "flows": my_flows,
            })
        return {"client_name": c_name, "val_date": v_date, "portfolio_xirr": p_xirr, "holdings": hs_tx, "kind": "mf_txn", "warnings": tx_w_warns}

    # 3. FundsIndia Folio-Wise Valuation Report
    fw_h, fw_tot, fw_w, _ = layouts.folio_wise_mf(plain)
    st = client_report.parse_statement(full_layout)
    if fw_h or st:
        c_name = (st["client"]["name"] if st else "") or ""
        v_date = ing.parse_date((st["client"]["date"] if st else None) or layouts.folio_date(plain)) or ""
        p_xirr = fw_tot.get("reported_xirr") if fw_tot else (st["xirr"] if st else None)
        if fw_h:
            hs = [{"raw_name": h.security_name, "isin": h.isin, "amfi_code": None, "folio": h.account_no,
                   "units": h.quantity, "nav": h.price, "invested": h.invested_amount, "value": h.market_value or 0.0,
                   "from": "", "to": "", "inst": "", "ret": h.reported_xirr, "flag": "", "flows": []} for h in fw_h]
        else:
            hs = [{"raw_name": r["name"], "isin": None, "amfi_code": None, "folio": r["folio"],
                   "units": r["units"], "nav": r["nav"], "invested": r["invested"], "value": r["value"],
                   "from": "", "to": "", "inst": "", "ret": r["ann_ret"], "flag": "", "flows": []} for r in st["rows"]]
        return {"client_name": c_name, "val_date": v_date, "portfolio_xirr": p_xirr, "holdings": hs, "kind": "folio_wise", "warnings": fw_w}

    # 4. CAMS / KFintech / NSDL / CDSL Consolidated Account Statement (CAS)
    try:
        if cas_res := _parse_cas_pdf(data, password):
            return {**cas_res, "warnings": []}
    except Exception as e:
        if "password" in str(e).lower():
            raise PermissionError(f"{name}: incorrect password for this PDF statement.") from e

    # 5. FundsIndia Web Printout / Cards
    card_h, _, _, _ = ing.holdings_from_cards(ptxt or pages)
    if card_h:
        v_date = ""
        if m := ing._PRINT_DATE.search(full_pdfium or full_layout):
            v_date = ing.parse_date(m.group(1)) or ""
        return {
            "client_name": "", "val_date": v_date, "portfolio_xirr": None, "kind": "cards", "warnings": [],
            "holdings": [{"raw_name": h.security_name, "isin": h.isin, "amfi_code": None, "folio": h.account_no,
                          "units": h.quantity, "nav": h.price, "invested": h.invested_amount, "value": h.market_value or 0.0,
                          "from": "", "to": "", "inst": "", "ret": None, "flag": "", "flows": []} for h in card_h],
        }

    # 6. Generic tabular PDF (header-driven or positional columns)
    cands = [ing.holdings_from_text(pages), ing.holdings_from_columns(data, password)]
    best_h, _, best_w, _ = ing.pick_best(cands)
    if best_h:
        _, meta, _ = ing.scan_scalars(full_layout.splitlines())
        return {
            "client_name": "", "val_date": meta.get("statement_date") or "", "portfolio_xirr": None, "kind": "table_pdf", "warnings": best_w,
            "holdings": [{"raw_name": h.security_name, "isin": h.isin, "amfi_code": None, "folio": h.account_no,
                          "units": h.quantity, "nav": h.price, "invested": h.invested_amount, "value": h.market_value or 0.0,
                          "from": "", "to": "", "inst": "", "ret": h.reported_xirr, "flag": "", "flows": []}
                         for h in best_h if (h.market_value or 0) > 0 or (h.quantity or 0) > 0],
        }

    # 7. Layout / universal text fallback + OCR for scanned PDFs
    for txt in (full_layout, full_pdfium):
        for ext in (portfolio_screen.extract_from_layout_text, portfolio_screen.extract_universal_from_text):
            eh, esd = ext(txt)
            if eh:
                return {
                    "client_name": "", "val_date": ing.parse_date(esd) or "", "portfolio_xirr": None, "kind": "text_pdf", "warnings": [],
                    "holdings": [{"raw_name": x["raw_name"], "isin": x.get("isin"), "amfi_code": x.get("amfi_code"), "folio": x.get("folio"),
                                  "units": x.get("units"), "nav": x.get("statement_nav"), "invested": None, "value": x.get("statement_value") or 0.0,
                                  "from": "", "to": "", "inst": "", "ret": None, "flag": "", "flows": []} for x in eh],
                }
    if len((full_layout + full_pdfium).strip()) < 100 or re.search(r"funds[il1]ndia", (full_layout + full_pdfium).lower()):
        try:
            fi_ocr = statements.parse_fundsindia(statements.fundsindia_pages(name, data))
            if fi_ocr and fi_ocr.get("categories"):
                hs = [{"raw_name": f["name"], "isin": None, "amfi_code": None, "folio": None, "units": None, "nav": None,
                       "invested": f["invested"], "value": f["current"], "from": "", "to": "", "inst": "", "ret": f.get("ann_ret"), "flag": "", "flows": []}
                      for c in fi_ocr["categories"] for f in c.get("funds") or []]
                if hs:
                    return {"client_name": fi_ocr["client"]["name"], "val_date": ing.parse_date(fi_ocr["as_on"]) or "",
                            "portfolio_xirr": fi_ocr["grand_total"].get("xirr"), "holdings": hs, "kind": "ocr", "warnings": fi_ocr.get("warnings") or []}
        except Exception:
            pass
    raise ValueError(f"{name}: no active mutual fund holdings could be identified in this statement.")


def build_analysis(holdings: list[dict[str, Any]], val_date_str: str, portfolio_xirr: float | None = None,
                   explicit_compare: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Compute `compare` and live Fund Horizon `analysis` for the current holdings."""
    codes = [str(h["code"]) for h in holdings if h.get("code")]
    live = live_data(codes)
    for h in holdings:
        lv = live.get(str(h["code"])) or {}
        if not h.get("name") and lv.get("name"):
            h["name"] = lv["name"]
        if not h.get("typ") and lv.get("cat_label"):
            h["typ"] = lv["cat_label"]
        if not h.get("period") and h.get("from"):
            h["period"] = _period_label(h["from"], h.get("to") or "")
    cmp_ = explicit_compare or compute_compare(holdings, val_date_str, portfolio_xirr=portfolio_xirr, live=live)
    rev_dict = {"client": {"name": "Client", "date": val_date_str or date.today().isoformat()}, "holdings": holdings, "compare": cmp_}
    s = summarize_review(rev_dict, live)
    sigs = {"Buy": 0, "Hold": 0, "Sell": 0, "Needs review": 0}
    for h in s["hold"]:
        sig = h["lv"].get("fh_signal") or "Needs review"
        sigs[sig if sig in sigs else "Needs review"] += 1
    analysis = {
        "invested": round(s["inv"], 2), "value": round(s["val"], 2), "gain": round(s["gain"], 2),
        "abs_ret": round((s["gain"] / s["inv"]) * 100, 2) if s["inv"] else 0.0,
        "xirr": s["xirr"], "nav_date": s["nav_date"],
        "signals": sigs,
        "buckets": [{"name": k, "value": round(v, 2), "pct": round(v / s["val"] * 100, 1) if s["val"] else 0.0} for k, v in s["order"]],
        "recommendations": [{"title": t, "body": b} for t, b in s["recs"]],
        "stress_test": [{"scenario": r[0], "covered": r[1], "change_inr": r[2], "change_pct": r[3]} for r in s["stress_rows"]],
        "live": {c: {k: v for k, v in d.items() if k != "falls"} | {"falls": d.get("falls") or {}} for c, d in live.items()},
    }
    return cmp_, analysis


def parse_review_files(files: list[tuple[str, bytes]], password: str = "") -> dict[str, Any]:
    """Parse 1..MAX_FILES uploaded statements, match schemes, aggregate by scheme code and compute comparison + live analysis."""
    expanded: list[tuple[str, bytes]] = []
    dash_xirr: float | None = None
    warnings: list[str] = []
    file_results: list[dict[str, Any]] = []
    for name, data in files:
        if client_report.is_pdf(name, data):
            try:
                secs, dash = bundle.split(data, password)
            except Exception:
                secs, dash = [], {}
            if dash and dash_xirr is None:
                dash_xirr = (dash.get("xirr_by_class") or {}).get("mf") or dash.get("since_inception_xirr")
                if dash_xirr is not None:
                    dash_xirr = float(dash_xirr)
            if secs:
                stem = re.sub(r"\.pdf$", "", name, flags=re.I)
                mf_secs = [s for s in secs if "mf" in s["label"].lower() or s["provider"] == "fundsindia"]
                skipped = [s["label"] for s in secs if s not in mf_secs]
                if skipped:
                    warnings.append(f"{name}: skipped non-mutual-fund section(s) ({', '.join(skipped)}).")
                for s in (mf_secs or secs):
                    expanded.append((f"{stem} - {s['label']}.pdf", s["data"]))
                continue
        expanded.append((name, data))

    frame = _frame()
    lookups = _build_lookups(frame)
    client_name, val_date, p_xirr = "", "", dash_xirr
    explicit_compare: dict[str, Any] | None = None
    raw_items: list[dict[str, Any]] = []
    fallback_seq = 0

    for fname, fbytes in expanded:
        try:
            res = _extract_single_file(fname, fbytes, password)
        except PermissionError as pe:
            warnings.append(str(pe))
            file_results.append({"name": fname, "kind": "password_required", "holdings_count": 0, "flows_count": 0, "error": str(pe)})
            continue
        except Exception as e:
            warnings.append(str(e))
            file_results.append({"name": fname, "kind": "error", "holdings_count": 0, "flows_count": 0, "error": str(e)})
            continue
        warnings.extend(f"{fname}: {w}" for w in (res.get("warnings") or []))
        if res.get("explicit_compare"):
            explicit_compare = res["explicit_compare"]
        if res.get("client_name") and not client_name:
            client_name = res["client_name"]
        if res.get("val_date") and res["val_date"] > val_date:
            val_date = res["val_date"]
        if res.get("portfolio_xirr") is not None and p_xirr is None:
            p_xirr = float(res["portfolio_xirr"])
        f_flows = 0
        for h in res.get("holdings") or []:
            fallback_seq += 1
            matched, m_type, m_warn = _match_scheme(h.get("raw_name") or "", h.get("isin"), h.get("amfi_code"), lookups, fallback_seq)
            if m_warn:
                warnings.append(f"{fname}: {m_warn}")
            code = str(matched["code"])
            clean_name = re.sub(r" - (Regular|Direct) Plan.*$", "", str(matched.get("name") or h.get("raw_name") or code))
            f_flows += len(h.get("flows") or [])
            raw_items.append({
                **h, "code": code, "name": clean_name, "typ": str(matched.get("cat_label") or ""),
                "match_type": m_type, "_file": fname,
            })
        file_results.append({
            "name": fname, "kind": res.get("kind") or "statement",
            "holdings_count": len(res.get("holdings") or []), "flows_count": f_flows, "error": None,
        })

    # Step 1: deduplicate identical (folio, code) across summary + transaction uploads of the same portfolio
    by_folio_code: list[dict[str, Any]] = []
    for item in raw_items:
        f_no, code = item.get("folio"), item["code"]
        dup = next(
            (x for x in by_folio_code if x["code"] == code and (
                (f_no and x.get("folio") == f_no)
                or (x["_file"] != item["_file"] and (not f_no or not x.get("folio"))
                    and x.get("value") and item.get("value") and abs(x["value"] - item["value"]) <= max(5.0, 0.02 * x["value"]))
            )),
            None,
        )
        if dup is not None:
            if item.get("flows") and not dup.get("flows"):
                dup["flows"] = item["flows"]
            if (dup.get("invested") is None or dup["invested"] == 0) and item.get("invested"):
                dup["invested"] = item["invested"]
            if item.get("value") and not dup.get("value"):
                dup["value"] = item["value"]
            for k in ("from", "to", "inst", "ret", "flag", "folio"):
                if not dup.get(k) and item.get(k) not in (None, ""):
                    dup[k] = item[k]
            continue
        by_folio_code.append(dict(item))

    # Step 2: combine distinct folios of the same scheme `code` into one Portfolio Review row
    by_code: dict[str, dict[str, Any]] = {}
    for item in by_folio_code:
        code = item["code"]
        if code not in by_code:
            by_code[code] = {
                "code": code, "name": item["name"], "typ": item.get("typ") or "",
                "invested": float(item.get("invested") or 0.0), "invested_missing": item.get("invested") is None,
                "value": float(item.get("value") or 0.0), "from": item.get("from") or "", "to": item.get("to") or "",
                "inst": item.get("inst") or "", "ret": item.get("ret"), "flag": item.get("flag") or "",
                "flows": list(item.get("flows") or []), "match_type": item.get("match_type") or "matched_name",
                "_ret_w": (float(item["ret"]) * float(item.get("value") or 0.0)) if item.get("ret") is not None else None,
            }
        else:
            cur = by_code[code]
            v = float(item.get("value") or 0.0)
            cur["invested"] = round(cur["invested"] + float(item.get("invested") or 0.0), 2)
            cur["invested_missing"] = cur["invested_missing"] and (item.get("invested") is None)
            cur["value"] = round(cur["value"] + v, 2)
            cur["flows"].extend(item.get("flows") or [])
            if item.get("from") and (not cur["from"] or item["from"] < cur["from"]):
                cur["from"] = item["from"]
            if item.get("to") and (not cur["to"] or item["to"] > cur["to"]):
                cur["to"] = item["to"]
            if str(cur["inst"]).isdigit() and str(item.get("inst") or "").isdigit():
                cur["inst"] = str(int(cur["inst"]) + int(item["inst"]))
            if item.get("ret") is not None:
                cur["_ret_w"] = (cur["_ret_w"] or 0.0) + float(item["ret"]) * v
                if cur["value"] > 0:
                    cur["ret"] = round(cur["_ret_w"] / cur["value"], 2)

    holdings = list(by_code.values())
    for h in holdings:
        h.pop("_ret_w", None)
        h["invested"] = round(h["invested"], 2)
        h["value"] = round(h["value"], 2)

    missing_inv = [h["name"] for h in holdings if h.pop("invested_missing", False) and h["invested"] == 0 and not h.get("flows")]
    if missing_inv:
        warnings.append(
            f"Invested amount was not printed in the statement for {len(missing_inv)} fund(s) ({', '.join(missing_inv[:4])}"
            + ("…" if len(missing_inv) > 4 else "") + "); enter their invested amounts in the table or upload a statement with cost/transactions."
        )

    eff_date = val_date or date.today().isoformat()
    cmp_, analysis = build_analysis(holdings, eff_date, portfolio_xirr=p_xirr, explicit_compare=explicit_compare)
    return {
        "client": {"name": client_name, "date": eff_date},
        "holdings": holdings,
        "compare": cmp_,
        "analysis": analysis,
        "warnings": list(dict.fromkeys(warnings)),
        "file_results": file_results,
    }


def _pdf(rv: Review) -> bytes:
    h = rv.model_dump()
    return build_portfolio_review(h, live_data([x["code"] for x in h["holdings"]]))


def _filename(rv: Review) -> str:
    return re.sub(r"[^\w.\- ]", "_", f"Portfolio Review - {rv.client.name} - {rv.client.date}")[:100] + ".pdf"


@router.post("/parse")
async def parse(me: Me, files: Annotated[list[UploadFile], File()], password: Annotated[str, Form()] = ""):
    if not files or len(files) > MAX_FILES:
        raise HTTPException(422, f"Upload 1 to {MAX_FILES} files.")
    blobs: list[tuple[str, bytes]] = []
    for f in files:
        b = await f.read()
        if len(b) > MAX_BYTES:
            raise HTTPException(422, f"{f.filename}: larger than 15 MB.")
        blobs.append((f.filename or "statement.pdf", b))
    return parse_review_files(blobs, password=password)


@router.post("/analyze")
def analyze(body: AnalyzeIn, me: Me):
    holdings = [{
        "code": h.code, "name": h.name, "typ": h.typ, "invested": h.invested, "value": h.value,
        "from": h.from_month, "to": h.to_month, "period": h.period or _period_label(h.from_month, h.to_month),
        "inst": h.inst, "ret": h.ret, "flag": h.flag, "flows": [list(x) for x in h.flows],
    } for h in body.holdings]
    cmp_, analysis = build_analysis(holdings, body.date or date.today().isoformat(), portfolio_xirr=body.portfolio_xirr)
    return {"holdings": holdings, "compare": cmp_, "analysis": analysis}


@router.post("/pdf")
def render(review: Review, me: Me):
    return Response(_pdf(review), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{_filename(review)}"'})


@router.post("/push")
def push(body: PushIn, me: Me):
    """Store the review on the client's CRM record and (optionally) email the PDF to the client."""
    _visible_customer(body.customer_id, me)
    customer = sqlite.get_customer_by_id(body.customer_id)
    pdf, rid, now, emailed = _pdf(body.review), uuid.uuid4().hex, datetime.now(UTC).isoformat(), None
    if body.send_email:
        to = (customer.get("email") or "").strip()
        if not to or to.endswith("@placeholder.invalid"):
            raise HTTPException(422, "No email address on file for this client.")
        if _optouts().email_opted_out(body.customer_id):
            raise HTTPException(422, "This client has opted out of emails.")
        first = (customer["name"] or "").split(" ")[0] or "there"
        try:
            send_email(to, f"Your portfolio review - {body.review.client.date}",
                       f"Dear {first},\n\nPlease find attached your portfolio review as on {body.review.client.date}.\n\nRegards,\nFund Horizon",
                       [(_filename(body.review), pdf)])
        except MailerError as e:
            raise HTTPException(503 if not e.configured else 502, str(e)) from e
        emailed = now
    conn = sqlite.get_default_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            conn.execute("INSERT INTO portfolio_reviews VALUES (?,?,?,?,?,?,?,?)",
                         (rid, body.customer_id, body.review.client.date, json.dumps(body.review.model_dump()), pdf, emailed, now, me["id"]))
    finally:
        conn.close()
    get_crm_repository().create_activity(
        kind="note", subject=f"Portfolio review {body.review.client.date}" + (" (emailed)" if emailed else ""),
        body=f"Portfolio review PDF stored (id {rid}).", customer_id=body.customer_id, actor_id=me["id"])
    return {"id": rid, "emailed": bool(emailed)}


@router.get("/customers/{customer_id}")
def history(customer_id: str, me: Me):
    _visible_customer(customer_id, me)
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        rows = conn.execute("SELECT id, report_date, emailed_at, created_at FROM portfolio_reviews WHERE customer_id=? ORDER BY created_at DESC LIMIT 50", (customer_id,)).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.get("/{review_id}/pdf")
def stored_pdf(review_id: str, me: Me):
    conn = sqlite.get_default_connection()
    try:
        conn.execute(_SCHEMA)
        row = conn.execute("SELECT customer_id, pdf FROM portfolio_reviews WHERE id=?", (review_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "Review not found")
    _visible_customer(row["customer_id"], me)
    return Response(row["pdf"], media_type="application/pdf")
