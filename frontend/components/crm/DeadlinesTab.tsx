"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchHouseholds, fetchMaturities, fetchRenewals, type Household, type MaturityItem, type RenewalItem } from "../../lib/crmApi";
import { createFd, createPolicy, formatRupeesFromPaise } from "../../lib/crmProductsApi";
import { btnCls, cardCls, errCls, inputCls, mutedCls, tdCls, thCls, toPaise } from "./ui";
import { useCanWrite } from "./useCanWrite";

const KINDS = [["renewals", "Policy & SIP renewals"], ["maturities", "FD maturities"]] as const;
const DAYS = [30, 60, 90];
const selCls =
  "px-2.5 py-1.5 text-xs rounded border bg-white dark:bg-[#171E27] border-[#E5E5E5] dark:border-[#2B3644] text-[#181818] dark:text-[#EDF2F7]";
const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "–");

const POLICY_TYPES = [
  ["sip", "SIP"],
  ["swp", "SWP"],
  ["top_up", "Top up"],
  ["mf", "MF"],
  ["pms", "PMS"],
  ["term", "Term life"],
  ["health", "Health"],
  ["motor", "Motor"],
  ["other_general", "Other general"],
  ["other_life", "Other life"],
] as const;

interface InstrumentMeta {
  label: string;
  providerLabel: string;
  providerPlaceholder: string;
  numberLabel: string;
  numberPlaceholder: string;
  amountLabel: string;
  amountPlaceholder: string;
  dateLabel: string;
}

const INSTRUMENT_META: Record<string, InstrumentMeta> = {
  sip: {
    label: "SIP",
    providerLabel: "Scheme / Fund",
    providerPlaceholder: "e.g. HDFC Flexi Cap Fund",
    numberLabel: "Folio / SIP Reg no.",
    numberPlaceholder: "e.g. 12345678/90",
    amountLabel: "SIP Amount (₹)",
    amountPlaceholder: "e.g. 10000",
    dateLabel: "Next SIP date",
  },
  swp: {
    label: "SWP",
    providerLabel: "Scheme / Fund",
    providerPlaceholder: "e.g. ICICI Pru Balanced Advantage",
    numberLabel: "Folio no.",
    numberPlaceholder: "e.g. 98765432",
    amountLabel: "SWP Payout (₹)",
    amountPlaceholder: "e.g. 25000",
    dateLabel: "Next payout date",
  },
  top_up: {
    label: "Top up",
    providerLabel: "Scheme / Fund",
    providerPlaceholder: "e.g. Parag Parikh Flexi Cap Fund",
    numberLabel: "Folio no.",
    numberPlaceholder: "e.g. 54321098",
    amountLabel: "Top-up Amount (₹)",
    amountPlaceholder: "e.g. 50000",
    dateLabel: "Scheduled date",
  },
  mf: {
    label: "MF",
    providerLabel: "Scheme / Fund",
    providerPlaceholder: "e.g. Nippon India Small Cap Fund",
    numberLabel: "Folio no.",
    numberPlaceholder: "e.g. 45678901",
    amountLabel: "Investment Amount (₹)",
    amountPlaceholder: "e.g. 100000",
    dateLabel: "Due date",
  },
  pms: {
    label: "PMS",
    providerLabel: "PMS Provider / Strategy",
    providerPlaceholder: "e.g. Marcellus Consistent Compounders",
    numberLabel: "Account / Client code",
    numberPlaceholder: "e.g. MAR-10293",
    amountLabel: "Investment Amount (₹)",
    amountPlaceholder: "e.g. 5000000",
    dateLabel: "Renewal / Review date",
  },
  term: {
    label: "Term life",
    providerLabel: "Insurer",
    providerPlaceholder: "e.g. HDFC Life",
    numberLabel: "Policy no.",
    numberPlaceholder: "e.g. POL-123456",
    amountLabel: "Premium (₹)",
    amountPlaceholder: "e.g. 25000",
    dateLabel: "Renewal date",
  },
  health: {
    label: "Health",
    providerLabel: "Insurer",
    providerPlaceholder: "e.g. Care Health Insurance",
    numberLabel: "Policy no.",
    numberPlaceholder: "e.g. POL-654321",
    amountLabel: "Premium (₹)",
    amountPlaceholder: "e.g. 18000",
    dateLabel: "Renewal date",
  },
  motor: {
    label: "Motor",
    providerLabel: "Insurer",
    providerPlaceholder: "e.g. ICICI Lombard",
    numberLabel: "Policy no.",
    numberPlaceholder: "e.g. POL-789012",
    amountLabel: "Premium (₹)",
    amountPlaceholder: "e.g. 12000",
    dateLabel: "Renewal date",
  },
  other_general: {
    label: "Other general",
    providerLabel: "Insurer",
    providerPlaceholder: "e.g. New India Assurance",
    numberLabel: "Policy no.",
    numberPlaceholder: "e.g. POL-345678",
    amountLabel: "Premium (₹)",
    amountPlaceholder: "e.g. 15000",
    dateLabel: "Renewal date",
  },
  other_life: {
    label: "Other life",
    providerLabel: "Insurer",
    providerPlaceholder: "e.g. LIC",
    numberLabel: "Policy no.",
    numberPlaceholder: "e.g. POL-901234",
    amountLabel: "Premium (₹)",
    amountPlaceholder: "e.g. 30000",
    dateLabel: "Renewal date",
  },
};

/** Record a policy/SIP deadline (with its renewal date) or an FD (with its maturity date) so it shows up in the list above. */
function AddDeadlineForm({ kind, onDone, onCancel }: { kind: "renewals" | "maturities"; onDone: () => void; onCancel: () => void }) {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [f, setF] = useState({ household_id: "", policy_type: "sip", insurer: "", policy_no: "", name: "", amount: "", rate: "", date: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { fetchHouseholds().then(setHouseholds).catch(() => setHouseholds([])); }, []);

  const meta = INSTRUMENT_META[f.policy_type] ?? INSTRUMENT_META.sip;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.household_id) return setErr("Choose a household.");
    if (!f.date) return setErr(kind === "renewals" ? `${meta.dateLabel} is required.` : "Maturity date is required.");
    setBusy(true);
    setErr(null);
    try {
      if (kind === "renewals") {
        await createPolicy({
          household_id: f.household_id, policy_type: f.policy_type, insurer: f.insurer.trim() || null, policy_no: f.policy_no.trim() || null,
          premium_amount: toPaise(f.amount), renewal_date: f.date,
        });
      } else {
        await createFd({
          household_id: f.household_id, company: f.name.trim() || null, amount: toPaise(f.amount),
          interest_rate: f.rate ? Number(f.rate) : null, maturity_date: f.date,
        });
      }
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={`${cardCls} grid gap-2 md:grid-cols-3 text-xs`} aria-label={kind === "renewals" ? "Add policy or SIP" : "Add FD"}>
      <label>Household
        <select value={f.household_id} onChange={set("household_id")} className={inputCls}>
          <option value="">Select…</option>{households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </label>
      {kind === "renewals" ? (
        <>
          <label>Policy / Instrument type
            <select value={f.policy_type} onChange={set("policy_type")} className={inputCls}>
              {POLICY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>{meta.providerLabel}
            <input value={f.insurer} onChange={set("insurer")} placeholder={meta.providerPlaceholder} className={inputCls} />
          </label>
          <label>{meta.numberLabel}
            <input value={f.policy_no} onChange={set("policy_no")} placeholder={meta.numberPlaceholder} className={inputCls} />
          </label>
        </>
      ) : (
        <>
          <label>Company / bank<input value={f.name} onChange={set("name")} className={inputCls} /></label>
          <label>Interest rate (% p.a.)<input inputMode="decimal" value={f.rate} onChange={set("rate")} className={inputCls} /></label>
        </>
      )}
      <label>{kind === "renewals" ? meta.amountLabel : "Amount (₹)"}
        <input inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder={kind === "renewals" ? meta.amountPlaceholder : ""} className={inputCls} />
      </label>
      <label>{kind === "renewals" ? meta.dateLabel : "Maturity date"}
        <input type="date" value={f.date} onChange={set("date")} className={inputCls} />
      </label>
      {err && <p role="alert" className={`md:col-span-3 ${errCls}`}>{err}</p>}
      <div className="md:col-span-3 flex justify-end gap-2">
        <button type="button" className="text-xs underline" onClick={onCancel}>Cancel</button>
        <button type="submit" className={btnCls} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

/** Policies and SIPs due for renewal and FDs about to mature. */
export default function DeadlinesTab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = params.get("kind") === "maturities" ? "maturities" : "renewals";
  const days = DAYS.includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
  const [rows, setRows] = useState<(RenewalItem | MaturityItem)[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canWrite = useCanWrite();
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);

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
  }, [kind, days, version]);

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
        {canWrite && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[#0176D3] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#014486] focus:outline-none focus:ring-2 focus:ring-[#0176D3]">
            <span aria-hidden className="text-base leading-none">+</span> {kind === "renewals" ? "Add deadline / policy" : "Add FD"}
          </button>
        )}
      </div>
      {adding && <AddDeadlineForm key={kind} kind={kind} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); setVersion((v) => v + 1); }} />}
      {error && <p className={errCls}>{error}</p>}
      <div className={`${cardCls} overflow-x-auto p-0`}>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={thCls}>{kind === "renewals" ? "Instrument / Policy" : "Company"}</th>
              <th className={thCls}>Client</th>
              <th className={thCls}>{kind === "renewals" ? "Due / Renewal date" : "Maturity date"}</th>
              <th className={`${thCls} text-right`}>{kind === "renewals" ? "Amount / Premium" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td className={`${tdCls} ${mutedCls}`} colSpan={4}>Loading…</td></tr>}
            {rows?.length === 0 && <tr><td className={`${tdCls} ${mutedCls}`} colSpan={4}>Nothing due in the next {days} days.</td></tr>}
            {rows?.map((r) => {
              const p = r as RenewalItem & MaturityItem;
              const typeLabel = INSTRUMENT_META[p.policy_type]?.label ?? p.policy_type;
              return (
                <tr key={r.id} className="border-t border-[#E5E5E5] dark:border-[#2B3644]">
                  <td className={tdCls}>
                    {kind === "renewals" ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="rounded bg-[#EAF5FE] dark:bg-[#0F2A4A] text-[#0176D3] dark:text-[#75B6F2] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          {typeLabel}
                        </span>
                        <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">
                          {[p.insurer, p.policy_no].filter(Boolean).join(" · ") || typeLabel}
                        </span>
                      </div>
                    ) : (
                      p.company ?? "–"
                    )}
                  </td>
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
