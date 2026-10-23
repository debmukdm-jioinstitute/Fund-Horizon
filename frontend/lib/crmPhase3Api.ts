// Typed helpers for the CRM Phase 3 endpoints (contacts, holdings/AUM, SIPs, commissions, suitability, campaigns, teams).
import { API_URL, ApiError, resolveApiUrl } from "./api";

export const TAX_STATUSES = ["resident", "nri", "oci"] as const;
export const RELATIONS = ["self", "spouse", "child", "parent", "sibling", "dependent", "other"] as const;
export const FATCA_CRS = ["not_collected", "self_certified", "resident_india_only", "us_person", "other_foreign_tax_resident"] as const;
export const TIERS = ["platinum", "gold", "silver", "standard"] as const;
export const RISKOMETER_LABELS: Record<number, string> = { 1: "Low", 2: "Low to Moderate", 3: "Moderate", 4: "Moderately High", 5: "High", 6: "Very High" };

export interface ContactDetail {
  id: string;
  customer_id: string;
  household_id: string;
  household_name: string | null;
  rm_id: string | null;
  name: string;
  email: string | null;
  mobile: string | null;
  relation: string;
  dob: string | null;
  age: number | null;
  is_minor: boolean;
  guardian_contact_id: string | null;
  tax_status: string;
  country: string | null;
  nre_bank: string | null;
  nro_bank: string | null;
  nominee_name: string | null;
  nominee_relation: string | null;
  nominee_pct: number | null;
  fatca_crs: string;
  kyc_expiry: string | null;
  kyc: { pan_last4: string | null; kra_status: string; ckyc_id: string | null } | null;
  gaps: string[];
}

export interface Holding {
  id: string;
  contact_id: string;
  contact_name?: string | null;
  folio: string;
  scheme_code: string;
  scheme_name: string | null;
  units: number;
  cost_paise: number;
  as_of: string;
  nav: number | null;
  nav_date: string | null;
  value_paise: number | null;
  gain_paise: number | null;
  plan: string | null;
  is_direct: boolean;
}

export interface AumPayload {
  holdings: Holding[];
  aum_paise: number;
  cost_paise: number;
  unvalued: number;
  tier: string;
  direct_plan_holdings: Holding[];
  has_direct_plan?: boolean;
}

export interface ImportResult {
  dry_run: boolean;
  rows: number;
  created: number;
  updated: number;
  matched_rows: number;
  contacts?: number;
  skipped: { row: number; reason: string; folio?: string }[];
  unvalued_schemes?: string[];
  aum_paise?: number;
  lines?: number;
  unmatched?: { folio: string; scheme_code: string; month: string; amount_paise: number }[];
  total_paise?: number;
}

export interface Sip {
  id: string;
  contact_id: string;
  scheme_code: string;
  scheme_name: string | null;
  type: string;
  amount_paise: number;
  day: number;
  start_date: string;
  end_date: string | null;
  mandate_id: string | null;
  status: string;
  bounce_count: number;
}

export interface SipAlert {
  kind: "ending_soon" | "bounce" | "mandate_expiring";
  sip_id: string;
  contact_name: string | null;
  household_id: string | null;
  due: string;
  message: string;
}

export interface CommissionSummary {
  total_paise: number;
  unmatched_paise: number;
  by_household: { household_id: string; household_name: string | null; amount_paise: number }[];
  by_rm: { rm_id: string; rm_name?: string | null; amount_paise: number }[];
  by_month: { month: string; amount_paise: number }[];
}

export interface Assessment {
  id: string;
  risk_band: string | null;
  score: number | null;
  review_due: string | null;
  max_riskometer: number | null;
  max_riskometer_label?: string;
  recorded_at: string;
  valid: boolean;
}

export interface Questionnaire {
  questions: { id: string; text: string; options: { text: string; score: number }[] }[];
  riskometer_labels: Record<string, string>;
}

export interface SuitabilityCheck {
  riskometer: number | null;
  level: "ok" | "warn" | "block";
  message: string | null;
  gap: number | null;
}

export interface Segment {
  aum_min?: number;
  aum_max?: number;
  tier?: string[];
  tax_status?: string[];
  sip_status?: string;
  has_direct_plan?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  segment: Segment;
  member_counts: Record<string, number>;
  member_total: number;
  owner_id: string | null;
  members?: { contact_id: string; name: string | null; household_id: string; household_name: string; status: string; notes: string | null }[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/crm${path}`), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (j.detail && typeof j.detail.message === "string") msg = j.detail.message;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) msg = String(j.detail[0].msg);
    } catch {
      /* keep default */
    }
    throw new ApiError(msg, res.status);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
const post = <T>(path: string, body?: unknown) => call<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });

/* contacts */
export const fetchContact = (id: string) => call<ContactDetail>(`/contacts/${id}`);
export const createContact = (body: Partial<ContactDetail> & { name: string; household_id: string }) => post<ContactDetail>("/contacts", body);
export const patchContact = (id: string, body: Record<string, unknown>) => patch<ContactDetail>(`/contacts/${id}`, body);
export const fetchContactGaps = () => call<{ id: string; name: string; household_id: string; household_name: string; gaps: string[]; kyc_expiry: string | null }[]>("/contacts/gaps?limit=500");

/* holdings */
export const fetchHouseholdAum = (householdId: string) => call<AumPayload>(`/households/${householdId}/aum`);
export const fetchContactHoldings = (contactId: string) => call<AumPayload>(`/contacts/${contactId}/holdings`);
export const importHoldings = (csv_text: string, as_of: string | undefined, dry_run: boolean, source = "cas") =>
  post<ImportResult>("/holdings/import", { csv_text, as_of: as_of || undefined, dry_run, source });
export interface HoldingInput {
  contact_id: string;
  folio: string;
  scheme_code: string;
  scheme_name?: string | null;
  units: number;
  cost?: number | null;
  cost_paise?: number;
  as_of?: string | null;
  source?: string;
}

export const createHolding = (body: HoldingInput) => post<{ status: string; holding: Record<string, unknown> }>("/holdings", body);
export const deleteHolding = (id: string) => call<{ status: string; deleted: boolean }>("/holdings/" + id, { method: "DELETE" });

/* sips */
export const fetchSips = (filters: { contact_id?: string; status?: string } = {}) => {
  const q = new URLSearchParams({ limit: "200", ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string> });
  return call<Sip[]>(`/sips?${q}`);
};
export const createSip = (body: Omit<Sip, "id" | "scheme_name" | "bounce_count" | "status"> & { scheme_name?: string; status?: string }) => post<Sip>("/sips", body);
export const patchSip = (id: string, body: Partial<Sip>) => patch<Sip>(`/sips/${id}`, body);
export const bounceSip = (id: string) => post<Sip>(`/sips/${id}/bounce`);
export const fetchSipBook = () => call<{ count: number; monthly_paise: number }>("/sips/book");
export const fetchSipAlerts = () => call<SipAlert[]>("/sips/alerts");
export const generateSipAlerts = () => post<{ created: number; alerts: number }>("/sips/generate-alerts");

/* commissions */
export const importCommissions = (csv_text: string, dry_run: boolean, source?: string) => post<ImportResult>("/commissions/import", { csv_text, dry_run, source });
export const fetchCommissionSummary = (from?: string, to?: string) => {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return call<CommissionSummary>(`/commissions/summary?${q}`);
};

/* suitability */
export const fetchQuestionnaire = () => call<Questionnaire>("/suitability/questionnaire");
export const assessSuitability = (customer_id: string, answers: Record<string, number>) => post<Assessment & { max_riskometer_label: string }>("/suitability/assess", { customer_id, answers });
export const fetchSuitabilityStatus = (customer_id: string) => call<{ assessment: Assessment | null }>(`/suitability/status?customer_id=${customer_id}`);
export const checkSuitability = (body: { customer_id?: string; riskometer?: number; scheme_code?: string }) => post<SuitabilityCheck>("/suitability/check", body);

/* campaigns */
export const fetchCampaigns = () => call<Campaign[]>("/campaigns?limit=200");
export const fetchCampaign = (id: string) => call<Campaign>(`/campaigns/${id}`);
export const createCampaign = (name: string, description: string | undefined, segment: Segment) => post<Campaign>("/campaigns", { name, description, segment });
export const patchCampaign = (id: string, body: Record<string, unknown>) => patch<Campaign>(`/campaigns/${id}`, body);
export const previewCampaign = (segment: Segment) => post<{ count: number; households: number; sample: { contact_id: string; name: string; household_name: string; aum_paise: number; tier: string }[] }>("/campaigns/preview", segment);
export const populateCampaign = (id: string) => post<{ matched: number; added: number }>(`/campaigns/${id}/populate`);
export const setMemberStatus = (id: string, contactId: string, status: string, notes?: string) => patch(`/campaigns/${id}/members/${contactId}`, { status, notes });

/* teams */
export const fetchTeams = () => call<{ links: { rm_id: string; lead_id: string }[]; my_team: string[] | null }>("/teams");
export const setTeamLead = (rmId: string, leadId: string | null) => call(`/teams/${rmId}`, { method: "PUT", body: JSON.stringify({ lead_id: leadId }) });
