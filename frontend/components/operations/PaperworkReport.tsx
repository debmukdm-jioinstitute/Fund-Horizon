"use client";

import React, { useEffect, useMemo, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";
import { fetchHouseholdDetail, fetchHouseholds, type Household, type HouseholdDetail } from "@/lib/crmApi";

interface Bucket { name: string; invested: number; current: number; xirr: number | null }
interface Pms { invested: number; current: number; xirr: number | null }
interface Fact { source: string; items: { label: string; value: string }[] }
interface Valuation { invested: number; value: number; gain: number; xirr: number | null; date: string; rows: number }
interface HistoryRow { id: string; report_month: string; value_as_on: string; emailed_at: string | null; created_at: string }
interface Report {
  client: { name: string; date: string; arn: string; phone: string };
  month: string; inception: string; total_xirr: number | null;
  buckets: Bucket[]; pms: Pms; factsheets: Fact[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const inr = (v: number, d = 0) => v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-1.5 py-1 text-[12.5px] tabular-nums";
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";

async function call<T>(path: string, init: RequestInit, blob = false): Promise<T> {
  const res = await fetch(resolveApiUrl(`${API_URL}/api/backoffice/monthly-report${path}`), { credentials: "include", ...init });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* keep default */ }
    throw new ApiError(msg, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

function totals(buckets: Bucket[], pms: Pms) {
  const invested = buckets.reduce((s, b) => s + b.invested, 0);
  const current = buckets.reduce((s, b) => s + b.current, 0);
  const gain = current - invested;
  const compInvested = invested + pms.invested;
  const compCurrent = current + pms.current;
  return {
    invested, current, gain,
    weights: buckets.map((b) => (current ? (b.current / current) * 100 : 0)),
    mfWeight: compCurrent ? (current / compCurrent) * 100 : 0,
    pmsWeight: compCurrent ? (pms.current / compCurrent) * 100 : 0,
    pmsGain: pms.current - pms.invested,
    compInvested, compCurrent, compGain: compCurrent - compInvested,
  };
}

function payload(report: Report) {
  return {
    ...report,
    buckets: report.buckets.map((b) => ({ name: b.name, invested: b.invested, current: b.current, xirr: b.xirr })),
  };
}

function filename(report: Report) {
  return `${report.client.name} Monthly report ${report.month}`.replace(/[^\w.\- ]/g, "_") + ".pdf";
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function PaperworkReport() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [hhId, setHhId] = useState("");
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [email, setEmail] = useState(true);
  const [monthPick, setMonthPick] = useState(() => {
    const d = new Date();
    return { month: d.getMonth(), year: d.getFullYear() };
  });

  const member = detail ? detail.members.find((x) => x.role === "primary") ?? detail.members[0] : undefined;
  const customerId = member?.customer_id;
  const customerEmail = member?.email ?? null;
  const t = useMemo(() => (report ? totals(report.buckets, report.pms) : null), [report]);

  useEffect(() => { fetchHouseholds().then(setHouseholds).catch(() => undefined); }, []);
  useEffect(() => {
    let live = true;
    setDetail(null); setReport(null); setValuation(null); setHistory([]); setWarnings([]);
    if (!hhId) return;
    fetchHouseholdDetail(hhId).then((d) => { if (live) setDetail(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [hhId]);

  const loadHistory = () => customerId && call<HistoryRow[]>(`/customers/${customerId}`, {})
    .then(setHistory).catch(() => undefined);
  useEffect(() => { if (customerId) loadHistory(); }, [customerId, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); } finally { setBusy(null); }
  };

  const setMonth = (month: number, year: number) => {
    setMonthPick({ month, year });
    setReport((r) => r && { ...r, month: `${MONTHS[month]} ${year}` });
  };

  const upload = (files: FileList | null) => files?.length && run("parse", async () => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const d = await call<Report & { valuation: Valuation | null; warnings: string[] }>("/parse", { method: "POST", body: fd });
    setWarnings(d.warnings);
    setValuation(d.valuation);
    if (d.buckets.length) {
      const month = `${MONTHS[monthPick.month]} ${monthPick.year}`;
      setReport({
        client: d.client, month, inception: d.inception, total_xirr: d.total_xirr,
        buckets: d.buckets, pms: d.pms, factsheets: d.factsheets,
      });
      if (d.client.date) setMsg({ ok: true, text: "Figures loaded. Check every value before creating the report." });
    } else if (d.valuation) {
      setMsg({ ok: false, text: "No monthly bucket rows found in these files. The valuation total below is a cross-check only. Add bucket rows by hand, or upload last month's monthly report." });
    } else {
      setMsg({ ok: false, text: "No monthly bucket rows, fund statement rows, or factsheet figures found in these files." });
    }
  });

  const startEmpty = () => {
    const month = `${MONTHS[monthPick.month]} ${monthPick.year}`;
    setReport({
      client: { name: detail?.household.name ?? "", date: valuation?.date ?? "", arn: "345439", phone: "" },
      month, inception: "", total_xirr: null,
      buckets: [{ name: "New bucket", invested: 0, current: 0, xirr: null }],
      pms: { invested: 0, current: 0, xirr: null }, factsheets: [],
    });
  };

  const startFromLast = () => customerId && run("latest", async () => {
    const d = await call<{ id: string; report: Report }>(`/customers/${customerId}/latest`, {});
    setReport(d.report);
    setMsg({ ok: true, text: `Loaded the stored ${d.report.month} report as a starting point. Update the month and the figures.` });
  });

  const downloadPdf = () => report && run("pdf", async () => {
    const blob = await call<Blob>("/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(report)) }, true);
    downloadBlob(blob, filename(report));
  });

  const create = () => report && customerId && run("create", async () => {
    const blob = await call<Blob>("/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(report)) }, true);
    downloadBlob(blob, filename(report));
    const r = await call<{ id: string; emailed: boolean; email_error: string | null }>("/push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_id: customerId, household_id: hhId || null, report: payload(report), send_email: email }),
    });
    setMsg({
      ok: true,
      text: r.emailed
        ? "Report downloaded, saved to the client CRM record, and emailed."
        : r.email_error
          ? `Report downloaded and saved to the client CRM record. Email was not sent: ${r.email_error}`
          : "Report downloaded and saved to the client CRM record.",
    });
    loadHistory();
  });

  const reDownload = (id: string, month: string) => run("redownload", async () => {
    const blob = await call<Blob>(`/${id}/pdf`, {}, true);
    downloadBlob(blob, `${report?.client.name ?? detail?.household.name ?? "Client"} Monthly report ${month}.pdf`);
  });

  const patchBucket = (i: number, p: Partial<Bucket>) =>
    setReport((r) => r && { ...r, buckets: r.buckets.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const num = (v: string) => (v === "" || isNaN(+v) ? 0 : +v);

  const checks: string[] = [];
  if (report) {
    if (!report.client.name.trim()) checks.push("Client name is missing.");
    if (!report.month.trim()) checks.push("Report month is missing.");
    if (!report.client.date.trim()) checks.push("Value-as-on date is missing.");
    if (t && t.current === 0) checks.push("Total current value is 0, so weights cannot be worked out.");
    if (valuation && t) {
      const di = t.invested - valuation.invested, dc = t.current - valuation.value;
      if (Math.abs(di) > 0.01 || Math.abs(dc) > 0.01) {
        checks.push(`Valuation file total differs from the bucket total by ₹${inr(di, 2)} invested and ₹${inr(dc, 2)} current. This is expected when part of the portfolio (for example an offline bucket) is not in the valuation file — check the offline and PMS rows.`);
      }
    }
    if (email && !customerEmail) checks.push("Email is ticked but the CRM record has no email address for this client. The report will still be saved and downloaded.");
    if (!customerId) checks.push("Pick a client household above to save the report to the CRM record.");
  }

  return (
    <div className="space-y-4">
      <div className={`${card} p-5`}>
        <h2 className="text-lg font-bold">Paperwork Processing — monthly client report</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">
          Upload PMS factsheets, a folio-wise valuation, or last month&apos;s monthly report. Text is read
          directly, or by built-in OCR for scans. Check the tables, fix any value, then create the report:
          it downloads, is saved to the client CRM record, and can be emailed to the client.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor="ppClient" className="text-[12px] font-bold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">Client / Household</label>
          <select id="ppClient" value={hhId} onChange={(e) => setHhId(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-2 text-[14px] font-semibold">
            <option value="">Pick a client household</option>
            {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <span className={`text-[13.5px] ${ink}`}>
            {member ? <>{member.name}{customerEmail ? <> · {customerEmail}</> : " · no email on file"}</> : "No client picked yet. Changing the client clears the draft."}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#006F64] px-3.5 py-2 text-[13.5px] font-bold text-[#006F64] dark:text-[#75E1CE]">
            {busy === "parse" ? "Reading…" : "⬆ Upload factsheets & valuation files"}
            <input type="file" multiple accept="application/pdf,image/png,image/jpeg" className="hidden" disabled={busy !== null} onChange={(e) => { const f = e.target.files; upload(f); e.target.value = ""; }} />
          </label>
          <button type="button" className={btn} onClick={startFromLast} disabled={busy !== null || !customerId} title={customerId ? undefined : "Pick a client household first"}>
            {busy === "latest" ? "Loading…" : "Start from last month's report"}
          </button>
          <button type="button" className={btn} onClick={startEmpty} disabled={busy !== null}>
            Start with empty buckets
          </button>
        </div>
        {warnings.map((w) => <p key={w} className="mt-2 text-[12.5px] text-[#9A6700] dark:text-[#F5C451]">{w}</p>)}
        {msg && <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>{msg.text}</p>}
        {valuation && (
          <div className="mt-3 rounded-xl bg-[#F8FAFB] dark:bg-[#1B2432] px-3.5 py-2.5 text-[13px]">
            <b>Valuation cross-check</b> ({valuation.date}, {valuation.rows} funds): invested ₹{inr(valuation.invested, 2)} ·
            current ₹{inr(valuation.value, 2)} · XIRR {valuation.xirr ?? "—"}%. This total is not the report —
            it is shown so the difference against the buckets can be checked.
          </div>
        )}
      </div>

      {report && t && (
        <div className={`${card} space-y-4 p-5`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-[12px] font-semibold">Client name
              <input className={`${cell} mt-1`} value={report.client.name} onChange={(e) => setReport({ ...report, client: { ...report.client, name: e.target.value } })} />
            </label>
            <label className="text-[12px] font-semibold">Value as on
              <input className={`${cell} mt-1`} value={report.client.date} placeholder="e.g. 1-09-2026" onChange={(e) => setReport({ ...report, client: { ...report.client, date: e.target.value } })} />
            </label>
            <label className="text-[12px] font-semibold">Inception date
              <input className={`${cell} mt-1`} value={report.inception} placeholder="e.g. 30 Apr 2020" onChange={(e) => setReport({ ...report, inception: e.target.value })} />
            </label>
            <label className="text-[12px] font-semibold">Report month
              <input className={`${cell} mt-1`} value={report.month} onChange={(e) => setReport({ ...report, month: e.target.value })} />
            </label>
            <label className="text-[12px] font-semibold">Total XIRR %
              <input className={`${cell} mt-1`} inputMode="decimal" value={report.total_xirr ?? ""} onChange={(e) => setReport({ ...report, total_xirr: e.target.value === "" || isNaN(+e.target.value) ? null : +e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className={muted}>Month picker:</span>
            <select aria-label="Month" value={monthPick.month} onChange={(e) => setMonth(+e.target.value, monthPick.year)} className={cell} style={{ width: 140 }}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <input aria-label="Year" inputMode="numeric" value={monthPick.year} onChange={(e) => !isNaN(+e.target.value) && setMonth(monthPick.month, +e.target.value || new Date().getFullYear())} className={cell} style={{ width: 90 }} />
            <span className={muted}>Total XIRR is typed in, never worked out as an average of the bucket XIRRs.</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {([["Invested amount", `₹${inr(t.invested)}`], ["Current value", `₹${inr(t.current)}`], ["Gain / loss", `₹${inr(t.gain)}`]]).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5"><div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">{k}</div><div className="text-[17px] font-bold tabular-nums">{v}</div></div>
            ))}
          </div>

          <h3 className="text-[14px] font-bold">PORTFOLIO XIRR</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">{["Bucket", "Invested amount", "Current value", "Gain / loss", "Weightage %", "XIRR %", ""].map((h) => <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1.5 text-center font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {report.buckets.map((b, i) => (
                  <tr key={i}>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={cell} value={b.name} onChange={(e) => patchBucket(i, { name: e.target.value })} /></td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={b.invested} onChange={(e) => patchBucket(i, { invested: num(e.target.value) })} /></td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={b.current} onChange={(e) => patchBucket(i, { current: num(e.target.value) })} /></td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(b.current - b.invested)}</td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{t.weights[i].toFixed(2)}%</td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={b.xirr ?? ""} onChange={(e) => patchBucket(i, { xirr: e.target.value === "" || isNaN(+e.target.value) ? null : +e.target.value })} /></td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-center">
                      <button type="button" className="text-[12px] font-semibold text-[#B42318] dark:text-[#FF7D86] disabled:opacity-40" disabled={report.buckets.length <= 1} onClick={() => setReport({ ...report, buckets: report.buckets.filter((_, j) => j !== i) })}>Remove</button>
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#F3F6FC] dark:bg-[#1B2432] font-bold">
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">Total</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.invested)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.current)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.gain)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">100.00%</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{report.total_xirr ?? "—"}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644]" />
                </tr>
              </tbody>
            </table>
          </div>
          <button type="button" className={btn} onClick={() => setReport({ ...report, buckets: [...report.buckets, { name: "New bucket", invested: 0, current: 0, xirr: null }] })}>+ Add bucket</button>

          <h3 className="text-[14px] font-bold">COMPLETE PORTFOLIO</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">{["", "Invested amount", "Current value", "Gain / loss", "Weightage %", "XIRR %"].map((h) => <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1.5 text-center font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 font-semibold">Mutual funds</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.invested)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.current)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.gain)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{t.mfWeight.toFixed(2)}%</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{report.total_xirr ?? "—"}</td>
                </tr>
                <tr>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 font-semibold">PMS</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={report.pms.invested} onChange={(e) => setReport({ ...report, pms: { ...report.pms, invested: num(e.target.value) } })} /></td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={report.pms.current} onChange={(e) => setReport({ ...report, pms: { ...report.pms, current: num(e.target.value) } })} /></td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.pmsGain)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{t.pmsWeight.toFixed(2)}%</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><input className={`${cell} text-right`} inputMode="decimal" value={report.pms.xirr ?? ""} onChange={(e) => setReport({ ...report, pms: { ...report.pms, xirr: e.target.value === "" || isNaN(+e.target.value) ? null : +e.target.value } })} /></td>
                </tr>
                <tr className="bg-[#F3F6FC] dark:bg-[#1B2432] font-bold">
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">Total</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.compInvested)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.compCurrent)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.compGain)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">100.00%</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{report.total_xirr ?? "—"}</td>
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

          {checks.length > 0 && (
            <div className="rounded-lg border border-[#F5C451] bg-[#FFF8E1] dark:bg-[#332A10] px-3.5 py-2.5 text-[13px]">
              <b>Check before creating:</b>
              <ul className="mt-1 list-disc pl-5">{checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
            <button type="button" className={btnPrimary} onClick={create} disabled={busy !== null || !customerId} title={customerId ? undefined : "Pick a client household first"}>
              {busy === "create" ? "Creating…" : "Create Report"}
            </button>
            <button type="button" className={btn} onClick={downloadPdf} disabled={busy !== null}>{busy === "pdf" ? "Building…" : "⬇ Download PDF only"}</button>
            <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email the PDF to the client</label>
            <span className={`text-[12.5px] ${muted}`}>Create Report downloads the file, then saves it to the client CRM record, then emails it if ticked.</span>
          </div>
        </div>
      )}

      {customerId && history.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="text-[14px] font-bold">Past monthly reports for this client</h3>
          <table className="mt-2 w-full min-w-[520px] text-left text-[13.5px]">
            <thead><tr>{["Month", "Value as on", "Emailed", "Saved"].map((h) => <th key={h} className={`px-2 py-1.5 text-[12px] font-bold uppercase tracking-wider ${muted}`}>{h}</th>)}</tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-[#E4E9EF] dark:border-[#2B3644]">
                  <td className="px-2 py-2 font-semibold">{h.report_month}</td>
                  <td className="px-2 py-2">{h.value_as_on || "—"}</td>
                  <td className="px-2 py-2">{h.emailed_at ? "Yes" : "No"}</td>
                  <td className="px-2 py-2">{new Date(h.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</td>
                  <td className="px-2 py-2"><button type="button" className={btn} onClick={() => reDownload(h.id, h.report_month)} disabled={busy !== null}>Re-download</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
