"""Consolidation: combine reconciled accounts/holdings/flows into one payload (the content of an approved snapshot).
Decimal arithmetic throughout; accounts are never merged, holdings are never merged by name across accounts."""
from __future__ import annotations

import json
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.backoffice.valuation import performance
from app.backoffice.valuation.validation import D

Q2 = Decimal("0.01")


def r2(v: Decimal | None) -> float | None:
    return None if v is None else float(v.quantize(Q2, rounding=ROUND_HALF_UP))


def _pct(part: Decimal, whole: Decimal) -> float | None:
    return None if not whole else float((part / whole * 100).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def account_key(provider: str, account_no: str | None) -> str:
    return f"{provider}:{account_no or 'unknown'}"


def consolidate(batch: dict, accounts: list[dict], holdings: list[dict], flows: list[dict], files: list[dict],
                prev: dict | None, recon_summary: dict) -> dict[str, Any]:
    """accounts: ValAccount rows as dicts (closing_value/value_basis set by reconciliation). holdings/flows: row dicts with
    account_id. Returns a JSON-serialisable payload; every report figure comes from here."""
    by_id = {a["id"]: a for a in accounts}
    acc_out: list[dict] = []
    perf_accounts: list[dict] = []
    for a in accounts:
        hs = [h for h in holdings if h["account_id"] == a["id"]]
        mv = sum((D(h["market_value"]) or Decimal(0) for h in hs), Decimal(0))
        cost_known = bool(hs) and all(h["invested_amount"] is not None for h in hs)
        cost = sum((D(h["invested_amount"]) for h in hs), Decimal(0)) if cost_known else None
        invested = cost if a["asset_class"] == "mutual_fund" else (D(a["provider_total_invested"]))
        closing = D(a["closing_value"])
        cash_added = closing - mv if closing is not None and a["value_basis"] == "holdings_plus_cash" else Decimal(0)
        acc_out.append({
            "id": a["id"], "key": account_key(a["provider"], a["account_no"]), "provider": a["provider"], "account_no": a["account_no"],
            "asset_class": a["asset_class"], "valuation_date": a["valuation_date"], "statement_date": a["statement_date"],
            "period_start": a["period_start"], "closing_value": r2(closing), "holdings_value": r2(mv), "cash_added": r2(cash_added),
            "holdings_cost": r2(cost), "invested": r2(invested), "unrealised_gain": r2(mv - cost) if cost is not None else None,
            "realised_gain": a["realised_gain"], "income": a["income"], "opening_value": a["opening_value"],
            "value_basis": a["value_basis"], "flows_complete": bool(a["flows_complete"]), "source_file_id": a["source_file_id"],
            "holdings_count": len(hs),
        })
        perf_accounts.append({"key": acc_out[-1]["key"], "provider": a["provider"], "account_no": a["account_no"],
                              "closing_value": acc_out[-1]["closing_value"], "valuation_date": a["valuation_date"],
                              "flows_complete": bool(a["flows_complete"]), "opening_value": a["opening_value"],
                              "period_start": a["period_start"]})
    total = sum((D(a["closing_value"]) or Decimal(0) for a in acc_out), Decimal(0))
    unavailable: dict[str, str] = {}

    inv_vals = [D(a["invested"]) for a in acc_out]
    if acc_out and all(v is not None for v in inv_vals):
        invested = sum(inv_vals, Decimal(0))
        gain = total - invested
        abs_ret = _pct(gain, invested)
    else:
        invested = gain = abs_ret = None
        miss = [a["key"] for a in acc_out if a["invested"] is None]
        unavailable["invested"] = "Invested amount not reported for: " + ", ".join(miss)
    ug = [D(a["unrealised_gain"]) for a in acc_out]
    unreal = sum(ug, Decimal(0)) if acc_out and all(v is not None for v in ug) else None
    if unreal is None:
        unavailable["unrealised_gain"] = "Cost not reported for every holding."
    rg = [D(a["realised_gain"]) for a in acc_out]
    real = sum(rg, Decimal(0)) if acc_out and all(v is not None for v in rg) else None
    if real is None:
        unavailable["realised_gain"] = "Realised gain not reported by every provider."

    alloc: dict[str, Decimal] = {}
    for h in holdings:
        alloc[h["asset_type"]] = alloc.get(h["asset_type"], Decimal(0)) + (D(h["market_value"]) or Decimal(0))
    cash_extra = sum((D(a["cash_added"]) or Decimal(0) for a in acc_out), Decimal(0))
    if cash_extra:
        alloc["cash"] = alloc.get("cash", Decimal(0)) + cash_extra
    allocation = [{"asset_type": k, "value": r2(v), "pct": _pct(v, total)} for k, v in sorted(alloc.items(), key=lambda kv: -kv[1])]

    prov: dict[str, dict] = {}
    for a in acc_out:
        p = prov.setdefault(a["provider"], {"provider": a["provider"], "value": Decimal(0), "invested": Decimal(0), "inv_ok": True,
                                            "accounts": 0, "valuation_dates": set()})
        p["value"] += D(a["closing_value"]) or Decimal(0)
        p["accounts"] += 1
        p["valuation_dates"].add(a["valuation_date"])
        if a["invested"] is None:
            p["inv_ok"] = False
        else:
            p["invested"] += D(a["invested"])
    provider_contribution = [{"provider": p["provider"], "value": r2(p["value"]), "pct": _pct(p["value"], total),
                              "invested": r2(p["invested"]) if p["inv_ok"] else None,
                              "gain": r2(p["value"] - p["invested"]) if p["inv_ok"] else None, "accounts": p["accounts"],
                              "valuation_dates": sorted(d for d in p["valuation_dates"] if d)} for p in prov.values()]

    prev_idx = {(h["provider"], h.get("account_no"), h.get("isin") or h["security_name"].lower()): h for h in (prev or {}).get("holdings", [])}
    h_out = []
    for h in holdings:
        a = by_id[h["account_id"]]
        key = (a["provider"], a["account_no"], h["isin"] or h["security_name"].lower())
        ph = prev_idx.get(key)
        h_out.append({**{k: h[k] for k in ("provider", "asset_type", "security_name", "isin", "quantity", "avg_cost", "invested_amount",
                                           "price", "market_value", "unrealised_gain", "realised_gain", "income", "source_page", "source_row",
                                           "validation_status", "source_file_id")},
                      "account_no": a["account_no"], "weight_pct": _pct(D(h["market_value"]) or Decimal(0), total),
                      "gain": r2(D(h["market_value"]) - D(h["invested_amount"])) if h["market_value"] is not None and h["invested_amount"] is not None else None,
                      "prev_market_value": ph["market_value"] if ph else None})

    flows_out = [{**f, "account_key": account_key(by_id[f["account_id"]]["provider"], by_id[f["account_id"]]["account_no"])} for f in flows]
    net_ext = sum((Decimal(str(amt)) for _d, amt in performance.external_flows(flows_out)), Decimal(0))
    metrics = performance.all_metrics(perf_accounts, flows_out, prev)

    mom = None
    if prev:
        pv = Decimal(str(prev["totals"]["total_value"]))
        pprov = {p["provider"]: Decimal(str(p["value"])) for p in prev.get("provider_contribution", [])}
        mom = {"previous_month": prev["report_month"], "previous_valuation_date": prev["valuation_date"], "previous_total": float(pv),
               "change": r2(total - pv), "change_pct": _pct(total - pv, pv), "net_external_flows": r2(net_ext),
               "market_and_other_change": r2(total - pv - net_ext),
               "by_provider": [{"provider": p["provider"], "value": p["value"], "previous": float(pprov[p["provider"]]) if p["provider"] in pprov else None,
                                "change": r2(Decimal(str(p["value"])) - pprov[p["provider"]]) if p["provider"] in pprov else None}
                               for p in provider_contribution]}

    return {
        "schema": 1, "client_id": batch["client_id"], "report_month": batch["report_month"], "valuation_date": batch["valuation_date"],
        "revision_no": batch["revision_no"],
        "totals": {"total_value": r2(total), "invested": r2(invested), "gain": r2(gain), "absolute_return_pct": abs_ret,
                   "unrealised_gain": r2(unreal), "realised_gain": r2(real), "net_external_flows": r2(net_ext)},
        "unavailable": unavailable, "accounts": acc_out, "holdings": h_out, "flows": flows_out,
        "allocation": allocation, "provider_contribution": provider_contribution, "performance": metrics, "month_on_month": mom,
        "valuation_dates": sorted({a["valuation_date"] for a in acc_out if a["valuation_date"]}),
        "sources": [{k: f[k] for k in ("id", "filename", "sha256", "provider", "statement_date", "adapter_version")} for f in files],
        "reconciliation": recon_summary,
    }


def reported_block(files: list[dict], acc_out: list[dict], dashboard: dict | None) -> dict[str, Any]:
    """Figures PRINTED by providers (XIRR / IRR, distributor dashboard). Shown with their source, never mixed with computed metrics.
    The dashboard's latest-year value is cross-checked against the statements of the same bundle; a gap is reported, not hidden."""
    stmt, holding = [], []
    for f in files:
        rep = (json.loads(f["totals_json"] or "{}").get("meta") or {}).get("reported") or {}
        if rep.get("xirr") is not None:
            stmt.append({"provider": f["provider"], "source": f["filename"], "xirr_pct": rep["xirr"], "basis": "XIRR printed in the provider report"})
        if p := rep.get("pms"):
            stmt.append({"provider": f["provider"], "source": f["filename"], "xirr_pct": p.get("irr_since_inception"), "strategy": p.get("strategy"),
                         "account_no": p.get("account_no"), "since": p.get("inception"),
                         "basis": "Strategy IRR since inception printed in the PMS factsheet (after fees and expenses)"})
        holding += [{**h, "provider": f["provider"]} for h in rep.get("holding_xirr", [])]
    out: dict[str, Any] = {"statement_xirr": stmt, "holding_xirr": holding, "dashboard": None}
    if dashboard and dashboard.get("years"):
        last = dashboard["years"][-1]
        bundle_ids = {f["id"] for f in files if (f.get("detect_note") or "").startswith("section of")}
        mine = [a for a in acc_out if a["source_file_id"] in bundle_ids and a["closing_value"] is not None]
        statements_total = sum((Decimal(str(a["closing_value"])) for a in mine), Decimal(0))
        out["dashboard"] = {**{k: dashboard.get(k) for k in ("since_inception_xirr", "xirr_by_class", "net_investment", "from", "to")},
                            "latest_fy": last["fy"], "latest_value": last["value"], "statements_total": r2(statements_total),
                            "difference": r2(statements_total - Decimal(last["value"])),
                            "difference_pct": _pct(statements_total - Decimal(last["value"]), Decimal(last["value"])),
                            "xirr_basis": "XIRR printed in the distributor dashboard; Fund Horizon does not recompute it (no dated transactions in the statements)"}
    return out
