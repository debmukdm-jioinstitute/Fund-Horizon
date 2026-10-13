"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getDerivatives, DerivativesData, BackofficeEnvelope } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

const INDICES = [
  { id: "NIFTY", name: "NIFTY 50", type: "index_fno" },
  { id: "BANKNIFTY", name: "NIFTY Bank", type: "index_fno" },
  { id: "FINNIFTY", name: "NIFTY Financial Services", type: "index_fno" },
  { id: "MIDCPNIFTY", name: "NIFTY Midcap Select", type: "index_fno" },
  { id: "SENSEX", name: "BSE SENSEX", type: "index_fno" },
  { id: "NIFTYNXT50", name: "NIFTY Next 50", type: "cash_only" },
];

export default function DerivativesPage() {
  const [selectedIndex, setSelectedIndex] = useState("NIFTY");
  const [data, setData] = useState<BackofficeEnvelope<DerivativesData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await getDerivatives(selectedIndex);
        setData(res);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load derivatives data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedIndex]);

  const currentIndexMeta = INDICES.find((i) => i.id === selectedIndex);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Indian Index Derivatives & Put-Call Ratio (PCR)</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            NSE / BSE derivative reports, Option Chain snapshots, Open Interest (OI), Volume & Max Pain analytics
          </p>
        </div>
        {data && (
          <StatusBadge
            availability={data.availability}
            freshness={data.freshness}
            frequency="daily"
            asOf={data.as_of}
            units="Contracts / Lots"
          />
        )}
      </div>

      {/* Index Selector Tabs */}
      <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-2xl border border-sand-200 shadow-2xs">
        {INDICES.map((idx) => {
          const isSelected = selectedIndex === idx.id;
          return (
            <button
              key={idx.id}
              onClick={() => setSelectedIndex(idx.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                isSelected
                  ? "bg-forest-700 text-white shadow-xs"
                  : "bg-sand-50 text-sand-700 hover:bg-sand-100 border border-sand-200"
              }`}
            >
              <span>{idx.name}</span>
              {idx.type === "cash_only" && (
                <span className="ml-1.5 text-[10px] opacity-75 font-mono">(Cash Only)</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Cash-Only Notice */}
      {currentIndexMeta?.type === "cash_only" && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800">
          <div className="font-semibold mb-0.5">Cash Index Level: Derivatives N/A</div>
          Cash index levels have no intrinsic traded volume or open interest. Traded volume is available strictly for listed derivative contracts or ETF constituent proxies.
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sand-500 font-mono text-xs flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-forest-700" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading option chain snapshot…
        </div>
      ) : error || !data ? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
          <div className="font-semibold mb-1">Error fetching derivatives</div>
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key Analytics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* PCR (Open Interest) */}
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
                <span>PCR (Open Interest)</span>
                <span className="font-mono text-[10px] bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">Σ Put / Σ Call</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {data.data.pcr_oi !== null && data.data.pcr_oi !== undefined ? data.data.pcr_oi.toFixed(2) : "—"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500">
                {data.data.pcr_oi_reason || `Call OI: ${data.data.total_call_oi.toLocaleString()} • Put OI: ${data.data.total_put_oi.toLocaleString()}`}
              </div>
            </div>

            {/* PCR (Traded Volume) */}
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
                <span>PCR (Volume)</span>
                <span className="font-mono text-[10px] bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">Volume Ratio</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {data.data.pcr_volume !== null && data.data.pcr_volume !== undefined ? data.data.pcr_volume.toFixed(2) : "—"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500">
                Put Volume ÷ Call Volume on matching contracts
              </div>
            </div>

            {/* Max Pain Strike */}
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
                <span>Max Pain Strike</span>
                <span className="font-mono text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">Descriptive</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {data.data.max_pain_strike ? data.data.max_pain_strike.toLocaleString() : "—"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500">
                Minimum aggregate option buyer payoff
              </div>
            </div>

            {/* Underlying Spot / Future Price */}
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
                <span>Underlying Reference Price</span>
                <span className="font-mono text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">Index Pts</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {data.data.underlying_price ? data.data.underlying_price.toLocaleString() : "—"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500">
                Expiry: {data.data.expiry_date || "Nearest listed"}
              </div>
            </div>
          </div>

          {/* Option Chain Contracts Table */}
          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-sand-900">Option Chain Contracts Matrix</h2>
                <p className="text-[11px] text-sand-500">
                  Call & Put strike layout with Open Interest, Volume & Implied Volatility
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  availability={data.availability}
                  freshness="current"
                  sourceName="NSE Official Reports"
                  sourceUrl="https://www.nseindia.com/all-reports-derivatives"
                />
              </div>
            </div>

            {data.data.contracts.length === 0 ? (
              <div className="py-12 text-center text-sand-500 text-xs bg-sand-50 rounded-xl border border-dashed border-sand-300">
                <div className="font-semibold text-sand-700 mb-1">Manual Import / Permitted Source Required</div>
                <p className="max-w-md mx-auto mb-4">
                  Free exchange-grade live intraday option chains are not available with zero spend without scraping. Upload verified EOD bhavcopy / derivative reports via Data Health.
                </p>
                <Link
                  href="/backoffice/data-health"
                  className="inline-flex items-center px-3.5 py-1.5 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 transition-colors"
                >
                  Go to Manual Import Hub →
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-center text-xs">
                  <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                    <tr>
                      <th colSpan={3} className="py-2 px-3 border-r border-sand-200 bg-emerald-50/50 text-emerald-800 font-semibold">
                        CALLS (CE)
                      </th>
                      <th className="py-2 px-4 font-bold text-sand-900 bg-sand-100">STRIKE</th>
                      <th colSpan={3} className="py-2 px-3 border-l border-sand-200 bg-rose-50/50 text-rose-800 font-semibold">
                        PUTS (PE)
                      </th>
                    </tr>
                    <tr className="border-t border-sand-200 text-[11px]">
                      <th className="py-1.5 px-3">OI</th>
                      <th className="py-1.5 px-3">Volume</th>
                      <th className="py-1.5 px-3 border-r border-sand-200">IV (%)</th>
                      <th className="py-1.5 px-4 font-semibold text-sand-800 bg-sand-100">Strike Price</th>
                      <th className="py-1.5 px-3 border-l border-sand-200">IV (%)</th>
                      <th className="py-1.5 px-3">Volume</th>
                      <th className="py-1.5 px-3">OI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                    {/* Render contracts grouped by strike */}
                    {data.data.contracts.map((c, idx) => (
                      <tr key={idx} className="hover:bg-sand-50">
                        <td className="py-2 px-3 text-sand-800 font-medium">{c.option_type === "CE" ? c.oi.toLocaleString() : "—"}</td>
                        <td className="py-2 px-3 text-sand-600">{c.option_type === "CE" ? c.volume.toLocaleString() : "—"}</td>
                        <td className="py-2 px-3 text-sand-500 border-r border-sand-200">{c.option_type === "CE" && c.implied_volatility ? `${c.implied_volatility}%` : "—"}</td>
                        <td className="py-2 px-4 font-bold text-sand-950 bg-sand-50/80">{c.strike_price.toLocaleString()}</td>
                        <td className="py-2 px-3 text-sand-500 border-l border-sand-200">{c.option_type === "PE" && c.implied_volatility ? `${c.implied_volatility}%` : "—"}</td>
                        <td className="py-2 px-3 text-sand-600">{c.option_type === "PE" ? c.volume.toLocaleString() : "—"}</td>
                        <td className="py-2 px-3 text-sand-800 font-medium">{c.option_type === "PE" ? c.oi.toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
