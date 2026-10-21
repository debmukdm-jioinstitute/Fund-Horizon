from __future__ import annotations
"""Pydantic v2 input/output models. Money is integer rupees."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Sanity cap for all money fields (finding 15). 1 crore = 10_000_000.
MAX_MONEY_RUPEES = 1_00_00_00_000  # ₹100 crore
MAX_MC_SIMS = 5_000
MIN_MC_SIMS = 100


class EmploymentType(str, Enum):
    govt_psu = "govt_psu"
    salaried_private = "salaried_private"
    business_professional = "business_professional"
    freelance_variable = "freelance_variable"
    retired_none = "retired_none"


class GoalType(str, Enum):
    retirement = "retirement"
    child_education = "child_education"
    child_marriage = "child_marriage"
    home = "home"
    vehicle = "vehicle"
    travel = "travel"
    emergency = "emergency"
    custom = "custom"


Rupees = int  # alias for readability


class TaxProfile(BaseModel):
    """Optional tax details (resident individuals). Every field is optional so older requests still validate.

    mode "detailed" uses the income and deduction fields; "bracket_only" uses `bracket_pct` alone;
    "skip" turns tax features off for this plan.
    """
    model_config = ConfigDict(extra="forbid")

    mode: str = Field(default="detailed", pattern="^(detailed|bracket_only|skip)$")
    regime_current: str = Field(default="unsure", pattern="^(old|new|unsure)$")
    bracket_pct: int | None = Field(default=None, description="Top slab rate you pay, in percent")
    gross_income_annual: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    other_income_annual: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    basic_annual: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    hra_received: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    rent_paid_monthly: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    metro: bool = False
    employer_nps_pct: float = Field(default=0.0, ge=0.0, le=14.0, description="Employer NPS as % of basic")
    ded_80c_used: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    nps_self_annual: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    health_premium_self: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    health_premium_parents: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    parents_senior: bool = False
    home_loan_interest: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    edu_loan_interest: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    fd_interest_annual: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    realised_stcg: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    realised_ltcg: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    unrealised_equity_gain: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)
    spouse_income_band: str = Field(default="unknown", pattern="^(none|lower|similar|higher|unknown)$")
    lock_in_comfort: str = Field(default="3y", pattern="^(none|3y|5y|15y)$")
    govt_backed_pref: bool = False
    employer_offers_nps: bool = False
    employer_offers_vpf: bool = False

    @field_validator("bracket_pct")
    @classmethod
    def _bracket_valid(cls, v: int | None) -> int | None:
        if v is not None and v not in (0, 5, 10, 15, 20, 25, 30):
            raise ValueError("Tax bracket must be one of 0, 5, 10, 15, 20, 25 or 30 percent")
        return v

    @model_validator(mode="after")
    def _bracket_needed(self) -> TaxProfile:
        if self.mode == "bracket_only" and self.bracket_pct is None:
            raise ValueError("Choose your tax bracket, or switch to detailed or skip")
        return self


class TaxSwitches(BaseModel):
    """What the customer has switched on in the tax section. All defaults leave the plan unchanged."""
    model_config = ConfigDict(extra="forbid")

    regime: str = Field(default="auto", pattern="^(auto|old|new)$")
    tax_view: str = Field(default="pre", pattern="^(pre|post)$")
    apply: list[str] = Field(default_factory=list, max_length=20)
    reinvest: bool = False


class Client(BaseModel):
    first_name: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=18, le=80, description="Age must be between 18 and 80")
    employment_type: EmploymentType
    dependents: int = Field(ge=0, le=15)
    monthly_income: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    monthly_expenses: int = Field(ge=0, le=MAX_MONEY_RUPEES, description="Household, excluding EMIs")
    monthly_emi: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    liquid_assets: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    investments: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    liabilities: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    term_cover: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    health_cover: int = Field(ge=0, le=MAX_MONEY_RUPEES)
    retirement_age: int = Field(default=60, ge=40, le=80)
    tax: TaxProfile | None = None

    @model_validator(mode="after")
    def _retire_after_now(self) -> Client:
        if self.retirement_age < self.age and self.employment_type != EmploymentType.retired_none:
            raise ValueError("Retirement age cannot be lower than current age")
        return self


class Goal(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    type: GoalType
    target_amount_today: int = Field(
        ge=0,
        le=MAX_MONEY_RUPEES,
        description="Cost in today's rupees. For retirement: desired annual spending in "
        "retirement (today's rupees); 0 uses the default share of current expenses.",
    )
    years_to_goal: int = Field(ge=1, le=40, description="Years to goal must be 1 to 40")
    priority: int = Field(default=2, ge=1, le=3)
    existing_investment_earmarked: int = Field(default=0, ge=0, le=MAX_MONEY_RUPEES)


class AssetReturnOverrides(BaseModel):
    """Allowlisted planning-return tweaks. Bounds block optimistic / DoS values."""

    model_config = ConfigDict(extra="forbid")
    equity: float | None = Field(default=None, ge=0.0, le=0.15)
    debt: float | None = Field(default=None, ge=0.0, le=0.10)
    gold: float | None = Field(default=None, ge=0.0, le=0.15)
    liquid: float | None = Field(default=None, ge=0.0, le=0.10)


class MonteCarloOverrides(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sims: int | None = Field(default=None, ge=MIN_MC_SIMS, le=MAX_MC_SIMS)


class AssumptionOverrides(BaseModel):
    """Only asset-return and MC sim count may be overridden; everything else is rejected."""

    model_config = ConfigDict(extra="forbid")
    asset_returns: AssetReturnOverrides | None = None
    montecarlo: MonteCarloOverrides | None = None


class PlanRequest(BaseModel):
    client: Client
    goals: list[Goal] = Field(min_length=1, max_length=6)
    answers: dict[str, int]
    assumption_overrides: dict | None = None
    step_up: float = Field(default=0.0, ge=0.0, le=0.2)
    consent: bool = True
    tax_switches: TaxSwitches = Field(default_factory=TaxSwitches)

    @field_validator("answers")
    @classmethod
    def _answers_nonneg(cls, v: dict[str, int]) -> dict[str, int]:
        if any(i < 0 for i in v.values()):
            raise ValueError("Answer indexes must be zero or positive")
        return v

    @field_validator("assumption_overrides", mode="before")
    @classmethod
    def _allowlist_overrides(cls, v: object) -> dict | None:
        if v is None:
            return None
        parsed = AssumptionOverrides.model_validate(v)
        dumped = parsed.model_dump(exclude_none=True)
        return dumped or None

    @field_validator("consent")
    @classmethod
    def _consent_required(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Consent is required to generate a plan")
        return v

    @model_validator(mode="after")
    def _cross_field_rules(self) -> PlanRequest:
        earmarked = sum(g.existing_investment_earmarked for g in self.goals)
        if earmarked > self.client.investments:
            raise ValueError("Sum of earmarked amounts cannot exceed declared investments")
        expected = self.client.retirement_age - self.client.age
        if expected >= 1:
            for g in self.goals:
                if g.type == GoalType.retirement and g.years_to_goal != expected:
                    raise ValueError(
                        "Retirement goal years_to_goal must equal retirement_age minus age"
                    )
        return self


class PortfolioHolding(BaseModel):
    scheme_code: str = Field(min_length=1)
    weight_pct: float = Field(gt=0.0, le=100.0)


class PortfolioAnalyzeRequest(BaseModel):
    holdings: list[PortfolioHolding] = Field(min_length=1, max_length=20)
    correlation_threshold: float = Field(default=0.80, ge=0.1, le=0.99)
class RagAskRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    category: str | None = None
    plan: str | None = None
    amc: str | None = None
    top_k: int = Field(default=4, ge=1, le=20)


class ExplainPlanRequest(BaseModel):
    plan_id: str | None = None
    plan_data: dict[str, Any] | None = None


class ExplainFundRequest(BaseModel):
    scheme_code: str = Field(min_length=1)


class ExplainCasRequest(BaseModel):
    cas_data: dict[str, Any]



class ExplainTaxRequest(BaseModel):
    plan_id: str | None = None
    tax_data: dict[str, Any] | None = None
    nudge_id: str | None = Field(default=None, max_length=40)


class TaxCalcGoal(BaseModel):
    type: GoalType = GoalType.custom
    years: int = Field(default=5, ge=1, le=40)


class TaxCalcRequest(BaseModel):
    """Stateless tax calculator: nothing is saved."""
    age: int = Field(ge=18, le=100)
    employment_type: EmploymentType = EmploymentType.salaried_private
    tax: TaxProfile
    goals: list[TaxCalcGoal] = Field(default_factory=list, max_length=6)
    switches: TaxSwitches = Field(default_factory=TaxSwitches)
