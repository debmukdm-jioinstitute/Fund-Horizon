from __future__ import annotations
"""AI fund picks for a finished plan, restricted to the FH Recommended list.

The model only chooses weights and writes one qualitative reason per fund. Everything it returns is validated:
codes must be on the FH list, weights must total 100, and a reason with digits or banned wording is replaced by a
template built from the fund's own numbers. With no key or a bad answer the picks come from a fixed rule instead.
"""

import json
import math
import re
import sqlite3
from typing import Any

from app.ai.client import call_openai_json
from app.ai.guardrails import append_statutory_disclosures, scan_banned_wording
from app.backoffice.fh_recommended import FH_RECOMMENDED_MF_CODES
from app.data.loader import load_metrics

MAX_PICKS = 6
_FIELDS = ("ret_1y", "cagr_3y", "cagr_5y", "vol_3y", "sharpe_3y", "max_drawdown_3y")

# Token budget: short prompt, a few strong candidates as compact rows, short array output, capped length, cached by profile.
SYSTEM = (
    "Pick 3-6 funds for an Indian investor using ONLY the candidate codes. Weights total 100. Fit the risk band, "
    "allocation and market. Reply JSON only: "
    '{"p":[["code",weight,"reason of at most 8 words, no digits"]],"m":"one short sentence on the market, no digits"}. '
    "Never use the words best, guaranteed, advice, advisory, recommend, suggested."
)
PER_CATEGORY = 2
MAX_OUTPUT_TOKENS = 1200
_CACHE: dict[str, dict] = {}


def _num(v: Any) -> float | None:
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)


def candidates() -> list[dict[str, Any]]:
    df = load_metrics()
    codes = set(FH_RECOMMENDED_MF_CODES)
    out = []
    for r in df[df["scheme_code"].isin(codes)].to_dict("records"):
        out.append({
            "scheme_code": r["scheme_code"], "scheme_name": r["scheme_name"], "category": r["category"],
            "cat": r["cat"], **{k: _num(r.get(k)) for k in _FIELDS},
        })
    return out


def market_context(conn: sqlite3.Connection) -> list[str]:
    try:
        row = conn.execute("SELECT payload_json FROM briefings ORDER BY brief_date DESC LIMIT 1").fetchone()
        sections = json.loads(row[0]).get("sections", []) if row else []
        return [i["text"] for s in sections if s.get("key") == "market_pulse" for i in s.get("items", [])][:6]
    except (sqlite3.Error, ValueError, KeyError, TypeError):
        return []


def _template_reason(c: dict) -> str:
    bits = []
    if c["cagr_5y"] is not None:
        bits.append(f"5Y CAGR {c['cagr_5y'] * 100:.1f}%")
    if c["sharpe_3y"] is not None:
        bits.append(f"3Y Sharpe {c['sharpe_3y']:.2f}")
    return f"{c['category']}; " + ", ".join(bits) if bits else str(c["category"])


def _rule_picks(cands: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for c in cands:
        if c["sharpe_3y"] is not None and c["sharpe_3y"] > (best.get(c["cat"], {}).get("sharpe_3y") or -1e9):
            best[c["cat"]] = c
    chosen = sorted(best.values(), key=lambda c: -c["sharpe_3y"])[:5]
    return [{"scheme_code": c["scheme_code"], "weight_pct": 0.0, "reason": ""} for c in chosen]


def _normalise(picks: list[dict]) -> list[dict]:
    total = sum(p["weight_pct"] for p in picks)
    out = [{**p, "weight_pct": round(p["weight_pct"] * 100 / total, 1)} for p in picks]
    out[0]["weight_pct"] = round(out[0]["weight_pct"] + 100 - sum(p["weight_pct"] for p in out), 1)
    return out


def validate_weights(picks: list[dict], allowed: set[str]) -> list[dict]:
    """Raise ValueError unless picks are 1..MAX_PICKS distinct FH-list funds with weights totalling 100."""
    codes = [p.get("scheme_code") for p in picks]
    if not 1 <= len(picks) <= MAX_PICKS or len(set(codes)) != len(codes):
        raise ValueError(f"choose between 1 and {MAX_PICKS} different funds")
    if any(c not in allowed for c in codes):
        raise ValueError("only FH Recommended funds can be chosen")
    try:
        w = [float(p["weight_pct"]) for p in picks]
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError("each fund needs a numeric weight") from e
    if any(x <= 0 or x > 100 or math.isnan(x) for x in w) or abs(sum(w) - 100) > 0.05:
        raise ValueError("weights must be positive and total 100")
    return [{**p, "weight_pct": float(p["weight_pct"])} for p in picks]


def shortlist(cands: list[dict]) -> list[dict]:
    """Strongest PER_CATEGORY funds by 3Y Sharpe in each category; funds without history are left out."""
    ok = [c for c in cands if c["sharpe_3y"] is not None and c["cagr_5y"] is not None]
    out: list[dict] = []
    for cat in sorted({c["cat"] for c in ok}):
        out += sorted((c for c in ok if c["cat"] == cat), key=lambda c: -c["sharpe_3y"])[:PER_CATEGORY]
    return out or cands


def _parse(ai: dict | None) -> list[dict] | None:
    try:
        return [{"scheme_code": str(r[0]), "weight_pct": float(r[1]), "reason": str(r[2])} for r in ai["p"]]
    except (TypeError, KeyError, IndexError, ValueError):
        return None


def generate(plan: dict, conn: sqlite3.Connection) -> dict[str, Any]:
    cands = candidates()
    by_code = {c["scheme_code"]: c for c in cands}
    alloc = plan.get("allocation", {}).get("by_asset_class")
    band = plan.get("profile", {}).get("band")
    key = json.dumps([band, {k: round(float(v) / 5) * 5 for k, v in (alloc or {}).items()}, plan.get("data_asof")], sort_keys=True)
    if key in _CACHE:
        return _CACHE[key]
    short = shortlist(cands)
    rows = [[c["scheme_code"], c["cat"], *(round(c[k], 3) if c[k] is not None else None for k in ("cagr_5y", "sharpe_3y", "vol_3y", "max_drawdown_3y"))] for c in short]
    payload = {
        "band": band, "alloc": alloc, "asof": plan.get("data_asof"),
        "market": [m[:70] for m in market_context(conn)[:4]],
        "cols": "code,cat,cagr5y,sharpe3y,vol3y,maxdd3y", "cands": rows,
    }
    ai = call_openai_json(SYSTEM, json.dumps(payload, separators=(",", ":"), default=str), MAX_OUTPUT_TOKENS)
    picks, note, ai_ok = None, "", False
    parsed = _parse(ai)
    if parsed:
        try:
            picks = validate_weights(parsed, {c["scheme_code"] for c in short})
            note = str((ai or {}).get("m") or "")
            ai_ok = True
        except ValueError:
            picks = None
    if picks is None:
        picks = _normalise([{**p, "weight_pct": 1.0} for p in _rule_picks(cands)]) if cands else []
    for p in picks:
        reason = str(p.get("reason") or "")
        if not ai_ok or re.search(r"\d", reason) or not scan_banned_wording(reason) or not reason.strip():
            reason = _template_reason(by_code[p["scheme_code"]])
        p["reason"] = reason
    if re.search(r"\d", note) or not scan_banned_wording(note):
        note = ""
    out = {"picks": picks, "market_note": note, "ai_generated": ai_ok, "notice": append_statutory_disclosures("").strip("- \n")}
    if ai_ok:  # a rule fallback is not cached, so the next request can try the model again
        _CACHE[key] = out
    return out
