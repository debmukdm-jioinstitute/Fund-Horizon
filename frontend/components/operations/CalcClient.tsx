"use client";

// Customer link for the calculators. A saved calculation is a CRM "note" activity on the customer's household:
// readable summary first, machine payload on the last line ("fhcalc:{json}"), so it also shows in the CRM timeline.
import { useEffect, useState } from "react";
import { createActivity, createHousehold, fetchActivities } from "@/lib/crmApi";
import { fetchPage } from "@/lib/crmListApi";
import { createContact } from "@/lib/crmPhase3Api";

export interface Client { id: string; name: string; household_id: string; mobile?: string | null; email?: string | null }
export interface Saved { id: string; calc: string; vals: Record<string, string>; at: string; summary: string }

const TAG = "fhcalc:";
const field = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-[13.5px] text-[#172033] dark:text-[#EDF1F6] outline-none focus:border-[#006F64]";
const small = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#006F64] hover:text-[#006F64] disabled:opacity-50";

export async function saveCalc(client: Client, title: string, calc: string, vals: Record<string, string>, summary: string) {
  const payload = JSON.stringify({ calc, contact: client.id, vals });
  await createActivity({ kind: "note", subject: `Calculator: ${title} (${client.name})`, body: `${summary}\n${TAG}${payload}`, household_id: client.household_id });
}

export async function loadSaved(client: Client): Promise<Saved[]> {
  const rows = await fetchActivities({ household_id: client.household_id });
  const out: Saved[] = [];
  for (const a of rows) {
    const line = a.body?.split("\n").find((l) => l.startsWith(TAG));
    if (!line) continue;
    try {
      const p = JSON.parse(line.slice(TAG.length));
      if (p.contact === client.id) out.push({ id: a.id, calc: p.calc, vals: p.vals, at: a.created_at, summary: a.subject.replace(/^Calculator: /, "") });
    } catch { /* not ours */ }
  }
  return out;
}

export function ClientPicker({ client, onChange }: { client: Client | null; onChange: (c: Client | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", mobile: "", email: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      fetchPage<Client>("contacts", { limit: 8, offset: 0, q: q.trim() || undefined })
        .then((r) => setHits(r.rows)).catch((e) => setMsg(e instanceof Error ? e.message : "Could not load customers"));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setMsg("Name is required.");
    setBusy(true); setMsg(null);
    try {
      const h = await createHousehold({ name: f.name.trim() });
      const c = await createContact({ household_id: h.id, name: f.name.trim(), mobile: f.mobile.trim() || undefined, email: f.email.trim() || undefined, relation: "self" });
      onChange({ id: c.id, name: c.name, household_id: h.id, mobile: c.mobile, email: c.email });
      setAdding(false); setOpen(false); setF({ name: "", mobile: "", email: "" });
    } catch (err) { setMsg(err instanceof Error ? err.message : "Could not create the customer"); }
    finally { setBusy(false); }
  };

  return (
    <div className="relative rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-bold uppercase tracking-wider text-[#667085] dark:text-[#9AA6B8]">Customer</span>
        {client ? (
          <>
            <span className="text-[14px] font-semibold text-[#006F64] dark:text-[#75E1CE]">{client.name}</span>
            <button type="button" className={small} onClick={() => onChange(null)}>Change</button>
          </>
        ) : (
          <>
            <input className={`${field} w-64`} placeholder="Search customers by name, mobile, email" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} aria-label="Search customers" />
            <button type="button" className={small} onClick={() => { setAdding(true); setOpen(false); }}>+ New customer</button>
            <span className="text-[12px] text-[#667085] dark:text-[#9AA6B8]">Optional. Pick one to save results and brand the report with their name.</span>
          </>
        )}
      </div>
      {open && !client && hits.length > 0 && (
        <ul className="absolute left-5 top-full z-20 mt-1 w-80 overflow-hidden rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] shadow-lg">
          {hits.map((h) => (
            <li key={h.id}><button type="button" className="block w-full px-3 py-2 text-left text-[13.5px] text-[#172033] dark:text-[#EDF1F6] hover:bg-[#F8FAFB] dark:hover:bg-[#1B2432]" onClick={() => { onChange(h); setOpen(false); setQ(""); }}>
              {h.name}<span className="ml-2 text-[12px] text-[#667085]">{h.mobile ?? h.email ?? ""}</span></button></li>
          ))}
        </ul>
      )}
      {adding && (
        <form onSubmit={create} className="mt-3 flex flex-wrap items-end gap-2">
          <input className={field} placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Customer name" />
          <input className={field} placeholder="Mobile (optional)" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} aria-label="Mobile" />
          <input className={field} placeholder="Email (optional)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email" />
          <button type="submit" className={small} disabled={busy}>{busy ? "Saving…" : "Create"}</button>
          <button type="button" className={small} onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {msg && <p role="alert" className="mt-2 text-[12.5px] text-[#B42318]">{msg}</p>}
    </div>
  );
}
