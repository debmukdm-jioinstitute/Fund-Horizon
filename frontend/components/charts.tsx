"use client";

import {
  Area, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { CATEGORY_LABELS, pct, shortInr } from "@/lib/format";
import type { FanPoint } from "@/lib/types";

export const PALETTE = ["#0B2545", "#0E7C74", "#B45309", "#4F7CAC", "#8E5572", "#6B7A8F", "#13A89E", "#98C1D9", "#C9A227"];

export function Donut({ data }: { data: Record<string, number> }) {
  const rows = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, name: CATEGORY_LABELS[k] ?? k, value: Number(v.toFixed(2)) }));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-56 w-56 shrink-0" role="img"
        aria-label={`Allocation: ${rows.map((r) => `${r.name} ${r.value}%`).join(", ")}`}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="value" innerRadius={55} outerRadius={95} paddingAngle={1} isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={r.key} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => `${v}%`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full text-sm">
        {rows.map((r, i) => (
          <li key={r.key} className="flex items-center justify-between border-b border-navy-100 py-1">
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              {r.name}
            </span>
            <span className="font-medium">{r.value.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StressChart({ path }: { path: { date: string; value: number }[] }) {
  const data = path.map((p) => ({ ...p, year: p.date.slice(0, 4) }));
  const ticks = data.filter((p, i) => i % 24 === 0).map((p) => p.date);
  return (
    <div className="h-64" role="img" aria-label="Line chart of an illustrative 10 lakh rupee investment over past years">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 12, top: 8 }}>
          <CartesianGrid stroke="#DCE6F2" vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={(d: string) => d.slice(0, 4)} fontSize={12} />
          <YAxis tickFormatter={(v: number) => shortInr(v)} width={72} fontSize={12} />
          <Tooltip formatter={(v: number) => shortInr(v)} labelFormatter={(d: string) => d.slice(0, 7)} />
          <ReferenceLine y={1_000_000} stroke="#6B7A8F" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="value" stroke="#0E7C74" strokeWidth={2} dot={false} isAnimationActive={false} name="Value" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FanChart({ fan, target }: { fan: FanPoint[]; target: number }) {
  const data = fan.map((f) => ({ year: f.year, base: f.p10, band: f.p90 - f.p10, p50: f.p50, p10: f.p10, p90: f.p90 }));
  return (
    <div className="h-52" role="img" aria-label="Projected goal value range by year: 10th, 50th and 90th percentile">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ left: 8, right: 12, top: 8 }}>
          <CartesianGrid stroke="#DCE6F2" vertical={false} />
          <XAxis dataKey="year" fontSize={12} label={{ value: "Years", position: "insideBottomRight", offset: -2, fontSize: 11 }} />
          <YAxis tickFormatter={(v: number) => shortInr(v)} width={72} fontSize={12} />
          <Tooltip formatter={(_v: number, name: string, item) => {
            const p = item.payload as { p10: number; p50: number; p90: number };
            return name === "p50" ? [shortInr(p.p50), "Median"] : [`${shortInr(p.p10)} to ${shortInr(p.p90)}`, "P10 to P90"];
          }} labelFormatter={(y) => `Year ${y}`} />
          <ReferenceLine y={target} stroke="#B42318" strokeDasharray="5 4"
            label={{ value: "Goal (inflated)", fill: "#B42318", fontSize: 11, position: "insideTopLeft" }} />
          <Area type="monotone" dataKey="base" stackId="a" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area type="monotone" dataKey="band" stackId="a" stroke="none" fill="#13A89E" fillOpacity={0.3} isAnimationActive={false} name="band" />
          <Line type="monotone" dataKey="p50" stroke="#0B2545" strokeWidth={2} dot={false} isAnimationActive={false} name="p50" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Semi-circular gauge for success probability (SVG, no animation). */
export function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 52, cx = 60, cy = 60;
  const arc = (frac: number) => {
    const a = Math.PI * (1 - frac);
    return `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`;
  };
  const color = v >= 0.75 ? "#0E7C74" : v >= 0.4 ? "#B45309" : "#B42318";
  return (
    <svg viewBox="0 0 120 72" className="h-20 w-36" role="img" aria-label={`Chance of reaching goal: ${pct(v, 0)}`}>
      <path d={`M ${arc(0)} A ${r} ${r} 0 0 1 ${arc(1)}`} fill="none" stroke="#DCE6F2" strokeWidth={10} strokeLinecap="round" />
      {v > 0 && <path d={`M ${arc(0)} A ${r} ${r} 0 0 1 ${arc(v)}`} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />}
      <text x={cx} y={56} textAnchor="middle" fontSize={20} fontWeight={700} fill="#0B2545">{pct(v, 0)}</text>
    </svg>
  );
}
