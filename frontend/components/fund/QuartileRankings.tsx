"use client";

import React from "react";
import type { FundQuartiles } from "@/lib/api";

function parseTier(val: string): { tier: number; label: string; badgeCls: string; dotCls: string; desc: string } {
  const v = val.toLowerCase();
  if (v.includes("top") || v === "q1") {
    return {
      tier: 1,
      label: "Q1 · Top Quartile",
      badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60",
      dotCls: "bg-emerald-500",
      desc: "Top 25% of category",
    };
  }
  if (v.includes("upper") || v === "q2") {
    return {
      tier: 2,
      label: "Q2 · Upper Mid",
      badgeCls: "bg-blue-50 text-[#0176D3] border-blue-200 dark:bg-blue-950/50 dark:text-[#8AB8FF] dark:border-blue-800/60",
      dotCls: "bg-blue-500",
      desc: "Top 25% – 50%",
    };
  }
  if (v.includes("lower") || v === "q3") {
    return {
      tier: 3,
      label: "Q3 · Lower Mid",
      badgeCls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60",
      dotCls: "bg-amber-500",
      desc: "50% – 75% range",
    };
  }
  return {
    tier: 4,
    label: "Q4 · Bottom Quartile",
    badgeCls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60",
    dotCls: "bg-rose-500",
    desc: "Bottom 25% of peers",
  };
}

function Meter({ tier }: { tier: number }) {
  // 4 blocks: 1 (bottom) to 4 (top)
  return (
    <div className="flex items-center gap-1 my-1.5" title={`Quartile rank: Q${tier}`}>
      {[1, 2, 3, 4].map((step) => {
        const active = (5 - tier) >= step;
        return (
          <div
            key={step}
            className={`h-2 flex-1 rounded-sm transition-all ${
              active
                ? tier === 1
                  ? "bg-emerald-500 shadow-sm"
                  : tier === 2
                  ? "bg-blue-500"
                  : tier === 3
                  ? "bg-amber-500"
                  : "bg-rose-400"
                : "bg-slate-200 dark:bg-slate-800 opacity-40"
            }`}
          />
        );
      })}
    </div>
  );
}

export default function QuartileRankings({ data }: { data: FundQuartiles }) {
  const cat = data.category.replace(/^Equity:\s*/i, "");

  return (
    <section className="card space-y-4" data-testid="fund-quartiles">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200/60 dark:border-slate-800/60">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Quartile Rankings &amp; Consistency
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-[#0176D3] border border-blue-200 dark:bg-blue-950/60 dark:text-[#8AB8FF] dark:border-blue-800/60">
              {cat}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Peer quartile rank across trailing horizons and annual performance. Source: Advisorkhoj.
          </p>
        </div>
        <div className="text-[11px] text-slate-400 font-medium shrink-0">
          Q1 = Top 25% · Q4 = Bottom 25%
        </div>
      </div>

      {/* Trailing Horizons */}
      {data.trailing && Object.keys(data.trailing).length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Current Quarter Trailing Quartiles
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(data.trailing).map(([period, val]) => {
              const info = parseTier(val);
              return (
                <div
                  key={period}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/40 p-3.5 space-y-2 shadow-sm"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-900 dark:text-slate-100">{period} Horizon</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${info.badgeCls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${info.dotCls}`} />
                      {info.label}
                    </span>
                  </div>
                  <Meter tier={info.tier} />
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex justify-between items-center">
                    <span>{info.desc}</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 capitalize">{val}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Annual Calendar Year Progression */}
      {data.years && data.years.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Calendar Year Consistency
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {data.years.map(([year, val]) => {
              const info = parseTier(val);
              return (
                <div
                  key={year}
                  className="rounded-xl border border-slate-200/70 dark:border-slate-800/70 bg-slate-50/50 dark:bg-slate-900/30 p-2.5 text-center space-y-1"
                >
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{year}</div>
                  <div className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${info.badgeCls}`}>
                    {val}
                  </div>
                  <div className="text-[10px] text-slate-400">{info.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
