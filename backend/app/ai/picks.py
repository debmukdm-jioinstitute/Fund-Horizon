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

SYSTEM = (
    "You pick mutual funds for an Indian investor from a fixed list. Use ONLY the scheme_code values in "
    "candidates. Pick 3 to 6 funds and give each a weight_pct; weights must total exactly 100. Spread across "
    "categories to fit the investor's risk band and asset allocation, and take the market context into account. "
    "Write one short reason per fund in plain words with NO digits. Never use the words best, guaranteed, advice, "
    "advisory, recommend or suggested. Reply with a JSON object: "
    '{"picks":[{"scheme_code":"","weight_pct":0,"reason":""}],"market_note":""} where market_note is one '
    "sentence about how the market context shaped the picks, with no digits."
)


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


def generate(plan: dict, conn: sqlite3.Connection) -> dict[str, Any]:
    cands = candidates()
    by_code = {c["scheme_code"]: c for c in cands}
    alloc = plan.get("allocation", {})
    profile = plan.get("profile", {})
    payload = {
        "risk_band": profile.get("band"),
        "asset_allocation_pct": alloc.get("by_asset_class"),
        "data_as_of": plan.get("data_asof"),
        "market_context": market_context(conn),
        "candidates": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in c.items() if k != "scheme_name"} | {"name": c["scheme_name"]} for c in cands],
    }
    ai = call_openai_json(SYSTEM, "Plan data (JSON):\n" + json.dumps(payload, default=str))
    picks, note, ai_ok = None, "", False
    if ai:
        try:
            picks = validate_weights(ai.get("picks") or [], set(by_code))
            note = str(ai.get("market_note") or "")
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
    return {"picks": picks, "market_note": note, "ai_generated": ai_ok, "notice": append_statutory_disclosures("").strip("- \n")}
