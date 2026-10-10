/** Indian digit grouping: 1234567 -> ₹12,34,567 */
export function inr(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const n = Math.round(v);
  const sign = n < 0 ? "-" : "";
  const s = String(Math.abs(n));
  if (s.length <= 3) return `${sign}₹${s}`;
  const tail = s.slice(-3);
  let head = s.slice(0, -3);
  const groups: string[] = [];
  while (head.length > 2) {
    groups.unshift(head.slice(-2));
    head = head.slice(0, -2);
  }
  if (head) groups.unshift(head);
  return `${sign}₹${groups.join(",")},${tail}`;
}

/** Lakh / crore shorthand for charts and cards. */
export function shortInr(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return inr(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const x = Number((v * 100).toFixed(digits));
  return `${(x === 0 ? 0 : x).toFixed(digits)}%`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  large_cap: "Large cap", flexi_cap: "Flexi cap", mid_cap: "Mid cap", small_cap: "Small cap",
  corporate_bond: "Corporate bond", banking_psu: "Banking & PSU", short_duration: "Short duration",
  gold: "Gold", liquid: "Liquid",
};

export const STATUS_LABELS: Record<string, string> = {
  funded: "Funded", partially_funded: "Partly funded", unfunded: "Not funded yet",
};
