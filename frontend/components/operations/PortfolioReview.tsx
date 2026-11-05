"use client";

import React, { useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

interface Row { code: string; name: string; invested: string; value: string; period: string; inst: string }
interface Hit { id: string; title: string }

const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-1.5 py-1 text-[12.5px] tabular-nums";
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const today = () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

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
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
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
  const search = () => q.trim().length > 1 && run("search", async () => {
    const d = await call<{ results: { scope: string; id: string; title: string }[] }>(`/api/backoffice/search?q=${encodeURIComponent(q.trim())}`);
    setHits(d.results.filter((r) => r.scope === "mutual_funds" && /Regular/.test(r.title)).slice(0, 8));
  });
  const add = (h: Hit) => { setRows((r) => (r.some((x) => x.code === h.id) ? r : [...r, { code: h.id, name: h.title, invested: "", value: "", period: "", inst: "" }])); setHits([]); setQ(""); };
  const importPaste = () => {
    const parsed = paste.split("\n").map((l) => l.split(/[,\t]/).map((c) => c.trim().replace(/[₹]/g, ""))).filter((c) => /^\d{4,8}$/.test(c[0] ?? ""))
      .map((c) => ({ code: c[0], name: "", invested: c[1] ?? "", value: c[2] ?? "", period: c[3] ?? "", inst: c[4] ?? "" }));
    setRows((r) => [...r, ...parsed.filter((p) => !r.some((x) => x.code === p.code))]); setPaste("");
  };
  const body = () => {
    const holdings = rows.map((r) => ({ code: r.code, name: r.name.replace(/ - (Regular|Direct) Plan.*$/, ""), invested: Number(r.invested.replace(/,/g, "")), value: Number(r.value.replace(/,/g, "")), period: r.period, inst: r.inst }));
    if (!name.trim() || !holdings.length || holdings.some((h) => !(h.invested >= 0) || !(h.value >= 0) || Number.isNaN(h.invested) || Number.isNaN(h.value))) throw new Error("Enter the client name and, for every fund, the invested amount and today's value.");
    return { client: { name: name.trim(), date }, holdings, compare: compare.trim() ? JSON.parse(compare) : null };
  };
  const json = { method: "POST", headers: { "Content-Type": "application/json" } };
  const download = () => run("pdf", async () => {
    const blob = await call<Blob>("/api/backoffice/portfolio-review/pdf", { ...json, body: JSON.stringify(body()) }, true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `Portfolio Review - ${name} - ${date}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  });
  const push = () => customerId && run("push", async () => {
    const r = await call<{ emailed: boolean }>("/api/backoffice/portfolio-review/push", { ...json, body: JSON.stringify({ customer_id: customerId, review: body(), send_email: email }) });
    setMsg({ ok: true, text: r.emailed ? "Saved to the client's CRM record and emailed." : "Saved to the client's CRM record." });
  });

  return (
    <div className={`${card} space-y-4 p-5`}>
      <div>
        <h2 className="text-lg font-bold">Portfolio review — your portfolio vs the market</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Add the funds the client holds with the amount invested and today&apos;s value. Fund Horizon adds live NAV dates, FH scores and signals, capture ratios, falls, recommendations and a stress test. The same-instalment index slides appear only when comparison data is supplied below.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[12px] font-semibold">Client name<input className={`${cell} mt-1`} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-[12px] font-semibold">Valuation date<input className={`${cell} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div>
        <div className="flex gap-2">
          <input className={cell} placeholder="Search a fund by name or scheme code, then pick the Regular plan" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button type="button" className={btn} onClick={search} disabled={busy !== null}>Search</button>
        </div>
        {hits.map((h) => <button key={h.id} type="button" className="mt-1 block w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-left text-[12.5px] hover:border-[#006F64]" onClick={() => add(h)}>{h.title} · {h.id}</button>)}
        <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE]">Paste many funds (scheme code, invested, value, period, instalments)</summary>
          <textarea className={`${cell} mt-1 h-24`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="122640, 940934, 1600734, Feb-20 – Jul-26, 71" />
          <button type="button" className={`${btn} mt-1`} onClick={importPaste} disabled={!paste.trim()}>Add pasted funds</button>
        </details>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">{["Code", "Fund", "Invested (₹)", "Value today (₹)", "Period", "Instal.", ""].map((h) => <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.code}>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">{r.code}</td>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={r.name} placeholder="(from Fund Horizon)" onChange={(e) => patch(i, { name: e.target.value })} /></td>
                {(["invested", "value"] as const).map((k) => <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={r[k]} onChange={(e) => patch(i, { [k]: e.target.value })} /></td>)}
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={r.period} onChange={(e) => patch(i, { period: e.target.value })} /></td>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={r.inst} onChange={(e) => patch(i, { inst: e.target.value })} /></td>
                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5"><button type="button" aria-label={`Remove ${r.code}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <details><summary className="cursor-pointer text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE]">Optional: same-instalment comparison data (JSON from the CAS computation)</summary>
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
