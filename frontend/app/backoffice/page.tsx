"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getBackofficeOverview,
  getDeterministicBriefing,
  MarketOverviewData,
  DeterministicBriefingData,
  BackofficeEnvelope,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";
import IndicatorDrawer, { IndicatorSpec } from "@/components/backoffice/IndicatorDrawer";
import InfoTip from "@/components/InfoTip";

const IND: Record<string, IndicatorSpec> = {
  usdinr: { title: "USD / INR Reference Rate", a: "FX:USDINR", unit: "", decimals: 4 },
  eurinr: { title: "EUR / INR Reference Rate", a: "FX:EURINR", unit: "", decimals: 4 },
  gbpinr: { title: "GBP / INR Reference Rate", a: "FX:GBPINR", unit: "", decimals: 4 },
  jpyinr: { title: "JPY / INR Reference Rate (100 JPY)", a: "FX:JPYINR", unit: "", decimals: 4 },
  in10: { title: "India 10Y Benchmark G-Sec", a: "YIELD:IN:10Y", unit: "%" },
  in2: { title: "India 2Y Sovereign Bond", a: "YIELD:IN:2Y", unit: "%" },
  us10: { title: "US 10Y Treasury Benchmark", a: "YIELD:US:10Y", unit: "%" },
  us2: { title: "US 2Y Treasury Yield", a: "YIELD:US:2Y", unit: "%" },
  inSlope: { title: "India 10Y - 2Y Curve Slope", a: "YIELD:IN:10Y", b: "YIELD:IN:2Y", scale: 100, unit: " bps", decimals: 0 },
  usSlope: { title: "US 10Y - 2Y Curve Slope", a: "YIELD:US:10Y", b: "YIELD:US:2Y", scale: 100, unit: " bps", decimals: 0 },
  inUs: { title: "India - US 10Y Sovereign Spread", a: "YIELD:IN:10Y", b: "YIELD:US:10Y", scale: 100, unit: " bps", decimals: 0 },
  inVix: { title: "India VIX (NSE Volatility Index)", a: "VOL:IN:INDIAVIX", unit: "" },
  usVix: { title: "Cboe US VIX", a: "VOL:US:VIX", unit: "" },
};

// Row label -> what a click opens: an indicator history, or another backoffice page.
const ROW_TARGET: Record<string, keyof typeof IND | string> = {
  "USD / INR Reference Rate": "usdinr",
  "India 10Y Benchmark G-Sec": "in10",
  "India 2Y Sovereign Bond": "in2",
  "India 10Y - 2Y Curve Slope": "inSlope",
  "India - US 10Y Sovereign Spread": "inUs",
  "India VIX (NSE Volatility Index)": "inVix",
  "US 10Y Treasury Benchmark": "us10",
  "US 2Y Treasury Yield": "us2",
  "US 10Y - 2Y Curve Slope": "usSlope",
  "EUR / INR Reference Rate": "eurinr",
  "GBP / INR Reference Rate": "gbpinr",
  "JPY / INR Reference Rate (100 JPY)": "jpyinr",
  "Cboe US VIX": "usVix",
  "FII Net Equity Investment (Cr)": "/backoffice/flows",
  "DII Net Equity Investment (Cr)": "/backoffice/flows",
  "Upstream Feed Operational Health": "/backoffice/data-health",
};

export default function BackofficeOverviewPage() {
  const [data, setData] = useState<BackofficeEnvelope<MarketOverviewData> | null>(null);
  const [briefing, setBriefing] = useState<BackofficeEnvelope<DeterministicBriefingData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<IndicatorSpec | null>(null);
  const router = useRouter();

  const rowProps = (label: string) => {
    const target = ROW_TARGET[label];
    const open = () => (target.startsWith("/") ? router.push(target) : setIndicator(IND[target]));
    return {
      onClick: open,
      onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && open(),
      tabIndex: 0,
      className: "cursor-pointer hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] focus:outline-none focus-visible:bg-[#F7F9FB] dark:focus-visible:bg-[#171E27]",
    };
  };

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

  // Only what the collectors actually stored: a missing value renders as "—", never a placeholder number.
  const vol = (overview.volatility ?? {}) as { vix?: number | null; india_vix?: number | null; vix_as_of?: string | null; india_vix_as_of?: string | null; as_of?: string };
  const volData: Record<string, number | undefined> = {
    "VOL:US:VIX": vol.vix ?? undefined,
    "VOL:IN:INDIAVIX": vol.india_vix ?? undefined,
  };

  const spreads = overview.yield_spreads ?? {};

  // Date and provider per indicator come from that series' own latest observation; a spread shows the older leg.
  const meta = overview.series_meta ?? {};
  const asOf = (key: string): string | undefined => {
    const spec = IND[key];
    const dates = [spec.a, spec.b].flatMap((id) => (id && meta[id]?.as_of ? [meta[id].as_of as string] : []));
    return dates.length === (spec.b ? 2 : 1) ? dates.sort()[0] : undefined;
  };
  const SOURCE_LABEL: Record<string, string> = { TradingEconomics: "Trading Economics (indicative)" };
  const source = (key: string): string => {
    if (IND[key].b) return "Calculated";
    const raw = meta[IND[key].a]?.source;
    return raw ? SOURCE_LABEL[raw] ?? raw : "—";
  };
  const flows = overview.flows;
  const sourcesSummary = overview.sources_health;
  const dash = (v: number | undefined | null, f: (n: number) => string) => (v === undefined || v === null ? "—" : f(v));

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
              <tr {...rowProps("USD / INR Reference Rate")}>
                <td className="font-medium flex items-center">
                  <span>USD / INR Reference Rate</span>
                  <InfoTip metric="inr_usd_fx" meta={data?.meta?.inr_usd_fx ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(fxRates["FX:USDINR"], (n) => `₹${n.toFixed(4)}`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                  —
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("usdinr"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("usdinr")}</td>
              </tr>
              <tr {...rowProps("India 10Y Benchmark G-Sec")}>
                <td className="font-medium flex items-center">
                  <span>India 10Y Benchmark G-Sec</span>
                  <InfoTip metric="in_10y_yield" meta={data?.meta?.in_10y_yield ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(overview.yields?.in_10y, (n) => `${n.toFixed(2)}%`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("in10"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("in10")}</td>
              </tr>
              <tr {...rowProps("India 2Y Sovereign Bond")}>
                <td className="font-medium flex items-center">
                  <span>India 2Y Sovereign Bond</span>
                  <InfoTip metric="in_10y_yield" meta={data?.meta?.in_10y_yield ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(overview.yields?.in_2y, (n) => `${n.toFixed(2)}%`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("in2"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("in2")}</td>
              </tr>
              <tr {...rowProps("India 10Y - 2Y Curve Slope")}>
                <td className="font-medium flex items-center">
                  <span>India 10Y - 2Y Curve Slope</span>
                  <InfoTip metric="us_yield_curve_slope" meta={data?.meta?.us_yield_curve_slope ?? data?.meta?._default} />
                </td>
                <td className="text-right">
                  <SignedValue value={spreads.india_10y_2y_bps} unit="bps" />
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("inSlope"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("inSlope")}</td>
              </tr>
              <tr {...rowProps("India - US 10Y Sovereign Spread")}>
                <td className="font-medium flex items-center">
                  <span>India - US 10Y Sovereign Spread</span>
                  <InfoTip metric="yield_spread_in_us" meta={data?.meta?.yield_spread_in_us ?? data?.meta?._default} />
                </td>
                <td className="text-right">
                  <SignedValue value={spreads.india_us_10y_bps} unit="bps" />
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("inUs"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("inUs")}</td>
              </tr>
              <tr {...rowProps("India VIX (NSE Volatility Index)")}>
                <td className="font-medium flex items-center">
                  <span>India VIX (NSE Volatility Index)</span>
                  <InfoTip metric="india_vix" meta={data?.meta?.india_vix ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(volData["VOL:IN:INDIAVIX"], (n) => n.toFixed(2))}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("inVix"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("inVix")}</td>
              </tr>

              {/* Section 2: Global & Macro Benchmarks */}
              <tr className="bg-[#F7F9FB] dark:bg-[#171E27] border-y border-[#E4E9EF] dark:border-[#2B3644]">
                <td colSpan={5} className="py-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  Global & Macro Benchmarks
                </td>
              </tr>
              <tr {...rowProps("US 10Y Treasury Benchmark")}>
                <td className="font-medium flex items-center">
                  <span>US 10Y Treasury Benchmark</span>
                  <InfoTip metric="us_10y_yield" meta={data?.meta?.us_10y_yield ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(overview.yields?.us_10y, (n) => `${n.toFixed(2)}%`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("us10"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("us10")}</td>
              </tr>
              <tr {...rowProps("US 2Y Treasury Yield")}>
                <td className="font-medium flex items-center">
                  <span>US 2Y Treasury Yield</span>
                  <InfoTip metric="us_2y_yield" meta={data?.meta?.us_2y_yield ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(overview.yields?.us_2y, (n) => `${n.toFixed(2)}%`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("us2"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("us2")}</td>
              </tr>
              <tr {...rowProps("US 10Y - 2Y Curve Slope")}>
                <td className="font-medium flex items-center">
                  <span>US 10Y - 2Y Curve Slope</span>
                  <InfoTip metric="us_yield_curve_slope" meta={data?.meta?.us_yield_curve_slope ?? data?.meta?._default} />
                </td>
                <td className="text-right">
                  <SignedValue value={spreads.us_10y_2y_bps} unit="bps" />
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("usSlope"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("usSlope")}</td>
              </tr>
              <tr {...rowProps("EUR / INR Reference Rate")}>
                <td className="font-medium flex items-center">
                  <span>EUR / INR Reference Rate</span>
                  <InfoTip metric="fx_rate" meta={data?.meta?.fx_rate ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(fxRates["FX:EURINR"], (n) => `₹${n.toFixed(4)}`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("eurinr"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("eurinr")}</td>
              </tr>
              <tr {...rowProps("GBP / INR Reference Rate")}>
                <td className="font-medium flex items-center">
                  <span>GBP / INR Reference Rate</span>
                  <InfoTip metric="fx_rate" meta={data?.meta?.fx_rate ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(fxRates["FX:GBPINR"], (n) => `₹${n.toFixed(4)}`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("gbpinr"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("gbpinr")}</td>
              </tr>
              <tr {...rowProps("JPY / INR Reference Rate (100 JPY)")}>
                <td className="font-medium flex items-center">
                  <span>JPY / INR Reference Rate (100 JPY)</span>
                  <InfoTip metric="fx_rate" meta={data?.meta?.fx_rate ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(fxRates["FX:JPYINR"], (n) => `₹${n.toFixed(4)}`)}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("jpyinr"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("jpyinr")}</td>
              </tr>
              <tr {...rowProps("Cboe US VIX")}>
                <td className="font-medium flex items-center">
                  <span>Cboe US VIX</span>
                  <InfoTip metric="vix" meta={data?.meta?.vix ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                  {dash(volData["VOL:US:VIX"], (n) => n.toFixed(2))}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(asOf("usVix"))}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{source("usVix")}</td>
              </tr>

              {/* Section 3: Institutional Flows & Telemetry */}
              <tr className="bg-[#F7F9FB] dark:bg-[#171E27] border-y border-[#E4E9EF] dark:border-[#2B3644]">
                <td colSpan={5} className="py-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  Institutional Flows & System Telemetry
                </td>
              </tr>
              <tr {...rowProps("FII Net Equity Investment (Cr)")}>
                <td className="font-medium flex items-center">
                  <span>FII Net Equity Investment (Cr)</span>
                  <InfoTip metric="fii_net_flow" meta={data?.meta?.fii_net_flow ?? data?.meta?._default} />
                </td>
                <td className="text-right">
                  <SignedValue value={flows?.fii_net} unit="₹ Cr" />
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(flows?.latest_date)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">NSE</td>
              </tr>
              <tr {...rowProps("DII Net Equity Investment (Cr)")}>
                <td className="font-medium flex items-center">
                  <span>DII Net Equity Investment (Cr)</span>
                  <InfoTip metric="dii_net_flow" meta={data?.meta?.dii_net_flow ?? data?.meta?._default} />
                </td>
                <td className="text-right">
                  <SignedValue value={flows?.dii_net} unit="₹ Cr" />
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(flows?.latest_date)}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">NSE</td>
              </tr>
              <tr {...rowProps("Upstream Feed Operational Health")}>
                <td className="font-medium flex items-center">
                  <span>Upstream Feed Operational Health</span>
                  <InfoTip metric="source_health" meta={data?.meta?.source_health ?? data?.meta?._default} />
                </td>
                <td className="text-right font-medium text-[#087744] dark:text-[#58D6A0]">
                  {sourcesSummary ? `${sourcesSummary.ready} / ${sourcesSummary.total} Ready` : "—"}
                </td>
                <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                  {sourcesSummary ? (sourcesSummary.status === "healthy" ? "Healthy" : "Degraded") : "—"}
                </td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formattedObservationDate}</td>
                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <Link href="/backoffice/data-health" className="hover:underline">Data Health →</Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <IndicatorDrawer spec={indicator} onClose={() => setIndicator(null)} />
    </div>
  );
}
