/**
 * Terminal formatting utilities for Fund Horizon.
 * Strictly implements IST timestamps, em-dash missing values, and signed value conventions.
 */

export function formatISTDateTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d) + " IST";
  } catch {
    return String(dateInput);
  }
}

export function formatISTDate(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(d);
  } catch {
    return String(dateInput);
  }
}

export function formatNumber(
  val?: number | null,
  decimals: number = 2,
  options?: { fallback?: string; prefix?: string; suffix?: string }
): string {
  if (val === null || val === undefined || isNaN(val)) {
    return options?.fallback ?? "—";
  }
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val);
  return `${options?.prefix ?? ""}${formatted}${options?.suffix ?? ""}`;
}

export function formatCurrencyPaiseToINR(
  paise?: number | null,
  options?: { showCrore?: boolean; decimals?: number }
): string {
  if (paise === null || paise === undefined || isNaN(paise)) return "—";
  const inr = paise / 100;
  if (options?.showCrore && Math.abs(inr) >= 1_00_00_000) {
    const cr = inr / 1_00_00_000;
    return `₹${cr.toFixed(options.decimals ?? 2)} Cr`;
  }
  return `₹${formatNumber(inr, options?.decimals ?? 2)}`;
}

export function formatCrore(
  crore?: number | null,
  decimals: number = 2
): string {
  if (crore === null || crore === undefined || isNaN(crore)) return "—";
  return `₹${formatNumber(crore, decimals)} Cr`;
}

export function formatPercent(
  val?: number | null,
  decimals: number = 2,
  includeSign: boolean = false
): string {
  if (val === null || val === undefined || isNaN(val)) return "—";
  const sign = includeSign && val > 0 ? "+" : val < 0 ? "−" : "";
  const absVal = Math.abs(val);
  return `${sign}${absVal.toFixed(decimals)}%`;
}

export function formatBps(
  bps?: number | null,
  decimals: number = 1,
  includeSign: boolean = true
): string {
  if (bps === null || bps === undefined || isNaN(bps)) return "—";
  const sign = includeSign && bps > 0 ? "+" : bps < 0 ? "−" : "";
  const absVal = Math.abs(bps);
  return `${sign}${absVal.toFixed(decimals)} bps`;
}
