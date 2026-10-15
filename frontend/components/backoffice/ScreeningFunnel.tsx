"use client";

import React from "react";
import { ScreeningFunnelCounts } from "@/lib/backoffice";

export type FunnelStageKey = "all" | "s1" | "s2" | "s3" | "s4a" | "final" | "retain";

interface ScreeningFunnelProps {
  counts: ScreeningFunnelCounts | null;
  stageAsOf?: { nav?: string | null; managers?: string | null; ter?: string | null };
  activeStage: FunnelStageKey;
  onSelectStage: (stage: FunnelStageKey) => void;
}

export default function ScreeningFunnel({
  counts,
  stageAsOf,
  activeStage,
  onSelectStage,
}: ScreeningFunnelProps) {
  const [showHelp, setShowHelp] = React.useState(false);
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
    help: string;
  }> = [
    {
      key: "all",
      label: "S0 Universe",
      sublabel: "Regular Growth",
      count: counts.universe,
      help: "Every Regular-plan, Growth-option fund in the category. Regular plans pay distributor commission, so cost more than Direct. Growth means profits are reinvested, not paid out. Everything starts here.",
    },
    {
      key: "s1",
      label: "S1 Manager",
      sublabel: "Tenure ≥ 3Y",
      count: counts.s1,
      insufficient: counts.insufficient_by_stage?.s1,
      help: "The fund manager must have run the fund for 3 years or more. Past returns belong to the manager, so a new manager means the track record may not repeat.",
    },
    {
      key: "s2",
      label: "S2 Ratios",
      sublabel: "Ratio bounds",
      count: counts.s2,
      insufficient: counts.insufficient_by_stage?.s2,
      help: "Quality ratios (such as Sharpe, Sortino, Alpha, Beta) must sit inside the min/max bounds you set. With no bounds set, every fund passes this stage.",
    },
    {
      key: "s3",
      label: "S3 Capture & Q",
      sublabel: "Up>1, Down<1",
      count: counts.s3_action,
      insufficient: counts.insufficient_by_stage?.s3,
      badge: `${counts.s3_retain} Retain`,
      help: "Capture ratios compare the fund with its benchmark. Up capture above 1 means it gains more when markets rise. Down capture below 1 means it loses less when they fall. Funds in the top quartile (Q1, best 25% of peers) go straight to the Retain list. Q2 and Q3 funds continue to the next stage. The big number counts only the Q2/Q3 funds that continue.",
    },
    {
      key: "s4a",
      label: "S4a Risk",
      sublabel: "Sharpe/Sortino ≥ 1",
      count: counts.s4a,
      insufficient: counts.insufficient_by_stage?.s4a,
      help: "Sharpe and Sortino measure return per unit of risk (Sortino counts only downside swings). Both must be 1 or higher, and the tenure ratio must be 1 or higher. Below 1 means the fund does not pay enough for the risk taken.",
    },
    {
      key: "final",
      label: "Final Action",
      sublabel: "TER ≤ Cat Median",
      count: counts.final,
      insufficient: counts.insufficient_by_stage?.s4c,
      help: "Cost check. The fund yearly fee (TER, Total Expense Ratio) must not exceed the median TER of its category. These funds are the final review candidates.",
    },
  ];

  return (
    <div className="terminal-panel p-3">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0176D3] dark:text-[#1B96FF]">
            Sequential Screening Funnel
          </span>
          <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
            (Each stage ⊆ previous)
          </span>
          {stageAsOf && (
            <span className="text-[10px] font-mono text-[#706E6B] dark:text-[#A8B4C4]">
              NAV {stageAsOf.nav ?? "—"} · Managers {stageAsOf.managers?.slice(0, 10) ?? "none"} · TER {stageAsOf.ter ?? "—"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
            className="terminal-btn text-[11px] py-0.5 px-2"
          >
            {showHelp ? "Hide guide" : "How it works"}
          </button>
          <button
            onClick={() => onSelectStage(activeStage === "retain" ? "final" : "retain")}
            className={`terminal-btn text-[11px] py-0.5 px-2 ${
              activeStage === "retain"
                ? "bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
                : ""
            }`}
          >
            Q1 Retain List ({counts.s3_retain})
          </button>
        </div>
      </div>

      {showHelp && (
        <div className="mb-3 p-3 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27] text-[11px] text-[#181818] dark:text-[#EDF2F7] space-y-2">
          <p>
            Think of a sieve. Funds enter at S0 and each stage removes the ones that fail its test, so every stage is a subset of the one before.
            A fund with missing data is not dropped by default. It passes and is flagged <span className="text-[#C26200] dark:text-[#EAA847]">missing data</span>, so treat that count as unverified.
          </p>
          <ol className="space-y-1.5">
            {stages.map((st) => (
              <li key={st.key}>
                <span className="font-semibold">{st.label}:</span>{" "}
                <span className="text-[#706E6B] dark:text-[#A8B4C4]">{st.help}</span>
              </li>
            ))}
          </ol>
          <p className="text-[#706E6B] dark:text-[#A8B4C4]">
            Q1 Retain List: top-quartile funds that passed S1 to S3. They are kept without further cost or risk filtering, so this list can include funds that would fail the final stage.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {stages.map((st) => {
          const isSelected = activeStage === st.key;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => onSelectStage(st.key)}
              title={st.help}
              className={`p-2 rounded text-left border transition-all ${
                isSelected
                  ? "bg-[#0176D3]/10 dark:bg-[#1B96FF]/15 border-[#0176D3] dark:border-[#1B96FF]"
                  : "bg-[#F3F3F3] dark:bg-[#171E27] border-[#E5E5E5] dark:border-[#2B3644] hover:border-[#0176D3]/50 dark:hover:border-[#1B96FF]/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                  {st.label}
                </span>
                {st.badge && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-[#0176D3]/15 text-[#0176D3] dark:text-[#1B96FF] font-mono">
                    {st.badge}
                  </span>
                )}
              </div>
              <div className="text-[18px] font-semibold tracking-tight text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                {st.count}
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                <span>{st.sublabel}</span>
                {st.insufficient !== undefined && st.insufficient > 0 && (
                  <span className="text-[#C26200] dark:text-[#EAA847] tabular-nums" title="Funds with missing data at this stage">
                    {st.insufficient} missing data
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
