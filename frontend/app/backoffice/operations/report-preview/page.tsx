"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { PREVIEW_KEY, call } from "@/components/operations/ClientReport";
import ExplainViewer from "@/components/operations/ExplainViewer";

// Keys match SECTION_KEYS in backend/app/report/client_report.py; the PDF prints the ticked ones in the order shown here.
const SECTIONS: [string, string][] = [
  ["kpi", "Headline KPI banner"],
  ["summary", "Portfolio summary (asset-class totals, XIRR, data gaps)"],
  ["pms", "PMS accounts (provider, contribution, withdrawal, value as on)"],
  ["holdings", "1. Folio & holding-wise valuation table"],
  ["fy", "Financial-year summary (value, new investments, XIRR, allocation)"],
  ["charts", "1B. Visual analytics & graphs"],
  ["alloc", "2. Asset-class & category allocation"],
  ["heatmap", "2B. Category-wise flows & valuation heatmap"],
  ["cashflow", "2C/2D. Period cash-flow & monthly inflow trend"],
  ["benchmark", "3. Nifty index benchmark comparison"],
  ["risk", "4. Quality, risk, capture & drawdown matrix"],
  ["stress", "5. Stress test & portfolio observations"],
  ["transactions", "Transaction report (dated transactions per folio)"],
  ["factsheets", "Factsheet & strategy highlights"],
  ["notes", "Notes & regulatory disclosures"],
  ["annex", "Transaction annexure: attached source statements"],
];
const LABEL = Object.fromEntries(SECTIONS);
const fyOf = (iso: string) => { const y = +iso.slice(0, 4) - (+iso.slice(5, 7) < 4 ? 1 : 0); return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };

type Fmt = { margins: { left: number; right: number; top: number; bottom: number }; font_scale: number; indent_mm: number; hide_empty: boolean; hidden: string[]; edits: [string, string][] };
const FMT0: Fmt = { margins: { left: 10, right: 10, top: 10, bottom: 13 }, font_scale: 1, indent_mm: 0, hide_empty: false, hidden: [], edits: [] };
const MARGIN_LABEL = { left: "Left", right: "Right", top: "Top", bottom: "Bottom" } as const;

type Rep = { client: { name?: string; date?: string }; attach_statements?: boolean } & Record<string, unknown>;

export default function ReportPreview() {
  const [report, setReport] = useState<Rep | null | undefined>(undefined); // undefined = still reading storage
  const [order, setOrder] = useState<string[]>(SECTIONS.map(([k]) => k));
  const [picked, setPicked] = useState<Set<string>>(new Set(SECTIONS.map(([k]) => k).filter((k) => k !== "transactions"))); // the transaction report is long: opt-in
  const [years, setYears] = useState<Set<string> | null>(null); // FYs shown in the transaction report; null = all
  const [drag, setDrag] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blobUrl = useRef<string | null>(null);
  const [explainOn, setExplainOn] = useState(false); // hover-to-explain viewer instead of the browser PDF viewer
  const [fmt, setFmt] = useState<Fmt>(FMT0);
  const [past, setPast] = useState<Fmt[]>([]); // undo stack of layout / removed lines / text edits
  const lastEdit = useRef({ key: "", at: 0 });
  // key: typing in one field is one undo step (edits made within 1.5 s of each other in the same field are merged)
  const change = (fn: (f: Fmt) => Fmt, key = "") => {
    const now = Date.now(), same = key && lastEdit.current.key === key && now - lastEdit.current.at < 1500;
    lastEdit.current = { key, at: now };
    if (!same) setPast((p) => [...p.slice(-49), fmt]);
    setFmt(fn(fmt));
  };
  const undo = () => { const prev = past[past.length - 1]; if (!prev) return; setPast(past.slice(0, -1)); setFmt(prev); };

  useEffect(() => {
    let r: Rep | null = null;
    try { r = JSON.parse(localStorage.getItem(PREVIEW_KEY) || "null"); } catch { /* corrupt or blocked */ }
    setReport(r);
    if (r?.attach_statements === false) setPicked((p) => { const n = new Set(p); n.delete("annex"); return n; });
  }, []);

  const allYears = useMemo(() => {
    const rows = (report?.rows ?? []) as { flows?: [string, number][] }[];
    return Array.from(new Set(rows.flatMap((r) => (r.flows ?? []).map(([d]) => String(d)).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).map(fyOf)))).sort();
  }, [report]);
  // FY lines with no data at all in every table ("-" everywhere): offered for removal
  const emptyFys = useMemo(() => {
    const ys = ((report?.matrices as { fy?: { years?: { fy: string; value: unknown; new: unknown; xirr: Record<string, unknown>; alloc: unknown }[] } } | undefined)?.fy?.years) ?? [];
    return ys.filter((y) => y.value == null && y.new == null && !y.alloc && Object.values(y.xirr ?? {}).every((v) => v == null)).map((y) => y.fy);
  }, [report]);
  const chosen = useMemo(() => order.filter((k) => picked.has(k)), [order, picked]);
  const move = (k: string, to: number) => setOrder((o) => { const n = o.filter((x) => x !== k); n.splice(Math.max(0, Math.min(to, n.length)), 0, k); return n; });

  // Rebuild the PDF 120 ms after the last tick; a newer tick aborts the in-flight build.
  useEffect(() => {
    if (!report || !picked.size) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const blob = await call<Blob>("/pdf", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({ ...report, sections: chosen, attach_statements: picked.has("annex"), txn_years: years && years.size < allYears.length ? Array.from(years) : null,
            layout: { margins_mm: fmt.margins, font_scale: fmt.font_scale, indent_mm: fmt.indent_mm, hide_empty: fmt.hide_empty, hidden_rows: fmt.hidden, edits: Object.fromEntries(fmt.edits.filter(([a]) => a.trim())) } }),
        }, true);
        if (ctl.signal.aborted) return;
        if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = URL.createObjectURL(blob);
        setUrl(blobUrl.current);
      } catch (e) {
        if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "Could not build the PDF.");
      } finally { if (!ctl.signal.aborted) setBusy(false); }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [report, picked, chosen, years, allYears.length, fmt]);

  useEffect(() => () => { if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); }, []);

  const fileName = useMemo(() => `Portfolio Valuation Report - ${report?.client?.name || "Client"} - ${report?.client?.date || "Report"}.pdf`, [report]);
  const toggleYear = (y: string) => setYears((p) => { const n = new Set(p ?? allYears); if (n.has(y)) n.delete(y); else n.add(y); return n; });
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
  const field = "w-full rounded-md border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#0F151F] px-2 py-1 text-[12.5px]";
  const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-3";
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";

  if (report === undefined) return <p className="text-[13px]">Loading…</p>;
  if (report === null) return (
    <p className="text-[13px]">No report to preview. Go back to Operations → Client report, build the report, then click “Download Consolidated PDF”.</p>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[16px] font-bold">PDF preview — {report.client?.name || "Client"}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[#667085] dark:text-[#9AA3B2]" role="status">{busy ? "Updating preview…" : `${chosen.length} of ${SECTIONS.length} sections`}</span>
          <button type="button" className={btn} disabled={!past.length} onClick={undo}>↶ Undo</button>
          <a className={`${btnPrimary} ${!url || busy || !picked.size ? "pointer-events-none opacity-40" : ""}`} href={url ?? undefined} download={fileName} aria-disabled={!url || busy || !picked.size}>
            ⬇ Download PDF
          </a>
        </div>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex flex-col gap-3 lg:w-[340px] lg:shrink-0">
        <fieldset className={card}>
          <legend className="px-1 text-[12.5px] font-semibold">Sections in the PDF</legend>
          <div className="mb-2 flex gap-2">
            <button type="button" className={btn} onClick={() => setPicked(new Set(SECTIONS.map(([k]) => k)))}>Select all</button>
            <button type="button" className={btn} onClick={() => setPicked(new Set())}>Clear</button>
          </div>
          <p className="mb-1 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">Drag a section (or use ▲ ▼) to set the order it prints in.</p>
          <ul className="space-y-1.5">
            {order.map((k, i) => (
              <li key={k} draggable onDragStart={() => setDrag(k)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (drag && drag !== k) move(drag, i); setDrag(null); }}
                className={`flex items-start gap-2 rounded-md border border-transparent px-1 py-0.5 ${drag === k ? "opacity-40" : "hover:border-[#E4E9EF] dark:hover:border-[#2B3644]"}`}>
                <span aria-hidden className="mt-0.5 cursor-grab select-none text-[#98A2B3]">⠿</span>
                <label className="flex flex-1 cursor-pointer items-start gap-2 text-[12.5px]">
                  <input type="checkbox" className="mt-0.5" checked={picked.has(k)} onChange={() => toggle(k)} /> {LABEL[k]}
                </label>
                <button type="button" aria-label={`Move ${LABEL[k]} up`} disabled={i === 0} onClick={() => move(k, i - 1)} className="px-1 text-[12px] disabled:opacity-30">▲</button>
                <button type="button" aria-label={`Move ${LABEL[k]} down`} disabled={i === order.length - 1} onClick={() => move(k, i + 1)} className="px-1 text-[12px] disabled:opacity-30">▼</button>
              </li>
            ))}
          </ul>
          {picked.has("transactions") && allYears.length > 0 && (
            <div className="mt-3 border-t border-[#E4E9EF] dark:border-[#2B3644] pt-2">
              <p className="mb-1 text-[12.5px] font-semibold">Years in the transaction report</p>
              <div className="mb-1 flex gap-2">
                <button type="button" className={btn} onClick={() => setYears(null)}>All years</button>
                <button type="button" className={btn} onClick={() => setYears(new Set())}>None</button>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {allYears.map((y) => (
                  <label key={y} className="flex cursor-pointer items-center gap-1 text-[12px]">
                    <input type="checkbox" checked={years === null || years.has(y)} onChange={() => toggleYear(y)} /> {y}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">Totals outside the chosen years are stated under each folio, not hidden.</p>
            </div>
          )}
        </fieldset>
        <fieldset className={card}>
          <legend className="px-1 text-[12.5px] font-semibold">Empty lines</legend>
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={fmt.hide_empty} onChange={(e) => change((f) => ({ ...f, hide_empty: e.target.checked }))} /> Remove every line that has no data
          </label>
          {emptyFys.length ? (
            <>
              <p className="mb-1 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">Or remove them one by one. Faded lines will not print. Click ↺ to bring one back.</p>
              <div className="flex flex-wrap gap-1.5">
                {emptyFys.map((y) => { const off = fmt.hidden.includes(y) || fmt.hide_empty; return (
                  <span key={y} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] ${off ? "border-dashed border-[#B42318] text-[#B42318]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
                    <span className={off ? "line-through opacity-50 blur-[1px]" : ""}>{y}</span>
                    <button type="button" aria-label={off ? `Restore ${y}` : `Remove ${y}`} disabled={fmt.hide_empty}
                      onClick={() => change((f) => ({ ...f, hidden: f.hidden.includes(y) ? f.hidden.filter((x) => x !== y) : [...f.hidden, y] }))} className="font-bold disabled:opacity-40">{off ? "↺" : "✕"}</button>
                  </span>); })}
              </div>
            </>
          ) : <p className="text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">No empty financial-year lines in this report.</p>}
        </fieldset>
        <fieldset className={card}>
          <legend className="px-1 text-[12.5px] font-semibold">Page layout</legend>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(MARGIN_LABEL) as (keyof Fmt["margins"])[]).map((k) => (
              <label key={k} className="text-[11.5px]">{MARGIN_LABEL[k]} margin (mm)
                <input type="number" min={5} max={30} className={field} value={fmt.margins[k]} onChange={(e) => change((f) => ({ ...f, margins: { ...f.margins, [k]: num(e.target.value, 5, 30) } }), `m${k}`)} />
              </label>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11.5px]">Text size
              <select className={field} value={fmt.font_scale} onChange={(e) => change((f) => ({ ...f, font_scale: Number(e.target.value) }))}>
                {[0.9, 1, 1.1, 1.2].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
              </select>
            </label>
            <label className="text-[11.5px]">Heading indent (mm)
              <input type="number" min={0} max={20} className={field} value={fmt.indent_mm} onChange={(e) => change((f) => ({ ...f, indent_mm: num(e.target.value, 0, 20) }), "indent")} />
            </label>
          </div>
          <button type="button" className={`${btn} mt-2`} onClick={() => change(() => FMT0)}>Reset layout and edits</button>
        </fieldset>
        <fieldset className={card}>
          <legend className="px-1 text-[12.5px] font-semibold">Edit text</legend>
          <label className="text-[11.5px]">Client name
            <input className={field} value={report.client?.name ?? ""} onChange={(e) => setReport({ ...report, client: { ...report.client, name: e.target.value } })} />
          </label>
          <p className="mb-1 mt-2 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">Change any wording in the report: type the text as printed, then the new text. It is replaced everywhere it appears.</p>
          {fmt.edits.map(([a, b], i) => (
            <div key={i} className="mb-1.5 flex items-center gap-1.5">
              <input aria-label="Text to find" placeholder="Printed text" className={field} value={a} onChange={(e) => change((f) => ({ ...f, edits: f.edits.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) }), `ef${i}`)} />
              <input aria-label="Replace with" placeholder="New text" className={field} value={b} onChange={(e) => change((f) => ({ ...f, edits: f.edits.map((x, j) => (j === i ? [x[0], e.target.value] : x)) }), `er${i}`)} />
              <button type="button" aria-label="Remove this edit" className="px-1 font-bold" onClick={() => change((f) => ({ ...f, edits: f.edits.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => change((f) => ({ ...f, edits: [...f.edits, ["", ""]] }))}>+ Add an edit</button>
        </fieldset>
        </div>
        <div className="min-w-0 flex-1">
          {err && <p role="alert" className="mb-2 rounded-lg bg-[#FDECEB] px-3 py-2 text-[12.5px] text-[#B42318]">{err}</p>}
          {!picked.size ? <p className="text-[13px]">Tick at least one section.</p> : url ? (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <button type="button" aria-pressed={explainOn} className={explainOn ? btnPrimary : btn} onClick={() => setExplainOn((v) => !v)}>
                  {explainOn ? "Explain on hover: on" : "Explain on hover: off"}
                </button>
                <span className="text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">{explainOn ? "Point at or tap any box to see how it is calculated." : "Turn on, then point at any box in the report."}</span>
              </div>
              {explainOn ? <ExplainViewer url={url} /> : <iframe key={url} title="Consolidated PDF preview" src={url} className="h-[78vh] w-full rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white" />}
              <p className="mt-1 text-[11.5px] text-[#667085] dark:text-[#9AA3B2]">Phone or tablet not showing every page? <a className="underline" href={url} target="_blank" rel="noreferrer">Open the full PDF</a>.</p>
            </>
          ) : <p className="text-[13px]">Building preview…</p>}
        </div>
      </div>
    </div>
  );
}
