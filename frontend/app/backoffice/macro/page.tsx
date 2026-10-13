"use client";

import React, { useState } from "react";
import { getYieldsBoard, YieldsBoardData, BackofficeEnvelope } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";
import { usePolling } from "@/components/backoffice/usePolling";

export default function MacroYieldsPage() {
  const [data, setData] = useState<BackofficeEnvelope<YieldsBoardData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePolling(async (silent) => {
    try {
      if (!silent) setLoading(true);
      setData(await getYieldsBoard());
      setError(null);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load yields board");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [], 300_000);

  if (loading) {
    return (
      <div className="p-8 text-center text-sand-500 font-mono text-xs flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-forest-700" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading sovereign yield curves and cross-country spreads…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
        <div className="font-semibold mb-1">Failed to load yields data</div>
        {error}
      </div>
    );
  }

  const yieldsData = data.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Global Sovereign Yields & Macro Board</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Live US Treasury par yield curve, 10Y-2Y slope & India-US spread in bps ((Y_a - Y_b) × 100)
          </p>
        </div>
        <StatusBadge
          availability={data.availability}
          freshness={data.freshness}
          frequency="daily"
          asOf={yieldsData.as_of}
          units="% Yield / bps Spread"
        />
      </div>

      {/* Spreads Benchmark Highlight Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* India - US 10Y Spread */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>India – US 10Y Spread</span>
            <span className="font-mono text-[10px] bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">Benchmark</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {yieldsData.spreads.in_us_10y_bps !== undefined
              ? `${yieldsData.spreads.in_us_10y_bps > 0 ? "+" : ""}${yieldsData.spreads.in_us_10y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-2 text-[11px] text-sand-500">
            India 10Y G-Sec vs US 10Y Constant Maturity
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={yieldsData.spreads.in_us_10y_bps !== undefined ? "ready" : "unavailable"}
              freshness="current"
              sourceName="US Treasury + India G-Sec (scraped)"
              units="bps"
            />
          </div>
        </div>

        {/* US 10Y - 2Y Curve Slope */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>US 10Y – 2Y Slope</span>
            <span className="font-mono text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">Term Slope</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {yieldsData.spreads.us_10y_2y_bps !== undefined
              ? `${yieldsData.spreads.us_10y_2y_bps > 0 ? "+" : ""}${yieldsData.spreads.us_10y_2y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-2 text-[11px] text-sand-500">
            DGS10 minus DGS2 constant maturity yields
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={yieldsData.spreads.us_10y_2y_bps !== undefined ? "ready" : "unavailable"}
              freshness="current"
              sourceName="US Treasury"
              units="bps"
            />
          </div>
        </div>

        {/* India 10Y - 2Y Curve Slope */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>India 10Y – 2Y Slope</span>
            <span className="font-mono text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">G-Sec Term</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {yieldsData.spreads.in_10y_2y_bps !== undefined
              ? `${yieldsData.spreads.in_10y_2y_bps > 0 ? "+" : ""}${yieldsData.spreads.in_10y_2y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-2 text-[11px] text-sand-500">
            India 10Y minus 2Y G-Sec yield
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={yieldsData.spreads.in_10y_2y_bps !== undefined ? "ready" : "unavailable"}
              freshness="current"
              sourceName="India G-Sec (scraped)"
              units="bps"
            />
          </div>
        </div>
      </div>

      {/* Tenor Term Structure Tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* India G-Sec Curve */}
        <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-sand-900">India G-Sec Curve</h2>
              <p className="text-[11px] text-sand-500">Indicative OTC quotes (scraped, daily) • FRED/OECD monthly fallback</p>
            </div>
            <StatusBadge
              availability={yieldsData.curves.IN && Object.keys(yieldsData.curves.IN).length > 0 ? "ready" : "unavailable"}
              freshness="current"
              frequency="daily"
              sourceName="Trading Economics (scraped)"
              sourceUrl="https://tradingeconomics.com/india/government-bond-yield"
            />
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
              <tr>
                <th className="py-2 px-3 font-medium">Tenor</th>
                <th className="py-2 px-3 font-medium">Yield (%)</th>
                <th className="py-2 px-3 font-medium">Observed Date</th>
                <th className="py-2 px-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
              {yieldsData.curves.IN && Object.keys(yieldsData.curves.IN).length > 0 ? (
                Object.entries(yieldsData.curves.IN).map(([tenor, val]: [string, { value: number; observed_at: string; source: string }]) => (
                  <tr key={tenor}>
                    <td className="py-2.5 px-3 font-semibold text-sand-900">{tenor}</td>
                    <td className="py-2.5 px-3 text-sand-950 font-bold">{val.value.toFixed(2)}%</td>
                    <td className="py-2.5 px-3 text-sand-500 text-[11px]">{val.observed_at}</td>
                    <td className="py-2.5 px-3 text-sand-500 text-[11px]">{val.source}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sand-500 font-sans">
                    {yieldsData.india_message || "India G-Sec yields are not available from a free official feed."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* US Treasury Curve */}
        <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-sand-900">US Treasury Par Yield Curve</h2>
              <p className="text-[11px] text-sand-500">Official daily par yields • U.S. Department of the Treasury</p>
            </div>
            <StatusBadge
              availability={yieldsData.curves.US && Object.keys(yieldsData.curves.US).length > 0 ? "ready" : "unavailable"}
              freshness="current"
              frequency="daily"
              sourceName="US Treasury"
              sourceUrl="https://home.treasury.gov/resource-center/data-chart-center/interest-rates"
            />
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
              <tr>
                <th className="py-2 px-3 font-medium">Tenor</th>
                <th className="py-2 px-3 font-medium">Yield (%)</th>
                <th className="py-2 px-3 font-medium">Observed Date</th>
                <th className="py-2 px-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
              {yieldsData.curves.US && Object.keys(yieldsData.curves.US).length > 0 ? (
                Object.entries(yieldsData.curves.US).map(([tenor, val]: [string, { value: number; observed_at: string; source: string }]) => (
                  <tr key={tenor}>
                    <td className="py-2.5 px-3 font-semibold text-sand-900">{tenor}</td>
                    <td className="py-2.5 px-3 text-sand-950 font-bold">{val.value.toFixed(2)}%</td>
                    <td className="py-2.5 px-3 text-sand-500 text-[11px]">{val.observed_at}</td>
                    <td className="py-2.5 px-3 text-sand-500 text-[11px]">{val.source}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sand-500 font-sans">
                    US Treasury yields have not been fetched yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
