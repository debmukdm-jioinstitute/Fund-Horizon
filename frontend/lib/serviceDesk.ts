import { API_URL, ApiError, resolveApiUrl } from "./api";

export const CATEGORIES = [
  { id: "operational", label: "Operational" },
  { id: "recommendation", label: "Recommendation or investment" },
  { id: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];

export const STATUSES = [
  { id: "incoming", label: "Incoming", tone: "bg-[#EAF2FE] text-[#1D5BD8] border-[#B8D3FC] dark:bg-[#162A4A] dark:text-[#60A5FA]" },
  { id: "in_progress", label: "In progress", tone: "bg-[#FFF4E5] text-[#B54708] border-[#FEDF89] dark:bg-[#3D2506] dark:text-[#FDB022]" },
  { id: "waiting_client", label: "Waiting on client / RTA", tone: "bg-[#F4EBFF] text-[#6927DA] border-[#D8B4FE] dark:bg-[#2C194D] dark:text-[#D8B4FE]" },
  { id: "completed", label: "Completed", tone: "bg-[#ECFDF3] text-[#027A48] border-[#A6F4C5] dark:bg-[#0E3824] dark:text-[#6CE9A6]" },
  { id: "cancelled", label: "Cancelled", tone: "bg-[#F2F4F7] text-[#475467] border-[#EAECF0] dark:bg-[#1E293B] dark:text-[#94A3B8]" },
] as const;
export type Status = (typeof STATUSES)[number]["id"];

export const PRIORITIES = [
  { id: "urgent", label: "Urgent", badge: "bg-[#FEF3F2] text-[#B42318] border-[#FECDCA] dark:bg-[#3D1412] dark:text-[#FDA29B]" },
  { id: "high", label: "High", badge: "bg-[#FFF4ED] text-[#B93815] border-[#FED8B1] dark:bg-[#381B0D] dark:text-[#F97066]" },
  { id: "medium", label: "Medium", badge: "bg-[#FFFAEB] text-[#B54708] border-[#FEDF89] dark:bg-[#2F2207] dark:text-[#FEC84B]" },
  { id: "low", label: "Low", badge: "bg-[#F8F9FA] text-[#475467] border-[#E4E7EC] dark:bg-[#1F242F] dark:text-[#98A2B3]" },
] as const;
export type Priority = (typeof PRIORITIES)[number]["id"];

export interface ServiceQuery {
  id: string;
  ticket_code: string;
  client_name: string;
  category: Category;
  other_text: string | null;
  details: string | null;
  status: Status;
  priority: Priority;
  source: "voice" | "typed";
  resolution_note: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface QueryListResult {
  total: number;
  rows: ServiceQuery[];
  counts: Record<string, number>;
  urgent_count: number;
  active_count: number;
}

export interface ReportTracker {
  report_month: string;
  finalize_by: string;
  send_by: string;
  hard_deadline: string;
  days_left: number;
  generated: number;
  emailed: number;
  unsent: { customer_id: string; name: string }[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/service-desk${path}`), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) msg = String(j.detail[0].msg).replace(/^Value error, /, "");
    } catch {
      /* keep default */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export interface ListQueryParams {
  status?: string;
  priority?: string;
  category?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export const listQueries = (params?: ListQueryParams | number) => {
  if (typeof params === "number") {
    return call<QueryListResult>(`/queries?limit=${params}`);
  }
  const p = new URLSearchParams();
  if (params?.status) p.set("status", params.status);
  if (params?.priority) p.set("priority", params.priority);
  if (params?.category) p.set("category", params.category);
  if (params?.q) p.set("q", params.q.trim());
  if (params?.limit) p.set("limit", String(params.limit));
  if (params?.offset) p.set("offset", String(params.offset));
  const query = p.toString() ? `?${p.toString()}` : "";
  return call<QueryListResult>(`/queries${query}`);
};

export const createQuery = (b: {
  client_name: string;
  category: Category;
  other_text?: string;
  details?: string;
  priority?: Priority;
  source: "voice" | "typed";
}) => call<{ id: string; ticket_code: string }>("/queries", { method: "POST", body: JSON.stringify(b) });

export const setQueryStatus = (id: string, status: Status, resolution_note?: string) =>
  call<{ id: string; status: Status; ticket_code: string }>(`/queries/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, resolution_note: resolution_note ?? undefined }),
  });

export const updateQuery = (
  id: string,
  patch: Partial<{
    client_name: string;
    category: Category;
    other_text: string;
    details: string;
    priority: Priority;
    status: Status;
    resolution_note: string;
  }>,
) => call<{ id: string; ticket_code: string; updated: boolean }>(`/queries/${id}`, { method: "PUT", body: JSON.stringify(patch) });

export const deleteQuery = (id: string) =>
  call<{ id: string; ticket_code: string; deleted: boolean }>(`/queries/${id}`, { method: "DELETE" });

export const reportTracker = () => call<ReportTracker>("/report-tracker");

/** DD-MM-YYYY in IST (house date format). */
export const dmy = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata" }).replaceAll("/", "-");

export const formatRelativeTime = (iso: string): string => {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    return dmy(iso);
  } catch {
    return dmy(iso);
  }
};
