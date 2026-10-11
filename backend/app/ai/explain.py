"""Explanation layer: transforms structured engine outputs into clear educational narratives."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from app.ai.client import call_llm
from app.ai.guardrails import (
    append_statutory_disclosures,
    extract_numbers_from_payload,
    scan_banned_wording,
    scrub_pii,
    verify_number_consistency,
)

# In-memory response cache to minimize duplicate LLM calls
_EXPLANATION_CACHE: dict[str, dict[str, Any]] = {}


def _cache_key(kind: str, data: Any) -> str:
    raw = json.dumps({"kind": kind, "data": data}, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def explain_plan(plan_data: dict[str, Any]) -> dict[str, Any]:
    """Explain a financial plan's allocation, goal SIPs, and stress test."""
    ck = _cache_key("plan", plan_data)
    if ck in _EXPLANATION_CACHE:
        return _EXPLANATION_CACHE[ck]

    # Deterministic fallback template
    profile = plan_data.get("profile", {})
    band = profile.get("band", "Moderate")
    cap = profile.get("capacity")
    if profile.get("capacity_band"):
        capacity = profile["capacity_band"]
    elif isinstance(cap, dict) and cap.get("score") is not None:
        capacity = f"{cap['score']:.0f} out of 100"
    else:
        capacity = band
    planning = plan_data.get("planning") or {}
    totals = planning.get("totals") or {}
    goals = plan_data.get("goals") or planning.get("goals") or []
    sip_total = plan_data.get("total_monthly_sip", totals.get("allocated_sip", 0))
    surplus = profile.get("monthly_surplus", totals.get("monthly_surplus", 0))

    fallback_lines = [
        f"### Summary of Your Financial Plan ({band} Profile)",
        "",
        f"- **Risk Profile:** Your risk capacity is **{capacity}** and your target allocation profile is **{band}**.",
        f"- **Goal Sizing:** We calculated plans for **{len(goals)}** goal(s).",
        f"- **Monthly Investment:** Target monthly SIP is **₹{sip_total:,}** (from an estimated monthly surplus of **₹{surplus:,}**).",
    ]
    for g in goals:
        name = g.get("name", "Goal")
        amt = g.get("target_future_rupees", g.get("future_cost", 0))
        sip = g.get("monthly_sip", g.get("allocated_sip", 0))
        prob = g.get("success_probability_base", (g.get("monte_carlo") or {}).get("success_prob", 0.5))
        fallback_lines.append(
            f"  - **{name}:** Projected target ₹{amt:,} with a target SIP of ₹{sip:,} (historical base success rate: {prob*100:.0f}%)."
        )

    fallback_lines.append("")
    fallback_lines.append(
        "Illustrative asset allocation spreads your savings across equity, debt, and liquid funds according to your horizon."
    )
    fallback_text = append_statutory_disclosures("\n".join(fallback_lines))

    # Attempt LLM explanation
    clean_data = scrub_pii(plan_data)
    prompt = f"Please explain this financial plan payload simply to the investor:\n{json.dumps(clean_data, default=str)}"
    llm_out, provider = call_llm(prompt)

    final_text = fallback_text
    ai_generated = False

    if llm_out:
        payload_numbers = extract_numbers_from_payload(clean_data)
        numbers_valid = verify_number_consistency(llm_out, payload_numbers)
        wording_valid = scan_banned_wording(llm_out)

        if numbers_valid and wording_valid:
            final_text = append_statutory_disclosures(llm_out)
            ai_generated = True

    res = {
        "kind": "plan",
        "explanation": final_text,
        "ai_generated": ai_generated,
        "provider": provider if ai_generated else "deterministic_template",
    }
    _EXPLANATION_CACHE[ck] = res
    return res


def explain_fund(fund_data: dict[str, Any]) -> dict[str, Any]:
    """Explain a fund's historical performance, volatility, and capture characteristics."""
    ck = _cache_key("fund", fund_data)
    if ck in _EXPLANATION_CACHE:
        return _EXPLANATION_CACHE[ck]

    name = fund_data.get("scheme_name", "Scheme")
    code = fund_data.get("scheme_code", "")
    amc = fund_data.get("amc", "")
    cat = fund_data.get("category", "")
    ret_1y = fund_data.get("ret_1y")
    cagr_3y = fund_data.get("cagr_3y")
    cagr_5y = fund_data.get("cagr_5y")
    vol_3y = fund_data.get("vol_3y")
    sharpe_3y = fund_data.get("sharpe_3y")

    def f_pct(v):
        return f"{v*100:.2f}%" if v is not None else "N/A"

    def f_num(v):
        return f"{v:.2f}" if v is not None else "N/A"

    fallback_lines = [
        f"### Performance Overview: {name} (Code: {code})",
        "",
        f"- **AMC & Category:** {amc} | {cat}",
        f"- **Historical Trailing Returns:** 1-Year: {f_pct(ret_1y)} | 3-Year CAGR: {f_pct(cagr_3y)} | 5-Year CAGR: {f_pct(cagr_5y)}",
        f"- **Risk & Volatility (3Y):** Annualised Volatility: {f_pct(vol_3y)} | Sharpe Ratio: {f_num(sharpe_3y)}",
        "",
        "Trailing returns over 1 year are compound annual growth rates. Higher Sharpe ratios indicate better risk-adjusted return relative to volatility.",
    ]
    fallback_text = append_statutory_disclosures("\n".join(fallback_lines))

    clean_data = scrub_pii(fund_data)
    prompt = f"Please explain these mutual fund metrics simply:\n{json.dumps(clean_data, default=str)}"
    llm_out, provider = call_llm(prompt)

    final_text = fallback_text
    ai_generated = False

    if llm_out:
        payload_numbers = extract_numbers_from_payload(clean_data)
        if verify_number_consistency(llm_out, payload_numbers) and scan_banned_wording(llm_out):
            final_text = append_statutory_disclosures(llm_out)
            ai_generated = True

    res = {
        "kind": "fund",
        "explanation": final_text,
        "ai_generated": ai_generated,
        "provider": provider if ai_generated else "deterministic_template",
    }
    _EXPLANATION_CACHE[ck] = res
    return res


def explain_cas(cas_data: dict[str, Any]) -> dict[str, Any]:
    """Explain a CAS statement analysis: XIRR, asset allocation, and direct vs regular mix."""
    ck = _cache_key("cas", cas_data)
    if ck in _EXPLANATION_CACHE:
        return _EXPLANATION_CACHE[ck]

    tot = cas_data.get("total_value", 0)
    xirr = cas_data.get("overall_xirr")
    dr = cas_data.get("plan_breakdown", {})
    direct_pct = dr.get("direct", {}).get("pct", 0)
    reg_pct = dr.get("regular", {}).get("pct", 0)
    folios = cas_data.get("folios_count", 0)
    holdings = cas_data.get("holdings_count", 0)

    xirr_str = f"{xirr*100:.2f}%" if xirr is not None else "N/A"

    fallback_lines = [
        "### CAS Portfolio Analysis Summary",
        "",
        f"- **Valuation & Folios:** Total portfolio value of **₹{tot:,.0f}** across **{folios}** folio(s) and **{holdings}** scheme holding(s).",
        f"- **Historical Return (XIRR):** Computed overall portfolio XIRR is **{xirr_str}**.",
        f"- **Plan Mix:** Direct plans account for **{direct_pct:.1f}%** and Regular plans account for **{reg_pct:.1f}%**.",
        "",
        "Regular plans include distributor commissions paid out of scheme expenses, whereas Direct plans have lower expense ratios.",
    ]
    fallback_text = append_statutory_disclosures("\n".join(fallback_lines))

    clean_data = scrub_pii(cas_data)
    prompt = f"Please explain this mutual fund CAS portfolio analysis:\n{json.dumps(clean_data, default=str)}"
    llm_out, provider = call_llm(prompt)

    final_text = fallback_text
    ai_generated = False

    if llm_out:
        payload_numbers = extract_numbers_from_payload(clean_data)
        if verify_number_consistency(llm_out, payload_numbers) and scan_banned_wording(llm_out):
            final_text = append_statutory_disclosures(llm_out)
            ai_generated = True

    res = {
        "kind": "cas",
        "explanation": final_text,
        "ai_generated": ai_generated,
        "provider": provider if ai_generated else "deterministic_template",
    }
    _EXPLANATION_CACHE[ck] = res
    return res


def _inr(v: float) -> str:
    from app.engine.finmath import indian_format
    return indian_format(v)


def explain_tax(tax_data: dict[str, Any], nudge_id: str | None = None) -> dict[str, Any]:
    """Explain the tax section (or one nudge) in plain English.

    The deterministic template is built only from numbers already in `tax_data`. An optional language
    model may rephrase it, but its output is used only if every number and all wording pass the
    same guardrails as the other explainers.
    """
    nudges = tax_data.get("nudges") or []
    if nudge_id:
        nudges = [n for n in nudges if n.get("id") == nudge_id]
    else:
        nudges = nudges[:3]
    payload = {**{k: tax_data.get(k) for k in ("fy", "mode", "regime_in_force", "recommended_regime", "marginal_rate")},
               "regimes": tax_data.get("regimes"), "nudges": nudges}
    ck = _cache_key("tax", payload)
    if ck in _EXPLANATION_CACHE:
        return _EXPLANATION_CACHE[ck]

    lines = ["### Your tax picture", ""]
    reg = tax_data.get("regimes")
    if reg:
        lines.append(
            f"- Estimated tax for FY {tax_data.get('fy')}: **{_inr(reg['old']['total_tax'])}** under the old regime and "
            f"**{_inr(reg['new']['total_tax'])}** under the new regime, so the **{reg['better']}** regime costs less "
            f"by about **{_inr(reg['saving'])}**."
        )
    marg = tax_data.get("marginal_rate")
    if marg:
        lines.append(f"- Each extra rupee of income is taxed at about **{marg * 100:.1f}%** (slab rate with cess).")
    for n in nudges:
        lines.append(f"- **{n.get('title')}:** {n.get('summary')}")
    lines += ["", "These are illustrations from the details you entered, not tax filings."]
    fallback = append_statutory_disclosures("\n".join(lines))

    clean_data = scrub_pii(payload)
    llm_out, provider = call_llm(
        "Please explain these tax figures simply. Use only the numbers provided:\n" + json.dumps(clean_data, default=str))
    final_text, ai_generated = fallback, False
    if llm_out:
        ok_nums = verify_number_consistency(llm_out, extract_numbers_from_payload(clean_data))
        if ok_nums and scan_banned_wording(llm_out):
            final_text, ai_generated = append_statutory_disclosures(llm_out), True
    res = {"kind": "tax", "explanation": final_text, "ai_generated": ai_generated,
           "provider": provider if ai_generated else "deterministic_template"}
    _EXPLANATION_CACHE[ck] = res
    return res
