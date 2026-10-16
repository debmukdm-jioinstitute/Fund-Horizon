// Typed helpers for the CRM Phase 2 endpoints: server-paged lists, saved views, owners, search,
// duplicates, timelines, bulk reassign and CSV export. Cookie auth, same as ./crmApi.
import { API_URL, ApiError, resolveApiUrl } from "./api";

export type ListEntity = "households" | "contacts" | "leads" | "opportunities" | "activities" | "cases";

export interface Owner {
  id: string;
  name: string;
  role: string;
}

export interface SavedView {
  id: string;
  entity: ListEntity;
  name: string;
  filters: Record<string, string>;
  columns: string[];
  is_default: boolean;
  builtin: boolean;
}

export interface DuplicateMatch {
  type: "contact" | "lead";
  id: string | null;
  name: string | null;
  visible: boolean;
  href: string | null;
  reasons: string[];
}

export interface SearchResult {
  type: "household" | "contact" | "lead" | "opportunity" | "case";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface TimelineItem {
  type: "activity" | "case" | "audit";
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  at: string;
  actor_id?: string | null;
  actor_name?: string | null;
  due_at?: string | null;
  done_at?: string | null;
}

export interface PageParams {
  limit: number;
  offset: number;
  sort?: string;
  q?: string;
  filters?: Record<string, string>;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<{ data: T; res: Response }> {
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
    } catch {
      /* keep default */
    }
    throw new ApiError(msg, res.status);
  }
  const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  return { data, res };
}

const toQuery = (p: PageParams): string => {
  const q = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
  if (p.sort) q.set("sort", p.sort);
  if (p.q) q.set("q", p.q);
  for (const [k, v] of Object.entries(p.filters ?? {})) if (v !== "" && v != null) q.set(k, v);
  return q.toString();
};

export async function fetchPage<T>(entity: ListEntity, params: PageParams): Promise<PageResult<T>> {
  const { data, res } = await call<T[]>(`/${entity}?${toQuery(params)}`);
  return { rows: data, total: Number(res.headers.get("X-Total-Count") ?? data.length) };
}

export const fetchOwners = () => call<Owner[]>("/owners").then((r) => r.data);

export const fetchViews = (entity: ListEntity) => call<SavedView[]>(`/views?entity=${entity}`).then((r) => r.data);

export const createView = (v: { entity: ListEntity; name: string; filters: Record<string, string>; columns: string[]; is_default?: boolean }) =>
  call<SavedView>("/views", { method: "POST", body: JSON.stringify(v) }).then((r) => r.data);

export const patchView = (id: string, v: Partial<Pick<SavedView, "name" | "filters" | "columns" | "is_default">>) =>
  call<SavedView>(`/views/${id}`, { method: "PATCH", body: JSON.stringify(v) }).then((r) => r.data);

export const deleteView = (id: string) => call<void>(`/views/${id}`, { method: "DELETE" }).then(() => undefined);

export const bulkReassign = (entity: string, ids: string[], assigned_rm_id: string | null) =>
  call<{ updated: number; missing: string[] }>("/bulk-reassign", {
    method: "POST",
    body: JSON.stringify({ entity, ids, assigned_rm_id }),
  }).then((r) => r.data);

export const bulkDeleteLeads = (ids: string[], code: string) =>
  call<{ deleted: number; missing: string[] }>("/leads/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ ids, code }),
  }).then((r) => r.data);

export const searchCrm = (q: string) => call<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.data.results);

export const checkDuplicates = (body: { name?: string; email?: string; mobile?: string; pan_last4?: string; exclude_lead_id?: string }) =>
  call<{ matches: DuplicateMatch[]; blocking: boolean }>("/duplicates/check", { method: "POST", body: JSON.stringify(body) }).then((r) => r.data);

export const fetchTimeline = (entity: "household" | "lead" | "opportunity" | "case", id: string) =>
  call<TimelineItem[]>(`/timeline?entity=${entity}&id=${encodeURIComponent(id)}`).then((r) => r.data);

/** Downloads the CSV (or Excel) for the current list (filters, search and sort included). */
export async function downloadCsv(entity: ListEntity, params: Omit<PageParams, "limit" | "offset">, format: "csv" | "xlsx" = "csv"): Promise<void> {
  const q = new URLSearchParams();
  if (params.sort) q.set("sort", params.sort);
  if (params.q) q.set("q", params.q);
  for (const [k, v] of Object.entries(params.filters ?? {})) if (v !== "" && v != null) q.set(k, v);
  if (format === "xlsx") q.set("format", "xlsx");
  const res = await fetch(resolveApiUrl(`${API_URL}/api/crm/export/${entity}?${q}`), { credentials: "include" });
  if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `crm-${entity}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
