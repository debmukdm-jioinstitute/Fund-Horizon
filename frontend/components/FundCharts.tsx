// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DrawdownEpisode, FundNavPoint, RollingStats } from "@/lib/types";
import { pct } from "@/lib/format";
import InfoTip, { InfoTipMeta } from "@/components/InfoTip";

export function NavChart({ navs }: { navs: FundNavPoint[] }) {
  const [range, setRange] = useState<"1y" | "3y" | "5y" | "all">("3y");
  const [chartView, setChartView] = useState<"nav" | "drawdown">("nav");

  // Pre-calculate running peak and drawdown for each point in the full series
  const enrichedNavs = useMemo(() => {
    let runningMax = 0;
    return navs.map((p) => {
      if (p.nav > runningMax) runningMax = p.nav;
      const dd = runningMax > 0 ? (p.nav / runningMax - 1) * 100 : 0;
      return {
        ...p,
        peakNav: runningMax,
        drawdown: Number(dd.toFixed(2)),
      };
    });
  }, [navs]);

  const filtered = useMemo(() => {
    if (!enrichedNavs.length) return [];
    if (range === "all") return enrichedNavs;
    const lastDate = new Date(enrichedNavs[enrichedNavs.length - 1].date);
    const years = range === "1y" ? 1 : range === "3y" ? 3 : 5;
    const cutoff = new Date(lastDate);
    cutoff.setFullYear(cutoff.getFullYear() - years);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const subset = enrichedNavs.filter((p) => p.date >= cutoffStr);
    return subset.length > 1 ? subset : enrichedNavs;
  }, [enrichedNavs, range]);

  if (!filtered.length) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">No NAV history available.</p>;
  }

  const minNav = Math.min(...filtered.map((p) => p.nav));
  const maxNav = Math.max(...filtered.map((p) => p.nav));
  const yDomainNav = [Math.floor(minNav * 0.95), Math.ceil(maxNav * 1.05)];

  const minDd = Math.min(...filtered.map((p) => p.drawdown));
  const yDomainDd = [Math.floor(Math.min(minDd * 1.1, -5)), 0];

  // Pick ~6 ticks
  const step = Math.max(1, Math.floor(filtered.length / 6));
  const ticks = filtered.filter((_, i) => i % step === 0).map((p) => p.date);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-blue-50/60 dark:bg-slate-800 p-0.5 text-xs font-medium border border-blue-100 dark:border-slate-700" role="tablist" aria-label="Chart mode">
            <button
              type="button"
              role="tab"
              aria-selected={chartView === "nav"}
              onClick={() => setChartView("nav")}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                chartView === "nav" ? "bg-white dark:bg-slate-900 text-[#0176D3] dark:text-[#8AB8FF] shadow-sm font-semibold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              NAV Trend
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartView === "drawdown"}
              onClick={() => setChartView("drawdown")}
              className={`rounded-md px-2.5 py-1 transition-colors ${
                chartView === "drawdown" ? "bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-400 shadow-sm font-semibold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              Underwater (Drawdown %)
            </button>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg bg-blue-50/60 dark:bg-slate-800 p-0.5 text-xs font-medium border border-blue-100 dark:border-slate-700" role="group" aria-label="Time horizon">
          {(["1y", "3y", "5y", "all"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 uppercase transition-colors ${
                range === r ? "bg-white dark:bg-slate-900 text-[#0176D3] dark:text-[#8AB8FF] shadow-sm font-semibold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64" role="img" aria-label={chartView === "nav" ? `NAV chart over ${range}` : `Drawdown chart over ${range}`}>
        <ResponsiveContainer>
          {chartView === "nav" ? (
            <LineChart data={filtered} margin={{ left: 8, right: 12, top: 8 }}>
              <CartesianGrid stroke="#DCE6F2" vertical={false} />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={(d: string) => d.slice(0, 7)}
                fontSize={11}
              />
              <YAxis domain={yDomainNav} tickFormatter={(v: number) => `₹${v.toFixed(1)}`} width={68} fontSize={11} />
              <Tooltip
                formatter={(v: number) => [`₹${v.toFixed(2)}`, "NAV"]}
                labelFormatter={(d: string) => `Date: ${d}`}
              />
              <Line
                type="monotone"
                dataKey="nav"
                stroke="#0E7C74"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name="NAV"
              />
            </LineChart>
          ) : (
            <LineChart data={filtered} margin={{ left: 8, right: 12, top: 8 }}>
              <CartesianGrid stroke="#DCE6F2" vertical={false} />
              <ReferenceLine y={0} stroke="#94A3B8" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={(d: string) => d.slice(0, 7)}
                fontSize={11}
              />
              <YAxis domain={yDomainDd} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={58} fontSize={11} />
              <Tooltip
                formatter={(v: number, name: string, item: { payload?: { nav?: number; peakNav?: number } }) => {
                  const pNav = item.payload?.peakNav ? ` (Peak: ₹${item.payload.peakNav.toFixed(2)})` : "";
                  const cNav = item.payload?.nav ? ` [NAV: ₹${item.payload.nav.toFixed(2)}]` : "";
                  return [`${v.toFixed(2)}%${cNav}${pNav}`, "Drawdown"];
                }}
                labelFormatter={(d: string) => `Date: ${d}`}
              />
              <Line
                type="monotone"
                dataKey="drawdown"
                stroke="#E11D48"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name="Drawdown"
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DrawdownEpisodesTable({
  episodes,
}: {
  episodes: DrawdownEpisode[];
}) {
  if (!episodes || !episodes.length) return null;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/40">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b border-slate-200/80 dark:border-slate-800 bg-blue-50/40 dark:bg-slate-900/60 font-semibold text-slate-800 dark:text-slate-200">
          <tr>
            <th className="px-3 py-2">Rank</th>
            <th className="px-3 py-2">Max Drawdown</th>
            <th className="px-3 py-2">Peak Date (NAV)</th>
            <th className="px-3 py-2">Trough Date (NAV)</th>
            <th className="px-3 py-2">Recovery Date (NAV)</th>
            <th className="px-3 py-2">Underwater Duration</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {episodes.map((ep, idx) => (
            <tr key={`${ep.peak_date}-${ep.trough_date}`} className="hover:bg-blue-50/20 dark:hover:bg-slate-800/30">
              <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">#{idx + 1}</td>
              <td className="px-3 py-2 font-bold text-rose-700 dark:text-rose-400">{pct(ep.max_drop)}</td>
              <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                {ep.peak_date} <span className="text-slate-400 font-mono">(₹{ep.peak_nav.toFixed(2)})</span>
              </td>
              <td className="px-3 py-2 text-rose-700 dark:text-rose-400 font-medium">
                {ep.trough_date} <span className="text-slate-400 font-mono">(₹{ep.trough_nav.toFixed(2)})</span>
              </td>
              <td className="px-3 py-2 text-[#0176D3] dark:text-[#8AB8FF] font-medium">
                {ep.recovery_date ? (
                  <>
                    {ep.recovery_date} <span className="text-slate-400 font-mono">(₹{ep.recovery_nav?.toFixed(2)})</span>
                  </>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">Not yet recovered</span>
                )}
              </td>
              <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{ep.months} months</td>
              <td className="px-3 py-2">
                {ep.recovered ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60 px-2 py-0.5 text-[10px] font-medium">
                    Recovered
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 px-2 py-0.5 text-[10px] font-medium">
                    Ongoing
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RollingDistributionCard({
  stats,
  title,
  metric,
  meta,
}: {
  stats: RollingStats;
  title: string;
  metric?: string;
  meta?: InfoTipMeta | null;
}) {
  if (stats.median === null || stats.min === null || stats.max === null) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/40 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1">
          <span>{title}</span>
          {metric && <InfoTip metric={metric} meta={meta} />}
        </span>
        {stats.pct_positive !== null && (
          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#0176D3] border border-blue-200/60 dark:bg-blue-950/50 dark:text-[#8AB8FF] dark:border-blue-800/50">
            {pct(stats.pct_positive, 0)} positive
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-blue-50/30 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 p-1.5">
          <dt className="text-slate-500 dark:text-slate-400">Min</dt>
          <dd className="font-bold text-rose-700 dark:text-rose-400">{pct(stats.min)}</dd>
        </div>
        <div className="rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 p-1.5">
          <dt className="text-slate-600 dark:text-slate-400">Median</dt>
          <dd className="font-bold text-[#0176D3] dark:text-[#8AB8FF]">{pct(stats.median)}</dd>
        </div>
        <div className="rounded-lg bg-blue-50/30 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 p-1.5">
          <dt className="text-slate-500 dark:text-slate-400">Max</dt>
          <dd className="font-bold text-[#0176D3] dark:text-[#8AB8FF]">{pct(stats.max)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function CaptureRatioBarChart({
  upCapture,
  downCapture,
}: {
  upCapture: number | null;
  downCapture: number | null;
}) {
  if (upCapture === null && downCapture === null) {
    return <p className="text-sm text-slate-600 dark:text-slate-400">Capture ratio data is unavailable.</p>;
  }

  // API capture_ratios are already in percent (100 = in line with the category median).
  const data = [
    {
      metric: "Up-Market Capture",
      value: upCapture !== null ? Number(upCapture.toFixed(1)) : 0,
      description: "Higher is better (participates in category gains)",
      color: "#0176D3",
    },
    {
      metric: "Down-Market Capture",
      value: downCapture !== null ? Number(downCapture.toFixed(1)) : 0,
      description: "Lower is better (protects during category drops)",
      color: "#B45309",
    },
  ];

  return (
    <div className="space-y-2">
      <div
        className="h-44"
        role="img"
        aria-label="Up and down market capture ratios vs category benchmark"
        data-testid="capture-chart"
      >
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 20, right: 30, top: 10, bottom: 10 }}>
            <CartesianGrid stroke="#DCE6F2" horizontal={false} />
            <XAxis type="number" domain={[0, (dataMax: number) => Math.max(120, Math.ceil(dataMax * 1.15))]} tickFormatter={(v: number) => `${v}%`} fontSize={11} />
            <YAxis type="category" dataKey="metric" width={140} fontSize={12} tickLine={false} />
            <Tooltip formatter={(v: number) => [`${v}%`, "Capture vs Benchmark"]} />
            <ReferenceLine x={100} stroke="#6B7A8F" strokeDasharray="3 3" label={{ value: "Benchmark (100%)", fontSize: 10, fill: "#6B7A8F", position: "top" }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.metric} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Benchmark is the category median NAV. An up-market capture &gt; 100% means the scheme outperformed the median in rising months. A down-market capture &lt; 100% means it lost less than the median in falling months.
      </p>
    </div>
  );
}
