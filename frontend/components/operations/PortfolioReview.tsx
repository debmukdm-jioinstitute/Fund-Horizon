"use client";

import React, { useEffect, useRef, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

interface Row {
  code: string; name: string; typ?: string; invested: string; value: string;
  from: string; to: string; inst: string; ret?: string; flag?: string;
  flows?: [string, number][];
}
interface Hit { id: string; title: string; sub: string }
interface FileRes { name: string; kind: string; holdings_count: number; flows_count: number; error?: string | null }
interface LiveFund {
  name?: string; cat?: string; cat_label?: string; nav_date?: string;
  cagr_3y?: number | null; cap_up_3y?: number | null; cap_down_3y?: number | null; cap_ratio_3y?: number | null;
  max_dd_3y?: number | null; max_dd_all?: number | null; history_years?: number | null;
  fh_score?: number | null; fh_signal?: string | null; recommended?: boolean; reason?: string;
  falls?: Record<string, number | null>;
}
interface MatrixCell { idx: number; lead: number; val?: number; inr?: number }
interface MatrixRow {
  code?: string; name: string; ret: number; invested?: number; value?: number;
  bench_key?: string; bench_label?: string; beaten: number;
  cells: Record<string, MatrixCell>;
}
interface CompareData {
  portfolio_xirr?: number | null; nifty50_xirr?: number; nifty500_xirr?: number;
  mid150_xirr?: number; small250_xirr?: number;
  ahead_inr_500?: number; ahead_inr_50?: number; ahead_inr_mid150?: number; ahead_inr_small250?: number;
  funds_ahead_50?: number; indices_beaten?: number;
  primary_bench_key?: string; primary_bench_label?: string; primary_bench_ahead_inr?: number;
  benchmark_note?: string; total_invested?: number; total_value?: number;
  index_totals?: Record<string, MatrixCell>;
  per_fund?: Record<string, { pct?: number | null; inr?: number | null }>;
  index_rows?: { name: string; index: string; period: string; ret: number; idx: number; lead: number; inr: number }[];
  matrix_rows?: MatrixRow[];
}
interface Analysis {
  invested: number; value: number; gain: number; abs_ret: number; xirr?: number | null; nav_date?: string | null;
  signals: Record<string, number>;
  buckets: { name: string; value: number; pct: number }[];
  recommendations: { title: string; body: string }[];
  stress_test: { scenario: string; covered: string; change_inr: string; change_pct: string }[];
  live: Record<string, LiveFund>;
}
interface HistoryItem { id: string; report_date: string; emailed_at: string | null; created_at: string }

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
const inr = (v: number, d = 0) => Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const rsSigned = (v: number) => `${v >= 0 ? "+" : "−"}₹${inr(v)}`;
const pctSigned = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;

const SIG_BADGE: Record<string, string> = {
  Buy: "bg-[#E7F5EB] text-[#147A3D] dark:bg-[#12301D] dark:text-[#6EE7A0]",
  Hold: "bg-[#FFF6E0] text-[#9A6700] dark:bg-[#332A10] dark:text-[#F5C451]",
  Sell: "bg-[#FDECEB] text-[#B42318] dark:bg-[#3B181B] dark:text-[#FF7D86]",
  "Needs review": "bg-[#F2F4F7] text-[#475467] dark:bg-[#242E3D] dark:text-[#9AA3B2]",
};

const KIND_LABEL: Record<string, string> = {
  cas: "CAS statement",
  mf_txn: "MF transaction report",
  mf_summary: "MF summary report",
  folio_wise: "Folio-wise valuation",
  cards: "Portfolio statement",
  spreadsheet: "Spreadsheet / CSV",
  table_pdf: "Portfolio statement",
  text_pdf: "Portfolio statement",
  ocr: "Scanned statement (OCR)",
  compare_json: "Comparison JSON",
  password_required: "Password required",
  error: "Could not read",
};

async function call<T>(path: string, init: RequestInit = {}, blob = false): Promise<T> {
  const go = () => fetch(resolveApiUrl(`${API_URL}${path}`), { credentials: "include", ...init });
  let res: Response;
  try { res = await go(); } catch {
    // A dropped connection ("Failed to fetch") usually means the server was cold or restarting: retry once, then explain.
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

  // Statement upload & live analysis state
  const [password, setPassword] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileResults, setFileResults] = useState<FileRes[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (customerName && !name.trim()) setName(customerName);
  }, [customerName]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = () => {
    if (!customerId) { setHistory([]); return; }
    call<HistoryItem[]>(`/api/backoffice/portfolio-review/customers/${customerId}`).then(setHistory).catch(() => setHistory([]));
  };
  useEffect(loadHistory, [customerId]);

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
        const mfs = d.results.filter((r) => r.scope === "mutual_funds");
        const reg = mfs.filter((r) => /Regular/.test(r.title));
        setHits((reg.length ? reg : mfs).slice(0, 10).map((r) => ({ id: r.id, title: r.title, sub: r.subtitle ?? "" })));
        setActive(0);
      } catch { if (id === seq.current) setHits([]); } finally { if (id === seq.current) setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const refreshAnalysis = async (nextRows: Row[], nextDate = date) => {
    if (!nextRows.length) { setAnalysis(null); return; }
    try {
      const payload = {
        date: nextDate,
        holdings: nextRows.map((r) => ({
          code: r.code,
          name: r.name.replace(/ - (Regular|Direct) Plan.*$/, ""),
          typ: r.typ ?? "",
          invested: Number((r.invested || "0").replace(/,/g, "")) || 0,
          value: Number((r.value || "0").replace(/,/g, "")) || 0,
          from_month: r.from,
          to_month: r.to,
          period: periodLabel(r.from, r.to),
          inst: r.inst,
          ret: r.ret !== undefined && r.ret !== "" && !Number.isNaN(Number(r.ret)) ? Number(r.ret) : null,
          flag: r.flag === "†" || r.flag === "*" ? r.flag : "",
          flows: r.flows ?? [],
        })),
      };
      const res = await call<{
        holdings: { code: string; name: string; typ: string; invested: number; value: number; from: string; to: string; inst: string; ret: number | null; flag: string }[];
        compare: CompareData | null;
        analysis: Analysis;
      }>("/api/backoffice/portfolio-review/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      setAnalysis(res.analysis);
      if (res.compare) setCompare(JSON.stringify(res.compare));
      setRows((cur) => cur.map((r) => {
        const m = res.holdings.find((h) => h.code === r.code);
        return m ? {
          ...r,
          name: r.name || m.name,
          typ: m.typ || r.typ,
          from: r.from || m.from || "",
          to: r.to || m.to || "",
          inst: r.inst || m.inst || "",
          ret: r.ret || (m.ret != null ? String(m.ret) : ""),
          flag: r.flag || m.flag || "",
        } : r;
      }));
    } catch { /* non-blocking background enrichment */ }
  };

  const uploadFiles = (fileList: File[], mergeExisting = false) => fileList.length && run("parse", async () => {
    const fd = new FormData();
    fileList.forEach((f) => fd.append("files", f));
    if (password.trim()) fd.append("password", password.trim());
    const d = await call<{
      client: { name: string; date: string };
      holdings: {
        code: string; name: string; typ: string; invested: number; value: number;
        from: string; to: string; inst: string; ret: number | null; flag: string; flows?: [string, number][];
      }[];
      compare: CompareData | null;
      analysis: Analysis;
      warnings: string[];
      file_results: FileRes[];
    }>("/api/backoffice/portfolio-review/parse", { method: "POST", body: fd });

    setWarnings(d.warnings ?? []);
    setFileResults(d.file_results ?? []);
    const needsPass = (d.file_results ?? []).some((f) => f.kind === "password_required");
    setPendingFiles(needsPass ? fileList : []);

    if (d.client.name && (!name.trim() || !mergeExisting)) setName(d.client.name);
    const nextDate = d.client.date && /^\d{4}-\d{2}-\d{2}$/.test(d.client.date) ? d.client.date : date;
    if (d.client.date && /^\d{4}-\d{2}-\d{2}$/.test(d.client.date)) setDate(d.client.date);

    const parsedRows: Row[] = (d.holdings ?? []).map((h) => ({
      code: h.code,
      name: h.name,
      typ: h.typ,
      invested: h.invested > 0 ? String(Math.round(h.invested)) : "",
      value: h.value > 0 ? String(Math.round(h.value)) : "",
      from: h.from || "",
      to: h.to || "",
      inst: h.inst || "",
      ret: h.ret != null ? String(h.ret) : "",
      flag: h.flag || "",
      flows: h.flows ?? [],
    }));

    if (parsedRows.length > 0) {
      let combined = parsedRows;
      if (mergeExisting && rows.length > 0) {
        const byCode = new Map(rows.map((r) => [r.code, r]));
        for (const p of parsedRows) {
          const ex = byCode.get(p.code);
          if (!ex) byCode.set(p.code, p);
          else {
            byCode.set(p.code, {
              ...ex,
              name: ex.name || p.name,
              typ: ex.typ || p.typ,
              invested: ex.invested || p.invested,
              value: ex.value || p.value,
              from: ex.from || p.from,
              to: ex.to || p.to,
              inst: ex.inst || p.inst,
              ret: ex.ret || p.ret,
              flag: ex.flag || p.flag,
              flows: ex.flows?.length ? ex.flows : p.flows,
            });
          }
        }
        combined = Array.from(byCode.values());
      }
      setRows(combined);
      if (mergeExisting && rows.length > 0) {
        await refreshAnalysis(combined, nextDate);
      } else {
        setAnalysis(d.analysis);
        setCompare(d.compare ? JSON.stringify(d.compare) : "");
      }
      const flowsTotal = (d.file_results ?? []).reduce((s, f) => s + (f.flows_count || 0), 0);
      setMsg({
        ok: true,
        text: `Scraped ${parsedRows.length} mutual fund holding(s)${flowsTotal ? ` and ${flowsTotal} dated transaction(s)` : ""}. Live Fund Horizon scores, stress tests and market comparisons are ready below.`,
      });
    } else if (d.compare) {
      setCompare(JSON.stringify(d.compare));
      setMsg({ ok: true, text: "Loaded same-instalment market comparison data." });
    } else if (needsPass) {
      setMsg({ ok: false, text: "This statement PDF is password-protected. Enter the PDF password above and click Unlock & parse." });
    } else {
      setMsg({ ok: false, text: "No mutual fund holdings were found in the uploaded file(s). Upload a CAS, folio-wise valuation, transaction report, spreadsheet or screenshot." });
    }
  });

  const add = (h: Hit) => {
    const cleanTitle = h.title.replace(/ - (Regular|Direct) Plan.*$/, "");
    const next = rows.some((x) => x.code === h.id) ? rows : [...rows, { code: h.id, name: cleanTitle, invested: "", value: "", from: "", to: "", inst: "" }];
    setRows(next); setHits([]); setQ(""); setOpen(false);
    void refreshAnalysis(next);
  };

  const importPaste = () => {
    const parsed: Row[] = paste.split("\n").map((l) => l.split(/[,\t]/).map((c) => c.trim().replace(/[₹]/g, ""))).filter((c) => /^\d{4,8}$/.test(c[0] ?? ""))
      .map((c) => ({ code: c[0], name: "", invested: c[1] ?? "", value: c[2] ?? "", from: /^\d{4}-\d{2}$/.test(c[3] ?? "") ? c[3] : "", to: /^\d{4}-\d{2}$/.test(c[4] ?? "") ? c[4] : "", inst: c[5] ?? "" }));
    const next = [...rows, ...parsed.filter((p) => !rows.some((x) => x.code === p.code))];
    setRows(next); setPaste("");
    void refreshAnalysis(next);
  };

  const parsedCompare: CompareData | null = (() => {
    if (!compare.trim()) return null;
    try { return JSON.parse(compare) as CompareData; } catch { return null; }
  })();

  const totals = (() => {
    const inv = rows.reduce((s, r) => s + (Number((r.invested || "0").replace(/,/g, "")) || 0), 0);
    const val = rows.reduce((s, r) => s + (Number((r.value || "0").replace(/,/g, "")) || 0), 0);
    const gain = val - inv;
    return { inv, val, gain, abs: inv > 0 ? (gain / inv) * 100 : 0 };
  })();

  const body = () => {
    const holdings = rows.map((r) => ({
      code: r.code,
      name: r.name.replace(/ - (Regular|Direct) Plan.*$/, ""),
      typ: r.typ ?? "",
      invested: Number(r.invested.replace(/,/g, "")),
      value: Number(r.value.replace(/,/g, "")),
      period: periodLabel(r.from, r.to),
      inst: r.inst,
      ret: r.ret !== undefined && r.ret !== "" && !Number.isNaN(Number(r.ret)) ? Number(r.ret) : null,
      flag: r.flag === "†" || r.flag === "*" ? r.flag : "",
    }));
    if (!name.trim() || !holdings.length || holdings.some((h) => !(h.invested >= 0) || !(h.value >= 0) || Number.isNaN(h.invested) || Number.isNaN(h.value))) {
      throw new Error("Enter the client name and, for every fund, the invested amount and today's value.");
    }
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
    loadHistory();
  });
  const redownload = (id: string, rDate: string) => run("redownload", async () => {
    const blob = await call<Blob>(`/api/backoffice/portfolio-review/${id}/pdf`, {}, true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `Portfolio Review - ${name || customerName || "Client"} - ${rDate}.pdf`; a.click(); URL.revokeObjectURL(a.href);
  });

  return (
    <div className={`${card} space-y-4 p-5`}>
      <div>
        <h2 className="text-lg font-bold">Portfolio review — your portfolio vs the market</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Upload the client&apos;s statements (CAS, ProAffluence, FundsIndia, Excel, CSV or scanned PDF/image) to scrape all holdings, dates, instalments and returns automatically — or add and edit funds below. Fund Horizon adds live net asset value (NAV) dates, Fund Horizon (FH) scores and Buy / Hold / Sell signals, up-market and down-market capture ratios, worst falls, same-instalment Nifty index comparisons, portfolio observations and a stress test.</p>
      </div>

      {/* Statement upload bar */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (dropped.length) uploadFiles(dropped, rows.length > 0);
        }}
        className="rounded-xl border-[1.5px] border-dashed border-[#006F64]/60 bg-[#F4FBF9] dark:bg-[#112220] p-3.5"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#006F64] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#00554D]">
            {busy === "parse" ? "Scraping statements…" : "⬆ Upload statements & scrape data"}
            <input
              type="file"
              multiple
              accept=".pdf,.xlsx,.xlsm,.xls,.csv,.tsv,.docx,.html,.htm,.json,.txt,application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (picked.length) uploadFiles(picked, false);
              }}
            />
          </label>
          {rows.length > 0 && (
            <label className={`${btn} cursor-pointer`}>
              + Merge another statement
              <input
                type="file"
                multiple
                accept=".pdf,.xlsx,.xlsm,.xls,.csv,.tsv,.docx,.html,.htm,.json,.txt,application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (picked.length) uploadFiles(picked, true);
                }}
              />
            </label>
          )}
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="PDF password (if encrypted CAS)"
              aria-label="PDF password (if encrypted CAS)"
              className={`${cell} w-52`}
            />
            {pendingFiles.length > 0 && (
              <button type="button" className={btnPrimary} disabled={busy !== null || !password.trim()} onClick={() => uploadFiles(pendingFiles, rows.length > 0)}>
                Unlock &amp; parse
              </button>
            )}
          </div>
          {rows.length > 0 && (
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => run("analyze", () => refreshAnalysis(rows, date))}
            >
              {busy === "analyze" ? "Computing…" : "↻ Recompute comparison & analysis"}
            </button>
          )}
          {rows.length > 0 && (
            <button
              type="button"
              className={btn}
              disabled={busy !== null}
              onClick={() => { setRows([]); setCompare(""); setAnalysis(null); setFileResults([]); setWarnings([]); setMsg(null); }}
            >
              Clear all
            </button>
          )}
        </div>
        <p className={`${hint} mt-1.5`}>
          Supports CAMS / KFintech / NSDL / CDSL Consolidated Account Statements (CAS), ProAffluence MF Summary &amp; Transaction Reports, FundsIndia Folio-Wise Valuation &amp; portfolio printouts, Excel (.xlsx/.xls), CSV, Word, or scanned images (OCR). You can also drag and drop files here.
        </p>
        {fileResults.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {fileResults.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] ${
                  f.error ? "border-[#F5C451] bg-[#FFF8E6] text-[#9A6700] dark:border-[#8A6A1A] dark:bg-[#2A2210] dark:text-[#F5C451]" : "border-[#C9E8E2] bg-white text-[#172033] dark:border-[#24443F] dark:bg-[#171E2A] dark:text-[#EDF1F6]"
                }`}
              >
                <span className="font-semibold">{f.name}</span>
                <span className={hint}>
                  · {KIND_LABEL[f.kind] ?? f.kind}
                  {f.holdings_count > 0 ? ` · ${f.holdings_count} funds` : ""}
                  {f.flows_count > 0 ? ` · ${f.flows_count} instalments` : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div role="alert" className="rounded-lg border border-[#E8B84B] bg-[#FFF8E6] dark:border-[#8A6A1A] dark:bg-[#2A2210] px-3.5 py-2 text-[12.5px]">
          <span className="font-semibold">Notes from statement scrape:</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

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
              {!hits.length && <li className={`px-3 py-2 ${hint}`}>{searching ? "Searching…" : "No matching fund found. Check the spelling or try the scheme code."}</li>}
            </ul>
          )}
        </div>
        <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE]">Paste many funds (scheme code, invested, value, first month, last month, instalments)</summary>
          <textarea className={`${cell} mt-1 h-24`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"122640, 940934, 1600734, 2020-02, 2026-07, 71\n151812, 787969, 741958, 2026-02, 2026-02, 1"} />
          <button type="button" className={`${btn} mt-1`} onClick={importPaste} disabled={!paste.trim()}>Add pasted funds</button>
        </details>
      </div>

      {/* KPI summary cards when holdings exist */}
      {rows.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">Invested ({rows.length} funds)</div>
            <div className="text-[17px] font-bold tabular-nums">₹{inr(totals.inv)}</div>
          </div>
          <div className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">Value today · Gain</div>
            <div className="text-[17px] font-bold tabular-nums">
              ₹{inr(totals.val)} <span className={`text-[13px] ${totals.gain >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>({rsSigned(totals.gain)})</span>
            </div>
          </div>
          <div className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">
              {parsedCompare?.portfolio_xirr != null ? "Your XIRR vs Nifty 500 TRI" : "Absolute return"}
            </div>
            <div className="text-[17px] font-bold tabular-nums">
              {parsedCompare?.portfolio_xirr != null ? (
                <>
                  {parsedCompare.portfolio_xirr.toFixed(2)}% p.a.{" "}
                  <span className="text-[12.5px] font-normal text-[#5B6577] dark:text-[#9AA3B2]">
                    vs {(parsedCompare.nifty500_xirr ?? 0).toFixed(2)}%
                  </span>
                </>
              ) : `${totals.abs.toFixed(2)}%`}
            </div>
          </div>
          <div className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">
              {parsedCompare?.ahead_inr_500 != null ? "vs Nifty 500 TRI (same instalments)" : "Live FH signals"}
            </div>
            <div className="text-[17px] font-bold tabular-nums">
              {parsedCompare?.ahead_inr_500 != null ? (
                <span className={parsedCompare.ahead_inr_500 >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}>
                  {rsSigned(parsedCompare.ahead_inr_500)}
                </span>
              ) : analysis ? (
                <span className="text-[13.5px]">
                  {analysis.signals.Buy ?? 0} Buy · {analysis.signals.Hold ?? 0} Hold · {analysis.signals.Sell ?? 0} Sell
                </span>
              ) : "—"}
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <p className={`${hint} mb-1`}>Invested = total money put in (₹). Value today = current market value (₹). Pick the first and last month of investing: the same month means a one-time purchase, and an empty &quot;to&quot; means still investing (a Systematic Investment Plan, SIP). Instalments = number of purchases, e.g. 36 for a 3-year monthly SIP.</p>
          <table className="w-full min-w-[920px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">
                {["Code", "Fund", "Invested (₹)", "Value today (₹)", "Invested from → to (month)", "Instalments", "Return %", "FH view / vs Nifty 500", ""].map((h) => (
                  <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 py-1.5 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const lv = analysis?.live?.[r.code];
                const pf = parsedCompare?.per_fund?.[r.code];
                const sig = lv?.fh_signal ?? (lv?.reason ? "Data excluded" : undefined);
                return (
                  <tr key={r.code}>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 tabular-nums">{r.code}</td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5">
                      <input className={cell} value={r.name} placeholder="(from Fund Horizon)" onChange={(e) => patch(i, { name: e.target.value })} />
                      {(lv?.cat_label || r.typ) && (
                        <div className={`${hint} px-1`}>
                          {lv?.cat_label || r.typ}
                          {lv?.nav_date ? ` · NAV ${lv.nav_date}` : ""}
                          {r.flag === "†" ? " · † < 1 yr" : r.flag === "*" ? " · * est. date" : ""}
                        </div>
                      )}
                    </td>
                    {(["invested", "value"] as const).map((k) => (
                      <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5">
                        <input className={`${cell} text-right`} inputMode="decimal" value={r[k]} placeholder={k === "invested" ? "e.g. 500000" : "e.g. 612000"} onChange={(e) => patch(i, { [k]: e.target.value })} />
                      </td>
                    ))}
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5">
                      <div className="flex items-center gap-1">
                        <input type="month" aria-label="First investment month" className={cell} value={r.from} max={date.slice(0, 7)} onChange={(e) => patch(i, { from: e.target.value })} />
                        <span aria-hidden>→</span>
                        <input type="month" aria-label="Last investment month (leave empty if still investing)" className={cell} value={r.to} min={r.from || undefined} max={date.slice(0, 7)} onChange={(e) => patch(i, { to: e.target.value })} />
                      </div>
                      {r.from && <div className={`${hint} px-1`}>{periodLabel(r.from, r.to)}</div>}
                    </td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 w-24">
                      <input className={cell} inputMode="numeric" value={r.inst} placeholder="e.g. 36" onChange={(e) => patch(i, { inst: e.target.value })} />
                    </td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 w-24">
                      <input className={`${cell} text-right`} inputMode="decimal" value={r.ret ?? ""} placeholder="auto" onChange={(e) => patch(i, { ret: e.target.value })} />
                    </td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 py-1 text-[11.5px] tabular-nums">
                      <div className="flex flex-wrap items-center gap-1">
                        {sig && (
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${SIG_BADGE[sig] ?? SIG_BADGE["Needs review"]}`}>
                            {sig}{lv?.fh_score != null ? ` · ${lv.fh_score.toFixed(1)}` : ""}
                          </span>
                        )}
                        {lv?.recommended && <span className="rounded bg-[#006F64] px-1.5 py-0.5 text-[10.5px] font-semibold text-white">FH list</span>}
                      </div>
                      {pf && (pf.pct != null || pf.inr != null) && (
                        <div className={`mt-0.5 font-semibold ${(pf.pct ?? 0) >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                          {pf.pct != null ? `${pctSigned(pf.pct, 1)} ` : ""}
                          {pf.inr != null ? `(${rsSigned(pf.inr)})` : ""} vs N500
                        </div>
                      )}
                    </td>
                    <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5">
                      <button type="button" aria-label={`Remove ${r.code}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Live analysis & market comparison preview */}
      {rows.length > 0 && analysis && (
        <details open className="rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F8FAFB] dark:bg-[#1B2432] p-4">
          <summary className="cursor-pointer text-[13.5px] font-bold text-[#172033] dark:text-[#EDF1F6]">
            Portfolio analysis preview — 4-index Nifty matrix, official benchmark mapping, FH observations &amp; stress test
          </summary>
          <div className="mt-3 space-y-4">
            {parsedCompare?.matrix_rows && parsedCompare.matrix_rows.length > 0 && (
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-[13.5px] font-bold text-[#1B2A6B] dark:text-[#75E1CE]">
                    {parsedCompare.indices_beaten === 4
                      ? "The portfolio beat all 4 Nifty indices"
                      : (parsedCompare.indices_beaten ?? 0) > 0
                        ? `The portfolio beat ${parsedCompare.indices_beaten} of 4 Nifty indices`
                        : "Your portfolio against all 4 Nifty indices"}
                  </h4>
                  {parsedCompare.primary_bench_label && (
                    <span className={hint}>
                      Primary benchmark: <b>{parsedCompare.primary_bench_label}</b>
                      {parsedCompare.primary_bench_ahead_inr != null ? ` (${rsSigned(parsedCompare.primary_bench_ahead_inr)})` : ""}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full min-w-[780px] border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                    <thead>
                      <tr className="bg-[#1B2A6B] text-white">
                        <th className="border border-[#2B3644] px-2 py-1.5 text-left font-semibold">Fund</th>
                        <th className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">Your return</th>
                        {([
                          ["n50", "Nifty 50"],
                          ["n500", "Nifty 500 TRI"],
                          ["mid150", "Nifty Midcap 150 TRI"],
                          ["small250", "Nifty Smallcap 250 TRI"],
                        ] as const).map(([k, lbl]) => (
                          <th key={k} className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">
                            {lbl}{parsedCompare.primary_bench_key === k ? "*" : ""}
                          </th>
                        ))}
                        <th className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">Indices beaten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedCompare.matrix_rows.map((mr, idx) => (
                        <tr key={idx}>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1.5 font-semibold">
                            <div>{mr.name}</div>
                            {mr.bench_label && <div className={hint}>Benchmark: {mr.bench_label}</div>}
                          </td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1.5 text-center font-bold">
                            {mr.ret.toFixed(2)}%
                          </td>
                          {(["n50", "n500", "mid150", "small250"] as const).map((k) => {
                            const c = mr.cells?.[k];
                            return (
                              <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">
                                {c ? (
                                  <>
                                    <div className="text-[11px] text-[#667085] dark:text-[#9AA3B2]">{pctSigned(c.idx)}</div>
                                    <div className={`font-bold ${c.lead >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                                      You {pctSigned(c.lead)}
                                    </div>
                                  </>
                                ) : "—"}
                              </td>
                            );
                          })}
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1.5 text-center font-bold">
                            {mr.beaten} of 4
                          </td>
                        </tr>
                      ))}
                      {parsedCompare.index_totals && (
                        <>
                          <tr className="bg-[#F3F6FC] dark:bg-[#1B2432] font-bold">
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1.5">Total portfolio</td>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1.5 text-center">
                              {(parsedCompare.portfolio_xirr ?? 0).toFixed(2)}%
                            </td>
                            {(["n50", "n500", "mid150", "small250"] as const).map((k) => {
                              const tc = parsedCompare.index_totals?.[k];
                              return (
                                <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">
                                  {tc ? (
                                    <>
                                      <div className="text-[11px] font-normal text-[#667085] dark:text-[#9AA3B2]">{pctSigned(tc.idx)}</div>
                                      <div className={tc.lead >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}>
                                        You {pctSigned(tc.lead)}
                                      </div>
                                    </>
                                  ) : "—"}
                                </td>
                              );
                            })}
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1.5 text-center">
                              {parsedCompare.indices_beaten ?? 0} of 4
                            </td>
                          </tr>
                          <tr className="bg-[#E8EEFB]/60 dark:bg-[#1B2740]/60 text-[11.5px]">
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1">
                              ₹{((parsedCompare.total_invested ?? totals.inv) / 1e5).toFixed(1)} lakh SIPs worth today
                            </td>
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center font-bold">
                              ₹{inr(parsedCompare.total_value ?? totals.val)}
                            </td>
                            {(["n50", "n500", "mid150", "small250"] as const).map((k) => {
                              const tc = parsedCompare.index_totals?.[k];
                              return (
                                <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">
                                  {tc?.val ? `₹${inr(tc.val)}` : "—"}
                                </td>
                              );
                            })}
                            <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1" />
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                {parsedCompare.benchmark_note && <p className={`${hint} mt-1 italic`}>{parsedCompare.benchmark_note}</p>}
              </div>
            )}

            {parsedCompare?.index_rows && parsedCompare.index_rows.length > 0 && (
              <div>
                <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                  Same instalments against the matching Nifty index
                </h4>
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                    <thead>
                      <tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">
                        {["Fund", "Nifty index", "Period", "Your return", "Index", "Lead", "₹ vs index"].map((h) => (
                          <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1 text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedCompare.index_rows.map((ir, idx) => (
                        <tr key={idx}>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 font-semibold">{ir.name}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1">{ir.index}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1">{ir.period}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{pctSigned(ir.ret)}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{pctSigned(ir.idx)}</td>
                          <td className={`border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right font-semibold ${ir.lead >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                            {pctSigned(ir.lead, 1)}
                          </td>
                          <td className={`border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right font-semibold ${ir.inr >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                            {rsSigned(ir.inr)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                  Portfolio observations
                </h4>
                <ul className="mt-1.5 space-y-1.5 text-[12.5px]">
                  {analysis.recommendations.map((rec, i) => (
                    <li key={i} className="rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-2">
                      <div className="font-bold text-[#1B2A6B] dark:text-[#75E1CE]">{rec.title}</div>
                      <div className="mt-0.5 text-[#475467] dark:text-[#9AA3B2]">{rec.body}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                  Stress test: what if markets fall again?
                </h4>
                <div className="mt-1.5 overflow-x-auto">
                  <table className="w-full border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                    <thead>
                      <tr className="bg-[#E8EEFB] dark:bg-[#1B2740]">
                        {["Scenario", "Covered", "Est. change", "On covered"].map((h) => (
                          <th key={h} className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1 text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.stress_test.map((st, i) => (
                        <tr key={i}>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1">{st.scenario}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{st.covered}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right font-semibold text-[#B42318] dark:text-[#FF7D86]">{st.change_inr}</td>
                          <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right font-semibold text-[#B42318] dark:text-[#FF7D86]">{st.change_pct}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </details>
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

      {customerId && history.length > 0 && (
        <div className="border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
          <h3 className="text-[13px] font-bold">Saved portfolio reviews for this client</h3>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {history.map((h) => (
              <button key={h.id} type="button" className={btn} disabled={busy !== null} onClick={() => redownload(h.id, h.report_date)}>
                ⬇ {h.report_date || "Review"}{h.emailed_at ? " · emailed" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
