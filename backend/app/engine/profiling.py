from __future__ import annotations
"""Customer profiling: risk capacity (0-100), risk tolerance (0-100), final band.

final_score = min(capacity, tolerance). Band edges: lower bound inclusive, upper exclusive
(exception: 100 falls in the top band).
"""

from app.config import load_allocation, load_assumptions, load_questionnaire
from app.engine.insurance import health_target, term_need
from app.schemas import Client, EmploymentType

WEIGHTS = {
    "age": 0.20, "income_stability": 0.15, "dependents": 0.10, "savings_rate": 0.15,
    "emergency_fund": 0.15, "net_worth": 0.10, "debt_burden": 0.10, "insurance": 0.05,
}
STABILITY = {
    EmploymentType.govt_psu: 100, EmploymentType.salaried_private: 75,
    EmploymentType.business_professional: 55, EmploymentType.freelance_variable: 45,
    EmploymentType.retired_none: 25,
}
MISMATCH_GAP = 20.0

ACTION_EMERGENCY = "Build emergency fund first"
# Prefixes: the emitted action text appends the live numbers (see priority_actions below).
ACTION_TERM_GAP = "Bridge term life insurance cover shortfall"
ACTION_HEALTH_GAP = "Procure dedicated health insurance cover"


def _step(value: float, table: list[tuple[float, int]], floor: int) -> int:
    """First (threshold, score) with value >= threshold; lower bound inclusive. Else floor."""
    for threshold, score in table:
        if value >= threshold:
            return score
    return floor


def score_age(age: int) -> int:
    """<=30:100; 31-40:85; 41-50:65; 51-60:40; >60:20."""
    if age <= 30:
        return 100
    if age <= 40:
        return 85
    if age <= 50:
        return 65
    if age <= 60:
        return 40
    return 20


def score_dependents(n: int) -> int:
    return {0: 100, 1: 80, 2: 60, 3: 40}.get(n, 25)


def score_savings_rate(rate: float) -> int:
    """>=40%:100; [30,40):85; [20,30):70; [10,20):50; [0,10):30; <0:10."""
    return _step(rate, [(0.40, 100), (0.30, 85), (0.20, 70), (0.10, 50), (0.0, 30)], 10)


def score_emergency_months(m: float) -> int:
    """>=12:100; [6,12):85; [3,6):55; [1,3):30; <1:10."""
    return _step(m, [(12, 100), (6, 85), (3, 55), (1, 30)], 10)


def score_net_worth_multiple(x: float) -> int:
    """>=5:100; [3,5):80; [1,3):55; [0,1):35; <0:10."""
    return _step(x, [(5, 100), (3, 80), (1, 55), (0, 35)], 10)


def score_debt_burden(ratio: float) -> int:
    """<10%:100; [10,20):80; [20,35):55; [35,50):30; >=50:10."""
    if ratio < 0.10:
        return 100
    if ratio < 0.20:
        return 80
    if ratio < 0.35:
        return 55
    if ratio < 0.50:
        return 30
    return 10


def score_term_adequacy(multiple: float) -> int:
    """Term adequacy = term cover / annual income.
    >= 15x: 100; [10, 15): 80; [7, 10): 60; [5, 7): 40; < 5 (including none): 20.
    """
    if multiple >= 15.0:
        return 100
    if multiple >= 10.0:
        return 80
    if multiple >= 7.0:
        return 60
    if multiple >= 5.0:
        return 40
    return 20


def score_health_cover(cover: float) -> int:
    """>= 25L: 100; [10L, 25L): 60; < 10L (including none): 20."""
    if cover >= 25_00_000:
        return 100
    if cover >= 10_00_000:
        return 60
    return 20


def score_insurance(term_cover: float, annual_income: float, health_cover: float) -> int:
    multiple = term_cover / annual_income if annual_income > 0 else (15.0 if term_cover > 0 else 0.0)
    term_score = score_term_adequacy(multiple)
    health_score = score_health_cover(health_cover)
    return round((term_score + health_score) / 2)


def band_for(score: float) -> dict:
    """Band row from allocation.yaml for a score. Lower inclusive, upper exclusive, top band inclusive [80, 100]."""
    bands = load_allocation()["bands"]
    for i, b in enumerate(bands):
        if i == len(bands) - 1:
            if b["min"] <= score <= b["max"]:
                return b
        else:
            if b["min"] <= score < b["max"]:
                return b
    return bands[0] if score <= 0 else bands[-1]


def _zero_income_metrics(client: Client, outgo: float, nw: float) -> tuple[float, float, float]:
    """Savings rate, NW multiple and debt burden when monthly income is 0.

    Retirees and other zero-income clients are not treated as 100% debt-burdened.
    Net worth is scored as years of outgo (absolute wealth vs spending), and EMI is
    scored against assets when present.
    """
    savings_rate = 0.0 if client.monthly_emi == 0 else -1.0
    if outgo > 0:
        nw_multiple = nw / (12.0 * outgo)
    else:
        nw_multiple = 5.0 if nw >= 0 else -1.0
    if client.monthly_emi == 0:
        debt = 0.0
    else:
        assets = client.liquid_assets + client.investments
        debt = (client.monthly_emi * 12.0) / assets if assets > 0 else 1.0
    return savings_rate, nw_multiple, debt


def risk_capacity(client: Client, assumptions: dict | None = None) -> dict:
    """Weighted capacity score with a per-factor breakdown."""
    a = assumptions or load_assumptions()
    income = client.monthly_income
    outgo = client.monthly_expenses + client.monthly_emi
    nw = client.liquid_assets + client.investments - client.liabilities
    if income > 0:
        savings_rate = (income - outgo) / income
        nw_multiple = nw / (12 * income)
        debt = client.monthly_emi / income
    else:
        savings_rate, nw_multiple, debt = _zero_income_metrics(client, outgo, nw)
    ef_months = client.liquid_assets / outgo if outgo > 0 else (99.0 if client.liquid_assets > 0 else 0.0)
    need = term_need(
        client.age, client.retirement_age, income, client.investments,
        client.liquid_assets, client.liabilities, a["insurance"],
        dependents=client.dependents,
    )["need"]
    raw = {
        "age": (score_age(client.age), client.age),
        "income_stability": (STABILITY[client.employment_type], client.employment_type.value),
        "dependents": (score_dependents(client.dependents), client.dependents),
        "savings_rate": (score_savings_rate(savings_rate), round(savings_rate, 4)),
        "emergency_fund": (score_emergency_months(ef_months), round(ef_months, 2)),
        "net_worth": (score_net_worth_multiple(nw_multiple), round(nw_multiple, 2)),
        "debt_burden": (score_debt_burden(debt), round(debt, 4)),
        "insurance": (
            score_insurance(
                client.term_cover, client.monthly_income * 12.0, client.health_cover
            ),
            {
                "term_multiple": round(client.term_cover / (client.monthly_income * 12.0), 2) if client.monthly_income > 0 else 0.0,
                "term_cover": client.term_cover,
                "term_need": round(need),
                "health_cover": client.health_cover,
            },
        ),
    }
    factors = [
        {"factor": k, "weight": WEIGHTS[k], "value": v, "score": s, "contribution": round(s * WEIGHTS[k], 2)}
        for k, (s, v) in raw.items()
    ]
    return {
        "score": round(sum(f["score"] * f["weight"] for f in factors), 2),
        "factors": factors,
        "emergency_months": ef_months,
    }


def risk_tolerance(answers: dict[str, int]) -> float:
    """tolerance = (mean(option scores) - 1)/4 x 100. Raises ValueError on bad/missing answers."""
    qs = load_questionnaire()["questions"]
    scores = []
    for q in qs:
        if q["id"] not in answers:
            raise ValueError(f"Please answer question {q['id']}")
        idx = answers[q["id"]]
        if not 0 <= idx < len(q["options"]):
            raise ValueError(f"Invalid option for question {q['id']}")
        scores.append(q["options"][idx]["score"])
    return round((sum(scores) / len(scores) - 1) / 4 * 100, 2)


def build_profile(client: Client, answers: dict[str, int], assumptions: dict | None = None) -> dict:
    """Combine capacity and tolerance into the final ProfileResult dict."""
    a = assumptions or load_assumptions()
    cap = risk_capacity(client, a)
    tol = risk_tolerance(answers)
    final = round(min(cap["score"], tol), 2)
    band = band_for(final)
    bands = load_allocation()["bands"]
    notes: list[str] = []
    actions: list[str] = []
    mismatch: str | None = None

    if abs(cap["score"] - tol) > MISMATCH_GAP:
        binding = "capacity" if cap["score"] < tol else "tolerance"
        # TODO(owner-compliance-review): user-facing copy
        if binding == "capacity":
            mismatch = (
                "Your comfort with risk is higher than your financial capacity to take it; "
                "the lower capacity score is the binding one."
            )
        else:
            mismatch = (
                "Your financial capacity to take risk is higher than your stated comfort with it; "
                "the lower tolerance score is the binding one."
            )

    if mismatch:
        notes.append(mismatch)

    if cap["emergency_months"] < 3:
        # TODO(owner-compliance-review): user-facing copy
        actions.append(ACTION_EMERGENCY)
        moderate = next(b for b in bands if b["name"] == "Moderate")
        if bands.index(band) > bands.index(moderate):
            band = moderate
            notes.append("Band capped at Moderate until the emergency fund covers 3 months.")

    annual_inc = client.monthly_income * 12.0
    term_mult = client.term_cover / annual_inc if annual_inc > 0 else (15.0 if client.term_cover > 0 else 0.0)
    ins = next(f["value"] for f in cap["factors"] if f["factor"] == "insurance")
    # No term action when the need is already zero (e.g. retired / no dependents / assets cover liabilities).
    if ins["term_need"] > 0 and score_term_adequacy(term_mult) < 100:
        actions.append(f"{ACTION_TERM_GAP} (current: {term_mult:.1f}× income; target: 15×)")
    if score_health_cover(client.health_cover) < 100:
        actions.append(f"{ACTION_HEALTH_GAP} (target: ₹25L)")

    return {
        "capacity": cap,
        "tolerance": tol,
        "final_score": final,
        "band": band["name"],
        "mismatch_note": mismatch,
        "notes": notes,
        "priority_actions": actions,
    }
