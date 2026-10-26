"use client";

import React, { useEffect, useState } from "react";
import { getMfQuartileRanking, MfQuartileData } from "@/lib/backoffice";

const PERIODS = ["1y", "2y", "3y", "4y", "5y", "10y"];
const QUARTILE_TONE: Record<string, string> = {
  "Top Quartile": "text-[#2E844A] dark:text-[#45C65A]",
  "Upper Middle Quartile": "text-[#0176D3] dark:text-[#1B96FF]",
  "Lower Middle Quartile": "text-[#B5780A] dark:text-[#FFB75D]",
  "Bottom Quartile": "text-[#B42332] dark:text-[#FF7D86]",
};
const sel = "terminal-btn text-[12px] py-1 px-2";

export default function MfQuartileRankings() {
  const [category, setCategory] = useState("Equity: Flexi Cap");
  const [period, setPeriod] = useState("1y");
  const [plan, setPlan] = useState("Regular");
  const [data, setData] = useState<MfQuartileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState(3);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    getMfQuartileRanking({ category, period, plan }, ctl.signal)
      .then((r) => setData(r.data))
      .catch((e) => !ctl.signal.aborted && setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
  }, [category, period, plan]);

  const num = (s: string) => parseFloat(s.replace(/,/g, ""));
  const idx = data ? data.rows.map((_, i) => i) : [];
  if (data && sortCol > 0 && sortCol !== 1) idx.sort((a, b) => (num(data.rows[b][sortCol]) || -1e9) - (num(data.rows[a][sortCol]) || -1e9));

  return (
    <div className="p-2.5 space-y-2.5 min-h-[420px]">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <select aria-label="Category" className={`${sel} max-w-full`} value={category} onChange={(e) => setCategory(e.target.value)}>
          {(data?.categories.length ? data.categories : [category]).map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label="Period" className={sel} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p} value={p}>{p.replace("y", " Year")}{p === "1y" ? "" : "s"}</option>)}
        </select>
        <select aria-label="Plan" className={sel} value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option>Regular</option>
          <option>Direct</option>
        </select>
        <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] ml-auto">
          Source: <a className="underline" href="https://www.advisorkhoj.com/mutual-funds-research/quartile-ranking" target="_blank" rel="noreferrer">Advisorkhoj</a> · cached 24h
        </span>
      </div>
      {error && <div className="py-8 text-center text-[#B42332] dark:text-[#FF7D86]">{error}</div>}
      {!error && !loading && data && data.rows.length === 0 && (
        <div className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">Advisorkhoj has no quartile data for this selection{plan === "Direct" ? " (it does not publish Direct-plan quartiles)" : ""}.</div>
      )}
      {data && data.rows.length > 0 && (
        <div className={`overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] ${loading ? "opacity-50" : ""}`}>
          <table className="terminal-table">
            <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
              <tr>
                {data.columns.map((c, i) => (
                  <th key={c} onClick={() => setSortCol(i)} className={i === 0 ? "" : "text-right cursor-pointer"}>{c}{sortCol === i ? " ↓" : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {idx.map((i) => (
                <tr key={data.rows[i][0]}>
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
    </div>
  );
}
