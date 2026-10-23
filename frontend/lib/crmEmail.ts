// Email clients from the backoffice (POST /api/crm/email, multipart: attachments allowed).
import { API_URL, ApiError, resolveApiUrl } from "./api";

export interface EmailResult { customer_id: string; name: string | null; ok: boolean; error: string | null }
export interface EmailOutcome { sent: number; failed: number; results: EmailResult[] }

export const EMAIL_ACCEPT = ".pdf,.xlsx,.xls,.csv,.docx,.png,.jpg,.jpeg,.txt";
export const EMAIL_MAX_BYTES = 15 * 1024 * 1024;

export const EMAIL_TEMPLATES: { id: string; label: string; subject: string; body: string }[] = [
  { id: "statement", label: "Share statement", subject: "Your statement from Fund Horizon",
    body: "Hi {name},\n\nPlease find your statement attached. Do take a look and tell us if anything looks off.\n\nRegards,\nFund Horizon" },
  { id: "update", label: "Request update", subject: "An update on your request",
    body: "Hi {name},\n\nA quick update on your request: \n\nLet us know if you have any questions.\n\nRegards,\nFund Horizon" },
  { id: "kyc", label: "KYC / documents reminder", subject: "Documents needed to complete your KYC",
    body: "Hi {name},\n\nTo complete your KYC we still need the following documents:\n- \n\nYou can reply to this email with scans attached.\n\nRegards,\nFund Horizon" },
  { id: "general", label: "General", subject: "", body: "Hi {name},\n\n\n\nRegards,\nFund Horizon" },
];

export async function sendClientEmail(customerIds: string[], subject: string, message: string, files: File[]): Promise<EmailOutcome> {
  const fd = new FormData();
  fd.set("subject", subject);
  fd.set("message", message);
  fd.set("customer_ids", JSON.stringify(customerIds));
  files.forEach((f) => fd.append("files", f));
  // no Content-Type header: the browser sets the multipart boundary
  const res = await fetch(resolveApiUrl(`${API_URL}/api/crm/email`), { method: "POST", body: fd, credentials: "include" });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) msg = j.detail[0].msg;
    } catch { /* keep default */ }
    throw new ApiError(res.status === 503 ? "Email isn't set up yet. Ask an admin to configure Resend." : msg, res.status);
  }
  return res.json() as Promise<EmailOutcome>;
}
