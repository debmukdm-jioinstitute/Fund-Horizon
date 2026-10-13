"use client";

import React, { useState } from "react";
import { getFlows, FlowsData, BackofficeEnvelope } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";
import { usePolling } from "@/components/backoffice/usePolling";

export default function FlowsPage() {
  const [data, setData] = useState<BackofficeEnvelope<FlowsData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePolling(async (silent) => {
    try {
      if (!silent) setLoading(true);
      setData(await getFlows());
      setError(null);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load institutional flows");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [], 120_000);

  if (loading) {
    return (
      <div className="p-8 text-center text-sand-500 font-mono text-xs flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-forest-700" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading institutional FII / DII flows…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
        <div className="font-semibold mb-1">Failed to load flows data</div>
        {error}
      </div>
    );
  }

  const flows = data.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">FII / FPI & DII Institutional Flows</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Cash market gross buy, sell & net flows • Provisional vs final status tracking in ₹ Crore
          </p>
        </div>
        <StatusBadge
          availability={data.availability}
          freshness={data.freshness}
          frequency="daily"
          asOf={flows.as_of}
          units="₹ Crore"
        />
      </div>

      {/* Summary Highlight Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* FII Net */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>FII / FPI Net Flow</span>
            <span className="font-mono text-xs bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">Latest Session</span>
          </div>
          <div className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
            flows.fii_net_crore !== undefined && flows.fii_net_crore >= 0 ? "text-emerald-700" : "text-rose-700"
          }`}>
            {flows.fii_net_crore !== undefined
              ? `${flows.fii_net_crore >= 0 ? "+" : ""}${flows.fii_net_crore.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`
              : "—"}
          </div>
          <div className="mt-2 text-xs text-sand-500">
            Foreign portfolio investment in cash market
          </div>
        </div>

        {/* DII Net */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>DII Net Flow</span>
            <span className="font-mono text-xs bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">Latest Session</span>
          </div>
          <div className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
            flows.dii_net_crore !== undefined && flows.dii_net_crore >= 0 ? "text-emerald-700" : "text-rose-700"
          }`}>
            {flows.dii_net_crore !== undefined
              ? `${flows.dii_net_crore >= 0 ? "+" : ""}${flows.dii_net_crore.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`
              : "—"}
          </div>
          <div className="mt-2 text-xs text-sand-500">
            Domestic institutional investment (MFs, Insurance, Banks)
          </div>
        </div>

        {/* Combined 7D Cumulative */}
        <div className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-sand-500 font-medium">
            <span>7-Day Net Institutional Flow</span>
            <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Rolling Window</span>
          </div>
          <div className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
            flows.cumulative_7d_net_crore !== undefined && flows.cumulative_7d_net_crore >= 0 ? "text-emerald-700" : "text-rose-700"
          }`}>
            {flows.cumulative_7d_net_crore !== undefined
              ? `${flows.cumulative_7d_net_crore >= 0 ? "+" : ""}${flows.cumulative_7d_net_crore.toLocaleString("en-IN", { maximumFractionDigits: 1 })} Cr`
              : "—"}
          </div>
          <div className="mt-2 text-xs text-sand-500">
            Cumulative sum of consistent daily sessions
          </div>
        </div>
      </div>

      {/* Historical Flows Ledger */}
      <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-sand-950">Daily Institutional Activity Ledger</h2>
            <p className="text-xs text-sand-500">Reported cash-market activity • Missing days are not zero flows</p>
          </div>
          <StatusBadge
            availability="ready"
            freshness="current"
            frequency="daily"
            sourceName="NSE FII/DII Reports"
            sourceUrl="https://www.nseindia.com/reports/fii-dii"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
              <tr>
                <th className="py-2.5 px-3 font-medium">Report Date</th>
                <th className="py-2.5 px-3 font-medium">Category</th>
                <th className="py-2.5 px-3 font-medium">Segment</th>
                <th className="py-2.5 px-3 font-medium">Gross Buy (₹ Cr)</th>
                <th className="py-2.5 px-3 font-medium">Gross Sell (₹ Cr)</th>
                <th className="py-2.5 px-3 font-medium">Net Flow (₹ Cr)</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
              {flows.daily && flows.daily.length > 0 ? (
                flows.daily.map((row, idx) => {
                  const buyCr = row.buy_crore !== undefined ? row.buy_crore.toFixed(1) : "—";
                  const sellCr = row.sell_crore !== undefined ? row.sell_crore.toFixed(1) : "—";
                  const netCr = row.net_crore;
                  return (
                    <tr key={idx} className="hover:bg-sand-50/60">
                      <td className="py-2.5 px-3 font-semibold text-sand-900">{row.report_date}</td>
                      <td className="py-2.5 px-3 text-sand-800 font-sans">{row.category}</td>
                      <td className="py-2.5 px-3 text-sand-600 text-xs">{row.segment}</td>
                      <td className="py-2.5 px-3 text-sand-700">{buyCr}</td>
                      <td className="py-2.5 px-3 text-sand-700">{sellCr}</td>
                      <td className={`py-2.5 px-3 font-bold ${netCr >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {netCr >= 0 ? "+" : ""}{netCr.toFixed(1)} Cr
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          row.provisional
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}>
                          {row.provisional ? "Provisional" : "Final"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sand-500 font-sans">
                    No FII / DII session fetched from NSE yet. This table fills automatically.
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
