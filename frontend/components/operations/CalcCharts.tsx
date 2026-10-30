"use client";

import { useEffect, useState } from "react";
import { animate } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PALETTE } from "@/lib/calcExport";
import type { Viz } from "@/lib/calcViz";

const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const axis = { fontSize: 11, fill: "#5B6B85" };
const GRID = "rgba(176, 200, 236, 0.55)";
const CURSOR = { fill: "rgba(26, 115, 232, 0.08)" };
const box = "rounded-3xl border border-white/70 dark:border-white/10 bg-white/70 dark:bg-[#12233A]/60 p-6 shadow-[0_18px_50px_-20px_rgba(26,115,232,0.32),inset_0_1px_0_rgba(255,255,255,0.95)] transition-shadow hover:shadow-[0_24px_60px_-18px_rgba(26,115,232,0.42)]";
/** Vertical gradients so bars and areas read as glass, not flat blocks. */
// A plain <defs> element (not a component): Recharts only renders child elements whose type it knows.
const grads = (
  <defs>
    {PALETTE.map((c, k) => (
      <linearGradient key={c} id={`fhg${k}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={c} stopOpacity={0.95} />
        <stop offset="100%" stopColor={c} stopOpacity={0.55} />
      </linearGradient>
    ))}
  </defs>
);

/** Counts from 0 to `value`; reduced-motion users get the final number at once. */
export function CountUp({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
    const a = animate(0, value, { duration: 0.9, ease: "easeOut", onUpdate: setN });
    return () => a.stop();
  }, [value]);
  return <>{fmt(n)}</>;
}

export default function CalcCharts({ viz }: { viz: Viz }) {
  const { donut, growth, bars } = viz;
  const slices = donut?.filter((s) => s.value > 0) ?? [];
  const tip = { formatter: (v: number) => inr(v), contentStyle: { borderRadius: 14, fontSize: 12, border: "1px solid rgba(176,200,236,0.6)", background: "rgba(255,255,255,0.92)", boxShadow: "0 12px 30px -12px rgba(26,115,232,0.35)" } };
  const money = bars?.unit === "₹";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {slices.length > 0 && (
        <div className={box}>
          <div className="mb-2 text-[15px] font-medium text-[#1B2B45] dark:text-[#EDF1F6]">{viz.donutTitle}</div>
          <div className="h-60" role="img" aria-label={`${viz.donutTitle}: ${slices.map((s) => s.name).join(", ")}`}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={3} cornerRadius={8} animationDuration={1000} animationEasing="ease-out">
                  {slices.map((s, k) => <Cell key={s.name} fill={PALETTE[k % 4]} stroke="none" className="fh-slice" />)}
                </Pie>
                <Tooltip formatter={(v: number) => inr(v)} contentStyle={tip.contentStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {(growth || bars) && (
        <div className={`${box} ${slices.length === 0 ? "lg:col-span-2" : ""}`}>
          <div className="mb-2 text-[15px] font-medium text-[#1B2B45] dark:text-[#EDF1F6]">{growth?.title ?? bars!.title}</div>
          <div className="h-60" role="img" aria-label={growth?.title ?? bars!.title}>
            <ResponsiveContainer>
              {growth?.kind === "area" ? (
                <AreaChart data={growth.pts}>
                  {grads}
                  <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="x" tick={axis} tickLine={false} label={{ value: "Years", position: "insideBottom", offset: -2, style: axis }} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip {...tip} cursor={CURSOR} labelFormatter={(x) => `Year ${x}`} />
                  <Area dataKey="a" name={growth.names[0]} stroke={PALETTE[0]} strokeWidth={2.5} fill="url(#fhg0)" fillOpacity={0.35} animationDuration={1100} />
                </AreaChart>
              ) : growth ? (
                <BarChart data={growth.pts}>
                  {grads}
                  <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="x" tick={axis} tickLine={false} label={{ value: "Years", position: "insideBottom", offset: -2, style: axis }} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip {...tip} cursor={CURSOR} labelFormatter={(x) => `Year ${x}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="a" name={growth.names[0]} stackId="s" fill="url(#fhg0)" animationDuration={900} />
                  <Bar dataKey="b" name={growth.names[1]} stackId="s" fill="url(#fhg1)" radius={[8, 8, 0, 0]} animationDuration={900} animationBegin={250} />
                </BarChart>
              ) : (
                <BarChart data={bars!.cats.map((c, k) => ({ c, a: bars!.a[k], b: bars!.b[k] }))}>
                  {grads}
                  <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="c" tick={axis} tickLine={false} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={money ? 52 : 40} unit={money ? undefined : "%"} tickFormatter={money ? compact : undefined} />
                  <Tooltip formatter={(v: number) => (money ? inr(v) : `${v.toFixed(1)}%`)} contentStyle={tip.contentStyle} cursor={CURSOR} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="a" name={bars!.names[0]} fill="url(#fhg0)" radius={[8, 8, 0, 0]} maxBarSize={44} animationDuration={900} />
                  {bars!.b.some((v) => v > 0) && <Bar dataKey="b" name={bars!.names[1]} fill="url(#fhg1)" radius={[8, 8, 0, 0]} maxBarSize={44} animationDuration={900} animationBegin={200} />}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
