// TODO(owner-compliance-review): this file contains user-facing copy.
// W4-owned fetch helpers for CRM product/compliance endpoints (policies, FDs,
// PMS, KYC, mandates, consents, suitability, disclosures) plus the W4-local
// opportunity / pipeline / activity / case helpers used by the pipeline,
// agenda, and case tabs. No cross-worker imports: only ./api is reused.

import { API_URL, ApiError, resolveApiUrl } from "./api";
import { withListLimit } from "./crmApi";

async function crmRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method === "GET";
  const targetUrl = resolveApiUrl(isGet ? url.replace(/^(.*?\/api\/crm)(\/.*)$/, (_m, a, b) => a + withListLimit(b)) : url);
  const res = await fetch(targetUrl, {
    ...init,
    credentials: "include", // backend sets the fh_session httpOnly cookie
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
  return res.json() as Promise<T>;
}

/** Integer paise -> human-readable rupees. Never fabricates values: null stays "—". */
export function formatRupeesFromPaise(paise: number | null | undefined): string {
  if (paise == null) return "—";
  const v = paise / 100;
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: v % 1 === 0 ? 0 : 2 });
}

/** "sip_active" -> "Sip Active". */
export function stageLabel(stage: string): string {
  return stage
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/* ---------------- products & compliance types ---------------- */

export type ProductLine = "mutual_fund" | "life_insurance" | "general_insurance" | "corporate_fd" | "pms";

export const PRODUCT_LINES: { value: ProductLine; label: string }[] = [
  { value: "mutual_fund", label: "Mutual Funds" },
  { value: "life_insurance", label: "Life Insurance" },
  { value: "general_insurance", label: "General Insurance" },
  { value: "corporate_fd", label: "Corporate FDs" },
  { value: "pms", label: "PMS" },
];

/** Kanban columns per product line. Every line ends in "won"; "lost" is the other terminal stage and is appended to all. */
export const STAGES_BY_LINE: Record<ProductLine, string[]> = {
  mutual_fund: ["illustration", "discussion", "invested", "sip_active", "won"],
  life_insurance: ["need_analysis", "proposal", "issued", "active", "won"],
  general_insurance: ["quote", "proposal", "issued", "renewal_due", "won"],
  corporate_fd: ["proposed", "booked", "matured", "won"],
  pms: ["prospect", "disclosure_given", "agreement_signed", "funded", "reporting", "won"],
};

export const CLOSED_STAGES = ["won", "lost"] as const;
export const isClosedStage = (stage: string): boolean => (CLOSED_STAGES as readonly string[]).includes(stage);

export interface InsurancePolicy {
  id: string;
  household_id?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  policy_type: string;
  insurer?: string | null;
  policy_no?: string | null;
  premium_amount?: number | null; // paise
  premium_due_date?: string | null;
  renewal_date?: string | null;
  status: string;
  notes?: string | null;
}

export interface FixedDeposit {
  id: string;
  household_id?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  company?: string | null;
  amount?: number | null; // paise
  interest_rate?: number | null;
  start_date?: string | null;
  maturity_date?: string | null;
  status: string;
  notes?: string | null;
}

export interface PmsAccount {
  id: string;
  household_id?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  provider?: string | null;
  agreement_date?: string | null;
  amount?: number | null; // paise
  fee_fixed_pct?: number | null;
  fee_performance_pct?: number | null;
  hurdle_pct?: number | null;
  high_water_mark: number;
  exit_load_pct?: number | null;
  disclosure_doc_version?: string | null;
  disclosure_given_at?: string | null;
  fee_acknowledged_at?: string | null;
  reporting_cycle: string;
  last_report_at?: string | null;
  accredited_investor: number;
  status: string;
}

export interface KycRecord {
  customer_id: string;
  pan_last4?: string | null; // last 4 chars only — the backend never stores full PAN here
  kra_status: string;
  ckyc_id?: string | null;
  updated_at: string;
}

export interface Mandate {
  id: string;
  customer_id: string;
  customer_name?: string | null;
  umrn?: string | null;
  bank_name?: string | null;
  amount_cap?: number | null; // paise
  status: string;
  created_at: string;
}

export interface Consent {
  id: string;
  customer_id: string;
  purpose: string;
  granted: number; // 1 | 0
  notice_version?: string | null;
  granted_at?: string | null;
  withdrawn_at?: string | null;
}

export const CONSENT_PURPOSES: { value: string; label: string }[] = [
  { value: "onboarding", label: "Onboarding" },
  { value: "regulatory_reporting", label: "Regulatory reporting" },
  { value: "communications", label: "Communications" },
  { value: "marketing", label: "Marketing" },
  { value: "data_sharing", label: "Data sharing" },
];

export interface SuitabilityRecord {
  id: string;
  customer_id: string;
  financial_status?: string | null;
  investment_experience?: string | null;
  objectives?: string | null;
  risk_band?: string | null;
  recorded_by_rm_id?: string | null;
  recorded_at: string;
}

export interface DisclosureLog {
  id: string;
  customer_id: string;
  opportunity_id?: string | null;
  schemes_compared?: string | null; // JSON array string
  commissions_disclosed?: string | null;
  regular_plan_noted: number;
  created_at: string;
}

/* ---------------- W4-local pipeline/activity/case types ---------------- */

export interface Opportunity {
  id: string;
  household_id?: string | null;
  customer_id?: string | null;
  household_name?: string | null;
  customer_name?: string | null;
  product_line: ProductLine;
  title: string;
  amount?: number | null; // paise
  stage: string;
  probability: number; // 0-100
  expected_close?: string | null;
  assigned_rm_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  lost_reason?: string | null;
  closed_at?: string | null;
  won_amount?: number | null;
}

export interface PipelineStageStat {
  stage: string;
  count: number;
  value: number; // paise, open stages only
}

export interface PipelineSummary {
  stages: PipelineStageStat[];
  total_value: number; // paise, open pipeline: excludes won and lost
  total_count: number;
  closed?: Record<"won" | "lost", { count: number; value: number }>;
}

export type ActivityKind = "call" | "meeting" | "note" | "followup" | "email" | "review" | "whatsapp";

export interface Activity {
  id: string;
  kind: ActivityKind;
  subject: string;
  body?: string | null;
  household_id?: string | null;
  customer_id?: string | null;
  opportunity_id?: string | null;
  case_id?: string | null;
  policy_id?: string | null;
  fd_id?: string | null;
  due_at?: string | null;
  done_at?: string | null;
  assigned_rm_id?: string | null;
  created_at: string;
}

export type CaseStatus = "open" | "in_progress" | "resolved" | "escalated_amc" | "escalated_scores" | "closed";

export interface CrmCase {
  id: string;
  customer_id: string;
  customer_name?: string | null;
  category: string;
  subject: string;
  body?: string | null;
  status: CaseStatus;
  sla_due_at?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

/* ---------------- policies ---------------- */

export const getPolicies = (params?: { household_id?: string; customer_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.household_id) q.set("household_id", params.household_id);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  const qs = q.toString();
  return crmRequest<InsurancePolicy[]>(`${API_URL}/api/crm/policies${qs ? `?${qs}` : ""}`);
};

export const createPolicy = (body: Partial<InsurancePolicy>) =>
  crmRequest<InsurancePolicy>(`${API_URL}/api/crm/policies`, { method: "POST", body: JSON.stringify(body) });

export const patchPolicy = (id: string, body: Partial<InsurancePolicy>) =>
  crmRequest<InsurancePolicy>(`${API_URL}/api/crm/policies/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---------------- fixed deposits ---------------- */

export const getFds = (params?: { household_id?: string; customer_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.household_id) q.set("household_id", params.household_id);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  const qs = q.toString();
  return crmRequest<FixedDeposit[]>(`${API_URL}/api/crm/fds${qs ? `?${qs}` : ""}`);
};

export const createFd = (body: Partial<FixedDeposit>) =>
  crmRequest<FixedDeposit>(`${API_URL}/api/crm/fds`, { method: "POST", body: JSON.stringify(body) });

export const patchFd = (id: string, body: Partial<FixedDeposit>) =>
  crmRequest<FixedDeposit>(`${API_URL}/api/crm/fds/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---------------- PMS ---------------- */

export const getPmsAccounts = (params?: { household_id?: string; customer_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.household_id) q.set("household_id", params.household_id);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  const qs = q.toString();
  return crmRequest<PmsAccount[]>(`${API_URL}/api/crm/pms${qs ? `?${qs}` : ""}`);
};

export const createPmsAccount = (body: Partial<PmsAccount>) =>
  crmRequest<PmsAccount>(`${API_URL}/api/crm/pms`, { method: "POST", body: JSON.stringify(body) });

export const patchPmsAccount = (id: string, body: Partial<PmsAccount>) =>
  crmRequest<PmsAccount>(`${API_URL}/api/crm/pms/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---------------- KYC ---------------- */

export const getKyc = (customer_id: string) =>
  crmRequest<KycRecord>(`${API_URL}/api/crm/kyc?customer_id=${encodeURIComponent(customer_id)}`);

export const upsertKyc = (body: { customer_id: string; pan_last4: string; kra_status: string; ckyc_id?: string }) =>
  crmRequest<KycRecord>(`${API_URL}/api/crm/kyc`, { method: "POST", body: JSON.stringify(body) });

/* ---------------- mandates ---------------- */

export const getMandates = (customer_id: string) =>
  crmRequest<Mandate[]>(`${API_URL}/api/crm/mandates?customer_id=${encodeURIComponent(customer_id)}`);

export const createMandate = (body: Partial<Mandate> & { customer_id: string }) =>
  crmRequest<Mandate>(`${API_URL}/api/crm/mandates`, { method: "POST", body: JSON.stringify(body) });

export const patchMandate = (id: string, body: Partial<Mandate>) =>
  crmRequest<Mandate>(`${API_URL}/api/crm/mandates/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---------------- consents ---------------- */

export const getConsents = (customer_id: string) =>
  crmRequest<Consent[]>(`${API_URL}/api/crm/consents?customer_id=${encodeURIComponent(customer_id)}`);

export const upsertConsent = (body: { customer_id: string; purpose: string; granted: boolean; notice_version?: string }) =>
  crmRequest<Consent>(`${API_URL}/api/crm/consents`, {
    method: "POST",
    body: JSON.stringify({ ...body, granted: body.granted ? 1 : 0 }),
  });

/* ---------------- suitability ---------------- */

export const getSuitability = (customer_id: string) =>
  crmRequest<SuitabilityRecord[]>(`${API_URL}/api/crm/suitability?customer_id=${encodeURIComponent(customer_id)}`);

export const createSuitability = (body: {
  customer_id: string;
  financial_status?: string;
  investment_experience?: string;
  objectives?: string;
  risk_band?: string;
}) => crmRequest<SuitabilityRecord>(`${API_URL}/api/crm/suitability`, { method: "POST", body: JSON.stringify(body) });

/* ---------------- disclosures ---------------- */

export const getDisclosures = (params?: { customer_id?: string; opportunity_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  if (params?.opportunity_id) q.set("opportunity_id", params.opportunity_id);
  const qs = q.toString();
  return crmRequest<DisclosureLog[]>(`${API_URL}/api/crm/disclosures${qs ? `?${qs}` : ""}`);
};

export const createDisclosure = (body: {
  customer_id: string;
  opportunity_id?: string;
  schemes_compared?: string;
  commissions_disclosed?: string;
  regular_plan_noted?: boolean;
}) =>
  crmRequest<DisclosureLog>(`${API_URL}/api/crm/disclosures`, {
    method: "POST",
    body: JSON.stringify({ ...body, regular_plan_noted: body.regular_plan_noted ? 1 : 0 }),
  });

/* ---------------- W4-local: opportunities & pipeline ---------------- */

export const getOpportunities = (params?: {
  product_line?: ProductLine;
  stage?: string;
  household_id?: string;
  assigned_rm_id?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.product_line) q.set("product_line", params.product_line);
  if (params?.stage) q.set("stage", params.stage);
  if (params?.household_id) q.set("household_id", params.household_id);
  if (params?.assigned_rm_id) q.set("assigned_rm_id", params.assigned_rm_id);
  const qs = q.toString();
  return crmRequest<Opportunity[]>(`${API_URL}/api/crm/opportunities${qs ? `?${qs}` : ""}`);
};

export const patchOpportunity = (id: string, body: Partial<Opportunity>) =>
  crmRequest<Opportunity>(`${API_URL}/api/crm/opportunities/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const getPipeline = (product_line: ProductLine) =>
  crmRequest<PipelineSummary>(`${API_URL}/api/crm/pipeline?product_line=${encodeURIComponent(product_line)}`);

/* ---------------- W4-local: activities ---------------- */

export const getActivities = (params?: {
  assigned_rm_id?: string;
  household_id?: string;
  customer_id?: string;
  opportunity_id?: string;
  case_id?: string;
  done?: boolean;
  due_before?: string;
}) => {
  const q = new URLSearchParams();
  if (params?.assigned_rm_id) q.set("assigned_rm_id", params.assigned_rm_id);
  if (params?.household_id) q.set("household_id", params.household_id);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  if (params?.opportunity_id) q.set("opportunity_id", params.opportunity_id);
  if (params?.case_id) q.set("case_id", params.case_id);
  if (params?.done !== undefined) q.set("done", params.done ? "true" : "false");
  if (params?.due_before) q.set("due_before", params.due_before);
  const qs = q.toString();
  return crmRequest<Activity[]>(`${API_URL}/api/crm/activities${qs ? `?${qs}` : ""}`);
};

export const createActivity = (body: {
  kind: ActivityKind;
  subject: string;
  body?: string;
  household_id?: string;
  customer_id?: string;
  opportunity_id?: string;
  case_id?: string;
  due_at?: string;
  assigned_rm_id?: string;
}) => crmRequest<Activity>(`${API_URL}/api/crm/activities`, { method: "POST", body: JSON.stringify(body) });

export const patchActivity = (id: string, body: { done_at?: string | null; subject?: string; body?: string; due_at?: string }) =>
  crmRequest<Activity>(`${API_URL}/api/crm/activities/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---------------- W4-local: cases ---------------- */

export const getCases = (params?: { status?: string; customer_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  const qs = q.toString();
  return crmRequest<CrmCase[]>(`${API_URL}/api/crm/cases${qs ? `?${qs}` : ""}`);
};

export const createCase = (body: {
  customer_id: string;
  category: string;
  subject: string;
  body?: string;
  sla_due_at?: string;
}) => crmRequest<CrmCase>(`${API_URL}/api/crm/cases`, { method: "POST", body: JSON.stringify(body) });

export const patchCase = (id: string, body: { status?: CaseStatus; sla_due_at?: string; body?: string }) =>
  crmRequest<CrmCase>(`${API_URL}/api/crm/cases/${id}`, { method: "PATCH", body: JSON.stringify(body) });
