"""Builds the plan's tax section from a TaxProfile, the goals and the switches. Pure and deterministic.

Flow: profile -> TaxInputs -> regime comparison -> regime in force -> nudges -> applied nudges ->
marginal rate -> (optional) post-tax planning rate and reinvested tax saving.
"""
from __future__ import annotations

from app.config import load_tax_rules
from app.engine import tax as tx
from app.engine import tax_nudges as nd
from app.engine.tax import TaxInputs

SALARIED = {"govt_psu", "salaried_private", "retired_none"}
DEFAULT_BASIC_SHARE = 0.40   # basic as a share of gross when the customer does not know it


def inputs_from_profile(age: int, employment_type: str, tp: dict) -> TaxInputs:
    """Map the customer's TaxProfile (dict) to TaxInputs. Amounts are yearly rupees."""
    salaried = employment_type in SALARIED
    gross = float(tp.get("gross_income_annual", 0))
    basic = float(tp.get("basic_annual", 0)) or (DEFAULT_BASIC_SHARE * gross if salaried else 0.0)
    return TaxInputs(
        age=age, gross_income=gross, other_income=float(tp.get("other_income_annual", 0)), salaried=salaried,
        govt_employer=employment_type == "govt_psu", basic_annual=basic,
        hra_received=float(tp.get("hra_received", 0)), rent_paid_annual=12.0 * float(tp.get("rent_paid_monthly", 0)),
        metro=bool(tp.get("metro", False)), employer_nps_pct=float(tp.get("employer_nps_pct", 0)) / 100.0,
        ded_80c=float(tp.get("ded_80c_used", 0)), nps_self=float(tp.get("nps_self_annual", 0)),
        health_self=float(tp.get("health_premium_self", 0)), health_parents=float(tp.get("health_premium_parents", 0)),
        parents_senior=bool(tp.get("parents_senior", False)),
        home_loan_interest=float(tp.get("home_loan_interest", 0)), edu_loan_interest=float(tp.get("edu_loan_interest", 0)),
        fd_interest=float(tp.get("fd_interest_annual", 0)), realised_stcg=float(tp.get("realised_stcg", 0)),
        realised_ltcg=float(tp.get("realised_ltcg", 0)),
    )


def _bracket_nudges(age: int, tp: dict, goals: list[dict], rules: dict) -> tuple[list[dict], float]:
    """Simplified nudges when only the tax bracket is known: savings are amount x bracket (with cess).

    These assume the old-regime deductions are claimable, so each says so; the exact figure needs
    the detailed income questions.
    """
    lim, cess = rules["limits"], rules["cess"]
    marg = (tp.get("bracket_pct") or 0) / 100.0 * (1 + cess)
    out: list[dict] = []
    if marg <= 0:
        return out, marg
    head80c = max(lim["sec_80c"] - tp.get("ded_80c_used", 0), 0)
    if tp.get("regime_current") != "new" and head80c > 0:
        out.append(nd._nudge(
            id="sec_80c", kind="deduction", regime="old", effort="medium", amount=head80c,
            title=f"Use the rest of your {nd._label(rules, '80C')} limit",
            summary=f"You have {nd._inr(head80c)} of the {nd._inr(lim['sec_80c'])} limit left. At your bracket that could cut tax by about {nd._inr(head80c * marg)} (old regime).",
            est_saving_year=round(head80c * marg), catalog_ids=["elss", "ppf", "epf_vpf"],
            why=["Estimate from your bracket only; add income details for an exact figure."],
            watch_outs=["Do not lock money for a goal under 3 years away."], section_label=nd._label(rules, "80C"),
            lock_in="3 to 15 years depending on the product"))
        head_nps = max(lim["sec_80ccd_1b"] - tp.get("nps_self_annual", 0), 0)
        if head_nps > 0:
            out.append(nd._nudge(
                id="nps_1b", kind="deduction", regime="old", effort="medium", amount=head_nps, lock_in="Until age 60",
                title=f"Add to NPS for the extra {nd._inr(lim['sec_80ccd_1b'])} deduction",
                summary=f"{nd._label(rules, '80CCD1B')} allows {nd._inr(head_nps)} more. At your bracket that could cut tax by about {nd._inr(head_nps * marg)} (old regime).",
                est_saving_year=round(head_nps * marg), catalog_ids=["nps_tier1"],
                why=["Estimate from your bracket only."], watch_outs=["Money is locked until 60."],
                section_label=nd._label(rules, "80CCD1B")))
    if tp.get("unrealised_equity_gain", 0) > 0:
        amt = min(tp["unrealised_equity_gain"], max(rules["capital_gains"]["equity_ltcg_exemption"] - tp.get("realised_ltcg", 0), 0))
        if amt > 0:
            fut = round(amt * rules["capital_gains"]["equity_ltcg"] * (1 + cess))
            out.append(nd._nudge(
                id="ltcg_harvest", kind="capital_gains", timing="future", est_saving_year=fut, amount=round(amt),
                title="Use your yearly 1.25 lakh equity gain exemption",
                summary=f"Selling and re-buying about {nd._inr(amt)} of long-held equity gains before 31 March resets your cost price and avoids about {nd._inr(fut)} of tax later.",
                catalog_ids=["equity_fund"], watch_outs=["Securities transaction tax and exit loads apply."]))
    out.sort(key=lambda n: (-(n["est_saving_year"] or 0), n["id"]))
    for rank, n in enumerate(out, 1):
        n["rank"] = rank
    return out, marg


def build_tax_section(age: int, employment_type: str, tax_profile: dict | None, goals: list[dict],
                      switches: dict) -> dict:
    """The `tax` block of a plan. `goals`: [{"name", "type", "years"}]; `switches`: TaxSwitches dict.

    Also returns private keys `_post_tax_marginal` and `_reinvest_monthly` for the planner; the
    pipeline pops them before the result is stored.
    """
    rules = load_tax_rules()
    meta = {"fy": rules["fy"], "as_of": rules["as_of"], "verified": rules["verified"],
            "sources": rules["sources"], "switches": switches}
    if not tax_profile or tax_profile.get("mode") == "skip":
        return {**meta, "enabled": False, "mode": "skip", "_post_tax_marginal": None, "_reinvest_monthly": 0}

    if tax_profile["mode"] == "bracket_only":
        nudges, marg = _bracket_nudges(age, tax_profile, goals, rules)
        post = marg if switches["tax_view"] == "post" and marg > 0 else None
        return {**meta, "enabled": True, "mode": "bracket_only", "regime_in_force": None, "recommended_regime": None,
                "regimes": None, "marginal_rate": round(marg, 4), "nudges": nudges, "applied": None,
                "_post_tax_marginal": post, "_reinvest_monthly": 0}

    i = inputs_from_profile(age, employment_type, tax_profile)
    comparison = tx.compare_regimes(i, rules)
    regime = comparison["better"] if switches["regime"] == "auto" else switches["regime"]
    nudges = nd.build_nudges(i, tax_profile, goals, regime, comparison, rules)
    applied = nd.apply_nudges(i, regime, nudges, switches["apply"], rules)
    extra: dict[str, float] = {}
    for n in nudges:
        if n["id"] in applied["applied"]:
            for k, v in n["extra"].items():
                extra[k] = extra.get(k, 0.0) + v
    marg = tx.marginal_rate(i, regime, extra or None, rules)
    # tax actually due under the regime in force after the applied nudges
    in_force = tx.regime_tax(i, regime, extra or None, rules)
    post = marg if switches["tax_view"] == "post" else None
    reinvest = applied["tax_saved_month"] if switches["reinvest"] else 0
    return {**meta, "enabled": True, "mode": "detailed", "regime_in_force": regime,
            "recommended_regime": comparison["better"], "regimes": comparison, "in_force": in_force,
            "marginal_rate": marg, "nudges": nudges, "applied": applied,
            "_post_tax_marginal": post, "_reinvest_monthly": reinvest}
