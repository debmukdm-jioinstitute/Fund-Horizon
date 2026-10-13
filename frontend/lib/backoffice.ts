import { ApiError, resolveApiUrl, API_URL } from "./api";

export interface BackofficeEnvelope<T> {
  data: T;
  as_of?: string;
  published_at?: string;
  fetched_at?: string;
  frequency?: string;
  availability: "ready" | "unavailable" | "blocked" | "needs_key" | "manual_only" | "schema_error";
  freshness: "current" | "stale" | "market_closed";
  quality_flags?: string[];
  coverage?: {
    priced_positions_paise?: number;
    unpriced_positions_count?: number;
    total_coverage_pct?: number;
  };
  method_version?: string;
}

export interface MarketOverviewData {
  fx_reference_rates: Record<string, number>;
  fx_as_of?: string;
  volatility: Record<string, number>;
  vol_as_of?: string;
  macro_proxy: Record<string, number>;
  yield_spreads: {
    india_us_10y_bps?: number;
    us_10y_2y_bps?: number;
    india_10y_2y_bps?: number;
  };
  sources_summary: {
    total: number;
    ready: number;
    degraded: number;
    needs_key: number;
    manual_only: number;
  };
  recent_notes: Array<{
    id: string;
    author_name: string;
    target_type: string;
    target_id: string;
    title: string;
    content: string;
    created_at: string;
  }>;
  active_watchlists: Array<{
    id: string;
    name: string;
    item_type: string;
    item_id: string;
  }>;
  generated_at: string;
}

export interface YieldsBoardData {
  curves: Record<string, Record<string, { value: number; observed_at: string; source: string }>>;
  spreads: {
    in_us_10y_bps?: number;
    us_10y_2y_bps?: number;
    in_10y_2y_bps?: number;
  };
  as_of?: string;
}

export interface DerivativesData {
  underlying: string;
  underlying_price?: number;
  expiry_date?: string;
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
    report_date: string;
    category: string;
    segment: string;
    buy_paise?: number;
    sell_paise?: number;
    net_paise: number;
    provisional: boolean;
  }>;
  fii_net_crore?: number;
  dii_net_crore?: number;
  cumulative_7d_net_crore?: number;
  as_of?: string;
}

export interface DeterministicBriefingData {
  title: string;
  as_of: string;
  method_version: string;
  bullets: string[];
  disclaimer: string;
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
  health_status: "ready" | "unavailable" | "blocked" | "needs_key" | "manual_only" | "schema_error";
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
  };
}

export interface PmsStrategyItem {
  id?: string;
  provider_name: string;
  strategy_name: string;
  investment_approach?: string;
  aum_crore?: number;
  return_1m_pct?: number;
  return_1y_pct?: number;
  return_3y_cagr_pct?: number;
  benchmark_name?: string;
  report_month?: string;
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
  plan?: string;
  latest_nav?: number | string;
  nav_date?: string;
  ter_pct?: number | string;
  isin_growth?: string;
  isin_div?: string;
}

export interface MicroIssuerData {
  symbol: string;
  name?: string;
  reporting_scope?: string;
  fiscal_period?: string;
  revenue_crore?: number;
  ebitda_crore?: number;
  ebitda_margin_pct?: number;
  pat_crore?: number;
  net_debt_crore?: number;
  debt_equity_ratio?: number;
  mf_lookthrough_weight_pct?: number;
  filing_id?: string;
}

export interface ImpactAnalysisData {
  pair_a: string;
  pair_b: string;
  sample_size: number;
  paired_ratio_pct: number;
  correlation?: number | null;
  beta?: number | null;
}

export interface ImpactScenarioData {
  delta_yield_decimal?: number;
  estimated_price_change_pct: number;
  formula?: string;
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
  id: string;
  import_type: string;
  valid_rows_count: number;
  error_rows_count: number;
  errors?: Array<{ row: number; error: string }>;
}

export interface StaffMemberItem {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  status?: string;
  is_staff?: number | boolean;
}

export interface StaffProvisionResponse {
  staff_member: StaffMemberItem;
  temporary_password: string;
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

export const getBackofficeOverview = () =>
  boFetch<BackofficeEnvelope<MarketOverviewData>>("/api/backoffice/overview");

export const getYieldsBoard = (countries = "IN,US,UK,JP") =>
  boFetch<BackofficeEnvelope<YieldsBoardData>>(`/api/backoffice/yields?countries=${countries}`);

export const getDerivatives = (index = "NIFTY", expiry?: string) => {
  const q = expiry ? `&expiry=${expiry}` : "";
  return boFetch<BackofficeEnvelope<DerivativesData>>(`/api/backoffice/derivatives?index=${index}${q}`);
};

export const getFlows = (start?: string, end?: string) => {
  const q = new URLSearchParams();
  if (start) q.set("start", start);
  if (end) q.set("end", end);
  const qs = q.toString();
  return boFetch<BackofficeEnvelope<FlowsData>>(`/api/backoffice/flows${qs ? `?${qs}` : ""}`);
};

export const getPmsStrategies = () =>
  boFetch<BackofficeEnvelope<PmsStrategyItem[]>>("/api/backoffice/pms/strategies");

export const getPmsAccountTracker = (id: string) =>
  boFetch<BackofficeEnvelope<PmsAccountTrackerData>>(`/api/backoffice/pms/accounts/${id}/tracker`);

export const getMutualFundsTracker = (q?: string) => {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  return boFetch<BackofficeEnvelope<MutualFundItem[]>>(`/api/backoffice/mutual-funds/tracker${qs}`);
};

export const getMicroIssuer = (id: string) =>
  boFetch<BackofficeEnvelope<MicroIssuerData>>(`/api/backoffice/micro/issuers/${id}`);

export const analyzeImpact = (body: {
  pair_a: string;
  pair_b: string;
  window_sessions?: number;
  frequency?: string;
}) =>
  boFetch<BackofficeEnvelope<ImpactAnalysisData>>("/api/backoffice/impact/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const simulateScenario = (body: {
  bond_duration?: number;
  yield_shift_bps?: number;
  fx_shift_pct?: number;
}) =>
  boFetch<BackofficeEnvelope<ImpactScenarioData>>("/api/backoffice/impact/scenario", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getDeterministicBriefing = () =>
  boFetch<BackofficeEnvelope<DeterministicBriefingData>>("/api/backoffice/briefing");

export const getWatchlists = (scope = "shared") =>
  boFetch<WatchlistItem[]>(`/api/backoffice/watchlists?scope=${scope}`);

export const createWatchlist = (body: { name: string; item_type: string; item_id: string; scope?: string }) =>
  boFetch<WatchlistItem>("/api/backoffice/watchlists", { method: "POST", body: JSON.stringify(body) });

export const deleteWatchlist = (id: string) =>
  boFetch<{ ok: boolean }>(`/api/backoffice/watchlists/${id}`, { method: "DELETE" });

export const getResearchNotes = (targetType?: string, targetId?: string) => {
  const q = new URLSearchParams();
  if (targetType) q.set("target_type", targetType);
  if (targetId) q.set("target_id", targetId);
  const qs = q.toString();
  return boFetch<ResearchNoteItem[]>(`/api/backoffice/research-notes${qs ? `?${qs}` : ""}`);
};

export const createResearchNote = (body: { target_type: string; target_id: string; title: string; content: string }) =>
  boFetch<ResearchNoteItem>("/api/backoffice/research-notes", { method: "POST", body: JSON.stringify(body) });

export const getDataHealth = () =>
  boFetch<SourceHealthData>("/api/backoffice/data-health");

export const refreshSource = (sourceId: string) =>
  boFetch<{ ok: boolean; status: string }>(`/api/backoffice/sources/${sourceId}/refresh`, { method: "POST" });

export const previewImport = (body: { import_type: string; file_content: string; file_name: string }) =>
  boFetch<ImportJobData>("/api/backoffice/imports/preview", { method: "POST", body: JSON.stringify(body) });

export const commitImport = (jobId: string) =>
  boFetch<{ ok: boolean; committed_rows: number }>(`/api/backoffice/imports/${jobId}/commit`, { method: "POST", body: JSON.stringify({ confirm: true }) });

export const listStaffMembers = () =>
  boFetch<StaffMemberItem[]>("/api/backoffice/staff");

export const createStaffMember = (body: { name: string; email: string; mobile: string; role: string }) =>
  boFetch<StaffProvisionResponse>("/api/backoffice/staff", { method: "POST", body: JSON.stringify(body) });
