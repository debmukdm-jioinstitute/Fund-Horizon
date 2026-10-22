import type {
  CasAnalysisResult,
  CatalogInstrument,
  CatalogResponse,
  CompareResponse,
  Customer,
  ExplainResponse,
  FundAnalytics,
  FundDetail,
  FundReference,
  LoginCustomerBody,
  Meta,
  MyPlan,
  Plan,
  PlanRequest,
  PortalAnalytics,
  PortalDashboard,
  PortalHealth,
  PortalPlanPatch,
  Questionnaire,
  RagAnswerResult,
  SignupCustomerBody,
  TaxCalcResult,
  TaxProfileInput,
  TaxSwitches,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const SERVER_API_URL = (process.env.API_INTERNAL_URL ?? API_URL).replace(/\/+$/, "");

export function resolveApiUrl(url: string): string {
  if (typeof window !== "undefined") {
    if (API_URL && url.startsWith(API_URL)) {
      const rest = url.slice(API_URL.length);
      return rest.startsWith("/") ? rest : `/${rest}`;
    }
  }
  return url;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const targetUrl = resolveApiUrl(url);
  const res = await fetch(targetUrl, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
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

export const getMeta = () => request<Meta>(`${API_URL}/api/meta`);
export const getQuestionnaire = () => request<Questionnaire>(`${API_URL}/api/questionnaire`);
export const createPlan = (body: PlanRequest) =>
  request<Plan>(`${API_URL}/api/plans`, { method: "POST", body: JSON.stringify(body) });
export const getPlan = (id: string, stepUp?: number, tax?: Partial<TaxSwitches>) => {
  const q = new URLSearchParams();
  if (stepUp !== undefined) q.set("step_up", String(stepUp));
  if (tax?.regime) q.set("regime", tax.regime);
  if (tax?.tax_view) q.set("tax_view", tax.tax_view);
  if (tax?.apply) q.set("apply", tax.apply.join(","));
  if (tax?.reinvest !== undefined) q.set("reinvest", String(tax.reinvest));
  const qs = q.toString();
  return request<Plan>(`${API_URL}/api/plans/${id}${qs ? `?${qs}` : ""}`);
};
export const reportUrl = (id: string) => resolveApiUrl(`${API_URL}/api/plans/${id}/report.pdf`);

/** Customer portal v1: dashboard payload for a plan. */
export const getPortalDashboard = (id: string) =>
  request<PortalDashboard>(`${API_URL}/api/plans/${id}/dashboard`);
/** Customer portal v1: patch the plan in place (goals / client / answers edits). */
export const patchPortalPlan = (id: string, patch: PortalPlanPatch) =>
  request<Plan>(`${API_URL}/api/plans/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
/** Customer portal v1: financial-health score payload for a plan. */
export const getPortalHealth = (id: string) =>
  request<PortalHealth>(`${API_URL}/api/plans/${id}/health`);
/** Customer portal v1: analytics payload for a plan. */
export const getPortalAnalytics = (id: string) =>
  request<PortalAnalytics>(`${API_URL}/api/plans/${id}/analytics`);

export const getFundDetail = (code: string) => request<FundDetail>(`${API_URL}/api/funds/${code}`);
export const getFundAnalytics = (code: string) =>
  request<FundAnalytics>(`${API_URL}/api/funds/${code}/analytics`);
export const compareFunds = (codes: string[]) =>
  request<CompareResponse>(`${API_URL}/api/funds/compare?codes=${codes.join(",")}`);

async function getServerHeaders(): Promise<Record<string, string>> {
  try {
    const { cookies } = await import("next/headers");
    const cookieHeader = cookies().toString();
    return cookieHeader ? { Cookie: cookieHeader } : {};
  } catch {
    return {};
  }
}

/** Server-side fetch used by server components (landing page, footer). */
export async function getMetaServer(): Promise<Meta | null> {
  try {
    const headers = await getServerHeaders();
    const res = await fetch(`${SERVER_API_URL}/api/meta`, { cache: "no-store", headers });
    return res.ok ? ((await res.json()) as Meta) : null;
  } catch {
    return null;
  }
}

/** Server-side plan fetch with forwarded session cookies. Returns null on 404 so caller can trigger notFound(). */
export async function getPlanServer(id: string, stepUp?: number): Promise<Plan | null> {
  try {
    const query = stepUp !== undefined ? `?step_up=${stepUp}` : "";
    const headers = await getServerHeaders();
    const res = await fetch(`${SERVER_API_URL}/api/plans/${id}${query}`, { cache: "no-store", headers });
    if (res.status === 404) return null;
    return res.ok ? ((await res.json()) as Plan) : null;
  } catch {
    return null;
  }
}

/** Server-side fund detail fetch with forwarded session cookies. */
export async function getFundDetailServer(code: string): Promise<FundDetail | null> {
  try {
    const headers = await getServerHeaders();
    const res = await fetch(`${SERVER_API_URL}/api/funds/${code}`, { cache: "no-store", headers });
    if (res.status === 404) return null;
    return res.ok ? ((await res.json()) as FundDetail) : null;
  } catch {
    return null;
  }
}

/** Server-side fund reference fetch (AMFI/SEBI snapshot detail for one scheme). */
export async function getFundReferenceServer(code: string): Promise<FundReference | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/funds/${code}/reference`, { cache: "no-store" });
    if (res.status === 404) return null;
    return res.ok ? ((await res.json()) as FundReference) : null;
  } catch {
    return null;
  }
}

/** Server-side fund analytics fetch with forwarded session cookies. */
export async function getFundAnalyticsServer(code: string): Promise<FundAnalytics | null> {
  try {
    const headers = await getServerHeaders();
    const res = await fetch(`${SERVER_API_URL}/api/funds/${code}/analytics`, { cache: "no-store", headers });
    if (res.status === 404) return null;
    return res.ok ? ((await res.json()) as FundAnalytics) : null;
  } catch {
    return null;
  }
}

/** Server-side fund comparison fetch with forwarded session cookies. */
export async function compareFundsServer(codes: string[]): Promise<CompareResponse | null> {
  try {
    const headers = await getServerHeaders();
    const res = await fetch(`${SERVER_API_URL}/api/funds/compare?codes=${codes.join(",")}`, { cache: "no-store", headers });
    if (!res.ok) return null;
    return (await res.json()) as CompareResponse;
  } catch {
    return null;
  }
}

/** Upload and parse CAS statement PDF in memory. */
export async function uploadCas(
  file: File,
  password: string,
  consent: boolean,
  targetBand?: string,
): Promise<CasAnalysisResult> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("password", password);
  fd.append("consent", consent ? "true" : "false");
  if (targetBand) fd.append("target_band", targetBand);

  const res = await fetch(resolveApiUrl(`${API_URL}/api/cas/upload`), {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let msg = `CAS upload failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
    } catch {
      /* fallback */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<CasAnalysisResult>;
}

export async function askFundRag(
  query: string,
  filters?: { category?: string; plan?: string; amc?: string },
  top_k = 4,
): Promise<RagAnswerResult> {
  return request<RagAnswerResult>("/api/rag/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      category: filters?.category || null,
      plan: filters?.plan || null,
      amc: filters?.amc || null,
      top_k,
    }),
  });
}

export async function explainPlan(planId?: string, planData?: Record<string, unknown>): Promise<ExplainResponse> {
  return request<ExplainResponse>("/api/ai/explain/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan_id: planId || null, plan_data: planData || null }),
  });
}

export async function explainFund(schemeCode: string): Promise<ExplainResponse> {
  return request<ExplainResponse>("/api/ai/explain/fund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheme_code: schemeCode }),
  });
}

export async function explainCas(casData: Record<string, unknown>): Promise<ExplainResponse> {
  return request<ExplainResponse>("/api/ai/explain/cas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cas_data: casData }),
  });
}






export const getTaxCatalog = (params?: { q?: string; kind?: string }) => {
  const q = new URLSearchParams();
  if (params?.q) q.set("q", params.q);
  if (params?.kind) q.set("kind", params.kind);
  const qs = q.toString();
  return request<CatalogResponse>(`${API_URL}/api/tax/catalog${qs ? `?${qs}` : ""}`);
};
export const getTaxInstrument = (id: string) =>
  request<{ instrument: CatalogInstrument; as_of: string; fy: string; disclosure: string }>(`${API_URL}/api/tax/catalog/${id}`);
export const calcTax = (body: {
  age: number; employment_type: string; tax: TaxProfileInput; goals?: { type: string; years: number }[];
  switches?: Partial<TaxSwitches>;
}) => request<TaxCalcResult>(`${API_URL}/api/tax/calc`, { method: "POST", body: JSON.stringify(body) });
export const explainTax = (planId: string, nudgeId?: string) =>
  request<ExplainResponse>(`${API_URL}/api/ai/explain/tax`, {
    method: "POST",
    body: JSON.stringify({ plan_id: planId, nudge_id: nudgeId ?? null }),
  });

/* ---- Customer accounts (cookie-auth: session cookie set by the backend) ---- */

async function authedRequest<T>(url: string, init?: RequestInit): Promise<T> {
  // `credentials: "include"` is required so the browser sends the fh_session
  // httpOnly cookie on the cross-site (frontend domain -> API domain) call.
  return request<T>(url, { ...init, credentials: "include" });
}

export const signupCustomer = (body: SignupCustomerBody) =>
  authedRequest<{ customer: Customer }>(`${API_URL}/api/auth/signup`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const loginCustomer = (body: LoginCustomerBody) =>
  authedRequest<{ customer: Customer }>(`${API_URL}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const loginGuest = () =>
  authedRequest<{ customer: Customer }>(`${API_URL}/api/auth/guest`, { method: "POST" });

export const logoutCustomer = () =>
  authedRequest<{ ok: boolean }>(`${API_URL}/api/auth/logout`, { method: "POST" });

export const getMe = () => authedRequest<Customer>(`${API_URL}/api/auth/me`);

export const getMyPlans = () =>
  authedRequest<{ plans: MyPlan[]; total: number; limit: number; offset: number }>(
    `${API_URL}/api/auth/me/plans`,
  );

export interface ChatMessage { id: string; from_staff: number; body: string; created_at: string }
export interface ChatThread { customer_id: string; name: string; email: string; last_at: string; unread: number; last_body: string }
export interface MyCrm {
  households: { id: string; name: string; notes: string | null; rm_name: string | null }[];
  holdings: { scheme_name: string; folio: string; units: number; cost_paise: number; as_of: string | null }[];
  sips: { scheme_name: string; type: string; amount_paise: number; day: number; status: string }[];
  cases: { subject: string; category: string; status: string; created_at: string }[];
}

export const getMyCrm = () => authedRequest<MyCrm>(`${API_URL}/api/me/crm`);
export const getMyMessages = () => authedRequest<{ messages: ChatMessage[] }>(`${API_URL}/api/me/messages`);
export const sendMyMessage = (body: string) =>
  authedRequest<ChatMessage>(`${API_URL}/api/me/messages`, { method: "POST", body: JSON.stringify({ body }) });
export const getStaffChats = () => authedRequest<{ threads: ChatThread[] }>(`${API_URL}/api/staff/chats`);
export const getStaffThread = (id: string) =>
  authedRequest<{ messages: ChatMessage[] }>(`${API_URL}/api/staff/chats/${id}`);
export const sendStaffReply = (id: string, body: string) =>
  authedRequest<ChatMessage>(`${API_URL}/api/staff/chats/${id}`, { method: "POST", body: JSON.stringify({ body }) });

export type DownloadResult =
  | { status: "tunnel" | "redirect"; filename: string; file: string }
  | { status: "picker"; items: { type: string; url: string }[] };

export const startDownload = (body: { url: string; mode: string; quality: string }) =>
  authedRequest<DownloadResult>(`${API_URL}/api/staff/download`, { method: "POST", body: JSON.stringify(body) });
