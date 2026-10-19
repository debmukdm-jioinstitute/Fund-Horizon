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
  tax?: TaxProfileInput;
}
export type TaxMode = "detailed" | "bracket_only" | "skip";
export type RegimeChoice = "old" | "new" | "unsure";
export interface TaxProfileInput {
  mode: TaxMode;
  regime_current?: RegimeChoice;
  bracket_pct?: number | null;
  gross_income_annual?: number;
  other_income_annual?: number;
  basic_annual?: number;
  hra_received?: number;
  rent_paid_monthly?: number;
  metro?: boolean;
  employer_nps_pct?: number;
  ded_80c_used?: number;
  nps_self_annual?: number;
  health_premium_self?: number;
  health_premium_parents?: number;
  parents_senior?: boolean;
  home_loan_interest?: number;
  edu_loan_interest?: number;
  fd_interest_annual?: number;
  realised_stcg?: number;
  realised_ltcg?: number;
  unrealised_equity_gain?: number;
  spouse_income_band?: "none" | "lower" | "similar" | "higher" | "unknown";
  lock_in_comfort?: "none" | "3y" | "5y" | "15y";
  govt_backed_pref?: boolean;
  employer_offers_nps?: boolean;
  employer_offers_vpf?: boolean;
}
export interface TaxSwitches {
  regime: "auto" | "old" | "new";
  tax_view: "pre" | "post";
  apply: string[];
  reinvest: boolean;
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
  tax_switches?: TaxSwitches;
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
  tax_rules_note?: string;
  tax_nudge_note?: string;
  post_tax_note?: string;
  tax_scope_note?: string;
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
  tax_tag?: TaxTag;
  /** Next-ranked schemes in the same category (rank order after this pick). */
  alternatives?: FundPick[];
}
export interface InsurancePlanEntry {
  insurer: string;
  plan: string;
  claim_settlement: string;
  solvency: string | null;
  sum_insured: string;
  features: string[];
  why_included: string;
  marked_pick: boolean;
  insurer_key?: string;
  slug?: string;
  document_url?: string;
  document_name?: string;
}
export interface InsuranceBlock {
  kind: "term" | "health";
  gap: number;
  researched_on: string;
  note: string;
  plans: InsurancePlanEntry[];
  pick_reason: string[];
}
export interface InsuranceSuggestions {
  term: InsuranceBlock | null;
  health: InsuranceBlock | null;
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
export interface TaxTag {
  class: string;
  label: string;
  ltcg_months: number | null;
  ltcg_rate: number | null;
  stcg_rate: number | null;
  ltcg_exemption: number;
  slab_always: boolean;
  note: string;
  check_factsheet: boolean;
}
export interface TaxNudge {
  id: string;
  rank: number;
  kind: string;
  title: string;
  summary: string;
  est_saving_year: number | null;
  regime: "old" | "new" | "both";
  effort: "low" | "medium" | "high";
  lock_in: string | null;
  amount: number | null;
  why: string[];
  steps: string[];
  watch_outs: string[];
  section_label: string | null;
  catalog_ids: string[];
  catalog_links?: { id: string; name: string }[];
  switchable: boolean;
  timing: "this_year" | "future";
}
export interface RegimeResult {
  regime: "old" | "new";
  gross_income: number;
  deductions: Record<string, number>;
  total_deductions: number;
  taxable_income: number;
  slab_tax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total_tax: number;
  effective_rate: number;
  age_band: string;
}
export interface RegimeComparison {
  old: RegimeResult;
  new: RegimeResult;
  better: "old" | "new";
  saving: number;
  breakeven_extra_deductions: number | null;
  capital_gains_tax: number;
  old_if_maxed: { total_tax: number; extra_deductions: number; beats_new: boolean; saving_vs_new: number };
}
export interface TaxSection {
  enabled: boolean;
  mode: TaxMode;
  fy: string;
  as_of: string;
  verified: boolean;
  sources: { name: string; url: string }[];
  switches: TaxSwitches;
  regime_in_force?: "old" | "new" | null;
  recommended_regime?: "old" | "new" | null;
  regimes?: RegimeComparison | null;
  in_force?: RegimeResult;
  marginal_rate?: number;
  nudges?: TaxNudge[];
  applied?: {
    applied: string[]; tax_before: number; tax_after: number; tax_saved_year: number; tax_saved_month: number;
  } | null;
  post_tax_goal_delta?: {
    name: string; required_sip_pre_tax: number; required_sip_post_tax: number; extra_sip_needed: number;
  }[];
}
export interface CatalogInstrument {
  id: string;
  name: string;
  kind: string;
  summary: string;
  who_for: string;
  lock_in: string;
  risk: string;
  liquidity: string;
  return_note: string;
  tax_in: string;
  tax_on_growth: string;
  tax_on_exit: string;
  tax_label: string;
  regime_benefit: "old" | "new" | "both" | "none";
  section: string | null;
  min_horizon_years: number;
  goal_types: string[];
  watch_outs: string[];
}
export interface CatalogResponse {
  as_of: string;
  fy: string;
  kinds: Record<string, string>;
  instruments: CatalogInstrument[];
  disclosure: string;
}
export interface TaxCalcResult extends Omit<TaxSection, "switches"> {
  after_tax_returns: { years: number; equity: number; debt: number; gold: number; liquid: number }[];
  pre_tax_returns: Record<string, number>;
  disclosure: string;
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
  shortlist_omitted?: boolean;
  /** Illustrative insurance-plan research shortlists (present when a cover gap exists). */
  insurance_suggestions?: InsuranceSuggestions | null;
  tax?: TaxSection | null;
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
    totals: { required_sip: number; allocated_sip: number; monthly_surplus: number; shortfall: number; tax_reinvested?: number };
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

/** One AMFI/SEBI reference record (scheme, AMC, benchmark, provenance, ...): raw snapshot fields. */
export type MfRefRow = Record<string, string | null>;

/** Everything the AMFI/SEBI static snapshot holds for one scheme (GET /api/funds/{code}/reference). */
export interface FundReference {
  scheme: MfRefRow;
  amc: MfRefRow | null;
  managers: MfRefRow[];
  benchmarks: MfRefRow[];
  category: MfRefRow | null;
  manager_changes: MfRefRow[];
  provenance: MfRefRow[];
}

export interface RollingStats {
  median: number | null;
  min: number | null;
  max: number | null;
  pct_positive: number | null;
  dispersion: number | null;
  n: number;
}

export interface DrawdownEpisode {
  peak_date: string;
  peak_nav: number;
  start_date: string;
  trough_date: string;
  trough_nav: number;
  recovery_date: string | null;
  recovery_nav: number | null;
  max_drop: number;
  months: number;
  recovered: boolean;
}

export interface DrawdownDuration {
  longest_underwater_months: number;
  max_drawdown: number;
  peak_date: string | null;
  peak_nav?: number | null;
  trough_date: string | null;
  trough_nav?: number | null;
  recovery_date?: string | null;
  recovery_nav?: number | null;
  longest_underwater?: DrawdownEpisode | null;
  episodes?: DrawdownEpisode[];
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

export interface CasHoldingItem {
  folio: string;
  scheme_name: string;
  isin: string;
  scheme_code: string | null;
  is_mapped: boolean;
  is_direct: boolean;
  plan: string;
  category: string;
  cat: string | null;
  asset_class: string;
  units: number;
  nav: number | null;
  invested_value?: number | null;
  current_value: number;
  valuation_date: string | null;
  cagr?: number | null;
  xirr: number | null;
  ret_1y?: number | null;
  cagr_3y?: number | null;
  cagr_5y?: number | null;
  tx_count: number;
  weight_pct: number;
}

export interface CasFolioItem {
  folio: string;
  amc: string;
  pan: string;
  current_value: number;
  schemes_count: number;
  xirr: number | null;
  schemes: CasHoldingItem[];
}

export interface CasBandComparisonRow {
  asset_class: string;
  target_pct: number;
  actual_pct: number;
  gap_pct: number;
  status: "overweight" | "underweight" | "aligned";
}

export interface CasAnalysisResult {
  statement_period?: { from: string; to: string };
  investor_name?: string;
  email?: string;
  cas_type?: string;
  file_type?: string;
  total_value: number;
  total_invested?: number | null;
  total_gain?: number | null;
  overall_xirr: number | null;
  folios_count: number;
  holdings_count: number;
  holdings: CasHoldingItem[];
  folios: CasFolioItem[];
  asset_allocation: Record<string, { value: number; pct: number; count: number }>;
  category_allocation: Record<string, { value: number; pct: number; count: number }>;
  plan_breakdown: {
    direct: { value: number; pct: number };
    regular: { value: number; pct: number };
    notice: string;
  };
  band_comparison?: {
    target_band: string;
    comparison: CasBandComparisonRow[];
  } | null;
  privacy_notice: string;
  disclaimer: string;
}

export interface RagSourceItem {
  scheme_code: string;
  scheme_name: string;
  amc: string;
  category: string;
  plan: string;
  data_quality: string;
}

export interface RagAnswerResult {
  query: string;
  answer: string;
  sources: RagSourceItem[];
  as_of: string;
  disclaimer: string;
}

export interface ExplainResponse {
  kind: "plan" | "fund" | "cas";
  explanation: string;
  ai_generated: boolean;
  provider: string;
}

/* ---------- Fund Horizon customer portal v1 ---------- */

export interface PortalGoal {
  name: string;
  type: string;
  target_date: string;
  target_amount: number;
  monthly_sip: number;
  required_sip: number;
  status: string;
  status_label: string;
  success_prob: number | null;
  progress_pct: number;
}

export interface PortalNextStep {
  kind: "emergency" | "term" | "health" | "goal";
  title: string;
  detail: string;
  disclaimer: string;
}

export interface PortalAlert {
  kind: string;
  text: string;
}

export interface PortalAllocation {
  equity: number;
  debt: number;
  gold: number;
  liquid: number;
}

export interface PortalDashboard {
  plan_id: string;
  client_name: string;
  as_of: string;
  declared_invested: number;
  declared_liquid: number;
  declared_portfolio_value: number;
  declared_label: string;
  monthly_sip_commitment: number;
  active_fund_count: number;
  risk_band: string;
  risk_score: number | null;
  allocation: PortalAllocation;
  goals: PortalGoal[];
  goal_inputs: Record<string, unknown>[];
  next_step: PortalNextStep;
  alerts: PortalAlert[];
}

export interface PortalHealthScore {
  goal_readiness: number;
  risk_alignment: number;
  diversification: number;
  sip_adequacy: number;
  emergency_readiness: number;
  overall: number;
}

export interface PortalImprovement {
  title: string;
  detail: string;
  disclaimer: string;
}

export interface PortalHealth {
  scores: PortalHealthScore;
  improvements: PortalImprovement[];
}

export interface PortalAnalytics {
  allocation: PortalAllocation;
  category_mix: { category: string; pct: number; sip: number }[];
  amc_mix: { amc: string; pct: number }[];
  fund_count: number;
  risk_band: string;
  top_category_pct: number;
}

export interface PortalPlanPatch {
  client?: Record<string, unknown>;
  goals?: Record<string, unknown>[];
  answers?: Record<string, number>;
}




export interface Customer {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: "customer" | "rm" | "admin" | "analyst" | "operations" | "read_only" | "compliance";
  is_staff?: boolean;
  status?: string;
  must_change_password?: boolean;
}

export interface SignupCustomerBody {
  name: string;
  email: string;
  mobile: string;
  password: string;
  consent: boolean;
}

export interface LoginCustomerBody {
  email: string;
  password: string;
}

export interface MyPlan {
  id: string;
  created_at: string;
  goal_count?: number;
  risk_band?: string;
  [key: string]: unknown;
}
