"use client";

import React, { useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

interface Row { name: string; folio: string; invested: number; investments: number; div_reinv: number; div_payout: number; units: number; nav: number; value: number; ann_ret: number; weight: number; abs_ret: number }
interface Fact { source: string; items: { label: string; value: string }[] }
interface Report { client: { name: string; date: string; arn: string; phone: string }; xirr: number | null; rows: Row[]; factsheets: Fact[] }

const NUM_COLS = ["invested", "investments", "div_reinv", "div_payout", "units", "nav", "value", "ann_ret"] as const;
const HEAD = ["#", "Fund name", "Folio", "Total invested (A+B)", "Investments (A)", "Div. reinvested (B)", "Div. payout", "Units", "NAV", "Market value", "Weight %", "Abs. ret %", "Ann. ret %"];
const inr = (v: number, d = 2) => v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-1.5 py-1 text-[12.5px] tabular-nums";
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";

async function call<T>(path: string, init: RequestInit, blob = false): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/backoffice/client-report${path}`), { credentials: "include", ...init });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

export default function ClientReport({ customerId, customerName }: { customerId?: string; customerName?: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [email, setEmail] = useState(true);

  const totals = (() => {
    const rows = report?.rows ?? [];
    const invested = rows.reduce((s, r) => s + r.invested, 0), value = rows.reduce((s, r) => s + r.value, 0);
    return { invested, value, gain: value - invested, abs: invested ? (value / invested - 1) * 100 : 0 };
  })();
  const patchRow = (i: number, p: Partial<Row>) => setReport((r) => r && { ...r, rows: r.rows.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); } finally { setBusy(null); }
  };

  const upload = (files: FileList | null) => files?.length && run("parse", async () => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const d = await call<Report & { warnings: string[] }>("/parse", { method: "POST", body: fd });
    setWarnings(d.warnings);
    if (d.rows.length) setReport(d);
    else setMsg({ ok: false, text: "No fund statement rows found. Upload a folio-wise valuation / fund statement." });
  });
  const download = () => report && run("pdf", async () => {
    const blob = await call<Blob>("/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }, true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Portfolio Valuation Report - ${report.client.name} - ${report.client.date}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const push = () => report && customerId && run("push", async () => {
    const r = await call<{ emailed: boolean }>("/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, report, send_email: email }) });
    setMsg({ ok: true, text: r.emailed ? "Saved to the client's CRM record and emailed." : "Saved to the client's CRM record." });
  });

  return (
    <div className="space-y-4">
      <div className={`${card} p-5`}>
        <h2 className="text-lg font-bold">Client report — monthly portfolio valuation</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Upload fund statements and MF / PMS factsheets (PDF or scanned image). Text is read directly, or by built-in OCR for scans. Check the values, edit if needed, then download or push to the client.</p>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#006F64] px-3.5 py-2 text-[13.5px] font-bold text-[#006F64] dark:text-[#75E1CE]">
          {busy === "parse" ? "Reading…" : "⬆ Upload statements & factsheets"}
          <input type="file" multiple accept="application/pdf,image/png,image/jpeg" className="hidden" disabled={busy !== null} onChange={(e) => { const f = e.target.files; upload(f); e.target.value = ""; }} />
        </label>
        {warnings.map((w) => <p key={w} className="mt-2 text-[12.5px] text-[#9A6700] dark:text-[#F5C451]">{w}</p>)}
        {msg && <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>{msg.text}</p>}
      </div>

      {report && (
        <div className={`${card} space-y-4 p-5`}>
          <div className="grid gap-3 sm:grid-cols-5">
            {([["Client name", "name"], ["Report date", "date"], ["ARN", "arn"], ["Phone", "phone"]] as const).map(([label, k]) => (
              <label key={k} className="text-[12px] font-semibold">{label}
                <input className={`${cell} mt-1`} value={report.client[k]} onChange={(e) => setReport({ ...report, client: { ...report.client, [k]: e.target.value } })} />
              </label>
            ))}
            <label className="text-[12px] font-semibold">XIRR %
              <input className={`${cell} mt-1`} inputMode="decimal" value={report.xirr ?? ""} onChange={(e) => setReport({ ...report, xirr: e.target.value === "" || isNaN(+e.target.value) ? null : +e.target.value })} />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            {([["Invested amount", `₹${inr(totals.invested)}`], ["Current value", `₹${inr(totals.value)}`], ["Unrealised gain / (loss)", `₹${inr(totals.gain)}`], ["Absolute return", `${inr(totals.abs)}%`]]).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">{k}</div><div className="text-[17px] font-bold tabular-nums">{v}</div></div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-[12.5px]">
              <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">{HEAD.map((h) => <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1.5 text-center font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{i + 1}</td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} /></td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={r.folio} onChange={(e) => patchRow(i, { folio: e.target.value })} /></td>
                    {NUM_COLS.slice(0, 7).map((k) => (
                      <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={r[k]} onChange={(e) => !isNaN(+e.target.value) && patchRow(i, { [k]: e.target.value === "" ? 0 : +e.target.value })} /></td>
                    ))}
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{totals.value ? inr((r.value / totals.value) * 100) : "-"}</td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{r.invested ? inr((r.value / r.invested - 1) * 100) : "-"}</td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={r.ann_ret} onChange={(e) => !isNaN(+e.target.value) && patchRow(i, { ann_ret: e.target.value === "" ? 0 : +e.target.value })} /></td>
                  </tr>
                ))}
                <tr className="bg-[#F3F6FC] dark:bg-[#1B2432] font-bold">
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5" colSpan={3}>Grand Total</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(totals.invested)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(report.rows.reduce((s, r) => s + r.investments, 0))}</td>
                  <td colSpan={4} className="border border-[#E4E9EF] dark:border-[#2B3644]" />
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(totals.value)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">100.00</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(totals.abs)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{report.xirr ?? "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {report.factsheets.map((f, fi) => (
            <div key={fi}>
              <h3 className="text-[13.5px] font-bold">Factsheet highlights — {f.source}</h3>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                {f.items.map((it, ii) => (
                  <div key={ii} className="flex items-center gap-2"><span className="w-40 shrink-0 text-[12.5px]">{it.label}</span>
                    <input className={cell} value={it.value} onChange={(e) => setReport({ ...report, factsheets: report.factsheets.map((x, a) => (a === fi ? { ...x, items: x.items.map((y, b) => (b === ii ? { ...y, value: e.target.value } : y)) } : x)) })} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
            <button type="button" className={btn} onClick={download} disabled={busy !== null}>{busy === "pdf" ? "Building…" : "⬇ Download PDF"}</button>
            <button type="button" className={btnPrimary} onClick={push} disabled={busy !== null || !customerId} title={customerId ? undefined : "Select a client above first"}>
              {busy === "push" ? "Pushing…" : `Push to ${customerName ?? "client"} CRM`}
            </button>
            <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email the PDF to the client</label>
            {!customerId && <span className="text-[12.5px] text-[#9A6700] dark:text-[#F5C451]">Select a Client / Household above to push.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
