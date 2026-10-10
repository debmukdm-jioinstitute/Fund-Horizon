// TODO(owner-compliance-review): this file contains user-facing copy.
import type { ClientInput, GoalInput, GoalType, PlanRequest } from "./types";

/** Wizard form state. Numbers are kept as digit strings so typing feels natural. */
export interface GoalDraft {
  name: string; type: GoalType; target: string; years: string; priority: "1" | "2" | "3"; earmarked: string;
}
export interface Draft {
  first_name: string; age: string; employment_type: ClientInput["employment_type"]; dependents: string;
  retirement_age: string;
  monthly_income: string; monthly_expenses: string; monthly_emi: string; liquid_assets: string;
  investments: string; liabilities: string; term_cover: string; health_cover: string;
  goals: GoalDraft[];
  answers: Record<string, number>;
  consent: boolean;
}

export const GOAL_TYPES: { value: GoalType; label: string; preset: string }[] = [
  { value: "retirement", label: "Retirement", preset: "Retirement" },
  { value: "child_education", label: "Child education", preset: "Child education" },
  { value: "child_marriage", label: "Child marriage", preset: "Child marriage" },
  { value: "home", label: "Home", preset: "Home" },
  { value: "vehicle", label: "Vehicle", preset: "Vehicle" },
  { value: "travel", label: "Travel", preset: "Travel" },
  { value: "emergency", label: "Emergency corpus", preset: "Emergency corpus" },
  { value: "custom", label: "Other", preset: "" },
];

export const EMPLOYMENT: { value: ClientInput["employment_type"]; label: string }[] = [
  { value: "govt_psu", label: "Government / PSU job" },
  { value: "salaried_private", label: "Salaried, private sector" },
  { value: "business_professional", label: "Business or professional practice" },
  { value: "freelance_variable", label: "Freelance or variable income" },
  { value: "retired_none", label: "Retired or no regular income" },
];

export const emptyGoal = (): GoalDraft => ({
  name: "", type: "custom", target: "", years: "", priority: "2", earmarked: "0",
});

export const emptyDraft = (): Draft => ({
  first_name: "", age: "", employment_type: "salaried_private", dependents: "0", retirement_age: "60",
  monthly_income: "", monthly_expenses: "", monthly_emi: "0", liquid_assets: "", investments: "0",
  liabilities: "0", term_cover: "0", health_cover: "0",
  goals: [emptyGoal()], answers: {}, consent: false,
});

const n = (s: string) => (s === "" ? 0 : Number(s));

export function toRequest(d: Draft): PlanRequest {
  const goals: GoalInput[] = d.goals.map((g) => ({
    name: g.name.trim(), type: g.type, target_amount_today: n(g.target), years_to_goal: n(g.years),
    priority: Number(g.priority) as 1 | 2 | 3, existing_investment_earmarked: n(g.earmarked),
  }));
  return {
    client: {
      first_name: d.first_name.trim(), age: n(d.age), employment_type: d.employment_type, dependents: n(d.dependents),
      monthly_income: n(d.monthly_income), monthly_expenses: n(d.monthly_expenses), monthly_emi: n(d.monthly_emi),
      liquid_assets: n(d.liquid_assets), investments: n(d.investments), liabilities: n(d.liabilities),
      term_cover: n(d.term_cover), health_cover: n(d.health_cover), retirement_age: n(d.retirement_age),
    },
    goals,
    answers: d.answers,
  };
}

export type Errors = Record<string, string>;

export function validateAbout(d: Draft): Errors {
  const e: Errors = {};
  if (!d.first_name.trim()) e.first_name = "Please enter your first name.";
  const age = n(d.age);
  if (d.age === "" || age < 18 || age > 80) e.age = "Age must be between 18 and 80.";
  if (n(d.dependents) > 15) e.dependents = "Please enter a number between 0 and 15.";
  const ra = n(d.retirement_age);
  if (ra < 40 || ra > 80) e.retirement_age = "Retirement age must be between 40 and 80.";
  else if (age && ra < age && d.employment_type !== "retired_none") e.retirement_age = "Retirement age cannot be lower than your age.";
  return e;
}

export function validateFinances(d: Draft): Errors {
  const e: Errors = {};
  const req: [keyof Draft, string][] = [
    ["monthly_income", "Please enter your monthly income (0 if none)."],
    ["monthly_expenses", "Please enter your monthly household expenses."],
    ["liquid_assets", "Please enter your savings and liquid funds (0 if none)."],
  ];
  for (const [k, msg] of req) if (d[k] === "") e[k] = msg;
  return e;
}

export function validateGoals(d: Draft): Errors {
  const e: Errors = {};
  if (d.goals.length < 1 || d.goals.length > 6) e.goals = "Add between 1 and 6 goals.";
  d.goals.forEach((g, i) => {
    if (!g.name.trim()) e[`g${i}.name`] = "Give this goal a name.";
    const y = n(g.years);
    if (g.years === "" || y < 1 || y > 40) e[`g${i}.years`] = "Years to goal must be between 1 and 40.";
    if (g.type !== "retirement" && g.target === "") e[`g${i}.target`] = "Enter the cost in today's rupees.";
  });
  return e;
}
