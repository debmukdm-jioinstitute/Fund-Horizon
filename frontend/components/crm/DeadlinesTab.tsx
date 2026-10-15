"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMaturities, fetchRenewals, type MaturityItem, type RenewalItem } from "../../lib/crmApi";
import { formatRupeesFromPaise } from "../../lib/crmProductsApi";
import { cardCls, errCls, mutedCls, tdCls, thCls } from "./ui";

const KINDS = [["renewals", "Policy renewals"], ["maturities", "FD maturities"]] as const;
const DAYS = [30, 60, 90];
const selCls =
  "px-2.5 py-1.5 text-xs rounded border bg-white dark:bg-[#171E27] border-[#E5E5E5] dark:border-[#2B3644] text-[#181818] dark:text-[#EDF2F7]";
const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "–");

/** Policies due for renewal and FDs about to mature: the lists behind the dashboard's deadline widgets. */
export default function DeadlinesTab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = params.get("kind") === "maturities" ? "maturities" : "renewals";
  const days = DAYS.includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
  const [rows, setRows] = useState<(RenewalItem | MaturityItem)[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(k, v);
    router.push(`${pathname}?${next}`);
  };

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    (kind === "renewals" ? fetchRenewals(days) : fetchMaturities(days))
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load"));
    return () => {
      live = false;
    };
  }, [kind, days]);

  const holder = (r: { household_id: string | null; customer_name?: string }) =>
    r.household_id ? <Link href={`/backoffice/crm/households/${r.household_id}`} className="hover:underline">{(r as { household_name?: string }).household_name ?? r.customer_name ?? "Household"}</Link> : (r.customer_name ?? "–");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Deadline type" value={kind} onChange={(e) => set("kind", e.target.value)} className={selCls}>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Window" value={days} onChange={(e) => set("days", e.target.value)} className={selCls}>
          {DAYS.map((d) => <option key={d} value={d}>Next {d} days</option>)}
        </select>
        {rows && <span className={`text-xs ${mutedCls}`}>{rows.length} {rows.length === 1 ? "item" : "items"}</span>}
      </div>
      {error && <p className={errCls}>{error}</p>}
      <div className={`${cardCls} overflow-x-auto p-0`}>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>{kind === "renewals" ? "Policy" : "Company"}</th>
              <th className={thCls}>Client</th>
              <th className={thCls}>{kind === "renewals" ? "Renewal date" : "Maturity date"}</th>
              <th className={`${thCls} text-right`}>{kind === "renewals" ? "Premium" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td className={`${tdCls} ${mutedCls}`} colSpan={4}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td className={`${tdCls} ${mutedCls}`} colSpan={4}>Nothing due in the next {days} days.</td></tr>}
            {rows?.map((r) => {
              const p = r as RenewalItem & MaturityItem;
              return (
                <tr key={r.id} className="border-t border-[#E5E5E5] dark:border-[#2B3644]">
                  <td className={tdCls}>{kind === "renewals" ? [p.insurer, p.policy_no].filter(Boolean).join(" ") || p.policy_type : (p.company ?? "–")}</td>
                  <td className={tdCls}>{holder(p)}</td>
                  <td className={tdCls}>{fmt(kind === "renewals" ? p.renewal_date : p.maturity_date)}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{formatRupeesFromPaise(kind === "renewals" ? p.premium_amount : p.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
