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
import type { FundNavPoint, RollingStats } from "@/lib/types";
import { pct } from "@/lib/format";

export function NavChart({ navs }: { navs: FundNavPoint[] }) {
  const [range, setRange] = useState<"1y" | "3y" | "5y" | "all">("3y");

  const filtered = useMemo(() => {
    if (!navs.length) return [];
    if (range === "all") return navs;
    const lastDate = new Date(navs[navs.length - 1].date);
    const years = range === "1y" ? 1 : range === "3y" ? 3 : 5;
    const cutoff = new Date(lastDate);
    cutoff.setFullYear(cutoff.getFullYear() - years);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const subset = navs.filter((p) => p.date >= cutoffStr);
    return subset.length > 1 ? subset : navs;
  }, [navs, range]);

  if (!filtered.length) {
    return <p className="text-sm text-navy-700">No NAV history available.</p>;
  }

  const minNav = Math.min(...filtered.map((p) => p.nav));
  const maxNav = Math.max(...filtered.map((p) => p.nav));
  const yDomain = [Math.floor(minNav * 0.95), Math.ceil(maxNav * 1.05)];

  // Pick ~6 ticks
  const step = Math.max(1, Math.floor(filtered.length / 6));
  const ticks = filtered.filter((_, i) => i % step === 0).map((p) => p.date);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-navy-900">Historical NAV Trend</h4>
        <div className="flex gap-1 rounded bg-navy-100 p-0.5 text-xs font-medium" role="group" aria-label="Time horizon">
          {(["1y", "3y", "5y", "all"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 uppercase ${
                range === r ? "bg-white text-navy-900 shadow-sm" : "text-navy-700 hover:text-navy-900"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="h-64" role="img" aria-label={`NAV chart over ${range}`}>
        <ResponsiveContainer>
          <LineChart data={filtered} margin={{ left: 8, right: 12, top: 8 }}>
            <CartesianGrid stroke="#DCE6F2" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={(d: string) => d.slice(0, 7)}
              fontSize={11}
            />
            <YAxis domain={yDomain} tickFormatter={(v: number) => `₹${v.toFixed(1)}`} width={68} fontSize={11} />
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
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RollingDistributionCard({
  stats,
  title,
}: {
  stats: RollingStats;
  title: string;
}) {
  if (stats.median === null || stats.min === null || stats.max === null) {
    return null;
  }

  return (
    <div className="rounded-lg border border-navy-100 bg-white p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-navy-900">{title}</span>
        {stats.pct_positive !== null && (
          <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">
            {pct(stats.pct_positive, 0)} positive
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded bg-navy-50 p-1.5">
          <dt className="text-navy-700">Min</dt>
          <dd className="font-bold text-rose-700">{pct(stats.min)}</dd>
        </div>
        <div className="rounded bg-teal-50 p-1.5">
          <dt className="text-teal-900">Median</dt>
          <dd className="font-bold text-teal-800">{pct(stats.median)}</dd>
        </div>
        <div className="rounded bg-navy-50 p-1.5">
          <dt className="text-navy-700">Max</dt>
          <dd className="font-bold text-teal-700">{pct(stats.max)}</dd>
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
    return <p className="text-sm text-navy-700">Capture ratio data is unavailable.</p>;
  }

  // API capture_ratios are already in percent (100 = in line with the category median).
  const data = [
    {
      metric: "Up-Market Capture",
      value: upCapture !== null ? Number(upCapture.toFixed(1)) : 0,
      description: "Higher is better (participates in category gains)",
      color: "#0E7C74",
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
      <p className="text-xs text-navy-700">
        Benchmark is the category median NAV. An up-market capture &gt; 100% means the scheme outperformed the median in rising months. A down-market capture &lt; 100% means it lost less than the median in falling months.
      </p>
    </div>
  );
}
