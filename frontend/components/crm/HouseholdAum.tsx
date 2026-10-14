// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import { fetchContactHoldings, fetchHouseholdAum, type AumPayload } from "../../lib/crmPhase3Api";
import { cardCls, errCls, headCls, mutedCls, rupees, tdCls, thCls, tierTone } from "./ui";

/** AUM roll-up (units × latest AMFI NAV) with positions, tier and the Direct-plan flag. */
export default function HoldingsCard({ householdId, contactId, title = "Holdings & AUM" }: { householdId?: string; contactId?: string; title?: string }) {
  const [data, setData] = useState<AumPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (contactId ? fetchContactHoldings(contactId) : fetchHouseholdAum(householdId!))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Could not load holdings"));
    return () => { alive = false; };
  }, [householdId, contactId]);

  if (error) return <p role="alert" className={errCls}>{error}</p>;
  if (!data) return <div role="status" aria-busy="true" aria-label="Loading" className="h-20 rounded bg-[#E4E9EF]/70 dark:bg-[#2B3644]/70 animate-pulse" />;
  const direct = data.direct_plan_holdings.length;
  return (
    <section className={cardCls} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={headCls}>{title}</h2>
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold capitalize ${tierTone[data.tier] ?? tierTone.standard}`}>{data.tier}</span>
      </div>
      <p className="mt-1 text-2xl font-bold text-[#172033] dark:text-[#EDF2F7]" aria-label="Assets under management">{rupees(data.aum_paise)}</p>
      <p className={`text-xs ${mutedCls}`}>
        Cost {rupees(data.cost_paise)} · {data.holdings.length} position{data.holdings.length === 1 ? "" : "s"}
        {data.unvalued > 0 && ` · ${data.unvalued} without a NAV (not counted)`}
      </p>
      {direct > 0 && (
        <p role="note" className="mt-2 rounded border border-amber-300 bg-amber-50 dark:bg-[#40300E] dark:border-[#6B5216] px-3 py-2 text-xs font-medium text-amber-900 dark:text-[#FFD27A]">
          {direct} Direct-plan holding{direct === 1 ? "" : "s"} found. A Regular-plan distributor earns no trail on these; check the client&apos;s intent.
        </p>
      )}
      {data.holdings.length === 0 ? (
        <p className={`text-xs mt-3 ${mutedCls}`}>No holdings yet. Import a CAS file from the Book tab.</p>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]">
                <th className={thCls}>Scheme</th>
                {householdId && <th className={thCls}>Holder</th>}
                <th className={thCls}>Folio</th><th className={`${thCls} text-right`}>Units</th>
                <th className={`${thCls} text-right`}>Value</th><th className={`${thCls} text-right`}>Gain</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.id} className="border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">
                  <td className={tdCls}>
                    {h.scheme_name ?? h.scheme_code}
                    {h.is_direct && <span className="ml-1 rounded bg-[#FFF1D6] dark:bg-[#40300E] px-1 text-[10px] font-semibold text-[#8A5A00] dark:text-[#FFD27A]">Direct</span>}
                  </td>
                  {householdId && <td className={tdCls}>{h.contact_name ?? "–"}</td>}
                  <td className={tdCls}>{h.folio}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{h.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{rupees(h.value_paise)}</td>
                  <td className={`${tdCls} text-right tabular-nums ${h.gain_paise != null && h.gain_paise < 0 ? "text-rose-700 dark:text-rose-300" : ""}`}>{rupees(h.gain_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
