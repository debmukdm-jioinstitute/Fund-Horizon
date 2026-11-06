from __future__ import annotations
"""Lumpsum investment proposal (reverse-engineered from the advisor tool 'Investment Presentation - Lumpsum').

Pure functions over the scored screener frame: risk x horizon -> category mix, scheme picks, rupee split, expected return
and future value, then the allocation / trailing / rolling / holdings tables. Rules copied from the original's client
script: the 5x5 mix grid, the small-amount category collapse (amount <= 50,000), 1 scheme per category up to a 15% share
(2 above), amounts rounded to the nearest 1,000 with the last scheme taking the remainder, portfolio return rounded to
2 decimals, future value = ceil(amount x (1 + r)^years).

Deliberate differences: scheme picks rank by the Fund Horizon score (the original uses Advisorkhoj ratings); the rolling
table uses month-end NAV; holdings tables come from the shipped portfolio-disclosure snapshot (partial coverage, shown).
"""

import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.backoffice.category_returns import nav_as_of

RISKS = ["Conservative", "Moderately Conservative", "Moderate", "Moderately Aggressive", "Aggressive"]
MIN_AMOUNT = 5000  # the original's message says Rs.5000 although its check is 1000; the stated rule is the sensible one
# Order in which the original picks schemes and, reversed, merges small-amount categories.
ORDER = ["liquid", "short", "long", "hcons", "hagg", "large", "flexi", "mid", "small", "lmc"]
# Proposal bucket -> (FH category key, label shown in the tables)
BUCKET = {
    "liquid": ("liquid", "Debt: Liquid"), "short": ("short_duration", "Debt: Short Duration"),
    "long": ("medium_long_duration", "Debt: Long Duration"), "hcons": ("conservative_hybrid", "Hybrid: Conservative"),
    "hagg": ("aggressive_hybrid", "Hybrid: Aggressive"), "large": ("large_cap", "Equity: Large Cap"),
    "flexi": ("flexi_cap", "Equity: Flexi Cap"), "mid": ("mid_cap", "Equity: Mid Cap"),
    "small": ("small_cap", "Equity: Small Cap"), "lmc": ("large_mid_cap", "Equity: Large and Mid Cap"),
}
_MERGE_ORDER = ["small", "mid", "lmc", "flexi", "large", "hagg", "hcons", "long", "short", "liquid"]
_G2 = {"liquid": 20, "short": 80}
_GRID: dict[tuple[int, int], dict[str, float]] = {}
for _r in range(1, 6):
    _GRID[(1, _r)] = _G2
_GRID.update({
    (2, 1): {"short": 40, "hcons": 40, "large": 20}, (2, 2): {"short": 40, "hagg": 40, "large": 20},
    (2, 3): {"short": 30, "hagg": 30, "large": 10, "flexi": 15, "lmc": 15},
    (2, 4): {"short": 20, "hagg": 20, "large": 20, "flexi": 20, "lmc": 20},
    (2, 5): {"short": 20, "large": 20, "flexi": 30, "lmc": 30},
    (3, 1): {"short": 20, "long": 20, "hcons": 40, "large": 20}, (3, 2): {"short": 20, "long": 20, "hagg": 40, "large": 10, "flexi": 10},
    (3, 3): {"hagg": 30, "large": 30, "mid": 10, "flexi": 15, "lmc": 15},
    (3, 4): {"hagg": 20, "large": 20, "mid": 20, "flexi": 20, "lmc": 20}, (3, 5): {"mid": 20, "small": 20, "flexi": 30, "lmc": 30},
})
_EXPECTED = json.loads((Path(__file__).resolve().parent.parent / "data" / "proposal_expected_returns.json").read_text())
GROUP_LABEL = {"Equity": "Equity Schemes", "Hybrid": "Hybrid Schemes", "Debt": "Debt Schemes",
               "Solution Oriented": "Solution Oriented Schemes", "Others": "Other Schemes"}


MODES = {"lumpsum": "Lumpsum", "lumpsum_custom": "Lumpsum Custom", "sip": "SIP", "sip_custom": "SIP Custom", "stp": "STP", "swp": "SWP", "lumpsum_sip": "Lumpsum + SIP"}
MIN_SIP = 500
_HAS_LUMP = {"lumpsum", "lumpsum_custom", "stp", "swp", "lumpsum_sip"}
_HAS_SIP = {"sip", "sip_custom", "lumpsum_sip"}


class ProposalError(ValueError):
    """Bad input; the message is safe to show to the user."""


def _band(years: float) -> int:
    return 1 if years <= 2 else 2 if years <= 4 else 3  # 3 covers 5-7y, 8-15y and 15y+ (identical rows in the original)


def validate(amount: float, years: float, risk: str | None = None) -> None:
    if not (amount >= MIN_AMOUNT):
        raise ProposalError(f"Lumpsum minimum investment amount is Rs.{MIN_AMOUNT}.")
    if not (0 < years <= 50):
        raise ProposalError("Period must be between 1 and 50 years.")
    if risk is not None and risk not in RISKS:
        raise ProposalError("Select a risk profile.")


def check(mode: str, amount: float, sip: float, withdraw: float, years: float) -> None:
    """Per-option input rules (the same messages the original tool shows for each option)."""
    if mode not in MODES:
        raise ProposalError("Select an investment option.")
    if not (0 < years <= 50):
        raise ProposalError("Period must be between 1 and 50 years.")
    if mode in _HAS_LUMP and not (amount >= MIN_AMOUNT):
        raise ProposalError(f"{'Lumpsum' if mode != 'swp' else 'Corpus'} minimum investment amount is Rs.{MIN_AMOUNT}.")
    if mode in _HAS_SIP and not (sip >= MIN_SIP):
        raise ProposalError(f"SIP minimum monthly amount is Rs.{MIN_SIP}.")
    if mode == "swp" and not (0 < withdraw <= amount):
        raise ProposalError("Enter a monthly withdrawal that is more than zero and not more than the corpus.")


def allocation(amount: float, years: float, risk: str) -> dict[str, float]:
    """Category mix in percent for the risk profile and horizon; small tickets are collapsed into fewer categories."""
    validate(amount, years, risk)
    mix = {k: float(v) for k, v in _GRID[(_band(years), RISKS.index(risk) + 1)].items()}
    keep = 1 if amount <= 10000 else 2 if amount <= 15000 else 3 if amount <= 25000 else 4 if amount <= 50000 else 99
    while len(mix) > keep:
        k = next(b for b in _MERGE_ORDER if b in mix)
        nxt = next(b for b in _MERGE_ORDER[_MERGE_ORDER.index(k) + 1:] if b in mix)
        mix[nxt] += mix.pop(k)
    return {b: mix[b] for b in ORDER if b in mix}


def expected_return(cat_key: str) -> float:
    return float(_EXPECTED.get(cat_key, 12.93))


def _spread(shares: list[float], total: float, unit: int) -> list[int]:
    """Split total by share (%), rounded to the nearest unit; the last scheme takes the remainder so rows always add up."""
    out: list[int] = []
    used = 0.0
    for i, pct in enumerate(shares):
        amt = total - used if i == len(shares) - 1 else min(math.floor(total * pct / 100 / unit + 0.5) * unit, total - used)
        used += amt
        out.append(int(round(amt)))
    return out


def source_fund(frame: pd.DataFrame, plan: str = "Regular") -> dict[str, Any]:
    """STP source: the top-scored liquid fund."""
    pool = frame[(frame["plan"] == plan) & (frame["quality"] == "ok") & (frame["cat"] == "liquid")]
    if pool.empty:
        raise ProposalError("No liquid scheme available as the STP source right now.")
    s = pool.sort_values(["fh_score", "aum_cr"], ascending=False, na_position="last").iloc[0]
    return {"code": s["code"], "name": s["name"], "category": BUCKET["liquid"][1], "exp_ret": expected_return("liquid")}


def suggest(frame: pd.DataFrame, amount: float, years: float, risk: str, plan: str = "Regular", mode: str = "lumpsum", sip: float = 0.0) -> list[dict[str, Any]]:
    """Scheme picks and the split of the lumpsum / monthly SIP. The last scheme takes the remainder so rows add up."""
    check(mode, amount, sip, 1 if mode == "swp" else 0, years)
    basis = amount if mode in _HAS_LUMP else sip * 12
    mix = allocation(basis, years, risk)
    if mode == "stp":  # liquid is the source, so the targets are the rest of the mix
        mix = {k: v for k, v in mix.items() if k != "liquid"} or {"short": 100.0}
        t = sum(mix.values())
        mix = {k: v * 100 / t for k, v in mix.items()}
    pool = frame[(frame["plan"] == plan) & (frame["quality"] == "ok")]
    picks: list[tuple[str, pd.Series, float]] = []
    for bucket, pct in mix.items():
        cat = BUCKET[bucket][0]
        top = pool[pool["cat"] == cat].sort_values(["fh_score", "aum_cr"], ascending=False, na_position="last").head(1 if pct <= 15 or basis <= 50000 else 2)
        picks += [(bucket, r, pct / len(top)) for _, r in top.iterrows()]
    if not picks:
        raise ProposalError("No schemes available for this profile right now.")
    shares = [p[2] for p in picks]
    lump = _spread(shares, amount, 1000) if mode in _HAS_LUMP else [0] * len(picks)
    sips = _spread(shares, sip, 100) if mode in _HAS_SIP else [0] * len(picks)
    return [{"code": r["code"], "name": r["name"], "category": BUCKET[b][1], "amount": lump[i], "sip": sips[i], "exp_ret": expected_return(r["cat"])} for i, (b, r, _) in enumerate(picks)]


def lookup(frame: pd.DataFrame, code: str) -> dict[str, Any]:
    """A scheme the adviser adds by hand: its name, category and the category's standard expected return."""
    hit = frame[frame["code"] == code]
    if hit.empty:
        raise ProposalError(f"Unknown scheme code {code}.")
    s = hit.iloc[0]
    return {"code": code, "name": s["name"], "category": _cat_label(s), "exp_ret": expected_return(s["cat"])}


def future_value(total: float, rate_pct: float, years: float) -> int:
    return math.ceil(round(total * (1 + rate_pct / 100) ** years, 6))


def _cat_label(r: pd.Series) -> str:
    from app.backoffice.mf_screener import CATEGORY_GROUPS
    for g, items in CATEGORY_GROUPS.items():
        for k, lbl in items:
            if k == r["cat"]:
                return f"{g}: {lbl}"
    return str(r["cat"])


def _group(r: pd.Series) -> str:
    from app.backoffice.mf_screener import CATEGORY_GROUPS
    for g, items in CATEGORY_GROUPS.items():
        if any(k == r["cat"] for k, _ in items):
            return GROUP_LABEL[g]
    return "Other Schemes"


def _num(v: Any, d: int = 2) -> float | None:
    return None if v is None or pd.isna(v) else round(float(v), d)


def _split(rows: list[dict[str, Any]], key: str, total: float) -> list[dict[str, Any]]:
    agg: dict[str, float] = {}
    for r in rows:
        agg[r[key]] = agg.get(r[key], 0) + r["amount"]
    return [{"name": k, "amount": round(v), "pct": round(v / total * 100, 2)} for k, v in sorted(agg.items())]


def _rolling(code: str, months: int = 36) -> dict[str, Any] | None:
    from app.data.loader import load_nav
    try:
        nav = load_nav(code)
    except (OSError, ValueError, KeyError):
        return None
    if len(nav) <= months:
        return None
    r = ((nav / nav.shift(months)) ** (12 / months) - 1).dropna() * 100
    if r.empty:
        return None
    b = pd.cut(r, [-np.inf, 0, 8, 12, 15, 20, np.inf], right=False)
    dist = (b.value_counts(normalize=True).reindex(b.cat.categories).fillna(0) * 100).round(2).tolist()
    return {"average": round(r.mean(), 2), "median": round(r.median(), 2), "maximum": round(r.max(), 2), "minimum": round(r.min(), 2),
            "distribution": dict(zip(["negative", "0-8", "8-12", "12-15", "15-20", ">20"], dist)), "windows": int(len(r))}


def _holdings(snapshot: dict[str, Any], rows: list[dict[str, Any]], total: float) -> dict[str, Any]:
    from app.backoffice import mf_holdings
    sector: dict[str, float] = {}
    eq: dict[str, float] = {}
    debt: dict[str, float] = {}
    covered = 0.0
    label: dict[str, tuple[str, float]] = {}
    for r in rows:
        e = mf_holdings.holdings_for_scheme(snapshot, r["code"])
        if not e or not e.get("holdings"):
            continue
        covered += r["amount"]
        f = r["amount"] / total
        for h in e["holdings"]:
            w = (h.get("weight_pct") or 0) * f
            if w <= 0 or h.get("instrument_type") == "cash":
                continue
            name = re.sub(r"(\s*[*#]+)+\s*$", "", (h.get("name") or "").strip())  # drop the disclosure footnote markers (** #)
            key = re.sub(r"\b(limited|ltd)\b|[^a-z0-9]", "", name.lower())  # "Icici Bank Limited" and "ICICI Bank Ltd." are one company
            nice = 0 if name.isupper() else sum(c.isupper() for c in name)  # prefer "ICICI Bank Ltd." over "Icici Bank Limited" or all-caps
            if key and nice > label.get(key, ("", -1))[1]:
                label[key] = (name, nice)
            name = key or name
            if h.get("instrument_type") == "equity":
                eq[name] = eq.get(name, 0) + w
                if h.get("sector"):
                    sector[h["sector"]] = sector.get(h["sector"], 0) + w
            elif h.get("instrument_type") == "debt":
                debt[name] = debt.get(name, 0) + w
    top = lambda d: [{"name": label.get(k, (k, 0))[0], "pct": round(v, 2)} for k, v in sorted(d.items(), key=lambda x: -x[1])[:10]]  # noqa: E731
    return {"sector": top(sector), "equity": top(eq), "debt": top(debt), "coverage_pct": round(covered / total * 100, 1), "as_of": snapshot.get("as_of")}


def _sip_fv(p: float, rate: float, n: int) -> float:
    i = rate / 1200  # monthly rate = annual / 12, instalment at the start of each month
    return p * n if i == 0 else p * ((1 + i) ** n - 1) / i * (1 + i)


def _project(mode: str, rows: list[dict[str, Any]], years: float, ret: float, withdraw: float, src_rate: float, upto: float | None = None) -> dict[str, Any]:
    """Maturity value and the option-specific figures after `upto` years (default: the whole period). Lumpsum compounds yearly; SIP/STP/SWP monthly."""
    n = max(1, round(years * 12))  # the STP schedule always spreads over the full period
    yrs = years if upto is None else upto
    m = n if upto is None else round(upto * 12)
    lump, sip = sum(r["amount"] for r in rows), sum(r["sip"] for r in rows)
    x: dict[str, Any] = {"invested": int(lump + sip * m)}
    if mode in ("lumpsum", "lumpsum_custom"):
        x["fv"] = future_value(lump, ret, yrs)
    elif mode in _HAS_SIP:
        x["fv"] = math.ceil(sum(r["amount"] * (1 + r["exp_ret"] / 100) ** yrs + _sip_fv(r["sip"], r["exp_ret"], m) for r in rows))
    elif mode == "stp":
        tv = [0.0] * len(rows)
        src = lump
        i_s = src_rate / 1200
        for _ in range(m):
            for k, r in enumerate(rows):
                tv[k] += r["amount"] / n
            src -= lump / n
            src *= 1 + i_s
            tv = [v * (1 + r["exp_ret"] / 1200) for v, r in zip(tv, rows)]
        x["fv"] = math.ceil(sum(tv) + max(src, 0))
    else:  # swp
        bal, out, months, i = lump, 0.0, 0, ret / 1200
        for _ in range(m):
            w = min(bal, withdraw)
            if w <= 0:
                break
            bal -= w
            out += w
            months += 1
            bal *= 1 + i
        x.update(fv=math.ceil(bal), withdrawn=int(round(out)), months=months, planned=n)
    return x


def _kpis(mode: str, lump: float, sip: float, years: float, ret: float, x: dict[str, Any], withdraw: float, src_rate: float) -> list[dict[str, Any]]:
    k = lambda label, value, fmt="inr": {"label": label, "value": value, "fmt": fmt}  # noqa: E731
    yrs, rt, fv = k("Investment period", years, "yrs"), k("Expected return", ret, "pct"), k("Expected value at maturity", x["fv"])
    if mode in ("lumpsum", "lumpsum_custom"):
        return [k("Lumpsum amount", lump), yrs, rt, fv]
    if mode in ("sip", "sip_custom"):
        return [k("Monthly SIP", sip), yrs, k("Total invested", x["invested"]), rt, fv]
    if mode == "lumpsum_sip":
        return [k("Lumpsum amount", lump), k("Monthly SIP", sip), yrs, k("Total invested", x["invested"]), rt, fv]
    if mode == "stp":
        return [k("Amount in source fund", lump), yrs, k("Target return", ret, "pct"), k("Source (liquid) return", src_rate, "pct"), k("Value at end of STP", x["fv"])]
    lasted = "Whole period" if x["months"] >= x["planned"] else f"{x['months'] / 12:.1f} years"
    return [k("Corpus", lump), k("Monthly withdrawal", withdraw), yrs, rt, k("Total withdrawn", x["withdrawn"]), k("Corpus left at end", x["fv"]), k("Withdrawals last", lasted, "text")]


def build(frame: pd.DataFrame, snapshot: dict[str, Any], years: float, rows: list[dict[str, Any]], amount: float | None = None,
          mode: str = "lumpsum", sip: float | None = None, withdraw: float = 0.0, source: str | None = None) -> dict[str, Any]:
    """Everything the proposal shows, for the scheme rows the adviser settled on (amounts, expected return editable)."""
    if mode not in MODES:
        raise ProposalError("Select an investment option.")
    if not rows:
        raise ProposalError("Add at least one scheme.")
    by_code = frame.drop_duplicates("code").set_index("code")
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)  # noqa: E731
    clean: list[dict[str, Any]] = []
    for r in rows:
        code = str(r.get("code", "")).strip()
        if code not in by_code.index:
            raise ProposalError(f"Unknown scheme code {code or '(blank)'}.")
        name = by_code.at[code, "name"]
        amt, sp, er = r.get("amount") or 0, r.get("sip") or 0, r.get("exp_ret")
        if mode in _HAS_LUMP and mode != "lumpsum_sip" and not (num(amt) and amt > 0):
            raise ProposalError(f"Enter the {'corpus' if mode == 'swp' else 'amount'} for {name}.")
        if mode in ("sip", "sip_custom") and not (num(sp) and sp > 0):
            raise ProposalError(f"Enter the monthly SIP for {name}.")
        if mode == "lumpsum_sip" and not (num(amt) and num(sp) and amt >= 0 and sp >= 0 and amt + sp > 0):
            raise ProposalError(f"Enter a lumpsum or a monthly SIP for {name}.")
        if not num(er) or not (-50 <= er <= 100):
            raise ProposalError(f"Enter the expected return (%) for {name}.")
        if any(c["code"] == code for c in clean):
            raise ProposalError(f"{name} is added twice.")
        s = by_code.loc[code]
        clean.append({"code": code, "name": name, "category": _cat_label(s), "group": _group(s), "amc": s["amc"],
                      "amount": round(float(amt)) if mode in _HAS_LUMP else 0, "sip": round(float(sp)) if mode in _HAS_SIP else 0, "exp_ret": float(er), "s": s})
    n = max(1, round(years * 12))
    for c in clean:  # weight of each scheme = the money it receives over the whole period
        c["inv"] = c["amount"] + c["sip"] * n
    total = float(sum(c["amount"] for c in clean))
    sip_total = float(sum(c["sip"] for c in clean))
    inv_total = float(sum(c["inv"] for c in clean))
    if amount is not None and mode in _HAS_LUMP and total > amount + 0.5:
        raise ProposalError("Total investment amount exceeds the proposal amount.")
    if sip is not None and mode in _HAS_SIP and sip_total > sip + 0.5:
        raise ProposalError("Total monthly SIP exceeds the proposal SIP amount.")
    check(mode, total, sip_total, withdraw, years)
    ret = round(sum(c["exp_ret"] * c["inv"] / inv_total for c in clean), 2)
    src = None
    src_rate = 0.0
    if mode == "stp":
        src = source_fund(frame) if not source else {**lookup(frame, source)}
        src_rate = src["exp_ret"]
    proj = _project(mode, clean, years, ret, withdraw, src_rate)
    pts = sorted({*range(int(years) + 1), years})  # year-by-year path for the growth chart
    curve = []
    for y in pts:
        q = _project(mode, clean, years, ret, withdraw, src_rate, y)
        curve.append({"year": y, "invested": q["invested"] if mode in _HAS_SIP else int(total), "value": q["fv"]})
    schemes = []
    for c in clean:
        s = c["s"]
        schemes.append({"code": c["code"], "name": c["name"], "category": c["category"], "amc": c["amc"], "amount": c["amount"], "exp_ret": c["exp_ret"],
                        "sip": c["sip"], "alloc_pct": round(c["inv"] / inv_total * 100, 2), "ret_1y": _num(s["ret_1y"]), "ret_3y": _num(s["cagr_3y"]), "ret_5y": _num(s["cagr_5y"])})
    trailing = []
    for c in clean:
        s = c["s"]
        peers = frame[(frame["cat"] == s["cat"]) & (frame["plan"] == s["plan"])]
        row = {"code": c["code"], "name": c["name"], "category": c["category"], "aum_cr": _num(s["aum_cr"], 0), "ter": _num(s["ter"]), "peers": int(len(peers)),
               "avg": {}, "returns": {}, "rank": {}}
        for k, col in (("1y", "ret_1y"), ("3y", "cagr_3y"), ("5y", "cagr_5y"), ("10y", "cagr_10y")):
            v = _num(s[col])
            row["returns"][k] = v
            row["avg"][k] = _num(peers[col].mean())
            have = peers[col].dropna()
            row["rank"][k] = int((have > s[col]).sum() + 1) if v is not None else None
            row["rank"][k + "_of"] = int(len(have)) if v is not None else None
        trailing.append(row)
    rolling = []
    for c in clean:
        if c["group"] in ("Equity Schemes", "Hybrid Schemes"):
            x = _rolling(c["code"])
            if x:
                rolling.append({"code": c["code"], "name": c["name"], "category": c["category"], **x})
    flat = [{**{k: v for k, v in c.items() if k != "s"}, "amount": c["inv"]} for c in clean]
    return {
        "mode": mode, "title": MODES[mode], "amount": int(total), "sip": int(sip_total), "invested": proj["invested"], "years": years, "expected_return": ret,
        "future_value": proj["fv"], "curve": curve, "kpis": _kpis(mode, total, sip_total, years, ret, proj, withdraw, src_rate), "source": src,
        "schemes": schemes, "trailing": trailing, "rolling": rolling,
        "amc": _split(flat, "amc", inv_total), "category": _split(flat, "category", inv_total), "asset": _split(flat, "group", inv_total),
        "holdings": _holdings(snapshot, flat, inv_total),
        "notes": {"nav_as_of": nav_as_of(frame), "rolling": "3-year rolling returns on month-end NAV, annualised.",
                  "returns": "Returns under 1 year are absolute; over 1 year are annualised (CAGR). Past performance may not be sustained."},
    }
