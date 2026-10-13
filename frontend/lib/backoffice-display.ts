/** Display helpers for PMS and AMFI backoffice tables. Null/missing stay blank; real zeros are kept. */

export function isMissingNumber(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "number" && Number.isNaN(value));
}

const APPROACH_ALIASES: Array<[RegExp, string]> = [
  [/multi[\s-]*asset/i, "Multi Asset"],
  [/multi[\s-]*cap\s*&\s*flexi[\s-]*cap|multicap\s*&\s*flexicap/i, "Multi Cap & Flexi Cap"],
  [/large\s*&\s*mid[\s-]*cap/i, "Large & Mid Cap"],
  [/small\s*&\s*mid[\s-]*cap/i, "Small & Mid Cap"],
  [/mid[\s-]*cap/i, "Mid Cap"],
  [/small[\s-]*cap/i, "Small Cap"],
  [/large[\s-]*cap/i, "Large Cap"],
];

export function normalizeApproach(raw?: string | null): string {
  const value = (raw || "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value) return "";
  for (const [re, label] of APPROACH_ALIASES) {
    if (re.test(value)) return label;
  }
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function approachesMatch(rowValue: string | undefined, filterValue: string): boolean {
  if (!filterValue || filterValue === "all") return true;
  const row = normalizeApproach(rowValue).toLowerCase();
  const filter = normalizeApproach(filterValue).toLowerCase();
  return row === filter || row.includes(filter) || filter.includes(row);
}

export function normalizeProviderName(raw?: string | null): string {
  let value = (raw || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  value = value.replace(/\bprivate\s+limited\b/gi, "Pvt Ltd");
  value = value.replace(/\bpvt\.?\s*ltd\.?\b/gi, "Pvt Ltd");
  value = value.replace(/\blimited\b/gi, "Ltd");
  value = value.replace(/\bltd\.?\b/gi, "Ltd");
  return value.replace(/\s+,/g, ",").trim();
}

export function pmsReturnWarning(args: {
  return_1y_pct?: number;
  return_3y_cagr_pct?: number;
  return_5y_cagr_pct?: number;
  return_1m_pct?: number;
}): string | null {
  const y1Missing = isMissingNumber(args.return_1y_pct);
  const y3 = args.return_3y_cagr_pct;
  const y5 = args.return_5y_cagr_pct;
  const m1 = args.return_1m_pct;
  if (!isMissingNumber(y3) && Math.abs(y3 as number) > 100 && y1Missing) {
    return "3Y CAGR above 100% while 1Y is missing — likely incomplete disclosure";
  }
  if (!isMissingNumber(y3) && Math.abs(y3 as number) > 100) {
    return "3Y CAGR above 100% is an outlier versus typical PMS ranges";
  }
  if (!isMissingNumber(y5) && Math.abs(y5 as number) > 100) {
    return "5Y CAGR above 100% is an outlier versus typical PMS ranges";
  }
  if (!isMissingNumber(m1) && Math.abs(m1 as number) > 50) {
    return "1M return above 50% is an outlier";
  }
  return null;
}

export function sourceBenchmark(name?: string | null): string | undefined {
  const value = (name || "").trim();
  if (!value || /^(na|n\/a|nil|-|—)$/i.test(value)) return undefined;
  return value;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function weekdayUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function istYmd(from: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(from);
}

export function previousBusinessDay(ymd: string): string {
  let cursor = addDaysYmd(ymd, -1);
  while (weekdayUtc(cursor) === 0 || weekdayUtc(cursor) === 6) {
    cursor = addDaysYmd(cursor, -1);
  }
  return cursor;
}

/** NAV is stale when it is older than the previous IST business day (weekends skipped). */
export function isNavStale(navDate?: string | null, todayIst?: string): boolean {
  if (!navDate || !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) return false;
  const today = todayIst ?? istYmd();
  return navDate < previousBusinessDay(today);
}

export function classifyPlanOption(schemeName?: string | null, planRaw?: string | null, optionRaw?: string | null): {
  plan?: string;
  option?: string;
} {
  const planSrc = `${planRaw || ""} ${schemeName || ""}`.toLowerCase();
  const optionSrc = `${optionRaw || ""} ${schemeName || ""}`.toLowerCase();
  let plan: string | undefined;
  if (/\bdirect\b/.test(planSrc)) plan = "Direct";
  else if (/\bregular\b/.test(planSrc)) plan = "Regular";
  let option: string | undefined;
  if (/\bbonus\b/.test(optionSrc)) option = "Bonus";
  else if (/\bgrowth\b/.test(optionSrc)) option = "Growth";
  else if (/\b(idcw|dividend|payout|reinvest)\b/.test(optionSrc)) option = "IDCW";
  return { plan, option };
}

export function blankDash(value?: string | null): string {
  const v = (value || "").trim();
  if (!v || /^(na|n\/a|n\.a\.|nil|-|—)$/i.test(v)) return "—";
  return v;
}
