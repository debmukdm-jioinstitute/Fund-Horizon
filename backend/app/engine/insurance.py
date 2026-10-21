from __future__ import annotations
"""Insurance need calculations (pure)."""

from app.engine.finmath import growing_annuity_due_pv


def term_need(
    age: int,
    retirement_age: int,
    monthly_income: float,
    investments: float,
    liquid: float,
    liabilities: float,
    ins: dict,
    dependents: int = 0,
) -> dict:
    """Human-life-value term-cover need.

    Growing annuity-due of replacement income to retirement, discounted at
    max(min_real_rate, debt_return - inflation), minus (investments + liquid - liabilities),
    floored at 0 and capped at cap_income_multiple x annual income.

    Replacement income starts at annual x (1 - personal_share) and is scaled by dependents
    (capped at 100% of income). Optional income_growth (default 3%) is applied inside the
    annuity. 15x/20x income rules are returned as a range alongside the HLV need.
    """
    annual = 12.0 * monthly_income
    years = max(retirement_age - age, 0)
    rate = max(ins["min_real_rate"], ins["debt_return_for_discount"] - ins["inflation"])
    growth = float(ins.get("income_growth", 0.03))
    family_share = 1.0 - ins["personal_share"]
    dep_scale = 1.0 + float(ins.get("dependent_weight", 0.10)) * max(dependents, 0)
    replacement = annual * min(1.0, family_share * dep_scale)
    gross_pv = growing_annuity_due_pv(replacement, growth, rate, years)
    net = max(gross_pv - (investments + liquid - liabilities), 0.0)
    need = min(net, ins["cap_income_multiple"] * annual) if annual > 0 else 0.0
    refs = {f"{m}x_income": round(m * annual) for m in ins["reference_multiples"]}
    hlv_need = round(need)
    range_vals = [hlv_need, *refs.values()]
    return {
        "human_life_value": round(gross_pv),
        "need": hlv_need,
        "discount_rate": rate,
        "income_growth": growth,
        "dependents": dependents,
        "reference": refs,
        "need_range": {
            "hlv": hlv_need,
            **refs,
            "low": min(range_vals),
            "high": max(range_vals),
        },
    }


def health_target(age: int, dependents: int, ins: dict) -> int:
    """Health cover target: base, plus extra if age > health_extra_age or dependents >= N."""
    extra = age > ins["health_extra_age"] or dependents >= ins["health_extra_dependents"]
    return int(ins["health_base"] + (ins["health_extra"] if extra else 0))
