// Client-side validation for CRM forms. Mirrors the backend rules (app/api/crm_core.py) so users see
// the problem before submitting; the server remains the source of truth.
import { z } from "zod";

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** Today's calendar date in Asia/Kolkata as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const emailSchema = z.preprocess(
  blank,
  z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
);

/** 10-digit Indian mobile (optional +91/91/0 prefix) or +<country code><number> for NRIs. */
export const mobileSchema = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .refine((raw) => {
      const compact = raw.replace(/[\s\-()]/g, "");
      if (compact.startsWith("+") && !compact.startsWith("+91")) return /^\+[1-9]\d{6,14}$/.test(compact);
      let digits = compact.replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
      else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
      return /^[6-9]\d{9}$/.test(digits);
    }, "Enter a valid 10-digit Indian mobile number (or +<country code> for NRIs)")
    .optional(),
);

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const panSchema = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toUpperCase()) : v),
  z.string().regex(PAN_RE, "PAN must look like ABCDE1234F").optional(),
);

export const leadSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: emailSchema,
  mobile: mobileSchema,
});

export const taskSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required"),
});

export const caseSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required"),
  category: z.string().min(1, "Category is required"),
});

export const lostSchema = z.object({
  lost_reason: z.string().trim().min(1, "Give a reason for losing this opportunity"),
});

/** First error message per field, or null when valid. */
export function fieldErrors<T extends z.ZodTypeAny>(schema: T, values: unknown): Record<string, string> | null {
  const parsed = schema.safeParse(values);
  if (parsed.success) return null;
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Non-blocking: a due date before today (IST) is allowed but flagged. */
export function pastDueWarning(due: string | undefined | null): string | null {
  if (!due) return null;
  return due.slice(0, 10) < todayIst() ? "This due date is in the past." : null;
}
