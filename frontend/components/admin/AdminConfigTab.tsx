// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useState, useEffect } from "react";
import { AdminConfigResponse, fetchAdminConfig } from "@/lib/admin-api";
import { pct } from "@/lib/format";

export default function AdminConfigTab() {
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminConfig()
      .then(setConfig)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-12 text-center text-xs text-navy-500">Loading model assumptions...</div>;
  }

  if (!config) {
    return <div className="p-12 text-center text-xs text-rose-600">Failed to load configuration.</div>;
  }

  const a = config.assumptions || {};
  const returns = (a.returns as Record<string, number>) || {};
  const inflation = (a.inflation as Record<string, number>) || {};
  const mc = (a.montecarlo as Record<string, unknown>) || {};
  const planCfg = (a.planning as Record<string, unknown>) || {};
  const allocationObj = (config.allocation as Record<string, unknown>) || {};
  const bands = (allocationObj.bands as Record<string, {
    equity_pct?: number;
    debt_pct?: number;
    gold_pct?: number;
    score_min?: number;
    score_max?: number;
    description?: string;
  }>) || {};
  const scoringObj = (config.scoring as Record<string, unknown>) || {};
  const weights = (scoringObj.weights as Record<string, number>) || {};


  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-navy-950">Deterministic Model Assumptions & Allocation Rules</h2>
          <p className="text-xs text-navy-500">
            Transparent, zero-blackbox model parameters defined in YAML configurations.
          </p>
        </div>
        <span className="text-xs bg-navy-50 border border-navy-200 text-navy-700 px-3 py-1 rounded-lg font-mono">
          data_asof: {String(a.data_asof || "2026-10-09")}
        </span>
      </div>

      {/* Grid of Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Asset Class Returns */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm">
          <h3 className="text-sm font-bold text-navy-950 mb-3 flex items-center gap-2">
            <span>📈</span> Asset Class Expected Returns
          </h3>
          <div className="divide-y divide-navy-50 text-xs">
            {Object.entries(returns).map(([k, v]) => (
              <div key={k} className="py-2.5 flex items-center justify-between">
                <span className="text-navy-600 font-medium capitalize">{k.replace(/_/g, " ")}</span>
                <span className="font-bold text-navy-900 bg-navy-50 px-2 py-0.5 rounded font-mono">
                  {typeof v === "number" ? pct(v) : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Macro & Planning Defaults */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm">
          <h3 className="text-sm font-bold text-navy-950 mb-3 flex items-center gap-2">
            <span>🎯</span> Macro & Protection Assumptions
          </h3>
          <div className="divide-y divide-navy-50 text-xs">
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-navy-600 font-medium">Headline Inflation</span>
              <span className="font-bold text-navy-900 bg-navy-50 px-2 py-0.5 rounded font-mono">
                {pct(inflation.headline || 0.06)}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-navy-600 font-medium">Education Inflation</span>
              <span className="font-bold text-navy-900 bg-navy-50 px-2 py-0.5 rounded font-mono">
                {pct(inflation.education || 0.08)}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-navy-600 font-medium">Emergency Fund Multiplier</span>
              <span className="font-bold text-navy-900 bg-navy-50 px-2 py-0.5 rounded font-mono">
                {String(planCfg.emergency_fund_months ?? 6)} months expenses
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-navy-600 font-medium">Term Insurance Coverage Multiplier</span>
              <span className="font-bold text-navy-900 bg-navy-50 px-2 py-0.5 rounded font-mono">
                {String(planCfg.term_insurance_income_multiplier ?? 12)}x annual income
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between">
              <span className="text-navy-600 font-medium">Monte Carlo Target Success Rate</span>
              <span className="font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded font-mono">
                {pct(typeof mc.target_success === "number" ? mc.target_success : 0.85)} ({String(mc.sims ?? 1000)} simulations)
              </span>
            </div>

          </div>
        </div>

        {/* Risk Bands Matrix */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm md:col-span-2">
          <h3 className="text-sm font-bold text-navy-950 mb-3 flex items-center gap-2">
            <span>⚖️</span> Asset Allocation Risk Bands (Glide Paths)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy-50 text-navy-700 uppercase font-semibold text-xs">
                <tr>
                  <th className="px-4 py-2.5">Band</th>
                  <th className="px-4 py-2.5">Target Equity %</th>
                  <th className="px-4 py-2.5">Target Debt %</th>
                  <th className="px-4 py-2.5">Target Gold %</th>
                  <th className="px-4 py-2.5">Score Range</th>
                  <th className="px-4 py-2.5">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {Object.entries(bands).map(([name, b]) => (
                  <tr key={name} className="hover:bg-navy-50/50">

                    <td className="px-4 py-3 font-bold text-navy-950">{name}</td>
                    <td className="px-4 py-3 font-semibold text-teal-700">{b.equity_pct}%</td>
                    <td className="px-4 py-3 font-semibold text-navy-700">{b.debt_pct}%</td>
                    <td className="px-4 py-3 text-navy-600">{b.gold_pct || 0}%</td>
                    <td className="px-4 py-3 font-mono text-navy-500">
                      {b.score_min ?? 0} – {b.score_max ?? 100}
                    </td>
                    <td className="px-4 py-3 text-navy-600">{b.description || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Scoring Weights */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm md:col-span-2">
          <h3 className="text-sm font-bold text-navy-950 mb-3 flex items-center gap-2">
            <span>🏆</span> Fund Shortlist Ranking Weights (`scoring.yaml`)
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {Object.entries(weights).map(([k, w]) => (
              <div key={k} className="p-3 rounded-xl border border-navy-100 bg-navy-50/40 text-center">
                <span className="text-xs font-semibold text-navy-500 uppercase">{k.replace(/_/g, " ")}</span>
                <p className="text-lg font-extrabold text-navy-950 mt-1 font-mono">
                  {typeof w === "number" ? `${(w * 100).toFixed(0)}%` : String(w)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
