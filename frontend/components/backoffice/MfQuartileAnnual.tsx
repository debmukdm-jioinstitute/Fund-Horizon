"use client";

import React, { useEffect, useMemo, useState } from "react";
import { getMfQuartileAnnual, MfQuartileData } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

const YEARS = 5;

type Pill = { label: string; cls: string };

/** Only the four Advisorkhoj values map to a quartile; anything else is unavailable, never guessed. */
function pillFor(raw: string | undefined): Pill | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "1" || t.includes("top")) return { label: "Q1 · Top", cls: "bg-[#C8E6C9] text-[#1B5E20] dark:bg-[#1E4620] dark:text-[#A5D6A7]" };
  if (t === "2" || t.includes("upper")) return { label: "Q2 · Upper", cls: "bg-[#C5D3F0] text-[#1E3A6E] dark:bg-[#1E2F52] dark:text-[#A8BDF0]" };
  if (t === "3" || t.includes("lower")) return { label: "Q3 · Lower", cls: "bg-[#FDE9A8] text-[#6B4E00] dark:bg-[#4A3410] dark:text-[#F5D67A]" };
  if (t === "4" || t.includes("bottom")) return { label: "Q4 · Bottom", cls: "bg-[#F9C5CC] text-[#7A1F2B] dark:bg-[#4A1A22] dark:text-[#F5A3AF]" };
  return null;
}

const LEGEND: { swatch: string; label: string }[] = [
  { swatch: "bg-[#C8E6C9] dark:bg-[#1E4620]", label: "Q1 · Top 25%" },
  { swatch: "bg-[#C5D3F0] dark:bg-[#1E2F52]", label: "Q2 · Upper middle" },
  { swatch: "bg-[#FDE9A8] dark:bg-[#4A3410]", label: "Q3 · Lower middle" },
  { swatch: "bg-[#F9C5CC] dark:bg-[#4A1A22]", label: "Q4 · Bottom 25%" },
  { swatch: "bg-[#E9EDF1] dark:bg-[#222C3D]", label: "— Unavailable" },
];

function yearOf(col: string): string {
  return col.match(/\d{4}/)?.[0] ?? col;
}
function isYtd(col: string): boolean {
  return /ytd/i.test(col);
}
function yearDisplay(col: string): string {
  return isYtd(col) ? `${yearOf(col)} YTD` : yearOf(col);
}
function fmtAum(raw: string | undefined): string {
  const n = parseFloat((raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (raw ?? "—");
}

/**
 * Calendar-year quartile ranks (Advisorkhoj), last 5 published year columns.
 * `labels` are Advisorkhoj categories; `keep` filters fund names (page search /
 * FH Recommended). The Plan dropdown is this view's own filter: Regular shows
 * the real data, Direct shows the honest message — Advisorkhoj publishes no
 * Direct-plan quartiles, so Direct cells are never faked.
 */
export default function MfQuartileAnnual({ labels, enabled, keep, recommendedPending = false }: {
  labels: string[];
  enabled: boolean;
  keep: (name: string) => boolean;
  recommendedPending?: boolean;
}) {
  const [data, setData] = useState<MfQuartileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [plan, setPlan] = useState<"Regular" | "Direct">(() => (enabled ? "Regular" : "Direct"));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [range, setRange] = useState<"all" | "last3">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const labelKey = labels.join("|");

  useEffect(() => {
    if (plan !== "Regular" || !labels.length) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    Promise.allSettled(labels.map((cat) => getMfQuartileAnnual({ category: cat, plan: "Regular" }, ctl.signal)))
      .then((res) => {
        if (ctl.signal.aborted) return;
        const ok = res.flatMap((r, i) => (r.status === "fulfilled" ? [{ label: labels[i], d: r.value.data }] : []));
        if (!ok.length) return setError("Failed to load calendar-year quartile data");
        setData({
          ...ok[0].d,
          columns: [...ok[0].d.columns, "Category"],
          rows: ok.flatMap(({ label, d }) => d.rows.map((r) => [...r, label.replace("Equity: ", "")])),
          links: ok.flatMap(({ d }) => d.links),
        });
      })
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, plan, retry]);

  const cols = useMemo(() => (data ? data.columns.map((c, i) => ({ c, i })) : []), [data]);
  // Scheme, Launch Date, AUM, the last 5 year columns (YTD counts as one), then Category; "Details" is dropped.
  const yearCols = useMemo(() => cols.filter(({ c }) => /^\d{4}/.test(c)).slice(-YEARS), [cols]);
  const catIdx = cols.length ? cols[cols.length - 1].i : -1;
  const displayedYears = range === "last3" && yearCols.length > 3 ? yearCols.slice(-3) : yearCols;

  const categories = useMemo(() => {
    if (!data || catIdx < 0) return [];
    return Array.from(new Set(data.rows.map((r) => r[catIdx] ?? ""))).filter(Boolean).sort();
  }, [data, catIdx]);

  const rangeOptions = useMemo(() => {
    if (yearCols.length <= 3) return [{ id: "all" as const, label: yearCols.length ? `${yearDisplay(yearCols[0].c)}–${yearDisplay(yearCols[yearCols.length - 1].c)}` : "All years" }];
    const last3 = yearCols.slice(-3);
    return [
      { id: "all" as const, label: `${yearDisplay(yearCols[0].c)}–${yearDisplay(yearCols[yearCols.length - 1].c)}` },
      { id: "last3" as const, label: `${yearDisplay(last3[0].c)}–${yearDisplay(last3[last3.length - 1].c)}` },
    ];
  }, [yearCols]);

  const idx = useMemo(() => {
    if (!data || plan !== "Regular") return [];
    const q = search.trim().toLowerCase();
    return data.rows
      .map((_, i) => i)
      .filter((i) => {
        const row = data.rows[i];
        if (!keep(row[0])) return false;
        if (q && !row[0].toLowerCase().includes(q)) return false;
        if (category !== "All" && catIdx >= 0 && row[catIdx] !== category) return false;
        return true;
      })
      .sort((a, b) => (data.rows[a][0] ?? "").localeCompare(data.rows[b][0] ?? ""));
  }, [data, plan, search, category, catIdx, keep]);

  const downloadXls = () => {
    if (!data || plan !== "Regular") return;
    const esc = (v: string) => (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tr = (cells: string[], t: string) => `<tr>${cells.map((c) => `<${t}>${esc(c)}</${t}>`).join("")}</tr>`;
    const headers = ["Fund", "Category", "AUM (₹ Cr)", ...displayedYears.map((y) => y.c)];
    const html = `<html><head><meta charset="utf-8"></head><body><table>${tr(headers, "th")}${idx.map((i) => tr([data.rows[i][0], catIdx >= 0 ? data.rows[i][catIdx] : "", data.rows[i][2] ?? "", ...displayedYears.map((y) => data.rows[i][y.i] ?? "")], "td")).join("")}</table></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    a.download = "quartile-rankings-calendar-years.xls";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggleRow = (key: string) => setExpanded((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const readingFor = (row: string[]) => {
    const byPill: Record<string, string[]> = {};
    const unavailable: string[] = [];
    displayedYears.forEach((y) => {
      const pill = pillFor(row[y.i]);
      if (pill) (byPill[pill.label] ??= []).push(yearDisplay(y.c));
      else unavailable.push(yearDisplay(y.c));
    });
    const parts = Object.entries(byPill).map(([label, years]) => `${label.replace(" · ", " in ")} ${years.join(", ")}`);
    if (unavailable.length) parts.push(`No ranking in ${unavailable.join(", ")}`);
    return parts.length ? parts.join(" · ") : "No quartile ranking in the years shown.";
  };

  const lastYear = displayedYears[displayedYears.length - 1];
  const fetched = data?.fetched_at && data.fetched_at.trim() ? formatISTDate(data.fetched_at.trim()) : null;
  const sel = "terminal-btn text-[12px] py-1 px-2";
  const input = "terminal-input text-[12px] py-1.5 px-2.5";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-[#181818] dark:text-[#EDF2F7]">Quartile rankings</h1>
          <p className="text-[13px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">Compare each fund&apos;s position within its category, year by year.</p>
        </div>
        <button type="button" className="rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-3 py-1.5 text-[13px] font-medium text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F3F3F3] dark:hover:bg-[#1D2733] disabled:opacity-50" disabled={plan !== "Regular" || !idx.length} onClick={downloadXls}>
          ⬇ Download Excel
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <span aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#706E6B] dark:text-[#A8B4C4]">⌕</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search funds" aria-label="Search funds" className={`${input} pl-8 w-56`} />
        </div>
        <select aria-label="Category" className={sel} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">Category: All</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Plan" className={sel} value={plan} onChange={(e) => setPlan(e.target.value as "Regular" | "Direct")}>
          <option value="Regular">Plan: Regular</option>
          <option value="Direct">Plan: Direct</option>
        </select>
        <select aria-label="Year range" className={sel} value={range} onChange={(e) => setRange(e.target.value as "all" | "last3")}>
          {rangeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="ml-auto text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{plan === "Regular" && !loading ? `${idx.length} funds` : ""}</span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-[#E5E5E5] dark:border-[#2B3644] py-2 text-[12px] text-[#181818] dark:text-[#EDF2F7]">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`inline-block h-4 w-7 rounded ${l.swatch}`} />
            {l.label}
          </span>
        ))}
        <span className="sm:ml-auto sm:border-l sm:border-[#E5E5E5] sm:dark:border-[#2B3644] sm:pl-4 text-[#706E6B] dark:text-[#A8B4C4]">Read across a row to see how a fund&apos;s ranking changes.</span>
      </div>

      {error && (
        <div className="py-6 text-center">
          <p className="text-[#B42332] dark:text-[#FF7D86] text-[13px]">{error}</p>
          <button type="button" className={`${sel} mt-2`} onClick={() => setRetry((r) => r + 1)}>Retry</button>
        </div>
      )}
      {(loading || recommendedPending) && !error && <div className="py-8 text-center text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">Loading calendar-year quartile data…</div>}
      {!loading && !error && !recommendedPending && plan === "Direct" && (
        <div className="py-8 text-center text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">Advisorkhoj does not publish Direct-plan quartiles. Choose Regular to see calendar-year quartile data.</div>
      )}
      {!loading && !error && !recommendedPending && plan === "Regular" && !labels.length && (
        <div className="py-8 text-center text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">Advisorkhoj has no quartile data for the selected categories.</div>
      )}
      {!loading && !error && !recommendedPending && plan === "Regular" && labels.length > 0 && idx.length === 0 && (
        <div className="py-8 text-center text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">No calendar-year quartile data for this selection.</div>
      )}

      {data && plan === "Regular" && idx.length > 0 && (
        <div className={`overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] ${loading ? "opacity-50" : ""}`}>
          <table className="terminal-table min-w-[720px]">
            <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
              <tr>
                <th rowSpan={2} className="text-left align-bottom">Fund / category</th>
                <th rowSpan={2} className="text-right align-bottom">AUM (₹ Cr)</th>
                <th colSpan={displayedYears.length} className="text-center border-b border-dashed border-[#CBD5E1] dark:border-[#2B3644]">Calendar-year quartile</th>
              </tr>
              <tr>
                {displayedYears.map((y) => (
                  <th key={y.c} className={`text-center whitespace-nowrap ${isYtd(y.c) ? "border-l border-dashed border-[#CBD5E1] dark:border-[#2B3644]" : ""}`}>
                    <div>{yearOf(y.c)}{isYtd(y.c) ? " YTD" : ""}</div>
                    {isYtd(y.c) && <div className="text-[10px] font-normal text-[#706E6B] dark:text-[#A8B4C4]">Partial year</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {idx.map((i) => {
                const row = data.rows[i];
                const key = `${i}-${row[0]}-${catIdx >= 0 ? row[catIdx] : ""}`;
                const open = expanded.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr className={loading ? "opacity-50" : ""}>
                      <td>
                        <div className="flex items-start gap-1.5">
                          <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${row[0]}`} aria-expanded={open} onClick={() => toggleRow(key)} className="mt-0.5 shrink-0 text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]">
                            <span className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
                          </button>
                          <div>
                            <div className="font-medium text-[#181818] dark:text-[#EDF2F7]">{row[0]}</div>
                            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{catIdx >= 0 ? row[catIdx] : ""}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{fmtAum(row[2])}</td>
                      {displayedYears.map((y) => {
                        const pill = pillFor(row[y.i]);
                        return (
                          <td key={y.c} className={`text-center ${isYtd(y.c) ? "border-l border-dashed border-[#CBD5E1] dark:border-[#2B3644]" : ""}`}>
                            <span className={`inline-block rounded-md px-2 py-1 text-[12px] font-medium whitespace-nowrap ${pill ? pill.cls : "bg-[#E9EDF1] text-[#667085] dark:bg-[#222C3D] dark:text-[#9AA6B8]"}`}>
                              {pill ? pill.label : "—"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={2 + displayedYears.length} className="bg-[#F8FAFC] dark:bg-[#171E27]">
                          <div className="text-[12px] text-[#181818] dark:text-[#EDF2F7] space-y-1">
                            <div><span className="text-[#706E6B] dark:text-[#A8B4C4]">Launch date: </span>{row[1] || "—"}<span className="text-[#706E6B] dark:text-[#A8B4C4]"> · AUM: </span>₹{fmtAum(row[2])} Cr<span className="text-[#706E6B] dark:text-[#A8B4C4]"> · Category: </span>{catIdx >= 0 ? row[catIdx] : "—"}</div>
                            <div>{readingFor(row)}</div>
                            {data.links[i] && <div><a className="text-[#0176D3] dark:text-[#1B96FF] hover:underline" href={data.links[i]!} target="_blank" rel="noreferrer">View on Advisorkhoj ↗</a></div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
        Rankings are relative to category peers, not absolute returns.{lastYear && isYtd(lastYear.c) ? ` ${yearOf(lastYear.c)} YTD is a partial year.` : ""}
      </p>
      <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
        Source: <a className="underline" href="https://www.advisorkhoj.com/mutual-funds-research/quartile-ranking" target="_blank" rel="noreferrer">Advisorkhoj</a> · cached 24h{fetched ? ` · fetched ${fetched}` : ""}.
      </p>
    </div>
  );
}
