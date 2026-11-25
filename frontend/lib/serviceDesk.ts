import { API_URL, ApiError, resolveApiUrl } from "./api";

export const CATEGORIES = [
  { id: "operational", label: "Operational" },
  { id: "recommendation", label: "Recommendation or investment" },
  { id: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];
export const STATUSES = [
  { id: "incoming", label: "Incoming" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
] as const;
export type Status = (typeof STATUSES)[number]["id"];

export interface ServiceQuery {
  id: string; client_name: string; category: Category; other_text: string | null; details: string | null;
  status: Status; source: "voice" | "typed"; created_at: string; completed_at: string | null;
}
export interface ReportTracker {
  report_month: string; finalize_by: string; send_by: string; hard_deadline: string; days_left: number;
  generated: number; emailed: number; unsent: { customer_id: string; name: string }[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/service-desk${path}`), {
    ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) msg = String(j.detail[0].msg).replace(/^Value error, /, "");
    } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const listQueries = (limit: number) => call<{ total: number; rows: ServiceQuery[]; counts: Record<string, number> }>(`/queries?limit=${limit}`);
export const createQuery = (b: { client_name: string; category: Category; other_text: string; details: string; source: "voice" | "typed" }) =>
  call<{ id: string }>("/queries", { method: "POST", body: JSON.stringify(b) });
export const setQueryStatus = (id: string, status: Status) => call<{ id: string }>(`/queries/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const reportTracker = () => call<ReportTracker>("/report-tracker");

/** DD-MM-YYYY in IST (house date format). */
export const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }).replaceAll("/", "-");
