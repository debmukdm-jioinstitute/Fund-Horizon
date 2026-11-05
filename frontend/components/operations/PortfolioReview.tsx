"use client";

import React, { useEffect, useRef, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

interface Row { code: string; name: string; invested: string; value: string; from: string; to: string; inst: string }
interface Hit { id: string; title: string; sub: string }

const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-1.5 py-1 text-[12.5px] tabular-nums";
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ym = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? `${MON[+v.slice(5) - 1]}-${v.slice(2, 4)}` : "");
const longDate = (v: string) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
/** Feb-20 – Jul-26 | Feb-26 (one-time) | Since Feb-19 | "" */
const periodLabel = (from: string, to: string) => (!from ? "" : !to ? `Since ${ym(from)}` : from === to ? `${ym(from)} (one-time)` : `${ym(from)} – ${ym(to)}`);
const hint = "text-[11.5px] font-normal text-[#667085] dark:text-[#9AA3B2]";

async function call<T>(path: string, init: RequestInit = {}, blob = false): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}${path}`), { credentials: "include", ...init });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

export default function PortfolioReview({ customerId, customerName }: { customerId?: string; customerName?: string }) {
  const [name, setName] = useState(customerName ?? "");
  const [date, setDate] = useState(iso(new Date()));
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const [paste, setPaste] = useState("");
  const [compare, setCompare] = useState("");
  const [email, setEmail] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); } finally { setBusy(null); }
  };
  // Type-ahead: after 250 ms of no typing, ask the universal search; a newer keystroke makes older answers stale.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setSearching(false); return; }
    const id = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const d = await call<{ results: { scope: string; id: string; title: string; subtitle?: string }[] }>(`/api/backoffice/search?q=${encodeURIComponent(term)}&scope=mutual_funds`);
        if (id !== seq.current) return;
        setHits(d.results.filter((r) => r.scope === "mutual_funds" && /Regular/.test(r.title)).slice(0, 10).map((r) => ({ id: r.id, title: r.title, sub: r.subtitle ?? "" })));
        setActive(0);
      } catch { if (id === seq.current) setHits([]); } finally { if (id === seq.current) setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const add = (h: Hit) => { setRows((r) => (r.some((x) => x.code === h.id) ? r : [...r, { code: h.id, name: h.title, invested: "", value: "", from: "", to: "", inst: "" }])); setHits([]); setQ(""); setOpen(false); };
  const importPaste = () => {
    const parsed = paste.split("\n").map((l) => l.split(/[,\t]/).map((c) => c.trim().replace(/[₹]/g, ""))).filter((c) => /^\d{4,8}$/.test(c[0] ?? ""))
      .map((c) => ({ code: c[0], name: "", invested: c[1] ?? "", value: c[2] ?? "", from: /^\d{4}-\d{2}$/.test(c[3] ?? "") ? c[3] : "", to: /^\d{4}-\d{2}$/.test(c[4] ?? "") ? c[4] : "", inst: c[5] ?? "" }));
    setRows((r) => [...r, ...parsed.filter((p) => !r.some((x) => x.code === p.code))]); setPaste("");
  };
  const body = () => {
    const holdings = rows.map((r) => ({ code: r.code, name: r.name.replace(/ - (Regular|Direct) Plan.*$/, ""), invested: Number(r.invested.replace(/,/g, "")), value: Number(r.value.replace(/,/g, "")), period: periodLabel(r.from, r.to), inst: r.inst }));
    if (!name.trim() || !holdings.length || holdings.some((h) => !(h.invested >= 0) || !(h.value >= 0) || Number.isNaN(h.invested) || Number.isNaN(h.value))) throw new Error("Enter the client name and, for every fund, the invested amount and today's value.");
    return { client: { name: name.trim(), date: longDate(date) }, holdings, compare: compare.trim() ? JSON.parse(compare) : null };
  };
  const json = { method: "POST", headers: { "Content-Type": "application/json" } };
  const download = () => run("pdf", async () => {
    const blob = await call<Blob>("/api/backoffice/portfolio-review/pdf", { ...json, body: JSON.stringify(body()) }, true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `Portfolio Review - ${name} - ${longDate(date)}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  });
  const push = () => customerId && run("push", async () => {
    const r = await call<{ emailed: boolean }>("/api/backoffice/portfolio-review/push", { ...json, body: JSON.stringify({ customer_id: customerId, review: body(), send_email: email }) });
    setMsg({ ok: true, text: r.emailed ? "Saved to the client's CRM record and emailed." : "Saved to the client's CRM record." });
  });

  return (
    <div className={`${card} space-y-4 p-5`}>
      <div>
        <h2 className="text-lg font-bold">Portfolio review — your portfolio vs the market</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Add the funds the client holds with the amount invested and today&apos;s value. Fund Horizon adds live net asset value (NAV) dates, Fund Horizon (FH) scores and Buy / Hold / Sell signals, up-market and down-market capture ratios, worst falls, recommendations and a stress test. The same-instalment index slides appear only when comparison data is supplied below.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] font-semibold">Client name<input className={`${cell} mt-1`} value={name} placeholder="e.g. Aditya Parchure" onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-[12px] font-semibold">Valuation date <span className={hint}>(the date the values are as on)</span><input type="date" max={iso(new Date())} className={`${cell} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div>
        <div className="relative">
          <input className={cell} role="combobox" aria-expanded={open} aria-controls="fund-hits" autoComplete="off" value={q}
            placeholder="Start typing a fund name or scheme code, e.g. Parag Parikh Flexi Cap"
            onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && hits[active]) { e.preventDefault(); add(hits[active]); }
              else if (e.key === "Escape") setOpen(false);
            }} />
          {open && q.trim().length >= 2 && (
            <ul id="fund-hits" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] shadow-lg">
              {hits.map((h, i) => (
                <li key={h.id} role="option" aria-selected={i === active}
                  className={`cursor-pointer px-3 py-1.5 text-[12.5px] ${i === active ? "bg-[#E8F3F1] dark:bg-[#1B2F2C]" : ""} ${rows.some((x) => x.code === h.id) ? "opacity-50" : ""}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); add(h); }}>
                  <div className="font-semibold">{h.title.replace(/ - (Regular|Direct) Plan.*$/, "")} <span className="font-normal text-[#667085] dark:text-[#9AA3B2]">· {h.id}</span></div>
                  {h.sub && <div className={hint}>{h.sub}{rows.some((x) => x.code === h.id) ? " · already added" : ""}</div>}
                </li>
              ))}
              {!hits.length && <li className={`px-3 py-2 ${hint}`}>{searching ? "Searching…" : "No Regular-plan fund found. Check the spelling or try the scheme code."}</li>}
            </ul>
          )}
        </div>
        <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE]">Paste many funds (scheme code, invested, value, first month, last month, instalments)</summary>
          <textarea className={`${cell} mt-1 h-24`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"122640, 940934, 1600734, 2020-02, 2026-07, 71\n151812, 787969, 741958, 2026-02, 2026-02, 1"} />
          <button type="button" className={`${btn} mt-1`} onClick={importPaste} disabled={!paste.trim()}>Add pasted funds</button>
        </details>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <p className={`${hint} mb-1`}>Invested = total money put in (₹). Value today = current market value (₹). Pick the first and last month of investing: the same month means a one-time purchase, and an empty &quot;to&quot; means still investing (a Systematic Investment Plan, SIP). Instalments = number of purchases, e.g. 36 for a 3-year monthly SIP.</p>
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">{["Code", "Fund", "Invested (₹)", "Value today (₹)", "Invested from → to (month)", "Instalments", ""].map((h) => <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.code}>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">{r.code}</td>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={r.name} placeholder="(from Fund Horizon)" onChange={(e) => patch(i, { name: e.target.value })} /></td>
                {(["invested", "value"] as const).map((k) => <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={r[k]} placeholder={k === "invested" ? "e.g. 500000" : "e.g. 612000"} onChange={(e) => patch(i, { [k]: e.target.value })} /></td>)}
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><div className="flex items-center gap-1">
                  <input type="month" aria-label="First investment month" className={cell} value={r.from} max={date.slice(0, 7)} onChange={(e) => patch(i, { from: e.target.value })} />
                  <span aria-hidden>→</span>
                  <input type="month" aria-label="Last investment month (leave empty if still investing)" className={cell} value={r.to} min={r.from || undefined} max={date.slice(0, 7)} onChange={(e) => patch(i, { to: e.target.value })} />
                </div>{r.from && <div className={`${hint} px-1`}>{periodLabel(r.from, r.to)}</div>}</td>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} inputMode="numeric" value={r.inst} placeholder="e.g. 36" onChange={(e) => patch(i, { inst: e.target.value })} /></td>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5"><button type="button" aria-label={`Remove ${r.code}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <details><summary className="cursor-pointer text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE]">Optional: same-instalment comparison data (JSON, computed from the client&apos;s Consolidated Account Statement, CAS)</summary>
        <p className={`${hint} mt-1`}>portfolio_xirr = Extended Internal Rate of Return (annualised return on dated investments); nifty50_xirr and nifty500_xirr = the same instalments invested in those indices; ahead_inr_500 and ahead_inr_50 = rupees ahead of the Nifty 500 Total Return Index and the Nifty 50; per_fund = each fund&apos;s lead in % and ₹.</p>
        <textarea className={`${cell} mt-1 h-24`} value={compare} onChange={(e) => setCompare(e.target.value)} placeholder='{"portfolio_xirr":10.42,"nifty50_xirr":5.62,"nifty500_xirr":8.31,"ahead_inr_500":449011,"ahead_inr_50":980886,"funds_ahead_50":22,"per_fund":{"122640":{"pct":3.0,"inr":170029}}}' />
      </details>
      <div className="flex flex-wrap items-center gap-3 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
        <button type="button" className={btn} onClick={download} disabled={busy !== null || !rows.length}>{busy === "pdf" ? "Building…" : "⬇ Download PDF"}</button>
        <button type="button" className={btnPrimary} onClick={push} disabled={busy !== null || !rows.length || !customerId} title={customerId ? undefined : "Select a client above first"}>{busy === "push" ? "Saving…" : `Save to ${customerName ?? "client"} CRM`}</button>
        <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email the PDF to the client</label>
        {!customerId && <span className="text-[12.5px] text-[#9A6700] dark:text-[#F5C451]">Select a Client / Household above to save.</span>}
      </div>
      {msg && <p role="status" className={`text-[13px] ${msg.ok ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>{msg.text}</p>}
    </div>
  );
}
