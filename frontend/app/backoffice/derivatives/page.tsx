"use client";

import React, { useState } from "react";
import Link from "next/link";
import { getDerivatives, DerivativesData, BackofficeEnvelope } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";
import { usePolling } from "@/components/backoffice/usePolling";

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

  usePolling(async (silent) => {
    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      setData(await getDerivatives(selectedIndex));
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load derivatives data");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedIndex], 30_000);

  const currentIndexMeta = INDICES.find((i) => i.id === selectedIndex);

  // Merge CE/PE legs per strike and show a window of strikes around the money (full chains run to hundreds of rows).
  const strikeRows = (() => {
    const contracts = data?.data.contracts ?? [];
    const byStrike = new Map<number, { strike: number; ce?: (typeof contracts)[number]; pe?: (typeof contracts)[number] }>();
    for (const c of contracts) {
      const row = byStrike.get(c.strike_price) ?? { strike: c.strike_price };
      if (c.option_type === "CE") row.ce = c;
      else row.pe = c;
      byStrike.set(c.strike_price, row);
    }
    const sorted = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
    const spot = data?.data.underlying_price;
    if (!sorted.length || spot === undefined) return sorted.map((r) => ({ ...r, isAtm: false }));
    let atmIdx = 0;
    sorted.forEach((r, idx) => {
      if (Math.abs(r.strike - spot) < Math.abs(sorted[atmIdx].strike - spot)) atmIdx = idx;
    });
    const window = sorted.slice(Math.max(0, atmIdx - 15), atmIdx + 16);
    return window.map((r) => ({ ...r, isAtm: r.strike === sorted[atmIdx].strike }));
  })();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Indian Index Derivatives & Put-Call Ratio (PCR)</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Live NSE option chains (auto-refresh 30s) • Open Interest, Volume, Implied Volatility, PCR & Max Pain
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

      {data?.data.live_status === "stale" && data.data.notice && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800">
          <span className="font-semibold">Showing last stored snapshot.</span> Live NSE refresh failed: {data.data.notice}
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
                  31 strikes around the money • Open Interest, Volume & Implied Volatility
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  availability={data.availability}
                  freshness={data.freshness}
                  sourceName="NSE option chain"
                  sourceUrl="https://www.nseindia.com/option-chain"
                />
              </div>
            </div>

            {data.data.contracts.length === 0 ? (
              <div className="py-12 text-center text-sand-500 text-xs bg-sand-50 rounded-xl border border-dashed border-sand-300">
                <div className="font-semibold text-sand-700 mb-1">Option chain unavailable</div>
                <p className="max-w-md mx-auto mb-4">
                  {data.data.notice ||
                    "No option chain could be fetched from NSE right now. It will appear automatically once the feed responds."}
                </p>
                <Link
                  href="/backoffice/data-health"
                  className="inline-flex items-center px-3.5 py-1.5 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 transition-colors"
                >
                  Check source health / manual import →
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
                    {strikeRows.map((row) => (
                      <tr key={row.strike} className={`hover:bg-sand-50 ${row.isAtm ? "bg-amber-50/60" : ""}`}>
                        <td className="py-2 px-3 text-sand-800 font-medium">{row.ce ? row.ce.oi.toLocaleString("en-IN") : "—"}</td>
                        <td className="py-2 px-3 text-sand-600">{row.ce ? row.ce.volume.toLocaleString("en-IN") : "—"}</td>
                        <td className="py-2 px-3 text-sand-500 border-r border-sand-200">{row.ce?.implied_volatility ? `${row.ce.implied_volatility}%` : "—"}</td>
                        <td className="py-2 px-4 font-bold text-sand-950 bg-sand-50/80">
                          {row.strike.toLocaleString("en-IN")}
                          {row.isAtm && <span className="ml-1.5 text-[9px] font-semibold text-amber-700">ATM</span>}
                        </td>
                        <td className="py-2 px-3 text-sand-500 border-l border-sand-200">{row.pe?.implied_volatility ? `${row.pe.implied_volatility}%` : "—"}</td>
                        <td className="py-2 px-3 text-sand-600">{row.pe ? row.pe.volume.toLocaleString("en-IN") : "—"}</td>
                        <td className="py-2 px-3 text-sand-800 font-medium">{row.pe ? row.pe.oi.toLocaleString("en-IN") : "—"}</td>
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
