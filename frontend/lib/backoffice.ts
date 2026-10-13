import { ApiError, resolveApiUrl, API_URL } from "./api";

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
  indices?: { "INDEX:IN:NIFTY50"?: number; "INDEX:IN:NIFTYBANK"?: number; as_of?: string | null };
  flows?: { latest_date?: string | null; fii_net?: number | null; dii_net?: number | null; status?: string };
  vol_as_of?: string;
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
    buy_crore?: number;
    sell_crore?: number;
    net_crore: number;
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
  quarters?: Array<{
    period_end: string;
    revenue_crore?: number;
    ebitda_crore?: number;
    ebitda_margin_pct?: number;
    pat_crore?: number;
    filing_id?: string;
  }>;
}

export interface ImpactAnalysisData {
  pair_a: string;
  pair_b: string;
  sample_size: number;
  paired_ratio_pct: number;
  correlation?: number | null;
  beta?: number | null;
  status?: string;
  message?: string;
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
}

export interface StaffProvisionResponse {
  staff_member: StaffMemberItem;
  temporary_password: string | null;
}

type Json = Record<string, unknown>;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
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

export const getYieldsBoard = async (): Promise<BackofficeEnvelope<YieldsBoardData>> => {
  const raw = await boFetch<Json>("/api/backoffice/yields");
  const d = obj(raw.data);
  const asOf = str(d.as_of) ?? str(raw.as_of);
  const toCurve = (rows: unknown, source: string) => {
    const curve: Record<string, { value: number; observed_at: string; source: string }> = {};
    for (const r of arr(rows)) {
      const tenor = str(r.tenor);
      const value = num(r.yield_pct);
      if (tenor && value !== undefined) curve[tenor] = { value, observed_at: str(r.observed_at) ?? asOf ?? "—", source };
    }
    return curve;
  };
  const inSummary = obj(d.india_summary);
  const usSummary = obj(d.us_summary);
  const cross = obj(d.india_us_10y_spread);
  const data: YieldsBoardData = {
    curves: { IN: toCurve(d.india_curve, "FBIL"), US: toCurve(d.us_curve, "US Treasury") },
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

export const getDerivatives = async (underlying = "NIFTY", expiry?: string): Promise<BackofficeEnvelope<DerivativesData>> => {
  const q = new URLSearchParams({ underlying });
  if (expiry) q.set("expiry", expiry);
  const raw = await boFetch<Json>(`/api/backoffice/derivatives?${q.toString()}`);
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
  if (start && end) {
    q.set("start_date", start);
    q.set("end_date", end);
  }
  const qs = q.toString();
  const raw = await boFetch<Json>(`/api/backoffice/flows${qs ? `?${qs}` : ""}`);
  const rows = Array.isArray(raw.data) ? arr(raw.data) : arr(obj(raw.data).daily);
  const daily: FlowsData["daily"] = rows.map((r) => ({
    report_date: str(r.report_date) ?? "—",
    category: str(r.category) ?? "—",
    segment: str(r.segment) ?? "—",
    buy_crore: num(r.gross_buy),
    sell_crore: num(r.gross_sell),
    net_crore: num(r.net) ?? 0,
    provisional: r.status !== "final",
  }));
  // Rows arrive newest first. "Latest session" = most recent date reported per category.
  const latestOf = (cat: string) => daily.find((r) => r.category.toUpperCase() === cat)?.net_crore;
  const dates = Array.from(new Set(daily.map((r) => r.report_date))).slice(0, 7);
  const data: FlowsData = {
    daily,
    fii_net_crore: latestOf("FII") ?? latestOf("FPI"),
    dii_net_crore: latestOf("DII"),
    cumulative_7d_net_crore: daily.length
      ? daily.filter((r) => dates.includes(r.report_date)).reduce((acc, r) => acc + r.net_crore, 0)
      : undefined,
    as_of: daily[0]?.report_date,
  };
  return envelope(raw, data, "unavailable");
};

export const getPmsStrategies = async (): Promise<BackofficeEnvelope<PmsStrategyItem[]>> => {
  const raw = await boFetch<Json>("/api/backoffice/pms/strategies");
  const data = arr(raw.data).map<PmsStrategyItem>((r) => ({
    id: str(r.id),
    provider_name: str(r.provider) ?? "—",
    strategy_name: str(r.strategy_name) ?? "—",
    investment_approach: str(r.approach) ?? str(r.category),
    aum_crore: num(r.aum_crore),
    return_1m_pct: num(r.return_1m),
    return_1y_pct: num(r.return_1y),
    return_3y_cagr_pct: num(r.cagr_3y),
    benchmark_name: str(r.benchmark_name),
    report_month: str(r.report_month),
  }));
  return envelope(raw, data, "manual_only");
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

export const getMutualFundsTracker = async (q?: string): Promise<BackofficeEnvelope<MutualFundItem[]>> => {
  const qs = q ? `?search=${encodeURIComponent(q)}` : "";
  const raw = await boFetch<Json>(`/api/backoffice/mutual-funds/tracker${qs}`);
  const data = arr(raw.data).map<MutualFundItem>((f) => ({
    scheme_code: String(f.scheme_code ?? ""),
    scheme_name: str(f.scheme_name) ?? "—",
    amc_name: str(f.amc),
    category: str(f.category),
    plan: str(f.plan),
    latest_nav: num(f.latest_nav),
    nav_date: str(f.latest_nav_date),
    isin_growth: str(f.isin),
  }));
  return envelope(raw, data);
};

export const getMicroIssuer = async (id: string): Promise<BackofficeEnvelope<MicroIssuerData | null>> => {
  const raw = await boFetch<Json>(`/api/backoffice/micro/issuers/${encodeURIComponent(id)}`);
  const d = raw.data ? obj(raw.data) : null;
  const data: MicroIssuerData | null = d
    ? {
        symbol: str(d.symbol) ?? id,
        reporting_scope: str(d.reporting_scope),
        fiscal_period: str(d.fiscal_period),
        revenue_crore: num(d.revenue_crore),
        ebitda_crore: num(d.ebitda_crore),
        ebitda_margin_pct: num(d.ebitda_margin_pct),
        pat_crore: num(d.pat_crore),
        filing_id: str(d.filing_id),
        quarters: arr(d.quarters).map((q) => ({
          period_end: str(q.period_end) ?? "—",
          revenue_crore: num(q.revenue_crore),
          ebitda_crore: num(q.ebitda_crore),
          ebitda_margin_pct: num(q.ebitda_margin_pct),
          pat_crore: num(q.pat_crore),
          filing_id: str(q.filing_id),
        })),
      }
    : null;
  return envelope(raw, data, "unavailable");
};

export const analyzeImpact = async (body: {
  pair_a: string;
  pair_b: string;
  window_sessions?: number;
}): Promise<BackofficeEnvelope<ImpactAnalysisData>> => {
  // Page labels A as the dependent variable (Y) and B as the driver (X); backend regresses y on x.
  const raw = await boFetch<Json>("/api/backoffice/impact/analyze", {
    method: "POST",
    body: JSON.stringify({
      series_x_id: body.pair_b,
      series_y_id: body.pair_a,
      horizon_days: body.window_sessions ?? 60,
    }),
  });
  const align = obj(raw.alignment);
  const stats = obj(raw.statistics);
  const data: ImpactAnalysisData = {
    pair_a: body.pair_a,
    pair_b: body.pair_b,
    sample_size: num(align.n) ?? 0,
    paired_ratio_pct: num(align.coverage_pct) ?? 0,
    correlation: num(stats.correlation) ?? null,
    beta: num(stats.beta) ?? null,
    status: str(stats.status) ?? str(align.status),
    message: str(stats.message),
  };
  return envelope(raw, data);
};

export const simulateScenario = async (body: {
  bond_duration?: number;
  yield_shift_bps?: number;
  fx_shift_pct?: number;
}): Promise<BackofficeEnvelope<ImpactScenarioData>> => {
  const raw = await boFetch<Json>("/api/backoffice/impact/scenario", {
    method: "POST",
    body: JSON.stringify({
      modified_duration: body.bond_duration ?? 6.5,
      us_yield_shock_bps: body.yield_shift_bps ?? 0,
      usd_shock_pct: body.fx_shift_pct ?? 0,
      oil_shock_pct: 0,
    }),
  });
  const impacts = obj(raw.impacts);
  const shocks = obj(raw.shocks);
  const bps = num(shocks.us_10y_yield_shift_bps) ?? 0;
  const data: ImpactScenarioData = {
    delta_yield_decimal: bps / 10000,
    estimated_price_change_pct: num(impacts.bond_portfolio_price_change_pct) ?? 0,
    formula: "ΔP/P ≈ -D_mod * (Δbps / 10000)",
  };
  return envelope(raw, data);
};

export const getDeterministicBriefing = async (): Promise<BackofficeEnvelope<DeterministicBriefingData>> => {
  const raw = await boFetch<Json>("/api/backoffice/briefing");
  const data: DeterministicBriefingData = {
    title: str(raw.title) ?? "Daily Research Briefing",
    as_of: str(raw.as_of) ?? "",
    method_version: str(raw.method_version) ?? "",
    bullets: arr(raw.bullets) as unknown as string[],
    disclaimer: str(raw.disclaimer) ?? "",
  };
  return envelope(raw, data);
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
  }));
};

export const createStaffMember = async (body: {
  name: string;
  email: string;
  mobile: string;
  role: string;
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
  };
};
