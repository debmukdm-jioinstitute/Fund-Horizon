"""Customer profiling: risk capacity (0-100), risk tolerance (0-100), final band.

final_score = min(capacity, tolerance). Band edges: lower bound inclusive, upper exclusive
(exception: 100 falls in the top band).
"""
from __future__ import annotations

from app.config import load_allocation, load_assumptions, load_questionnaire
from app.engine.insurance import term_need
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
MISMATCH_GAP = 25.0


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


def score_insurance(term_cover: float, need: float, health_cover: float, threshold: float) -> int:
    term_ok = term_cover >= threshold * need
    health_ok = health_cover > 0
    if term_ok and health_ok:
        return 100
    if term_ok or health_ok:
        return 60
    return 20


def band_for(score: float) -> dict:
    """Band row from allocation.yaml for a score. Lower inclusive, upper exclusive."""
    bands = load_allocation()["bands"]
    for b in bands:
        if b["min"] <= score < b["max"]:
            return b
    return bands[-1]


def risk_capacity(client: Client, assumptions: dict | None = None) -> dict:
    """Weighted capacity score with a per-factor breakdown."""
    a = assumptions or load_assumptions()
    income = client.monthly_income
    outgo = client.monthly_expenses + client.monthly_emi
    savings_rate = (income - outgo) / income if income > 0 else -1.0
    ef_months = client.liquid_assets / outgo if outgo > 0 else 99.0
    nw = client.liquid_assets + client.investments - client.liabilities
    nw_multiple = nw / (12 * income) if income > 0 else (0.0 if nw >= 0 else -1.0)
    debt = client.monthly_emi / income if income > 0 else 1.0
    need = term_need(
        client.age, client.retirement_age, income, client.investments,
        client.liquid_assets, client.liabilities, a["insurance"],
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
                client.term_cover, need, client.health_cover, a["insurance"]["adequacy_threshold"]
            ),
            {"term_need": need, "term_cover": client.term_cover, "health_cover": client.health_cover},
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
        actions.append("Build emergency fund first")
        moderate = next(b for b in bands if b["name"] == "Moderate")
        if bands.index(band) > bands.index(moderate):
            band = moderate
            notes.append("Band capped at Moderate until the emergency fund covers 3 months.")
    if client.dependents > 0 and client.term_cover == 0:
        actions.append("Insurance first")  # TODO(owner-compliance-review)

    return {
        "capacity": cap,
        "tolerance": tol,
        "final_score": final,
        "band": band["name"],
        "mismatch_note": mismatch,
        "notes": notes,
        "priority_actions": actions,
    }
