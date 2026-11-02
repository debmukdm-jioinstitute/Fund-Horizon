"""Performance metrics. Reuses the existing XIRR / Modified Dietz / CAGR in ``app.backoffice.analytics.pms_math``.

Rules enforced here:
* consolidated XIRR comes from the COMBINED dated external flows plus each account's closing value on its OWN valuation date;
  provider XIRRs are never averaged;
* internal transfers (``external`` = 0) and fee/income lines are not external flows;
* a metric whose inputs are incomplete is returned as ``{"value": None, "reason": ...}`` - never estimated.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.backoffice.analytics.pms_math import calculate_cagr, calculate_modified_dietz, calculate_xirr

_ADD = {"deposit", "transfer_in"}
_OUT = {"withdrawal", "transfer_out"}


def unavailable(reason: str) -> dict[str, Any]:
    return {"value": None, "reason": reason}


def external_flows(flows: list[dict], upto: str | None = None) -> list[tuple[str, float]]:
    """(date, amount) with capital ADDED positive (Dietz convention). Fee/income and paired internal transfers are excluded."""
    out = []
    for f in flows:
        if not f.get("external", 1) or (upto and f["flow_date"] > upto):
            continue
        if f["kind"] in _ADD:
            out.append((f["flow_date"], float(f["amount"])))
        elif f["kind"] in _OUT:
            out.append((f["flow_date"], -float(f["amount"])))
    return sorted(out)


def xirr(accounts: list[dict], flows: list[dict]) -> dict[str, Any]:
    """accounts: {key, closing_value, valuation_date, flows_complete}; flows: {account_key, ...}."""
    if not accounts:
        return unavailable("No accounts.")
    incomplete = [a["key"] for a in accounts if not a.get("flows_complete")]
    if incomplete:
        return unavailable("Cash-flow history since inception is not confirmed complete for: " + ", ".join(incomplete) + ".")
    if any(not a.get("valuation_date") or a.get("closing_value") is None for a in accounts):
        return unavailable("An account has no valuation date or closing value.")
    keys = {a["key"] for a in accounts}
    cf: list[tuple[str, float]] = []
    for a in accounts:
        mine = [f for f in flows if f["account_key"] == a["key"]]
        cf += [(d, -amt) for d, amt in external_flows(mine, a["valuation_date"])]      # investor view: money in is negative
        cf.append((a["valuation_date"], float(a["closing_value"])))                       # terminal value at the account's own date
    if not {f["account_key"] for f in flows} & keys:
        return unavailable("No external cash flows.")
    r = calculate_xirr(cf)
    if r.get("xirr") is None:
        return unavailable(f"XIRR not computable ({r.get('status')}).")
    return {"value": round(r["xirr"] * 100, 4), "status": r["status"], "method": "XIRR on combined dated external flows"}


def _opening(a: dict, prev_by_key: dict[tuple, dict]) -> tuple[float | None, str | None]:
    if a.get("opening_value") is not None and a.get("period_start"):
        return float(a["opening_value"]), a["period_start"]
    p = prev_by_key.get((a["provider"], a.get("account_no")))
    if p and p.get("closing_value") is not None and p.get("valuation_date"):
        return float(p["closing_value"]), p["valuation_date"]
    return None, None


def dietz(accounts: list[dict], flows: list[dict], prev_accounts: list[dict]) -> dict[str, Any]:
    """Modified Dietz for the month. Consolidated only when every account has an opening value, the same period start and the
    same valuation date (otherwise windows differ and pooling would be wrong)."""
    prev_by_key = {(p["provider"], p.get("account_no")): p for p in prev_accounts}
    opens = [(a, *_opening(a, prev_by_key)) for a in accounts]
    if any(o is None for _, o, _s in opens):
        miss = [a["key"] for a, o, _s in opens if o is None]
        return unavailable("No opening value (statement or earlier approved snapshot) for: " + ", ".join(miss) + ".")
    if len({s for _, _o, s in opens}) != 1:
        return unavailable("Accounts have different period start dates.")
    if len({a["valuation_date"] for a in accounts}) != 1:
        return unavailable("Accounts have different valuation dates; a pooled Dietz return would mix windows.")
    start, end = opens[0][2], accounts[0]["valuation_date"]
    if end <= start:
        return unavailable("Period end is not after period start.")
    cf = [(d, amt) for a in accounts for d, amt in external_flows([f for f in flows if f["account_key"] == a["key"]], end) if d > start]
    v0 = sum((Decimal(str(o)) for _, o, _s in opens), Decimal(0))
    v1 = sum((Decimal(str(a["closing_value"])) for a in accounts), Decimal(0))
    r = calculate_modified_dietz(float(v0), float(v1), cf, start, end)
    if r.get("return_pct") is None:
        return unavailable(r.get("error") or "Not computable.")
    return {"value": r["return_pct"], "period": [start, end], "method": "Modified Dietz"}


def cagr(accounts: list[dict], flows: list[dict], prev: dict | None, min_days: int = 90) -> dict[str, Any]:
    """CAGR only for a window with no external flows and at least ``min_days`` of history; otherwise use XIRR."""
    if not prev:
        return unavailable("No earlier approved snapshot.")
    if any(date.fromisoformat(f["flow_date"]) > date.fromisoformat(prev["valuation_date"]) for f in flows if f.get("external", 1)
           and f["kind"] in _ADD | _OUT):
        return unavailable("External cash flows occurred in the window; CAGR would be misleading (see XIRR).")
    end = max(a["valuation_date"] for a in accounts if a.get("valuation_date"))
    days = (date.fromisoformat(end) - date.fromisoformat(prev["valuation_date"])).days
    if days < min_days:
        return unavailable(f"Only {days} days of history; at least {min_days} are needed.")
    v1 = sum((Decimal(str(a["closing_value"])) for a in accounts), Decimal(0))
    c = calculate_cagr(float(prev["total_value"]), float(v1), days)
    return unavailable("Not computable.") if c is None else {"value": round(c * 100, 4), "days": days, "method": "CAGR"}


def all_metrics(accounts: list[dict], flows: list[dict], prev_payload: dict | None) -> dict[str, Any]:
    prev_accounts = (prev_payload or {}).get("accounts", [])
    out = {"consolidated": {"xirr": xirr(accounts, flows), "modified_dietz": dietz(accounts, flows, prev_accounts),
                            "cagr": cagr(accounts, flows, prev_payload)}, "by_account": {}}
    for a in accounts:
        mine = [f for f in flows if f["account_key"] == a["key"]]
        out["by_account"][a["key"]] = {"xirr": xirr([a], mine), "modified_dietz": dietz([a], mine, prev_accounts)}
    return out
