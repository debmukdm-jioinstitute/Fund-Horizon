"use client";

import React, { useState } from "react";
import {
  analyzeImpact,
  simulateScenario,
  ImpactAnalysisData,
  ImpactScenarioData,
} from "@/lib/backoffice";
import SignedValue from "@/components/terminal/SignedValue";

const PAIR_OPTIONS = [
  { id: "FX:USDINR", label: "USD/INR Reference Rate (ECB)", type: "fx" },
  { id: "FX:EURUSD", label: "EUR/USD Reference Rate (ECB)", type: "fx" },
  { id: "FX:GBPUSD", label: "GBP/USD Reference Rate (ECB)", type: "fx" },
  { id: "FX:USDJPY", label: "USD/JPY Reference Rate (ECB)", type: "fx" },
  { id: "YIELD:US:10Y", label: "US 10Y Treasury Yield (FRED)", type: "yield" },
  { id: "YIELD:IN:10Y", label: "India 10Y G-Sec Yield (FBIL)", type: "yield" },
  { id: "VOL:US:VIX", label: "Cboe Volatility Index VIX", type: "vol" },
  { id: "MACRO:US:BROAD_USD", label: "Broad Dollar Index Proxy (FRED)", type: "macro" },
];

export default function ImpactEnginePage() {
  // Statistical regression state
  const [pairA, setPairA] = useState("FX:USDINR");
  const [pairB, setPairB] = useState("YIELD:US:10Y");
  const [windowSessions, setWindowSessions] = useState(60);
  const [analysisResult, setAnalysisResult] = useState<ImpactAnalysisData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Scenario slider simulation state
  const [bondDuration, setBondDuration] = useState(6.0);
  const [yieldShiftBps, setYieldShiftBps] = useState(25.0);
  const [fxShiftPct, setFxShiftPct] = useState(1.0);
  const [scenarioResult, setScenarioResult] = useState<ImpactScenarioData | null>(null);
  const [simulating, setSimulating] = useState(false);

  async function handleRunAnalysis() {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await analyzeImpact({
        pair_a: pairA,
        pair_b: pairB,
        window_sessions: windowSessions,
      });
      setAnalysisResult(res.data);
    } catch (err: unknown) {
      setAnalysisError(err instanceof Error ? err.message : "Failed to run impact analysis");
      setAnalysisResult(null);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRunScenario() {
    setSimulating(true);
    try {
      const res = await simulateScenario({
        bond_duration: Number(bondDuration),
        yield_shift_bps: Number(yieldShiftBps),
        fx_shift_pct: Number(fxShiftPct),
      });
      setScenarioResult(res.data);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Explainable Impact &amp; Sensitivity Engine
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Empirical Math • Zero LLM
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Empirical regressions and scenario shocks are mathematical sensitivities, not observed facts or investment forecasts.
          </p>
        </div>
      </div>

      {/* Grid: 2 Columns for Empirical Regression & Scenario Shock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Module 1: Empirical Cross-Asset Regression */}
        <div className="terminal-panel p-3.5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
            <div>
              <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                Pair Relationship &amp; Empirical Regression
              </div>
              <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                Continuous log returns &amp; bps changes • ≥80% paired threshold
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] px-1.5 py-0.5 rounded border border-[#E4E9EF] dark:border-[#2B3644]">
              OLS Beta
            </span>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                Asset A (Dependent Y)
              </label>
              <select
                value={pairA}
                onChange={(e) => setPairA(e.target.value)}
                className="terminal-input w-full text-[12px] py-1 px-2"
              >
                {PAIR_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                Asset B (Independent Driver X)
              </label>
              <select
                value={pairB}
                onChange={(e) => setPairB(e.target.value)}
                className="terminal-input w-full text-[12px] py-1 px-2"
              >
                {PAIR_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                Rolling Observation Window
              </label>
              <div className="flex gap-2">
                {[20, 60, 120].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWindowSessions(w)}
                    className={`flex-1 py-1 text-[12px] font-mono rounded border transition-colors ${
                      windowSessions === w
                        ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                        : "bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] border-[#E4E9EF] dark:border-[#2B3644] hover:bg-[#FFFFFF] dark:hover:bg-[#10151C]"
                    }`}
                  >
                    {w} Sessions
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleRunAnalysis}
              disabled={analyzing || pairA === pairB}
              className="terminal-btn w-full text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
            >
              {analyzing ? "Computing Regression…" : "Compute Rolling Relationship"}
            </button>
          </div>

          {analysisError && (
            <div className="terminal-panel p-2.5 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px]">
              {analysisError}
            </div>
          )}

          {analysisResult && (
            <div className="terminal-panel overflow-hidden mt-3">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Statistical Output</th>
                    <th className="text-right">Estimate</th>
                    <th>Specification</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Correlation (r)</td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {analysisResult.correlation !== null && analysisResult.correlation !== undefined
                        ? analysisResult.correlation.toFixed(3)
                        : "—"}
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Pearson linear correlation coefficient</td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Sensitivity Beta (β)</td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {analysisResult.beta !== null && analysisResult.beta !== undefined
                        ? analysisResult.beta.toFixed(3)
                        : "—"}
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">OLS Slope: Cov(Y,X) / Var(X)</td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Sample Alignment</td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      n = {analysisResult.sample_size}
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      {analysisResult.paired_ratio_pct}% concurrent session match
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Module 2: Deterministic Scenario Sensitivity Sliders */}
        <div className="terminal-panel p-3.5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
            <div>
              <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                Portfolio Sensitivity &amp; Shock Sliders
              </div>
              <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                First-order Taylor shock: ΔP/P ≈ −D_mod × (Δbps / 10000)
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] px-1.5 py-0.5 rounded border border-[#E4E9EF] dark:border-[#2B3644]">
              Sensitivity
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                <span>Fixed Income Modified Duration</span>
                <span className="font-mono text-[#172033] dark:text-[#EDF2F7] font-semibold">{bondDuration} yrs</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="15.0"
                step="0.5"
                value={bondDuration}
                onChange={(e) => setBondDuration(Number(e.target.value))}
                className="w-full accent-[#006F64] dark:accent-[#75E1CE]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                <span>Sovereign Yield Shift (bps)</span>
                <span className="font-mono text-[#172033] dark:text-[#EDF2F7] font-semibold">
                  {yieldShiftBps > 0 ? "+" : ""}{yieldShiftBps} bps
                </span>
              </div>
              <input
                type="range"
                min="-200"
                max="200"
                step="5"
                value={yieldShiftBps}
                onChange={(e) => setYieldShiftBps(Number(e.target.value))}
                className="w-full accent-[#006F64] dark:accent-[#75E1CE]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                <span>USD Currency Shift (%)</span>
                <span className="font-mono text-[#172033] dark:text-[#EDF2F7] font-semibold">
                  {fxShiftPct > 0 ? "+" : ""}{fxShiftPct}%
                </span>
              </div>
              <input
                type="range"
                min="-10"
                max="10"
                step="0.5"
                value={fxShiftPct}
                onChange={(e) => setFxShiftPct(Number(e.target.value))}
                className="w-full accent-[#006F64] dark:accent-[#75E1CE]"
              />
            </div>

            <button
              onClick={handleRunScenario}
              disabled={simulating}
              className="terminal-btn w-full text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
            >
              {simulating ? "Evaluating Sensitivity…" : "Simulate Scenario Impact"}
            </button>
          </div>

          {scenarioResult && (
            <div className="terminal-panel overflow-hidden mt-3">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Shock Derivative Output</th>
                    <th className="text-right">Estimated Change</th>
                    <th>Analytical Detail</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Estimated Bond Price Shock (ΔP/P)</td>
                    <td className="text-right">
                      <SignedValue value={scenarioResult.estimated_price_change_pct} unit="%" />
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      Formula: {scenarioResult.formula || "ΔP/P ≈ −D_mod × (Δbps / 10000)"}
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Yield Decimal Equivalent Shift</td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {scenarioResult.delta_yield_decimal !== undefined
                        ? scenarioResult.delta_yield_decimal.toFixed(4)
                        : "—"}
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      {yieldShiftBps} bps = {(yieldShiftBps / 10000).toFixed(4)} yield decimal
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
