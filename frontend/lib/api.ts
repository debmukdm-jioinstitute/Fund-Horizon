import type { Meta, Plan, PlanRequest, Questionnaire } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SERVER_API_URL = process.env.API_INTERNAL_URL ?? API_URL;

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
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
export const getPlan = (id: string, stepUp?: number) =>
  request<Plan>(`${API_URL}/api/plans/${id}${stepUp !== undefined ? `?step_up=${stepUp}` : ""}`);
export const reportUrl = (id: string) => `${API_URL}/api/plans/${id}/report.pdf`;

/** Server-side fetch used by server components (landing page, footer). */
export async function getMetaServer(): Promise<Meta | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/api/meta`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as Meta) : null;
  } catch {
    return null;
  }
}
