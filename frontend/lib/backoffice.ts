import type { OfficialForm } from "@/lib/officialForms";
import { ApiError, resolveApiUrl, API_URL } from "./api";
import type { PmsManagerProfile } from "./pms-managers";
import type { FundPeers } from "./types";

import type { InfoTipMeta } from "@/components/InfoTip";
import { isPmsRecommended, isMfRecommended } from "./recommended";

export interface BackofficeEnvelope<T> {
  data: T;
  as_of?: string;
  published_at?: string;
  fetched_at?: string;
  frequency?: string;
  availability: "ready" | "unavailable" | "blocked" | "needs_key" | "manual_only" | "schema_error";
  freshness: "current" | "stale" | "market_closed";
  quality_flags?: string[] | string;
  message?: string;
  coverage?: {
    priced_positions_paise?: number;
    unpriced_positions_count?: number;
    total_coverage_pct?: number;
  };
  method_version?: string;
  meta?: Record<string, InfoTipMeta>;
}

export interface MarketOverviewData {
  fx?: { rates?: Record<string, number>; as_of?: string; status?: string };
  fx_reference_rates?: Record<string, number>;
  fx_as_of?: string;
  volatility?: Record<string, number> | {
    vix?: number | null;
    india_vix?: number | null;
    vix_as_of?: string | null;
    india_vix_as_of?: string | null;
    as_of?: string;
    status?: string;
  };
  indices?: { "INDEX:IN:NIFTY50"?: number; "INDEX:IN:NIFTYBANK"?: number; "INDEX:IN:SENSEX"?: number; as_of?: string | null };
  flows?: { latest_date?: string | null; fii_net?: number | null; dii_net?: number | null; fii_prev?: number | null; dii_prev?: number | null; status?: string };
  vol_as_of?: string;
  series_meta?: Record<string, { as_of?: string | null; source?: string | null; value?: number | null; prev?: number | null; prev_as_of?: string | null }>;
  yields?: {
    in_10y?: number;
    in_2y?: number;
    us_10y?: number;
    us_2y?: number;
    india_us_spread_bps?: number;
    india_slope_bps?: number;
    us_slope_bps?: number;
    as_of?: string;
  };
  macro_proxy?: Record<string, number>;
  yield_spreads?: {
    india_us_10y_bps?: number;
    us_10y_2y_bps?: number;
    india_10y_2y_bps?: number;
  };
  sources_summary?: {
    total: number;
    ready: number;
    degraded: number;
    needs_key: number;
    manual_only: number;
  };
  sources_health?: { total: number; ready: number; status: string };
  recent_notes?: Array<{
    id: string;
    author_name: string;
    target_type: string;
    target_id: string;
    title: string;
    content: string;
    created_at: string;
  }>;
  active_watchlists?: Array<{
    id: string;
    name: string;
    item_type: string;
    item_id: string;
  }>;
  generated_at?: string;
}

export interface YieldsBoardData {
  india_message?: string;
  curves: Record<string, Record<string, { value: number; observed_at: string; source: string }>>;
  spreads: {
    in_us_10y_bps?: number;
    us_10y_2y_bps?: number;
    in_10y_2y_bps?: number;
  };
  as_of?: string;
}

export interface DerivativesData {
  live_status?: "live" | "stale" | "unavailable";
  notice?: string;
  underlying: string;
  underlying_price?: number;
  expiry_date?: string;
  snapshot_timestamp?: string;
  pcr_oi?: number;
  pcr_oi_reason?: string;
  pcr_volume?: number;
  max_pain_strike?: number;
  total_call_oi: number;
  total_put_oi: number;
  contracts: Array<{
    strike_price: number;
    option_type: "CE" | "PE";
    oi: number;
    oi_change?: number;
    volume: number;
    implied_volatility?: number;
    expiry_date: string;
  }>;
}

export interface FlowsData {
  daily: Array<{
    id?: string;
    report_date: string;
    category: string;
    segment: string;
    buy_crore?: number;
    sell_crore?: number;
    net_crore?: number;
    provisional: boolean;
  }>;
  fii_net_crore?: number;
  dii_net_crore?: number;
  cumulative_7d_net_crore?: number;
  sessions?: number;
  as_of?: string;
  fetched_at?: string;
  is_stale?: boolean;
  age_days?: number;
  last_trading_day?: string;
  error?: string;
  availability?: string;
}

export interface BriefingItem {
  text?: string;
  value?: string;
  change?: string;
  change_pct?: number | null;
  direction?: "up" | "down" | "flat";
  so_what?: string;
  as_of?: string;
  source?: string;
  source_url?: string;
  link?: string;
  stale?: boolean;
}

export interface BriefingSection {
  key: string;
  title: string;
  items: BriefingItem[];
  note?: string;
}

export interface BriefingFreshness {
  source?: string;
  last_ok?: string;
  age_hours?: number | null;
  stale?: boolean;
}

export interface BriefingPayload {
  brief_date: string;
  generated_at: string;
  version: number;
  sections: BriefingSection[];
  freshness: BriefingFreshness[];
}

export interface SourceItem {
  id: string;
  name: string;
  official_docs_url: string;
  adapter_id: string;
  adapter_version: string;
  terms_notes: string;
  configured_permissions: string;
  enabled: number;
  rate_budget: number;
  timezone: string;
  supported_frequency: string;
  health_status: "ready" | "pending" | "unavailable" | "blocked" | "needs_key" | "manual_only" | "schema_error";
  last_attempt_at?: string;
  last_success_at?: string;
  error_message?: string;
}

export interface SourceHealthData {
  sources: SourceItem[];
  summary: {
    total: number;
    ready: number;
    degraded: number;
    needs_key: number;
    manual_only: number;
    pending: number;
  };
}

export interface CompareMetrics {
  ret_1y: number | null;
  ret_3y: number | null;
  ret_5y: number | null;
  ret_si: number | null;
  cagr: number | null;
  std_dev: number | null;
  sharpe: number | null;
  sortino: number | null;
  alpha: number | null;
  beta: number | null;
  max_dd: number | null;
  up_capture: number | null;
  down_capture: number | null;
  ter: number | null;
  aum: number | null;
  nav_or_min_ticket: number | null;
  manager: string | null;
  // Numeric years from the backend (V1 live-check fix: the old mapping ran this
  // through str(), which drops numbers, so every tenure rendered "—").
  manager_tenure: number | string | null;
  quartile: number | null;
  // "dataset" = the dataset 3Y values matching the research row/dialog;
  // "live-nav" = computed live from NAV where the dataset value is missing.
  sharpe_source?: string | null;
}

export interface ComparePayload {
  type: "mf" | "pms";
  items: Array<{
    id: string;
    name: string;
    category: string | null;
    amc_or_manager: string | null;
    inception: string | null;
    metrics: CompareMetrics;
    series: [string, number][];
  }>;
  benchmark: { name: string; series: [string, number][] };
  meta: { fetched_at: string; source: string };
}

export interface PmsStrategyItem {
  id?: string;
  ia_id?: string;
  provider_name: string;
  strategy_name: string;
  investment_approach?: string;
  strategy_type?: string;
  service_type?: string;
  aum_crore?: number;
  min_investment?: string;
  inception_date?: string;
  principal_officer?: string;
  return_1m_pct?: number;
  return_3m_pct?: number;
  return_6m_pct?: number;
  return_1y_pct?: number;
  return_3y_cagr_pct?: number;
  return_5y_cagr_pct?: number;
  return_since_inception_pct?: number;
  benchmark_name?: string;
  report_month?: string;
  is_fh_recommended?: boolean;
  fh_score?: number | null;
  fh_rating?: number | null;
  fh_signal?: "Buy" | "Hold" | "Sell" | "Needs review";
  fh_signal_reasons?: string[];
  fh_status?: string;
  missing_inputs?: string[];
}

export interface PmsMatrixItem {
  ia_id: string;
  strategy_name: string;
  provider: string;
  benchmark: string;
  as_on?: string;
  aum_crore?: number;
  inception_date?: string;
  fund_manager?: string;
  monthly_history: boolean;
  turnover_disclosed: boolean;
  fees_disclosed: boolean;
  public_factsheet: boolean;
  score?: number | null;
  rating?: number | null;
  signal: "Buy" | "Hold" | "Sell" | "Needs review";
  reasons: string[];
  missing_inputs: string[];
}

export interface PmsAttributionResult {
  status: string;
  methodology: string;
  portfolio_return: number;
  benchmark_return: number;
  active_return: number;
  allocation_effect: number;
  selection_effect: number;
  interaction_effect: number;
  sum_effects: number;
  residual: number;
  sectors: Array<{
    sector: string;
    portfolio_weight: number;
    benchmark_weight: number;
    portfolio_return: number;
    benchmark_return: number;
    allocation_effect: number;
    selection_effect: number;
    interaction_effect: number;
    total_effect: number;
  }>;
}

export interface PmsUploadResult {
  status: string;
  document: {
    document_type: string;
    strategy_name: string;
    provider: string;
    matched_ia_id?: string | null;
    valuation_date?: string | null;
    current_value?: number | null;
    holdings_count: number;
    holdings: Array<{ security: string; weight_pct: number; value?: number | null }>;
  };
  contributions: Array<{ security: string; sector: string; weight: number; return: number; contribution: number }>;
  attribution?: PmsAttributionResult | null;
}

export const getPmsMatrix = async (): Promise<{ as_on?: string; data: PmsMatrixItem[] }> => {
  return (await boFetch<{ as_on?: string; data: PmsMatrixItem[] }>("/api/backoffice/pms/matrix"));
};

export const uploadPmsDocument = async (file: File, password = ""): Promise<PmsUploadResult> => {
  const form = new FormData();
  form.append("file", file);
  if (password) form.append("password", password);

  const res = await fetch("/api/backoffice/pms/upload-document", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.detail || "Failed to parse PMS document.");
  }
  return res.json();
};

// Curated "FH Recommended" picks, identified by APMI strategy id. Only the flag is stored here:
// every number shown for them comes from the live APMI feed.
export const FH_RECOMMENDED_IA_IDS = new Set([
  "174", // Stallion Asset Core Fund
  "781", // ICICI Prudential PMS Value Strategy
  "606", // Buoyant Opportunities PMS
  "1193", // Carnelian Capital Compounder Strategy
  "2512", // Abakkus Emerging Opportunities Approach
  "731", // 360 ONE Multicap PMS
  "325", // Sundaram S.E.L.F
  "324", // Sundaram SISOP
  "327", // Sundaram Rising Star
]);

export interface PmsProviderItem {
  apmi_id: string;
  name: string;
  strategy_count: number;
  total_aum_crore: number;
  strategy_types: string[];
}

export interface PmsPositionItem {
  symbol?: string;
  asset_name?: string;
  asset_class?: string;
  quantity?: number;
  market_value_paise: number;
  valuation_date: string;
}

export interface PmsAccountTrackerData {
  account_id: string;
  customer_id: string;
  current_valuation_paise?: number;
  xirr?: {
    xirr_pct?: number | null;
    status: string;
  };
  modified_dietz?: {
    return_pct?: number | null;
  };
  hwm_fee?: {
    hwm_exceeded: boolean;
    estimated_fee_paise: number;
  };
  holdings_coverage?: {
    total_coverage_pct: number;
  };
  positions: PmsPositionItem[];
}

export interface MutualFundItem {
  scheme_code: string;
  scheme_name: string;
  amc_name?: string;
  category?: string;
  cat_key?: string; // screener category key, used to look up Advisorkhoj quartiles
  benchmark?: string;
  plan?: string;
  option?: string;
  latest_nav?: number | string;
  nav_date?: string;
  ter_pct?: number | string;
  isin_growth?: string;
  isin_div?: string;
  ter_as_of?: string;
  is_fh_recommended?: boolean;
}

export interface FactsheetItem {
  id: number;
  period: string;
  title: string;
  url: string;
}

export interface FactsheetResult {
  source?: string;
  noPublic?: boolean;
  items: FactsheetItem[];
}

/** Official factsheets for a curated fund (kind "mf", AMFI code) or PMS strategy (kind "pms", APMI id). */
export const getFactsheets = async (kind: "mf" | "pms", id: string): Promise<FactsheetResult> => {
  const raw = await boFetch<Json>(`/api/backoffice/factsheets?kind=${kind}&id=${encodeURIComponent(id)}`);
  const d = obj(raw.data);
  return {
    source: str(d.source),
    noPublic: d.no_public === true,
    items: arr(d.items).flatMap((i) => (num(i.id) !== undefined && str(i.url) ? [{ id: num(i.id) as number, period: str(i.period) ?? "", title: str(i.title) ?? "Factsheet", url: str(i.url) as string }] : [])),
  };
};

export interface MfPerformance {
  publicPage: boolean;
  metrics: Record<string, number | string | undefined>;
  history: Array<{ date: string; nav?: number; r1m?: number; r1y?: number; r3y?: number; r5y?: number }>;
  as_of?: string;
  benchmark?: { name?: string; proxy_name?: string; history: Array<{ date: string; nav: number }> } | null;
}

/** Returns null for schemes outside the performance dataset (IDCW/payout options, closed-ended). */
export const getMutualFundPerformance = async (code: string): Promise<MfPerformance | null> => {
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/${encodeURIComponent(code)}/performance`);
  const d = obj(raw.data);
  if (!raw.data) return null;
  const metrics: MfPerformance["metrics"] = {};
  for (const [k, v] of Object.entries(obj(d.metrics))) metrics[k] = typeof v === "number" || typeof v === "string" ? v : undefined;
  return {
    publicPage: d.public_page === true,
    metrics,
    history: arr(d.history).map((h) => ({ date: str(h.date) ?? "", nav: num(h.nav), r1m: num(h.r1m), r1y: num(h.r1y), r3y: num(h.r3y), r5y: num(h.r5y) })),
    as_of: str(raw.as_of),
    benchmark: d.benchmark
      ? {
          name: str(obj(d.benchmark).name),
          proxy_name: str(obj(d.benchmark).proxy_name),
          history: arr(obj(d.benchmark).history).flatMap((h) => (str(h.date) && num(h.nav) !== undefined ? [{ date: str(h.date) as string, nav: num(h.nav) as number }] : [])),
        }
      : null,
  };
};

export interface MfManagerInfo {
  manager_name: string;
  manager_start?: string;
  tenure_years?: number;
}

/** Null when no manager is on file for the scheme. */
export const getMfManager = async (code: string): Promise<MfManagerInfo | null> => {
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/${encodeURIComponent(code)}/manager`);
  const d = obj(raw.data);
  const name = str(d.manager_name);
  return name ? { manager_name: name, manager_start: str(d.manager_start), tenure_years: num(d.tenure_years) } : null;
};

export interface MfManagedFund {
  scheme_code: string;
  scheme_name: string;
  category?: string;
  manager_start?: string;
  tenure_cagr?: number;
  ret_1y?: number;
  cagr_3y?: number;
  cagr_5y?: number;
  max_drawdown_3y?: number;
  sharpe_3y?: number;
}

export const getOfficialForms = async (): Promise<OfficialForm[]> =>
  (await boFetch<{ data: OfficialForm[] }>("/api/backoffice/operations/official-forms")).data;

export const getMfManagerProfile = async (name: string): Promise<{ name: string; profile: PmsManagerProfile | null; funds: MfManagedFund[] }> => {
  const raw = await boFetch<Json>(`/api/backoffice/mutual-fund-managers/profile?name=${encodeURIComponent(name)}`);
  const d = obj(raw.data);
  return {
    name: str(d.name) ?? name,
    profile: d.profile ? (d.profile as unknown as PmsManagerProfile) : null,
    funds: arr(d.funds).map((f) => ({
      scheme_code: str(f.scheme_code) ?? "",
      scheme_name: str(f.scheme_name) ?? "",
      category: str(f.category),
      manager_start: str(f.manager_start),
      tenure_cagr: num(f.tenure_cagr),
      ret_1y: num(f.ret_1y),
      cagr_3y: num(f.cagr_3y),
      cagr_5y: num(f.cagr_5y),
      max_drawdown_3y: num(f.max_drawdown_3y),
      sharpe_3y: num(f.sharpe_3y),
    })),
  };
};

export interface MfNavPair {
  growth_code: string;
  growth_name: string;
  idcw_code: string;
  idcw_name: string;
  nav: number;
  nav_date?: string;
  amc?: string;
}

/** Growth/IDCW pairs sharing an identical latest NAV — data QA. */
export const getMfNavPairCheck = async (limit = 50): Promise<MfNavPair[]> => {
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/nav-pair-check?limit=${limit}`);
  return arr(raw.data).map((p) => ({
    growth_code: String(p.growth_code ?? ""),
    growth_name: str(p.growth_name) ?? "",
    idcw_code: String(p.idcw_code ?? ""),
    idcw_name: str(p.idcw_name) ?? "",
    nav: num(p.nav) ?? 0,
    nav_date: str(p.nav_date),
    amc: str(p.amc),
  }));
};

export interface MutualFundsTrackerResult extends BackofficeEnvelope<MutualFundItem[]> {
  recommended_count: number;
  total: number;
  limit: number;
  offset: number;
  facets: { amcs: string[]; categories: string[]; plan_counts: Record<string, number> };
}

export interface NewsItem {
  id: string;
  source_id: string;
  source_name: string;
  category: string;
  title: string;
  link: string;
  summary: string;
  published_at?: string;
}

export interface WatchlistItem {
  id: string;
  name: string;
  item_type: string;
  item_id: string;
  scope?: string;
}

export interface ResearchNoteItem {
  id: string;
  target_type: string;
  target_id: string;
  title: string;
  content: string;
  author_name?: string;
  created_at: string;
}

export interface ImportJobData {
  import_type: string;
  file_name: string;
  csv_content: string;
  valid_rows_count: number;
  error_rows_count: number;
  errors?: Array<{ row: number; error: string }>;
  /** Set when the file as a whole is rejected (bad headers, unsupported type, empty). */
  fatal_error?: string;
}

export interface StaffMemberItem {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status?: string;
  is_staff?: number | boolean;
  pages?: string[];
}

export interface StaffProvisionResponse {
  staff_member: StaffMemberItem;
  temporary_password: string | null;
  /** "created" or "promoted" (an existing account given staff access). */
  action?: string;
}

type Json = Record<string, unknown>;

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});

type Availability = BackofficeEnvelope<unknown>["availability"];
const AVAILABILITY: Availability[] = ["ready", "unavailable", "blocked", "needs_key", "manual_only", "schema_error"];
const FRESHNESS: BackofficeEnvelope<unknown>["freshness"][] = ["current", "stale", "market_closed"];

function availabilityOf(v: unknown, fallback: Availability = "ready"): Availability {
  return AVAILABILITY.includes(v as Availability) ? (v as Availability) : fallback;
}
function freshnessOf(v: unknown): BackofficeEnvelope<unknown>["freshness"] {
  return FRESHNESS.includes(v as BackofficeEnvelope<unknown>["freshness"])
    ? (v as BackofficeEnvelope<unknown>["freshness"])
    : "current";
}

/** Wrap a response in the envelope the pages expect, tolerating envelopes that are partly missing. */
function envelope<T>(raw: Json, data: T, fallbackAvailability: Availability = "ready"): BackofficeEnvelope<T> {
  const flags = raw.quality_flags;
  return {
    data,
    as_of: str(raw.as_of),
    published_at: str(raw.published_at),
    fetched_at: str(raw.fetched_at),
    frequency: str(raw.frequency),
    availability: availabilityOf(raw.availability, fallbackAvailability),
    freshness: freshnessOf(raw.freshness),
    quality_flags: typeof flags === "string" || Array.isArray(flags) ? (flags as string[] | string) : undefined,
    method_version: str(raw.method_version),
    message: str(raw.message),
    meta: (raw.meta && typeof raw.meta === "object") ? (raw.meta as Record<string, InfoTipMeta>) : undefined,
  };
}

async function boFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const targetUrl = resolveApiUrl(`${API_URL}${path}`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "sec-fetch-site": "same-origin",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(targetUrl, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let msg = `Backoffice request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* fallback */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const getBackofficeOverview = async (): Promise<BackofficeEnvelope<MarketOverviewData>> => {
  const raw = await boFetch<Json>("/api/backoffice/overview");
  return envelope(raw, obj(raw.data) as MarketOverviewData);
};

export interface SeriesPoint {
  observed_at: string;
  value: number;
}

export const getObservationSeries = async (instrumentId: string): Promise<SeriesPoint[]> => {
  const raw = await boFetch<Json>(`/api/backoffice/series/${encodeURIComponent(instrumentId)}`);
  return arr(raw.data).flatMap((r) => {
    const value = num(r.value);
    return value === undefined ? [] : [{ observed_at: str(r.observed_at) ?? "", value }];
  });
};

export const getYieldsBoard = async (): Promise<BackofficeEnvelope<YieldsBoardData>> => {
  const raw = await boFetch<Json>("/api/backoffice/yields");
  const d = obj(raw.data);
  const asOf = str(d.as_of) ?? str(raw.as_of);
  const toCurve = (rows: unknown, source: string) => {
    const curve: Record<string, { value: number; observed_at: string; source: string }> = {};
    for (const r of arr(rows)) {
      const tenor = str(r.tenor);
      const value = num(r.yield_pct);
      if (tenor && value !== undefined) {
        curve[tenor] = { value, observed_at: str(r.observed_at) ?? asOf ?? "—", source: str(r.source) ?? source };
      }
    }
    return curve;
  };
  const inSummary = obj(d.india_summary);
  const usSummary = obj(d.us_summary);
  const cross = obj(d.india_us_10y_spread);
  const data: YieldsBoardData = {
    curves: { IN: toCurve(d.india_curve, "India G-Sec"), US: toCurve(d.us_curve, "US Treasury") },
    spreads: {
      in_us_10y_bps: num(cross.spread_bps),
      us_10y_2y_bps: num(usSummary.slope_10y_2y_bps),
      in_10y_2y_bps: num(inSummary.slope_10y_2y_bps),
    },
    india_message: str(d.india_message),
    as_of: asOf,
  };
  return envelope(raw, data, "unavailable");
};

export const getDerivatives = async (underlying = "NIFTY", expiry?: string, signal?: AbortSignal): Promise<BackofficeEnvelope<DerivativesData>> => {
  const q = new URLSearchParams({ underlying });
  if (expiry) q.set("expiry", expiry);
  const raw = await boFetch<Json>(`/api/backoffice/derivatives?${q.toString()}`, { signal });
  const d = obj(raw.data);
  const pcr = obj(d.pcr);
  const selectedExpiry = str(d.selected_expiry);
  const contracts = arr(d.contracts).map((c) => ({
    strike_price: num(c.strike_price) ?? 0,
    option_type: (c.option_type === "PE" ? "PE" : "CE") as "CE" | "PE",
    oi: num(c.oi) ?? 0,
    oi_change: num(c.oi_change),
    volume: num(c.volume) ?? 0,
    implied_volatility: num(c.implied_vol) ?? num(c.implied_volatility),
    expiry_date: str(c.expiry_date) ?? "",
  }));
  const data: DerivativesData = {
    underlying: str(d.underlying) ?? underlying,
    underlying_price: num(d.underlying_price),
    expiry_date: selectedExpiry,
    snapshot_timestamp: str(d.snapshot_timestamp),
    pcr_oi: num(pcr.pcr_oi),
    pcr_oi_reason: str(pcr.pcr_oi_reason),
    live_status: (str(d.live_status) as DerivativesData["live_status"]) ?? undefined,
    notice: str(d.message),
    pcr_volume: num(pcr.pcr_volume),
    max_pain_strike: num(d.max_pain),
    total_call_oi: num(pcr.total_call_oi) ?? 0,
    total_put_oi: num(pcr.total_put_oi) ?? 0,
    contracts,
  };
  return envelope(raw, data, "unavailable");
};

export const getFlows = async (start?: string, end?: string): Promise<BackofficeEnvelope<FlowsData>> => {
  const q = new URLSearchParams();
  if (start) q.set("from", start);
  if (end) q.set("to", end);
  const qs = q.toString();
  const raw = await boFetch<Json>(`/api/backoffice/flows${qs ? `?${qs}` : ""}`);
  const rows = Array.isArray(raw.data) ? arr(raw.data) : arr(obj(raw.data).daily);
  const daily: FlowsData["daily"] = rows.map((r) => ({
    id: str(r.id),
    report_date: str(r.report_date) ?? "—",
    category: str(r.category) ?? "—",
    segment: str(r.segment) ?? "—",
    buy_crore: num(r.gross_buy),
    sell_crore: num(r.gross_sell),
    net_crore: num(r.net),
    provisional: r.status !== "final",
  }));
  // Rows arrive newest first. "Latest session" = most recent date reported per category.
  const latestOf = (cat: string) => daily.find((r) => r.category.toUpperCase() === cat)?.net_crore;
  const dates = Array.from(new Set(daily.map((r) => r.report_date)));
  const data: FlowsData = {
    daily,
    fii_net_crore: latestOf("FII"),
    dii_net_crore: latestOf("DII"),
    sessions: dates.length,
    as_of: str(raw.as_of) || daily[0]?.report_date,
    fetched_at: str(raw.fetched_at),
    is_stale: Boolean(raw.is_stale) || raw.freshness === "stale",
    age_days: num(raw.age_days),
    last_trading_day: str(raw.last_trading_day),
    error: str(raw.error),
    availability: str(raw.availability),
  };
  return envelope(raw, data, "unavailable");
};

export interface PmsBenchmarkData {
  id: string;
  name: string;
  category: string;
  return_1m: number;
  return_3m: number;
  return_6m: number;
  return_1y: number;
  return_3y: number;
  return_since_inception: number;
}

export const PMS_BENCHMARKS: Record<string, PmsBenchmarkData> = {
  "BSE 500 TRI": {
    id: "bse_500",
    name: "BSE 500 TRI",
    category: "Broad Market",
    return_1m: -5.57,
    return_3m: -3.59,
    return_6m: 8.07,
    return_1y: -2.33,
    return_3y: 9.20,
    return_since_inception: 13.72,
  },
  "NIFTY 50 TRI": {
    id: "nifty_50",
    name: "NIFTY 50 TRI",
    category: "Large Cap",
    return_1m: -6.22,
    return_3m: -4.10,
    return_6m: 6.85,
    return_1y: -0.85,
    return_3y: 11.45,
    return_since_inception: 14.10,
  },
  "NIFTY MIDCAP 150 TRI": {
    id: "nifty_midcap_150",
    name: "NIFTY MIDCAP 150 TRI",
    category: "Mid Cap",
    return_1m: -5.10,
    return_3m: -2.90,
    return_6m: 9.40,
    return_1y: 5.20,
    return_3y: 18.60,
    return_since_inception: 16.80,
  },
  "NIFTY SMALLCAP 250 TRI": {
    id: "nifty_smallcap_250",
    name: "NIFTY SMALLCAP 250 TRI",
    category: "Small Cap",
    return_1m: -4.80,
    return_3m: -2.20,
    return_6m: 11.10,
    return_1y: 7.40,
    return_3y: 19.80,
    return_since_inception: 17.20,
  },
  "BSE 200 TRI": {
    id: "bse_200",
    name: "BSE 200 TRI",
    category: "Large & Mid Cap",
    return_1m: -5.80,
    return_3m: -3.80,
    return_6m: 7.40,
    return_1y: -1.50,
    return_3y: 10.80,
    return_since_inception: 13.90,
  },
};

export interface PmsScreeningBreakdown {
  score?: number;
  rating?: number;
  signal: "Buy" | "Hold" | "Sell" | "Needs review";
  reasons: string[];
  benchName: string;
  benchPerf: PmsBenchmarkData;
  alpha1y?: number;
  benchPoints1y: number;
  alpha3y?: number;
  benchPoints3y: number;
  totalBenchPoints: number; // Max 40
  validHorizonsCount: number;
  positiveHorizonsCount: number;
  consistencyRatio: number;
  totalConsistencyPoints: number; // Max 30
  downsideResiliencePoints: number;
  aumScalePoints: number;
  totalDownsidePoints: number; // Max 30
  rawScore: number;
}

export function evaluatePmsScreening(
  item: {
    return_1m_pct?: number;
    return_3m_pct?: number;
    return_6m_pct?: number;
    return_1y_pct?: number;
    return_3y_cagr_pct?: number;
    aum_crore?: number;
  },
  selectedBenchmark = "BSE 500 TRI"
): PmsScreeningBreakdown {
  const bench = PMS_BENCHMARKS[selectedBenchmark] || PMS_BENCHMARKS["BSE 500 TRI"];
  const b1m = bench.return_1m;
  const b1y = bench.return_1y;
  const b3y = bench.return_3y;

  const r1m = item.return_1m_pct;
  const r3m = item.return_3m_pct;
  const r6m = item.return_6m_pct;
  const r1y = item.return_1y_pct;
  const r3y = item.return_3y_cagr_pct;
  const aum = item.aum_crore;

  const reasons: string[] = [];

  if (r1y === undefined || r3y === undefined) {
    return {
      signal: "Needs review",
      reasons: ["Insufficient 3-year performance history to compute reliable screening signal."],
      benchName: bench.name,
      benchPerf: bench,
      benchPoints1y: 0,
      benchPoints3y: 0,
      totalBenchPoints: 0,
      validHorizonsCount: 0,
      positiveHorizonsCount: 0,
      consistencyRatio: 0,
      totalConsistencyPoints: 0,
      downsideResiliencePoints: 0,
      aumScalePoints: 0,
      totalDownsidePoints: 0,
      rawScore: 0,
    };
  }

  // 1. Benchmark-relative performance (40 pts max)
  let benchPoints1y = 0;
  const alpha1y = r1y - b1y;
  if (alpha1y >= 10) {
    benchPoints1y = 20;
    reasons.push(`1Y return (${r1y.toFixed(1)}%) outperforms ${bench.name} (${b1y.toFixed(1)}%) by +${alpha1y.toFixed(1)}pp.`);
  } else if (alpha1y >= 0) {
    benchPoints1y = 14 + (alpha1y / 10) * 6;
    reasons.push(`1Y return (${r1y.toFixed(1)}%) beats ${bench.name} by +${alpha1y.toFixed(1)}pp.`);
  } else if (alpha1y >= -5) {
    benchPoints1y = 8;
    reasons.push(`1Y return (${r1y.toFixed(1)}%) trails ${bench.name} (${b1y.toFixed(1)}%) slightly (${alpha1y.toFixed(1)}pp).`);
  } else {
    benchPoints1y = 3;
    reasons.push(`1Y return (${r1y.toFixed(1)}%) lags ${bench.name} (${b1y.toFixed(1)}%) by ${alpha1y.toFixed(1)}pp.`);
  }

  let benchPoints3y = 0;
  const alpha3y = r3y - b3y;
  if (alpha3y >= 10) {
    benchPoints3y = 20;
    reasons.push(`3Y CAGR (${r3y.toFixed(1)}%) shows strong active outperformance (+${alpha3y.toFixed(1)}pp vs benchmark).`);
  } else if (alpha3y >= 0) {
    benchPoints3y = 14 + (alpha3y / 10) * 6;
    reasons.push(`3Y CAGR (${r3y.toFixed(1)}%) exceeds ${bench.name} (${b3y.toFixed(1)}%) by +${alpha3y.toFixed(1)}pp.`);
  } else if (alpha3y >= -5) {
    benchPoints3y = 8;
    reasons.push(`3Y CAGR (${r3y.toFixed(1)}%) trails ${bench.name} (${b3y.toFixed(1)}%) by ${alpha3y.toFixed(1)}pp.`);
  } else {
    benchPoints3y = 2;
    reasons.push(`3Y CAGR (${r3y.toFixed(1)}%) lags ${bench.name} by ${alpha3y.toFixed(1)}pp.`);
  }
  const totalBenchPoints = benchPoints1y + benchPoints3y;

  // 2. Consistency across rolling/trailing periods (30 pts max)
  const validPeriods = [r1m, r3m, r6m, r1y, r3y].filter((v): v is number => v !== undefined);
  let totalConsistencyPoints = 0;
  let consistencyRatio = 0;
  let positiveCount = 0;
  if (validPeriods.length >= 3) {
    positiveCount = validPeriods.filter((v) => v > 0).length;
    consistencyRatio = positiveCount / validPeriods.length;
    totalConsistencyPoints = consistencyRatio * 30;
    if (consistencyRatio >= 0.6) {
      reasons.push(`Consistent performance with positive returns across ${positiveCount} of ${validPeriods.length} reported horizons.`);
    }
  }

  // 3. Downside protection & operational scale (30 pts max)
  let downsideResiliencePoints = 0;
  if (r1m !== undefined) {
    if (b1m < 0) {
      if (r1m > b1m) {
        downsideResiliencePoints = 15;
        reasons.push(`Demonstrated downside protection in 1M correction (${r1m.toFixed(1)}% vs ${b1m.toFixed(1)}%).`);
      } else {
        downsideResiliencePoints = 5;
      }
    } else {
      downsideResiliencePoints = 10;
    }
  }

  let aumScalePoints = 0;
  if (aum !== undefined && aum > 0) {
    if (aum >= 1000) aumScalePoints = 15;
    else if (aum >= 200) aumScalePoints = 10;
    else aumScalePoints = 5;
  }
  const totalDownsidePoints = downsideResiliencePoints + aumScalePoints;

  const rawScore = Math.min(100, Math.max(0, totalBenchPoints + totalConsistencyPoints + totalDownsidePoints));
  const score = Math.round(rawScore * 10) / 10;
  let rating = 1;
  let signal: "Buy" | "Hold" | "Sell" = "Sell";
  if (rawScore >= 80) {
    rating = 5;
    signal = "Buy";
  } else if (rawScore >= 65) {
    rating = 4;
    signal = "Buy";
  } else if (rawScore >= 50) {
    rating = 3;
    signal = "Hold";
  } else if (rawScore >= 35) {
    rating = 2;
    signal = "Sell";
  }

  return {
    score,
    rating,
    signal,
    reasons: reasons.slice(0, 3),
    benchName: bench.name,
    benchPerf: bench,
    alpha1y,
    benchPoints1y,
    alpha3y,
    benchPoints3y,
    totalBenchPoints,
    validHorizonsCount: validPeriods.length,
    positiveHorizonsCount: positiveCount,
    consistencyRatio,
    totalConsistencyPoints,
    downsideResiliencePoints,
    aumScalePoints,
    totalDownsidePoints,
    rawScore,
  };
}

/** One backend PMS strategy row -> UI item. APMI rows with no AUM often carry placeholder 0.00% returns: treat as missing. */
const mapPmsRow = (r: Json, asOn = ""): PmsStrategyItem => {
  const aum = num(r.aum_crore);
  const ret = (v: unknown) => {
    const n = num(v);
    return n === 0 && !aum ? undefined : n;
  };
  const benchName = str(r.benchmark) ?? str(r.benchmark_name) ?? "BSE 500 TRI";
  const r1m = ret(r.return_1m);
  const r3m = ret(r.return_3m);
  const r6m = ret(r.return_6m);
  const r1y = ret(r.return_1y);
  const r3y = ret(r.return_3y);
  const r5y = ret(r.return_5y);
  const rsi = ret(r.return_since_inception);

  const evalRes = evaluatePmsScreening(
    { return_1m_pct: r1m, return_3m_pct: r3m, return_6m_pct: r6m, return_1y_pct: r1y, return_3y_cagr_pct: r3y, aum_crore: aum },
    benchName
  );
  const score = num(r.fh_score) ?? evalRes.score;
  const rating = num(r.fh_rating) ?? evalRes.rating;
  const sig = (str(r.fh_signal) as PmsStrategyItem["fh_signal"]) ?? evalRes.signal;
  const reasons = Array.isArray(r.fh_signal_reasons) && r.fh_signal_reasons.length > 0
    ? (r.fh_signal_reasons as string[])
    : evalRes.reasons;

  return {
    id: str(r.ia_id) || `${str(r.provider) ?? "—"}::${str(r.strategy_name) ?? "—"}`,
    provider_name: str(r.provider) ?? "—",
    strategy_name: str(r.strategy_name) ?? "—",
    investment_approach: str(r.strategy_type),
    strategy_type: str(r.strategy_type),
    service_type: str(r.service_type),
    ia_id: str(r.ia_id),
    principal_officer: str(r.principal_officer),
    min_investment: str(r.min_investment) ?? "₹50,00,000",
    aum_crore: aum,
    return_1m_pct: r1m,
    return_3m_pct: r3m,
    return_6m_pct: r6m,
    return_1y_pct: r1y,
    return_3y_cagr_pct: r3y,
    return_5y_cagr_pct: r5y,
    return_since_inception_pct: rsi,
    benchmark_name: benchName,
    report_month: str(r.as_on) ?? asOn,
    fh_score: score,
    fh_rating: rating,
    fh_signal: sig,
    fh_signal_reasons: reasons,
    fh_status: str(r.fh_status) ?? (score != null ? "screened" : "incomplete_inputs"),
    missing_inputs: Array.isArray(r.missing_inputs) ? (r.missing_inputs as string[]) : [],
  };
};

/** Strategies run by one APMI fund manager (APMI lists managers per strategy page, so the backend checks the firm's strategies). */
export const getPmsManager = async (name: string, provider: string): Promise<{ experience?: string; strategies: PmsStrategyItem[] }> => {
  const raw = await boFetch<Json>(`/api/backoffice/pms/manager?name=${encodeURIComponent(name)}&provider=${encodeURIComponent(provider)}`);
  const d = obj(raw.data);
  return { experience: str(d.experience), strategies: arr(d.strategies).map((r) => mapPmsRow(r)) };
};

export const getPmsStrategies = async (): Promise<BackofficeEnvelope<PmsStrategyItem[]>> => {
  let raw: Json = {};
  let apiItems: PmsStrategyItem[] = [];
  let asOn = "";
  try {
    raw = await boFetch<Json>("/api/backoffice/pms/strategies");
    asOn = str(raw.as_on) || "";
    apiItems = arr(raw.data).map((r) => mapPmsRow(r, asOn));
  } catch {
    // boFetch failure fallback
  }

  const merged = apiItems.map((item) => ({ ...item, is_fh_recommended: !!item.ia_id && (FH_RECOMMENDED_IA_IDS.has(item.ia_id) || isPmsRecommended(item.ia_id)) }));

  const env = envelope(raw, merged, merged.length > 0 ? "ready" : "unavailable");
  env.as_of = asOn || "Latest";
  return env;
};

export const getPmsProviders = async (): Promise<BackofficeEnvelope<PmsProviderItem[]>> => {
  const raw = await boFetch<Json>("/api/backoffice/pms/providers");
  const data = arr(raw.data).map<PmsProviderItem>((p) => ({
    apmi_id: String(p.apmi_id ?? ""),
    name: str(p.name) ?? "—",
    strategy_count: num(p.strategy_count) ?? 0,
    total_aum_crore: num(p.total_aum_crore) ?? 0,
    strategy_types: (str(p.strategy_types) ?? "").split(",").filter(Boolean),
  }));
  const env = envelope(raw, data, "unavailable");
  env.as_of = str(raw.as_on);
  return env;
};

export const getPmsAccountTracker = async (id: string): Promise<BackofficeEnvelope<PmsAccountTrackerData>> => {
  const raw = await boFetch<Json>(`/api/backoffice/pms/accounts/${encodeURIComponent(id)}/tracker`);
  const d = obj(raw.data);
  const positions = arr(d.positions).map<PmsPositionItem>((p) => ({
    symbol: str(p.symbol),
    asset_name: str(p.asset_name),
    asset_class: str(p.asset_class),
    quantity: num(p.quantity),
    market_value_paise: num(p.market_value_paise) ?? 0,
    valuation_date: str(p.valuation_date) ?? "—",
  }));
  const xirr = obj(d.xirr);
  const dietz = obj(d.modified_dietz);
  const fee = obj(d.hwm_fee);
  const cov = obj(d.holdings_coverage);
  const data: PmsAccountTrackerData = {
    account_id: str(d.id) ?? id,
    customer_id: str(d.customer_id) ?? "",
    current_valuation_paise: num(d.current_valuation_paise),
    xirr: { xirr_pct: num(xirr.xirr_pct) ?? null, status: str(xirr.status) ?? "unknown" },
    modified_dietz: { return_pct: num(dietz.return_pct) ?? null },
    hwm_fee: {
      hwm_exceeded: fee.hwm_exceeded === true,
      estimated_fee_paise: num(fee.estimated_fee_paise) ?? 0,
    },
    holdings_coverage: { total_coverage_pct: num(cov.total_coverage_pct) ?? 100 },
    positions,
  };
  return envelope(raw, data);
};

export const getMutualFundsTracker = async (opts?: {
  search?: string;
  amc?: string;
  category?: string;
  plan?: string;
  recommended?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<MutualFundsTrackerResult> => {
  const q = new URLSearchParams();
  if (opts?.search) q.set("search", opts.search);
  if (opts?.amc) q.set("amc", opts.amc);
  if (opts?.category) q.set("category", opts.category);
  if (opts?.plan) q.set("plan", opts.plan);
  if (opts?.recommended) q.set("recommended", "true");
  q.set("limit", String(opts?.limit ?? 50));
  q.set("offset", String(opts?.offset ?? 0));
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/tracker?${q.toString()}`, {
    signal: opts?.signal,
  });
  const data = arr(raw.data).map<MutualFundItem>((f) => ({
    scheme_code: String(f.scheme_code ?? ""),
    scheme_name: str(f.scheme_name) ?? "—",
    amc_name: str(f.amc) ?? str(f.amc_name),
    category: str(f.category),
    plan: str(f.plan),
    option: str(f.option) ?? str(f.scheme_option),
    latest_nav: num(f.latest_nav),
    nav_date: str(f.nav_date) ?? str(f.latest_nav_date),
    isin_growth: str(f.isin),
    isin_div: str(f.isin_reinvest) ?? str(f.isin_div),
    ter_pct: num(f.ter_pct),
    ter_as_of: str(f.ter_as_of),
    is_fh_recommended: f.is_fh_recommended === true || isMfRecommended(f.scheme_code),
  }));
  const facets = obj(raw.facets);
  const planCountsRaw = obj(facets.plan_counts);
  const plan_counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(planCountsRaw)) {
    const n = num(v);
    if (n !== undefined) plan_counts[k] = n;
  }
  const env = envelope(raw, data);
  env.as_of = str(raw.as_of) ?? env.as_of;
  return {
    ...env,
    recommended_count: num(raw.recommended_count) ?? 0,
    total: num(raw.total) ?? data.length,
    limit: num(raw.limit) ?? (opts?.limit ?? 50),
    offset: num(raw.offset) ?? (opts?.offset ?? 0),
    facets: {
      amcs: Array.isArray(facets.amcs) ? (facets.amcs as unknown[]).filter((x): x is string => typeof x === "string") : [],
      categories: Array.isArray(facets.categories)
        ? (facets.categories as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      plan_counts,
    },
  };
};

export const getBackofficeCompare = async (type: "mf" | "pms", ids: string[]): Promise<ComparePayload> => {
  const qs = new URLSearchParams({ type, ids: ids.join(",") });
  const raw = await boFetch<Json>(`/api/backoffice/compare?${qs.toString()}`);
  const items = arr(raw.items).map((it) => {
    const m = obj(it.metrics);
    const metrics: CompareMetrics = {
      ret_1y: num(m.ret_1y) ?? null,
      ret_3y: num(m.ret_3y) ?? null,
      ret_5y: num(m.ret_5y) ?? null,
      ret_si: num(m.ret_si) ?? null,
      cagr: num(m.cagr) ?? null,
      std_dev: num(m.std_dev) ?? null,
      sharpe: num(m.sharpe) ?? null,
      sortino: num(m.sortino) ?? null,
      alpha: num(m.alpha) ?? null,
      beta: num(m.beta) ?? null,
      max_dd: num(m.max_dd) ?? null,
      up_capture: num(m.up_capture) ?? null,
      down_capture: num(m.down_capture) ?? null,
      ter: num(m.ter) ?? null,
      aum: num(m.aum) ?? null,
      nav_or_min_ticket: num(m.nav_or_min_ticket) ?? null,
      manager: str(m.manager) ?? null,
      manager_tenure: num(m.manager_tenure) ?? (str(m.manager_tenure) ?? null),
      quartile: num(m.quartile) ?? null,
      sharpe_source: str(m.sharpe_source) ?? null,
    };
    const series = arr(it.series)
      .map((pt) => {
        const pair = arr(pt);
        if (pair.length < 2) return null;
        const v = num(pair[1]);
        return v === undefined ? null : ([String(pair[0]), v] as [string, number]);
      })
      .filter((x): x is [string, number] => x !== null);
    return {
      id: String(it.id ?? ""),
      name: str(it.name) ?? "—",
      category: str(it.category) ?? null,
      amc_or_manager: str(it.amc_or_manager) ?? null,
      inception: str(it.inception) ?? null,
      metrics,
      series,
    };
  });
  const bench = obj(raw.benchmark);
  const benchSeries = arr(bench.series)
    .map((pt) => {
      const pair = arr(pt);
      if (pair.length < 2) return null;
      const v = num(pair[1]);
      return v === undefined ? null : ([String(pair[0]), v] as [string, number]);
    })
    .filter((x): x is [string, number] => x !== null);
  const meta = obj(raw.meta);
  return {
    type: raw.type === "pms" ? "pms" : "mf",
    items,
    benchmark: { name: str(bench.name) ?? "Benchmark", series: benchSeries },
    meta: { fetched_at: str(meta.fetched_at) ?? "", source: str(meta.source) ?? "" },
  };
};

const briefingDirection = (v: unknown): BriefingItem["direction"] => {
  const d = str(v);
  return d === "up" || d === "down" || d === "flat" ? d : undefined;
};

const parseBriefingSection = (s: Json): BriefingSection => ({
  key: str(s.key) ?? "",
  title: str(s.title) ?? "",
  note: str(s.note),
  items: arr(s.items).map((it) => ({
    text: str(it.text),
    value: str(it.value),
    change: str(it.change),
    change_pct: num(it.change_pct) ?? null,
    direction: briefingDirection(it.direction),
    so_what: str(it.so_what),
    as_of: str(it.as_of),
    source: str(it.source),
    source_url: str(it.source_url),
    link: str(it.link),
    stale: it.stale === true ? true : undefined,
  })),
});

export const getBriefing = async (date?: string): Promise<BriefingPayload> => {
  const raw = await boFetch<Json>(`/api/backoffice/briefing${date ? `?date=${encodeURIComponent(date)}` : ""}`);
  return {
    brief_date: str(raw.brief_date) ?? "",
    generated_at: str(raw.generated_at) ?? "",
    version: num(raw.version) ?? 1,
    sections: arr(raw.sections).map(parseBriefingSection),
    freshness: arr(raw.freshness).map((f) => ({
      source: str(f.source),
      last_ok: str(f.last_ok),
      age_hours: num(f.age_hours) ?? null,
      stale: typeof f.stale === "boolean" ? f.stale : undefined,
    })),
  };
};

export const getBriefingDates = async (): Promise<string[]> => {
  const raw = await boFetch<Json>("/api/backoffice/briefing/dates");
  const dates: unknown = raw.dates;
  return (Array.isArray(dates) ? dates : []).filter((d): d is string => typeof d === "string");
};

export const rebuildBriefing = async (): Promise<{ ok: boolean; brief_date: string }> => {
  const raw = await boFetch<Json>("/api/backoffice/briefing/rebuild", { method: "POST" });
  return { ok: raw.ok === true, brief_date: str(raw.brief_date) ?? "" };
};

export const getWatchlists = async (): Promise<WatchlistItem[]> => {
  const raw = await boFetch<Json>("/api/backoffice/watchlists");
  return arr(raw.data).map((w) => ({
    id: String(w.id ?? ""),
    name: str(w.name) ?? "—",
    item_type: str(w.item_type) ?? "—",
    item_id: str(w.item_id) ?? "—",
  }));
};

export const createWatchlist = (body: { name: string; item_type: string; item_id: string }) =>
  boFetch<WatchlistItem>("/api/backoffice/watchlists", { method: "POST", body: JSON.stringify(body) });

export const deleteWatchlist = (id: string) =>
  boFetch<{ success: boolean }>(`/api/backoffice/watchlists/${id}`, { method: "DELETE" });

const toNote = (n: Json): ResearchNoteItem => ({
  id: String(n.id ?? ""),
  target_type: str(n.entity_type) ?? "—",
  target_id: str(n.entity_id) ?? "—",
  title: str(n.title) ?? "Untitled",
  content: str(n.content) ?? "",
  author_name: str(n.author_name),
  created_at: str(n.created_at) ?? "",
});

export const getResearchNotes = async (targetType?: string, targetId?: string): Promise<ResearchNoteItem[]> => {
  const q = new URLSearchParams();
  if (targetType) q.set("entity_type", targetType);
  if (targetId) q.set("entity_id", targetId);
  const qs = q.toString();
  const raw = await boFetch<Json>(`/api/backoffice/research-notes${qs ? `?${qs}` : ""}`);
  return arr(raw.data).map(toNote);
};

export const createResearchNote = async (body: {
  target_type: string;
  target_id: string;
  title: string;
  content: string;
}): Promise<ResearchNoteItem> => {
  const raw = await boFetch<Json>("/api/backoffice/research-notes", {
    method: "POST",
    body: JSON.stringify({
      entity_type: body.target_type,
      entity_id: body.target_id,
      title: body.title,
      content: body.content,
    }),
  });
  return toNote(raw);
};

export const getDataHealth = async (): Promise<SourceHealthData> => {
  const raw = await boFetch<Json>("/api/backoffice/data-health");
  const sources = arr(raw.sources) as unknown as SourceItem[];
  const count = (status: string) => sources.filter((s) => s.health_status === status).length;
  const summary = obj(raw.summary);
  return {
    sources,
    summary: {
      total: num(summary.total) ?? sources.length,
      ready: num(summary.ready) ?? count("ready"),
      degraded: num(summary.degraded) ?? count("degraded"),
      needs_key: num(summary.needs_key) ?? count("needs_key"),
      manual_only: num(summary.manual_only) ?? count("manual_only"),
      pending: num(summary.pending) ?? count("pending"),
    },
  };
};

export const refreshSource = (sourceId: string) =>
  boFetch<{ ok?: boolean; status?: string }>(`/api/backoffice/sources/${sourceId}/refresh`, { method: "POST" });

export const importTemplateUrl = (importType: string) =>
  resolveApiUrl(`${API_URL}/api/backoffice/imports/template/${encodeURIComponent(importType)}`);

export const previewImport = async (body: {
  import_type: string;
  file_content: string;
  file_name: string;
}): Promise<ImportJobData> => {
  const raw = await boFetch<Json>("/api/backoffice/imports/preview", {
    method: "POST",
    body: JSON.stringify({
      import_type: body.import_type,
      filename: body.file_name,
      csv_content: body.file_content,
    }),
  });
  return {
    import_type: body.import_type,
    file_name: body.file_name,
    csv_content: body.file_content,
    valid_rows_count: num(raw.valid_count) ?? 0,
    error_rows_count: num(raw.error_count) ?? 0,
    errors: arr(raw.errors).map((e) => ({ row: num(e.row_num) ?? 0, error: str(e.error) ?? "Invalid row" })),
    fatal_error: raw.valid === false && !num(raw.error_count) ? str(raw.error) : undefined,
  };
};

export const commitImport = async (job: ImportJobData): Promise<{ ok: boolean; committed_rows: number }> => {
  const raw = await boFetch<Json>("/api/backoffice/imports/commit", {
    method: "POST",
    body: JSON.stringify({
      import_type: job.import_type,
      filename: job.file_name,
      csv_content: job.csv_content,
    }),
  });
  return { ok: raw.success === true, committed_rows: num(raw.rows_committed) ?? 0 };
};

export const listStaffMembers = async (): Promise<StaffMemberItem[]> => {
  const raw = await boFetch<Json>("/api/backoffice/staff");
  return arr(raw.data).map((s) => ({
    id: String(s.id ?? ""),
    name: str(s.name) ?? "—",
    email: str(s.email) ?? "—",
    mobile: str(s.mobile) ?? "",
    role: str(s.role) ?? "—",
    status: str(s.status),
    is_staff: s.is_staff as number | boolean | undefined,
    pages: Array.isArray(s.pages) ? (s.pages as string[]) : [],
  }));
};

export const createStaffMember = async (body: {
  name: string;
  email: string;
  mobile: string;
  role: string;
  password?: string;
  pages?: string[];
}): Promise<StaffProvisionResponse> => {
  const raw = await boFetch<Json>("/api/backoffice/staff/provision", { method: "POST", body: JSON.stringify(body) });
  const m = obj(raw.staff_member);
  return {
    staff_member: {
      id: String(m.id ?? ""),
      name: str(m.name) ?? body.name,
      email: str(m.email) ?? body.email,
      mobile: str(m.mobile) ?? body.mobile,
      role: str(m.role) ?? body.role,
    },
    temporary_password: str(raw.temporary_password) ?? null,
    action: typeof raw.action === "string" ? raw.action : undefined,
  };
};

export const updateStaffMember = (id: string, body: { role?: string; status?: "active" | "inactive"; reset_password?: boolean; pages?: string[] }) =>
  boFetch<{ temporary_password: string | null }>(`/api/backoffice/staff/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

export interface Filing {
  id: string;
  created_at: string;
  form_title: string;
  form_url: string | null;
  household_id: string | null;
  client_name: string | null;
  folio: string | null;
  filled_by_name: string | null;
  status: number; // 0 Downloaded, 1 Submitted to RTA, 2 Ack received
}
export const FILING_STATUSES = ["Downloaded", "Submitted to RTA", "Ack received"] as const;
export const getFilings = () => boFetch<{ data: Filing[] }>("/api/backoffice/operations/filings").then((r) => r.data);
export const setFilingStatus = (id: string, status: number) =>
  boFetch<{ data: Filing }>(`/api/backoffice/operations/filings/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });

export const getNews = async (opts: { limit?: number; category?: string } = {}): Promise<NewsItem[]> => {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 40) });
  if (opts.category) q.set("category", opts.category);
  const raw = await boFetch<Json>(`/api/backoffice/news?${q.toString()}`);
  return arr(raw.data).map((n) => ({
    id: String(n.id ?? ""),
    source_id: str(n.source_id) ?? "",
    source_name: str(n.source_name) ?? "—",
    category: str(n.category) ?? "markets",
    title: str(n.title) ?? "",
    link: str(n.link) ?? "#",
    summary: str(n.summary) ?? "",
    published_at: str(n.published_at),
  }));
};

export interface PmsHistoryRow {
  as_on: string;
  aum_crore?: number;
  r1m?: number;
  r3m?: number;
  r6m?: number;
  r1y?: number;
  r3y?: number;
  r5y?: number;
  since_inception?: number;
}

export interface PmsStrategyDetail {
  profile?: {
    benchmark?: string;
    inception_date?: string;
    age?: string;
    min_investment_inr?: number;
    fixed_fees?: string;
    variable_fees?: string;
    exit_load?: string;
    purpose?: string;
    fund_manager?: string;
    fund_manager_experience?: string;
    turnover_as_on?: string;
    turnover_1m?: number;
    turnover_1y?: number;
  };
  profile_error?: string;
  history: PmsHistoryRow[];
  siblings: Array<{ ia_id?: string; strategy_name: string; strategy_type?: string; aum_crore?: number; r1y?: number; r3y?: number }>;
  source_url: string;
}

/** Everything APMI publishes about one strategy (profile, fees, manager, turnover) plus our stored monthly history. */
export const getPmsStrategyDetail = async (iaId: string): Promise<PmsStrategyDetail> => {
  const raw = await boFetch<Json>(`/api/backoffice/pms/strategies/${encodeURIComponent(iaId)}`);
  const d = obj(raw.data);
  const p = d.detail ? obj(d.detail) : null;
  // One row per month (a strategy can be listed under more than one service type; keep the largest AUM).
  const byMonth = new Map<string, PmsHistoryRow>();
  for (const h of arr(d.history)) {
    const row: PmsHistoryRow = {
      as_on: str(h.as_on) ?? "—",
      aum_crore: num(h.aum_crore),
      r1m: num(h.return_1m),
      r3m: num(h.return_3m),
      r6m: num(h.return_6m),
      r1y: num(h.return_1y),
      r3y: num(h.return_3y),
      r5y: num(h.return_5y),
      since_inception: num(h.return_since_inception),
    };
    const prior = byMonth.get(row.as_on);
    if (!prior || (row.aum_crore ?? 0) > (prior.aum_crore ?? 0)) byMonth.set(row.as_on, row);
  }
  return {
    profile: p
      ? {
          benchmark: str(p.benchmark),
          inception_date: str(p.inception_date),
          age: str(p.age),
          min_investment_inr: num(p.min_investment_inr),
          fixed_fees: str(p.fixed_fees),
          variable_fees: str(p.variable_fees),
          exit_load: str(p.exit_load),
          purpose: str(p.purpose),
          fund_manager: str(p.fund_manager),
          fund_manager_experience: str(p.fund_manager_experience),
          turnover_as_on: str(p.turnover_as_on),
          turnover_1m: num(p.turnover_1m),
          turnover_1y: num(p.turnover_1y),
        }
      : undefined,
    profile_error: str(d.detail_error),
    history: Array.from(byMonth.values()).sort((a, b) => b.as_on.localeCompare(a.as_on)),
    siblings: arr(d.siblings).map((x) => ({
      ia_id: str(x.ia_id),
      strategy_name: str(x.strategy_name) ?? "—",
      strategy_type: str(x.strategy_type),
      aum_crore: num(x.aum_crore),
      r1y: num(x.return_1y),
      r3y: num(x.return_3y),
    })),
    source_url: str(d.source_url) ?? `https://www.apmiindia.org/apmi/IaInsight.htm?IAID=${iaId}`,
  };
};

// ---------------------------------------------------------------------------
// Fund Screening Types and Methods
// ---------------------------------------------------------------------------

export interface MfScreeningRatioMeta {
  key: string;
  label: string;
  unit: "decimal" | "ratio" | "pct" | "years";
  description?: string;
}

export interface MfScreeningRow {
  scheme_code: string;
  as_of: string;
  cat: string;
  amc?: string | null;
  scheme_name: string;
  manager_name?: string | null;
  manager_tenure_years?: number | null;
  tenure_ratio?: number | null;
  alpha?: number | null;
  beta?: number | null;
  std_dev?: number | null;
  r_squared?: number | null;
  information_ratio?: number | null;
  tracking_error?: number | null;
  treynor?: number | null;
  sharpe?: number | null;
  sortino?: number | null;
  up_capture?: number | null;
  down_capture?: number | null;
  max_drawdown?: number | null;
  expense_ratio?: number | null;
  ret_1y?: number | null;
  cagr_3y?: number | null;
  cagr_5y?: number | null;
  cagr_si?: number | null;
  bench_1y?: number | null;
  bench_3y?: number | null;
  bench_5y?: number | null;
  bench_si?: number | null;
  cat_avg_1y?: number | null;
  cat_avg_3y?: number | null;
  cat_avg_5y?: number | null;
  cat_avg_si?: number | null;
  quartile_2y?: number | null;
  quartile_source?: string | null;
  needs_data?: string[];
  score?: number | null;
  rf_source?: string | null;
  benchmark_source?: string | null;
  history_years?: number | null;
  quality_flags?: string | null;
  provenance_json?: string | null;
  stage_flags?: { s1: boolean; s2: boolean; s3: boolean; s4a: boolean; s4c: boolean };
  action_status?: "review" | "retain" | "excluded" | "insufficient";
  pms_link?: { ia_id?: string; strategy_name: string; fund_manager?: string } | null;
}

export interface ScreeningMetricsData {
  as_of?: string;
  defaults?: {
    min_tenure_years: number;
    bounds: Record<string, { min?: number | null; max?: number | null }>;
    quartiles_action: number[];
    include_missing: boolean;
  };
  stage_as_of?: { nav?: string | null; managers?: string | null; ter?: string | null };
  rf: number;
  rf_source: string;
  benchmark_policy: string;
  ratios: MfScreeningRatioMeta[];
  rows: MfScreeningRow[];
  facets: { amcs: string[]; cats: string[] };
  total: number;
}

export interface ScreeningFunnelCounts {
  universe: number;
  s1: number;
  s2: number;
  s3_action: number;
  s3_retain: number;
  s3_dropped: number;
  s4a: number;
  final: number;
  insufficient_by_stage: { s1: number; s2: number; s3: number; s4a: number; s4c: number };
  needs_data?: number;
  zeroed_reasons?: Array<{ rule: string; count: number }>;
  zeroed_stage?: "s1" | "s2" | "s3" | "s4a" | "s4c" | null;
  missing_by_stage?: Record<string, Record<string, number>>;
}

export interface ScreeningDropped {
  scheme_code: string;
  scheme_name: string;
  cat: string;
  drop_stage: string;
  drop_reason: string;
}

export interface ScreeningRunData {
  run_id: string;
  as_of: string;
  counts: ScreeningFunnelCounts;
  action: MfScreeningRow[];
  retain: MfScreeningRow[];
  dropped?: ScreeningDropped[];
}

export interface ScreeningFundDetail extends MfScreeningRow {
  manager?: {
    scheme_code: string;
    manager_name: string;
    manager_start?: string | null;
    source?: string | null;
    provenance?: string | null;
  } | null;
  pms_matches?: Array<{
    ia_id: string;
    strategy_name: string;
    provider?: string | null;
    fund_manager?: string | null;
    normalized_manager?: string | null;
    aum_crore?: number | null;
    return_1y?: number | null;
    return_3y?: number | null;
  }>;
  notes?: Array<{
    id: string;
    title: string;
    content: string;
    created_at?: string;
  }>;
}

export interface ScreeningPresetItem {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  builtin?: boolean;
}

export const getScreeningMetrics = async (params: {
  cat?: string;
  amc?: string;
  q_search?: string;
  as_of?: string;
} = {}): Promise<BackofficeEnvelope<ScreeningMetricsData>> => {
  const q = new URLSearchParams();
  if (params.cat) q.set("cat", params.cat);
  if (params.amc) q.set("amc", params.amc);
  if (params.q_search) q.set("q_search", params.q_search);
  if (params.as_of) q.set("as_of", params.as_of);
  const qs = q.toString() ? `?${q.toString()}` : "";
  return boFetch<BackofficeEnvelope<ScreeningMetricsData>>(`/api/backoffice/screening/metrics${qs}`);
};

export const runScreening = async (payload: {
  preset_id?: string | null;
  filters: Record<string, unknown>;
}, signal?: AbortSignal): Promise<BackofficeEnvelope<ScreeningRunData>> => {
  return boFetch<BackofficeEnvelope<ScreeningRunData>>("/api/backoffice/screening/run", {
    method: "POST",
    signal,
    body: JSON.stringify(payload),
  });
};

export const getScreeningFund = async (schemeCode: string): Promise<BackofficeEnvelope<ScreeningFundDetail>> => {
  return boFetch<BackofficeEnvelope<ScreeningFundDetail>>(`/api/backoffice/screening/funds/${encodeURIComponent(schemeCode)}`);
};

export const listScreeningPresets = async (): Promise<BackofficeEnvelope<ScreeningPresetItem[]>> => {
  return boFetch<BackofficeEnvelope<ScreeningPresetItem[]>>("/api/backoffice/screening/presets");
};

export const saveScreeningPreset = async (
  name: string,
  filters: Record<string, unknown>
): Promise<BackofficeEnvelope<ScreeningPresetItem>> => {
  return boFetch<BackofficeEnvelope<ScreeningPresetItem>>("/api/backoffice/screening/presets", {
    method: "POST",
    body: JSON.stringify({ name, filters }),
  });
};

export const deleteScreeningPreset = async (
  presetId: string
): Promise<BackofficeEnvelope<{ success: boolean }>> => {
  return boFetch<BackofficeEnvelope<{ success: boolean }>>(`/api/backoffice/screening/presets/${encodeURIComponent(presetId)}`, {
    method: "DELETE",
  });
};

export const screeningExportUrl = (runId: string, includeRetain: boolean = false): string => {
  return `${resolveApiUrl(`/api/backoffice/screening/export/${encodeURIComponent(runId)}.csv`)}?include_retain=${includeRetain}`;
};

export interface MfScreenerRow {
  code: string;
  name: string;
  amc?: string | null;
  plan: string;
  cat: string;
  nav_date?: string | null;
  isin?: string | null;
  is_fh_recommended: boolean;
  perf_label: string;
  risk_label: string;
  ops_label: string;
  fh_signal?: "Buy" | "Hold" | "Sell" | "Needs review";
  fh_signal_reasons?: string[];
  [metric: string]: string | number | boolean | null | undefined | string[];
}

export interface PortfolioHoldingCandidate {
  code: string;
  name: string;
  plan: string;
  cat_label: string;
  fh_score?: number | null;
  fh_rating?: number | null;
  fh_signal?: "Buy" | "Hold" | "Sell" | "Needs review";
  similarity: number;
}

export interface PortfolioHolding {
  id: string;
  raw_name: string;
  isin?: string | null;
  amfi_code?: string | null;
  canonical_name?: string | null;
  folio?: string | null;
  amc?: string | null;
  plan?: string | null;
  option?: string | null;
  category?: string | null;
  benchmark?: string | null;
  units?: number | null;
  statement_nav?: number | null;
  statement_value?: number | null;
  portfolio_weight_pct?: number | null;
  valuation_date?: string | null;
  data_as_of?: string | null;
  fh_score?: number | null;
  fh_rating?: number | null;
  fh_signal: "Buy" | "Hold" | "Sell" | "Needs review";
  fh_signal_reasons: string[];
  match_type: "exact_isin" | "exact_code" | "matched_name" | "ambiguous" | "unmatched" | "manual_resolved";
  candidates?: PortfolioHoldingCandidate[];
  detail_path?: string | null;
  underlying_metrics?: {
    benchmark?: string | null;
    sortino_3y?: number | null;
    sharpe_3y?: number | null;
    out_3y?: number | null;
    out_1y?: number | null;
    cagr_3y?: number | null;
    manager_tenure_years?: number | null;
    ter?: number | null;
  } | null;
}

export interface PortfolioScreenSummary {
  total_value?: number | null;
  holdings_count: number;
  matched_count: number;
  needs_review_count: number;
  buy_count: number;
  hold_count: number;
  sell_count: number;
  statement_date?: string | null;
  screening_date?: string | null;
  is_partial: boolean;
}

export interface PortfolioScreenResponse {
  holdings: PortfolioHolding[];
  summary: PortfolioScreenSummary;
}

export interface MfScreenerGroup {
  group: string;
  categories: { key: string; label: string; count: number }[];
}

/** Per-source as-of dates from the screener response meta object (any may be null). */
export interface MfScreenerFreshness {
  nav_as_of?: string | null;
  aum_as_of?: string | null;
  ter_as_of?: string | null;
  managers_as_of?: string | null;
  quartile_as_of?: string | null;
}

export interface MfScreenerResult {
  data: MfScreenerRow[];
  total: number;
  as_of?: string | null;
  groups: MfScreenerGroup[];
  meta?: Record<string, InfoTipMeta>;
  /** Parsed from the response `meta` object when it carries as-of dates; null fields stay null. */
  screenerMeta?: MfScreenerFreshness;
}

export interface MfScreenerQuery {
  category: string[];
  plan: string[];
  search?: string;
  sort: string;
  order: "asc" | "desc";
  ranges: Record<string, { min?: string; max?: string }>;
  recommended?: boolean;
  limit?: number;
  offset?: number;
  /** MF Research filters (backend contract): repeated params. */
  amc?: string[];
  /** Sector filter: only funds with a holdings snapshot holding this sector. */
  sector?: string;
  manager?: string;
  min_tenure?: number;
  include_unknown?: boolean;
  quartile?: number[];
  quartile_period?: string;
  include_unavailable?: boolean;
  /** Restrict to one of the staff member's watchlists (by id). */
  watchlist?: string;
}

export function mfScreenerParams(o: MfScreenerQuery): URLSearchParams {
  const q = new URLSearchParams();
  o.category.forEach((c) => q.append("category", c));
  o.plan.forEach((p) => q.append("plan", p));
  if (o.search) q.set("search", o.search);
  if (o.recommended) q.set("recommended", "true");
  (o.amc ?? []).forEach((a) => q.append("amc", a));
  if (o.sector) q.set("sector", o.sector);
  if (o.watchlist) q.set("watchlist", o.watchlist);
  if (o.manager) q.set("manager", o.manager);
  if (o.min_tenure != null) q.set("min_tenure", String(o.min_tenure));
  if (o.include_unknown === false) q.set("include_unknown", "false");
  (o.quartile ?? []).forEach((v) => q.append("quartile", String(v)));
  if (o.quartile_period) q.set("quartile_period", o.quartile_period);
  if (o.include_unavailable === false) q.set("include_unavailable", "false");
  Object.entries(o.ranges).forEach(([k, r]) => {
    if (r.min || r.max) q.append("f", `${k}:${r.min ?? ""}:${r.max ?? ""}`);
  });
  q.set("sort", o.sort);
  q.set("order", o.order);
  return q;
}

export const getMfScreener = async (o: MfScreenerQuery, signal?: AbortSignal): Promise<MfScreenerResult> => {
  const q = mfScreenerParams(o);
  q.set("limit", String(o.limit ?? 25));
  q.set("offset", String(o.offset ?? 0));
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/screener?${q.toString()}`, { signal });
  const metaRaw = obj(raw.meta);
  const hasFreshness = ["nav_as_of", "aum_as_of", "ter_as_of", "managers_as_of", "quartile_as_of"].some((k) => k in metaRaw);
  const base = raw as unknown as MfScreenerResult;
  return hasFreshness
    ? {
        ...base,
        screenerMeta: {
          nav_as_of: (metaRaw.nav_as_of as string | null) ?? null,
          aum_as_of: (metaRaw.aum_as_of as string | null) ?? null,
          ter_as_of: (metaRaw.ter_as_of as string | null) ?? null,
          managers_as_of: (metaRaw.managers_as_of as string | null) ?? null,
          quartile_as_of: (metaRaw.quartile_as_of as string | null) ?? null,
        },
      }
    : base;
};

export interface MfExplainPart {
  key: string; label: string; value: number | null; weight?: number | null; max?: number; label_text?: string;
  peers_with_data?: number; median?: number | null; rank?: number; percentile?: number; best?: number | null; higher_better?: boolean;
}
export interface MfExplain {
  metric: string; code: string; name: string; plan: string; category: string; peers: number; nav_date: string | null;
  value: number | string | null; bands: { top: number; mid: number; max: number }; parts: MfExplainPart[];
  rule?: string; points?: number | null; label?: string; provisional?: boolean; category_avg?: number | null;
  fh?: FhExplain;
}

export interface FhComponent { label: string; value: number | null; score?: number | null; pass?: boolean | null; threshold?: number; note?: string | null; period?: string; against?: string; fund?: number | null; ref?: number | null; lead?: number | null }
export interface FhFilter { key: string; label: string; weight: number; raw: number | null; points: number | null; coverage: number | null; status: "ok" | "insufficient" | "unconfigured"; components: FhComponent[] }
export interface FhExplain {
  score: number | null; rating: number | null; coverage: number | null; base: number | null;
  signal?: "Buy" | "Hold" | "Sell" | "Needs review"; signal_reasons?: string[];
  penalties: { key: string; points: number | null }[]; penalty_total: number | null;
  adjustment: { bonus: number | null; malus: number | null; total: number | null };
  filters: FhFilter[]; drawdown_enabled: boolean;
  flags: { code: string; text: string }[]; blockers: { code: string; text: string }[];
  auto_eligible: boolean; provisional: string[];
  benchmark?: { name: string | null; stand_in_fund: string | null }; scoring_mode?: "A" | "B"; data_status?: string; data_status_text?: string; review_status?: string;
}
export interface FhMethodology {
  weights: Record<string, number>; provisional: string[]; filters: Record<string, string>;
  config: { drawdown_enabled: boolean; recommend: { threshold: number; min_coverage: number }; history: { confirmed: boolean } };
  sources: { name: string; source: string; as_of: string | null }[];
  refresh: { cadence: string; next_run_ist: string };
}
export const getFhMethodology = () => boFetch<FhMethodology>("/api/backoffice/mutual-funds/fh-score/methodology");

/** Live per-fund breakdown of one screener value, computed by the backend from the same frame as the table. */
export const getMfExplain = (code: string, metric: string, signal?: AbortSignal) =>
  boFetch<MfExplain>(`/api/backoffice/mutual-funds/screener/explain?${new URLSearchParams({ code, metric }).toString()}`, { signal });

export interface MfQuartileData {
  categories: string[];
  columns: string[];
  rows: string[][];
  links: (string | null)[];
  /** When Advisorkhoj's table was fetched (added by the backend); absent on older payloads. */
  fetched_at?: string;
}

export const getMfQuartileRanking = (o: { category: string; period: string; plan: string }, signal?: AbortSignal) =>
  boFetch<{ data: MfQuartileData }>(`/api/backoffice/mutual-funds/quartile-ranking?${new URLSearchParams(o).toString()}`, { signal });

export const getMfQuartileAnnual = (o: { category: string; plan: string }, signal?: AbortSignal) =>
  boFetch<{ data: MfQuartileData }>(`/api/backoffice/mutual-funds/quartile-annual?${new URLSearchParams(o).toString()}`, { signal });

/** Same-origin CSV download URL for the current filters (all matching rows). */
export const mfScreenerCsvUrl = (o: MfScreenerQuery): string => {
  const q = mfScreenerParams(o);
  q.set("format", "csv");
  return resolveApiUrl(`${API_URL}/api/backoffice/mutual-funds/screener?${q.toString()}`);
};

// AMFI/SEBI reference data is served from the public fund endpoint:
// GET /api/funds/{scheme_code}/reference (see lib/api.ts getFundReferenceServer).

/* ---- MF Research V1: managers directory, research detail, shortlist ---- */

export interface MfManagerDirectoryRow {
  manager_name: string | null;
  schemes: number;
  portfolios: number;
  longest_tenure_years?: number | null;
  avg_tenure_years?: number | null;
  aum_estimate_cr?: number | null;
  aum_incomplete?: boolean;
  needs_data?: boolean;
}

export interface MfManagersResult {
  data: MfManagerDirectoryRow[];
  total: number;
}

export const getMfManagers = async (o: {
  search?: string;
  min_tenure?: number;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}, signal?: AbortSignal): Promise<MfManagersResult> => {
  const q = new URLSearchParams();
  if (o.search) q.set("search", o.search);
  if (o.min_tenure != null) q.set("min_tenure", String(o.min_tenure));
  if (o.sort) q.set("sort", o.sort);
  if (o.order) q.set("order", o.order);
  q.set("limit", String(o.limit ?? 25));
  q.set("offset", String(o.offset ?? 0));
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/managers?${q.toString()}`, { signal });
  return {
    data: arr(raw.data).map((r) => ({
      manager_name: typeof r.manager_name === "string" ? r.manager_name : null,
      schemes: num(r.schemes) ?? 0,
      portfolios: num(r.portfolios) ?? 0,
      longest_tenure_years: num(r.longest_tenure_years),
      avg_tenure_years: num(r.avg_tenure_years),
      aum_estimate_cr: num(r.aum_estimate_cr),
      aum_incomplete: r.aum_incomplete === true,
      needs_data: r.needs_data === true,
    })),
    total: num(raw.total) ?? 0,
  };
};

/** MF Research V2 blocks carried on the research detail payload. Null fields stay null. */
export interface MfCoManager {
  manager_id?: string | null;
  name?: string | null;
  designation?: string | null;
  role_as_stated?: string | null;
  start_date?: string | null;
  start_date_as_stated?: string | null;
  end_date?: string | null;
  tenure_years?: number | null;
}
export interface MfResearchV2Blocks {
  co_managers?: {
    managers: MfCoManager[];
    is_co_managed: boolean;
    shared_record_note?: string | null;
  } | null;
  manager_changes?: { old_manager?: string | null; new_manager?: string | null; effective_date?: string | null; notice_url?: string | null }[];
  manager_bio?: {
    name?: string | null; firm?: string | null; current_title?: string | null; education?: string | null;
    years_experience?: number | null; bio_summary?: string | null; investment_philosophy?: string | null;
    career_history?: unknown[]; sources?: { label?: string; url?: string }[];
  } | null;
  operations?: {
    available: boolean; reason?: string | null; as_of?: string | null; source?: string | null;
    launch_date?: string | null; exit_load?: string | null; minimum_investment_inr?: string | null;
    minimum_application_text?: string | null; riskometer?: string | null; riskometer_level?: number | null;
    benchmark_tri?: string | null; ter_regular_pct?: string | null; ter_direct_pct?: string | null;
    ter_date?: string | null; aum_inr_crore?: string | null; aum_date?: string | null;
    history_unavailable?: Record<string, string>;
  } | null;
  portfolio?: {
    available: boolean;
    holdings: { name?: string | null; isin?: string | null; sector?: string | null; weight_pct?: number | null; instrument_type?: string | null }[];
    sectors: { sector?: string | null; weight_pct?: number | null }[];
    reason?: string | null;
    source?: string | null; sector_available: boolean;
    as_of?: string | null; amc?: string | null;
    unclassified_pct?: number | null; total_weight_pct?: number | null; sector_coverage?: string | null; coverage_pct?: number | null;
    summary?: { holdings_count?: number | null; top10_concentration_pct?: number | null; top_holding_pct?: number | null; cash_pct?: number | null; total_weight_pct?: number | null } | null;
    note?: string | null;
  } | null;
  index?: {
    index_name?: string | null; instrument_id?: string | null; points?: number | null;
    proxy_retired?: boolean; reason?: string | null;
    alpha_3y_pct?: number | null; beta_3y?: number | null; tracking_error_3y_pct?: number | null;
    information_ratio_3y?: number | null; index_ret_3y_pct?: number | null; fund_ret_3y_pct?: number | null;
  } | null;
  benchmark_tri_name?: string | null;
}

/** Consistency / percentile / quartile-history detail for one fund (drawer only). Null fields stay null. */
export interface MfResearchDetail extends MfResearchV2Blocks {
  consistency_source?: string | null;
  roll_win_pct?: number | null;
  cal_topq_years?: number | null;
  cal_win_pct?: number | null;
  downside_dev_3y?: number | null;
  sip_cagr_3y?: number | null;
  sip_cagr_5y?: number | null;
  quartile_1y?: number | null;
  quartile_2y?: number | null;
  quartile_3y?: number | null;
  quartile_5y?: number | null;
  quartile_source?: string | null;
  pct_sharpe_3y?: number | null;
  pct_sortino_3y?: number | null;
  pct_alpha_3y?: number | null;
  pct_vol_3y?: number | null;
  pct_max_dd_3y?: number | null;
  pct_ret_1y?: number | null;
  pct_cagr_3y?: number | null;
  pct_cagr_5y?: number | null;
  manager_name?: string | null;
  manager_start?: string | null;
  manager_tenure_years?: number | null;
  calmar_3y?: number | null;
  reason?: string | null;
}

export const getMfResearchDetail = async (code: string, signal?: AbortSignal): Promise<MfResearchDetail | null> => {
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/${encodeURIComponent(code)}/research-detail`, { signal });
  const d = obj(raw.data);
  if (Object.keys(d).length === 0) return null;
  const pick = (k: string) => num(d[k]);
  return {
    roll_win_pct: pick("roll_win_pct"),
    cal_topq_years: pick("cal_topq_years"),
    cal_win_pct: pick("cal_win_pct"),
    downside_dev_3y: pick("downside_dev_3y"),
    sip_cagr_3y: pick("sip_cagr_3y"),
    sip_cagr_5y: pick("sip_cagr_5y"),
    quartile_1y: pick("quartile_1y"),
    quartile_2y: pick("quartile_2y"),
    quartile_3y: pick("quartile_3y"),
    quartile_5y: pick("quartile_5y"),
    quartile_source: str(d.quartile_source),
    pct_sharpe_3y: pick("pct_sharpe_3y"),
    pct_sortino_3y: pick("pct_sortino_3y"),
    pct_alpha_3y: pick("pct_alpha_3y"),
    pct_vol_3y: pick("pct_vol_3y"),
    pct_max_dd_3y: pick("pct_max_dd_3y"),
    pct_ret_1y: pick("pct_ret_1y"),
    pct_cagr_3y: pick("pct_cagr_3y"),
    pct_cagr_5y: pick("pct_cagr_5y"),
    manager_name: str(d.manager_name),
    manager_start: str(d.manager_start),
    manager_tenure_years: pick("manager_tenure_years"),
    calmar_3y: pick("calmar_3y"),
    reason: str(d.reason),
    consistency_source: str(d.consistency_source),
    co_managers: (d.co_managers as MfResearchV2Blocks["co_managers"]) ?? null,
    manager_changes: (d.manager_changes as MfResearchV2Blocks["manager_changes"]) ?? [],
    manager_bio: (d.manager_bio as MfResearchV2Blocks["manager_bio"]) ?? null,
    operations: (d.operations as MfResearchV2Blocks["operations"]) ?? null,
    portfolio: (d.portfolio as MfResearchV2Blocks["portfolio"]) ?? null,
    index: (d.index as MfResearchV2Blocks["index"]) ?? null,
    benchmark_tri_name: str(d.benchmark_tri_name),
  };
};

/** Holdings snapshot coverage for the research page sector filter. */
export interface MfPortfolioCoverage {
  schemes_covered: number;
  sectors: string[];
  amcs: string[];
  as_of: string | null;
  generated_at: string | null;
}

export const getMfPortfolioCoverage = async (signal?: AbortSignal): Promise<MfPortfolioCoverage | null> => {
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/portfolio-coverage`, { signal });
  const d = obj(raw.data);
  if (Object.keys(d).length === 0) return null;
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    schemes_covered: num(d.schemes_covered) ?? 0,
    sectors: arr(d.sectors),
    amcs: arr(d.amcs),
    as_of: typeof d.as_of === "string" ? d.as_of : null,
    generated_at: typeof d.generated_at === "string" ? d.generated_at : null,
  };
};

/** Fund-vs-fund portfolio overlap for exactly two schemes (Compare only). */
export interface MfFundOverlap {
  code_a: string;
  code_b: string;
  portfolio_available: boolean;
  missing_codes: string[];
  as_of_a: string | null;
  as_of_b: string | null;
  source: string | null;
  reason: string | null;
  funds: { code: string; available: boolean; scheme_name?: string | null; amc?: string | null; as_of?: string | null }[];
  overlap: {
    shared_count: number;
    shared_weight_in_a_pct: number | null;
    shared_weight_in_b_pct: number | null;
    reason: string | null;
    shared_holdings: { name?: string | null; isin?: string | null; weight_in_a_pct?: number | null; weight_in_b_pct?: number | null }[];
  } | null;
}

export const getMfFundOverlap = async (
  codeA: string, codeB: string, signal?: AbortSignal,
): Promise<MfFundOverlap | null> => {
  const q = new URLSearchParams({ code_a: codeA, code_b: codeB });
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/portfolio-overlap?${q.toString()}`, { signal });
  const d = obj(raw.data);
  if (Object.keys(d).length === 0) return null;
  return d as unknown as MfFundOverlap;
};

export interface MfShortlistItem {
  id?: string | number;
  scheme_code: string;
  reason?: string | null;
  created_at?: string | null;
  /** Screener fields joined by the backend; any may be absent. */
  [field: string]: string | number | boolean | null | undefined;
}

export const listMfShortlist = async (): Promise<MfShortlistItem[]> => {
  const raw = await boFetch<Json>("/api/backoffice/mf-research/shortlist");
  return arr(raw.data).map((r) => {
    const out: MfShortlistItem = { scheme_code: String(r.scheme_code ?? "") };
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    }
    return out;
  });
};

export const addMfShortlist = async (schemeCode: string, reason?: string): Promise<void> => {
  await boFetch<Json>("/api/backoffice/mf-research/shortlist", {
    method: "POST",
    body: JSON.stringify({ scheme_code: schemeCode, reason: reason || null }),
  });
};

export const removeMfShortlist = async (id: string | number): Promise<void> => {
  await boFetch<Json>(`/api/backoffice/mf-research/shortlist/${encodeURIComponent(String(id))}`, { method: "DELETE" });
};

/** Same-origin CSV export URL for the staff shortlist. */
export const mfShortlistCsvUrl = (): string =>
  resolveApiUrl(`${API_URL}/api/backoffice/mf-research/shortlist?format=csv`);

/** Screener row -> the scheme summary the fund detail page opens with. */
export const mfRowToItem = (r: MfScreenerRow): MutualFundItem => ({
  scheme_code: r.code,
  scheme_name: r.name,
  amc_name: r.amc ?? undefined,
  cat_key: r.cat,
  plan: r.plan,
  option: "Growth",
  latest_nav: typeof r.nav === "number" ? r.nav : undefined,
  nav_date: r.nav_date ?? undefined,
  ter_pct: typeof r.ter === "number" ? r.ter : undefined,
  isin_growth: r.isin ?? undefined,
  is_fh_recommended: r.is_fh_recommended,
});

/** Fund detail page path. Pass the summary to open instantly; without it the page looks the fund up by code. */
export const mfDetailPath = (code: string, item?: MutualFundItem & { fh_status?: unknown }) =>
  `/backoffice/mutual-funds/${encodeURIComponent(code)}${item ? `?s=${encodeURIComponent(JSON.stringify(item))}` : ""}`;

/** Same-category, same-plan funds ranked by 3Y CAGR (fractions, like the public peers route). */
export const getMfPeers = async (code: string, signal?: AbortSignal): Promise<FundPeers> =>
  boFetch<FundPeers>(`/api/backoffice/mutual-funds/${encodeURIComponent(code)}/peers`, { signal });

/* ---- MF Research watchlists: staff-private named lists, screened with the same filters as Research ---- */

export interface MfWatchlist { id: string; name: string; codes: string[] }

export const listMfWatchlists = async (): Promise<MfWatchlist[]> =>
  arr((await boFetch<Json>("/api/backoffice/mf-research/watchlists")).data) as unknown as MfWatchlist[];

export const createMfWatchlist = async (name: string): Promise<MfWatchlist> =>
  boFetch<MfWatchlist>("/api/backoffice/mf-research/watchlists", { method: "POST", body: JSON.stringify({ name }) });

export const deleteMfWatchlist = async (id: string): Promise<void> => {
  await boFetch<Json>(`/api/backoffice/mf-research/watchlists/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const setMfWatchlistFund = async (id: string, schemeCode: string, present: boolean): Promise<void> => {
  const base = `/api/backoffice/mf-research/watchlists/${encodeURIComponent(id)}/funds`;
  await boFetch<Json>(present ? base : `${base}/${encodeURIComponent(schemeCode)}`, {
    method: present ? "POST" : "DELETE",
    ...(present ? { body: JSON.stringify({ scheme_code: schemeCode }) } : {}),
  });
};

export async function screenPortfolioPdf(file: File, password = ""): Promise<PortfolioScreenResponse> {
  const form = new FormData();
  form.append("file", file);
  if (password) form.append("password", password);
  const targetUrl = resolveApiUrl(`${API_URL}/api/backoffice/mutual-funds/portfolio-screen`);
  const res = await fetch(targetUrl, {
    method: "POST",
    body: form,
    credentials: "include",
    headers: { "sec-fetch-site": "same-origin" },
  });
  if (!res.ok) {
    let errMessage = `Portfolio screening failed (${res.status})`;
    try {
      const err = await res.json();
      if (err.message) errMessage = err.message;
      else if (err.detail?.message) errMessage = err.detail.message;
      else if (err.detail && typeof err.detail === "string") errMessage = err.detail;
    } catch {
      // ignore json error
    }
    throw new Error(errMessage);
  }
  return res.json();
}

export async function resolvePortfolioHolding(payload: {
  code: string;
  raw_name: string;
  statement_value?: number | null;
  total_value?: number | null;
}): Promise<PortfolioHolding> {
  const targetUrl = resolveApiUrl(`${API_URL}/api/backoffice/mutual-funds/resolve-holding`);
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(payload),
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to resolve holding (${res.status})`);
  }
  return res.json();
}

export interface AskAiResult {
  stance: "Buy" | "Hold" | "Sell";
  confidence?: string;
  summary?: string;
  allocation_view?: string;
  historical_view?: string;
  macro_view?: string;
  micro_view?: string;
  cycle_view?: string;
  primary_markets_view?: string;
  secondary_markets_view?: string;
  flows_view?: string;
  rebalancing_view?: string;
  reasons?: string[];
  market_context?: string[];
  risks?: string[];
  what_would_change_view?: string;
  disclaimer: string;
}

export async function askAiAboutFund(
  code: string,
  weightPct: number | null | undefined,
  portfolio: { code: string; weight_pct: number | null | undefined }[],
): Promise<AskAiResult> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/backoffice/mutual-funds/ask-ai`), {
    method: "POST",
    headers: { "Content-Type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ code, weight_pct: weightPct ?? null, portfolio: portfolio.map((p) => ({ code: p.code, weight_pct: p.weight_pct ?? null })) }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(typeof err?.detail === "string" ? err.detail : `AI analysis failed (${res.status})`);
  }
  return res.json();
}

// --- FH comparison, score breakdown and recommendation history --------------------------------------------------------
export interface FhPeriodRow { period: string; fund: number | null; benchmark: number | null; category_average: number | null; excess_vs_benchmark_pp: number | null; excess_vs_category_pp: number | null; return_basis: string }
export interface FhRiskRow { measure: string; fund: number | null; benchmark: number | null; category_average: number | null; better_is: string; good_vs_benchmark: boolean | null; good_vs_category: boolean | null }
export interface FhComparison { risk_comparison: FhRiskRow[]; benchmark_fund: string | null; category: string; plan: string; periods: FhPeriodRow[]; peer_universe: { id: string; eligible: number; excluded: Record<string, number>; policy: string }; as_of: string | null; benchmark: string; benchmark_basis: string; jensen_alpha_3y: { value: number | null; basis: string }; status: { data: string | null; data_text: string | null; review: string | null } }
export interface FhBreakdownRow { metric: string; period: string; value: number | null; category_average: number | null; peer_count: number; direction: string; scored: boolean; percentile: number | null; absolute_threshold: number | null; points: number | null; max_points: number; as_of: string | null; text: string }
export interface FhHistory { episodes: { id: string; started_on: string | null; ended_on: string | null; origin: string; prev_episode_id: string | null }[]; events: { id: string; episode_id: string; event_type: string; event_ts: string; effective_date: string | null; actor: string; reason: string | null; notes: string | null; snapshot_id: string | null }[]; snapshots: { id: string; kind: string; label: string; version: number; captured_at: string }[] }
export interface FhThenNow { rows: { dimension: string; then: number | string | null; now: number | string | null; change: number | string | null; note?: string }[]; quantitative_changes: unknown[]; qualitative_events: { type: string; status: string; detail: string; explanation?: string }[]; missing_evidence: string[] }
export interface FhOutcome { available?: boolean; message?: string; limitations?: string[]; periods?: Record<string, { available: boolean; reason?: string; while_recommended?: FhOutcomeBlock; after_removal?: FhOutcomeBlock & { note?: string } }> }
export interface FhOutcomeBlock { fund: { return_pct: number; basis: string } | null; benchmark: { return_pct: number } | null; category_average_pct: number | null; excess_vs_benchmark_pp: number | null; excess_vs_category_pp: number | null }
const FH = (code: string, tail: string) => `/api/backoffice/mutual-funds/${encodeURIComponent(code)}/${tail}`;
export const getFhComparison = (code: string) => boFetch<FhComparison>(FH(code, "fh-comparison"));
export const getFhBreakdown = (code: string, mode: string) => boFetch<FhExplain>(`${FH(code, "fh-score-breakdown")}?mode=${mode}`);
export const getFhHistory = (code: string) => boFetch<FhHistory>(FH(code, "fh-history"));
export const getFhSnapshotAsOf = (code: string, on: string) => boFetch<{ available: boolean; message?: string; snapshot_date?: string; age_days?: number; label?: string }>(`${FH(code, "fh-snapshot")}?on=${on}`);
export const getFhThenNow = (code: string, then: string, now = "live") => boFetch<FhThenNow>(`${FH(code, "fh-then-now")}?then=${encodeURIComponent(then)}&now=${encodeURIComponent(now)}`);
export const getFhOutcome = (code: string, start?: string, end?: string) => boFetch<FhOutcome>(`${FH(code, "fh-outcome")}${start ? `?start=${start}${end ? `&end=${end}` : ""}` : ""}`);

// --- AI control centre (admin) ------------------------------------------------------------------------------------------
export interface AiProvider { name: string; model: string; base_model: string; enabled: boolean; custom: boolean; env_key: string | null; api_url?: string | null; reasoning_effort: string; key_present: boolean }
export interface AiStat { calls: number; ok: number; fail: number; consecutive_failures: number; cooldown_remaining_s: number; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; last_latency_ms: number | null }
export interface AiStatus { version: number; updated_at: string | null; updated_by: string | null; stats: Record<string, AiStat>; keys: Record<string, boolean>; server_time: string }
export interface AiConfig extends AiStatus {
  providers: AiProvider[]; chains: Record<string, string[]>; chain_labels: Record<string, string>; settings: Record<string, number>; limits: Record<string, [number, number]>;
  picks: { enabled: boolean; model: string; effort: string }; system_prompt: string; efforts: string[]; mock_active: boolean;
}
export const getAiConfig = () => boFetch<AiConfig>("/api/backoffice/ai/config");
export const getAiStatus = () => boFetch<AiStatus>("/api/backoffice/ai/status");
export const saveAiConfig = (doc: Record<string, unknown>) => boFetch<AiConfig>("/api/backoffice/ai/config", { method: "PUT", body: JSON.stringify(doc) });
export const resetAiConfig = () => boFetch<AiConfig>("/api/backoffice/ai/config", { method: "DELETE" });
export const testAiProvider = (name: string) => boFetch<{ provider: string; ok: boolean; error: string | null; ms: number; model?: string }>(`/api/backoffice/ai/test/${encodeURIComponent(name)}`, { method: "POST" });
export const setFhScoringMode = (mode: "A" | "B") => boFetch<unknown>("/api/backoffice/mutual-funds/fh-score/config", { method: "PUT", body: JSON.stringify({ patch: { ratios: { mode } } }) });
