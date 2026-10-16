// TODO(owner-compliance-review): this file contains user-facing copy.
import { resolveApiUrl, API_URL, ApiError } from "./api";

/* Typed fetch helpers for the CRM (households, leads, opportunities, activities,
   cases, dashboard, renewals, maturities, task generation, client import).
   Cookie auth: the fh_session cookie is sent with every request. */

export const PRODUCT_LINES = [
  "mutual_fund",
  "life_insurance",
  "general_insurance",
  "corporate_fd",
  "pms",
] as const;
export type ProductLine = (typeof PRODUCT_LINES)[number];

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const ACTIVITY_KINDS = ["call", "meeting", "note", "followup", "email", "review", "whatsapp"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface Household {
  id: string;
  name: string;
  primary_customer_id: string | null;
  rm_id: string | null;
  notes: string | null;
  created_at: string;
  member_count: number;
  open_opportunities: number;
  aum_paise?: number;
  tier?: string;
  has_direct_plan?: boolean;
}

export interface HouseholdMember {
  customer_id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  role: string;
}

export interface Opportunity {
  id: string;
  household_id: string | null;
  customer_id: string | null;
  product_line: string;
  title: string;
  amount: number | null;
  stage: string;
  probability: number;
  expected_close: string | null;
  assigned_rm_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  lost_reason?: string | null;
  closed_at?: string | null;
  won_amount?: number | null;
  riskometer?: number | null;
  scheme_code?: string | null;
  suitability_note?: string | null;
  household_name?: string;
  customer_name?: string;
}

export interface Activity {
  id: string;
  kind: string;
  subject: string;
  body: string | null;
  household_id: string | null;
  customer_id: string | null;
  opportunity_id: string | null;
  case_id: string | null;
  policy_id: string | null;
  fd_id: string | null;
  due_at: string | null;
  done_at: string | null;
  assigned_rm_id: string | null;
  created_at: string;
}

export interface CrmCase {
  id: string;
  customer_id: string;
  category: string;
  subject: string;
  body: string | null;
  status: string;
  sla_due_at: string | null;
  created_at: string;
  resolved_at: string | null;
  customer_name?: string;
}

export interface HouseholdDetail {
  household: Household;
  members: HouseholdMember[];
  opportunities: Opportunity[];
  activities: Activity[];
  cases: CrmCase[];
}

export interface Lead {
  id: string;
  sr_no?: number | null;
  name: string;
  email: string | null;
  mobile: string | null;
  source: string;
  status: string;
  assigned_rm_id: string | null;
  notes: string | null;
  created_at: string;
  converted_household_id?: string | null;
  converted_at?: string | null;
}

export interface ConvertResult {
  customer_id: string;
  household_id: string;
  invited: boolean;
  temp_password?: string;
}

export interface PipelineStage {
  stage: string;
  count: number;
  value: number;
}

export interface PipelineSummary {
  stages: PipelineStage[]; // open stages only
  total_value: number; // open pipeline: excludes won and lost
  total_count: number;
  closed: Record<"won" | "lost", { count: number; value: number }>;
}

export interface CrmDashboard {
  households_count: number;
  active_leads_count: number;
  pipeline_value_by_line: Record<string, number>;
  renewals_due_30d: number;
  fd_maturities_60d: number;
  open_cases_count: number;
  tasks_due_count: number;
}

export interface RenewalItem {
  id: string;
  household_id: string | null;
  customer_id: string | null;
  policy_type: string;
  insurer: string | null;
  policy_no: string | null;
  premium_amount: number | null;
  renewal_date: string | null;
  customer_name?: string;
}

export interface MaturityItem {
  id: string;
  household_id: string | null;
  customer_id: string | null;
  company: string | null;
  amount: number | null;
  maturity_date: string | null;
  customer_name?: string;
}

export interface ImportRow {
  name: string;
  email: string;
  mobile?: string;
  household_name?: string;
  rm_email?: string;
}

export interface ImportResult {
  created: number;
  skipped: { email: string; reason: string }[];
  households_created: number;
}

/** Raw GET/POST against /api/crm/* for sections owned by other workers
 *  (policies, FDs, PMS, suitability) — no cross-worker imports, API contract only. */
export async function crmRaw<T>(path: string, init?: RequestInit): Promise<T> {
  return crmRequest<T>(path, init);
}

/** List endpoints page at 50 by default; the board-style tabs show everything, so ask for the maximum (500). */
const LIST_PATH = /^\/(households|leads|opportunities|activities|cases|renewals|maturities|policies|fds|pms|mandates|disclosures)(\?|$)/;

export function withListLimit(path: string): string {
  if (!LIST_PATH.test(path) || /[?&]limit=/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}limit=500`;
}

async function crmRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method === "GET";
  const targetUrl = resolveApiUrl(`${API_URL}/api/crm${isGet ? withListLimit(path) : path}`);
  const res = await fetch(targetUrl, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/* ---- Households ---- */

export const fetchHouseholds = () => crmRequest<Household[]>("/households");

export const createHousehold = (body: {
  name: string;
  primary_customer_id?: string;
  rm_id?: string;
  notes?: string;
}) => crmRequest<Household>("/households", { method: "POST", body: JSON.stringify(body) });

export const fetchHouseholdDetail = (id: string) =>
  crmRequest<HouseholdDetail>(`/households/${id}`);

export const patchHousehold = (
  id: string,
  body: { name?: string; rm_id?: string | null; notes?: string; primary_customer_id?: string | null },
) => crmRequest<Household>(`/households/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const addHouseholdMember = (
  householdId: string,
  body: { customer_id: string; role: string; override?: boolean },
) =>
  crmRequest<HouseholdMember>(`/households/${householdId}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/* ---- Leads ---- */

export const fetchLeads = (filters?: { status?: string; assigned_rm_id?: string }) =>
  crmRequest<Lead[]>(
    `/leads${qs({ status: filters?.status, assigned_rm_id: filters?.assigned_rm_id })}`,
  );

export const createLead = (body: {
  name: string;
  email?: string;
  mobile?: string;
  source?: string;
  notes?: string;
  assigned_rm_id?: string;
  allow_duplicates?: boolean;
}) => crmRequest<Lead>("/leads", { method: "POST", body: JSON.stringify(body) });

export const patchLead = (
  id: string,
  body: { name?: string; email?: string | null; mobile?: string | null; status?: string; assigned_rm_id?: string | null; notes?: string },
) => crmRequest<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const fetchLead = (id: string) => crmRequest<Lead>(`/leads/${id}`);
export const fetchOpportunity = (id: string) => crmRequest<Opportunity>(`/opportunities/${id}`);
export const fetchCase = (id: string) => crmRequest<CrmCase>(`/cases/${id}`);

export const convertLead = (
  id: string,
  body: {
    household_name?: string;
    household_id?: string;
    member_role?: string;
    invite_to_portal?: boolean;
    password?: string;
  },
) =>
  crmRequest<ConvertResult>(`/leads/${id}/convert`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/* ---- Opportunities ---- */

export const fetchOpportunities = (filters?: {
  product_line?: string;
  stage?: string;
  household_id?: string;
  assigned_rm_id?: string;
}) =>
  crmRequest<Opportunity[]>(
    `/opportunities${qs({
      product_line: filters?.product_line,
      stage: filters?.stage,
      household_id: filters?.household_id,
      assigned_rm_id: filters?.assigned_rm_id,
    })}`,
  );

export const createOpportunity = (body: {
  household_id?: string;
  customer_id?: string;
  product_line: string;
  title: string;
  amount?: number;
  stage?: string;
  probability?: number;
  expected_close?: string;
  assigned_rm_id?: string;
  notes?: string;
}) => crmRequest<Opportunity>("/opportunities", { method: "POST", body: JSON.stringify(body) });

export const patchOpportunity = (
  id: string,
  body: {
    stage?: string;
    probability?: number;
    amount?: number;
    expected_close?: string;
    notes?: string;
    assigned_rm_id?: string | null;
    title?: string;
    lost_reason?: string;
    won_amount?: number;
  },
) => crmRequest<Opportunity>(`/opportunities/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const fetchPipeline = (productLine?: string) =>
  crmRequest<PipelineSummary>(`/pipeline${qs({ product_line: productLine })}`);

/* ---- Activities ---- */

export const fetchActivities = (filters?: {
  assigned_rm_id?: string;
  household_id?: string;
  customer_id?: string;
  opportunity_id?: string;
  case_id?: string;
  done?: string;
  due_before?: string;
}) =>
  crmRequest<Activity[]>(
    `/activities${qs({
      assigned_rm_id: filters?.assigned_rm_id,
      household_id: filters?.household_id,
      customer_id: filters?.customer_id,
      opportunity_id: filters?.opportunity_id,
      case_id: filters?.case_id,
      done: filters?.done,
      due_before: filters?.due_before,
    })}`,
  );

export const createActivity = (body: {
  kind: string;
  subject: string;
  body?: string;
  household_id?: string;
  customer_id?: string;
  opportunity_id?: string;
  case_id?: string;
  lead_id?: string;
  due_at?: string;
  assigned_rm_id?: string;
}) => crmRequest<Activity & { warnings?: string[] }>("/activities", { method: "POST", body: JSON.stringify(body) });

export const patchActivity = (
  id: string,
  body: { done_at?: string | null; subject?: string; body?: string; due_at?: string },
) => crmRequest<Activity>(`/activities/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---- Cases ---- */

export const fetchCases = (filters?: { status?: string; customer_id?: string }) =>
  crmRequest<CrmCase[]>(`/cases${qs({ status: filters?.status, customer_id: filters?.customer_id })}`);

export const createCase = (body: {
  customer_id: string;
  category: string;
  subject: string;
  body?: string;
  sla_due_at?: string;
}) => crmRequest<CrmCase>("/cases", { method: "POST", body: JSON.stringify(body) });

export const patchCase = (
  id: string,
  body: { status?: string; sla_due_at?: string; body?: string },
) => crmRequest<CrmCase>(`/cases/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---- Dashboard / renewals / maturities / task generation ---- */

export const fetchDashboard = () => crmRequest<CrmDashboard>("/dashboard");

export const fetchRenewals = (days = 45) => crmRequest<RenewalItem[]>(`/renewals?days=${days}`);

export const fetchMaturities = (days = 60) =>
  crmRequest<MaturityItem[]>(`/maturities?days=${days}`);

export const generateRenewalTasks = (type: "policy" | "fd") =>
  crmRequest<{ created: number }>("/renewals/generate-tasks", {
    method: "POST",
    body: JSON.stringify({ type }),
  });

/* ---- Client import ---- */

export const importClients = (rows: ImportRow[]) =>
  crmRequest<ImportResult>("/import/clients", {
    method: "POST",
    body: JSON.stringify({ rows }),
  });

/** Admin only: records created after each given ISO time, keyed by CRM tab. */
export const fetchNewCounts = (since: Record<string, string>) =>
  crmRequest<Record<string, number>>(`/new-counts?${new URLSearchParams(since)}`);
