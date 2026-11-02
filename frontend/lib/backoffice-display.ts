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

/** Per-cell outlier warning for a single PMS return figure. Returns a message or null. */
export function pmsCellReturnWarning(
  horizon: "1m" | "3m" | "6m" | "1y" | "3y" | "5y" | "si",
  value?: number | null,
): string | null {
  if (isMissingNumber(value)) return null;
  const v = Math.abs(value as number);
  const label =
    horizon === "1m" ? "1M" : horizon === "3m" ? "3M" : horizon === "6m" ? "6M" : horizon === "1y" ? "1Y" : horizon === "3y" ? "3Y CAGR" : horizon === "5y" ? "5Y CAGR" : "Since-inception";
  if (horizon === "1m" && v > 50) return `1M return above 50% is an outlier`;
  if ((horizon === "3m" || horizon === "6m") && v > 75) return `${label} return above 75% is an outlier`;
  if (horizon === "1y" && v > 75) return `1Y return beyond ±75% is an outlier versus typical PMS ranges`;
  if ((horizon === "3y" || horizon === "5y") && v > 100)
    return `${label} above 100% is an outlier versus typical PMS ranges`;
  return null;
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
  const y1 = args.return_1y_pct;
  if (!isMissingNumber(y1) && Math.abs(y1 as number) > 75) {
    return "1Y return beyond ±75% is an outlier versus typical PMS ranges";
  }
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

export interface MissingReturnReason {
  short: string;
  tooltip: string;
}

/** Determine explicit reason for a missing trailing return (e.g. fund has not reached 5Y). */
export function getPmsMissingReturnReason(
  horizon: "1m" | "3m" | "6m" | "1y" | "3y" | "5y" | "si",
  strategy: {
    inception_date?: string | null;
    return_1m_pct?: number | null;
    return_1y_pct?: number | null;
    return_3y_cagr_pct?: number | null;
    return_5y_cagr_pct?: number | null;
    return_since_inception_pct?: number | null;
  }
): MissingReturnReason {
  const inc = strategy.inception_date;
  let ageYears: number | null = null;
  if (inc) {
    const d = new Date(inc);
    if (!isNaN(d.getTime())) {
      ageYears = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    }
  }

  if (horizon === "5y") {
    if (ageYears !== null && ageYears < 5) {
      return {
        short: "< 5Y record",
        tooltip: `Fund is new (Inception: ${inc}, age: ${ageYears.toFixed(1)}Y) and has not reached 5-year track record.`,
      };
    }
    if (!isMissingNumber(strategy.return_3y_cagr_pct) || !isMissingNumber(strategy.return_1y_pct)) {
      return {
        short: "< 5Y record",
        tooltip: "Fund has not completed 5 years of operations required to calculate 5Y CAGR.",
      };
    }
    return {
      short: "—",
      tooltip: "5-year return not disclosed by manager to APMI.",
    };
  }

  if (horizon === "3y") {
    if (ageYears !== null && ageYears < 3) {
      return {
        short: "< 3Y record",
        tooltip: `Fund is new (Inception: ${inc}, age: ${ageYears.toFixed(1)}Y) and has not reached 3-year track record.`,
      };
    }
    if (!isMissingNumber(strategy.return_1y_pct) || !isMissingNumber(strategy.return_1m_pct)) {
      return {
        short: "< 3Y record",
        tooltip: "Fund has not completed 3 years of operations required to calculate 3Y CAGR.",
      };
    }
    return {
      short: "—",
      tooltip: "3-year return not disclosed by manager to APMI.",
    };
  }

  if (horizon === "1y") {
    if (ageYears !== null && ageYears < 1) {
      return {
        short: "< 1Y record",
        tooltip: `Fund is new (Inception: ${inc}) and has not completed 1 year of operations.`,
      };
    }
    if (!isMissingNumber(strategy.return_1m_pct)) {
      return {
        short: "< 1Y record",
        tooltip: "Fund has not completed 1 full year of operations required to calculate 1Y return.",
      };
    }
    return {
      short: "—",
      tooltip: "1-year return not disclosed by manager to APMI.",
    };
  }

  if (horizon === "6m") {
    if (ageYears !== null && ageYears < 0.5) {
      return {
        short: "< 6M record",
        tooltip: `Fund is new (Inception: ${inc}) and has not reached 6 months.`,
      };
    }
  }

  if (horizon === "3m") {
    if (ageYears !== null && ageYears < 0.25) {
      return {
        short: "< 3M record",
        tooltip: `Fund is new (Inception: ${inc}) and has not reached 3 months.`,
      };
    }
  }

  return {
    short: "—",
    tooltip: "Not disclosed in current APMI monthly filing.",
  };
}

/** Determine explicit reason for a missing mutual fund metric (e.g. fund has not reached 2Y/3Y/5Y). */
export function getMfMissingReason(
  metricKey: string,
  historyYears?: number | null,
  period?: string | number,
): { short: string; tooltip: string } {
  const age = typeof historyYears === "number" && !isNaN(historyYears) ? historyYears : null;
  const ageText = age !== null ? ` (fund age: ${age.toFixed(1)} yrs)` : "";

  if (metricKey === "quartile_period" || metricKey.startsWith("quartile_")) {
    const pStr = String(period || metricKey.replace("quartile_", "") || "2y").toLowerCase();
    const reqYears = pStr.includes("5") ? 5 : pStr.includes("3") ? 3 : pStr.includes("1") ? 1 : 2;
    if (age !== null && age < reqYears) {
      return {
        short: `< ${reqYears}Y record`,
        tooltip: `Fund has only ${age.toFixed(1)} years of history; requires at least ${reqYears} full years to compute quartile ranking.`,
      };
    }
    return {
      short: "Unavailable",
      tooltip: "Quartile ranking unavailable (insufficient category peer data or track record).",
    };
  }

  // 5-year metrics
  if (metricKey.includes("5y") || metricKey === "cagr_5y") {
    if (age !== null && age < 5) {
      return {
        short: "< 5Y record",
        tooltip: `Requires at least 5 years of performance history${ageText}.`,
      };
    }
  }

  // 3-year metrics
  if (
    metricKey.includes("3y") ||
    metricKey === "cagr_3y" ||
    metricKey === "sharpe_3y" ||
    metricKey === "sortino_3y" ||
    metricKey === "alpha_3y" ||
    metricKey === "beta_3y" ||
    metricKey === "vol_3y" ||
    metricKey === "max_dd_3y" ||
    metricKey === "cap_up_3y" ||
    metricKey === "cap_down_3y" ||
    metricKey === "cap_spread_3y" ||
    metricKey === "calmar_3y"
  ) {
    if (age !== null && age < 3) {
      return {
        short: "< 3Y record",
        tooltip: `Requires at least 3 years of performance history${ageText}.`,
      };
    }
  }

  // 2-year metrics
  if (metricKey.includes("2y") || metricKey === "ret_2y") {
    if (age !== null && age < 2) {
      return {
        short: "< 2Y record",
        tooltip: `Requires at least 2 years of performance history${ageText}.`,
      };
    }
  }

  // 1-year metrics
  if (metricKey.includes("1y") || metricKey === "ret_1y") {
    if (age !== null && age < 1) {
      return {
        short: "< 1Y record",
        tooltip: `Requires at least 1 year of performance history${ageText}.`,
      };
    }
  }

  // 10-year metrics
  if (metricKey.includes("10y")) {
    if (age !== null && age < 10) {
      return {
        short: "< 10Y record",
        tooltip: `Requires at least 10 years of performance history${ageText}.`,
      };
    }
  }

  const months = metricKey.match(/^ret_(\d+)m$/)?.[1];
  if (months && age !== null && age < Number(months) / 12) {
    return { short: `< ${months}M record`, tooltip: `Fund is only ${age.toFixed(1)} years old; needs ${months} months of NAV history.` };
  }
  if (metricKey === "ter") return { short: "—", tooltip: "Expense ratio not published by the AMC in the AMFI TER file for this scheme and date." };
  if (age !== null) return { short: "—", tooltip: `Fund is old enough${ageText}, but the AMFI NAV history or category/benchmark data needed for this metric is missing.` };
  return {
    short: "—",
    tooltip: "Data not available in AMFI feed.",
  };
}
