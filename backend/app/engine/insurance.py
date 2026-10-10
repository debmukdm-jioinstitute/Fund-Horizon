"""Insurance need calculations (pure)."""
from __future__ import annotations

from app.engine.finmath import level_annuity_pv


def term_need(
    age: int,
    retirement_age: int,
    monthly_income: float,
    investments: float,
    liquid: float,
    liabilities: float,
    ins: dict,
) -> dict:
    """Human-life-value term-cover need.

    PV of (annual income x (1 - personal_share)) for years to retirement, discounted at
    max(min_real_rate, debt_return - inflation), minus (investments + liquid - liabilities),
    floored at 0 and capped at cap_income_multiple x annual income.
    Also returns the simple 15x/20x income rules for reference.
    """
    annual = 12.0 * monthly_income
    years = max(retirement_age - age, 0)
    rate = max(ins["min_real_rate"], ins["debt_return_for_discount"] - ins["inflation"])
    gross_pv = level_annuity_pv(annual * (1.0 - ins["personal_share"]), rate, years)
    net = max(gross_pv - (investments + liquid - liabilities), 0.0)
    need = min(net, ins["cap_income_multiple"] * annual)
    return {
        "human_life_value": round(gross_pv),
        "need": round(need),
        "discount_rate": rate,
        "reference": {f"{m}x_income": round(m * annual) for m in ins["reference_multiples"]},
    }


def health_target(age: int, dependents: int, ins: dict) -> int:
    """Health cover target: base, plus extra if age > health_extra_age or dependents >= N."""
    extra = age > ins["health_extra_age"] or dependents >= ins["health_extra_dependents"]
    return int(ins["health_base"] + (ins["health_extra"] if extra else 0))
