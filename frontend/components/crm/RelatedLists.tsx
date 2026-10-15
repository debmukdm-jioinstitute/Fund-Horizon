// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import { crmRaw } from "../../lib/crmApi";
import { formatRupeesFromPaise } from "../../lib/crmProductsApi";

interface Member { customer_id: string; name: string }
interface Mandate { id: string; customer_id: string; umrn: string | null; bank_name: string | null; amount_cap: number | null; status: string }
interface Kyc { customer_id: string; pan_last4: string | null; kra_status: string; ckyc_id: string | null }
interface Consent { customer_id: string; purpose: string; granted: boolean }

const card = "rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-4";
const head = "text-sm font-bold text-[#181818] dark:text-[#EDF2F7] mb-2";
const sub = "text-xs text-[#706E6B] dark:text-[#A8B4C4]";

/** Mandates, KYC and consents for each household member (policies, FDs, PMS, opportunities and cases are
 *  shown by the household view itself). Endpoints a role cannot read are skipped, not fatal. */
export default function RelatedLists({ members }: { members: Member[] }) {
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [kyc, setKyc] = useState<Kyc[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const key = members.map((m) => m.customer_id).join(",");

  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = key ? key.split(",") : [];
      const [m, k, c] = await Promise.all([
        Promise.all(ids.map((id) => crmRaw<Mandate[]>(`/mandates?customer_id=${id}`).catch(() => []))),
        Promise.all(ids.map((id) => crmRaw<Kyc>(`/kyc?customer_id=${id}`).catch(() => null))),
        Promise.all(ids.map((id) => crmRaw<Consent[]>(`/consents?customer_id=${id}`).catch(() => []))),
      ]);
      if (!alive) return;
      setMandates(m.flat());
      setKyc(k.filter((x): x is Kyc => !!x));
      setConsents(c.flat());
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [key]);

  const nameOf = (id: string) => members.find((m) => m.customer_id === id)?.name ?? "–";
  if (!loaded) return <div role="status" aria-busy="true" aria-label="Loading" className="h-16 rounded bg-[#E5E5E5]/70 dark:bg-[#2B3644]/70 animate-pulse" />;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={card}>
        <h3 className={head}>Mandates ({mandates.length})</h3>
        {mandates.length === 0 ? <p className={sub}>No mandates.</p> : (
          <ul className="space-y-1.5 text-xs">
            {mandates.map((m) => (
              <li key={m.id} className="flex justify-between gap-2">
                <span>{nameOf(m.customer_id)} · {m.bank_name ?? "Bank n/a"} · {m.umrn ?? "no UMRN"}</span>
                <span className={sub}>{formatRupeesFromPaise(m.amount_cap)} · {m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={card}>
        <h3 className={head}>KYC ({kyc.length})</h3>
        {kyc.length === 0 ? <p className={sub}>No KYC records.</p> : (
          <ul className="space-y-1.5 text-xs">
            {kyc.map((k) => (
              <li key={k.customer_id} className="flex justify-between gap-2">
                <span>{nameOf(k.customer_id)} · PAN ••••{k.pan_last4 ?? "—"}</span>
                <span className={sub}>KRA {k.kra_status.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={`${card} md:col-span-2`}>
        <h3 className={head}>Consents ({consents.length})</h3>
        {consents.length === 0 ? <p className={sub}>No consents recorded.</p> : (
          <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
            {consents.map((c) => (
              <li key={`${c.customer_id}-${c.purpose}`} className="flex justify-between gap-2">
                <span>{nameOf(c.customer_id)} · {c.purpose.replaceAll("_", " ")}</span>
                <span className={c.granted ? "text-[#0B5D3B] dark:text-[#7FE0B5]" : "text-[#9B1C2E] dark:text-[#FFA9B5]"}>{c.granted ? "Granted" : "Withdrawn"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
