from __future__ import annotations
"""Deterministic Indian income-tax maths for resident individuals (rules in config/tax_rules.yaml).

Pure functions: no network, no I/O beyond the cached rules file. Amounts are rupees.

Simplifications (also listed in docs/TAX_RULES.md): surcharge marginal relief is applied,
capital gains are taxed on top at special rates without basic-exemption adjustment, no AMT,
no professional tax, no set-off of losses, HRA uses one rent figure for the whole year.
"""

from dataclasses import dataclass, replace

from app.config import load_tax_rules

SENIOR_AGE = 60
SUPER_SENIOR_AGE = 80


@dataclass(frozen=True)
class TaxInputs:
    """Everything the regime maths needs. Build with `inputs_from_profile`."""
    age: int
    gross_income: float                 # salary / business income before any deduction
    other_income: float = 0.0           # interest, rent, etc.
    salaried: bool = True               # standard deduction applies to salary / pension
    govt_employer: bool = False
    basic_annual: float = 0.0           # basic + DA, for HRA and employer NPS
    hra_received: float = 0.0
    rent_paid_annual: float = 0.0
    metro: bool = False
    employer_nps_pct: float = 0.0       # share of basic paid by employer into NPS (0.10 = 10%)
    ded_80c: float = 0.0                # 80C already used (EPF, LIC, PPF, tuition, loan principal)
    nps_self: float = 0.0               # own NPS, 80CCD(1B)
    health_self: float = 0.0
    health_parents: float = 0.0
    parents_senior: bool = False
    home_loan_interest: float = 0.0     # self-occupied
    edu_loan_interest: float = 0.0
    fd_interest: float = 0.0            # savings / FD interest: taxed as income, and used for 80TTB
    realised_stcg: float = 0.0
    realised_ltcg: float = 0.0

    @property
    def age_band(self) -> str:
        if self.age >= SUPER_SENIOR_AGE:
            return "super_senior"
        return "senior" if self.age >= SENIOR_AGE else "general"


def _slab_tax(taxable: float, slabs: list) -> float:
    """Progressive tax: slabs are [upper_bound or None, rate]."""
    tax, lower = 0.0, 0.0
    for upper, rate in slabs:
        top = taxable if upper is None else min(taxable, upper)
        if top > lower:
            tax += (top - lower) * rate
        if upper is None or taxable <= upper:
            break
        lower = upper
    return tax


def slab_tax(taxable: float, regime: str, age_band: str = "general", rules: dict | None = None) -> float:
    """Tax on taxable income before rebate, surcharge and cess."""
    r = rules or load_tax_rules()
    if regime == "new":
        return _slab_tax(taxable, r["new_regime"]["slabs"])
    return _slab_tax(taxable, r["old_regime"]["slabs"][age_band])


def _surcharge_rate(income: float, table: list) -> float:
    prev = 0.0
    for upper, rate in table:
        if upper is None or income <= upper:
            return rate
        prev = rate
    return prev


def surcharge(tax: float, income: float, regime: str, age_band: str = "general", rules: dict | None = None) -> float:
    """Surcharge on `tax` for total `income`, with marginal relief at each threshold.

    Marginal relief: tax plus surcharge may not exceed the tax at the threshold plus the income
    above it.
    """
    r = rules or load_tax_rules()
    table = r["new_regime" if regime == "new" else "old_regime"]["surcharge"]
    rate = _surcharge_rate(income, table)
    if rate <= 0:
        return 0.0
    sc = tax * rate
    # find the threshold we just crossed
    prev_upper, prev_rate = 0.0, 0.0
    for upper, rt in table:
        if upper is None or income <= upper:
            break
        prev_upper, prev_rate = upper, rt
    base_tax = slab_tax(prev_upper, regime, age_band, r)
    base_total = base_tax + base_tax * prev_rate
    relief = max(tax + sc - (base_total + (income - prev_upper)), 0.0)
    return max(sc - relief, 0.0)


def hra_exemption(i: TaxInputs, rules: dict | None = None) -> float:
    """HRA exemption (old regime): least of HRA received, rent less 10% of basic, 50% / 40% of basic."""
    if i.hra_received <= 0 or i.rent_paid_annual <= 0 or i.basic_annual <= 0:
        return 0.0
    lim = (rules or load_tax_rules())["limits"]
    share = lim["hra_metro_pct"] if i.metro else lim["hra_other_pct"]
    return max(min(i.hra_received, i.rent_paid_annual - lim["hra_basic_share_rent"] * i.basic_annual,
                   share * i.basic_annual), 0.0)


def employer_nps_deduction(i: TaxInputs, regime: str, rules: dict | None = None) -> float:
    lim = (rules or load_tax_rules())["limits"]
    if regime == "new":
        cap = lim["employer_nps_pct_new"]
    else:
        cap = lim["employer_nps_pct_old_govt"] if i.govt_employer else lim["employer_nps_pct_old_other"]
    return min(i.employer_nps_pct, cap) * i.basic_annual


def deductions(i: TaxInputs, regime: str, extra: dict | None = None, rules: dict | None = None) -> dict:
    """Deductions allowed under the regime. `extra` adds hypothetical amounts, e.g. {"80c": 50000}."""
    r = rules or load_tax_rules()
    lim = r["limits"]
    ex = extra or {}
    out: dict[str, float] = {}
    std = r["new_regime" if regime == "new" else "old_regime"]["std_deduction"] if i.salaried else 0.0
    out["std"] = float(std)
    out["80ccd2"] = employer_nps_deduction(i, regime, r) + ex.get("80ccd2", 0.0)
    if regime == "old":
        out["hra"] = hra_exemption(i, r)
        out["80c"] = min(i.ded_80c + ex.get("80c", 0.0), lim["sec_80c"])
        out["80ccd1b"] = min(i.nps_self + ex.get("80ccd1b", 0.0), lim["sec_80ccd_1b"])
        self_cap = lim["sec_80d_self_senior"] if i.age >= SENIOR_AGE else lim["sec_80d_self"]
        par_cap = lim["sec_80d_parents_senior"] if i.parents_senior else lim["sec_80d_parents"]
        out["80d"] = min(min(i.health_self + ex.get("80d_self", 0.0), self_cap)
                         + min(i.health_parents + ex.get("80d_parents", 0.0), par_cap), lim["sec_80d_max"])
        out["24b"] = min(i.home_loan_interest, lim["sec_24b_self_occupied"])
        out["80e"] = i.edu_loan_interest
        out["80tt"] = min(i.fd_interest, lim["sec_80ttb"]) if i.age >= SENIOR_AGE else 0.0
    return {k: float(v) for k, v in out.items()}


def capital_gains_tax(i: TaxInputs, rules: dict | None = None) -> float:
    """Special-rate tax on gains realised this year (equity-oriented): 20% STCG, 12.5% LTCG above 1.25 lakh."""
    cg = (rules or load_tax_rules())["capital_gains"]
    ltcg = max(i.realised_ltcg - cg["equity_ltcg_exemption"], 0.0)
    return i.realised_stcg * cg["equity_stcg"] + ltcg * cg["equity_ltcg"]


def regime_tax(i: TaxInputs, regime: str, extra: dict | None = None, rules: dict | None = None) -> dict:
    """Full tax under one regime ("old" or "new")."""
    r = rules or load_tax_rules()
    gross = i.gross_income + i.other_income + i.fd_interest
    ded = deductions(i, regime, extra, r)
    total_ded = sum(ded.values())
    taxable = max(gross - total_ded, 0.0)
    base = slab_tax(taxable, regime, i.age_band, r)
    rb = r["new_regime" if regime == "new" else "old_regime"]["rebate"]
    if taxable <= rb["income_limit"]:
        after_rebate = max(base - rb["max"], 0.0)
        rebate = base - after_rebate
    elif regime == "new":
        # marginal relief: tax payable cannot exceed income above the rebate limit
        after_rebate = min(base, taxable - rb["income_limit"])
        rebate = base - after_rebate
    else:
        after_rebate, rebate = base, 0.0
    sc = surcharge(after_rebate, taxable, regime, i.age_band, r)
    cess = (after_rebate + sc) * r["cess"]
    total = after_rebate + sc + cess
    return {
        "regime": regime, "gross_income": round(gross), "deductions": {k: round(v) for k, v in ded.items()},
        "total_deductions": round(total_ded), "taxable_income": round(taxable),
        "slab_tax": round(base), "rebate": round(rebate), "surcharge": round(sc), "cess": round(cess),
        "total_tax": round(total), "effective_rate": round(total / gross, 4) if gross > 0 else 0.0,
        "age_band": i.age_band,
    }


def marginal_rate(i: TaxInputs, regime: str, extra: dict | None = None, rules: dict | None = None,
                  step: float = 10000.0) -> float:
    """Tax on the next 10,000 of income, as a share, including surcharge and cess. Zero inside the rebate zone."""
    r = rules or load_tax_rules()
    a = regime_tax(i, regime, extra, r)["total_tax"]
    b = regime_tax(replace(i, gross_income=i.gross_income + step), regime, extra, r)["total_tax"]
    return round((b - a) / step, 4)


def _breakeven(i: TaxInputs, target: float, rules: dict) -> float | None:
    """Extra old-regime deductions (beyond those already claimed) that bring old tax down to `target`."""
    def tax_with(extra_ded: float) -> float:
        j = replace(i, gross_income=max(i.gross_income - extra_ded, 0.0))
        return regime_tax(j, "old", None, rules)["total_tax"]

    hi = max(i.gross_income + i.other_income, 1.0)
    if tax_with(0.0) <= target:
        return 0.0
    if tax_with(hi) > target:
        return None
    lo = 0.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if tax_with(mid) > target:
            lo = mid
        else:
            hi = mid
    return round(hi)


def compare_regimes(i: TaxInputs, rules: dict | None = None) -> dict:
    """Old vs new regime. `breakeven_extra_deductions` = extra deductions the old regime would need to match the new."""
    r = rules or load_tax_rules()
    old, new = regime_tax(i, "old", None, r), regime_tax(i, "new", None, r)
    better = "new" if new["total_tax"] <= old["total_tax"] else "old"
    lim = r["limits"]
    self_cap = lim["sec_80d_self_senior"] if i.age >= SENIOR_AGE else lim["sec_80d_self"]
    par_cap = lim["sec_80d_parents_senior"] if i.parents_senior else lim["sec_80d_parents"]
    maxed_extra = {
        "80c": max(lim["sec_80c"] - i.ded_80c, 0), "80ccd1b": max(lim["sec_80ccd_1b"] - i.nps_self, 0),
        "80d_self": max(self_cap - i.health_self, 0), "80d_parents": max(par_cap - i.health_parents, 0),
    }
    old_max = regime_tax(i, "old", maxed_extra, r)
    return {
        "old": old, "new": new, "better": better,
        "old_if_maxed": {"total_tax": old_max["total_tax"], "extra_deductions": round(sum(maxed_extra.values())),
                         "beats_new": old_max["total_tax"] < new["total_tax"],
                         "saving_vs_new": new["total_tax"] - old_max["total_tax"]},
        "saving": abs(old["total_tax"] - new["total_tax"]),
        "breakeven_extra_deductions": _breakeven(i, new["total_tax"], r) if better == "new" else 0,
        "capital_gains_tax": round(capital_gains_tax(i, r)),
    }


def post_tax_returns(asset_returns: dict, years: float, marginal: float, rules: dict | None = None) -> dict:
    """After-tax planning return for equity / debt / gold / liquid over a goal horizon.

    Terminal-value method: tax is paid once on the gain at exit, which matches how mutual funds are
    taxed. Equity uses the long-term rate beyond 12 months (short-term below); debt and liquid funds
    pay the slab rate (`marginal`, which already includes cess); gold uses the 24-month rule.
    The 1.25 lakh equity exemption is ignored, so equity is slightly understated.
    """
    r = rules or load_tax_rules()
    cg, cess = r["capital_gains"], r["cess"]
    n = max(float(years), 1e-9)

    def after(ret: float, rate: float) -> float:
        gain = (1.0 + ret) ** n - 1.0
        return (1.0 + gain * (1.0 - rate)) ** (1.0 / n) - 1.0

    eq_rate = (cg["equity_ltcg"] if n * 12 > cg["equity_holding_months"] else cg["equity_stcg"]) * (1 + cess)
    gold_rate = (cg["nonequity_ltcg"] * (1 + cess)) if n * 12 > cg["nonequity_holding_months"] else marginal
    return {
        "equity": after(asset_returns["equity"], eq_rate),
        "debt": after(asset_returns["debt"], marginal),
        "gold": after(asset_returns["gold"], gold_rate),
        "liquid": after(asset_returns["liquid"], marginal),
    }


def apply_post_tax(a: dict, years: float, marginal: float, rules: dict | None = None) -> dict:
    """Copy of the assumptions with planning returns and simulation means lowered to after-tax values."""
    pre = a["asset_returns"]
    post = post_tax_returns(pre, years, marginal, rules)
    out = dict(a)
    out["asset_returns"] = {**pre, **post}
    ret = dict(a["retirement"])
    ret["post_retirement_return"] = ret["post_retirement_return"] + (post["debt"] - pre["debt"])
    out["retirement"] = ret
    mc = dict(a["montecarlo"])
    mc["asset_mean"] = {k: mc["asset_mean"][k] + (post[k] - pre[k]) for k in post}
    out["montecarlo"] = mc
    return out


def tax_tag_for_category(cat: str, needs_demat: bool = False) -> dict:
    """How a fund of this canonical category is taxed (shown beside every shortlisted fund)."""
    from app.config import load_mf_tax_classes

    cfg = load_mf_tax_classes()
    entry = cfg["categories"].get(cat) or cfg["categories"]["other"]
    cls = cfg["classes"][entry["class"]]
    if cat == "gold" and needs_demat:
        cls = {**cfg["classes"]["gold_fof"], "label": "Gold ETF", "ltcg_months": 12,
               "note": "Gold ETF held more than 12 months: 12.5%; sooner: slab rate."}
    return {
        "class": entry["class"], "label": cls["label"], "ltcg_months": cls["ltcg_months"],
        "ltcg_rate": cls["ltcg_rate"], "stcg_rate": cls["stcg_rate"], "ltcg_exemption": cls["ltcg_exemption"],
        "slab_always": cls["slab_always"], "note": cls["note"],
        "check_factsheet": bool(entry.get("check_factsheet", False)),
    }
