"""Pydantic v2 input/output models. Money is integer rupees."""
from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator


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


class Client(BaseModel):
    first_name: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=18, le=80, description="Age must be between 18 and 80")
    employment_type: EmploymentType
    dependents: int = Field(ge=0, le=15)
    monthly_income: int = Field(ge=0)
    monthly_expenses: int = Field(ge=0, description="Household, excluding EMIs")
    monthly_emi: int = Field(ge=0)
    liquid_assets: int = Field(ge=0)
    investments: int = Field(ge=0)
    liabilities: int = Field(ge=0)
    term_cover: int = Field(ge=0)
    health_cover: int = Field(ge=0)
    retirement_age: int = Field(default=60, ge=40, le=80)

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
        description="Cost in today's rupees. For retirement: desired annual spending in "
        "retirement (today's rupees); 0 uses the default share of current expenses.",
    )
    years_to_goal: int = Field(ge=1, le=40, description="Years to goal must be 1 to 40")
    priority: int = Field(default=2, ge=1, le=3)
    existing_investment_earmarked: int = Field(default=0, ge=0)


class PlanRequest(BaseModel):
    client: Client
    goals: list[Goal] = Field(min_length=1, max_length=6)
    answers: dict[str, int]
    assumption_overrides: dict | None = None
    step_up: float = Field(default=0.0, ge=0.0, le=0.2)

    @field_validator("answers")
    @classmethod
    def _answers_nonneg(cls, v: dict[str, int]) -> dict[str, int]:
        if any(i < 0 for i in v.values()):
            raise ValueError("Answer indexes must be zero or positive")
        return v


class PortfolioHolding(BaseModel):
    scheme_code: str = Field(min_length=1)
    weight_pct: float = Field(gt=0.0, le=100.0)


class PortfolioAnalyzeRequest(BaseModel):
    holdings: list[PortfolioHolding] = Field(min_length=1, max_length=20)
    correlation_threshold: float = Field(default=0.80, ge=0.1, le=0.99)

