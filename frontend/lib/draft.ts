// TODO(owner-compliance-review): this file contains user-facing copy.
import type { ClientInput, GoalInput, GoalType, PlanRequest, TaxMode, TaxProfileInput } from "./types";

/** Wizard form state. Numbers are kept as digit strings so typing feels natural. */
export interface GoalDraft {
  name: string; type: GoalType; target: string; years: string; priority: "1" | "2" | "3"; earmarked: string;
}
/** Tax step. Rupee fields are digit strings; they are never written to sessionStorage. */
export interface TaxDraft {
  mode: TaxMode;
  regime_current: "old" | "new" | "unsure";
  bracket_pct: string;
  gross_income: string; other_income: string;
  basic_annual: string; hra_received: string; rent_paid_monthly: string; metro: boolean;
  employer_nps_pct: string; employer_offers_nps: boolean; employer_offers_vpf: boolean;
  ded_80c: string; nps_self: string; health_self: string; health_parents: string; parents_senior: boolean;
  home_loan_interest: string; edu_loan_interest: string;
  fd_interest: string; realised_stcg: string; realised_ltcg: string; unrealised_gain: string;
  lock_in: "none" | "3y" | "5y" | "15y"; govt_pref: boolean;
  spouse_band: "unknown" | "none" | "lower" | "similar" | "higher";
}
export interface Draft {
  first_name: string; age: string; employment_type: ClientInput["employment_type"]; dependents: string;
  retirement_age: string;
  monthly_income: string; monthly_expenses: string; monthly_emi: string; liquid_assets: string;
  investments: string; liabilities: string; term_cover: string; health_cover: string;
  goals: GoalDraft[];
  tax: TaxDraft;
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

/** Targets at or above this (₹100 Cr) get a sanity banner. */
export const HUGE_TARGET_TODAY = 1_000_000_000;

export const DRAFT_STORAGE_KEY = "fh-plan-draft-v3";
export const DRAFT_STORAGE_LEGACY_KEY = "fh-plan-draft-v2";

export const emptyGoal = (): GoalDraft => ({
  name: "", type: "custom", target: "", years: "", priority: "2", earmarked: "0",
});

export const emptyTax = (): TaxDraft => ({
  mode: "detailed", regime_current: "unsure", bracket_pct: "",
  gross_income: "", other_income: "",
  basic_annual: "", hra_received: "", rent_paid_monthly: "", metro: false,
  employer_nps_pct: "", employer_offers_nps: false, employer_offers_vpf: false,
  ded_80c: "", nps_self: "", health_self: "", health_parents: "", parents_senior: false,
  home_loan_interest: "", edu_loan_interest: "",
  fd_interest: "", realised_stcg: "", realised_ltcg: "", unrealised_gain: "",
  lock_in: "3y", govt_pref: false, spouse_band: "unknown",
});

export const BRACKETS = [0, 5, 10, 15, 20, 25, 30];

export const emptyDraft = (): Draft => ({
  first_name: "", age: "", employment_type: "salaried_private", dependents: "0", retirement_age: "60",
  monthly_income: "", monthly_expenses: "", monthly_emi: "0", liquid_assets: "", investments: "0",
  liabilities: "0", term_cover: "0", health_cover: "0",
  goals: [emptyGoal()], tax: emptyTax(), answers: {}, consent: false,
});

const n = (s: string) => (s === "" ? 0 : Number(s));

/** Years from now until planned retirement, or null when that gap is not 1–40. */
export function retirementHorizonYears(age: number, retirementAge: number): number | null {
  if (!Number.isFinite(age) || !Number.isFinite(retirementAge)) return null;
  const y = Math.round(retirementAge - age);
  if (y < 1 || y > 40) return null;
  return y;
}

/** Keep retirement-goal years in lockstep with age and planned retirement age. */
export function syncRetirementYears(d: Draft): Draft {
  const y = retirementHorizonYears(n(d.age), n(d.retirement_age));
  if (y == null) return d;
  let changed = false;
  const goals = d.goals.map((g) => {
    if (g.type !== "retirement" || g.years === String(y)) return g;
    changed = true;
    return { ...g, years: String(y) };
  });
  return changed ? { ...d, goals } : d;
}

export function isHugeTarget(amount: number): boolean {
  return Number.isFinite(amount) && amount >= HUGE_TARGET_TODAY;
}

export function draftHasHugeTarget(d: Draft): boolean {
  return d.goals.some((g) => g.target !== "" && isHugeTarget(n(g.target)));
}

/**
 * Drop rupee fields before sessionStorage. Name/age/answers stay so a refresh can resume;
 * income, balances and goal amounts do not.
 */
export function stripMoneyFromDraft(d: Draft): Draft {
  const base = emptyDraft();
  return {
    ...base,
    first_name: d.first_name ?? "",
    age: d.age ?? "",
    employment_type: d.employment_type ?? base.employment_type,
    dependents: d.dependents ?? "0",
    retirement_age: d.retirement_age ?? "60",
    goals: (d.goals?.length ? d.goals : [emptyGoal()]).map((g) => ({
      ...emptyGoal(),
      name: g.name ?? "",
      type: g.type ?? "custom",
      years: g.years ?? "",
      priority: g.priority ?? "2",
    })),
    tax: {
      ...base.tax,
      mode: d.tax?.mode ?? base.tax.mode,
      regime_current: d.tax?.regime_current ?? base.tax.regime_current,
      bracket_pct: d.tax?.bracket_pct ?? "",
      metro: d.tax?.metro ?? false,
      employer_nps_pct: d.tax?.employer_nps_pct ?? "",
      employer_offers_nps: d.tax?.employer_offers_nps ?? false,
      employer_offers_vpf: d.tax?.employer_offers_vpf ?? false,
      parents_senior: d.tax?.parents_senior ?? false,
      lock_in: d.tax?.lock_in ?? base.tax.lock_in,
      govt_pref: d.tax?.govt_pref ?? false,
      spouse_band: d.tax?.spouse_band ?? base.tax.spouse_band,
    },
    answers: d.answers ?? {},
    consent: false,
  };
}

export function readStoredWizard(raw: string | null): { draft: Draft; step: number } | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { draft?: Draft; step?: number };
    if (!saved?.draft) return null;
    return {
      draft: syncRetirementYears(stripMoneyFromDraft({ ...emptyDraft(), ...saved.draft })),
      step: typeof saved.step === "number" && saved.step >= 0 ? saved.step : 0,
    };
  } catch {
    return null;
  }
}

export function writeStoredWizard(draft: Draft, step: number): string {
  return JSON.stringify({ draft: stripMoneyFromDraft(draft), step });
}

/** Tax step to API shape. Blank optional amounts become 0. */
export function toTaxProfile(t: TaxDraft): TaxProfileInput {
  if (t.mode === "skip") return { mode: "skip" };
  const base: TaxProfileInput = {
    mode: t.mode, regime_current: t.regime_current,
    ded_80c_used: n(t.ded_80c), nps_self_annual: n(t.nps_self),
    unrealised_equity_gain: n(t.unrealised_gain), realised_stcg: n(t.realised_stcg), realised_ltcg: n(t.realised_ltcg),
    lock_in_comfort: t.lock_in, govt_backed_pref: t.govt_pref, spouse_income_band: t.spouse_band,
    employer_offers_nps: t.employer_offers_nps, employer_offers_vpf: t.employer_offers_vpf,
  };
  if (t.mode === "bracket_only") return { ...base, bracket_pct: Number(t.bracket_pct) };
  return {
    ...base,
    gross_income_annual: n(t.gross_income), other_income_annual: n(t.other_income),
    basic_annual: n(t.basic_annual), hra_received: n(t.hra_received), rent_paid_monthly: n(t.rent_paid_monthly),
    metro: t.metro, employer_nps_pct: n(t.employer_nps_pct),
    health_premium_self: n(t.health_self), health_premium_parents: n(t.health_parents), parents_senior: t.parents_senior,
    home_loan_interest: n(t.home_loan_interest), edu_loan_interest: n(t.edu_loan_interest),
    fd_interest_annual: n(t.fd_interest),
  };
}

export function toRequest(d: Draft): PlanRequest {
  const synced = syncRetirementYears(d);
  const goals: GoalInput[] = synced.goals.map((g) => {
    const locked = g.type === "retirement"
      ? retirementHorizonYears(n(synced.age), n(synced.retirement_age))
      : null;
    return {
      name: g.name.trim(), type: g.type, target_amount_today: n(g.target),
      years_to_goal: locked ?? n(g.years),
      priority: Number(g.priority) as 1 | 2 | 3, existing_investment_earmarked: n(g.earmarked),
    };
  });
  const body = {
    client: {
      first_name: synced.first_name.trim(), age: n(synced.age), employment_type: synced.employment_type,
      dependents: n(synced.dependents),
      monthly_income: n(synced.monthly_income), monthly_expenses: n(synced.monthly_expenses),
      monthly_emi: n(synced.monthly_emi),
      liquid_assets: n(synced.liquid_assets), investments: n(synced.investments),
      liabilities: n(synced.liabilities),
      term_cover: n(synced.term_cover), health_cover: n(synced.health_cover),
      retirement_age: n(synced.retirement_age),
      tax: toTaxProfile(synced.tax),
    },
    goals,
    answers: synced.answers,
    // WS3 persists this server-side. Always send the checkbox value (true only after the user ticks it).
    consent: synced.consent === true,
  };
  return body as PlanRequest;
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
  const locked = retirementHorizonYears(n(d.age), n(d.retirement_age));
  d.goals.forEach((g, i) => {
    if (!g.name.trim()) e[`g${i}.name`] = "Give this goal a name.";
    if (g.type === "retirement") {
      if (locked == null) {
        e[`g${i}.years`] = "Years to retirement must equal planned retirement age minus your age (1–40). Raise the retirement age or change the goal type.";
      }
    } else {
      const y = n(g.years);
      if (g.years === "" || y < 1 || y > 40) e[`g${i}.years`] = "Years to goal must be between 1 and 40.";
    }
    if (g.type !== "retirement" && g.target === "") e[`g${i}.target`] = "Enter the cost in today's rupees.";
  });
  return e;
}

export function validateTax(d: Draft): Errors {
  const e: Errors = {};
  const t = d.tax;
  if (t.mode === "detailed" && t.gross_income === "") e.gross_income = "Enter your yearly income before tax (0 if none).";
  if (t.mode === "bracket_only" && t.bracket_pct === "") e.bracket_pct = "Choose the highest slab rate you pay.";
  if (t.employer_nps_pct !== "" && Number(t.employer_nps_pct) > 14) e.employer_nps_pct = "Employer NPS is deductible up to 14% of basic.";
  return e;
}

export function employmentLabel(value: Draft["employment_type"]): string {
  return EMPLOYMENT.find((x) => x.value === value)?.label ?? value;
}
