"use client";

import React, { useEffect, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";

interface Row {
  name: string; folio: string; invested: number; investments: number; div_reinv: number; div_payout: number;
  units: number; nav: number; value: number; ann_ret: number; weight: number; abs_ret: number;
  isin?: string | null; code?: string | null; asset_class?: string; category?: string;
  from_date?: string; to_date?: string; days?: number | null; inst?: string; period?: string; flag?: string;
  flows?: [string, number][];
  fh_score?: number | null; fh_signal?: string | null; fh_recommended?: boolean;
  lead_n500_pct?: number | null; lead_n500_inr?: number | null;
}
interface Fact { source: string; items: { label: string; value: string }[] }
interface FileRes { name: string; kind: string; method: string; rows: number; flows: number; error?: string | null }
interface AllocItem { name: string; count: number; invested: number; value: number; gain: number; weight: number; abs_ret: number }
interface MatrixCell { idx: number; lead: number; val?: number; inr?: number }
interface MatrixRow {
  code?: string; name: string; period?: string; ret: number; invested?: number; value?: number;
  bench_key?: string; bench_label?: string; beaten: number; cells: Record<string, MatrixCell>;
}
interface CompareData {
  portfolio_xirr?: number | null; nifty50_xirr?: number; nifty500_xirr?: number; mid150_xirr?: number; small250_xirr?: number;
  ahead_inr_500?: number; ahead_inr_50?: number; indices_beaten?: number;
  primary_bench_key?: string; primary_bench_label?: string; primary_bench_ahead_inr?: number;
  benchmark_note?: string; total_invested?: number; total_value?: number;
  index_totals?: Record<string, MatrixCell>;
  index_rows?: { name: string; index: string; period: string; ret: number; idx: number; lead: number; inr: number }[];
  matrix_rows?: MatrixRow[];
}
interface RiskRow {
  code: string; name: string; category: string; value: number;
  cagr_3y?: number | null; cap_up_3y?: number | null; cap_down_3y?: number | null; cap_ratio_3y?: number | null;
  max_dd_3y?: number | null; max_dd_all?: number | null; history_years?: number | null;
  fh_score?: number | null; fh_signal?: string | null; recommended?: boolean; nav_date?: string | null; reason?: string;
}
interface Matrices {
  timeframe?: { inception_date?: string; valuation_date?: string; generated_at?: string; span_days?: number | null; summary?: string; live_nav_date?: string | null };
  asset_allocation?: AllocItem[];
  category_allocation?: AllocItem[];
  compare?: CompareData | null;
  risk_matrix?: RiskRow[];
  signals?: Record<string, number>;
  recommendations?: { title: string; body: string }[];
  stress_test?: { scenario: string; covered: string; change_inr: string; change_pct: string }[];
}
interface ClientInfo {
  name: string; date: string; arn: string; phone: string; email?: string; pan?: string; inception?: string; timeframe?: string;
}
interface Report {
  client: ClientInfo; xirr: number | null; rows: Row[]; factsheets: Fact[]; matrices?: Matrices | null;
}
interface HistoryItem { id: string; report_date: string; emailed_at: string | null; created_at: string }

const NUM_COLS = ["invested", "investments", "div_reinv", "div_payout", "units", "nav", "value", "ann_ret"] as const;
const HEAD = [
  "#", "Scheme / Security", "Folio / A/c", "Period / Timeframe", "Total invested (A+B)", "Investments (A)",
  "Div. reinv. (B)", "Div. payout", "Units / Qty", "NAV / Price", "Market value", "Weight %", "Abs. ret %", "Ann. / XIRR %", "FH view", "",
];
const KIND_LABEL: Record<string, string> = {
  folio_wise: "Folio-wise valuation",
  transaction_wise: "Transaction-wise valuation",
  mf_summary: "MF summary report",
  mf_txn: "MF transaction report",
  cas: "CAS statement",
  pms: "PMS statement / factsheet",
  direct_equity: "Direct equity",
  cards: "Portfolio printout",
  ocr: "Scanned statement (OCR)",
  spreadsheet: "Spreadsheet / CSV",
  table_pdf: "Portfolio statement",
  text: "Statement text",
  factsheet: "Factsheet",
  password_required: "Password required",
  error: "Could not read",
};
const SIG_BADGE: Record<string, string> = {
  Buy: "bg-[#E7F5EB] text-[#147A3D] dark:bg-[#12301D] dark:text-[#6EE7A0]",
  Hold: "bg-[#FFF6E0] text-[#9A6700] dark:bg-[#332A10] dark:text-[#F5C451]",
  Sell: "bg-[#FDECEB] text-[#B42318] dark:bg-[#3B181B] dark:text-[#FF7D86]",
  "Needs review": "bg-[#F2F4F7] text-[#475467] dark:bg-[#242E3D] dark:text-[#9AA3B2]",
};

const inr = (v: number, d = 2) => v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const rsSigned = (v: number, d = 0) => `${v >= 0 ? "+" : "−"}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pctSigned = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`;
const cell = "w-full rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-1.5 py-1 text-[12.5px] tabular-nums";
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const hint = "text-[11.5px] font-normal text-[#667085] dark:text-[#9AA3B2]";

async function call<T>(path: string, init: RequestInit = {}, blob = false): Promise<T> {
  const go = () => fetch(resolveApiUrl(`${API_URL}/api/backoffice/client-report${path}`), { credentials: "include", ...init });
  let res: Response;
  try { res = await go(); } catch {
    await new Promise((r) => setTimeout(r, 1500));
    try { res = await go(); } catch { throw new ApiError("Could not reach the server. Please try again in a few seconds.", 0); }
  }
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
  const [fileResults, setFileResults] = useState<FileRes[]>([]);
  const [password, setPassword] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [email, setEmail] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadHistory = () => {
    if (!customerId) { setHistory([]); return; }
    call<HistoryItem[]>(`/customers/${customerId}`).then(setHistory).catch(() => setHistory([]));
  };
  useEffect(loadHistory, [customerId]);

  const totals = (() => {
    const rows = report?.rows ?? [];
    const invested = rows.reduce((s, r) => s + r.invested, 0);
    const value = rows.reduce((s, r) => s + r.value, 0);
    return { invested, value, gain: value - invested, abs: invested ? (value / invested - 1) * 100 : 0 };
  })();

  const patchRow = (i: number, p: Partial<Row>) =>
    setReport((r) => r && { ...r, rows: r.rows.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); } finally { setBusy(null); }
  };

  const upload = (files: File[], mergeExisting = false) => files.length && run("parse", async () => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    if (password.trim()) fd.append("password", password.trim());
    const d = await call<Report & { warnings: string[]; file_results?: FileRes[] }>("/parse", { method: "POST", body: fd });
    setWarnings(d.warnings ?? []);
    setFileResults(d.file_results ?? []);
    const needsPass = (d.file_results ?? []).some((f) => f.kind === "password_required");
    setPendingFiles(needsPass ? files : []);

    if (d.rows.length || d.factsheets.length) {
      if (mergeExisting && report) {
        const mergedRows = [...report.rows, ...d.rows];
        const existingSrc = new Set(report.factsheets.map((f) => f.source));
        const mergedFacts = [...report.factsheets, ...d.factsheets.filter((f) => !existingSrc.has(f.source))];
        const nextPayload: Report = {
          client: {
            ...report.client,
            name: report.client.name || d.client.name || customerName || "",
            date: report.client.date || d.client.date,
            inception: report.client.inception || d.client.inception || "",
            timeframe: report.client.timeframe || d.client.timeframe || "",
          },
          xirr: report.xirr ?? d.xirr,
          rows: mergedRows,
          factsheets: mergedFacts,
        };
        const recomputed = await call<Report>("/analyze", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextPayload),
        });
        setReport(recomputed);
      } else {
        if (!d.client.name && customerName) d.client.name = customerName;
        setReport(d);
      }
      const flowsTotal = (d.file_results ?? []).reduce((s, f) => s + (f.flows || 0), 0);
      setMsg({
        ok: true,
        text: `Scraped ${d.rows.length} holding(s)${flowsTotal ? ` and ${flowsTotal} dated transaction(s)` : ""}. XIRR and all investment matrices are ready below.`,
      });
    } else if (needsPass) {
      setMsg({ ok: false, text: "This statement PDF is password-protected. Enter the PDF password above and click Unlock & parse." });
    } else {
      setMsg({ ok: false, text: "No fund statement rows found. Upload a CAS, folio-wise or transaction-wise valuation, ProAffluence/FundsIndia report, PMS statement, spreadsheet or scanned image." });
    }
  });

  const recompute = () => report && run("analyze", async () => {
    const d = await call<Report>("/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report),
    });
    setReport(d);
    setMsg({ ok: true, text: "Recomputed XIRR, timeframe, benchmark comparison and risk matrices." });
  });

  const addBlankRow = () => {
    const empty: Row = {
      name: "New Fund / Security", folio: "-", invested: 0, investments: 0, div_reinv: 0, div_payout: 0,
      units: 0, nav: 0, value: 0, ann_ret: 0, weight: 0, abs_ret: 0, asset_class: "Mutual Fund", category: "", period: "",
    };
    if (!report) {
      setReport({
        client: { name: customerName ?? "", date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }), arn: "345439", phone: "", inception: "", timeframe: "" },
        xirr: null, rows: [empty], factsheets: [], matrices: null,
      });
    } else {
      setReport({ ...report, rows: [...report.rows, empty] });
    }
  };

  const download = () => report && run("pdf", async () => {
    const blob = await call<Blob>("/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }, true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Portfolio Valuation Report - ${report.client.name || "Client"} - ${report.client.date || "Report"}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const push = () => report && customerId && run("push", async () => {
    const r = await call<{ emailed: boolean }>("/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_id: customerId, report, send_email: email }) });
    setMsg({ ok: true, text: r.emailed ? "Saved to the client's CRM record and emailed." : "Saved to the client's CRM record." });
    loadHistory();
  });

  const redownload = (id: string, rDate: string) => run("redownload", async () => {
    const blob = await call<Blob>(`/${id}/pdf`, {}, true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Portfolio Valuation Report - ${report?.client.name || customerName || "Client"} - ${rDate}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const mat = report?.matrices;
  const cmp = mat?.compare;
  const tf = mat?.timeframe;

  return (
    <div className="space-y-4">
      <div
        className={`${card} p-5`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (dropped.length) upload(dropped, !!report?.rows.length);
        }}
      >
        <h2 className="text-lg font-bold">Client report — monthly portfolio valuation</h2>
        <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">
          Upload any statement — CAMS / KFintech / NSDL / CDSL CAS, FundsIndia Folio-Wise or Transaction-Wise valuation, ProAffluence MF Summary or Transaction Report, PMS statement/factsheet, Direct Equity, Excel (.xlsx/.xls), CSV, Word, or scanned image (OCR). Fund Horizon calculates the exact XIRR, investment timeframe, asset &amp; category allocation, 4-index Nifty benchmark matrix, capture ratios, drawdowns and stress tests, and generates a Fund Horizon branded consolidated report.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#006F64] bg-[#F4FBF9] dark:bg-[#112220] px-3.5 py-2 text-[13.5px] font-bold text-[#006F64] dark:text-[#75E1CE] hover:bg-[#E6F4F1]">
            {busy === "parse" ? "Reading…" : "⬆ Upload statements & factsheets"}
            <input
              type="file"
              multiple
              accept=".pdf,.xlsx,.xlsm,.xls,.csv,.tsv,.docx,.html,.htm,.txt,application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={busy !== null}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (picked.length) upload(picked, false);
              }}
            />
          </label>
          {report && report.rows.length > 0 && (
            <label className={`${btn} cursor-pointer`}>
              + Merge another statement
              <input
                type="file"
                multiple
                accept=".pdf,.xlsx,.xlsm,.xls,.csv,.tsv,.docx,.html,.htm,.txt,application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (picked.length) upload(picked, true);
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
              <button type="button" className={btnPrimary} disabled={busy !== null || !password.trim()} onClick={() => upload(pendingFiles, !!report?.rows.length)}>
                Unlock &amp; parse
              </button>
            )}
          </div>
          {report && (
            <button type="button" className={btn} disabled={busy !== null} onClick={recompute}>
              {busy === "analyze" ? "Computing…" : "↻ Recompute XIRR & matrices"}
            </button>
          )}
          <button type="button" className={btn} disabled={busy !== null} onClick={addBlankRow}>
            + Add row manually
          </button>
          {report && (
            <button type="button" className={btn} disabled={busy !== null} onClick={() => { setReport(null); setWarnings([]); setFileResults([]); setMsg(null); }}>
              Clear
            </button>
          )}
        </div>

        {fileResults.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
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
                  {f.method === "ocr" ? " (OCR)" : ""}
                  {f.rows > 0 ? ` · ${f.rows} rows` : ""}
                  {f.flows > 0 ? ` · ${f.flows} txns` : ""}
                </span>
              </span>
            ))}
          </div>
        )}

        {warnings.map((w, i) => <p key={i} className="mt-2 text-[12.5px] text-[#9A6700] dark:text-[#F5C451]">{w}</p>)}
        {msg && <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>{msg.text}</p>}
      </div>

      {report && (
        <div className={`${card} space-y-4 p-5`}>
          {/* Client, Dates, Timeframe & XIRR Metadata Bar */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {([
              ["Client name", "name", "e.g. Aditya Parchure"],
              ["Report / Valuation date", "date", "e.g. 12 Nov 2026"],
              ["Inception / Start date", "inception", "e.g. 10 Jan 2019"],
              ["Investment timeframe", "timeframe", "e.g. 10 Jan 2019 to 12 Nov 2026"],
              ["ARN", "arn", "345439"],
              ["Phone", "phone", "Optional"],
            ] as const).map(([label, k, ph]) => (
              <label key={k} className="text-[12px] font-semibold">{label}
                <input
                  className={`${cell} mt-1`}
                  placeholder={ph}
                  value={report.client[k] ?? ""}
                  onChange={(e) => setReport({ ...report, client: { ...report.client, [k]: e.target.value } })}
                />
              </label>
            ))}
            <label className="text-[12px] font-semibold">Portfolio XIRR %
              <input
                className={`${cell} mt-1 font-bold text-[#006F64] dark:text-[#75E1CE]`}
                inputMode="decimal"
                placeholder="Auto"
                value={report.xirr ?? ""}
                onChange={(e) => setReport({ ...report, xirr: e.target.value === "" || isNaN(+e.target.value) ? null : +e.target.value })}
              />
            </label>
          </div>

          {/* Executive KPI Cards */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
            {([
              ["Invested amount", `₹${inr(totals.invested)}`, `${report.rows.length} holding(s)`],
              ["Current value", `₹${inr(totals.value)}`, report.client.date ? `As on ${report.client.date}` : "Latest valuation"],
              ["Unrealised gain / (loss)", `₹${inr(totals.gain)}`, totals.gain >= 0 ? "Net appreciation" : "Net drawdown"],
              ["Absolute return", `${inr(totals.abs)}%`, "Total return on capital"],
              ["Annualised return (XIRR)", report.xirr != null ? `${inr(report.xirr)}% p.a.` : "—", cmp?.nifty500_xirr != null ? `vs Nifty 500 TRI ${cmp.nifty500_xirr.toFixed(2)}%` : "Money-weighted p.a."],
              ["Timeframe & Benchmark", report.client.timeframe || tf?.summary || (report.client.date ? `As on ${report.client.date}` : "—"), cmp?.indices_beaten != null ? `Beat ${cmp.indices_beaten} of 4 Nifty indices` : (tf?.live_nav_date ? `Live NAV ${tf.live_nav_date}` : "Consolidated view")],
            ] as const).map(([k, v, sub]) => (
              <div key={k} className="rounded-xl bg-[#E8EEFB] dark:bg-[#1B2740] px-3.5 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-[#5B6577] dark:text-[#9AA3B2]">{k}</div>
                <div className="mt-0.5 text-[15.5px] font-bold tabular-nums leading-snug">{v}</div>
                <div className="mt-0.5 text-[11px] text-[#5B6577] dark:text-[#9AA3B2] truncate" title={sub}>{sub}</div>
              </div>
            ))}
          </div>

          {/* Consolidated Folio-Wise & Asset Holdings Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#0B2545] text-white">
                  {HEAD.map((h) => (
                    <th key={h} className="border border-[#2B3644] px-1.5 py-1.5 text-center font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => {
                  const sig = r.fh_signal;
                  return (
                    <tr key={i} className="odd:bg-white even:bg-[#F8FAFB] dark:odd:bg-[#171E2A] dark:even:bg-[#1B2432]">
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{i + 1}</td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 min-w-[210px]">
                        <input className={cell} value={r.name} onChange={(e) => patchRow(i, { name: e.target.value })} />
                        {(r.category || r.asset_class || r.isin || r.code) && (
                          <div className={`${hint} px-1`}>
                            {[r.asset_class, r.category, r.code ? `AMFI ${r.code}` : "", r.isin || "", r.flag === "†" ? "† < 1 yr" : r.flag === "*" ? "* est. date" : ""].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 w-28">
                        <input className={cell} value={r.folio} onChange={(e) => patchRow(i, { folio: e.target.value })} />
                      </td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 w-36">
                        <input
                          className={cell}
                          placeholder="e.g. Jan-20 – Oct-26"
                          value={r.period ?? ""}
                          onChange={(e) => patchRow(i, { period: e.target.value })}
                        />
                      </td>
                      {NUM_COLS.slice(0, 7).map((k) => (
                        <td key={k} className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5">
                          <input
                            className={`${cell} text-right`}
                            inputMode="decimal"
                            value={r[k]}
                            onChange={(e) => !isNaN(+e.target.value) && patchRow(i, { [k]: e.target.value === "" ? 0 : +e.target.value })}
                          />
                        </td>
                      ))}
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">
                        {totals.value ? inr((r.value / totals.value) * 100) : "-"}
                      </td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-right tabular-nums">
                        {r.invested ? inr((r.value / r.invested - 1) * 100) : "-"}
                      </td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 w-24">
                        <input
                          className={`${cell} text-right font-semibold`}
                          inputMode="decimal"
                          value={r.ann_ret}
                          onChange={(e) => !isNaN(+e.target.value) && patchRow(i, { ann_ret: e.target.value === "" ? 0 : +e.target.value })}
                        />
                      </td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 py-1 text-[11px] tabular-nums">
                        {sig ? (
                          <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${SIG_BADGE[sig] ?? SIG_BADGE["Needs review"]}`}>
                            {sig}{r.fh_score != null ? ` · ${r.fh_score.toFixed(1)}` : ""}
                          </span>
                        ) : "—"}
                        {r.lead_n500_pct != null && (
                          <div className={`mt-0.5 font-semibold ${r.lead_n500_pct >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                            {pctSigned(r.lead_n500_pct, 1)} vs N500
                          </div>
                        )}
                      </td>
                      <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-1.5 text-center">
                        <button
                          type="button"
                          aria-label={`Remove row ${i + 1}`}
                          disabled={report.rows.length <= 1}
                          className="text-[#B42318] dark:text-[#FF7D86] disabled:opacity-30"
                          onClick={() => setReport({ ...report, rows: report.rows.filter((_, j) => j !== i) })}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-[#E8EEFB] dark:bg-[#1B2740] font-bold">
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5" colSpan={3}>Grand Total</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-center text-[11.5px]">{report.client.timeframe || tf?.summary || "-"}</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(totals.invested)}</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(report.rows.reduce((s, r) => s + r.investments, 0))}</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(report.rows.reduce((s, r) => s + r.div_reinv, 0))}</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(report.rows.reduce((s, r) => s + r.div_payout, 0))}</td>
                  <td colSpan={2} className="border border-[#C9D2E3] dark:border-[#2B3644]" />
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(totals.value)}</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right">100.00</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{inr(totals.abs)}</td>
                  <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-1.5 text-right tabular-nums">{report.xirr ?? "-"}</td>
                  <td colSpan={2} className="border border-[#C9D2E3] dark:border-[#2B3644]" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Investment Matrices Section */}
          {mat && (
            <details open className="rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F8FAFB] dark:bg-[#1B2432] p-4">
              <summary className="cursor-pointer text-[14px] font-bold text-[#0B2545] dark:text-[#75E1CE]">
                Investment Matrices — Asset &amp; Category Allocation, 4-Index Nifty Benchmark Matrix, Capture Ratios, Drawdowns &amp; Stress Test
              </summary>
              <div className="mt-3.5 space-y-5">
                {/* 1. Asset & Category Allocation Matrices */}
                {((mat.asset_allocation && mat.asset_allocation.length > 0) || (mat.category_allocation && mat.category_allocation.length > 0)) && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {mat.asset_allocation && mat.asset_allocation.length > 0 && (
                      <div>
                        <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                          Asset Class Allocation Matrix
                        </h4>
                        <div className="mt-1.5 overflow-x-auto">
                          <table className="w-full border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                            <thead>
                              <tr className="bg-[#0B2545] text-white">
                                {["Asset class", "Holdings", "Invested (₹)", "Current value (₹)", "Gain / Loss", "Weight %", "Abs. ret %"].map((h) => (
                                  <th key={h} className="border border-[#2B3644] px-2 py-1 text-left font-semibold">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {mat.asset_allocation.map((a) => (
                                <tr key={a.name}>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 font-semibold">{a.name}</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{a.count}</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">₹{inr(a.invested, 0)}</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">₹{inr(a.value, 0)}</td>
                                  <td className={`border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right font-semibold ${a.gain >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                                    {rsSigned(a.gain)}
                                  </td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{a.weight.toFixed(2)}%</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{a.abs_ret.toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {mat.category_allocation && mat.category_allocation.length > 0 && (
                      <div>
                        <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                          Category Allocation Matrix
                        </h4>
                        <div className="mt-1.5 overflow-x-auto">
                          <table className="w-full border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                            <thead>
                              <tr className="bg-[#0B2545] text-white">
                                {["Category", "Holdings", "Invested (₹)", "Current value (₹)", "Gain / Loss", "Weight %", "Abs. ret %"].map((h) => (
                                  <th key={h} className="border border-[#2B3644] px-2 py-1 text-left font-semibold">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {mat.category_allocation.map((c) => (
                                <tr key={c.name}>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 font-semibold">{c.name}</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{c.count}</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">₹{inr(c.invested, 0)}</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">₹{inr(c.value, 0)}</td>
                                  <td className={`border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right font-semibold ${c.gain >= 0 ? "text-[#147A3D] dark:text-[#6EE7A0]" : "text-[#B42318] dark:text-[#FF7D86]"}`}>
                                    {rsSigned(c.gain)}
                                  </td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{c.weight.toFixed(2)}%</td>
                                  <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{c.abs_ret.toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. 4-Index Nifty Benchmark Comparison Matrix */}
                {cmp?.matrix_rows && cmp.matrix_rows.length > 0 && (
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="text-[13px] font-bold text-[#0B2545] dark:text-[#75E1CE]">
                        4-Index Nifty Benchmark Comparison Matrix — Portfolio beat {cmp.indices_beaten ?? 0} of 4 Nifty indices
                      </h4>
                      {cmp.primary_bench_label && (
                        <span className={hint}>
                          Primary benchmark: <b>{cmp.primary_bench_label}</b>
                          {cmp.primary_bench_ahead_inr != null ? ` (${rsSigned(cmp.primary_bench_ahead_inr)})` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 overflow-x-auto">
                      <table className="w-full min-w-[780px] border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                        <thead>
                          <tr className="bg-[#0B2545] text-white">
                            <th className="border border-[#2B3644] px-2 py-1.5 text-left font-semibold">Fund</th>
                            <th className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">Period</th>
                            <th className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">Your return</th>
                            {([
                              ["n50", "Nifty 50"],
                              ["n500", "Nifty 500 TRI"],
                              ["mid150", "Nifty Midcap 150 TRI"],
                              ["small250", "Nifty Smallcap 250 TRI"],
                            ] as const).map(([k, lbl]) => (
                              <th key={k} className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">
                                {lbl}{cmp.primary_bench_key === k ? "*" : ""}
                              </th>
                            ))}
                            <th className="border border-[#2B3644] px-2 py-1.5 text-center font-semibold">Indices beaten</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cmp.matrix_rows.map((mr, idx) => (
                            <tr key={idx}>
                              <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 font-semibold">
                                <div>{mr.name}</div>
                                {mr.bench_label && <div className={hint}>SEBI Benchmark: {mr.bench_label}</div>}
                              </td>
                              <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{mr.period || "—"}</td>
                              <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center font-bold">{mr.ret.toFixed(2)}%</td>
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
                              <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center font-bold">{mr.beaten} of 4</td>
                            </tr>
                          ))}
                          {cmp.index_totals && (
                            <tr className="bg-[#E8EEFB] dark:bg-[#1B2740] font-bold">
                              <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1.5">Total portfolio (same instalments)</td>
                              <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1.5 text-center">{report.client.timeframe || tf?.summary || "—"}</td>
                              <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1.5 text-center">{(cmp.portfolio_xirr ?? report.xirr ?? 0).toFixed(2)}%</td>
                              {(["n50", "n500", "mid150", "small250"] as const).map((k) => {
                                const tc = cmp.index_totals?.[k];
                                return (
                                  <td key={k} className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1 text-center">
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
                              <td className="border border-[#C9D2E3] dark:border-[#2B3644] px-2 py-1.5 text-center">{cmp.indices_beaten ?? 0} of 4</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. Fund Horizon Quality, Risk, Capture Ratios & Drawdown Matrix */}
                {mat.risk_matrix && mat.risk_matrix.length > 0 && (
                  <div>
                    <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                      Fund Horizon Quality, Capture Ratios &amp; Drawdown Matrix
                    </h4>
                    <div className="mt-1.5 overflow-x-auto">
                      <table className="w-full min-w-[780px] border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                        <thead>
                          <tr className="bg-[#0B2545] text-white">
                            {["Scheme", "Category", "Value (₹)", "3Y CAGR", "Up Capture", "Down Capture", "Capture Ratio", "Max Fall (3Y)", "Max Fall (All)", "FH Score", "FH Signal", "NAV Date"].map((h) => (
                              <th key={h} className="border border-[#2B3644] px-2 py-1 text-left font-semibold">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mat.risk_matrix.map((rm) => {
                            const sig = rm.fh_signal || (rm.reason ? "Excluded" : "—");
                            return (
                              <tr key={rm.code}>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 font-semibold">
                                  {rm.name}{rm.recommended ? " ★" : ""}
                                </td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1">{rm.category || "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">₹{inr(rm.value, 0)}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right">{rm.cagr_3y != null ? `${rm.cagr_3y.toFixed(2)}%` : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{rm.cap_up_3y != null ? `${rm.cap_up_3y.toFixed(0)}%` : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{rm.cap_down_3y != null ? `${rm.cap_down_3y.toFixed(0)}%` : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center font-bold">{rm.cap_ratio_3y != null ? rm.cap_ratio_3y.toFixed(2) : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right text-[#B42318] dark:text-[#FF7D86]">{rm.max_dd_3y != null ? `${rm.max_dd_3y.toFixed(1)}%` : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-right text-[#B42318] dark:text-[#FF7D86]">{rm.max_dd_all != null ? `${rm.max_dd_all.toFixed(1)}%` : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center font-bold">{rm.fh_score != null ? rm.fh_score.toFixed(1) : "—"}</td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">
                                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SIG_BADGE[sig] ?? SIG_BADGE["Needs review"]}`}>{sig}</span>
                                </td>
                                <td className="border border-[#E4E9EF] dark:border-[#2B3644] px-2 py-1 text-center">{rm.nav_date || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 4. Stress Test & Observations */}
                {((mat.stress_test && mat.stress_test.length > 0) || (mat.recommendations && mat.recommendations.length > 0)) && (
                  <div className="grid gap-4 md:grid-cols-2">
                    {mat.stress_test && mat.stress_test.length > 0 && (
                      <div>
                        <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                          Stress Test Matrix: What if markets fall again?
                        </h4>
                        <div className="mt-1.5 overflow-x-auto">
                          <table className="w-full border-collapse bg-white dark:bg-[#171E2A] text-[12px] tabular-nums">
                            <thead>
                              <tr className="bg-[#0B2545] text-white">
                                {["Scenario", "Covered", "Est. change", "On covered"].map((h) => (
                                  <th key={h} className="border border-[#2B3644] px-2 py-1 text-left font-semibold">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {mat.stress_test.map((st, i) => (
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
                    )}
                    {mat.recommendations && mat.recommendations.length > 0 && (
                      <div>
                        <h4 className="text-[12.5px] font-bold uppercase tracking-wider text-[#5B6577] dark:text-[#9AA3B2]">
                          Portfolio Observations &amp; Actionable Flags
                        </h4>
                        <ul className="mt-1.5 space-y-1.5 text-[12.5px]">
                          {mat.recommendations.map((rec, i) => (
                            <li key={i} className="rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-2">
                              <div className="font-bold text-[#0B2545] dark:text-[#75E1CE]">{rec.title}</div>
                              <div className="mt-0.5 text-[#475467] dark:text-[#9AA3B2]">{rec.body}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          )}

          {report.factsheets.map((f, fi) => (
            <div key={fi}>
              <h3 className="text-[13.5px] font-bold">Factsheet highlights — {f.source}</h3>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                {f.items.map((it, ii) => (
                  <div key={ii} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 text-[12.5px]">{it.label}</span>
                    <input
                      className={cell}
                      value={it.value}
                      onChange={(e) => setReport({
                        ...report,
                        factsheets: report.factsheets.map((x, a) => (a === fi ? { ...x, items: x.items.map((y, b) => (b === ii ? { ...y, value: e.target.value } : y)) } : x)),
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
            <button type="button" className={btn} onClick={download} disabled={busy !== null}>
              {busy === "pdf" ? "Building…" : "⬇ Download Consolidated PDF"}
            </button>
            <button type="button" className={btnPrimary} onClick={push} disabled={busy !== null || !customerId} title={customerId ? undefined : "Select a client above first"}>
              {busy === "push" ? "Pushing…" : `Push to ${customerName ?? "client"} CRM`}
            </button>
            <label className="inline-flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /> Also email the PDF to the client
            </label>
            {!customerId && <span className="text-[12.5px] text-[#9A6700] dark:text-[#F5C451]">Select a Client / Household above to push &amp; email.</span>}
          </div>

          {customerId && history.length > 0 && (
            <div className="border-t border-[#E4E9EF] dark:border-[#2B3644] pt-3">
              <h3 className="text-[13px] font-bold">Saved client reports for this client</h3>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {history.map((h) => (
                  <button key={h.id} type="button" className={btn} disabled={busy !== null} onClick={() => redownload(h.id, h.report_date)}>
                    ⬇ {h.report_date || "Report"}{h.emailed_at ? " · emailed" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
