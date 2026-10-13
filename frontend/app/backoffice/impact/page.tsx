"use client";

import React, { useState } from "react";
import {
  analyzeImpact,
  simulateScenario,
  ImpactAnalysisData,
  ImpactScenarioData,
} from "@/lib/backoffice";

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Explainable Impact & Sensitivity Engine</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Strict empirical math (log returns & bps changes) • Zero paid LLMs • Deterministic scenario shock modeling
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          <span>Formulaic & Deterministic</span>
        </div>
      </div>

      {/* Grid: 2 Columns (Empirical Regression + Scenario Sensitivity) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module 1: Empirical Cross-Asset Regression */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-sand-900">Pair Relationship & Regression</h2>
              <p className="text-[11px] text-sand-500">
                Alphanumeric observation alignment (≥80% paired threshold, no forward filling)
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase bg-sand-100 text-sand-700 px-2 py-0.5 rounded">
              OLS Beta
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Asset A (Dependent Variable Y)</label>
              <select
                value={pairA}
                onChange={(e) => setPairA(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              >
                {PAIR_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Asset B (Independent Driver X)</label>
              <select
                value={pairB}
                onChange={(e) => setPairB(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              >
                {PAIR_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Rolling Window</label>
              <div className="flex gap-2">
                {[20, 60, 120].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWindowSessions(w)}
                    className={`flex-1 py-1.5 text-xs font-mono rounded-xl border transition-colors ${
                      windowSessions === w
                        ? "bg-forest-700 text-white border-forest-700 font-semibold"
                        : "bg-sand-50 text-sand-700 border-sand-200 hover:bg-sand-100"
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
              className="w-full py-2.5 px-4 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 disabled:opacity-50 transition-colors shadow-xs"
            >
              {analyzing ? "Computing Regression…" : "Compute Rolling Relationship"}
            </button>
          </div>

          {analysisError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {analysisError}
            </div>
          )}

          {analysisResult && (
            <div className="p-4 bg-sand-50 rounded-xl border border-sand-200 space-y-3 font-mono">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-sand-200">
                <span className="font-sans text-sand-600">Sample Alignment:</span>
                <span className="font-semibold text-sand-900">n = {analysisResult.sample_size} sessions ({analysisResult.paired_ratio_pct}%)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 bg-white rounded-lg border border-sand-200">
                  <div className="text-[10px] text-sand-500 uppercase font-sans">Correlation (r)</div>
                  <div className="text-lg font-bold text-sand-950 mt-0.5">
                    {analysisResult.correlation !== null && analysisResult.correlation !== undefined ? analysisResult.correlation.toFixed(3) : "—"}
                  </div>
                </div>
                <div className="p-2.5 bg-white rounded-lg border border-sand-200">
                  <div className="text-[10px] text-sand-500 uppercase font-sans">Sensitivity Beta (β)</div>
                  <div className="text-lg font-bold text-sand-950 mt-0.5">
                    {analysisResult.beta !== null && analysisResult.beta !== undefined ? analysisResult.beta.toFixed(3) : "—"}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-sand-600 font-sans leading-relaxed pt-1">
                <span className="font-semibold">Mathematical Note:</span> Price series are transformed using continuous log returns ln(P_t / P_prev); yields use basis-point changes (Y_t - Y_prev) × 100.
              </div>
            </div>
          )}
        </div>

        {/* Module 2: Deterministic Scenario Sensitivity Sliders */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-sand-900">Portfolio Sensitivity & Shock Sliders</h2>
              <p className="text-[11px] text-sand-500">
                Exact first-order Taylor bond shock: ΔP/P ≈ -Modified_Duration × (Δbps / 10000)
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
              Sensitivity
            </span>
          </div>

          <div className="space-y-4">
            {/* Bond Duration Slider */}
            <div>
              <div className="flex justify-between text-xs font-medium text-sand-700 mb-1">
                <span>Fixed Income Modified Duration</span>
                <span className="font-mono font-semibold text-forest-800">{bondDuration} yrs</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="15.0"
                step="0.5"
                value={bondDuration}
                onChange={(e) => setBondDuration(Number(e.target.value))}
                className="w-full accent-forest-700"
              />
            </div>

            {/* Sovereign Yield Shock Slider */}
            <div>
              <div className="flex justify-between text-xs font-medium text-sand-700 mb-1">
                <span>Sovereign Yield Shift (bps)</span>
                <span className="font-mono font-semibold text-forest-800">{yieldShiftBps > 0 ? "+" : ""}{yieldShiftBps} bps</span>
              </div>
              <input
                type="range"
                min="-200"
                max="200"
                step="5"
                value={yieldShiftBps}
                onChange={(e) => setYieldShiftBps(Number(e.target.value))}
                className="w-full accent-forest-700"
              />
              <div className="text-[10px] text-sand-500 mt-0.5 font-mono">
                Canonical rule: +25 bps shift corresponds to +0.0025 yield decimal (not 0.25).
              </div>
            </div>

            {/* Currency FX Shift Slider */}
            <div>
              <div className="flex justify-between text-xs font-medium text-sand-700 mb-1">
                <span>USD Depreciation / Appreciation Shift</span>
                <span className="font-mono font-semibold text-forest-800">{fxShiftPct > 0 ? "+" : ""}{fxShiftPct}%</span>
              </div>
              <input
                type="range"
                min="-10"
                max="10"
                step="0.5"
                value={fxShiftPct}
                onChange={(e) => setFxShiftPct(Number(e.target.value))}
                className="w-full accent-forest-700"
              />
            </div>

            <button
              onClick={handleRunScenario}
              disabled={simulating}
              className="w-full py-2.5 px-4 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 transition-colors shadow-xs"
            >
              {simulating ? "Evaluating Sensitivity…" : "Simulate Scenario Impact"}
            </button>
          </div>

          {scenarioResult && (
            <div className="p-4 bg-sand-50 rounded-xl border border-sand-200 space-y-3 font-mono">
              <div className="text-xs font-semibold text-sand-900 font-sans pb-1 border-b border-sand-200">
                First-Order Shock Results:
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 bg-white rounded-lg border border-sand-200">
                  <div className="text-[10px] text-sand-500 uppercase font-sans">Bond Price Shock (ΔP/P)</div>
                  <div className={`text-lg font-bold mt-0.5 ${
                    scenarioResult.estimated_price_change_pct >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}>
                    {scenarioResult.estimated_price_change_pct > 0 ? "+" : ""}
                    {scenarioResult.estimated_price_change_pct.toFixed(2)}%
                  </div>
                </div>
                <div className="p-2.5 bg-white rounded-lg border border-sand-200">
                  <div className="text-[10px] text-sand-500 uppercase font-sans">Yield Decimal Shift</div>
                  <div className="text-lg font-bold text-sand-950 mt-0.5">
                    {scenarioResult.delta_yield_decimal ? scenarioResult.delta_yield_decimal.toFixed(4) : "—"}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-sand-600 font-sans leading-relaxed">
                Formula verified: <code className="bg-sand-200/80 px-1 py-0.5 rounded text-sand-800">{scenarioResult.formula || "ΔP/P ≈ -D_mod * (Δbps / 10000)"}</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
