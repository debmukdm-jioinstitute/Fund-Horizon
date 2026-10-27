"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ComparePayload, getBackofficeCompare } from "@/lib/backoffice";
import InfoTip from "@/components/InfoTip";
import { FundQuartiles, getFundQuartiles } from "@/lib/api";

const CHART_COLORS = ["#0176D3", "#2170E4", "#D97706", "#7C3AED"];

type Period = "1Y" | "3Y" | "5Y" | "Max";

const METRIC_GROUPS: { title: string; rows: { key: keyof ComparePayload["items"][0]["metrics"]; label: string; higherBetter: boolean; format: "pct" | "num" | "inr_cr" | "plain" | "yrs"; tip?: string }[] }[] = [
  {
    title: "Returns",
    rows: [
      { key: "ret_1y", label: "1Y return", higherBetter: true, format: "pct", tip: "ret_1y" },
      { key: "ret_3y", label: "3Y return", higherBetter: true, format: "pct", tip: "ret_3y" },
      { key: "ret_5y", label: "5Y return", higherBetter: true, format: "pct", tip: "ret_5y" },
      { key: "ret_si", label: "Since inception", higherBetter: true, format: "pct", tip: "ret_si" },
      { key: "cagr", label: "CAGR", higherBetter: true, format: "pct", tip: "cagr" },
    ],
  },
  {
    title: "Risk",
    rows: [
      { key: "std_dev", label: "Std dev", higherBetter: false, format: "pct", tip: "std_dev" },
      { key: "max_dd", label: "Max drawdown", higherBetter: false, format: "pct", tip: "max_drawdown" },
    ],
  },
  {
    title: "Risk-adjusted",
    rows: [
      { key: "sharpe", label: "Sharpe 3Y", higherBetter: true, format: "num", tip: "sharpe" },
      { key: "sortino", label: "Sortino 3Y", higherBetter: true, format: "num", tip: "sortino" },
      { key: "alpha", label: "Alpha", higherBetter: true, format: "pct", tip: "alpha" },
      { key: "beta", label: "Beta", higherBetter: false, format: "num", tip: "beta" },
      { key: "up_capture", label: "Up capture", higherBetter: true, format: "pct", tip: "up_capture" },
      { key: "down_capture", label: "Down capture", higherBetter: false, format: "pct", tip: "down_capture" },
    ],
  },
  {
    title: "Cost & size",
    rows: [
      { key: "ter", label: "TER", higherBetter: false, format: "pct", tip: "ter" },
      { key: "aum", label: "AUM (₹ Cr)", higherBetter: true, format: "inr_cr", tip: "aum" },
      { key: "nav_or_min_ticket", label: "NAV / min ticket", higherBetter: false, format: "plain", tip: "nav" },
    ],
  },
  {
    title: "Manager",
    rows: [
      { key: "manager", label: "Manager", higherBetter: true, format: "plain" },
      { key: "manager_tenure", label: "Tenure", higherBetter: true, format: "yrs" },
      { key: "quartile", label: "Quartile", higherBetter: true, format: "plain", tip: "quartile_rank" },
    ],
  },
];

const RANKED = new Set<string>([
  "ret_1y", "ret_3y", "ret_5y", "ret_si", "cagr", "sharpe", "sortino", "alpha", "up_capture",
  "std_dev", "max_dd", "down_capture", "ter",
]);

function formatCell(v: number | string | null | undefined, format: string): string {
  if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) return "—";
  if (format === "pct" && typeof v === "number") return `${v.toFixed(2)}%`;
  if (format === "inr_cr" && typeof v === "number") return `₹${v.toLocaleString("en-IN")} Cr`;
  if (format === "num" && typeof v === "number") return v.toFixed(2);
  if (format === "yrs" && typeof v === "number") return `${v.toFixed(1)} yrs`;
  return String(v);
}

function filterSeries(series: [string, number][], period: Period): [string, number][] {
  if (!series.length || period === "Max") return series;
  const last = new Date(series[series.length - 1][0]);
  const years = period === "1Y" ? 1 : period === "3Y" ? 3 : 5;
  const cutoff = new Date(last);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cut = cutoff.toISOString().slice(0, 10);
  const filtered = series.filter(([d]) => d >= cut);
  return filtered.length > 1 ? filtered : series;
}

function buildChartRows(payload: ComparePayload, period: Period) {
  const dates = new Set<string>();
  payload.items.forEach((it) => filterSeries(it.series, period).forEach(([d]) => dates.add(d)));
  filterSeries(payload.benchmark.series, period).forEach(([d]) => dates.add(d));
  const sorted = Array.from(dates).sort();
  return sorted.map((date) => {
    const row: Record<string, string | number> = { date };
    payload.items.forEach((it, i) => {
      const pt = filterSeries(it.series, period).find(([d]) => d === date);
      if (pt) row[`s${i}`] = pt[1];
    });
    const bpt = filterSeries(payload.benchmark.series, period).find(([d]) => d === date);
    if (bpt) row.benchmark = bpt[1];
    return row;
  });
}

function highlightClass(
  values: (number | null | undefined)[],
  idx: number,
  higherBetter: boolean,
): string {
  const nums = values.filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
  if (nums.length < 2 || nums.length !== values.length) return "";
  const best = higherBetter ? Math.max(...nums) : Math.min(...nums);
  const worst = higherBetter ? Math.min(...nums) : Math.max(...nums);
  if (best === worst) return "";
  const v = values[idx];
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (v === best) return "text-[#087744] dark:text-[#58D6A0] font-medium";
  if (v === worst) return "text-[#B42332] dark:text-[#FF7D86] font-medium";
  return "";
}

interface CompareViewProps {
  open: boolean;
  type: "mf" | "pms";
  ids: string[];
  onClose: () => void;
  onRemoveId: (id: string) => void;
  resolveLabel: (id: string) => string;
}

export default function CompareView({ open, type, ids, onClose, onRemoveId, resolveLabel }: CompareViewProps) {
  const [period, setPeriod] = useState<Period>("3Y");
  const [payload, setPayload] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [quartiles, setQuartiles] = useState<Record<string, FundQuartiles | null>>({});

  const load = React.useCallback(async () => {
    if (ids.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getBackofficeCompare(type, ids);
      setPayload(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load comparison");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [ids, type]);

  const idsKey = ids.join(",");

  useEffect(() => {
    if (!open || ids.length < 2) return;
    load();
  }, [open, idsKey, ids.length, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "unset";
    };
  }, [open, onClose]);

  // Advisorkhoj quartile ranks per fund (equity MFs only); rows appear once loaded.
  useEffect(() => {
    if (!open || type !== "mf") return;
    let off = false;
    ids.forEach((id) => getFundQuartiles(id).then((q) => !off && setQuartiles((m) => ({ ...m, [id]: q }))));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, idsKey]);

  const chartData = useMemo(() => (payload ? buildChartRows(payload, period) : []), [payload, period]);

  function exportCsv() {
    if (!payload) return;
    const header = ["Metric", ...payload.items.map((i) => i.name)];
    const lines = [header.join(",")];
    for (const group of METRIC_GROUPS) {
      for (const row of group.rows) {
        lines.push([
          row.label,
          ...payload.items.map((it) => {
            const v = it.metrics[row.key];
            return v === null || v === undefined ? "" : String(v);
          }),
        ].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compare-${type}-${ids.join("-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!open) return null;

  const fetchedIst = payload?.meta.fetched_at
    ? new Date(payload.meta.fetched_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "—";

  const sourceLink =
    type === "mf"
      ? { href: "https://portal.amfiindia.com/spages/NAVAll.txt", label: "AMFI" }
      : { href: "https://www.apmiindia.org", label: "APMI" };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="absolute inset-y-0 right-0 flex w-full max-w-[min(1200px,100vw)] flex-col border-l border-[#E4E9EF] bg-[#FFFFFF] shadow-2xl dark:border-[#2B3644] dark:bg-[#10151C]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-[#E4E9EF] bg-[#F7F9FB] p-6 dark:border-[#2B3644] dark:bg-[#171E27]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7]">Compare</h2>
            <button type="button" className="terminal-btn text-[12px] py-1 px-2" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: `repeat(${Math.max(ids.length, 1)}, minmax(0, 1fr))` }}
          >
            {ids.map((id) => (
              <div key={id} className="terminal-panel p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {resolveLabel(id)}
                    </div>
                    <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] truncate">{id}</div>
                  </div>
                  <button type="button" className="shrink-0 text-[12px]" onClick={() => onRemoveId(id)} aria-label="Remove">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="space-y-3 animate-pulse">
              <div className="h-80 rounded-lg bg-[#F0F3F6] dark:bg-[#202936]" />
              <div className="h-48 rounded-lg bg-[#F0F3F6] dark:bg-[#202936]" />
            </div>
          )}
          {error && (
            <div className="terminal-panel p-4 text-[13px] text-[#B42332] dark:text-[#FF7D86]">
              {error}
              <button type="button" className="terminal-btn ml-3 text-[12px] py-1 px-3" onClick={load}>
                Retry
              </button>
            </div>
          )}
          {payload && !loading && (
            <>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[14px] font-medium text-[#172033] dark:text-[#EDF2F7]">Growth (rebased to 100)</h3>
                <div className="flex gap-1 rounded border border-[#E4E9EF] bg-[#F0F3F6] p-0.5 dark:border-[#2B3644] dark:bg-[#202936]">
                  {(["1Y", "3Y", "5Y", "Max"] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium ${
                        period === p
                          ? "bg-white text-[#172033] shadow-sm dark:bg-[#10151C] dark:text-[#EDF2F7]"
                          : "text-[#536176] dark:text-[#A8B4C4]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-[320px]" role="img" aria-label="Compare growth chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ left: 8, right: 12, top: 8 }}>
                    <CartesianGrid stroke="#E4E9EF" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} fontSize={11} />
                    <YAxis fontSize={11} width={48} domain={["auto", "auto"]} />
                    <Tooltip labelFormatter={(d) => `Date: ${d}`} />
                    {payload.items.map((it, i) => (
                      <Line
                        key={it.id}
                        type="monotone"
                        dataKey={`s${i}`}
                        name={it.name}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                    {payload.benchmark.series.length > 0 && (
                      <Line
                        type="monotone"
                        dataKey="benchmark"
                        name={payload.benchmark.name}
                        stroke="#92400E"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        isAnimationActive={false}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-8 overflow-x-auto">
                <table className="terminal-table min-w-full">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-[1] bg-[#F7F9FB] dark:bg-[#171E27]">Metric</th>
                      {payload.items.map((it) => (
                        <th key={it.id} className="text-right">
                          {it.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRIC_GROUPS.map((group) => (
                      <React.Fragment key={group.title}>
                        <tr>
                          <td
                            colSpan={payload.items.length + 1}
                            className="cursor-pointer bg-[#F0F3F6] font-semibold text-[11px] uppercase tracking-wide dark:bg-[#202936]"
                            onClick={() => setCollapsed((c) => ({ ...c, [group.title]: !c[group.title] }))}
                          >
                            {collapsed[group.title] ? "▸" : "▾"} {group.title}
                          </td>
                        </tr>
                        {!collapsed[group.title] &&
                          group.rows.map((row) => {
                            const values = payload.items.map((it) => {
                              const v = it.metrics[row.key];
                              return typeof v === "number" ? v : null;
                            });
                            return (
                              <tr key={row.key}>
                                <td className="sticky left-0 z-[1] bg-[#FFFFFF] dark:bg-[#10151C] py-2.5 px-4">
                                  <span className="inline-flex items-center">
                                    {row.label}
                                    {row.tip && <InfoTip metric={row.tip} />}
                                  </span>
                                </td>
                                {payload.items.map((it, idx) => {
                                  const raw = it.metrics[row.key];
                                  const display = formatCell(raw as number | string | null, row.format);
                                  const na = display === "—";
                                  return (
                                    <td
                                      key={it.id}
                                      className={`text-right tabular-nums py-2.5 px-4 ${RANKED.has(row.key) ? highlightClass(values, idx, row.higherBetter) : ""}`}
                                      title={na ? "Not available" : undefined}
                                    >
                                      {display}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        {!collapsed[group.title] && type === "mf" && group.title === "Risk-adjusted" && (
                          <tr>
                            <td colSpan={payload.items.length + 1} className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] py-1.5 px-4">
                              {(() => {
                                const live = payload.items.filter((it) => it.metrics.sharpe_source === "live-nav" || it.metrics.sharpe_source === "mixed");
                                if (!live.length) return "Sharpe/Sortino are the dataset 3Y values, matching the research row and fund dialog.";
                                return `Sharpe/Sortino match the research row and fund dialog (dataset 3Y values) except for ${live.map((it) => it.name).join(", ")}, where the dataset value is missing so the figure is computed live from NAV (3Y, 6.5% risk-free rate).`;
                              })()}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    {type === "mf" && ids.some((id) => quartiles[id]) && (
                      <>
                        <tr>
                          <td colSpan={payload.items.length + 1} className="bg-[#F0F3F6] font-semibold text-[11px] uppercase tracking-wide dark:bg-[#202936]">
                            Quartile rankings (Advisorkhoj)
                          </td>
                        </tr>
                        {[
                          ...["1Y", "3Y", "5Y"].map((k) => ({ label: `${k} (current quarter)`, get: (q: FundQuartiles) => q.trailing[k]?.replace(" Quartile", "") })),
                          ...Array.from(new Set(ids.flatMap((id) => (quartiles[id]?.years ?? []).map(([y]) => y)))).sort().map((y) => ({ label: y, get: (q: FundQuartiles) => q.years.find(([yy]) => yy === y)?.[1] })),
                        ].map((row) => (
                          <tr key={row.label}>
                            <td className="sticky left-0 z-[1] bg-[#FFFFFF] dark:bg-[#10151C] py-2.5 px-4">{row.label}</td>
                            {payload.items.map((it) => {
                              const q = quartiles[it.id];
                              return <td key={it.id} className="text-right py-2.5 px-4">{(q && row.get(q)) || "—"}</td>;
                            })}
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E9EF] p-4 text-[12px] text-[#536176] dark:border-[#2B3644] dark:text-[#A8B4C4]">
          <span>
            Data as of {fetchedIst} IST • Source{" "}
            <a href={sourceLink.href} target="_blank" rel="noreferrer" className="underline">
              {sourceLink.label}
            </a>
          </span>
          <button
            type="button"
            disabled={!payload}
            className="terminal-btn text-[12px] py-1 px-3 font-medium"
            onClick={exportCsv}
          >
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}
