"use client";

import { useEffect, useState } from "react";
import { animate } from "framer-motion";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PALETTE } from "@/lib/calcExport";
import type { Viz } from "@/lib/calcViz";

const compact = (n: number) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const axis = { fontSize: 11, fill: "#667085" };
const box = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] p-4";

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
  const tip = { formatter: (v: number) => inr(v), contentStyle: { borderRadius: 8, fontSize: 12 } };
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {slices.length > 0 && (
        <div className={box}>
          <div className="mb-1 text-[13px] font-bold text-[#172033] dark:text-[#EDF1F6]">{viz.donutTitle}</div>
          <div className="h-60" role="img" aria-label={`${viz.donutTitle}: ${slices.map((s) => s.name).join(", ")}`}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} animationDuration={900}>
                  {slices.map((s, k) => <Cell key={s.name} fill={PALETTE[k % 4]} stroke="none" />)}
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
          <div className="mb-1 text-[13px] font-bold text-[#172033] dark:text-[#EDF1F6]">{growth?.title ?? bars!.title}</div>
          <div className="h-60" role="img" aria-label={growth?.title ?? bars!.title}>
            <ResponsiveContainer>
              {growth?.kind === "area" ? (
                <AreaChart data={growth.pts}>
                  <CartesianGrid stroke="#E4E9EF" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="x" tick={axis} tickLine={false} label={{ value: "Years", position: "insideBottom", offset: -2, style: axis }} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip {...tip} labelFormatter={(x) => `Year ${x}`} />
                  <Area dataKey="a" name={growth.names[0]} stroke={PALETTE[0]} strokeWidth={2.5} fill={PALETTE[0]} fillOpacity={0.2} animationDuration={1000} />
                </AreaChart>
              ) : growth ? (
                <BarChart data={growth.pts}>
                  <CartesianGrid stroke="#E4E9EF" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="x" tick={axis} tickLine={false} label={{ value: "Years", position: "insideBottom", offset: -2, style: axis }} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip {...tip} labelFormatter={(x) => `Year ${x}`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="a" name={growth.names[0]} stackId="s" fill={PALETTE[0]} animationDuration={900} />
                  <Bar dataKey="b" name={growth.names[1]} stackId="s" fill={PALETTE[1]} radius={[3, 3, 0, 0]} animationDuration={900} animationBegin={250} />
                </BarChart>
              ) : (
                <BarChart data={bars!.cats.map((c, k) => ({ c, a: bars!.a[k], b: bars!.b[k] }))}>
                  <CartesianGrid stroke="#E4E9EF" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="c" tick={axis} tickLine={false} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} width={40} unit="%" />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={tip.contentStyle} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="a" name={bars!.names[0]} fill={PALETTE[0]} radius={[4, 4, 0, 0]} animationDuration={900} />
                  <Bar dataKey="b" name={bars!.names[1]} fill={PALETTE[1]} radius={[4, 4, 0, 0]} animationDuration={900} animationBegin={200} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
