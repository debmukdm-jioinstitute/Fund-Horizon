"use client";

import React, { useState } from "react";
import {
  evaluatePmsScreening,
  PMS_BENCHMARKS,
  type PmsStrategyItem,
} from "@/lib/backoffice";
import { formatCrore } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";

interface PmsMethodologyModalProps {
  strategy?: PmsStrategyItem | null;
  initialBenchmark?: string;
  onClose: () => void;
  onBenchmarkChange?: (bench: string) => void;
}

export default function PmsMethodologyModal({
  strategy,
  initialBenchmark = "BSE 500 TRI",
  onClose,
  onBenchmarkChange,
}: PmsMethodologyModalProps) {
  const [benchmark, setBenchmark] = useState<string>(
    strategy?.benchmark_name && PMS_BENCHMARKS[strategy.benchmark_name]
      ? strategy.benchmark_name
      : initialBenchmark
  );

  const handleBenchmarkSelect = (b: string) => {
    setBenchmark(b);
    if (onBenchmarkChange) onBenchmarkChange(b);
  };

  const sampleStrategy: Partial<PmsStrategyItem> = strategy || {
    strategy_name: "Representative Strategy (Equity)",
    provider_name: "SEBI Registered Portfolio Manager",
    investment_approach: "Multi Cap",
    aum_crore: 1250,
    return_1m_pct: -4.5,
    return_3m_pct: 1.2,
    return_6m_pct: 8.5,
    return_1y_pct: 14.8,
    return_3y_cagr_pct: 20.3,
  };

  const breakdown = evaluatePmsScreening(sampleStrategy, benchmark);
  const benchData = PMS_BENCHMARKS[benchmark] || PMS_BENCHMARKS["BSE 500 TRI"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 font-sans backdrop-blur-sm">
      <div className="w-full max-w-4xl rounded-2xl bg-white dark:bg-[#131B26] border border-[#E5E5E5] dark:border-[#2B3644] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] p-5 shrink-0 bg-[#F9FAFB] dark:bg-[#17202D]">
          <div>
            <h2 className="text-[18px] font-bold text-[#181818] dark:text-[#EDF2F7] flex items-center gap-2">
              <span>FH PMS Screening Methodology &amp; Live Formula Engine</span>
            </h2>
            <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
              Empirical, explainable 40/30/30 scoring framework with dynamic benchmark alpha simulation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] font-mono text-[#706E6B] hover:text-[#181818] dark:hover:text-[#EDF2F7] cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-[#181818] dark:text-[#EDF2F7] text-[13px]">
          {/* Strategy Context Card & Benchmark Selector */}
          <div className="terminal-panel p-4 bg-[#F8F9FA] dark:bg-[#1A2332] border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                Evaluating Strategy
              </div>
              <div className="text-[16px] font-bold text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                {sampleStrategy.strategy_name}
              </div>
              <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] flex items-center gap-2 mt-0.5">
                <span>{sampleStrategy.provider_name}</span>
                <span>•</span>
                <span>AUM: {sampleStrategy.aum_crore ? formatCrore(sampleStrategy.aum_crore) : "N/A"}</span>
              </div>
            </div>

            {/* Dynamic Benchmark Dropdown */}
            <div className="flex flex-col sm:items-end gap-1 shrink-0">
              <label htmlFor="pms-bench-select" className="text-[11px] font-bold text-[#706E6B] dark:text-[#A8B4C4]">
                Active Comparison Benchmark (Real-Time):
              </label>
              <select
                id="pms-bench-select"
                value={benchmark}
                onChange={(e) => handleBenchmarkSelect(e.target.value)}
                className="bg-white dark:bg-[#10151C] border border-[#D0D5DD] dark:border-[#344054] text-[#181818] dark:text-[#EDF2F7] text-[12.5px] rounded-lg px-3 py-1.5 font-medium shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0176D3]"
              >
                {Object.keys(PMS_BENCHMARKS).map((bKey) => (
                  <option key={bKey} value={bKey}>
                    {bKey} ({PMS_BENCHMARKS[bKey].category})
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">
                1Y: {benchData.return_1y}% · 3Y: {benchData.return_3y}% · 1M: {benchData.return_1m}%
              </span>
            </div>
          </div>

          {/* Real-time Dynamic Score Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#EEF4FF] dark:bg-[#10243E] border border-[#B2CCFF] dark:border-[#1E3A5F] rounded-xl">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#3538CD] dark:text-[#84ADFF]">
                  Live Screening Score
                </span>
                <div className="text-[24px] font-black tabular-nums text-[#181818] dark:text-[#EDF2F7]">
                  {breakdown.score != null ? `${breakdown.score} / 100` : "Needs Review"}
                </div>
              </div>
              {breakdown.rating != null && (
                <div className="text-[18px] font-bold text-[#D97706]">
                  ★ {breakdown.rating} / 5
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-[#706E6B] dark:text-[#A8B4C4]">Screening Signal:</span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[13px] font-bold ${
                  breakdown.signal === "Buy"
                    ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                    : breakdown.signal === "Hold"
                    ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                    : breakdown.signal === "Sell"
                    ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                    : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-current" />
                {breakdown.signal}
              </span>
            </div>
          </div>

          {/* Step-by-Step Mathematical Calculations */}
          <div className="space-y-4">
            <h3 className="text-[14px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
              Step-by-Step Mathematical Evaluation
            </h3>

            {/* Step 1 */}
            <div className="border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-4 bg-white dark:bg-[#17202D] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[13.5px] text-[#0176D3] dark:text-[#1B96FF]">
                  Step 1: Benchmark-Relative Excess Return (Alpha) — Max 40 Points
                </span>
                <span className="font-mono font-bold text-[13px]">
                  Points: {breakdown.totalBenchPoints} / 40
                </span>
              </div>
              <p className="text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                Formula: <code className="font-mono bg-[#F2F4F7] dark:bg-[#202936] px-1 py-0.5 rounded">Alpha = Strategy Return (%) - Benchmark Return (%)</code>.
                Weights: 1Y Alpha (20 pts) + 3Y Alpha (20 pts).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                <div className="bg-[#F8F9FA] dark:bg-[#1F2937] p-3 rounded-lg border border-[#EAECF0] dark:border-[#374151]">
                  <div className="font-semibold text-[#181818] dark:text-[#EDF2F7]">1-Year Alpha vs {benchmark}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Strategy: <SignedValue value={sampleStrategy.return_1y_pct} unit="%" /></span>
                    <span>Bench: <SignedValue value={benchData.return_1y} unit="%" /></span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[#027A48] dark:text-[#75E1CE] font-bold">
                    Alpha: {breakdown.alpha1y != null ? `${breakdown.alpha1y > 0 ? "▲ " : breakdown.alpha1y < 0 ? "▼ " : ""}${Math.abs(breakdown.alpha1y).toFixed(2)}%` : "—"}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4]">
                    Points Awarded: <strong className="text-[#181818] dark:text-[#EDF2F7]">{breakdown.benchPoints1y} / 20</strong>
                  </div>
                </div>

                <div className="bg-[#F8F9FA] dark:bg-[#1F2937] p-3 rounded-lg border border-[#EAECF0] dark:border-[#374151]">
                  <div className="font-semibold text-[#181818] dark:text-[#EDF2F7]">3-Year CAGR Alpha vs {benchmark}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>Strategy: <SignedValue value={sampleStrategy.return_3y_cagr_pct} unit="%" /></span>
                    <span>Bench: <SignedValue value={benchData.return_3y} unit="%" /></span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[#027A48] dark:text-[#75E1CE] font-bold">
                    Alpha: {breakdown.alpha3y != null ? `${breakdown.alpha3y > 0 ? "▲ " : breakdown.alpha3y < 0 ? "▼ " : ""}${Math.abs(breakdown.alpha3y).toFixed(2)}%` : "—"}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4]">
                    Points Awarded: <strong className="text-[#181818] dark:text-[#EDF2F7]">{breakdown.benchPoints3y} / 20</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-4 bg-white dark:bg-[#17202D] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[13.5px] text-[#0176D3] dark:text-[#1B96FF]">
                  Step 2: Multi-Horizon Return Consistency — Max 30 Points
                </span>
                <span className="font-mono font-bold text-[13px]">
                  Points: {breakdown.totalConsistencyPoints.toFixed(1)} / 30
                </span>
              </div>
              <p className="text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                Formula: <code className="font-mono bg-[#F2F4F7] dark:bg-[#202936] px-1 py-0.5 rounded">Consistency = (Positive Horizons / Total Horizons) × 30</code>.
                Evaluates trailing periods (1M, 3M, 6M, 1Y, 3Y).
              </p>
              <div className="bg-[#F8F9FA] dark:bg-[#1F2937] p-3 rounded-lg border border-[#EAECF0] dark:border-[#374151] flex items-center justify-between text-[12px]">
                <div>
                  Positive Horizons Count: <strong>{breakdown.positiveHorizonsCount} of {breakdown.validHorizonsCount} reported</strong>
                </div>
                <div>
                  Win Ratio: <strong>{(breakdown.consistencyRatio * 100).toFixed(0)}%</strong>
                </div>
                <div>
                  Points: <strong className="text-[#027A48] dark:text-[#75E1CE]">{breakdown.totalConsistencyPoints.toFixed(1)} / 30</strong>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-4 bg-white dark:bg-[#17202D] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[13.5px] text-[#0176D3] dark:text-[#1B96FF]">
                  Step 3: Downside Protection &amp; Scale Tier — Max 30 Points
                </span>
                <span className="font-mono font-bold text-[13px]">
                  Points: {breakdown.totalDownsidePoints} / 30
                </span>
              </div>
              <p className="text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                Downside Resilience (15 pts): Checks correction resilience when benchmark fell.
                Operational Scale (15 pts): AUM scale tiers (≥₹1,000 Cr: +15, ≥₹200 Cr: +10, &lt;₹200 Cr: +5).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px]">
                <div className="bg-[#F8F9FA] dark:bg-[#1F2937] p-3 rounded-lg border border-[#EAECF0] dark:border-[#374151]">
                  <div className="font-semibold">Downside Correction Protection</div>
                  <div className="mt-1 text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                    1M Return vs {benchmark} 1M: {sampleStrategy.return_1m_pct ?? "N/A"}% vs {benchData.return_1m}%
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4]">
                    Points: <strong className="text-[#181818] dark:text-[#EDF2F7]">{breakdown.downsideResiliencePoints} / 15</strong>
                  </div>
                </div>

                <div className="bg-[#F8F9FA] dark:bg-[#1F2937] p-3 rounded-lg border border-[#EAECF0] dark:border-[#374151]">
                  <div className="font-semibold">Operational Scale Tier</div>
                  <div className="mt-1 text-[11.5px] text-[#706E6B] dark:text-[#A8B4C4]">
                    AUM: {sampleStrategy.aum_crore ? formatCrore(sampleStrategy.aum_crore) : "Not disclosed"}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4]">
                    Points: <strong className="text-[#181818] dark:text-[#EDF2F7]">{breakdown.aumScalePoints} / 15</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Score Bands Table */}
            <div className="border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-4 bg-white dark:bg-[#17202D] space-y-3">
              <span className="font-bold text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                Fund Horizon Rating &amp; Signal Thresholds
              </span>
              <table className="terminal-table text-[12px]">
                <thead>
                  <tr>
                    <th>Score Band</th>
                    <th>Star Rating</th>
                    <th>FH Screening Signal</th>
                    <th>Staff Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={breakdown.score != null && breakdown.score >= 80 ? "bg-[#ECFDF3] dark:bg-[#0C2B28]/40 font-bold" : ""}>
                    <td>80.0 – 100.0</td>
                    <td>★★★★★ (5 Stars)</td>
                    <td><span className="text-[#027A48] font-bold">Buy</span></td>
                    <td>Strong benchmark outperformance &amp; downside resilience.</td>
                  </tr>
                  <tr className={breakdown.score != null && breakdown.score >= 65 && breakdown.score < 80 ? "bg-[#ECFDF3] dark:bg-[#0C2B28]/40 font-bold" : ""}>
                    <td>65.0 – 79.9</td>
                    <td>★★★★☆ (4 Stars)</td>
                    <td><span className="text-[#027A48] font-bold">Buy</span></td>
                    <td>Healthy active alpha across core horizons.</td>
                  </tr>
                  <tr className={breakdown.score != null && breakdown.score >= 50 && breakdown.score < 65 ? "bg-[#FFFAEB] dark:bg-[#2D2006]/40 font-bold" : ""}>
                    <td>50.0 – 64.9</td>
                    <td>★★★☆☆ (3 Stars)</td>
                    <td><span className="text-[#B54708] font-bold">Hold</span></td>
                    <td>Market-aligned returns, monitor consistency.</td>
                  </tr>
                  <tr className={breakdown.score != null && breakdown.score >= 35 && breakdown.score < 50 ? "bg-[#FEF3F2] dark:bg-[#331114]/40 font-bold" : ""}>
                    <td>35.0 – 49.9</td>
                    <td>★★☆☆☆ (2 Stars)</td>
                    <td><span className="text-[#B42318] font-bold">Sell</span></td>
                    <td>Lagging benchmark over multiple rolling periods.</td>
                  </tr>
                  <tr className={breakdown.score != null && breakdown.score < 35 ? "bg-[#FEF3F2] dark:bg-[#331114]/40 font-bold" : ""}>
                    <td>Below 35.0</td>
                    <td>★☆☆☆☆ (1 Star)</td>
                    <td><span className="text-[#B42318] font-bold">Sell</span></td>
                    <td>Severe multi-period active drag.</td>
                  </tr>
                  <tr className={breakdown.score == null ? "bg-[#F2F4F7] dark:bg-[#1D2939] font-bold" : ""}>
                    <td>Incomplete Data</td>
                    <td>—</td>
                    <td><span className="text-[#475467]">Needs review</span></td>
                    <td>Lacks 3-year track record or required disclosure fields.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Generated Evidence Reasons */}
            {breakdown.reasons.length > 0 && (
              <div className="border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-4 bg-white dark:bg-[#17202D] space-y-2">
                <span className="font-bold text-[13px] text-[#181818] dark:text-[#EDF2F7]">
                  Evidence-Based Reasons (Generated for Client Meetings):
                </span>
                <ul className="space-y-1 text-[12.5px] text-[#344054] dark:text-[#D0D5DD]">
                  {breakdown.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-[#0176D3] dark:text-[#1B96FF]">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E5E5E5] dark:border-[#2B3644] flex items-center justify-between shrink-0 bg-[#F9FAFB] dark:bg-[#17202D]">
          <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
            Fund Horizon internal screening engine · Calculations executed locally in real-time.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="terminal-btn text-[12px] py-1.5 px-4 font-semibold"
          >
            Close Breakdown
          </button>
        </div>
      </div>
    </div>
  );
}
