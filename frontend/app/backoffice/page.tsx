"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getBackofficeOverview, getDeterministicBriefing, MarketOverviewData, DeterministicBriefingData, BackofficeEnvelope } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

export default function BackofficeOverviewPage() {
  const [data, setData] = useState<BackofficeEnvelope<MarketOverviewData> | null>(null);
  const [briefing, setBriefing] = useState<BackofficeEnvelope<DeterministicBriefingData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [overviewRes, briefingRes] = await Promise.all([
          getBackofficeOverview(),
          getDeterministicBriefing(),
        ]);
        setData(overviewRes);
        setBriefing(briefingRes);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load market overview");
      } finally {
        setLoading(false);
      }
    }
    load();
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

  const overview = data.data;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Market Overview & System Telemetry</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Internal multi-asset research board • Cached memory snapshot (&lt;50ms response)
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
            ₹{overview.fx_reference_rates["FX:USDINR"] ? overview.fx_reference_rates["FX:USDINR"].toFixed(4) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={overview.fx_reference_rates["FX:USDINR"] ? "ready" : "unavailable"}
              freshness="current"
              asOf={overview.fx_as_of}
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
            {overview.yield_spreads.india_us_10y_bps !== undefined
              ? `${overview.yield_spreads.india_us_10y_bps > 0 ? "+" : ""}${overview.yield_spreads.india_us_10y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={overview.yield_spreads.india_us_10y_bps !== undefined ? "ready" : "unavailable"}
              freshness="current"
              sourceName="FBIL / FRED"
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
            {overview.volatility["VOL:US:VIX"] ? overview.volatility["VOL:US:VIX"].toFixed(2) : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={overview.volatility["VOL:US:VIX"] ? "ready" : "unavailable"}
              freshness="current"
              asOf={overview.vol_as_of}
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
            {overview.yield_spreads.us_10y_2y_bps !== undefined
              ? `${overview.yield_spreads.us_10y_2y_bps > 0 ? "+" : ""}${overview.yield_spreads.us_10y_2y_bps.toFixed(1)} bps`
              : "—"}
          </div>
          <div className="mt-3">
            <StatusBadge
              availability={overview.yield_spreads.us_10y_2y_bps !== undefined ? "ready" : "unavailable"}
              freshness="current"
              sourceName="FRED"
              units="bps"
            />
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
            {briefing.data.bullets.slice(0, 4).map((bullet, idx) => (
              <li key={idx} className="text-xs text-sand-800 flex items-start gap-2.5">
                <span className="text-forest-600 font-bold mt-0.5">•</span>
                <span className="leading-relaxed">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
                    {overview.fx_reference_rates["FX:USDINR"] ? overview.fx_reference_rates["FX:USDINR"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">INR per USD</td>
                  <td className="py-2.5 px-3 text-sand-500">Derived Cross (INR/EUR ÷ USD/EUR)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">EUR/USD</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {overview.fx_reference_rates["FX:EURUSD"] ? overview.fx_reference_rates["FX:EURUSD"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">USD per EUR</td>
                  <td className="py-2.5 px-3 text-sand-500">ECB Direct Reference</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">GBP/USD</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {overview.fx_reference_rates["FX:GBPUSD"] ? overview.fx_reference_rates["FX:GBPUSD"].toFixed(4) : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-sand-500">USD per GBP</td>
                  <td className="py-2.5 px-3 text-sand-500">Derived Cross (USD/EUR ÷ GBP/EUR)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-semibold text-sand-900">USD/JPY</td>
                  <td className="py-2.5 px-3 text-sand-900 font-bold">
                    {overview.fx_reference_rates["FX:USDJPY"] ? overview.fx_reference_rates["FX:USDJPY"].toFixed(4) : "—"}
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
              <div className="text-xl font-bold text-emerald-800 font-mono">{overview.sources_summary.ready}</div>
              <div className="text-[10px] text-emerald-600 font-semibold uppercase mt-0.5">Ready</div>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-xl font-bold text-amber-800 font-mono">{overview.sources_summary.needs_key}</div>
              <div className="text-[10px] text-amber-600 font-semibold uppercase mt-0.5">Needs Key</div>
            </div>
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
              <div className="text-xl font-bold text-blue-800 font-mono">{overview.sources_summary.manual_only}</div>
              <div className="text-[10px] text-blue-600 font-semibold uppercase mt-0.5">Manual Only</div>
            </div>
            <div className="p-3 rounded-xl bg-sand-100 border border-sand-200">
              <div className="text-xl font-bold text-sand-700 font-mono">{overview.sources_summary.total}</div>
              <div className="text-[10px] text-sand-500 font-semibold uppercase mt-0.5">Total Registered</div>
            </div>
          </div>
          <div className="text-xs text-sand-600 space-y-1 bg-sand-50 p-3 rounded-xl border border-sand-200">
            <div className="flex justify-between">
              <span>Broad Dollar Proxy (FRED DTWEXBGS):</span>
              <span className="font-mono font-semibold">
                {overview.macro_proxy["MACRO:US:BROAD_USD"] ? overview.macro_proxy["MACRO:US:BROAD_USD"].toFixed(2) : "Requires FRED key"}
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
