"use client";

import React, { useEffect, useState } from "react";
import { getMfQuartileAnnual, MfQuartileData } from "@/lib/backoffice";

const TONE: Record<string, string> = {
  Top: "text-[#2E844A] dark:text-[#45C65A]",
  "Upper Mid": "text-[#B5780A] dark:text-[#FFB75D]",
  "Lower Mid": "text-[#8B1A1A] dark:text-[#FF9AA2]",
  Bottom: "text-[#B42332] dark:text-[#FF7D86]",
};
const YEARS = 5;

/** Calendar-year quartile ranks (Advisorkhoj), last 5 published year columns. `labels` are Advisorkhoj categories; `keep` filters fund names. */
export default function MfQuartileAnnual({ labels, enabled, keep }: { labels: string[]; enabled: boolean; keep: (name: string) => boolean }) {
  const [data, setData] = useState<MfQuartileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const labelKey = labels.join("|");

  useEffect(() => {
    if (!enabled || !labels.length) {
      setData(null);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    Promise.allSettled(labels.map((category) => getMfQuartileAnnual({ category, plan: "Regular" }, ctl.signal)))
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
  }, [labelKey, enabled]);

  if (!enabled || !labels.length) return null;

  // Scheme, Launch Date, AUM, the last 5 year columns (YTD counts as one), then Category; "Details" is dropped.
  const cols = data ? data.columns.map((c, i) => ({ c, i })) : [];
  const yearCols = cols.filter(({ c }) => /^\d{4}/.test(c)).slice(-YEARS);
  const show = data ? [...cols.slice(0, 3), ...yearCols, cols[cols.length - 1]] : [];
  const idx = data ? data.rows.map((_, i) => i).filter((i) => keep(data.rows[i][0])).sort((a, b) => data.rows[a][0].localeCompare(data.rows[b][0])) : [];

  const downloadXls = () => {
    if (!data) return;
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tr = (cells: string[], t: string) => `<tr>${cells.map((c) => `<${t}>${esc(c ?? "")}</${t}>`).join("")}</tr>`;
    const html = `<html><head><meta charset="utf-8"></head><body><table>${tr(show.map((x) => x.c), "th")}${idx.map((i) => tr(show.map((x) => data.rows[i][x.i]), "td")).join("")}</table></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    a.download = "quartile-rankings-calendar-years.xls";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-2 pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-medium text-[#181818] dark:text-[#EDF2F7]">Calendar-year Quartile Rankings — last {YEARS} years · Regular · {idx.length} funds</h2>
        <button type="button" className="terminal-btn text-[12px] py-1 px-2 ml-auto" disabled={!idx.length} onClick={downloadXls}>Download Excel</button>
      </div>
      {error && <div className="py-4 text-center text-[#B42332] dark:text-[#FF7D86]">{error}</div>}
      {!error && !loading && idx.length === 0 && <div className="py-4 text-center text-[#706E6B] dark:text-[#A8B4C4]">No calendar-year quartile data for this selection.</div>}
      {data && idx.length > 0 && (
        <div className={`overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)] ${loading ? "opacity-50" : ""}`}>
          <table className="terminal-table">
            <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
              <tr>{show.map(({ c }, k) => <th key={`${c}-${k}`} className={k === 0 ? "" : "text-right"}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {idx.map((i) => (
                <tr key={`${i}-${data.rows[i][0]}`}>
                  {show.map(({ i: j }, k) => {
                    const v = data.rows[i][j];
                    return (
                      <td key={k} className={`${k === 0 ? "" : "text-right"} ${TONE[v] ?? "tabular-nums"}`}>
                        {k === 0 && data.links[i] ? <a className="text-[#0176D3] dark:text-[#1B96FF] hover:underline" href={data.links[i]!} target="_blank" rel="noreferrer">{v}</a> : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
