// TODO(owner-compliance-review): this file contains user-facing copy.
// Cookie-authed account/customer API helpers for the admin console.
// Uses direct fetch() with credentials: "include" (kept separate from lib/api,
// which is owned by another worker).

import { resolveApiUrl } from "@/lib/api";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type AccountRole = "customer" | "rm" | "admin";

export interface MeUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: AccountRole;
}

export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: AccountRole;
  assigned_rm_id: string | null;
  plan_count: number;
  created_at: string;
}

export interface RmCustomerPlan {
  id: string;
  client_name?: string;
  created_at?: string;
  [key: string]: unknown;
}

async function readJson(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return res.json();
}

/** Returns the logged-in user, or null when there is no session (401). */
export async function fetchMe(): Promise<MeUser | null> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/auth/me`), {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 401) return null;
  return (await readJson(res, "Sign-in check")) as MeUser;
}

/** Admin-only: paginated list of all customers. */
export async function fetchCustomers(
  limit: number,
  offset: number,
): Promise<{ customers: CustomerRecord[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/customers?${params}`), {
    credentials: "include",
    cache: "no-store",
  });
  const data = (await readJson(res, "Customer list")) as {
    customers?: CustomerRecord[];
    total?: number;
  };
  return { customers: data.customers ?? [], total: data.total ?? 0 };
}

/** Admin-only: update a customer's role and/or assigned RM. */
export async function patchCustomer(
  id: string,
  body: { role?: AccountRole; assigned_rm_id?: string | null },
): Promise<CustomerRecord> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/admin/customers/${encodeURIComponent(id)}`), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await readJson(res, "Customer update")) as CustomerRecord;
}

/** RM (or admin) view: customers assigned to the logged-in RM. */
export async function fetchRmCustomers(): Promise<CustomerRecord[]> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/rm/customers`), {
    credentials: "include",
    cache: "no-store",
  });
  const data = (await readJson(res, "My customers")) as
    | CustomerRecord[]
    | { customers?: CustomerRecord[] };
  return Array.isArray(data) ? data : data.customers ?? [];
}

/** Plans of one customer, for the assigned RM (or an admin). */
export async function fetchRmCustomerPlans(customerId: string): Promise<RmCustomerPlan[]> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/rm/customers/${encodeURIComponent(customerId)}/plans`), {
    credentials: "include",
    cache: "no-store",
  });
  const data = (await readJson(res, "Customer plans")) as
    | RmCustomerPlan[]
    | { plans?: RmCustomerPlan[] };
  return Array.isArray(data) ? data : data.plans ?? [];
}
