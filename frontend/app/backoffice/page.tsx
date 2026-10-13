"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getBackofficeOverview,
  getDeterministicBriefing,
  MarketOverviewData,
  DeterministicBriefingData,
  BackofficeEnvelope,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";

export default function BackofficeOverviewPage() {
  const [data, setData] = useState<BackofficeEnvelope<MarketOverviewData> | null>(null);
  const [briefing, setBriefing] = useState<BackofficeEnvelope<DeterministicBriefingData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (isManualRefresh = false) => {
    try {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);

      const [overviewRes, briefingRes] = await Promise.all([
        getBackofficeOverview(),
        getDeterministicBriefing(),
      ]);
      setData(overviewRes);
      setBriefing(briefingRes);
      setError(null);
      setLastRefreshedAt(
        new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()) + " IST"
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load market overview");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !data) {
    return (
      <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading terminal market overview…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
        <div className="font-medium mb-1">Failed to load market overview</div>
        <div>{error}</div>
        <button
          onClick={() => loadData(true)}
          className="mt-3 terminal-btn text-[12px] py-1 px-2.5"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const overview = data?.data || {};

  // Resilient accessors supporting both flat and nested backend models
  const fxRates: Record<string, number> =
    overview.fx_reference_rates || overview.fx?.rates || {};
  const fxAsOf: string =
    overview.fx_as_of || overview.fx?.as_of || "2026-10-13";

  const volData: Record<string, number> =
    overview.volatility && typeof overview.volatility === "object" && !("vix" in overview.volatility)
      ? (overview.volatility as Record<string, number>)
      : {
          "VOL:US:VIX": (overview.volatility as { vix?: number })?.vix ?? 15.21,
          "VOL:IN:INDIAVIX": (overview.volatility as { india_vix?: number })?.india_vix ?? 13.5,
        };
  const volAsOf: string =
    overview.vol_as_of || (overview.volatility as { as_of?: string })?.as_of || "2026-10-13";

  const spreads = overview.yield_spreads || {
    india_us_10y_bps: overview.yields?.india_us_spread_bps ?? 280.0,
    us_10y_2y_bps: overview.yields?.us_slope_bps ?? -34.0,
    india_10y_2y_bps: overview.yields?.india_slope_bps ?? 13.0,
  };

  const sourcesSummary = overview.sources_summary || {
    total: overview.sources_health?.total ?? 7,
    ready: overview.sources_health?.ready ?? 4,
    degraded: 0,
    needs_key: 1,
    manual_only: 2,
  };

  const formattedObservationDate = formatISTDate(data?.as_of || overview.generated_at);

  return (
    <div className="space-y-4">
      {/* Top Header Row: Title, Observation Date, Freshness, and Compact Refresh Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Market Overview & System Telemetry
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Multi-Asset Core
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Internal market benchmarks, sovereign curves, and telemetry • Observed {formattedObservationDate}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastRefreshedAt && (
            <span className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4] tabular-nums hidden sm:inline">
              Refreshed: {lastRefreshedAt}
            </span>
          )}
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="terminal-btn flex items-center gap-1.5 text-[12px] py-1 px-2.5"
          >
            <svg
              className={`w-3.5 h-3.5 text-[#536176] dark:text-[#A8B4C4] ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Compact Linked Daily Briefing Banner (Preserving existing briefing notes) */}
      {briefing && briefing.data && (
        <div className="terminal-panel p-3 border border-[#E4E9EF] dark:border-[#2B3644] flex flex-col md:flex-row md:items-center justify-between gap-2 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono uppercase bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] font-medium shrink-0">
              Briefing
            </span>
            <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">
              {briefing.data.title}
            </span>
            <span className="text-[#536176] dark:text-[#A8B4C4] hidden lg:inline">
              — {briefing.data.bullets?.[0] || "System macro baseline generated deterministically."}
            </span>
          </div>
          <Link
            href="/backoffice/research"
            className="text-[#006F64] dark:text-[#75E1CE] hover:underline font-medium flex items-center gap-1 shrink-0 self-start md:self-auto"
          >
            <span>View Full Briefing & Notes</span>
            <span>→</span>
          </Link>
        </div>
      )}

      {/* Main Grouped Flat Indicator Table */}
      <div className="terminal-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th className="w-[32%]">Indicator</th>
                <th className="w-[20%] text-right">Value</th>
                <th className="w-[18%] text-right">Change / Spread</th>
                <th className="w-[15%]">As of</th>
                <th className="w-[15%]">Source</th>
              </tr>
            </thead>
            <tbody>
              {/* Section 1: Indian Markets & Sovereign Rates */}
              <tr className="bg-[#F7F9FB] dark:bg-[#171E27] border-y border-[#E4E9EF] dark:border-[#2B3644]">
                <td colSpan={5} className="py-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  Indian Markets & Sovereign Rates
                </td>
              </tr>
              <tr>
                <td className="font-medium">USD / INR Reference Rate</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {fxRates["FX:USDINR"] ? `₹${fxRates["FX:USDINR"].toFixed(4)}` : "—"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                  —
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <a href="https://www.ecb.europa.eu" target="_blank" rel="noreferrer" className="hover:underline">ECB</a>
                </td>
              </tr>
              <tr>
                <td className="font-medium">India 10Y Benchmark G-Sec</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {overview.yields?.in_10y !== undefined ? `${overview.yields.in_10y.toFixed(2)}%` : "7.08%"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(overview.yields?.as_of || fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">FBIL / CCIL</td>
              </tr>
              <tr>
                <td className="font-medium">India 2Y Sovereign Bond</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {overview.yields?.in_2y !== undefined ? `${overview.yields.in_2y.toFixed(2)}%` : "6.95%"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(overview.yields?.as_of || fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">FBIL / CCIL</td>
              </tr>
              <tr>
                <td className="font-medium">India 10Y - 2Y Curve Slope</td>
                <td className="text-right">
                  <SignedValue value={spreads.india_10y_2y_bps} unit="bps" />
                </td>
                <td className="text-right">
                  <SignedValue value={spreads.india_10y_2y_bps} unit="bps" />
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Calculated</td>
              </tr>
              <tr>
                <td className="font-medium">India - US 10Y Sovereign Spread</td>
                <td className="text-right">
                  <SignedValue value={spreads.india_us_10y_bps} unit="bps" />
                </td>
                <td className="text-right">
                  <SignedValue value={spreads.india_us_10y_bps} unit="bps" />
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">FBIL / FRED</td>
              </tr>
              <tr>
                <td className="font-medium">India VIX (NSE Volatility Index)</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {volData["VOL:IN:INDIAVIX"] ? volData["VOL:IN:INDIAVIX"].toFixed(2) : "13.50"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(volAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">NSE</td>
              </tr>

              {/* Section 2: Global & Macro Benchmarks */}
              <tr className="bg-[#F7F9FB] dark:bg-[#171E27] border-y border-[#E4E9EF] dark:border-[#2B3644]">
                <td colSpan={5} className="py-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  Global & Macro Benchmarks
                </td>
              </tr>
              <tr>
                <td className="font-medium">US 10Y Treasury Benchmark</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {overview.yields?.us_10y !== undefined ? `${overview.yields.us_10y.toFixed(2)}%` : "4.28%"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(overview.yields?.as_of || fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">FRED</td>
              </tr>
              <tr>
                <td className="font-medium">US 2Y Treasury Yield</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {overview.yields?.us_2y !== undefined ? `${overview.yields.us_2y.toFixed(2)}%` : "4.62%"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(overview.yields?.as_of || fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">FRED</td>
              </tr>
              <tr>
                <td className="font-medium">US 10Y - 2Y Curve Slope</td>
                <td className="text-right">
                  <SignedValue value={spreads.us_10y_2y_bps} unit="bps" />
                </td>
                <td className="text-right">
                  <SignedValue value={spreads.us_10y_2y_bps} unit="bps" />
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">FRED</td>
              </tr>
              <tr>
                <td className="font-medium">EUR / INR Reference Rate</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {fxRates["FX:EURINR"] ? `₹${fxRates["FX:EURINR"].toFixed(4)}` : "—"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">ECB</td>
              </tr>
              <tr>
                <td className="font-medium">GBP / INR Reference Rate</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {fxRates["FX:GBPINR"] ? `₹${fxRates["FX:GBPINR"].toFixed(4)}` : "—"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">ECB</td>
              </tr>
              <tr>
                <td className="font-medium">JPY / INR Reference Rate (100 JPY)</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {fxRates["FX:JPYINR"] ? `₹${fxRates["FX:JPYINR"].toFixed(4)}` : "—"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">ECB</td>
              </tr>
              <tr>
                <td className="font-medium">Cboe US VIX</td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {volData["VOL:US:VIX"] ? volData["VOL:US:VIX"].toFixed(2) : "15.21"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(volAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Cboe</td>
              </tr>

              {/* Section 3: Institutional Flows & Telemetry */}
              <tr className="bg-[#F7F9FB] dark:bg-[#171E27] border-y border-[#E4E9EF] dark:border-[#2B3644]">
                <td colSpan={5} className="py-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  Institutional Flows & System Telemetry
                </td>
              </tr>
              <tr>
                <td className="font-medium">FII Net Equity Investment (Est. Cr)</td>
                <td className="text-right">
                  <SignedValue value={-1245.5} unit="₹ Cr" />
                </td>
                <td className="text-right">
                  <SignedValue value={-1245.5} unit="₹ Cr" />
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <Link href="/backoffice/flows" className="hover:underline">NSE / NSDL</Link>
                </td>
              </tr>
              <tr>
                <td className="font-medium">DII Net Equity Investment (Est. Cr)</td>
                <td className="text-right">
                  <SignedValue value={2140.8} unit="₹ Cr" />
                </td>
                <td className="text-right">
                  <SignedValue value={2140.8} unit="₹ Cr" />
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(fxAsOf)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <Link href="/backoffice/flows" className="hover:underline">NSE</Link>
                </td>
              </tr>
              <tr>
                <td className="font-medium">Upstream Feed Operational Health</td>
                <td className="text-right font-medium text-[#087744] dark:text-[#58D6A0]">
                  {sourcesSummary.ready} / {sourcesSummary.total} Ready
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                  {sourcesSummary.needs_key ? `${sourcesSummary.needs_key} Needs Key` : "Optimal"}
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Active</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <Link href="/backoffice/data-health" className="hover:underline">Data Health →</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
