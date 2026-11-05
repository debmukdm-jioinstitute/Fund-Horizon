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


def _round1000(x: float) -> float:
    return math.floor(x / 1000 + 0.5) * 1000


def suggest(frame: pd.DataFrame, amount: float, years: float, risk: str, plan: str = "Regular") -> list[dict[str, Any]]:
    """Scheme picks and rupee split. The last scheme takes the remainder so the rows always add up to the amount."""
    mix = allocation(amount, years, risk)
    pool = frame[(frame["plan"] == plan) & (frame["quality"] == "ok")]
    picks: list[tuple[str, pd.Series, float]] = []
    for bucket, pct in mix.items():
        cat = BUCKET[bucket][0]
        top = pool[pool["cat"] == cat].sort_values(["fh_score", "aum_cr"], ascending=False, na_position="last").head(1 if pct <= 15 or amount <= 50000 else 2)
        picks += [(bucket, r, pct / len(top)) for _, r in top.iterrows()]
    if not picks:
        raise ProposalError("No schemes available for this profile right now.")
    out: list[dict[str, Any]] = []
    used = 0.0
    for i, (bucket, r, pct) in enumerate(picks):
        amt = amount - used if i == len(picks) - 1 else min(_round1000(amount * pct / 100), amount - used)
        used += amt
        out.append({"code": r["code"], "name": r["name"], "category": BUCKET[bucket][1], "amount": int(round(amt)), "exp_ret": expected_return(r["cat"])})
    return out


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
            name = (h.get("name") or "").strip()
            if h.get("instrument_type") == "equity":
                eq[name] = eq.get(name, 0) + w
                if h.get("sector"):
                    sector[h["sector"]] = sector.get(h["sector"], 0) + w
            elif h.get("instrument_type") == "debt":
                debt[name] = debt.get(name, 0) + w
    top = lambda d: [{"name": k, "pct": round(v, 2)} for k, v in sorted(d.items(), key=lambda x: -x[1])[:10]]  # noqa: E731
    return {"sector": top(sector), "equity": top(eq), "debt": top(debt), "coverage_pct": round(covered / total * 100, 1), "as_of": snapshot.get("as_of")}


def build(frame: pd.DataFrame, snapshot: dict[str, Any], years: float, rows: list[dict[str, Any]], amount: float | None = None) -> dict[str, Any]:
    """Everything the proposal shows, for the scheme rows the adviser settled on (amount, expected return editable)."""
    if not rows:
        raise ProposalError("Add at least one scheme.")
    by_code = frame.drop_duplicates("code").set_index("code")
    clean: list[dict[str, Any]] = []
    for r in rows:
        code = str(r.get("code", "")).strip()
        if code not in by_code.index:
            raise ProposalError(f"Unknown scheme code {code or '(blank)'}.")
        amt, er = r.get("amount"), r.get("exp_ret")
        if not isinstance(amt, (int, float)) or isinstance(amt, bool) or not (amt > 0) or not math.isfinite(amt):
            raise ProposalError(f"Enter an amount for {by_code.at[code, 'name']}.")
        if not isinstance(er, (int, float)) or isinstance(er, bool) or not (-50 <= er <= 100):
            raise ProposalError(f"Enter the expected return (%) for {by_code.at[code, 'name']}.")
        if any(c["code"] == code for c in clean):
            raise ProposalError(f"{by_code.at[code, 'name']} is added twice.")
        s = by_code.loc[code]
        clean.append({"code": code, "name": s["name"], "category": _cat_label(s), "group": _group(s),
                      "amc": s["amc"], "amount": round(float(amt)), "exp_ret": float(er), "s": s})
    total = float(sum(c["amount"] for c in clean))
    if amount is not None and total > amount + 0.5:
        raise ProposalError("Total investment amount exceeds the proposal amount.")
    ret = round(sum(c["exp_ret"] * c["amount"] / total for c in clean), 2)
    schemes = []
    for c in clean:
        s = c["s"]
        schemes.append({"code": c["code"], "name": c["name"], "category": c["category"], "amc": c["amc"], "amount": c["amount"], "exp_ret": c["exp_ret"],
                        "alloc_pct": round(c["amount"] / total * 100, 2), "ret_1y": _num(s["ret_1y"]), "ret_3y": _num(s["cagr_3y"]), "ret_5y": _num(s["cagr_5y"])})
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
    flat = [{k: v for k, v in c.items() if k != "s"} for c in clean]
    return {
        "amount": int(total), "years": years, "expected_return": ret, "future_value": future_value(total, ret, years),
        "schemes": schemes, "trailing": trailing, "rolling": rolling,
        "amc": _split(flat, "amc", total), "category": _split(flat, "category", total), "asset": _split(flat, "group", total),
        "holdings": _holdings(snapshot, flat, total),
        "notes": {"nav_as_of": nav_as_of(frame), "rolling": "3-year rolling returns on month-end NAV, annualised.",
                  "returns": "Returns under 1 year are absolute; over 1 year are annualised (CAGR). Past performance may not be sustained."},
    }
