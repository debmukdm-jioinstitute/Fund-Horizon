// TODO(owner-compliance-review): this file contains user-facing copy.
import { API_URL, resolveApiUrl } from "./api";

export interface AdminStats {
  total_plans: number;
  total_cas_sessions: number;
  total_schemes: number;
  total_amcs: number;
  total_categories: number;
  data_asof: string;
  database: {
    provider: string;
    connected: boolean;
    path?: string;
    dialect?: string;
    url?: string;
    size_bytes?: number;
  };
  recent_plans: AdminPlanSummary[];
  recent_cas: AdminCasSummary[];
}

export interface AdminPlanSummary {
  id: string;
  created_at: string;
  client_name: string;
  age?: number;
  risk_band?: string;
  risk_score?: number;
  target_corpus: number;
  total_sip?: number;
  goals_count: number;
  request?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export interface AdminCasSummary {
  session_id: string;
  created_at: string;
  investor_name: string;
  total_value: number;
  xirr?: number;
  holdings_count: number;
  direct_pct: number;
  regular_pct: number;
  payload?: Record<string, unknown>;
}

export interface AdminSchemeRecord {
  scheme_code: string;
  scheme_name: string;
  amc: string;
  category: string;
  plan: string;
  option: string;
  latest_nav?: number;
  ret_1y?: number;
  cagr_3y?: number;
  cagr_5y?: number;
  vol_3y?: number;
  sharpe_3y?: number;
  sortino_3y?: number;
  max_drawdown_3y?: number;
  data_quality: string;
}

export interface AdminSchemesResponse {
  total: number;
  limit: number;
  offset: number;
  schemes: AdminSchemeRecord[];
  amcs: string[];
  categories: string[];
}

export interface AdminConfigResponse {
  assumptions: Record<string, unknown>;
  allocation: Record<string, unknown>;
  scoring: Record<string, unknown>;
  ai?: Record<string, unknown>;
}

export interface AdminHealthResponse {
  status: string;
  database: Record<string, unknown>;
  rag: Record<string, unknown>;
  cors_origins: string;
}

const ADMIN_KEY_STORAGE = "fh_admin_key";

/** The admin key lives in sessionStorage only, so it ends with the browser tab. */
export function readAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function saveAdminKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    localStorage.removeItem(ADMIN_KEY_STORAGE); // drop any key stored by an older version
  } catch {
    /* storage may be unavailable */
  }
}

function getHeaders(adminKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const key = adminKey || readAdminKey();
  if (key) {
    headers["X-Admin-Key"] = key;
  }
  return headers;
}

export async function fetchAdminStats(key?: string): Promise<AdminStats> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/stats`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}

export async function fetchAdminHealth(key?: string): Promise<AdminHealthResponse> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/health`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load health status (${res.status})`);
  return res.json();
}

export async function fetchAdminPlans(
  limit = 50,
  offset = 0,
  search?: string,
  key?: string,
): Promise<{ total: number; limit: number; offset: number; plans: AdminPlanSummary[] }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.append("search", search);

  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/plans?${params}`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load plans (${res.status})`);
  return res.json();
}

export async function fetchAdminPlan(id: string, key?: string): Promise<Record<string, unknown>> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/plans/${id}`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load plan details (${res.status})`);
  return res.json();
}

export async function deleteAdminPlan(id: string, key?: string): Promise<boolean> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/plans/${id}`), {
    method: "DELETE",
    headers: getHeaders(key),
  });
  if (!res.ok) throw new Error(`Failed to delete plan (${res.status})`);
  return true;
}

export async function fetchAdminCasSessions(
  limit = 50,
  offset = 0,
  key?: string,
): Promise<{ total: number; limit: number; offset: number; sessions: AdminCasSummary[] }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/cas-sessions?${params}`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load CAS sessions (${res.status})`);
  return res.json();
}

export async function fetchAdminCasSession(id: string, key?: string): Promise<Record<string, unknown>> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/cas-sessions/${id}`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load CAS details (${res.status})`);
  return res.json();
}

export async function fetchAdminSchemes(
  params: {
    search?: string;
    amc?: string;
    category?: string;
    plan?: string;
    sort_by?: string;
    order?: string;
    limit?: number;
    offset?: number;
  } = {},
  key?: string,
): Promise<AdminSchemesResponse> {
  const query = new URLSearchParams();
  if (params.search) query.append("search", params.search);
  if (params.amc) query.append("amc", params.amc);
  if (params.category) query.append("category", params.category);
  if (params.plan) query.append("plan", params.plan);
  if (params.sort_by) query.append("sort_by", params.sort_by);
  if (params.order) query.append("order", params.order);
  if (params.limit) query.append("limit", String(params.limit));
  if (params.offset) query.append("offset", String(params.offset));

  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/schemes?${query}`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load schemes (${res.status})`);
  return res.json();
}

export async function fetchAdminConfig(key?: string): Promise<AdminConfigResponse> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/config`), {
    headers: getHeaders(key),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load config (${res.status})`);
  return res.json();
}

export async function triggerAdminRefresh(
  dryRun = false,
  key?: string,
): Promise<{ success: boolean; dry_run: boolean; funds_processed: number; metrics_processed: number; message: string }> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/refresh`), {
    method: "POST",
    headers: getHeaders(key),
    body: JSON.stringify({ dry_run: dryRun }),
  });
  if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
  return res.json();
}
