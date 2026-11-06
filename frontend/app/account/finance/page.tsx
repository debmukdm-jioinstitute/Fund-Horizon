"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addFinEntry, askFinance, checkAfford, deleteFinEntry, getMyFinance, getTaxView, importStatement, shareFinance,
  type FinChanges, type FinEntry, type FinKind, type FinSummary,
} from "@/lib/api";
import { apiBlob } from "@/lib/apiGet";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const sign = (n: number) => `${n > 0 ? "+" : ""}${inr(n)}`;
const KINDS: { v: FinKind; label: string; hint: string }[] = [
  { v: "income", label: "Income", hint: "Monthly amount" },
  { v: "expense", label: "Expense", hint: "Monthly amount" },
  { v: "debt", label: "Loan / card due", hint: "Outstanding balance" },
  { v: "saving", label: "Savings", hint: "Total saved" },
  { v: "goal", label: "Goal", hint: "Target amount" },
  { v: "budget", label: "Monthly limit", hint: "Limit for the category" },
  { v: "insurance", label: "Insurance cover", hint: "Cover amount" },
];
const box = "rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-4";
const muted = "text-[13px] text-[#536176] dark:text-[#A8B4C4]";
const h3 = "text-[13px] font-semibold mb-1";

async function save(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export default function FinancePage() {
  const [data, setData] = useState<{ entries: FinEntry[]; summary: FinSummary; changes: FinChanges | null } | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [f, setF] = useState({ kind: "income" as FinKind, label: "", amount: "", category: "", monthly_payment: "", apr: "", due_day: "", liquid: false, years: "", saved: "" });
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<string | null>(null);
  const [aff, setAff] = useState({ loan_amount: "", apr: "", years: "" });
  const [affRes, setAffRes] = useState<string | null>(null);
  const [tax, setTax] = useState({ age: "35", gross: "" });
  const [taxRes, setTaxRes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getMyFinance().then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(""); setNote("");
    try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await addFinEntry({
        kind: f.kind, label: f.label, amount: Number(f.amount), category: f.category,
        monthly_payment: Number(f.monthly_payment) || 0, apr: Number(f.apr) || 0, due_day: f.due_day ? Number(f.due_day) : undefined,
        liquid: f.kind === "saving" && f.liquid ? 1 : 0, years: f.years ? Number(f.years) : undefined, saved: Number(f.saved) || 0,
      } as never);
      setF({ ...f, label: "", amount: "", category: "", monthly_payment: "", apr: "", due_day: "", years: "", saved: "" });
    });
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    void run(async () => {
      const r = await importStatement(await file.text());
      setNote(`Added ${r.added} monthly lines from ${r.rows} transactions over ${r.months} month(s). Delete any that look wrong.`);
    });
  };

  const s = data?.summary;
  const ch = data?.changes;
  const stats: [string, string][] = s ? [
    ["Income / month", inr(s.monthly_income)], ["Spending / month", inr(s.monthly_expenses)], ["EMIs / month", inr(s.monthly_emi)],
    ["Left over / month", inr(s.monthly_surplus)], ["Net worth", inr(s.net_worth)], ["Interest you pay / year", inr(s.interest_per_year)],
    ["Emergency fund", s.emergency_months == null ? "n/a" : `${s.emergency_months} months`],
    ["Held with Fund Horizon", s.portfolio_invested ? `${inr(s.portfolio_invested)} (SIPs ${inr(s.portfolio_sip_monthly)}/mo)` : "none yet"],
  ] : [];
  const field = (label: string, v: string, set: (x: string) => void, ph: string, extra: object = {}) => (
    <input aria-label={label} className="terminal-input" placeholder={ph} value={v} onChange={(e) => set(e.target.value)} {...extra} />
  );

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7]">My money</h1>
      <p className={muted}>You enter the numbers or upload a statement; nothing is linked to your bank. Education only, not investment advice.</p>
      {err && <p role="alert" className="text-[13px] text-[#B42318]">{err}</p>}
      {note && <p role="status" className="text-[13px] text-[#006F64] dark:text-[#75E1CE]">{note}</p>}

      {s && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Summary">
          {stats.map(([k, v]) => (<div key={k} className={box}><div className={muted}>{k}</div><div className="text-[15px] font-semibold tabular-nums">{v}</div></div>))}
        </section>
      )}
      {ch && (
        <p className={muted}>Since {ch.since}: left over {sign(ch.monthly_surplus)}, spending {sign(ch.monthly_expenses)}, debt {sign(ch.debt_total)}, net worth {sign(ch.net_worth)}.</p>
      )}
      {s && s.flags.length > 0 && <ul className={`${box} space-y-1 text-[13px] list-disc pl-8`}>{s.flags.map((x) => <li key={x}>{x}</li>)}</ul>}
      {s && s.missing.length > 0 && (
        <div className={box}><div className={h3}>Tell us more so we can answer better</div><ul className={`${muted} list-disc pl-5 space-y-1`}>{s.missing.map((x) => <li key={x}>{x}</li>)}</ul></div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {s && s.upcoming_payments.length > 0 && (
          <div className={box}><div className={h3}>Coming up</div>
            <ul className="text-[13px] space-y-1">{s.upcoming_payments.map((p) => <li key={p.label}>{p.label}: {inr(p.amount)} in {p.in_days} days</li>)}</ul></div>
        )}
        {s && s.budgets.length > 0 && (
          <div className={box}><div className={h3}>Monthly limits</div>
            <ul className="text-[13px] space-y-1">{s.budgets.map((b) => <li key={b.category}>{b.category}: {inr(b.spent)} of {inr(b.limit)} ({b.pct}%)</li>)}</ul></div>
        )}
        {s && s.goal_plan.length > 0 && (
          <div className={box}><div className={h3}>Goals (at an illustrative 10% a year)</div>
            <ul className="text-[13px] space-y-1">{s.goal_plan.map((g) => (
              <li key={g.label}>{g.label}: {inr(g.target)}{g.years ? ` in ${g.years} yrs` : ""}, {g.monthly_needed == null ? "add the years to see the SIP" : `${inr(g.monthly_needed)} a month`}</li>))}</ul></div>
        )}
        {s && s.debt_plan.length > 0 && (
          <div className={box}><div className={h3}>Clearing your loans (highest rate first)</div>
            <ul className="text-[13px] space-y-1">{s.debt_plan.map((d) => (
              <li key={d.label}>{d.label}: {d.payoff ? `clear in ${d.payoff.months} months, interest ${inr(d.payoff.interest)}` : "EMI does not cover the interest"}
                {d.extra_10pct ? `. Pay ${inr(d.extra_10pct.extra_per_month)} more a month: ${d.extra_10pct.months_saved} months sooner, save ${inr(d.extra_10pct.interest_saved)}` : ""}</li>))}</ul></div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void run(async () => { setAns((await askFinance(q)).answer); }); }} className={`${box} space-y-2`}>
        <label htmlFor="fin-q" className="text-[13px] font-semibold">Ask about your money</label>
        <div className="flex gap-2 flex-wrap">
          <input id="fin-q" className="terminal-input flex-1 min-w-[12rem]" value={q} onChange={(e) => setQ(e.target.value)} minLength={3} maxLength={500} required placeholder="Where is my money going? Which loan should I clear first?" />
          <button className="terminal-btn-accent px-4 py-1.5" disabled={busy}>Ask</button>
        </div>
        {ans && <p className="text-[13px] whitespace-pre-wrap">{ans}</p>}
      </form>

      <div className={`${box} space-y-2`}>
        <label htmlFor="fin-csv" className="text-[13px] font-semibold">Upload a bank statement (CSV)</label>
        <p className={muted}>Needs Date, Description and Debit/Credit (or Amount) columns. We turn it into monthly averages by category and replace your last upload.</p>
        <input id="fin-csv" type="file" accept=".csv,text/csv" className="text-[13px]" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const r = await checkAfford({ loan_amount: Number(aff.loan_amount), apr: Number(aff.apr) || 0, years: Number(aff.years) || 1 });
          setAffRes(`New EMI ${inr(r.new_emi)}. EMIs would be ${r.emi_to_income_pct ?? "n/a"}% of income, ${inr(r.surplus_after)} left over a month: ${r.verdict}.`);
        }); }} className={`${box} space-y-2`}>
          <div className={h3}>Can I afford a loan?</div>
          {field("Loan amount", aff.loan_amount, (x) => setAff({ ...aff, loan_amount: x }), "₹ Loan amount", { type: "number", min: 1, required: true })}
          {field("Interest rate", aff.apr, (x) => setAff({ ...aff, apr: x }), "Interest % a year", { type: "number", min: 0, step: "0.1" })}
          {field("Years", aff.years, (x) => setAff({ ...aff, years: x }), "Years", { type: "number", min: 1, required: true })}
          <button className="terminal-btn px-3 py-1" disabled={busy}>Check</button>
          {affRes && <p className="text-[13px]">{affRes}</p>}
        </form>
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
          const r = await getTaxView({ age: Number(tax.age), gross_annual: tax.gross ? Number(tax.gross) : undefined });
          setTaxRes(`On ${inr(r.gross_annual)} a year: old regime tax ${inr(r.old_tax)}, new regime ${inr(r.new_tax)}. ${r.better === "new" ? "New" : "Old"} regime is cheaper by ${inr(r.you_save)}. Extra deductions you could still claim under the old regime: ${inr(r.extra_80c_room)}.`);
        }); }} className={`${box} space-y-2`}>
          <div className={h3}>Old or new tax regime?</div>
          {field("Age", tax.age, (x) => setTax({ ...tax, age: x }), "Age", { type: "number", min: 18, max: 100, required: true })}
          {field("Yearly gross income", tax.gross, (x) => setTax({ ...tax, gross: x }), "₹ Yearly gross (blank = 12 × monthly income)", { type: "number", min: 0 })}
          <button className="terminal-btn px-3 py-1" disabled={busy}>Compare</button>
          {taxRes && <p className="text-[13px]">{taxRes}</p>}
        </form>
      </div>

      <form onSubmit={add} className={`${box} grid grid-cols-1 sm:grid-cols-2 gap-2`}>
        <div className="sm:col-span-2 text-[13px] font-semibold">Add an entry</div>
        <select aria-label="Type" className="terminal-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as FinKind })}>
          {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
        </select>
        {field("Name", f.label, (x) => setF({ ...f, label: x }), "Name, e.g. Rent", { required: true, maxLength: 80 })}
        {field("Amount", f.amount, (x) => setF({ ...f, amount: x }), `₹ ${KINDS.find((k) => k.v === f.kind)?.hint}`, { type: "number", min: 1, required: true })}
        {(f.kind === "expense" || f.kind === "budget") && field("Category", f.category, (x) => setF({ ...f, category: x }), "Category, e.g. Food", { maxLength: 40, required: f.kind === "budget" })}
        {f.kind === "insurance" && (
          <select aria-label="Cover type" className="terminal-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} required>
            <option value="">Life or health?</option><option value="life">Life</option><option value="health">Health</option>
          </select>
        )}
        {f.kind === "debt" && (<>
          {field("EMI", f.monthly_payment, (x) => setF({ ...f, monthly_payment: x }), "₹ EMI / month", { type: "number", min: 0 })}
          {field("Interest rate", f.apr, (x) => setF({ ...f, apr: x }), "Interest % a year", { type: "number", min: 0, max: 100, step: "0.1" })}
        </>)}
        {(f.kind === "expense" || f.kind === "debt") && field("Due day", f.due_day, (x) => setF({ ...f, due_day: x }), "Due day of month (optional)", { type: "number", min: 1, max: 31 })}
        {f.kind === "goal" && (<>
          {field("Years", f.years, (x) => setF({ ...f, years: x }), "Years left to reach it", { type: "number", min: 1, max: 60 })}
          {field("Saved so far", f.saved, (x) => setF({ ...f, saved: x }), "₹ Already set aside for it", { type: "number", min: 0 })}
        </>)}
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

      <div className="flex gap-2 flex-wrap">
        <button type="button" className="terminal-btn px-3 py-1.5" disabled={busy} onClick={() => void run(async () => save(await apiBlob("/api/me/finance/report.pdf", {}), "my-money.pdf"))}>Download monthly report (PDF)</button>
        <button type="button" className="terminal-btn px-3 py-1.5" disabled={busy} onClick={() => void run(async () => save(await apiBlob("/api/me/finance/bills.ics", {}), "my-bills.ics"))}>Add bills to my calendar (.ics)</button>
        <button type="button" className="terminal-btn px-3 py-1.5" disabled={busy} onClick={() => void run(async () => { await shareFinance(); setNote("Sent to the Fund Horizon team. Replies appear under Messages."); })}>Share summary with my advisor</button>
      </div>
    </main>
  );
}
