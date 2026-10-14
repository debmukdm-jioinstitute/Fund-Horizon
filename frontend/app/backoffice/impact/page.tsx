"use client";

import React, { useState, useRef } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { API_URL, resolveApiUrl } from "@/lib/api";
import SignedValue from "@/components/terminal/SignedValue";

const PAIR_OPTIONS = [
  { id: "FX:USDINR", label: "USD/INR Reference Rate (ECB)", type: "fx" },
  { id: "FX:EURUSD", label: "EUR/USD Reference Rate (ECB)", type: "fx" },
  { id: "FX:GBPUSD", label: "GBP/USD Reference Rate (ECB)", type: "fx" },
  { id: "FX:USDJPY", label: "USD/JPY Reference Rate (ECB)", type: "fx" },
  { id: "YIELD:US:10Y", label: "US 10Y Treasury Yield (FRED)", type: "yield" },
  { id: "YIELD:IN:10Y", label: "India 10Y G-Sec Yield (FBIL)", type: "yield" },
  { id: "VOL:US:VIX", label: "Cboe Volatility Index VIX", type: "vol" },
  { id: "INDEX:IN:NIFTY50", label: "NIFTY 50 Index (NSE)", type: "index" },
  { id: "MACRO:US:BROAD_USD", label: "Broad Dollar Index Proxy (FRED)", type: "macro" },
];

interface AnalysisResult {
  series_x_id: string;
  series_y_id: string;
  horizon_days: number;
  lag_days: number;
  reason?: string | null;
  n: number;
  coverage: number;
  asof_x?: string | null;
  asof_y?: string | null;
  alignment: {
    n: number;
    coverage_pct: number;
    status: string;
  };
  statistics: {
    correlation: number | null;
    beta: number | null;
    beta_se: number | null;
    p_value: number | null;
    r_squared: number | null;
    r2: number | null;
    ci95: [number, number] | null;
    beta_unit: string;
    rolling_beta: Array<{ date: string; beta: number }>;
    n: number;
    status: string;
    reason?: string | null;
  };
}

interface ScenarioResult {
  shocks: {
    usd_rally_pct: number;
    us_10y_yield_shift_bps: number;
    crude_oil_shock_pct: number;
    assumed_portfolio_duration: number;
    assumed_portfolio_convexity: number;
  };
  impacts: {
    bond_portfolio_price_change_pct: number;
    bond_duration_effect_pct: number;
    bond_convexity_effect_pct: number;
    inr_move: number;
    equity_proxy_move: number;
    india_yield_move_bps: number;
    oil_cpi_inflation_impact_bps: number;
  };
  sources: {
    inr: string;
    equity: string;
    india_yield: string;
  };
  explanation: string;
}

export default function ImpactEnginePage() {
  // Statistical regression state
  const [pairA, setPairA] = useState("FX:USDINR");
  const [pairB, setPairB] = useState("YIELD:US:10Y");
  const [fundCodeInput, setFundCodeInput] = useState("");
  const [windowSessions, setWindowSessions] = useState(60);
  const [lagDays, setLagDays] = useState(0);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Scenario simulation state
  const [bondDuration, setBondDuration] = useState(6.0);
  const [convexity, setConvexity] = useState(0.0);
  const [yieldShiftBps, setYieldShiftBps] = useState(25.0);
  const [fxShiftPct, setFxShiftPct] = useState(1.0);
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  // Abort controllers to prevent stale responses
  const analysisAbortRef = useRef<AbortController | null>(null);
  const scenarioAbortRef = useRef<AbortController | null>(null);

  async function handleRunAnalysis() {
    if (analysisAbortRef.current) {
      analysisAbortRef.current.abort();
    }
    const controller = new AbortController();
    analysisAbortRef.current = controller;

    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalyzing(true);

    try {
      const targetUrl = resolveApiUrl(`${API_URL}/api/backoffice/impact/analyze`);
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          series_x_id: pairB,
          series_y_id: pairA,
          horizon_days: windowSessions,
          lag_days: lagDays,
        }),
      });

      if (controller.signal.aborted) return;

      if (!res.ok) {
        let msg = `Backoffice request failed (${res.status})`;
        try {
          const j = await res.json();
          if (typeof j.detail === "string") msg = j.detail;
        } catch {
          // fallback
        }
        throw new Error(msg);
      }

      const data = (await res.json()) as AnalysisResult;
      if (!controller.signal.aborted) {
        setAnalysisResult(data);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setAnalysisError(err instanceof Error ? err.message : "Failed to run impact analysis");
      setAnalysisResult(null);
    } finally {
      if (!controller.signal.aborted) {
        setAnalyzing(false);
      }
    }
  }

  async function handleRunScenario() {
    if (scenarioAbortRef.current) {
      scenarioAbortRef.current.abort();
    }
    const controller = new AbortController();
    scenarioAbortRef.current = controller;

    setScenarioResult(null);
    setSimulating(true);

    try {
      const targetUrl = resolveApiUrl(`${API_URL}/api/backoffice/impact/scenario`);
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          modified_duration: Number(bondDuration),
          convexity: Number(convexity),
          us_yield_shock_bps: Number(yieldShiftBps),
          usd_shock_pct: Number(fxShiftPct),
          oil_shock_pct: 10.0,
        }),
      });

      if (controller.signal.aborted) return;

      if (!res.ok) {
        throw new Error(`Scenario simulation failed (${res.status})`);
      }

      const data = (await res.json()) as ScenarioResult;
      if (!controller.signal.aborted) {
        setScenarioResult(data);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      console.error(err);
    } finally {
      if (!controller.signal.aborted) {
        setSimulating(false);
      }
    }
  }

  function handleFundCodeChange(val: string) {
    setFundCodeInput(val);
    const trimmed = val.trim();
    if (trimmed) {
      setPairA(`MF:${trimmed}`);
    } else {
      setPairA("FX:USDINR");
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
              HAC OLS • Zero LLM
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
                Continuous log returns &amp; bps changes • HAC Standard Errors (maxlags=5)
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
                value={pairA.startsWith("MF:") ? "CUSTOM_MF" : pairA}
                onChange={(e) => {
                  if (e.target.value === "CUSTOM_MF") {
                    if (fundCodeInput.trim()) {
                      setPairA(`MF:${fundCodeInput.trim()}`);
                    }
                  } else {
                    setPairA(e.target.value);
                    setFundCodeInput("");
                  }
                }}
                className="terminal-input w-full text-[12px] py-1 px-2"
              >
                {PAIR_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                {fundCodeInput.trim() && (
                  <option value="CUSTOM_MF">
                    Mutual Fund NAV (Scheme: {fundCodeInput.trim()})
                  </option>
                )}
              </select>

              {/* Fund Search Box (Scheme Code) */}
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Or enter MF scheme code (e.g. 119551)"
                  value={fundCodeInput}
                  onChange={(e) => handleFundCodeChange(e.target.value)}
                  className="terminal-input flex-1 text-[11px] py-1 px-2 font-mono"
                />
                {pairA.startsWith("MF:") && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#006F64]/10 text-[#006F64] dark:bg-[#75E1CE]/10 dark:text-[#75E1CE] border border-[#006F64]/20 dark:border-[#75E1CE]/20 whitespace-nowrap">
                    mftool active
                  </span>
                )}
              </div>
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                  Observation Window
                </label>
                <div className="flex gap-1.5">
                  {[20, 60, 120].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setWindowSessions(w)}
                      className={`flex-1 py-1 text-[11px] font-mono rounded border transition-colors ${
                        windowSessions === w
                          ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                          : "bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] border-[#E4E9EF] dark:border-[#2B3644] hover:bg-[#FFFFFF] dark:hover:bg-[#10151C]"
                      }`}
                    >
                      {w}d
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                  Lag on X (Calendar Days)
                </label>
                <div className="flex gap-1.5">
                  {[0, 1, 2, 5].map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLagDays(l)}
                      className={`flex-1 py-1 text-[11px] font-mono rounded border transition-colors ${
                        lagDays === l
                          ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                          : "bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] border-[#E4E9EF] dark:border-[#2B3644] hover:bg-[#FFFFFF] dark:hover:bg-[#10151C]"
                      }`}
                    >
                      +{l}d
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleRunAnalysis}
              disabled={analyzing || pairA === pairB}
              className="terminal-btn w-full text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium disabled:opacity-50"
            >
              {analyzing ? "Computing HAC Regression…" : "Compute Rolling Relationship"}
            </button>
          </div>

          {analysisError && (
            <div className="terminal-panel p-2.5 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px]">
              {analysisError}
            </div>
          )}

          {analysisResult && (
            <div className="space-y-3 mt-3">
              {analysisResult.reason ? (
                <div className="terminal-panel p-3 border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] text-[12px] space-y-2">
                  <div className="flex items-center gap-2 font-medium text-[#B42332] dark:text-[#FF7D86]">
                    <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#B42332]/10 border border-[#B42332]/20">
                      Reason: {analysisResult.reason}
                    </span>
                    <span>
                      {analysisResult.reason === "no_data" && "No observation data found for the selected series in this window."}
                      {analysisResult.reason === "low_overlap" && `Low session overlap (${analysisResult.coverage}% < 80% threshold).`}
                      {analysisResult.reason === "n<5" && `Sample size too small (n = ${analysisResult.n} < 5 required).`}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] grid grid-cols-2 gap-2 pt-1 border-t border-[#E4E9EF] dark:border-[#2B3644]">
                    <div>Series A As-of: <span className="font-mono text-[#172033] dark:text-[#EDF2F7]">{analysisResult.asof_y || "N/A"}</span></div>
                    <div>Series B As-of: <span className="font-mono text-[#172033] dark:text-[#EDF2F7]">{analysisResult.asof_x || "N/A"}</span></div>
                    <div>Paired Observations: <span className="font-mono text-[#172033] dark:text-[#EDF2F7]">n = {analysisResult.n}</span></div>
                    <div>Shorter-series Coverage: <span className="font-mono text-[#172033] dark:text-[#EDF2F7]">{analysisResult.coverage}%</span></div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="terminal-panel overflow-hidden">
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
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Sensitivity Beta (β)</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            {analysisResult.statistics.beta !== null ? analysisResult.statistics.beta.toFixed(4) : "—"}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                            {analysisResult.statistics.beta_unit || "OLS Slope"}
                          </td>
                        </tr>
                        <tr>
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Standard Error (SE)</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            {analysisResult.statistics.beta_se !== null ? analysisResult.statistics.beta_se.toFixed(4) : "—"}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">HAC Newey-West (maxlags=5)</td>
                        </tr>
                        <tr>
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">p-value</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            {analysisResult.statistics.p_value !== null ? analysisResult.statistics.p_value.toFixed(4) : "—"}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Two-tailed significance test</td>
                        </tr>
                        <tr>
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Goodness of Fit (R²)</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            {analysisResult.statistics.r2 !== null ? analysisResult.statistics.r2.toFixed(4) : "—"}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Proportion of variance explained</td>
                        </tr>
                        <tr>
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">95% Confidence Interval</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            {analysisResult.statistics.ci95
                              ? `[${analysisResult.statistics.ci95[0].toFixed(3)}, ${analysisResult.statistics.ci95[1].toFixed(3)}]`
                              : "—"}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">HAC 95% confidence bounds</td>
                        </tr>
                        <tr>
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Correlation (r)</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            {analysisResult.statistics.correlation !== null
                              ? analysisResult.statistics.correlation.toFixed(4)
                              : "—"}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Pearson linear correlation coefficient</td>
                        </tr>
                        <tr>
                          <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Sample Alignment</td>
                          <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                            n = {analysisResult.n}
                          </td>
                          <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                            {analysisResult.coverage}% coverage (A as-of {analysisResult.asof_y || "N/A"}, B as-of {analysisResult.asof_x || "N/A"})
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Rolling Beta Chart */}
                  {analysisResult.statistics.rolling_beta && analysisResult.statistics.rolling_beta.length > 1 && (
                    <div className="terminal-panel p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                        <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">
                          Rolling Beta (Window: min(20, n))
                        </span>
                        <span className="font-mono">Last {analysisResult.statistics.rolling_beta.length} points</span>
                      </div>
                      <div className="h-36 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={analysisResult.statistics.rolling_beta}
                            margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                          >
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 9 }}
                              stroke="#888888"
                              tickFormatter={(v: string) => v.slice(5)}
                            />
                            <YAxis tick={{ fontSize: 9 }} stroke="#888888" domain={["auto", "auto"]} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#171E27",
                                borderColor: "#2B3644",
                                fontSize: 11,
                                color: "#EDF2F7",
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="beta"
                              stroke="#006F64"
                              strokeWidth={1.5}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </>
              )}
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
                Taylor series: ΔP/P ≈ −D·Δy + ½·C·Δy² • Macro pass-throughs
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] px-1.5 py-0.5 rounded border border-[#E4E9EF] dark:border-[#2B3644]">
              Sensitivity
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                <span>Fixed Income Modified Duration (D)</span>
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
                <span>Portfolio Convexity (C)</span>
                <span className="font-mono text-[#172033] dark:text-[#EDF2F7] font-semibold">{convexity}</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={convexity}
                onChange={(e) => setConvexity(Number(e.target.value))}
                className="w-full accent-[#006F64] dark:accent-[#75E1CE]"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] mb-1">
                <span>US 10Y Yield Shift (bps)</span>
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
              className="terminal-btn w-full text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium disabled:opacity-50"
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
                      <SignedValue value={scenarioResult.impacts.bond_portfolio_price_change_pct} unit="%" />
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      ΔP/P ≈ −D·Δy + ½·C·Δy² (Dur: {scenarioResult.impacts.bond_duration_effect_pct}%, Cvx: {scenarioResult.impacts.bond_convexity_effect_pct}%)
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">India 10Y Sovereign Yield Shift (Δindia)</td>
                    <td className="text-right">
                      <SignedValue value={scenarioResult.impacts.india_yield_move_bps} unit=" bps" />
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      Δindia = β(US10Y→IN10Y) × Δus ({scenarioResult.sources.india_yield})
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">INR FX Shift (USD/INR)</td>
                    <td className="text-right">
                      <SignedValue value={scenarioResult.impacts.inr_move} unit="%" />
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      β(USDINR on DXY) × USD shock ({scenarioResult.sources.inr})
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Equity Proxy Shift (NIFTY 50)</td>
                    <td className="text-right">
                      <SignedValue value={scenarioResult.impacts.equity_proxy_move} unit="%" />
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      β(NIFTY on DXY) × USD shock ({scenarioResult.sources.equity})
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">India CPI Inflation Pass-through</td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      +{scenarioResult.impacts.oil_cpi_inflation_impact_bps.toFixed(1)} bps
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      Crude oil pass-through (~1.8 bps per 1% oil shock)
                    </td>
                  </tr>
                  <tr>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Yield Decimal Equivalent Shift</td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {(yieldShiftBps / 10000).toFixed(4)}
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
