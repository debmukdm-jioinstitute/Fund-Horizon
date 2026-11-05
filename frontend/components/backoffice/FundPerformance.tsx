"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import FundSearch from "@/components/backoffice/FundSearch";
import { apiBlob, apiGet } from "@/lib/apiGet";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

interface Col { key: string; label: string; group: string | null; kind: string | null }
type Cell = string | number | null;
interface Table { title: string; columns: Col[]; rows: Record<string, Cell>[]; note: string; as_of: string }
interface Meta { categories: string[]; amcs: string[] }
interface Pick { code: string; name: string }

const TABS = [["trailing", "Trailing returns"], ["mcap", "Trailing returns with market cap"], ["annual", "Annual returns"], ["compare", "Returns comparison"], ["lumpsum", "Lumpsum returns"],
  ["lumpsum-multi", "Lumpsum returns, multiple funds"], ["consistent", "Consistent performers"], ["assets", "Comparison with asset classes"], ["monthly", "Monthly / quarterly returns"],
  ["best", "Best performing fund"], ["p2p", "Point to point returns"]] as const;
const LUMP_YEARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
type Tab = (typeof TABS)[number][0];
const PERIODS = [["ytd", "YTD"], ["1w", "1 Week"], ["1m", "1 Month"], ["3m", "3 Months"], ["6m", "6 Months"], ["1y", "1 Year"], ["3y", "3 Years"], ["5y", "5 Years"], ["10y", "10 Years"], ["si", "Since launch"]];
const SIZES = [10, 15, 25, 50, DEFAULT_PAGE_SIZE, 0];
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const field = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-[13.5px]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const hint = "text-[12px] text-[#667085] dark:text-[#9AA3B2]";
const lbl = "text-[12px] font-semibold";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = iso(new Date());
const yearsAgo = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return iso(d); };
const tone = (v: Cell, kind: string | null) => (kind === "ret" && typeof v === "number" ? (v < 0 ? "text-[#B42318] dark:text-[#FDA29B]" : "text-[#067647] dark:text-[#75E1A0]") : "");
const show = (v: Cell) => (v == null ? "-" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }) : v);

function FundPicker({ picks, setPicks, max }: { picks: Pick[]; setPicks: (p: Pick[]) => void; max: number }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {picks.map((p) => <span key={p.code} className="inline-flex items-center gap-1.5 rounded-lg bg-[#E6F2F0] px-2.5 py-1 text-[12.5px] font-semibold text-[#006F64] dark:bg-[#0C2B28] dark:text-[#75E1CE]">{p.name}
          <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPicks(picks.filter((x) => x.code !== p.code))}>×</button></span>)}
      </div>
      {picks.length < max && <FundSearch id="perf-fund-hits" exclude={picks.map((p) => p.code)} placeholder={`Type a fund name or scheme code (${picks.length}/${max})`}
        onPick={(h) => { if (!picks.some((p) => p.code === h.code)) setPicks([...picks, { code: h.code, name: h.name }]); }} />}
    </div>
  );
}

function csv(t: Table, rows: Record<string, Cell>[]) {
  const esc = (v: Cell) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = t.columns.map((c) => (c.group ? `${c.group} ${c.label}` : c.label));
  return [head, ...rows.map((r) => t.columns.map((c) => r[c.key] ?? ""))].map((r) => r.map(esc).join(",")).join("\n");
}

export function Result({ t }: { t: Table }) {
  const [q, setQ] = useState("");
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = t.rows.filter((r) => !term || Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(term)));
    if (!sort) return f;
    return [...f].sort((a, b) => { const x = a[sort.key], y = b[sort.key]; if (x == null) return 1; if (y == null) return -1; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir; });
  }, [t, q, sort]);
  const shown = size === 0 ? rows : rows.slice(page * size, page * size + size);
  const pages = size === 0 ? 1 : Math.max(1, Math.ceil(rows.length / size));
  const grouped = t.columns.some((c) => c.group);
  const groups: { label: string; span: number }[] = [];
  for (const c of t.columns) { if (!c.group) continue; const l = groups.at(-1); if (l && l.label === c.group && t.columns.indexOf(c) > 0 && t.columns[t.columns.indexOf(c) - 1].group === c.group) l.span++; else groups.push({ label: c.group, span: 1 }); }
  const th = "px-2 py-1.5 text-[11.5px] font-semibold whitespace-nowrap cursor-pointer select-none";
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const pdf = async () => {
    setPdfBusy(true); setPdfErr("");
    try {
      const blob = await apiBlob("/api/backoffice/mutual-funds/performance/pdf", { title: t.title, columns: t.columns, rows, note: t.note, as_of: t.as_of });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${t.title}.pdf`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setPdfErr(e instanceof Error ? e.message : "Could not create the PDF."); } finally { setPdfBusy(false); }
  };
  const sortBy = (key: string) => { setSort((s) => ({ key, dir: s?.key === key && s.dir === 1 ? -1 : 1 })); setPage(0); };
  const download = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv(t, rows)], { type: "text/csv" })); a.download = `${t.title}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  return (
    <div className={`${card} space-y-3 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold">{t.title} <span className={hint}>· NAV as on {t.as_of}</span></h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12.5px]">Show <select className={field} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>{SIZES.map((n) => <option key={n} value={n}>{n === 0 ? "All" : n}</option>)}</select> entries</label>
          <input className={`${field} w-48`} type="search" aria-label="Search" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <button type="button" className={btn} onClick={download} disabled={!rows.length}>Excel (CSV)</button>
          <button type="button" className={btn} onClick={pdf} disabled={!rows.length || pdfBusy}>{pdfBusy ? "Preparing…" : "PDF"}</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#183883] text-white">
              {(() => {
                const cells: React.ReactNode[] = [];
                let g = 0;
                for (let i = 0; i < t.columns.length; i++) {
                  const c = t.columns[i];
                  if (!c.group) cells.push(<th key={c.key} rowSpan={grouped ? 2 : 1} className={`${th} ${c.key === "scheme" ? "text-left" : "text-right"}`} onClick={() => sortBy(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>);
                  else if (i === 0 || t.columns[i - 1].group !== c.group) cells.push(<th key={`g${g}`} colSpan={groups[g++].span} className="border-l border-white/20 px-2 py-1.5 text-center text-[11.5px] font-semibold">{c.group}</th>);
                }
                return cells;
              })()}
            </tr>
            {grouped && <tr className="bg-[#183883] text-white">{t.columns.filter((c) => c.group).map((c) => <th key={c.key} className={`${th} text-right`} onClick={() => sortBy(c.key)}>{c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>)}</tr>}
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.code ?? r.scheme}-${r.year ?? ""}-${i}`} className="border-b border-[#E4E9EF] dark:border-[#2B3644] odd:bg-[#F5F7FB] dark:odd:bg-[#1B2433]" title={typeof r.note === "string" ? r.note : undefined}>
                {t.columns.map((c) => <td key={c.key} className={`px-2 py-1.5 text-[12.5px] tabular-nums ${c.key === "scheme" ? "text-left font-semibold" : "text-right"} ${tone(r[c.key], c.kind)}`}>{show(r[c.key])}</td>)}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={t.columns.length} className="px-2 py-6 text-center text-[13px] text-[#667085]">{t.rows.length ? "Nothing matches the search." : "No schemes found for these choices."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className={hint}>Showing {rows.length ? (size === 0 ? 1 : page * size + 1) : 0} to {size === 0 ? rows.length : Math.min(rows.length, page * size + size)} of {rows.length} entries</span>
        <div className="flex items-center gap-2"><button type="button" className={btn} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page + 1} / {pages}</span><button type="button" className={btn} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      </div>
      {pdfErr && <p role="alert" className="text-[12.5px] font-medium text-[#B42318]">{pdfErr}</p>}
      <p className={hint}>{t.note}</p>
    </div>
  );
}

export default function FundPerformance() {
  const [tab, setTab] = useState<Tab>("trailing");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [category, setCategory] = useState("Equity: Large Cap");
  const [plan, setPlan] = useState("Regular");
  const [period, setPeriod] = useState("gt1y");
  const [rank, setRank] = useState("true");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [amount, setAmount] = useState("100000");
  const [start, setStart] = useState(yearsAgo(1));
  const [end, setEnd] = useState(today);
  const [ranges, setRanges] = useState<[string, string][]>([[yearsAgo(1), today]]);
  const [perFund, setPerFund] = useState(false); // one date range per fund instead of one for all
  const [fundRanges, setFundRanges] = useState<Record<string, [string, string]>>({});
  const [lumpYears, setLumpYears] = useState("5");
  const [mode, setMode] = useState("Monthly");
  const [years, setYears] = useState<number[]>([new Date().getFullYear() - 1]);
  const [amcs, setAmcs] = useState<string[]>(["5 Largest Fund Houses"]);
  const [bestPeriod, setBestPeriod] = useState("1y");
  const [ftype, setFtype] = useState("Open");
  const [startYear, setStartYear] = useState(String(new Date().getFullYear() - 10));
  const [table, setTable] = useState<Table | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<Meta>("/api/backoffice/mutual-funds/performance/meta").then(setMeta).catch((e) => setErr(e instanceof Error ? e.message : "Could not load the options."));
    const t = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some(([k]) => k === t)) setTab(t as Tab);
  }, []);
  const choose = (t: Tab) => { setTab(t); setTable(null); setErr(""); window.history.replaceState(null, "", `?tab=${t}`); };
  const thisYear = new Date().getFullYear();
  const amt = Number(amount.replace(/,/g, ""));

  const query = (): string | null => {
    const P = (o: Record<string, string>, extra: [string, string][] = []) => { const u = new URLSearchParams(o); extra.forEach(([k, v]) => u.append(k, v)); return u.toString(); };
    switch (tab) {
      case "trailing": return `trailing?${P({ category, period, rank, plan })}`;
      case "annual": return `annual?${P({ category, plan })}`;
      case "consistent": return `consistent?${P({ category, plan })}`;
      case "compare": case "lumpsum": {
        if (!picks.length) { setErr("Please select a fund."); return null; }
        if (!(amt > 0)) { setErr("Please enter a valid amount."); return null; }
        const rs: [string, string][] = perFund ? picks.map((p) => fundRanges[p.code] ?? [start, end]) : [[start, end]];
        if (rs.some(([a, b]) => !a || !b)) { setErr("Please select the start and end dates."); return null; }
        if (rs.some(([a, b]) => b <= a)) { setErr("End date must be after the start date."); return null; }
        return `${tab}?${P({ codes: picks.map((p) => p.code).join(","), amount: String(amt) }, rs.flatMap(([a, b]) => [["start", a], ["end", b]] as [string, string][]))}`;
      }
      case "mcap": return `trailing-mcap?${P({ category, plan })}`;
      case "lumpsum-multi":
        if (!(amt > 0)) { setErr("Please enter a valid amount."); return null; }
        return `lumpsum-multi?${P({ category, plan, years: lumpYears, amount: String(amt) })}`;
      case "assets":
        if (!picks.length) { setErr("Please select a fund."); return null; }
        if (!(amt > 0)) { setErr("Please enter a valid amount."); return null; }
        return `assets?${P({ code: picks[0].code, amount: String(amt), start_year: startYear })}`;
      case "monthly":
        if (!years.length) { setErr("Select one to three valid years."); return null; }
        return `monthly?${P({ category, mode, years: years.join(","), plan })}`;
      case "best":
        if (!amcs.length) { setErr("Please select a fund house."); return null; }
        return `best?${P({ category, period: bestPeriod, ftype, plan }, amcs.map((a) => ["amc", a]))}`;
      case "p2p":
        if (ranges.some(([a, b]) => !a || !b || b <= a)) { setErr("Each date range needs a start date before its end date."); return null; }
        return `p2p?${P({ category, plan }, ranges.flatMap(([a, b]) => [["start", a], ["end", b]] as [string, string][]))}`;
    }
  };
  const run = () => {
    setErr("");
    const q = query();
    if (!q) return;
    setLoading(true);
    apiGet<Table>(`/api/backoffice/mutual-funds/performance/${q}`).then(setTable).catch((e) => { setTable(null); setErr(e instanceof Error ? e.message : "Something went wrong."); }).finally(() => setLoading(false));
  };

  const catSelect = (
    <label className={lbl}>Category<select className={`${field} mt-1 w-full`} value={category} onChange={(e) => setCategory(e.target.value)}>{(meta?.categories ?? [category]).map((c) => <option key={c}>{c}</option>)}</select></label>
  );
  const planSelect = <label className={lbl}>Plan<select className={`${field} mt-1 w-full`} value={plan} onChange={(e) => setPlan(e.target.value)}><option>Regular</option><option>Direct</option></select></label>;
  const funds = (max: number) => <div className="sm:col-span-2"><div className={lbl}>Fund{max > 1 ? "s" : ""} <span className={hint}>(up to {max})</span></div><div className="mt-1"><FundPicker picks={picks} setPicks={setPicks} max={max} /></div></div>;
  const amountBox = <label className={lbl}>Amount (Rs.)<input className={`${field} mt-1 w-full`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ""))} /></label>;
  const dates = <><label className={lbl}>Start date<input type="date" className={`${field} mt-1 w-full`} max={today} value={start} onChange={(e) => setStart(e.target.value)} /></label>
    <label className={lbl}>End date<input type="date" className={`${field} mt-1 w-full`} max={today} value={end} onChange={(e) => setEnd(e.target.value)} /></label></>;
  const yearList = Array.from({ length: thisYear - 1999 }, (_, i) => thisYear - i);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-4 p-5`}>
        <div>
          <h2 className="text-lg font-bold">Fund performance</h2>
          <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Returns reports for clients and research. Category-wide averages are on <Link className="font-semibold text-[#006F64] hover:underline dark:text-[#75E1CE]" href="/backoffice/mutual-funds/category-returns">Category Returns</Link>.</p>
        </div>
        <div role="tablist" className="flex flex-wrap gap-2">
          {TABS.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => choose(k)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${tab === k ? "bg-[#006F64] text-white" : "border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64]"}`}>{l}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tab === "trailing" && <>{catSelect}<label className={lbl}>Period<select className={`${field} mt-1 w-full`} value={period} onChange={(e) => setPeriod(e.target.value)}><option value="gt1y">Greater than 1 year</option><option value="lt1y">Less than 1 year</option></select></label>
            <label className={lbl}>Rank<select className={`${field} mt-1 w-full`} value={rank} onChange={(e) => setRank(e.target.value)}><option value="true">With rank</option><option value="false">Without rank</option></select></label>{planSelect}</>}
          {(tab === "annual" || tab === "consistent" || tab === "mcap") && <>{catSelect}{planSelect}</>}
          {tab === "lumpsum-multi" && <>{catSelect}{planSelect}{amountBox}<label className={lbl}>Period<select className={`${field} mt-1 w-full`} value={lumpYears} onChange={(e) => setLumpYears(e.target.value)}>{LUMP_YEARS.map((y) => <option key={y} value={y}>{y} {y === 1 ? "year" : "years"}</option>)}</select></label></>}
          {(tab === "compare" || tab === "lumpsum") && <>{funds(5)}{amountBox}
            <label className="flex items-center gap-2 text-[12.5px] font-semibold sm:col-span-2 lg:col-span-3"><input type="checkbox" checked={perFund} onChange={(e) => setPerFund(e.target.checked)} disabled={picks.length < 2} /> Different dates for each fund</label>
            {!perFund || picks.length < 2 ? dates : <div className="sm:col-span-2 lg:col-span-3 space-y-2">{picks.map((p) => { const [a, b] = fundRanges[p.code] ?? [start, end]; return (
              <div key={p.code} className="flex flex-wrap items-center gap-2"><span className="w-full text-[12.5px] font-semibold sm:w-72">{p.name}</span>
                <input type="date" aria-label={`Start date for ${p.name}`} className={field} max={today} value={a} onChange={(e) => setFundRanges({ ...fundRanges, [p.code]: [e.target.value, b] })} /><span>to</span>
                <input type="date" aria-label={`End date for ${p.name}`} className={field} max={today} value={b} onChange={(e) => setFundRanges({ ...fundRanges, [p.code]: [a, e.target.value] })} /></div>); })}</div>}</>}
          {tab === "assets" && <>{funds(1)}{amountBox}<label className={lbl}>Start year<select className={`${field} mt-1 w-full`} value={startYear} onChange={(e) => setStartYear(e.target.value)}>{yearList.slice(1).map((y) => <option key={y}>{y}</option>)}</select></label></>}
          {tab === "monthly" && <>{catSelect}<label className={lbl}>Mode<select className={`${field} mt-1 w-full`} value={mode} onChange={(e) => setMode(e.target.value)}><option>Monthly</option><option>Quarterly</option></select></label>{planSelect}
            <fieldset className="sm:col-span-2 lg:col-span-3"><legend className={lbl}>Years <span className={hint}>(up to 3)</span></legend><div className="mt-1 flex flex-wrap gap-2">
              {yearList.slice(0, 12).map((y) => <label key={y} className={`cursor-pointer rounded-lg border px-3 py-1 text-[12.5px] font-semibold ${years.includes(y) ? "border-[#006F64] bg-[#E6F2F0] text-[#006F64] dark:bg-[#0C2B28] dark:text-[#75E1CE]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
                <input type="checkbox" className="sr-only" checked={years.includes(y)} onChange={() => setYears(years.includes(y) ? years.filter((x) => x !== y) : years.length >= 3 ? years : [...years, y])} />{y}</label>)}</div></fieldset></>}
          {tab === "best" && <>{catSelect}<label className={lbl}>Period<select className={`${field} mt-1 w-full`} value={bestPeriod} onChange={(e) => setBestPeriod(e.target.value)}>{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className={lbl}>Type<select className={`${field} mt-1 w-full`} value={ftype} onChange={(e) => setFtype(e.target.value)}><option value="Open">Open ended</option><option value="Close">Closed ended</option></select></label>{planSelect}
            <label className={`${lbl} sm:col-span-2 lg:col-span-2`}>Fund houses <span className={hint}>(hold Ctrl or Cmd to pick several)</span>
              <select multiple size={6} className={`${field} mt-1 w-full`} value={amcs} onChange={(e) => setAmcs(Array.from(e.target.selectedOptions, (o) => o.value))}>{(meta?.amcs ?? amcs).map((a) => <option key={a}>{a}</option>)}</select></label></>}
          {tab === "p2p" && <>{catSelect}{planSelect}<div className="sm:col-span-2 lg:col-span-3 space-y-2"><div className={lbl}>Date ranges <span className={hint}>(up to 5)</span></div>
            {ranges.map(([a, b], i) => <div key={i} className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label={`Start date ${i + 1}`} className={field} max={today} value={a} onChange={(e) => setRanges(ranges.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
              <span>to</span><input type="date" aria-label={`End date ${i + 1}`} className={field} max={today} value={b} onChange={(e) => setRanges(ranges.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
              {ranges.length > 1 && <button type="button" className={btn} onClick={() => setRanges(ranges.filter((_, j) => j !== i))}>Remove</button>}</div>)}
            {ranges.length < 5 && <button type="button" className={btn} onClick={() => setRanges([...ranges, [yearsAgo(1), today]])}>Add date range</button>}</div></>}
        </div>
        <div className="flex items-center gap-2"><button type="button" className={btnPrimary} onClick={run} disabled={loading}>{loading ? "Loading…" : "Submit"}</button></div>
        {err && <p role="alert" className="rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] font-medium text-[#B42318] dark:bg-[#3A1C1C] dark:text-[#FDA29B]">{err}</p>}
      </div>
      {table && <Result key={`${table.title}-${table.rows.length}-${table.as_of}-${table.columns.length}`} t={table} />}
    </div>
  );
}
