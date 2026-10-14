// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import { crmRaw } from "../../lib/crmApi";
import { bounceSip, createSip, fetchSips, patchSip, type Sip } from "../../lib/crmPhase3Api";
import { fmtDate } from "./EntityLists";
import { btnCls, cardCls, errCls, ghostBtnCls, headCls, inputCls, mutedCls, rupees, tdCls, thCls, toPaise } from "./ui";
import { useCanWrite } from "./useCanWrite";

interface Mandate { id: string; umrn: string | null; bank_name: string | null; status: string }

/** SIP / STP / SWP schedules for one contact, with a mandate picker and bounce tracking. */
export default function ContactSips({ contactId, customerId }: { contactId: string; customerId: string }) {
  const canWrite = useCanWrite();
  const [sips, setSips] = useState<Sip[] | null>(null);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ type: "sip", scheme_code: "", amount: "", day: "5", start_date: "", end_date: "", mandate_id: "" });

  const load = useCallback(async () => {
    try {
      setSips(await fetchSips({ contact_id: contactId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load SIPs");
    }
  }, [contactId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { crmRaw<Mandate[]>(`/mandates?customer_id=${customerId}`).then(setMandates).catch(() => setMandates([])); }, [customerId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = toPaise(f.amount);
    if (!f.scheme_code.trim() || !amount || amount <= 0 || !f.start_date) return setError("Scheme code, a positive amount and a start date are required.");
    setError(null);
    try {
      await createSip({
        contact_id: contactId, scheme_code: f.scheme_code.trim(), type: f.type, amount_paise: amount, day: Number(f.day),
        start_date: f.start_date, end_date: f.end_date || null, mandate_id: f.mandate_id || null,
      });
      setShow(false);
      setF({ ...f, scheme_code: "", amount: "", end_date: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the schedule");
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Could not update"); }
  };

  return (
    <section className={cardCls} aria-label="SIP, STP and SWP schedules">
      <div className="flex items-center justify-between">
        <h2 className={headCls}>SIP / STP / SWP</h2>
        {canWrite && <button type="button" className={ghostBtnCls} onClick={() => setShow((s) => !s)} aria-expanded={show}>{show ? "Close" : "Add schedule"}</button>}
      </div>
      {show && (
        <form onSubmit={add} className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <label>Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inputCls}><option value="sip">SIP</option><option value="stp">STP</option><option value="swp">SWP</option></select></label>
          <label>AMFI scheme code<input value={f.scheme_code} onChange={(e) => setF({ ...f, scheme_code: e.target.value })} className={inputCls} /></label>
          <label>Amount (₹)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={inputCls} /></label>
          <label>Day of month (1–28)<input type="number" min={1} max={28} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} className={inputCls} /></label>
          <label>Start<input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} className={inputCls} /></label>
          <label>End (optional)<input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} className={inputCls} /></label>
          <label className="col-span-2">Mandate (optional)
            <select value={f.mandate_id} onChange={(e) => setF({ ...f, mandate_id: e.target.value })} className={inputCls}>
              <option value="">None</option>
              {mandates.map((m) => <option key={m.id} value={m.id}>{m.bank_name ?? "Bank"} · {m.umrn ?? "no UMRN"} · {m.status}</option>)}
            </select>
          </label>
          <div className="col-span-2 flex justify-end"><button type="submit" className={btnCls}>Save schedule</button></div>
        </form>
      )}
      {error && <p role="alert" className={`${errCls} mt-2`}>{error}</p>}
      {sips === null ? (
        <p className={`text-xs mt-2 ${mutedCls}`}>Loading schedules…</p>
      ) : sips.length === 0 ? (
        <p className={`text-xs mt-2 ${mutedCls}`}>No schedules.</p>
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]"><th className={thCls}>Scheme</th><th className={thCls}>Type</th><th className={`${thCls} text-right`}>Amount</th><th className={thCls}>Day</th><th className={thCls}>Ends</th><th className={thCls}>Status</th>{canWrite && <th className={thCls}><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {sips.map((s) => (
                <tr key={s.id} className="border-b border-[#E4E9EF]/60 dark:border-[#2B3644]/60">
                  <td className={tdCls}>{s.scheme_name ?? s.scheme_code}</td>
                  <td className={`${tdCls} uppercase`}>{s.type}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{rupees(s.amount_paise)}</td>
                  <td className={tdCls}>{s.day}</td>
                  <td className={tdCls}>{fmtDate(s.end_date)}</td>
                  <td className={`${tdCls} capitalize`}>{s.status}{s.bounce_count > 0 ? ` (${s.bounce_count} bounce${s.bounce_count === 1 ? "" : "s"})` : ""}</td>
                  {canWrite && (
                    <td className={`${tdCls} whitespace-nowrap`}>
                      {s.status === "active" && <button type="button" className="underline mr-2" onClick={() => act(() => patchSip(s.id, { status: "paused" }))}>Pause</button>}
                      {s.status === "paused" && <button type="button" className="underline mr-2" onClick={() => act(() => patchSip(s.id, { status: "active" }))}>Resume</button>}
                      {s.status !== "ended" && <button type="button" className="underline mr-2" onClick={() => act(() => patchSip(s.id, { status: "ended" }))}>End</button>}
                      {s.status === "active" && <button type="button" className="underline text-rose-700 dark:text-rose-300" onClick={() => act(() => bounceSip(s.id))}>Bounced</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
