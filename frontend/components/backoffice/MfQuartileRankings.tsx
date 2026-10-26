"use client";

import React, { useEffect, useState } from "react";
import { getMfQuartileRanking, MfQuartileData } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

const PERIODS = ["1y", "2y", "3y", "4y", "5y", "10y"];
const DEFAULT_CATEGORY = "Equity: Flexi Cap";
const DEFAULT_PLAN = "Regular";
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

interface MfQuartileRankingsProps {
  /** Categories ticked on the page above (screener keys + labels). */
  screenerCategories?: { key: string; label: string }[];
  /** Plans ticked on the page above ("Regular" / "Direct"). */
  plans?: string[];
}

/**
 * Work out the single category + plan this table shows from the page's
 * selection. The table always shows exactly one category and one plan:
 * - exactly one mapped category + exactly one plan -> that category + plan;
 * - anything else (several categories, several plans, or a category with no
 *   matching Advisorkhoj label) -> the default category + Regular plan,
 *   with `exact` false so the caller shows the banner below.
 */
function resolveSelection(
  screenerCategories: { key: string; label: string }[] | undefined,
  plans: string[] | undefined,
) {
  if (screenerCategories === undefined && plans === undefined) {
    return { category: DEFAULT_CATEGORY, plan: DEFAULT_PLAN, exact: true, unmappedSingle: false };
  }
  const cats = screenerCategories ?? [];
  const ps = plans ?? [];
  const mapped = cats.length === 1 ? EQUITY_ADVISORKHOJ[cats[0].key] : undefined;
  const singlePlan = ps.length === 1 && (ps[0] === "Regular" || ps[0] === "Direct") ? ps[0] : null;
  return {
    category: mapped ?? DEFAULT_CATEGORY,
    plan: singlePlan ?? DEFAULT_PLAN,
    exact: mapped !== undefined && singlePlan !== null,
    unmappedSingle: cats.length === 1 && mapped === undefined,
  };
}

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

export default function MfQuartileRankings({ screenerCategories, plans }: MfQuartileRankingsProps) {
  const resolved = resolveSelection(screenerCategories, plans);
  const [category, setCategory] = useState(resolved.category);
  const [period, setPeriod] = useState("1y");
  const [plan, setPlan] = useState(resolved.plan);
  const [data, setData] = useState<MfQuartileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState(3);
  const [unmatchedNote, setUnmatchedNote] = useState(false);

  // Follow the page above: when its selection changes, the table follows it.
  // The category and plan pickers were removed on purpose — the table shows
  // the page's selection (or the single fallback below), not a second selection.
  useEffect(() => {
    setCategory(resolved.category);
    setPlan(resolved.plan);
    setUnmatchedNote(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.category, resolved.plan]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    getMfQuartileRanking({ category, period, plan }, ctl.signal)
      .then((r) => setData(r.data))
      .catch((e) => {
        if (ctl.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Failed to load";
        // Advisorkhoj has no label for the picked category: fall back to the
        // default table instead of leaving an error on screen.
        if (/unknown category/i.test(msg) && category !== DEFAULT_CATEGORY) {
          setUnmatchedNote(true);
          setCategory(DEFAULT_CATEGORY);
          return;
        }
        setError(msg);
      })
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
  }, [category, period, plan]);

  const num = (s: string) => parseFloat((s ?? "").replace(/,/g, ""));
  const showBanner = !resolved.exact || unmatchedNote;
  const bannerReason = unmatchedNote || resolved.unmappedSingle
    ? "The category picked above has no matching Advisorkhoj label, so this table shows a single category that Advisorkhoj does publish."
    : "The list above can show more than one category or plan, but this table shows a single category and plan.";

  const idx = data ? data.rows.map((_, i) => i) : [];
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
        <span className="text-[12px] text-[#181818] dark:text-[#EDF2F7]">
          Showing: {category} · {plan}
        </span>
        <select aria-label="Period" className={sel} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
        <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] ml-auto">
          Source: <a className="underline" href="https://www.advisorkhoj.com/mutual-funds-research/quartile-ranking" target="_blank" rel="noreferrer">Advisorkhoj</a> · cached 24h
        </span>
      </div>
      {showBanner && (
        <div className="text-[12px] p-2.5 rounded bg-[#FFF4E5] dark:bg-[#2B2113] text-[#7A4A00] dark:text-[#FFD38A]">
          Showing one table only: {category} · {plan} · {periodLabel(period)}. {bannerReason} Advisorkhoj does not publish Direct-plan quartiles, so Direct funds can never appear in this table.
        </div>
      )}
      {data && (
        <div className="space-y-1">
          <h2 className="text-[14px] font-medium text-[#181818] dark:text-[#EDF2F7]">
            Quartile Rankings — {category} · {plan} · {periodLabel(period)} · {data.rows.length} funds
          </h2>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
            Top Quartile = top 25% in this category and plan, then upper-middle 25%, lower-middle 25%, bottom 25%, as published by Advisorkhoj. Past performance is not a guide to future returns.
          </p>
          {fetched && <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Quartile data fetched {fetched}.</p>}
        </div>
      )}
      {error && <div className="py-8 text-center text-[#B42332] dark:text-[#FF7D86]">{error}</div>}
      {!error && !loading && data && data.rows.length === 0 && (
        <div className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
          Advisorkhoj has no quartile data for this selection{plan === "Direct" ? " (it does not publish Direct-plan quartiles)" : ""}.{plan === "Direct" ? " The screener above may still show Direct funds, but this table cannot show Direct funds." : ""}
        </div>
      )}
      {data && data.rows.length > 0 && (
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
