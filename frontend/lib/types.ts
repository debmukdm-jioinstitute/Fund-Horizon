export type EmploymentType =
  | "govt_psu" | "salaried_private" | "business_professional" | "freelance_variable" | "retired_none";
export type GoalType =
  | "retirement" | "child_education" | "child_marriage" | "home" | "vehicle" | "travel" | "emergency" | "custom";

export interface ClientInput {
  first_name: string;
  age: number;
  employment_type: EmploymentType;
  dependents: number;
  monthly_income: number;
  monthly_expenses: number;
  monthly_emi: number;
  liquid_assets: number;
  investments: number;
  liabilities: number;
  term_cover: number;
  health_cover: number;
  retirement_age: number;
}
export interface GoalInput {
  name: string;
  type: GoalType;
  target_amount_today: number;
  years_to_goal: number;
  priority: 1 | 2 | 3;
  existing_investment_earmarked: number;
}
export interface PlanRequest {
  client: ClientInput;
  goals: GoalInput[];
  answers: Record<string, number>;
  step_up?: number;
}

export interface Questionnaire {
  questions: { id: string; text: string; options: { text: string; score: number }[] }[];
}

export interface Disclosures {
  arn: string;
  lines: string[];
  shortlist_heading: string;
  tax_info: string;
  consent_text: string;
  allocation_heading: string;
}
export interface Meta {
  disclosures: Disclosures;
  data_asof: string;
  assumptions: Record<string, unknown>;
}

export interface Factor { factor: string; weight: number; value: unknown; score: number; contribution: number }
export interface Profile {
  capacity: { score: number; factors: Factor[]; emergency_months: number };
  tolerance: number;
  final_score: number;
  band: string;
  mismatch_note: string | null;
  notes: string[];
  priority_actions: string[];
}
export interface FundPick {
  scheme_code: string;
  scheme_name: string;
  amc: string;
  category: string;
  cat: string;
  sleeve: string;
  weight_pct: number;
  score: number;
  metrics: Record<string, number | null>;
  explain: string[];
  merged_from: { cat: string; weight_pct: number }[];
  suggested_monthly_sip: number;
}
export interface FanPoint { year: number; p10: number; p50: number; p90: number }
export interface Levers {
  extend_horizon: { extra_years: number; required_sip: number } | null;
  step_up: { step_up: number; first_year_sip: number; fits_budget: boolean }[];
  lower_target: { target_today: number; fraction: number } | null;
}
export interface GoalPlan {
  name: string;
  type: string;
  priority: number;
  years: number;
  inflation: number;
  future_cost: number;
  expected_return: number;
  required_sip: number;
  allocated_sip: number;
  shortfall: number;
  status: "funded" | "partially_funded" | "unfunded";
  step_up: number;
  levers: Levers | null;
  asset_mix: Record<string, number>;
  monte_carlo: {
    success_prob: number; p10: number; p50: number; p90: number; fan: FanPoint[];
    sip_for_target_success: number; target_success: number;
  };
}
export interface Plan {
  id: string;
  profile: Profile;
  allocation: {
    band: string;
    by_category: Record<string, number>;
    by_asset_class: Record<string, number>;
    per_goal: { name: string; years: number; by_category: Record<string, number>; by_asset_class: Record<string, number> }[];
  };
  funds: FundPick[];
  stress_test: {
    crash_2020_drawdown: number | null;
    worst_peak_to_trough: number;
    worst_rolling_12m: number | null;
    path: { date: string; value: number }[];
    note: string;
    any_substituted: boolean;
  };
  planning: {
    cashflow: { monthly_income: number; monthly_outgo: number; monthly_surplus: number; savings_rate: number | null };
    emergency_fund: {
      target_months: number; target: number; current: number; gap: number; monthly_allocation: number;
      months_to_close: number | null;
    };
    insurance: {
      term: { need: number; cover: number; gap: number; human_life_value: number; reference: Record<string, number> };
      health: { target: number; cover: number; gap: number };
    };
    goals: GoalPlan[];
    totals: { required_sip: number; allocated_sip: number; monthly_surplus: number; shortfall: number };
    rebalancing: string[];
    step_up: number;
  };
  disclosures: Disclosures;
  data_asof: string;
}

export interface FundNavPoint {
  date: string;
  nav: number;
}

export interface FundDetail {
  scheme_code: string;
  scheme_name: string;
  amc: string;
  category: string;
  cat: string;
  plan: string;
  option: string;
  eligible_for_shortlist?: boolean;
  nav_monthly: FundNavPoint[];
}

export interface RollingStats {
  median: number | null;
  min: number | null;
  max: number | null;
  pct_positive: number | null;
  dispersion: number | null;
  n: number;
}

export interface DrawdownDuration {
  longest_underwater_months: number;
  max_drawdown: number;
  peak_date: string | null;
  trough_date: string | null;
}

export interface FundAnalytics {
  scheme_code: string;
  scheme_name: string;
  category: string;
  cat: string;
  amc: string;
  last_nav_date: string;
  returns: {
    cagr_1y: number | null;
    cagr_3y: number | null;
    cagr_5y: number | null;
    sip_xirr: number | null;
  };
  rolling_returns: {
    "1y": RollingStats;
    "3y": RollingStats;
    "5y": RollingStats;
  };
  risk: {
    annualized_volatility_3y: number | null;
    sharpe_3y: number | null;
    sortino_3y: number | null;
    max_drawdown: number | null;
    drawdown_duration: DrawdownDuration | null;
  };
  capture_ratios: {
    upside_capture: number | null;
    downside_capture: number | null;
    up_periods?: number;
    down_periods?: number;
    common_periods?: number;
  };
  disclaimer: string;
}

export interface CompareFundItem {
  scheme_code: string;
  scheme_name: string;
  category: string;
  amc: string;
  cagr_3y: number | null;
  cagr_5y: number | null;
  vol_3y: number | null;
  sharpe_3y: number | null;
  max_drawdown_3y: number | null;
}

export interface CorrelationMatrix {
  codes: string[];
  matrix: number[][];
  flagged_pairs: {
    scheme_1: string;
    scheme_2: string;
    correlation: number;
    note: string;
  }[];
  label: string;
}

export interface CompareResponse {
  funds: CompareFundItem[];
  correlation: CorrelationMatrix;
  disclaimer: string;
}
