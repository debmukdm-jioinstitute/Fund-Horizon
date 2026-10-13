"use client";

import React from "react";
import { ScreeningFunnelCounts } from "@/lib/backoffice";

export type FunnelStageKey = "all" | "s1" | "s2" | "s3" | "s4a" | "final" | "retain";

interface ScreeningFunnelProps {
  counts: ScreeningFunnelCounts | null;
  activeStage: FunnelStageKey;
  onSelectStage: (stage: FunnelStageKey) => void;
}

export default function ScreeningFunnel({
  counts,
  activeStage,
  onSelectStage,
}: ScreeningFunnelProps) {
  if (!counts) {
    return null;
  }

  const stages: Array<{
    key: FunnelStageKey;
    label: string;
    sublabel: string;
    count: number;
    insufficient?: number;
    badge?: string;
  }> = [
    {
      key: "all",
      label: "S0 Universe",
      sublabel: "Regular Growth",
      count: counts.universe,
    },
    {
      key: "s1",
      label: "S1 Manager",
      sublabel: "Tenure ≥ 3Y",
      count: counts.s1,
      insufficient: counts.insufficient_by_stage?.s1,
    },
    {
      key: "s2",
      label: "S2 Ratios",
      sublabel: "Bounded Peers",
      count: counts.s2,
      insufficient: counts.insufficient_by_stage?.s2,
    },
    {
      key: "s3",
      label: "S3 Capture & Q",
      sublabel: "Up>1, Down<1",
      count: counts.s3_action,
      insufficient: counts.insufficient_by_stage?.s3,
      badge: `${counts.s3_retain} Retain`,
    },
    {
      key: "s4a",
      label: "S4a Risk",
      sublabel: "Sharpe/Sortino ≥ 1",
      count: counts.s4a,
      insufficient: counts.insufficient_by_stage?.s4a,
    },
    {
      key: "final",
      label: "Final Action",
      sublabel: "TER ≤ Cat Median",
      count: counts.final,
      insufficient: counts.insufficient_by_stage?.s4c,
    },
  ];

  return (
    <div className="terminal-panel p-3">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
            Sequential Screening Funnel
          </span>
          <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
            (Each stage ⊆ previous)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            onClick={() => onSelectStage(activeStage === "retain" ? "final" : "retain")}
            className={`terminal-btn text-[11px] py-0.5 px-2 ${
              activeStage === "retain"
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            Q1 Retain List ({counts.s3_retain})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {stages.map((st) => {
          const isSelected = activeStage === st.key;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => onSelectStage(st.key)}
              className={`p-2 rounded text-left border transition-all ${
                isSelected
                  ? "bg-[#006F64]/10 dark:bg-[#75E1CE]/15 border-[#006F64] dark:border-[#75E1CE]"
                  : "bg-[#F7F9FB] dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64]/50 dark:hover:border-[#75E1CE]/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {st.label}
                </span>
                {st.badge && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-[#006F64]/15 text-[#006F64] dark:text-[#75E1CE] font-mono">
                    {st.badge}
                  </span>
                )}
              </div>
              <div className="text-[18px] font-semibold tracking-tight text-[#172033] dark:text-[#EDF2F7] tabular-nums">
                {st.count}
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
                <span>{st.sublabel}</span>
                {st.insufficient !== undefined && st.insufficient > 0 && (
                  <span className="text-[#C26200] dark:text-[#EAA847] tabular-nums" title="Insufficient data to pass stage">
                    {st.insufficient} unavail
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
