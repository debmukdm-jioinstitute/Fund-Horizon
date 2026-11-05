"use client";

import React, { useEffect, useRef, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

const RISKS = ["Conservative", "Moderately Conservative", "Moderate", "Moderately Aggressive", "Aggressive"];
const MIN_AMOUNT = 5000;
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2 py-1.5 text-[13px] tabular-nums";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const hint = "text-[11.5px] font-normal text-[#667085] dark:text-[#9AA3B2]";
const th = "px-2 py-1.5 text-left text-[11.5px] font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-[12.5px] tabular-nums";

interface Row { code: string; name: string; category: string; amount: string; exp_ret: string }
interface Hit { id: string; title: string; sub: string }
interface Split { name: string; amount: number; pct: number }
interface Trailing { code: string; name: string; category: string; aum_cr: number | null; ter: number | null; peers: number; returns: Record<string, number | null>; avg: Record<string, number | null>; rank: Record<string, number | null> }
interface Rolling { code: string; name: string; category: string; average: number; median: number; maximum: number; minimum: number; distribution: Record<string, number> }
interface Named { name: string; pct: number }
interface Result {
  amount: number; years: number; expected_return: number; future_value: number;
  schemes: { code: string; name: string; category: string; amount: number; exp_ret: number; alloc_pct: number; ret_1y: number | null; ret_3y: number | null; ret_5y: number | null }[];
  trailing: Trailing[]; rolling: Rolling[]; amc: Split[]; category: Split[]; asset: Split[];
  holdings: { sector: Named[]; equity: Named[]; debt: Named[]; coverage_pct: number; as_of: string | null };
  notes: { nav_as_of: string; rolling: string; returns: string };
}

async function call<T>(path: string, init: RequestInit = {}, blob = false): Promise<T> {
  const go = () => fetch(resolveApiUrl(`${API_URL}${path}`), { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  let res: Response;
  try { res = await go(); } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try { res = await go(); } catch { throw new ApiError("Could not reach the server (it may be restarting). Wait a few seconds and try again.", 0); }
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const f2 = (v: number | null | undefined) => (v == null ? "-" : v.toFixed(2));
const digits = (s: string) => s.replace(/[^\d]/g, "");
const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? NaN : Number(s));

function Table({ head, rows, right = 1 }: { head: string[]; rows: React.ReactNode[][]; right?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr className="bg-[#183883] text-white">{head.map((h, i) => <th key={h + i} className={`${th} ${i >= right ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.slice(0, DEFAULT_PAGE_SIZE).map((r, i) => <tr key={i} className="border-b border-[#E4E9EF] dark:border-[#2B3644] odd:bg-[#F5F7FB] dark:odd:bg-[#1B2433]">{r.map((c, j) => <td key={j} className={`${td} ${j >= right ? "text-right" : ""}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const SplitTable = ({ title, rows }: { title: string; rows: Split[] }) => (
  <div>
    <h3 className="mb-1.5 text-[13.5px] font-bold">{title}</h3>
    <Table head={[title.replace(" Allocation", ""), "Amount (Rs.)", "Allocation (%)"]} rows={[...rows.map((r) => [r.name, inr(r.amount), r.pct.toFixed(2)]), [<b key="t">Grand Total</b>, <b key="a">{inr(rows.reduce((s, r) => s + r.amount, 0))}</b>, <b key="p">100.00</b>]]} />
  </div>
);

const Top10 = ({ title, rows, col }: { title: string; rows: Named[]; col: string }) => (
  <div>
    <h3 className="mb-1.5 text-[13.5px] font-bold">{title}</h3>
    {rows.length ? <Table head={[col, "Allocation (%)"]} rows={rows.map((r) => [r.name, r.pct.toFixed(2)])} /> : <p className={hint}>No disclosure data for these schemes.</p>}
  </div>
);

export default function InvestmentProposal() {
  const [client, setClient] = useState("");
  const [amount, setAmount] = useState("");
  const [years, setYears] = useState("");
  const [risk, setRisk] = useState("");
  const [custom, setCustom] = useState<"" | "1" | "2">("");
  const [purpose, setPurpose] = useState("");
  const [plan, setPlan] = useState<"Regular" | "Direct">("Regular");
  const [rows, setRows] = useState<Row[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [cover, setCover] = useState(true);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setSearching(false); return; }
    const id = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const d = await call<{ results: { scope: string; id: string; title: string; subtitle?: string }[] }>(`/api/backoffice/search?q=${encodeURIComponent(term)}&scope=mutual_funds`);
        if (id !== seq.current) return;
        setHits(d.results.filter((r) => r.scope === "mutual_funds" && r.title.includes(plan)).slice(0, 10).map((r) => ({ id: r.id, title: r.title, sub: r.subtitle ?? "" })));
        setActive(0);
      } catch { if (id === seq.current) setHits([]); } finally { if (id === seq.current) setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, plan]);

  const amt = num(amount.replace(/,/g, "")), yrs = num(years);
  const stale = () => setRes(null); // any change to the inputs or the table invalidates the shown result

  const checkForm = (): string => {
    if (!client.trim()) return "Please enter the client name.";
    if (!(amt >= MIN_AMOUNT)) return `Lumpsum minimum investment amount is Rs.${MIN_AMOUNT}.`;
    if (!(yrs > 0 && yrs <= 50)) return "Please enter a valid period (1 to 50 years).";
    if (!risk) return "Please select the risk profile.";
    if (!custom) return "Please select the expected returns option.";
    return "";
  };
  const wrap = async (label: string, fn: () => Promise<void>) => {
    setErr(""); setBusy(label);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(""); }
  };

  const submit = () => {
    const m = checkForm();
    if (m) return setErr(m);
    void wrap("suggest", async () => {
      const d = await call<{ rows: { code: string; name: string; category: string; amount: number; exp_ret: number }[] }>("/api/backoffice/investment-proposal/suggest", { method: "POST", body: JSON.stringify({ amount: amt, years: yrs, risk, plan }) });
      setRows(d.rows.map((r) => ({ code: r.code, name: r.name, category: r.category, amount: inr(r.amount), exp_ret: custom === "2" ? "8" : String(r.exp_ret) })));
      setRes(null);
    });
  };

  const add = (h: Hit) => {
    setHits([]); setQ(""); setOpen(false);
    if (rows.some((r) => r.code === h.id)) return;
    void wrap("add", async () => {
      const s = await call<{ code: string; name: string; category: string; exp_ret: number }>(`/api/backoffice/investment-proposal/scheme/${h.id}`);
      setRows((r) => [...r, { code: s.code, name: s.name, category: s.category, amount: "", exp_ret: custom === "2" ? "8" : String(s.exp_ret) }]);
      stale();
    });
  };

  const total = rows.reduce((s, r) => s + (num(r.amount.replace(/,/g, "")) || 0), 0);
  const body = () => ({ years: yrs, amount: amt, client: client.trim(), risk, purpose: purpose.trim(), cover, rows: rows.map((r) => ({ code: r.code, amount: num(r.amount.replace(/,/g, "")), exp_ret: num(r.exp_ret) })) });
  const checkRows = (): string => {
    const m = checkForm();
    if (m) return m;
    if (!rows.length) return "Please add at least one scheme.";
    for (const r of rows) {
      if (!(num(r.amount.replace(/,/g, "")) > 0)) return `Please enter the lumpsum amount for ${r.name}.`;
      if (isNaN(num(r.exp_ret))) return `Please enter the expected returns for ${r.name}.`;
    }
    if (total > amt) return "Total Investment Amount exceeds the Proposal Amount!";
    return "";
  };

  const show = () => {
    const m = checkRows();
    if (m) return setErr(m);
    void wrap("result", async () => setRes(await call<Result>("/api/backoffice/investment-proposal/result", { method: "POST", body: JSON.stringify(body()) })));
  };
  const pdf = () => {
    const m = checkRows();
    if (m) return setErr(m);
    void wrap("pdf", async () => {
      const blob = await call<Blob>("/api/backoffice/investment-proposal/pdf", { method: "POST", body: JSON.stringify(body()) }, true);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `Investment Proposal - ${client.trim()}.pdf`; a.click(); URL.revokeObjectURL(a.href);
    });
  };

  const setRow = (i: number, p: Partial<Row>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x))); stale(); };
  const left = amt - total;

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-4 p-5`}>
        <div>
          <h2 className="text-lg font-bold">Investment proposal — lumpsum</h2>
          <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Enter the client&apos;s amount, period and risk profile. Fund Horizon suggests a category mix and the top-scored scheme in each category; change any scheme, amount or expected return, then show the result or download the client PDF.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-[12px] font-semibold">Client name<input className={`${cell} mt-1`} value={client} maxLength={120} placeholder="e.g. Aditya Parchure" onChange={(e) => { setClient(e.target.value); stale(); }} /></label>
          <label className="text-[12px] font-semibold">Lumpsum amount (Rs.) <span className={hint}>(minimum {inr(MIN_AMOUNT)})</span>
            <input className={`${cell} mt-1`} inputMode="numeric" value={amount} placeholder="e.g. 10,00,000" onChange={(e) => { const d = digits(e.target.value); setAmount(d ? inr(Number(d)) : ""); stale(); }} /></label>
          <label className="text-[12px] font-semibold">Period (years)<input className={`${cell} mt-1`} inputMode="decimal" value={years} placeholder="e.g. 10" onChange={(e) => { setYears(e.target.value.replace(/[^\d.]/g, "")); stale(); }} /></label>
          <label className="text-[12px] font-semibold">Risk profile
            <select className={`${cell} mt-1`} value={risk} onChange={(e) => { setRisk(e.target.value); stale(); }}><option value="">Select risk profile</option>{RISKS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label className="text-[12px] font-semibold">Expected returns
            <select className={`${cell} mt-1`} value={custom} onChange={(e) => { setCustom(e.target.value as "" | "1" | "2"); stale(); }}>
              <option value="">Select expected returns</option><option value="1">Standard expected returns</option><option value="2">Custom expected returns</option></select></label>
          <label className="text-[12px] font-semibold">Plan
            <select className={`${cell} mt-1`} value={plan} onChange={(e) => setPlan(e.target.value as "Regular" | "Direct")}><option>Regular</option><option>Direct</option></select></label>
          <label className="text-[12px] font-semibold sm:col-span-2 lg:col-span-3">Investment purpose <span className={hint}>(optional)</span><input className={`${cell} mt-1`} value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} onClick={submit} disabled={!!busy}>{busy === "suggest" ? "Suggesting…" : "Submit"}</button>
          <span className={hint}>Submit replaces the scheme table below with a fresh suggestion.</span>
        </div>
        {err && <p role="alert" className="rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] font-medium text-[#B42318] dark:bg-[#3A1C1C] dark:text-[#FDA29B]">{err}</p>}
      </div>

      {rows.length > 0 && (
        <div className={`${card} space-y-3 p-5`}>
          <h3 className="text-[15px] font-bold">Suggested schemes</h3>
          <div className="relative">
            <input className={cell} role="combobox" aria-expanded={open} aria-controls="proposal-hits" autoComplete="off" value={q} placeholder={`Add another scheme: type a fund name or scheme code (${plan} plan)`}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                else if (e.key === "Enter" && hits[active]) { e.preventDefault(); add(hits[active]); }
                else if (e.key === "Escape") setOpen(false);
              }} />
            {open && q.trim().length >= 2 && (
              <ul id="proposal-hits" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] shadow-lg">
                {hits.map((h, i) => (
                  <li key={h.id} role="option" aria-selected={i === active} className={`cursor-pointer px-3 py-1.5 text-[12.5px] ${i === active ? "bg-[#E8F3F1] dark:bg-[#1B2F2C]" : ""} ${rows.some((x) => x.code === h.id) ? "opacity-50" : ""}`}
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); add(h); }}>
                    <div className="font-semibold">{h.title} <span className="font-normal text-[#667085] dark:text-[#9AA3B2]">· {h.id}</span></div>
                    {h.sub && <div className={hint}>{h.sub}{rows.some((x) => x.code === h.id) ? " · already added" : ""}</div>}
                  </li>
                ))}
                {!hits.length && <li className={`px-3 py-2 ${hint}`}>{searching ? "Searching…" : `No ${plan}-plan fund found. Check the spelling or try the scheme code.`}</li>}
              </ul>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr className="bg-[#183883] text-white"><th className={th}>Scheme</th><th className={th}>Category</th><th className={`${th} text-right`}>Amount (Rs.)</th><th className={`${th} text-right`}>Expected return (%)</th><th className={th}><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.code} className="border-b border-[#E4E9EF] dark:border-[#2B3644]">
                    <td className="px-2 py-1.5 text-[12.5px]">{r.name} <span className={hint}>· {r.code}</span></td>
                    <td className="px-2 py-1.5 text-[12.5px] whitespace-nowrap">{r.category}</td>
                    <td className="px-2 py-1.5"><input aria-label={`Amount for ${r.name}`} className={`${cell} w-32 text-right`} inputMode="numeric" value={r.amount} onChange={(e) => { const d = digits(e.target.value); setRow(i, { amount: d ? inr(Number(d)) : "" }); }} /></td>
                    <td className="px-2 py-1.5"><input aria-label={`Expected return for ${r.name}`} className={`${cell} w-24 text-right`} inputMode="decimal" value={r.exp_ret} readOnly={custom === "1"} title={custom === "1" ? "Standard expected returns are fixed per category. Choose Custom expected returns to edit." : undefined} onChange={(e) => setRow(i, { exp_ret: e.target.value.replace(/[^\d.-]/g, "") })} /></td>
                    <td className="px-2 py-1.5"><button type="button" className={btn} aria-label={`Remove ${r.name}`} onClick={() => { setRows((x) => x.filter((_, j) => j !== i)); stale(); }}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td className={td} colSpan={2}>Total</td><td className={`${td} text-right ${total > amt ? "text-[#B42318]" : ""}`}>{inr(total)}</td><td className={`${td} text-right ${hint}`} colSpan={2}>{left === 0 ? "Matches the proposal amount" : left > 0 ? `Rs. ${inr(left)} left to allocate` : `Rs. ${inr(-left)} over the proposal amount`}</td></tr></tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btnPrimary} onClick={show} disabled={!!busy}>{busy === "result" ? "Calculating…" : "Show result"}</button>
            <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} /> Include cover page in PDF</label>
            <button type="button" className={btn} onClick={pdf} disabled={!!busy}>{busy === "pdf" ? "Preparing PDF…" : "Download PDF"}</button>
          </div>
        </div>
      )}

      {res && (
        <div className={`${card} space-y-5 p-5`}>
          <div className="grid gap-3 sm:grid-cols-3">
            {[["Lumpsum amount", `Rs. ${inr(res.amount)}`], [`Expected return (% p.a.)`, res.expected_return.toFixed(2)], [`Expected value after ${res.years} years`, `Rs. ${inr(res.future_value)}`]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-[#F5F7FB] dark:bg-[#1B2433] p-3"><div className={hint}>{k}</div><div className="text-[20px] font-bold tabular-nums">{v}</div></div>
            ))}
          </div>
          <div>
            <h3 className="mb-1.5 text-[13.5px] font-bold">Suggested portfolio allocation</h3>
            <Table right={2} head={["Scheme", "Category", "1 Yr Ret (%)", "3 Yrs Ret (%)", "5 Yrs Ret (%)", "Expected Ret (%)", "Amount (Rs.)", "Allocation (%)"]}
              rows={[...res.schemes.map((s) => [s.name, s.category, f2(s.ret_1y), f2(s.ret_3y), f2(s.ret_5y), s.exp_ret.toFixed(2), inr(s.amount), s.alloc_pct.toFixed(2)]),
                [<b key="g">Grand Total</b>, "", "", "", "", <b key="r">{res.expected_return.toFixed(2)}</b>, <b key="a">{inr(res.amount)}</b>, <b key="p">100.00</b>]]} />
            <p className={`${hint} mt-1`}>{res.notes.returns} Net asset value (NAV) as on {res.notes.nav_as_of}.</p>
          </div>
          <div>
            <h3 className="mb-1.5 text-[13.5px] font-bold">Trailing returns</h3>
            <Table right={2} head={["Scheme", "Category", "AUM (Cr)", "TER (%)", "1 Yr Ret / Rank", "3 Yrs Ret / Rank", "5 Yrs Ret / Rank", "10 Yrs Ret / Rank"]}
              rows={res.trailing.flatMap((t) => [
                [t.name, t.category, t.aum_cr == null ? "-" : inr(t.aum_cr), f2(t.ter), ...["1y", "3y", "5y", "10y"].map((k) => `${f2(t.returns[k])} / ${t.rank[k] == null ? "-" : `${t.rank[k]} of ${t.rank[k + "_of"]}`}`)],
                [<i key="a">{`Category average (${t.peers} funds)`}</i>, "", "", "", ...["1y", "3y", "5y", "10y"].map((k) => <i key={k}>{f2(t.avg[k])}</i>)],
              ])} />
          </div>
          {res.rolling.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[13.5px] font-bold">Rolling return analysis (equity and hybrid schemes)</h3>
              <Table right={2} head={["Scheme", "Category", "Average", "Median", "Maximum", "Minimum", "Negative", "0 - 8%", "8 - 12%", "12 - 15%", "15 - 20%", "> 20%"]}
                rows={res.rolling.map((r) => [r.name, r.category, f2(r.average), f2(r.median), f2(r.maximum), f2(r.minimum), ...["negative", "0-8", "8-12", "12-15", "15-20", ">20"].map((k) => f2(r.distribution[k]))])} />
              <p className={`${hint} mt-1`}>{res.notes.rolling} Distribution is the share of rolling periods (%).</p>
            </div>
          )}
          <div className="grid gap-5 lg:grid-cols-3"><SplitTable title="AMC Allocation" rows={res.amc} /><SplitTable title="Asset Allocation" rows={res.asset} /><SplitTable title="Category Allocation" rows={res.category} /></div>
          <div>
            <p className={`${hint} mb-2`}>Holdings are from the latest portfolio disclosures ({res.holdings.as_of ?? "date not available"}) and cover {res.holdings.coverage_pct}% of the amount.</p>
            <div className="grid gap-5 lg:grid-cols-3"><Top10 title="Top 10 sector allocation" rows={res.holdings.sector} col="Sector" /><Top10 title="Top 10 equity allocation" rows={res.holdings.equity} col="Company" /><Top10 title="Top 10 debt allocation" rows={res.holdings.debt} col="Company" /></div>
          </div>
        </div>
      )}
    </div>
  );
}
