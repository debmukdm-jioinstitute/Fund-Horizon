"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL, ApiError, resolveApiUrl } from "@/lib/api";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

interface Stat { count: number; avg: number | null; max: number | null; min: number | null; median: number | null }
interface Row { category: string; funds: number; [period: string]: Stat | string | number }
interface Data {
  fund_type: string; plan: string; periods: { key: string; label: string }[]; rows: Row[]; nav_as_of: string; note: string;
  fund_types: string[]; all_periods: { key: string; label: string }[];
}
const STATS = [["avg", "Avg Rtn (%)"], ["max", "Max Rtn (%)"], ["min", "Min Rtn (%)"], ["median", "Median Rtn (%)"]] as const;
const SIZES = [10, 15, 25, 50, DEFAULT_PAGE_SIZE, 0]; // 0 = all
const FALLBACK_TYPES = ["Equity Schemes", "Debt Schemes", "Hybrid Schemes", "Index Fund", "Fund Of Funds", "ETFs"];
const FALLBACK_PERIODS = [["ytd", "YTD"], ["1w", "1 Week"], ["1m", "1 Month"], ["3m", "3 Months"], ["6m", "6 Months"], ["1y", "1 Year"], ["3y", "3 Years"], ["5y", "5 Years"], ["10y", "10 Years"]];
const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const field = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-[13.5px]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold hover:border-[#006F64] disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const hint = "text-[12px] text-[#667085] dark:text-[#9AA3B2]";
const tone = (v: number | null) => (v == null ? "" : v < 0 ? "text-[#B42318] dark:text-[#FDA29B]" : "text-[#067647] dark:text-[#75E1A0]");

async function get<T>(path: string): Promise<T> {
  const go = () => fetch(resolveApiUrl(`${API_URL}${path}`), { credentials: "include" });
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
  return res.json() as Promise<T>;
}

export default function CategoryReturns() {
  const [fundType, setFundType] = useState("Equity Schemes");
  const [periods, setPeriods] = useState<string[]>(["1y"]);
  const [plan, setPlan] = useState("Regular");
  const [data, setData] = useState<Data | null>(null);
  const [applied, setApplied] = useState({ fundType: "Equity Schemes", periods: ["1y"], plan: "Regular" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "category", dir: 1 });

  const load = useCallback((a: { fundType: string; periods: string[]; plan: string }) => {
    setLoading(true); setErr("");
    get<Data>(`/api/backoffice/mutual-funds/category-returns?${new URLSearchParams({ fund_type: a.fundType, period: a.periods.join(","), plan: a.plan })}`)
      .then((d) => { setData(d); setPage(0); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { // a shared link carries ?etf=…&period=…, as on the original tool
    const p = new URLSearchParams(window.location.search);
    const a = { fundType: p.get("etf") ?? "Equity Schemes", periods: (p.get("period") ?? "1y").split(",").filter(Boolean).slice(0, 3), plan: p.get("plan") ?? "Regular" };
    setFundType(a.fundType); setPeriods(a.periods); setPlan(a.plan); setApplied(a); load(a);
  }, [load]);

  const submit = () => {
    if (!periods.length) return setErr("Please select period");
    const a = { fundType, periods, plan };
    setApplied(a); load(a);
    window.history.replaceState(null, "", `?${new URLSearchParams({ period: periods.join(","), etf: fundType, plan })}`);
  };
  const toggle = (k: string) => {
    if (periods.includes(k)) { setErr(""); return setPeriods(periods.filter((x) => x !== k)); }
    if (periods.length >= 3) return setErr("Only 3 period selection is allowed");
    setErr(""); setPeriods([...periods, k]);
  };
  const exportUrl = (kind: "pdf" | "xlsx") => resolveApiUrl(`${API_URL}/api/backoffice/mutual-funds/category-returns/${kind}?${new URLSearchParams({ fund_type: applied.fundType, period: applied.periods.join(","), plan: applied.plan })}`);

  const value = (r: Row, col: string): number | string => {
    if (col === "category") return r.category;
    if (col === "funds") return r.funds;
    const [p, s] = col.split(":");
    return (r[p] as Stat)[s as keyof Stat] ?? -Infinity;
  };
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = (data?.rows ?? []).filter((r) => !term || r.category.toLowerCase().includes(term));
    return [...f].sort((a, b) => { const x = value(a, sort.col), y = value(b, sort.col); return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir; });
  }, [data, q, sort]);
  const shown = size === 0 ? rows : rows.slice(page * size, page * size + size);
  const pages = size === 0 ? 1 : Math.max(1, Math.ceil(rows.length / size));
  const th = "px-2 py-1.5 text-[11.5px] font-semibold whitespace-nowrap cursor-pointer select-none";
  const arrow = (c: string) => (sort.col === c ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const sortBy = (c: string) => setSort((s) => ({ col: c, dir: s.col === c ? (s.dir === 1 ? -1 : 1) : 1 }));

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-4 p-5`}>
        <div>
          <h2 className="text-lg font-bold">Mutual fund category returns</h2>
          <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">Average, maximum, minimum and median return of every category, for one fund type and up to three periods.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold">Fund type
            <select className={`${field} mt-1 w-full`} value={fundType} onChange={(e) => setFundType(e.target.value)}>{(data?.fund_types ?? FALLBACK_TYPES).map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="text-[12px] font-semibold">Plan
            <select className={`${field} mt-1 w-full`} value={plan} onChange={(e) => setPlan(e.target.value)}><option>Regular</option><option>Direct</option><option>Both</option></select></label>
        </div>
        <fieldset>
          <legend className="text-[12px] font-semibold">Select period <span className={hint}>(max 3)</span></legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(data?.all_periods.map((p) => [p.key, p.label]) ?? FALLBACK_PERIODS).map(([k, l]) => (
              <label key={k} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${periods.includes(k) ? "border-[#006F64] bg-[#E6F2F0] text-[#006F64] dark:bg-[#0C2B28] dark:text-[#75E1CE]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
                <input type="checkbox" className="sr-only" checked={periods.includes(k)} onChange={() => toggle(k)} />{l}</label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} onClick={submit} disabled={loading}>{loading ? "Loading…" : "Submit"}</button>
          <a className={btn} href={exportUrl("pdf")} download>PDF</a>
          <a className={btn} href={exportUrl("xlsx")} download>Excel</a>
        </div>
        {err && <p role="alert" className="rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] font-medium text-[#B42318] dark:bg-[#3A1C1C] dark:text-[#FDA29B]">{err}</p>}
      </div>

      {data && (
        <div className={`${card} space-y-3 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-1.5 text-[12.5px]">Show
              <select className={field} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>{SIZES.map((n) => <option key={n} value={n}>{n === 0 ? "All" : n}</option>)}</select> entries</label>
            <input className={`${field} w-56`} type="search" placeholder="Search category" aria-label="Search category" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#183883] text-white">
                  <th rowSpan={2} className={`${th} text-left`} onClick={() => sortBy("category")}>Category{arrow("category")}</th>
                  <th rowSpan={2} className={`${th} text-right`} onClick={() => sortBy("funds")}>Funds{arrow("funds")}</th>
                  {data.periods.map((p) => <th key={p.key} colSpan={4} className="px-2 py-1.5 text-center text-[11.5px] font-semibold border-l border-white/20">{p.label}</th>)}
                </tr>
                <tr className="bg-[#183883] text-white">
                  {data.periods.flatMap((p) => STATS.map(([s, l], i) => <th key={`${p.key}${s}`} className={`${th} text-right ${i === 0 ? "border-l border-white/20" : ""}`} onClick={() => sortBy(`${p.key}:${s}`)}>{l}{arrow(`${p.key}:${s}`)}</th>))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.category} className="border-b border-[#E4E9EF] dark:border-[#2B3644] odd:bg-[#F5F7FB] dark:odd:bg-[#1B2433]">
                    <td className="px-2 py-1.5 text-[12.5px] font-semibold">{r.category}</td>
                    <td className="px-2 py-1.5 text-right text-[12.5px] tabular-nums">{r.funds}</td>
                    {data.periods.flatMap((p) => STATS.map(([s]) => { const v = (r[p.key] as Stat)[s]; return <td key={`${p.key}${s}`} className={`px-2 py-1.5 text-right text-[12.5px] tabular-nums ${tone(v)}`}>{v == null ? "-" : v.toFixed(2)}</td>; }))}
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={2 + data.periods.length * 4} className="px-2 py-6 text-center text-[13px] text-[#667085]">{data.rows.length ? "No category matches the search." : "No schemes found for this fund type."}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span className={hint}>Showing {rows.length ? (size === 0 ? 1 : page * size + 1) : 0} to {size === 0 ? rows.length : Math.min(rows.length, page * size + size)} of {rows.length} entries · NAV as on {data.nav_as_of}</span>
            <div className="flex items-center gap-2">
              <button type="button" className={btn} disabled={page === 0} onClick={() => setPage((x) => x - 1)}>Previous</button>
              <span>{page + 1} / {pages}</span>
              <button type="button" className={btn} disabled={page + 1 >= pages} onClick={() => setPage((x) => x + 1)}>Next</button>
            </div>
          </div>
          <p className={hint}>{data.note} Category names are Fund Horizon&apos;s; Sectoral/Thematic funds are grouped by keywords in the scheme name.</p>
        </div>
      )}
    </div>
  );
}
