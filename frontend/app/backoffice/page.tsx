"use client";

import React, { useState } from "react";
import Link from "next/link";
import { getBackofficeOverview, getDeterministicBriefing, MarketOverviewData, DeterministicBriefingData, BackofficeEnvelope } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";
import { NewsFeed } from "@/components/backoffice/NewsFeed";
import { usePolling } from "@/components/backoffice/usePolling";

export default function BackofficeOverviewPage() {
  const [data, setData] = useState<BackofficeEnvelope<MarketOverviewData> | null>(null);
  const [briefing, setBriefing] = useState<BackofficeEnvelope<DeterministicBriefingData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePolling(async (silent) => {
    try {
      if (!silent) setLoading(true);
      const [overviewRes, briefingRes] = await Promise.all([getBackofficeOverview(), getDeterministicBriefing()]);
      setData(overviewRes);
      setBriefing(briefingRes);
      setError(null);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load market overview");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-center text-sand-500 font-mono text-xs flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-forest-700" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading shared market overview…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
        <div className="font-semibold mb-1">Failed to load overview</div>
        {error}
      </div>
    );
  }

  const overview = data.data || {};

  // Resilient accessors supporting both flat and nested backend models
  const fxRates: Record<string, number> =
    overview.fx_reference_rates || overview.fx?.rates || {};
  const fxAsOf: string | undefined =
    overview.fx_as_of || overview.fx?.as_of;

  const vol = (overview.volatility ?? {}) as {
    vix?: number | null;
    india_vix?: number | null;
    vix_as_of?: string | null;
    india_vix_as_of?: string | null;
    as_of?: string;
  };
  const volData: Record<string, number> = {};
  if (typeof vol.vix === "number") volData["VOL:US:VIX"] = vol.vix;
  const indiaVix = typeof vol.india_vix === "number" ? vol.india_vix : undefined;
  const volAsOf: string | undefined = vol.vix_as_of ?? vol.as_of;

  const spreads = overview.yield_spreads || {
    india_us_10y_bps: overview.yields?.india_us_spread_bps,
    us_10y_2y_bps: overview.yields?.us_slope_bps,
    india_10y_2y_bps: overview.yields?.india_slope_bps,
  };

  const sourcesSummary = overview.sources_summary ?? {
    total: overview.sources_health?.total ?? 0,
    ready: overview.sources_health?.ready ?? 0,
    degraded: 0,
    needs_key: 0,
    manual_only: 0,
  };

  const nifty = overview.indices?.["INDEX:IN:NIFTY50"];
  const niftyBank = overview.indices?.["INDEX:IN:NIFTYBANK"];
  const sensex = overview.indices?.["INDEX:IN:SENSEX"];
  const fiiNet = overview.flows?.fii_net;
  const diiNet = overview.flows?.dii_net;
  const signedCr = (v: number | null | undefined) =>
    typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr` : "—";

  const macroProxy: Record<string, number> = overview.macro_proxy || {};

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Market Overview & System Telemetry</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Live multi-asset board • auto-refreshes every 60s from NSE, US Treasury, ECB & Cboe
          </p>
        </div>
        <StatusBadge
          availability={data.availability}
          freshness={data.freshness}
          frequency="daily"
          asOf={overview.generated_at}
          units="Multi-Asset"
        />
      </div>

      {/* Quick Summary Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* USD/INR */}
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>USD / INR</span>
            <span className="font-mono text-[10px] bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">ECB Ref</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {fxRates["FX:USDINR"] ? `₹${fxRates["FX:USDINR"].toFixed(4)}` : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={fxRates["FX:USDINR"] ? "ready" : "unavailable"}
              freshness="current"
              asOf={fxAsOf}
              sourceName="ECB"
              sourceUrl="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
            />
          </div>
        </div>

        {/* India - US 10Y Spread */}
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>IN - US 10Y Spread</span>
            <span className="font-mono text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Sovereign</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {spreads?.india_us_10y_bps !== undefined && spreads?.india_us_10y_bps !== null
              ? `${spreads.india_us_10y_bps > 0 ? "+" : ""}${spreads.india_us_10y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={spreads?.india_us_10y_bps !== undefined && spreads?.india_us_10y_bps !== null ? "ready" : "unavailable"}
              freshness="current"
              sourceName="US Treasury + India G-Sec (scraped)"
              units="bps"
            />
          </div>
        </div>

        {/* Cboe VIX */}
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>US VIX (Cboe)</span>
            <span className="font-mono text-[10px] bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">Implied Vol</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {volData["VOL:US:VIX"] ? volData["VOL:US:VIX"].toFixed(2) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={volData["VOL:US:VIX"] ? "ready" : "unavailable"}
              freshness="current"
              asOf={volAsOf}
              sourceName="Cboe"
              sourceUrl="https://www.cboe.com/tradable-products/vix/vix-historical-data"
            />
          </div>
        </div>

        {/* US 10Y - 2Y Curve Slope */}
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs hover:shadow-xs transition-shadow">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>US 10Y - 2Y Curve Slope</span>
            <span className="font-mono text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">Slope</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {spreads?.us_10y_2y_bps !== undefined && spreads?.us_10y_2y_bps !== null
              ? `${spreads.us_10y_2y_bps > 0 ? "+" : ""}${spreads.us_10y_2y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={spreads?.us_10y_2y_bps !== undefined && spreads?.us_10y_2y_bps !== null ? "ready" : "unavailable"}
              freshness="current"
              sourceName="US Treasury"
              units="bps"
            />
          </div>
        </div>
      </div>

      {/* Live Indian market tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="text-xs text-sand-500 font-medium">NIFTY 50</div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {typeof nifty === "number" ? nifty.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge availability={typeof nifty === "number" ? "ready" : "unavailable"} freshness="current" asOf={overview.indices?.as_of ?? undefined} sourceName="NSE" />
          </div>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="text-xs text-sand-500 font-medium">NIFTY Bank</div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {typeof niftyBank === "number" ? niftyBank.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge availability={typeof niftyBank === "number" ? "ready" : "unavailable"} freshness="current" asOf={overview.indices?.as_of ?? undefined} sourceName="NSE" />
          </div>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="text-xs text-sand-500 font-medium">BSE SENSEX</div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {typeof sensex === "number" ? sensex.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge availability={typeof sensex === "number" ? "ready" : "unavailable"} freshness="current" sourceName="Trading Economics (scraped)" />
          </div>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="text-xs text-sand-500 font-medium">India VIX</div>
          <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
            {indiaVix !== undefined ? indiaVix.toFixed(2) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge availability={indiaVix !== undefined ? "ready" : "unavailable"} freshness="current" asOf={vol.india_vix_as_of ?? undefined} sourceName="NSE" />
          </div>
        </div>
        <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="text-xs text-sand-500 font-medium">FII / DII Net (latest session)</div>
          <div className="mt-2 text-lg font-bold font-mono tabular-nums">
            <span className={typeof fiiNet === "number" && fiiNet < 0 ? "text-rose-700" : "text-emerald-700"}>FII {signedCr(fiiNet)}</span>
            <br />
            <span className={typeof diiNet === "number" && diiNet < 0 ? "text-rose-700" : "text-emerald-700"}>DII {signedCr(diiNet)}</span>
          </div>
          <div className="mt-3">
            <StatusBadge availability={typeof fiiNet === "number" ? "ready" : "unavailable"} freshness="current" asOf={overview.flows?.latest_date ?? undefined} sourceName="NSE" />
          </div>
        </div>
      </div>

      {/* Deterministic Daily Briefing Card */}
      {briefing && briefing.data && (
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-sand-100">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-sand-900">{briefing.data.title}</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                  Zero Paid AI
                </span>
              </div>
              <div className="text-[11px] text-sand-500 mt-0.5 font-mono">{briefing.data.method_version}</div>
            </div>
            <Link
              href="/backoffice/research"
              className="text-xs font-medium text-forest-700 hover:text-forest-900 flex items-center gap-1 self-start sm:self-auto"
            >
              Full Briefing & Notes →
            </Link>
          </div>
          <ul className="mt-4 space-y-2.5">
            {briefing.data.bullets?.slice(0, 4).map((bullet, idx) => (
              <li key={idx} className="text-xs text-sand-800 flex items-start gap-2.5">
                <span className="text-forest-600 font-bold mt-0.5">•</span>
                <span className="leading-relaxed">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Latest headlines */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-sand-900">Latest Headlines</h2>
          <Link href="/backoffice/research" className="text-xs font-medium text-forest-700 hover:text-forest-900">
            All headlines →
          </Link>
        </div>
        <NewsFeed limit={6} compact showFilters={false} />
      </div>

      {/* FX Cross Rates & Volatility Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Currency Pairs Board */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-sand-900">Currency Reference Rates</h2>
              <p className="text-[11px] text-sand-500">ECB official reference rates (daily fixing, not live executable quotes)</p>
            </div>
            <StatusBadge
              availability="ready"
              freshness="current"
              frequency="daily"
              sourceName="ECB XML"
              sourceUrl="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                <tr>
                  <th className="py-2 px-3 font-medium">Pair</th>
                  <th className="py-2 px-3 font-medium">Rate</th>
                  <th className="py-2 px-3 font-medium">Unit</th>
                  <th className="py-2 px-3 font-medium">Convention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">USD/INR</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {fxRates["FX:USDINR"] ? fxRates["FX:USDINR"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">INR per USD</td>
                  <td className="py-2.5 px-3 text-sand-500">Derived Cross (INR/EUR ÷ USD/EUR)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">EUR/USD</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {fxRates["FX:EURUSD"] ? fxRates["FX:EURUSD"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">USD per EUR</td>
                  <td className="py-2.5 px-3 text-sand-500">ECB Direct Reference</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">GBP/USD</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {fxRates["FX:GBPUSD"] ? fxRates["FX:GBPUSD"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">USD per GBP</td>
                  <td className="py-2.5 px-3 text-sand-500">Derived Cross (USD/EUR ÷ GBP/EUR)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">USD/JPY</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {fxRates["FX:USDJPY"] ? fxRates["FX:USDJPY"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">JPY per USD</td>
                  <td className="py-2.5 px-3 text-sand-500">Derived Cross (JPY/EUR ÷ USD/EUR)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Source Health & Quota Telemetry */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-sand-900">Source Health & Quotas</h2>
              <p className="text-[11px] text-sand-500">Registered primary adapters and availability state</p>
            </div>
            <Link
              href="/backoffice/data-health"
              className="text-xs font-medium text-forest-700 hover:text-forest-900"
            >
              Manage Sources →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-xl font-bold text-emerald-800 font-mono">{sourcesSummary.ready}</div>
              <div className="text-[10px] text-emerald-600 font-semibold uppercase mt-0.5">Ready</div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-xl font-bold text-amber-800 font-mono">{sourcesSummary.needs_key}</div>
              <div className="text-[10px] text-amber-600 font-semibold uppercase mt-0.5">Needs Key</div>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
              <div className="text-xl font-bold text-blue-800 font-mono">{sourcesSummary.manual_only}</div>
              <div className="text-[10px] text-blue-600 font-semibold uppercase mt-0.5">Manual Only</div>
            </div>
            <div className="p-3 rounded-xl bg-sand-100 border border-sand-200">
              <div className="text-xl font-bold text-sand-700 font-mono">{sourcesSummary.total}</div>
              <div className="text-[10px] text-sand-500 font-semibold uppercase mt-0.5">Total Registered</div>
            </div>
          </div>
          <div className="text-xs text-sand-600 space-y-1 bg-sand-50 p-3 rounded-xl border border-sand-200">
            <div className="flex justify-between">
              <span>Broad Dollar Proxy (FRED DTWEXBGS):</span>
              <span className="font-mono font-semibold">
                {macroProxy["MACRO:US:BROAD_USD"] ? macroProxy["MACRO:US:BROAD_USD"].toFixed(2) : "Needs FRED_API_KEY"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Licensed DXY:</span>
              <span className="font-mono text-sand-500 italic">Not licensed (No ₹0 live feed)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

