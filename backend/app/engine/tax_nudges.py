from __future__ import annotations
"""Rule-based tax-saving nudges, ranked by estimated rupee impact. Deterministic; no LLM.

Each nudge is a plain dict; every rupee figure is computed from `engine/tax.py`, so the explainer
can quote them without inventing numbers. Copy is educational: it says what may reduce tax and
what to check, never what to buy.

TODO(owner-compliance-review): the titles, summaries and steps below are user-facing copy.
TODO(owner-ca-review): confirm each rule against the current Act before wide release.
"""

from dataclasses import replace

from app.config import load_tax_rules
from app.engine import tax as tx
from app.engine.tax import TaxInputs

LONG_GOALS = {"retirement", "child_education", "child_marriage", "home", "custom"}
SHORT_HORIZON_YEARS = 3


def _inr(v: float) -> str:
    from app.engine.finmath import indian_format
    return indian_format(v)


def _label(rules: dict, key: str) -> str:
    sec = rules["section_labels"].get(key, {})
    legacy = sec.get("legacy", key)
    if sec.get("new_act") and sec.get("agreed"):
        return f"{legacy} ({sec['new_act']} of the Income-tax Act, 2025)"
    return legacy


def _saving(i: TaxInputs, regime: str, extra: dict, rules: dict) -> int:
    before = tx.regime_tax(i, regime, None, rules)["total_tax"]
    after = tx.regime_tax(i, regime, extra, rules)["total_tax"]
    return max(before - after, 0)


def _nudge(**kw) -> dict:
    base = {
        "kind": "deduction", "est_saving_year": None, "regime": "both", "effort": "medium", "lock_in": None,
        "amount": None, "why": [], "steps": [], "watch_outs": [], "section_label": None, "catalog_ids": [],
        "switchable": False, "extra": {}, "timing": "this_year",
    }
    base.update(kw)
    return base


def _has_long_goal(goals: list[dict]) -> bool:
    return any(g["type"] in LONG_GOALS and g["years"] >= 5 for g in goals)


def _only_short_goals(goals: list[dict]) -> bool:
    return bool(goals) and all(g["years"] < SHORT_HORIZON_YEARS for g in goals)


def build_nudges(i: TaxInputs, profile: dict, goals: list[dict], regime: str, comparison: dict,
                 rules: dict | None = None) -> list[dict]:
    """Nudges for the regime in force (`regime` = "old" or "new").

    profile: the TaxProfile as a dict (regime_current, lock_in_comfort, employer_offers_nps, ...).
    goals: [{"name", "type", "years"}].
    """
    r = rules or load_tax_rules()
    lim, cgr = r["limits"], r["capital_gains"]
    out: list[dict] = []
    marginal = tx.marginal_rate(i, regime, None, r)
    current = tx.regime_tax(i, regime, None, r)
    lock = profile.get("lock_in_comfort", "3y")
    can_lock3 = lock in ("3y", "5y", "15y")
    can_lock5 = lock in ("5y", "15y")

    # 1. regime ---------------------------------------------------------------------------
    better = comparison["better"]
    cur = profile.get("regime_current", "unsure")
    if comparison["saving"] > 0:
        if cur in ("old", "new") and cur != better:
            title = f"Switch to the {better} regime"
        elif cur == better:
            title = f"Stay in the {better} regime"
        else:
            title = f"The {better} regime looks cheaper for you"
        why = [f"Tax under the old regime: {_inr(comparison['old']['total_tax'])}.",
               f"Tax under the new regime: {_inr(comparison['new']['total_tax'])}."]
        if better == "new" and comparison["breakeven_extra_deductions"]:
            why.append(f"The old regime would need about {_inr(comparison['breakeven_extra_deductions'])} more in deductions to match.")
            om = comparison["old_if_maxed"]
            if om["beats_new"]:
                why.append(f"If you used every old-regime limit (80C, NPS, 80D), the old regime would cost {_inr(om['saving_vs_new'])} less.")
            else:
                why.append(f"Even using every old-regime limit (80C, NPS, 80D), the old regime would cost {_inr(-om['saving_vs_new'])} more.")
        out.append(_nudge(
            id="regime", kind="regime", title=title, regime="both", effort="low",
            summary=f"Choosing the {better} regime lowers this year's tax by about {_inr(comparison['saving'])}.",
            est_saving_year=int(comparison["saving"]), why=why, switchable=cur in ("old", "new") and cur != better,
            steps=["Tell your employer which regime to use for TDS (employees can change it each year).",
                   "Self-employed taxpayers choose when filing; the choice can be changed only in limited cases."],
            watch_outs=["Figures use the details you entered; deductions you forgot to enter favour the old regime.",
                        "Check your own numbers with a chartered accountant."],
            section_label="New regime (default)", catalog_ids=[]))

    # 2. 80C headroom (old regime) --------------------------------------------------------
    if regime == "old":
        head = max(lim["sec_80c"] - i.ded_80c, 0)
        if head > 0:
            sv = _saving(i, "old", {"80c": head}, r)
            ids, picks = [], []
            if _has_long_goal(goals) and can_lock3 and not profile.get("govt_backed_pref"):
                ids += ["elss", "ppf"]
                picks.append("ELSS (equity, 3-year lock-in) for goals 5 or more years away")
            if can_lock5 or profile.get("govt_backed_pref"):
                ids += ["ppf", "epf_vpf"]
                picks.append("PPF or VPF (sovereign-backed, long lock-in)")
            if i.age >= tx.SENIOR_AGE:
                ids += ["scss", "nsc"]
                picks.append("SCSS or NSC for steady, low-risk income")
            if not picks:
                ids += ["term_insurance", "ppf"]
                picks.append("premiums you already pay (term cover, children's tuition, home loan principal)")
            caveat = ["Do not lock money for a goal under 3 years away: ELSS and tax-saver FDs cannot be withdrawn early."]
            if _only_short_goals(goals):
                caveat.insert(0, "All your goals are under 3 years away, so a lock-in product may not fit.")
            out.append(_nudge(
                id="sec_80c", kind="deduction", regime="old", effort="medium",
                title=f"Use the rest of your {_label(r, '80C')} limit",
                summary=f"You have {_inr(head)} of the {_inr(lim['sec_80c'])} limit left. Using it could cut tax by up to {_inr(sv)}.",
                est_saving_year=sv, amount=head, lock_in="3 to 15 years depending on the product",
                why=[f"Used so far: {_inr(i.ded_80c)}.", f"Your top slab rate with cess is about {marginal * 100:.1f}%."],
                steps=["Pick from: " + "; ".join(dict.fromkeys(picks)) + ".",
                       "Match the product to when you need the money, not only to the tax saving."],
                watch_outs=caveat, section_label=_label(r, "80C"), catalog_ids=list(dict.fromkeys(ids)),
                switchable=True, extra={"80c": head}))

        # 3. NPS 80CCD(1B)
        nps_head = max(lim["sec_80ccd_1b"] - i.nps_self, 0)
        if nps_head > 0 and (any(g["type"] == "retirement" for g in goals) or i.age < 55):
            sv = _saving(i, "old", {"80ccd1b": nps_head}, r)
            if sv > 0:
                out.append(_nudge(
                    id="nps_1b", kind="deduction", regime="old", effort="medium", lock_in="Until age 60",
                    title=f"Add to NPS for the extra {_inr(lim['sec_80ccd_1b'])} deduction",
                    summary=f"{_label(r, '80CCD1B')} allows {_inr(nps_head)} more, over and above 80C. It may cut tax by up to {_inr(sv)}.",
                    est_saving_year=sv, amount=nps_head,
                    why=[f"Own NPS contribution so far: {_inr(i.nps_self)}."],
                    steps=["Open or top up an NPS Tier 1 account and keep the contribution receipt."],
                    watch_outs=["Money is locked until 60; only retirement money belongs here.",
                                "Part of the maturity must buy an annuity, and annuity income is taxable."],
                    section_label=_label(r, "80CCD1B"), catalog_ids=["nps_tier1"], switchable=True, extra={"80ccd1b": nps_head}))

    # 4. employer NPS (both regimes) -----------------------------------------------------
    cap_pct = lim["employer_nps_pct_new"] if regime == "new" else (
        lim["employer_nps_pct_old_govt"] if i.govt_employer else lim["employer_nps_pct_old_other"])
    if profile.get("employer_offers_nps") and i.basic_annual > 0 and i.employer_nps_pct < cap_pct:
        extra_amt = (cap_pct - i.employer_nps_pct) * i.basic_annual
        sv = _saving(i, regime, {"80ccd2": extra_amt}, r)
        if sv > 0:
            out.append(_nudge(
                id="employer_nps", kind="deduction", regime="both", effort="low", lock_in="Until age 60",
                title="Ask HR about employer NPS",
                summary=f"Your employer's NPS contribution is deductible in both regimes up to {cap_pct * 100:.0f}% of basic. Using the full limit could cut tax by up to {_inr(sv)}.",
                est_saving_year=sv, amount=round(extra_amt),
                why=[f"Basic salary entered: {_inr(i.basic_annual)} a year.", f"Employer NPS now: {i.employer_nps_pct * 100:.0f}% of basic."],
                steps=["Ask whether the company offers a corporate NPS option and how to redirect part of your pay."],
                watch_outs=["Employer PF, NPS and superannuation together above 7.5 lakh a year are taxed as a perquisite.",
                            "Money is locked until 60."],
                section_label=_label(r, "80CCD2"), catalog_ids=["nps_employer"], switchable=True, extra={"80ccd2": extra_amt}))

    # 5. health insurance (old regime) --------------------------------------------------
    if regime == "old":
        self_cap = lim["sec_80d_self_senior"] if i.age >= tx.SENIOR_AGE else lim["sec_80d_self"]
        par_cap = lim["sec_80d_parents_senior"] if i.parents_senior else lim["sec_80d_parents"]
        h_self, h_par = max(self_cap - i.health_self, 0), max(par_cap - i.health_parents, 0)
        if h_self + h_par > 0:
            sv = _saving(i, "old", {"80d_self": h_self, "80d_parents": h_par}, r)
            if sv > 0:
                out.append(_nudge(
                    id="health_80d", kind="deduction", regime="old", effort="low",
                    title=f"Claim {_label(r, '80D')} for health cover",
                    summary=f"Premiums for you, your family and your parents are deductible. The unused room is about {_inr(h_self + h_par)}; using it could cut tax by up to {_inr(sv)}.",
                    est_saving_year=sv, amount=h_self + h_par,
                    why=[f"Limit for you and family: {_inr(self_cap)}; for parents: {_inr(par_cap)}."],
                    steps=["Cover parents on their own policy and pay by cheque, card or online."],
                    watch_outs=["Preventive check-ups up to 5,000 count inside the same limit.",
                                "The premium must be paid for real cover, not only for the deduction."],
                    section_label=_label(r, "80D"), catalog_ids=["health_insurance"], switchable=True,
                    extra={"80d_self": h_self, "80d_parents": h_par}))

    # 6. HRA (old regime) ----------------------------------------------------------------
    if regime == "old" and i.rent_paid_annual > 0 and i.hra_received > 0:
        hra = tx.hra_exemption(i, r)
        if hra > 0:
            sv = max(tx.regime_tax(replace(i, hra_received=0), "old", None, r)["total_tax"] - current["total_tax"], 0)
            out.append(_nudge(
                id="hra", kind="deduction", regime="old", effort="low",
                title="Keep rent proofs for your HRA exemption",
                summary=f"About {_inr(hra)} of your HRA is exempt in the old regime, worth about {_inr(sv)} in tax.",
                est_saving_year=sv, why=[f"Rent paid: {_inr(i.rent_paid_annual)} a year; HRA received: {_inr(i.hra_received)}."],
                steps=["Give your employer rent receipts and, above 1 lakh of yearly rent, the landlord's PAN."],
                watch_outs=["Paying rent to parents works only if they truly receive it and report it as income."],
                section_label=_label(r, "HRA"), catalog_ids=[]))

    # 7. 87A cliff (new regime) ---------------------------------------------------------
    if regime == "new":
        rb = r["new_regime"]["rebate"]
        over = current["taxable_income"] - rb["income_limit"]
        if 0 < over <= lim["rebate_cliff_note_band"]:
            sv = _saving(i, "new", {"80ccd2": over}, r)
            out.append(_nudge(
                id="rebate_cliff", kind="deduction", regime="new", effort="medium",
                title=f"You are {_inr(over)} above the {_label(r, '87A')} limit",
                summary=f"Taxable income of {_inr(rb['income_limit'])} or less pays no tax in the new regime. Lowering yours by {_inr(over)} (for example through employer NPS) could save about {_inr(sv)}.",
                est_saving_year=sv, amount=over,
                why=[f"Taxable income now: {_inr(current['taxable_income'])}."],
                steps=["Check whether employer NPS or other new-regime deductions can bring taxable income under the limit."],
                watch_outs=["The rebate does not apply to special-rate capital gains."],
                section_label=_label(r, "87A"), catalog_ids=["nps_employer"], switchable=bool(profile.get("employer_offers_nps")),
                extra={"80ccd2": over}))

    # 8. equity gain harvesting ----------------------------------------------------------
    room = max(cgr["equity_ltcg_exemption"] - i.realised_ltcg, 0)
    unreal = profile.get("unrealised_equity_gain", 0) or 0
    if unreal > 0 and room > 0:
        amt = min(unreal, room)
        fut = round(amt * cgr["equity_ltcg"] * (1 + r["cess"]))
        out.append(_nudge(
            id="ltcg_harvest", kind="capital_gains", regime="both", effort="medium", timing="future",
            title="Use your yearly 1.25 lakh equity gain exemption",
            summary=f"Selling and re-buying about {_inr(amt)} of long-held equity gains before 31 March resets your cost price and avoids about {_inr(fut)} of tax later.",
            est_saving_year=fut, amount=round(amt),
            why=[f"Exemption left this year: {_inr(room)}.", f"Unrealised long-term equity gain entered: {_inr(unreal)}."],
            steps=["Sell units held more than 12 months with gains up to the room left, then buy them back."],
            watch_outs=["Securities transaction tax, exit loads and a small price gap apply.",
                        "Units held under 12 months are taxed at 20%; only sell long-held units."],
            section_label=None, catalog_ids=["equity_fund"]))

    # 9. short-term gains timing --------------------------------------------------------
    if i.realised_stcg > 0:
        fut = round(i.realised_stcg * (cgr["equity_stcg"] - cgr["equity_ltcg"]) * (1 + r["cess"]))
        out.append(_nudge(
            id="stcg_timing", kind="capital_gains", regime="both", effort="low", timing="future",
            title="Hold equity units past 12 months",
            summary=f"Gains realised within 12 months are taxed at 20%; after 12 months, 12.5%. On the {_inr(i.realised_stcg)} you realised, waiting could have saved about {_inr(fut)}.",
            est_saving_year=fut, why=[f"Short-term gains this year: {_inr(i.realised_stcg)}."],
            steps=["Note the purchase date of each SIP instalment; each has its own 12-month clock."],
            watch_outs=["Do not stay in a fund only for tax if your goal or risk has changed."],
            catalog_ids=["equity_fund"]))

    # 10. FD interest vs fund taxation --------------------------------------------------
    if i.fd_interest > 0 and marginal >= 0.20:
        eq_rate = cgr["equity_ltcg"] * (1 + r["cess"])
        sv = round(i.fd_interest * 0.5 * max(marginal - eq_rate, 0))
        if sv > 0:
            out.append(_nudge(
                id="fd_vs_funds", kind="savings", regime="both", effort="medium", timing="future",
                title="Compare FD interest with fund taxation",
                summary=f"FD interest is taxed every year at your slab rate (about {marginal * 100:.1f}%). Debt funds are taxed only when you sell, and arbitrage funds are taxed like equity. Moving half of the FD money to funds for goals 1 to 3 years away could save up to {_inr(sv)} a year.",
                est_saving_year=sv, why=[f"FD and savings interest entered: {_inr(i.fd_interest)} a year."],
                steps=["Compare the after-tax return of an FD, a debt fund and an arbitrage fund for the same horizon."],
                watch_outs=["Funds are not insured and returns vary; keep your emergency fund in an FD or liquid fund.",
                            "Arbitrage funds sold within 12 months are taxed at 20%."],
                catalog_ids=["debt_fund", "arbitrage_fund", "bank_fd"]))

    # 11. seniors -------------------------------------------------------------------------
    if i.age >= tx.SENIOR_AGE:
        if regime == "old" and i.fd_interest > 0:
            ded = min(i.fd_interest, lim["sec_80ttb"])
            sv = round(ded * marginal)
            out.append(_nudge(
                id="senior_80ttb", kind="senior", regime="old", effort="low",
                title=f"Claim {_label(r, '80TTB')} on interest",
                summary=f"Seniors can deduct up to {_inr(lim['sec_80ttb'])} of interest from deposits. On {_inr(i.fd_interest)} of interest that is worth about {_inr(sv)}.",
                est_saving_year=sv, why=[f"Interest entered: {_inr(i.fd_interest)}."],
                steps=["Claim it while filing your return; it is not available in the new regime."],
                watch_outs=["The deduction replaces 80TTA for seniors."],
                section_label=_label(r, "80TTB"), catalog_ids=["scss", "bank_fd"]))
        if i.fd_interest > r["tds"]["fd_interest_threshold_senior"] and current["total_tax"] == 0:
            out.append(_nudge(
                id="form_15h", kind="cashflow", regime="both", effort="low", timing="this_year",
                title="Submit Form 15H to avoid TDS",
                summary=f"Your estimated tax is nil, so banks need not deduct TDS on your {_inr(i.fd_interest)} of interest if you file Form 15H.",
                est_saving_year=round(i.fd_interest * 0.10),
                why=["Estimated total tax: nil."], steps=["Give Form 15H to each bank at the start of the year."],
                watch_outs=["Eligible only if your total tax for the year is nil."], catalog_ids=["bank_fd", "scss"]))
        if any(g["type"] == "retirement" for g in goals):
            out.append(_nudge(
                id="senior_scss", kind="senior", regime="both", effort="medium", lock_in="5 years", timing="future",
                title="Look at SCSS for steady income",
                summary="The Senior Citizens' Savings Scheme pays quarterly interest at 8.2% (rate fixed at opening). Interest is taxable, but TDS and deductions are simple to plan.",
                est_saving_year=None, why=["Maximum deposit: 30 lakh per person."],
                steps=["Compare with FD rates and your tax bracket before opening."],
                watch_outs=["Interest is taxed at slab rate."], catalog_ids=["scss"]))

    # 12. family income split -----------------------------------------------------------
    if profile.get("spouse_income_band") in ("none", "lower") and marginal >= 0.20:
        out.append(_nudge(
            id="spouse_split", kind="family", regime="both", effort="medium", timing="future",
            title="Let a lower-income spouse hold their own investments",
            summary="Income earned on money you gift to your spouse is added back to your income (clubbing). Investments bought with your spouse's own earnings are taxed in their hands, usually at a lower rate.",
            est_saving_year=None, why=[f"Your slab rate with cess is about {marginal * 100:.1f}%."],
            steps=["Route a spouse's own salary or savings into their own accounts, and keep records."],
            watch_outs=["Gifts from you to your spouse are clubbed with your income.",
                        "Talk to a chartered accountant before restructuring ownership."],
            catalog_ids=[]))

    return rank_nudges(out)


def rank_nudges(out: list[dict]) -> list[dict]:
    """Sort by estimated saving, number the nudges and attach display names for the learn links."""
    from app.config import load_tax_catalog

    names = {i["id"]: i["name"] for i in load_tax_catalog()["instruments"]}
    out.sort(key=lambda n: (-(n["est_saving_year"] or 0), n["id"]))
    for rank, n in enumerate(out, 1):
        n["rank"] = rank
        n["catalog_links"] = [{"id": c, "name": names[c]} for c in n["catalog_ids"] if c in names]
    return out


def apply_nudges(i: TaxInputs, regime: str, nudges: list[dict], apply_ids: list[str],
                 rules: dict | None = None) -> dict:
    """Tax after applying the switched-on deduction nudges, for the regime in force.

    Only nudges whose `extra` changes this year's tax count (`timing` == "this_year").
    Returns {"applied": [...], "tax_before", "tax_after", "tax_saved_year", "tax_saved_month"}.
    """
    r = rules or load_tax_rules()
    chosen = [n for n in nudges if n["id"] in set(apply_ids) and n["switchable"] and n["extra"]]
    extra: dict[str, float] = {}
    for n in chosen:
        for k, v in n["extra"].items():
            extra[k] = extra.get(k, 0.0) + v
    before = tx.regime_tax(i, regime, None, r)["total_tax"]
    after = tx.regime_tax(i, regime, extra, r)["total_tax"] if extra else before
    saved = max(before - after, 0)
    return {"applied": [n["id"] for n in chosen], "tax_before": before, "tax_after": after,
            "tax_saved_year": saved, "tax_saved_month": round(saved / 12)}
