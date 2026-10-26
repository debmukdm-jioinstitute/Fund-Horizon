"use client";

import React, { useEffect, useState } from "react";
import { getMfQuartileRanking, getMfScreener, MfQuartileData } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

const PERIODS = ["1y", "2y", "3y", "4y", "5y", "10y"];
const QUARTILE_TONE: Record<string, string> = {
  "Top Quartile": "text-[#2E844A] dark:text-[#45C65A]",
  "Upper Middle Quartile": "text-[#0176D3] dark:text-[#1B96FF]",
  "Lower Middle Quartile": "text-[#B5780A] dark:text-[#FFB75D]",
  "Bottom Quartile": "text-[#B42332] dark:text-[#FF7D86]",
};
const sel = "terminal-btn text-[12px] py-1 px-2";

// Screener keys in the Equity group, mapped to Advisorkhoj labels. Each label is
// exactly "Equity: " plus the screener label (the group and the label both come
// from the screener's own Equity group, and "Equity: Flexi Cap" is the label
// this table already used). Categories outside this group are NOT mapped here:
// Advisorkhoj's labels for them are not verified, so no label is guessed.
const EQUITY_ADVISORKHOJ: Record<string, string> = {
  contra: "Equity: Contra",
  dividend_yield: "Equity: Dividend Yield",
  elss: "Equity: ELSS (Tax Savings)",
  flexi_cap: "Equity: Flexi Cap",
  focused: "Equity: Focused",
  large_mid_cap: "Equity: Large & Mid Cap",
  large_cap: "Equity: Large Cap",
  mid_cap: "Equity: Mid Cap",
  multi_cap: "Equity: Multi Cap",
  sectoral_thematic: "Equity: Sectoral/Thematic",
  small_cap: "Equity: Small Cap",
  value: "Equity: Value",
};

function periodLabel(period: string): string {
  return period === "1y" ? "1 Year" : `${period.replace("y", "")} Years`;
}

/** 0 = Top, 1 = Upper Middle, 2 = Lower Middle, 3 = Bottom, 99 = not a quartile value. */
function quartileRank(v: string): number {
  const t = v.trim().toLowerCase();
  if (/^\s*[1-4]\s*$/.test(t)) return Number(t) - 1;
  if (t.includes("top")) return 0;
  if (t.includes("upper")) return 1;
  if (t.includes("lower")) return 2;
  if (t.includes("bottom")) return 3;
  return 99;
}

/** Column holding the trailing return for the shown period, for quartile tie-breaks. */
function trailingReturnCol(columns: string[], rows: string[][], period: string): number {
  const years = period.replace(/[^0-9]/g, "");
  const periodIdx = columns.findIndex(
    (c, i) => i > 0 && !/quartile/i.test(c) && new RegExp(`\\b${years}\\b`).test(c) && /return|ret|%|cagr/i.test(c),
  );
  if (periodIdx >= 0) return periodIdx;
  return columns.findIndex(
    (c, i) =>
      i > 0 &&
      !/quartile/i.test(c) &&
      rows.some((r) => Number.isFinite(parseFloat((r[i] ?? "").replace(/,/g, "")))),
  );
}

/** Display date for data.fetched_at, or null when it is absent or unusable. */
function fetchedLabel(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const formatted = formatISTDate(raw.trim());
  return formatted === "—" ? raw.trim() : formatted;
}

// Advisorkhoj names ("HSBC Multi Cap Fund Reg Gr") and screener names ("... - Regular Plan - Growth") only agree once plan/option words are dropped.
const nameKey = (n: string) => n.toLowerCase().replace(/\b(direct|regular|reg|dir|plan|growth|gr|option|fund|scheme)\b/g, "").replace(/[^a-z0-9]/g, "");

export default function MfQuartileRankings({ screenerCategories = [], plans = [], query = "", recommended = false }: { screenerCategories?: { key: string; label: string }[]; plans?: string[]; query?: string; recommended?: boolean }) {
  const [recKeys, setRecKeys] = useState<Set<string> | null>(null);
  const [period, setPeriod] = useState("1y");
  const [data, setData] = useState<MfQuartileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState(3);

  // No category ticked = every Advisorkhoj equity category. Advisorkhoj has no Direct-plan quartiles.
  const labels = (screenerCategories.length && !recommended ? screenerCategories.map((c) => EQUITY_ADVISORKHOJ[c.key]) : Object.values(EQUITY_ADVISORKHOJ)).filter(Boolean);
  // FH Recommended ignores the category/plan ticks; a Direct pick shows its Regular twin's quartile.
  const regular = recommended || plans.length === 0 || plans.includes("Regular");
  const labelKey = labels.join("|");

  useEffect(() => {
    setRecKeys(null);
    if (!recommended) return;
    const ctl = new AbortController();
    getMfScreener({ category: [], plan: [], sort: "name", order: "asc", ranges: {}, recommended: true, limit: 200 }, ctl.signal)
      .then((r) => setRecKeys(new Set(r.data.map((f) => nameKey(f.name)))))
      .catch((e) => !ctl.signal.aborted && setError(e instanceof Error ? e.message : "Failed to load FH Recommended list"));
    return () => ctl.abort();
  }, [recommended]);

  useEffect(() => {
    if (!regular || !labels.length) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    Promise.allSettled(labels.map((category) => getMfQuartileRanking({ category, period, plan: "Regular" }, ctl.signal)))
      .then((res) => {
        if (ctl.signal.aborted) return;
        const ok = res.flatMap((r, i) => (r.status === "fulfilled" ? [{ label: labels[i], d: r.value.data }] : []));
        if (!ok.length) return setError("Failed to load quartile data");
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
  }, [labelKey, regular, period]);

  const num = (s: string) => parseFloat((s ?? "").replace(/,/g, ""));
  const q = query.trim().toLowerCase();
  const idx = data ? data.rows.map((_, i) => i).filter((i) => (!q || data.rows[i][0].toLowerCase().includes(q)) && (!recommended || recKeys?.has(nameKey(data.rows[i][0])))) : [];
  if (data) {
    const retCol = trailingReturnCol(data.columns, data.rows, period);
    const safeSort = sortCol < data.columns.length ? sortCol : 0;
    const isQuartileCol = (i: number) => /quartile/i.test(data.columns[i] ?? "");
    idx.sort((a, b) => {
      if (safeSort === 0) return (data.rows[a][0] ?? "").localeCompare(data.rows[b][0] ?? "");
      if (isQuartileCol(safeSort)) {
        const qa = quartileRank(data.rows[a][safeSort] ?? "");
        const qb = quartileRank(data.rows[b][safeSort] ?? "");
        if (qa !== qb) return qa - qb;
        if (retCol >= 0) {
          const d = (num(data.rows[b][retCol]) || -1e9) - (num(data.rows[a][retCol]) || -1e9);
          if (d !== 0) return d;
        }
        return a - b;
      }
      const colNumeric = data.rows.some((r) => Number.isFinite(num(r[safeSort] ?? "")));
      if (colNumeric) return (num(data.rows[b][safeSort]) || -1e9) - (num(data.rows[a][safeSort]) || -1e9);
      return (data.rows[a][safeSort] ?? "").localeCompare(data.rows[b][safeSort] ?? "");
    });
  }

  const fetched = data ? fetchedLabel(data.fetched_at) : null;

  return (
    <div className="p-2.5 space-y-2.5 min-h-[420px]">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <select aria-label="Period" className={sel} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
        <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] ml-auto">
          Source: <a className="underline" href="https://www.advisorkhoj.com/mutual-funds-research/quartile-ranking" target="_blank" rel="noreferrer">Advisorkhoj</a> · cached 24h
        </span>
      </div>
      {data && (
        <div className="space-y-1">
          <h2 className="text-[14px] font-medium text-[#181818] dark:text-[#EDF2F7]">
            Quartile Rankings — {labels.length} {labels.length === 1 ? "category" : "categories"} · Regular · {periodLabel(period)} · {idx.length} funds
          </h2>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
            Top Quartile = top 25% in this category and plan, then upper-middle 25%, lower-middle 25%, bottom 25%, as published by Advisorkhoj. Past performance is not a guide to future returns.
          </p>
          {fetched && <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Quartile data fetched {fetched}.</p>}
        </div>
      )}
      {error && <div className="py-8 text-center text-[#B42332] dark:text-[#FF7D86]">{error}</div>}
      {!loading && !error && !(recommended && !recKeys) && (!regular || !labels.length || idx.length === 0) && (
        <div className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
          {!regular ? "Advisorkhoj does not publish Direct-plan quartiles. Tick Regular to see quartile data." : !labels.length ? "Advisorkhoj has no quartile data for the selected categories." : q ? `No fund matching “${query}” in the selected categories.` : recommended ? "None of the FH Recommended funds has an Advisorkhoj quartile ranking for this period." : "Advisorkhoj has no quartile data for this selection."}
        </div>
      )}
      {data && idx.length > 0 && (
        <div className={`overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] ${loading ? "opacity-50" : ""}`}>
          <table className="terminal-table">
            <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
              <tr>
                {data.columns.map((c, i) => (
                  <th key={`${c}-${i}`} onClick={() => setSortCol(i)} className={i === 0 ? "cursor-pointer" : "text-right cursor-pointer"}>{c}{sortCol === i ? (i === 0 ? " ↑" : " ↓") : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {idx.map((i) => (
                <tr key={`${i}-${data.rows[i][0]}`}>
                  {data.rows[i].map((v, j) => (
                    <td key={j} className={`${j === 0 ? "" : "text-right"} ${QUARTILE_TONE[v] ?? "tabular-nums"}`}>
                      {j === 0 && data.links[i] ? <a className="text-[#0176D3] dark:text-[#1B96FF] hover:underline" href={data.links[i]!} target="_blank" rel="noreferrer">{v}</a> : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
        Note: the return numbers in this table are Advisorkhoj&apos;s figures. They are not the screener&apos;s figures, and they do not use the NAV date shown at the top of this page (that date comes from AMFI / mfapi.in for the screener above).
      </p>
    </div>
  );
}
