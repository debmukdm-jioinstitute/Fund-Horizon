import { ApiError, API_URL, resolveApiUrl } from "./api";

const BASE = `${API_URL}/api/backoffice/valuation`;

export type Provider = "fundsindia" | "proaffluence" | "stallion";
export const PROVIDER_LABEL: Record<string, string> = { fundsindia: "FundsIndia", proaffluence: "ProAffluence", stallion: "Stallion" };

export interface Batch {
  id: string; client_id: string; client_name?: string | null; report_month: string; valuation_date: string;
  status: "draft" | "processed" | "reconciled" | "approved" | "rejected"; revision_no: number; revises_batch_id: string | null;
  providers?: string[]; reconciliation_status?: "not_run" | "blocked" | "warnings" | "clean"; blocking_checks?: number | null;
  snapshot_id?: string | null; report_status?: string;
}
export interface Account { id: string; provider: string; account_no: string | null; valuation_date: string | null; flows_complete: number; closing_value: number | null; value_basis: string | null }
export interface HoldingRow {
  id: string; security_name: string; isin: string | null; quantity: number | null; avg_cost: number | null; invested_amount: number | null;
  price: number | null; market_value: number | null; asset_type: string; source_page: string | null; source_row: number | null; validation_status: string; account_id: string;
}
export interface FileRow {
  id: string; filename: string; sha256: string; provider: string | null; provider_label: string | null; provider_source: string; detect_note: string | null;
  status: string; statement_date: string | null; adapter_verified: boolean; totals: Record<string, number | null>; warnings: string[]; errors: string[];
  accounts: Account[]; holdings: HoldingRow[]; cashflows: { id: string; flow_date: string; kind: string; amount: number; external: number }[];
}
export interface Preview { batch: Batch; files: FileRow[] }
export interface Check {
  id: string; check_code: string; subject_label: string; severity: "error" | "warning" | "info"; status: "passed" | "failed" | "resolved" | "overridden";
  expected: number | null; actual: number | null; difference: number | null; message: string; resolution_reason: string | null; overridable: boolean;
}
export interface Recon { batch: Batch; run_no: number | null; summary: { passed: number; failed_errors: number; warnings: number; resolved: number; can_approve: boolean }; checks: Check[] }
export interface Metric { value: number | null; reason?: string; method?: string }
export interface Payload {
  report_month: string; valuation_date: string; revision_no: number; valuation_dates: string[];
  totals: { total_value: number; invested: number | null; gain: number | null; absolute_return_pct: number | null; unrealised_gain: number | null; realised_gain: number | null; net_external_flows: number };
  unavailable: Record<string, string>;
  allocation: { asset_type: string; value: number; pct: number }[];
  provider_contribution: { provider: string; value: number; pct: number; invested: number | null; gain: number | null; accounts: number; valuation_dates: string[] }[];
  accounts: { key: string; provider: string; account_no: string | null; valuation_date: string | null; closing_value: number; invested: number | null; value_basis: string; flows_complete: boolean }[];
  holdings: { provider: string; account_no: string | null; security_name: string; isin: string | null; asset_type: string; quantity: number | null; invested_amount: number | null; price: number | null; market_value: number; weight_pct: number | null; gain: number | null; source_page: string | null; source_row: number | null }[];
  performance: { consolidated: { xirr: Metric; modified_dietz: Metric; cagr: Metric } };
  month_on_month: null | { previous_month: string; previous_total: number; change: number; change_pct: number | null; net_external_flows: number; market_and_other_change: number };
}
export interface ReportVersion { id: string; version_no: number; created_at: string; size_bytes: number; pdf_sha256: string }
export interface HistoryRow { snapshot_id: string; batch_id: string; report_month: string; revision_no: number; valuation_date: string; total_value: number; is_latest_revision: boolean; reports: ReportVersion[] }

async function call<T>(path: string, init?: RequestInit, json = true): Promise<T> {
  const res = await fetch(resolveApiUrl(`${BASE}${path}`), {
    ...init, credentials: "include",
    headers: json ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}
const post = <T,>(p: string, body: unknown = {}) => call<T>(p, { method: "POST", body: JSON.stringify(body) });

export const listBatches = (q: { client_id?: string; month?: string } = {}) => {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
  return call<{ data: Batch[] }>(`/batches${s ? `?${s}` : ""}`).then((r) => r.data);
};
export const createBatch = (b: { client_id: string; report_month: string; valuation_date: string; revises_batch_id?: string }) => post<Batch>("/batches", b);
export const uploadFiles = (id: string, files: File[], provider?: string, password?: string) => {
  const f = new FormData();
  files.forEach((x) => f.append("files", x));
  if (provider) f.append("provider", provider);
  if (password) f.append("password", password);
  return call<{ results: { ok: boolean; filename?: string; error?: string; file?: FileRow }[] }>(`/batches/${id}/files`, { method: "POST", body: f }, false);
};
export const getPreview = (id: string) => call<Preview>(`/batches/${id}/preview`);
export const processBatch = (id: string, passwords: Record<string, string> = {}) => post<Preview>(`/batches/${id}/process`, { passwords });
export const setProvider = (fileId: string, provider: string) => call<FileRow>(`/files/${fileId}/provider`, { method: "PATCH", body: JSON.stringify({ provider }) });
export const removeFile = (fileId: string) => call<void>(`/files/${fileId}`, { method: "DELETE" });
export const getRecon = (id: string) => call<Recon>(`/batches/${id}/reconciliation`);
export const validateBatch = (id: string) => post<Recon>(`/batches/${id}/validate`);
export const resolveCheck = (id: string, action: "resolved" | "overridden", reason: string) => post<Check>(`/checks/${id}/resolve`, { action, reason });
export const attestFlows = (accountId: string, reason: string) => post<Account>(`/accounts/${accountId}/attest-flows`, { reason });
export const getConsolidated = (id: string) => call<Payload>(`/batches/${id}/consolidated`);
export const approveBatch = (id: string, generate_report = true) => post<{ snapshot_id: string; report?: ReportVersion }>(`/batches/${id}/approve`, { generate_report });
export const generateReport = (snapshotId: string) => post<ReportVersion>(`/snapshots/${snapshotId}/report`);
export const getHistory = (clientId: string) => call<{ data: HistoryRow[] }>(`/clients/${clientId}/history`).then((r) => r.data);
export const emailReport = (versionId: string) => post<{ emailed: boolean; to: string }>(`/reports/${versionId}/email`, { confirm: true });
export const reportDownloadUrl = (versionId: string) => resolveApiUrl(`${BASE}/reports/${versionId}/download`);
