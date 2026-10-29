"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";
import { fetchHouseholdDetail, fetchHouseholds, type Household, type HouseholdDetail } from "@/lib/crmApi";

interface Bucket { name: string; invested: number; current: number; xirr: number | null }
interface Pms { invested: number; current: number; xirr: number | null; hide?: string[] }
interface Fact { source: string; items: { label: string; value: string; show?: boolean }[] }
interface Valuation { invested: number; value: number; gain: number; xirr: number | null; date: string; rows: number }
interface FileResult { name: string; kind: "monthly" | "valuation" | "statement" | "pms" | "factsheet" | "unrecognised" | "error"; method: "text" | "ocr" | ""; error?: string; buckets: number; valuation_rows: number; factsheet_items: number }
interface StmtFund { name: string; invested: number; current: number; gain: number; ann_ret: number | null; check: string }
interface StmtCategory { name: string; invested: number; current: number; gain: number; ann_ret: number | null; has_total: boolean; funds: StmtFund[] }
interface Statement {
  provider: string; file: string; as_on: string;
  client: { name: string; email: string; mobile: string; pan: string };
  grand_total: { invested: number; current: number; gain: number; abs_ret: number | null; xirr: number | null };
  categories: StmtCategory[];
  pms?: { strategy: string; account: string; inception: string; contribution: number; withdrawal: number; profit: number; value: number; returns: { name: string; values: Record<string, number> }[] };
}
interface StagedFile { id: number; file: File }
interface HistoryRow { id: string; report_month: string; value_as_on: string; emailed_at: string | null; created_at: string }
interface Report {
  client: { name: string; date: string; arn: string; phone: string };
  month: string; inception: string; total_xirr: number | null;
  buckets: Bucket[]; pms: Pms; factsheets: Fact[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const CUSTOM = "__custom__";
const PREFILL = "Valuation total (split into buckets)";
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

function Tick({ on, onClick, what }: { on: boolean; onClick: () => void; what: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={`${on ? "Hide" : "Show"} ${what} in the PDF`} title={on ? "Shown in the PDF — click to hide" : "Hidden from the PDF — click to show"}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[13px] font-bold ${on ? "border-[#006F64] bg-[#E6F4F1] text-[#006F64]" : "border-[#C9D2E3] bg-[#F3F6FC] text-[#B42318] dark:border-[#2B3644] dark:bg-[#1B2432]"}`}>
      {on ? "✓" : "✕"}
    </button>
  );
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
  const [customName, setCustomName] = useState("");
  const [customMobile, setCustomMobile] = useState("");
  const [customEmail, setCustomEmail] = useState("");
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  // After a custom Create switches the picker to the newly created household,
  // keep the just-created report on screen instead of clearing the draft.
  const preserveDraftRef = useRef(false);
  const [report, setReport] = useState<Report | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Staged multi-file upload: files are listed first, then parsed together
  // in ONE call. Re-parsing after adding files merges into the draft instead
  // of replacing it (see parseStaged).
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const nextStagedId = useRef(1);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [email, setEmail] = useState(false);
  const [askEmail, setAskEmail] = useState(false);
  const [monthPick, setMonthPick] = useState(() => {
    const d = new Date();
    return { month: d.getMonth(), year: d.getFullYear() };
  });

  const isCustom = hhId === CUSTOM;
  const member = detail ? detail.members.find((x) => x.role === "primary") ?? detail.members[0] : undefined;
  const customerId = isCustom ? undefined : member?.customer_id;
  const customerEmail = isCustom ? (customEmail.trim() || null) : member?.email ?? null;
  const canCreate = !!(report && (customerId || (isCustom && customName.trim())));
  const t = useMemo(() => (report ? totals(report.buckets, report.pms) : null), [report]);

  useEffect(() => { fetchHouseholds().then(setHouseholds).catch(() => undefined); }, []);
  useEffect(() => {
    let live = true;
    const preserve = preserveDraftRef.current;
    preserveDraftRef.current = false;
    setDetail(null); setHistory([]);
    if (!preserve) { setReport(null); setValuation(null); setWarnings([]); setFileResults([]); setStatements([]); }
    if (!hhId || isCustom) return;
    fetchHouseholdDetail(hhId).then((d) => { if (live) setDetail(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [hhId, isCustom]);

  const loadHistory = () => customerId && call<HistoryRow[]>(`/customers/${customerId}`, {})
    .then(setHistory).catch(() => undefined);
  useEffect(() => { if (customerId) loadHistory(); }, [customerId, detail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Custom name / mobile are the source of truth in custom mode: keep the
  // report's client fields in step with them.
  const setCustomNameAndReport = (v: string) => {
    setCustomName(v);
    setReport((r) => r && { ...r, client: { ...r.client, name: v } });
  };
  const setCustomMobileAndReport = (v: string) => {
    setCustomMobile(v);
    setReport((r) => r && { ...r, client: { ...r.client, phone: v } });
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); } finally { setBusy(null); }
  };

  const setMonth = (month: number, year: number) => {
    setMonthPick({ month, year });
    setReport((r) => r && { ...r, month: `${MONTHS[month]} ${year}` });
  };

  // Takes a File[] snapshot: the input's FileList is live and is emptied by `e.target.value = ""`
  // before React runs this updater, which left multi-file uploads staging nothing.
  const addStaged = (files: File[]) => files.length && setStaged((xs) => {
    // Same file twice is one staged entry (name + size is enough to spot it).
    const fresh = files.filter((f) => !xs.some((s) => s.file.name === f.name && s.file.size === f.size));
    return fresh.length ? [...xs, ...fresh.map((file) => ({ id: nextStagedId.current++, file }))] : xs;
  });

  const resultText = (r: FileResult) => {
    if (r.error) return `failed: ${r.error}`;
    const kind = r.kind === "monthly" ? "monthly report"
      : r.kind === "valuation" ? "valuation (cross-check)"
      : r.kind === "statement" ? "portfolio statement"
      : r.kind === "pms" ? "PMS factsheet"
      : r.kind === "factsheet" ? "factsheet"
      : r.kind === "error" ? "could not be read" : "not recognised";
    const method = r.method === "ocr" ? "read by OCR" : r.method === "text" ? "read from text" : "";
    const count = r.buckets ? `${r.buckets} ${r.kind === "statement" ? "categories" : "buckets"}`
      : r.valuation_rows ? `${r.valuation_rows} funds`
      : r.factsheet_items ? `${r.factsheet_items} figures` : "";
    return [kind, method, count].filter(Boolean).join(" · ");
  };

  const parseStaged = () => staged.length && run("parse", async () => {
    const fd = new FormData();
    staged.forEach((s) => fd.append("files", s.file));
    const d = await call<Report & { valuation: Valuation | null; warnings: string[]; file_results: FileResult[]; statements: Statement[]; contact: Statement["client"] }>("/parse", { method: "POST", body: fd });
    setWarnings(d.warnings);
    setFileResults(d.file_results ?? []);
    setStatements((prev) => [...prev.filter((p) => !d.statements.some((n) => n.file === p.file)), ...d.statements]);
    // Keep the previous valuation when the new batch has none — a monthly-only
    // file must not wipe the cross-check, and vice versa.
    if (d.valuation) setValuation(d.valuation);
    const hasPms = d.pms.invested !== 0 || d.pms.current !== 0;
    if (d.buckets.length || hasPms) {
      const month = `${MONTHS[monthPick.month]} ${monthPick.year}`;
      const isPrefill = (bs: Bucket[]) => bs.length === 1 && bs[0].name === PREFILL;
      if (!report) {
        // Custom mode: a typed custom name always wins over the file header
        // name; when nothing is typed yet, prefill the custom name from the
        // file. The file header phone is never used as the client phone in
        // custom mode — it is the firm's number, not the client's.
        const client = isCustom
          ? { ...d.client, name: customName.trim() || d.client.name, phone: customMobile }
          : d.client;
        if (isCustom && !customName.trim() && d.client.name) setCustomName(d.client.name);
        setReport({
          client, month, inception: d.inception, total_xirr: d.total_xirr,
          buckets: d.buckets.length ? d.buckets : [{ name: "New bucket", invested: 0, current: 0, xirr: null }],
          pms: d.pms, factsheets: d.factsheets,
        });
        setMsg({
          ok: true,
          text: isPrefill(d.buckets)
            ? "Valuation total loaded as a single bucket. Split it into buckets, then check every value before creating the report."
            : "Figures loaded. Check every value before creating the report.",
        });
      } else {
        // Merge into the existing draft, never replace it: manual bucket
        // edits stay, new buckets are added only when their name is new, a
        // real monthly report replaces the valuation-total placeholder, the
        // placeholder never lands on top of real buckets, factsheets are
        // appended without duplicates, and empty client/date/inception
        // fields are the only ones filled in.
        if (isCustom && !customName.trim() && d.client.name) setCustomName(d.client.name);
        setReport((prev) => {
          if (!prev) return prev;
          let buckets: Bucket[];
          if (!d.buckets.length) buckets = prev.buckets;
          else if (prev.buckets.length === 0 || isPrefill(prev.buckets)) buckets = d.buckets;
          else if (isPrefill(d.buckets)) buckets = prev.buckets;
          else {
            const names = new Set(prev.buckets.map((b) => b.name));
            buckets = [...prev.buckets, ...d.buckets.filter((b) => !names.has(b.name))];
          }
          // All staged files are parsed together, so a PMS factsheet in this batch already holds the full PMS total.
          const pms = (d.statements.some((x) => x.pms) || (prev.pms.invested === 0 && prev.pms.current === 0)) ? d.pms : prev.pms;
          const sources = new Set(prev.factsheets.map((f) => f.source));
          const factsheets = [...prev.factsheets, ...d.factsheets.filter((f) => !sources.has(f.source))];
          const client = {
            ...prev.client,
            name: prev.client.name.trim() ? prev.client.name : d.client.name,
            date: prev.client.date.trim() ? prev.client.date : d.client.date,
            arn: prev.client.arn || d.client.arn,
          };
          const merged: Report = {
            ...prev,
            client,
            inception: prev.inception || d.inception,
            // A combined portfolio's XIRR is not an average: clear it when statements join an existing draft.
            total_xirr: d.statements.length ? null : prev.total_xirr ?? d.total_xirr,
            buckets, pms, factsheets,
          };
          if (isCustom) merged.client = { ...merged.client, name: customName.trim() || merged.client.name, phone: customMobile };
          return merged;
        });
        setMsg({ ok: true, text: "Merged into the existing draft — manual edits were kept. Check every value before creating the report." });
      }
      // Scraped name / email / mobile fill the client form; with no client picked yet, switch to a custom client.
      const c = d.contact;
      if (c && (c.name || c.email || c.mobile) && (!hhId || isCustom)) {
        if (!hhId) { preserveDraftRef.current = true; setHhId(CUSTOM); }
        if (!customName.trim() && c.name) setCustomNameAndReport(c.name);
        if (!customEmail.trim() && c.email) setCustomEmail(c.email);
        if (!customMobile.trim() && c.mobile) setCustomMobileAndReport(c.mobile);
      }
    } else if (d.valuation) {
      setMsg({ ok: false, text: "No monthly bucket rows found in these files. The valuation total below is a cross-check only. Add bucket rows by hand, or upload last month's monthly report." });
    } else {
      setMsg({ ok: false, text: "No monthly bucket rows, fund statement rows, or factsheet figures found in these files." });
    }
  });

  const startEmpty = () => {
    const month = `${MONTHS[monthPick.month]} ${monthPick.year}`;
    setReport({
      client: { name: isCustom ? customName : detail?.household.name ?? "", date: valuation?.date ?? "", arn: "345439", phone: isCustom ? customMobile : "" },
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

  const create = (sendEmail: boolean) => report && canCreate && run("create", async () => {
    const blob = await call<Blob>("/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(report)) }, true);
    downloadBlob(blob, filename(report));
    const body = isCustom
      ? { customer_id: null, custom_client: { name: customName.trim(), mobile: customMobile.trim(), email: customEmail.trim() }, household_id: null, report: payload(report), send_email: sendEmail }
      : { customer_id: customerId, household_id: hhId || null, report: payload(report), send_email: sendEmail };
    const r = await call<{ id: string; emailed: boolean; email_error: string | null; customer_id: string; household_id: string; matched_existing: boolean }>("/push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const savedText = "saved to the client CRM record";
    setMsg({
      ok: true,
      text: (r.emailed
        ? `Report downloaded, ${savedText}, and emailed.`
        : r.email_error
          ? `Report downloaded and ${savedText}. Email was not sent: ${r.email_error}`
          : `Report downloaded and ${savedText}.`)
        + (isCustom && r.matched_existing ? " An existing CRM record was matched — no duplicate was created." : "")
        + (isCustom && !r.matched_existing ? " The custom client was created as a CRM customer + household record." : ""),
    });
    if (isCustom && r.household_id) {
      // Switch the picker to the new household so its history shows at once.
      // The draft is preserved (see preserveDraftRef), not cleared.
      fetchHouseholds().then(setHouseholds).catch(() => undefined);
      preserveDraftRef.current = true;
      setHhId(r.household_id);
    } else {
      loadHistory();
    }
  });

  const reDownload = (id: string, month: string) => run("redownload", async () => {
    const blob = await call<Blob>(`/${id}/pdf`, {}, true);
    downloadBlob(blob, `${report?.client.name ?? detail?.household.name ?? "Client"} Monthly report ${month}.pdf`);
  });

  const patchBucket = (i: number, p: Partial<Bucket>) =>
    setReport((r) => r && { ...r, buckets: r.buckets.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const patchItem = (fi: number, ii: number, p: Partial<Fact["items"][number]>) =>
    setReport((r) => r && { ...r, factsheets: r.factsheets.map((x, a) => (a === fi ? { ...x, items: x.items.map((y, b) => (b === ii ? { ...y, ...p } : y)) } : x)) });
  const togglePms = (k: string) =>
    setReport((r) => r && { ...r, pms: { ...r.pms, hide: r.pms.hide?.includes(k) ? r.pms.hide.filter((h) => h !== k) : [...(r.pms.hide ?? []), k] } });
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
    if (email && isCustom && !customEmail.trim()) checks.push("Email is ticked and no email was entered — it will only be sent if the matched CRM record has an email address. The report will still be saved and downloaded.");
    if (email && !isCustom && !customerEmail) checks.push("Email is ticked but the CRM record has no email address for this client. The report will still be saved and downloaded.");
    if (isCustom && !customName.trim()) checks.push("Enter a client name below for the custom client. Name is the only required detail.");
    if (!isCustom && !customerId) checks.push("Pick a client household above to save the report to the CRM record.");
  }

  return (
    <div className="space-y-4">
      <div className={`${card} p-5`}>
        <h2 className="text-lg font-bold">Paperwork Processing — monthly client report</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">
          Stage PMS factsheets, FundsIndia or Proaffluence portfolio statements, a folio-wise valuation, or last month&apos;s monthly report, then parse
          them together. Text is read directly, or by built-in OCR for scans — each staged file shows
          whether it was read by OCR or from text. Check the tables, fix any value, then create the
          report: it downloads, is saved to the client CRM record, and can be emailed to the client.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor="ppClient" className="text-[12px] font-bold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">Client / Household</label>
          <select id="ppClient" value={hhId} onChange={(e) => setHhId(e.target.value)}
            className="min-w-[220px] flex-1 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-2 text-[14px] font-semibold">
            <option value="">Pick a client household</option>
            <option value={CUSTOM}>Custom client — enter details</option>
            {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <span className={`text-[13.5px] ${ink}`}>
            {isCustom
              ? <>{customName.trim() || "Custom client — enter the name below"}{customEmail.trim() ? <> · {customEmail.trim()}</> : " · no email entered"}</>
              : member ? <>{member.name}{customerEmail ? <> · {customerEmail}</> : " · no email on file"}</> : "No client picked yet. Changing the client clears the draft."}
          </span>
        </div>
        {isCustom && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-[12px] font-semibold">Client name *
              <input className={`${cell} mt-1`} value={customName} onChange={(e) => setCustomNameAndReport(e.target.value)} placeholder="e.g. Satish Nandlal Vora" aria-required="true" />
            </label>
            <label className="text-[12px] font-semibold">Mobile (optional)
              <input className={`${cell} mt-1`} value={customMobile} onChange={(e) => setCustomMobileAndReport(e.target.value)} inputMode="tel" placeholder="Optional" />
            </label>
            <label className="text-[12px] font-semibold">Email (optional)
              <input className={`${cell} mt-1`} type="email" value={customEmail} onChange={(e) => setCustomEmail(e.target.value)} placeholder="Optional — needed only if email is ticked" />
            </label>
          </div>
        )}
        {isCustom && (
          <p className={`mt-2 text-[12.5px] ${muted}`}>A custom client becomes a CRM customer + household record (household named as entered, new customer as primary member). It does not get a portal login unless separately invited.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#006F64] px-3.5 py-2 text-[13.5px] font-bold text-[#006F64] dark:text-[#75E1CE]">
            {busy === "parse" ? "Reading…" : "⬆ Add files to stage"}
            <input type="file" multiple className="hidden" disabled={busy !== null} onChange={(e) => { addStaged(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </label>
          <button type="button" className={btnPrimary} onClick={parseStaged} disabled={busy !== null || staged.length === 0}>
            {busy === "parse" ? "Reading…" : `Parse staged files (${staged.length})`}
          </button>
          <button type="button" className={btn} onClick={() => setStaged([])} disabled={busy !== null || staged.length === 0}>
            Clear staged files
          </button>
          <button type="button" className={btn} onClick={startFromLast} disabled={busy !== null || !customerId} title={isCustom ? "Create a report for this custom client first — it will then appear as a household" : customerId ? undefined : "Pick a client household first"}>
            {busy === "latest" ? "Loading…" : "Start from last month's report"}
          </button>
          <button type="button" className={btn} onClick={startEmpty} disabled={busy !== null}>
            Start with empty buckets
          </button>
        </div>
        {staged.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px]">
            {staged.map((s) => {
              const r = fileResults.find((x) => x.name === s.file.name);
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{s.file.name} ({Math.round(s.file.size / 1024)} KB){r ? ` — ${resultText(r)}` : ""}</span>
                  <button type="button" aria-label={`Remove ${s.file.name}`} className="rounded px-1.5 py-0.5 text-[12px] font-bold hover:bg-[#F3F6FC] dark:hover:bg-[#2B3644]" onClick={() => setStaged((xs) => xs.filter((x) => x.id !== s.id))} disabled={busy !== null}>✕</button>
                </li>
              );
            })}
          </ul>
        )}
        {warnings.length > 0 && (
          <div role="alert" className="mt-3 rounded-xl border border-[#E8B84B] bg-[#FFF8E6] px-3.5 py-2.5 text-[13px] dark:border-[#8A6A1A] dark:bg-[#2A2210]">
            <b>Check these before creating the report:</b>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}
        {msg && <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>{msg.text}</p>}
        {statements.map((st) => (
          <div key={st.file} className="mt-3 rounded-xl bg-[#F8FAFB] dark:bg-[#1B2432] px-3.5 py-2.5 text-[13px]">
            <b>{st.provider} statement</b> <span className={muted}>({st.file}{st.as_on ? `, as on ${st.as_on}` : ""})</span>
            <div className="mt-1">
              {st.client.name || "Name not found"} · {st.client.email || "no email found"} · {st.client.mobile || "no mobile found"}{st.client.pan ? ` · PAN ${st.client.pan}` : ""}
            </div>
            <div className="mt-1 tabular-nums">
              <b>{st.categories.length ? "Statement total" : "Grand total"}:</b> invested ₹{inr(st.grand_total.invested)} · current ₹{inr(st.grand_total.current)} · gain ₹{inr(st.grand_total.gain)}
              {st.grand_total.abs_ret != null ? ` (${st.grand_total.abs_ret.toFixed(2)}%)` : ""}{st.grand_total.xirr != null ? ` · XIRR ${st.grand_total.xirr}%` : ""}
            </div>
            {st.pms && (
              <div className="mt-2 overflow-x-auto">
                <div className="tabular-nums">
                  {st.pms.strategy}{st.pms.account ? ` · account ${st.pms.account}` : ""}{st.pms.inception ? ` · since ${st.pms.inception}` : ""} ·
                  <b> contribution ₹{inr(st.pms.contribution)}</b> · withdrawal ₹{inr(st.pms.withdrawal)} · profit ₹{inr(st.pms.profit)} ·
                  <b> portfolio value ₹{inr(st.pms.value)}</b> (as on {st.as_on})
                </div>
                {st.pms.returns.length > 0 && (
                  <table className="mt-1 min-w-[420px] border-collapse text-[12.5px] tabular-nums">
                    <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]"><th className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1 text-left font-semibold">IRR %</th>{Object.keys(st.pms.returns[0].values).map((k) => <th key={k} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1 text-right font-semibold">{k}</th>)}</tr></thead>
                    <tbody>{st.pms.returns.map((r) => <tr key={r.name}><td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">{r.name}</td>{Object.entries(r.values).map(([k, v]) => <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{v}</td>)}</tr>)}</tbody>
                  </table>
                )}
              </div>
            )}
            {st.categories.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[12.5px] tabular-nums">
                  <thead><tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">{["Category / fund", "Invested", "Current", "Gain / loss", "Ann. return %"].map((h) => <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    {st.categories.map((c) => (
                      <React.Fragment key={c.name}>
                        <tr className="bg-[#F3F6FC] dark:bg-[#1B2432] font-bold">
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">{c.name}{c.has_total ? "" : " (sum of funds read)"}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{inr(c.invested)}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{inr(c.current)}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{inr(c.gain)}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{c.ann_ret ?? "—"}</td>
                        </tr>
                        {c.funds.map((f, i) => (
                          <tr key={i}>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 pl-4">{f.name}{f.check !== "ok" ? " ⚠ check" : ""}</td>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{inr(f.invested)}</td>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{inr(f.current)}</td>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{inr(f.gain)}</td>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right">{f.ann_ret ?? "—"}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
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
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><div className="flex items-center gap-1"><input className={`${cell} text-right`} inputMode="decimal" value={report.pms.invested} onChange={(e) => setReport({ ...report, pms: { ...report.pms, invested: num(e.target.value) } })} /><Tick on={!report.pms.hide?.includes("invested")} what="PMS invested" onClick={() => togglePms("invested")} /></div></td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><div className="flex items-center gap-1"><input className={`${cell} text-right`} inputMode="decimal" value={report.pms.current} onChange={(e) => setReport({ ...report, pms: { ...report.pms, current: num(e.target.value) } })} /><Tick on={!report.pms.hide?.includes("current")} what="PMS current" onClick={() => togglePms("current")} /></div></td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(t.pmsGain)}</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{t.pmsWeight.toFixed(2)}%</td>
                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5"><div className="flex items-center gap-1"><input className={`${cell} text-right`} inputMode="decimal" value={report.pms.xirr ?? ""} onChange={(e) => setReport({ ...report, pms: { ...report.pms, xirr: e.target.value === "" || isNaN(+e.target.value) ? null : +e.target.value } })} /><Tick on={!report.pms.hide?.includes("xirr")} what="PMS xirr" onClick={() => togglePms("xirr")} /></div></td>
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
                    <input className={cell} value={it.value} onChange={(e) => patchItem(fi, ii, { value: e.target.value })} />
                    <Tick on={it.show !== false} what={it.label} onClick={() => patchItem(fi, ii, { show: it.show === false })} />
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
            <button type="button" className={btnPrimary} onClick={() => (email ? create(true) : setAskEmail(true))} disabled={busy !== null || !canCreate} title={canCreate ? undefined : isCustom ? "Enter a custom client name first" : "Pick a client household first"}>
              {busy === "create" ? "Creating…" : "Create Report"}
            </button>
            <button type="button" className={btn} onClick={downloadPdf} disabled={busy !== null}>{busy === "pdf" ? "Building…" : "⬇ Download PDF only"}</button>
            <label className="inline-flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email the PDF to the client</label>
            <span className={`text-[12.5px] ${muted}`}>Create Report downloads the file, then saves it to the client CRM record, then emails it if ticked. ✓/✕ beside a box shows or hides it in the PDF.</span>
          </div>
        </div>
      )}

      {askEmail && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${card} w-full max-w-md p-5`}>
            <h3 className="text-[15px] font-bold">Email this report to the client?</h3>
            <p className={`mt-1.5 text-[13px] ${muted}`}>The report will be created and saved to the CRM either way. Choose whether to also email the PDF.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={btn} onClick={() => { setAskEmail(false); create(false); }}>No, just create</button>
              <button type="button" className={btnPrimary} onClick={() => { setAskEmail(false); setEmail(true); create(true); }}>Yes, email it</button>
            </div>
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
