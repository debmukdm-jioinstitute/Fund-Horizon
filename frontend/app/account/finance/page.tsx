"use client";

import { useCallback, useEffect, useState } from "react";
import { addFinEntry, askFinance, deleteFinEntry, getMyFinance, type FinEntry, type FinKind, type FinSummary } from "@/lib/api";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const KINDS: { v: FinKind; label: string; hint: string }[] = [
  { v: "income", label: "Income", hint: "Monthly amount" },
  { v: "expense", label: "Expense", hint: "Monthly amount" },
  { v: "debt", label: "Loan / card due", hint: "Outstanding balance" },
  { v: "saving", label: "Savings", hint: "Total saved" },
  { v: "goal", label: "Goal", hint: "Target amount" },
];

export default function FinancePage() {
  const [data, setData] = useState<{ entries: FinEntry[]; summary: FinSummary } | null>(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ kind: "income" as FinKind, label: "", amount: "", category: "", monthly_payment: "", apr: "", due_day: "", liquid: false });
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getMyFinance().then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr("");
    try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await addFinEntry({
        kind: f.kind, label: f.label, amount: Number(f.amount), category: f.category,
        monthly_payment: Number(f.monthly_payment) || 0, apr: Number(f.apr) || 0, due_day: f.due_day ? Number(f.due_day) : undefined, liquid: f.kind === "saving" && f.liquid ? 1 : 0,
      } as never);
      setF({ ...f, label: "", amount: "", category: "", monthly_payment: "", apr: "", due_day: "" });
    });
  };
  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => { setAns((await askFinance(q)).answer); });
  };

  const s = data?.summary;
  const stats: [string, string][] = s ? [
    ["Income / month", inr(s.monthly_income)], ["Spending / month", inr(s.monthly_expenses)], ["EMIs / month", inr(s.monthly_emi)],
    ["Left over / month", inr(s.monthly_surplus)], ["Interest you pay / year", inr(s.interest_per_year)],
    ["Emergency fund", s.emergency_months == null ? "n/a" : `${s.emergency_months} months`],
  ] : [];
  const box = "rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-4";
  const muted = "text-[13px] text-[#536176] dark:text-[#A8B4C4]";

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7]">My money</h1>
      <p className={muted}>You enter the numbers; nothing is linked to your bank. Education only, not investment advice.</p>
      {err && <p role="alert" className="text-[13px] text-[#B42318]">{err}</p>}

      {s && (
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-3" aria-label="Summary">
          {stats.map(([k, v]) => (
            <div key={k} className={box}><div className={muted}>{k}</div><div className="text-[16px] font-semibold tabular-nums">{v}</div></div>
          ))}
        </section>
      )}
      {s && s.flags.length > 0 && (
        <ul className={`${box} space-y-1 text-[13px] list-disc pl-8`}>{s.flags.map((x) => <li key={x}>{x}</li>)}</ul>
      )}
      {s && s.missing.length > 0 && (
        <div className={box}><div className="text-[13px] font-semibold mb-1">Tell us more so we can answer better</div>
          <ul className={`${muted} list-disc pl-5 space-y-1`}>{s.missing.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}
      {s && s.upcoming_payments.length > 0 && (
        <div className={box}><div className="text-[13px] font-semibold mb-1">Coming up</div>
          <ul className="text-[13px] space-y-1">{s.upcoming_payments.map((p) => <li key={p.label}>{p.label}: {inr(p.amount)} in {p.in_days} days</li>)}</ul></div>
      )}

      <form onSubmit={ask} className={`${box} space-y-2`}>
        <label htmlFor="fin-q" className="text-[13px] font-semibold">Ask about your money</label>
        <div className="flex gap-2 flex-wrap">
          <input id="fin-q" className="terminal-input flex-1 min-w-[12rem]" value={q} onChange={(e) => setQ(e.target.value)} minLength={3} maxLength={500} required placeholder="Can I afford a ₹30 lakh loan? Where is my money going?" />
          <button className="terminal-btn-accent px-4 py-1.5" disabled={busy}>Ask</button>
        </div>
        {ans && <p className="text-[13px] whitespace-pre-wrap">{ans}</p>}
      </form>

      <form onSubmit={add} className={`${box} grid grid-cols-1 sm:grid-cols-2 gap-2`}>
        <div className="sm:col-span-2 text-[13px] font-semibold">Add an entry</div>
        <select aria-label="Type" className="terminal-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FinKind })}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
        <input aria-label="Name" className="terminal-input" placeholder="Name, e.g. Rent" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required maxLength={80} />
        <input aria-label="Amount" className="terminal-input" type="number" min={1} placeholder={`₹ ${KINDS.find((k) => k.v === f.kind)?.hint}`} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
        {f.kind === "expense" && <input aria-label="Category" className="terminal-input" placeholder="Category, e.g. Food" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} maxLength={40} />}
        {f.kind === "debt" && (<>
          <input aria-label="EMI" className="terminal-input" type="number" min={0} placeholder="₹ EMI / month" value={f.monthly_payment} onChange={(e) => setF({ ...f, monthly_payment: e.target.value })} />
          <input aria-label="Interest rate" className="terminal-input" type="number" min={0} max={100} step="0.1" placeholder="Interest % a year" value={f.apr} onChange={(e) => setF({ ...f, apr: e.target.value })} />
        </>)}
        {(f.kind === "expense" || f.kind === "debt") && <input aria-label="Due day" className="terminal-input" type="number" min={1} max={31} placeholder="Due day of month (optional)" value={f.due_day} onChange={(e) => setF({ ...f, due_day: e.target.value })} />}
        {f.kind === "saving" && <label className="text-[13px] flex items-center gap-2"><input type="checkbox" checked={f.liquid} onChange={(e) => setF({ ...f, liquid: e.target.checked })} />Cash or savings account (emergency fund)</label>}
        <button className="terminal-btn-accent px-4 py-1.5 sm:col-span-2" disabled={busy}>Add</button>
      </form>

      {data && data.entries.length > 0 && (
        <div className={`${box} overflow-x-auto`}>
          <table className="terminal-table w-full text-[13px]">
            <thead><tr><th className="text-left">Type</th><th className="text-left">Name</th><th className="text-right">Amount</th><th /></tr></thead>
            <tbody>{data.entries.map((e) => (
              <tr key={e.id}><td>{KINDS.find((k) => k.v === e.kind)?.label}</td><td>{e.label}</td><td className="text-right tabular-nums">{inr(e.amount)}</td>
                <td className="text-right"><button type="button" className="terminal-btn px-2 py-0.5" aria-label={`Remove ${e.label}`} onClick={() => void run(() => deleteFinEntry(e.id))}>Remove</button></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
