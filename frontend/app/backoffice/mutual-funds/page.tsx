"use client";

import React, { useEffect, useState } from "react";
import { getMutualFundsTracker, MutualFundItem } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

export default function MutualFundsTrackerPage() {
  const [query, setQuery] = useState("");
  const [schemes, setSchemes] = useState<MutualFundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function search(q?: string) {
      try {
        setLoading(true);
        setError(null);
        const res = await getMutualFundsTracker(q);
        setSchemes(res.data || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load mutual funds tracker");
      } finally {
        setLoading(false);
      }
    }
    search(query);
  }, [query]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Mutual Fund Tracker & AMFI NAV Hub</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Official AMFI daily NAV feeds (8-column normalized parser), Direct/Regular plan distinctions & history reconciliation
          </p>
        </div>
        <StatusBadge
          availability="ready"
          freshness="current"
          frequency="daily"
          sourceName="AMFI Portal"
          sourceUrl="https://portal.amfiindia.com/spages/NAVAll.txt"
          units="NAV ₹"
        />
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-sand-200 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by scheme code, fund name, AMC, or ISIN (e.g. 119551, HDFC, Parag Parikh)…"
            className="w-full max-w-lg px-3.5 py-2 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
          />
        </div>
        <div className="text-xs text-sand-500 font-mono">
          Showing {schemes.length} schemes
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Schemes Table */}
      <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-sand-50 text-sand-600 font-mono border-b border-sand-200">
              <tr>
                <th className="py-2.5 px-4 font-medium">Scheme Code</th>
                <th className="py-2.5 px-4 font-medium">Scheme Name & Category</th>
                <th className="py-2.5 px-3 font-medium">Plan Type</th>
                <th className="py-2.5 px-3 font-medium">Latest NAV</th>
                <th className="py-2.5 px-3 font-medium">NAV Date</th>
                <th className="py-2.5 px-3 font-medium">TER (%)</th>
                <th className="py-2.5 px-3 font-medium">ISIN Growth / Div</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sand-500 font-sans">
                    Loading scheme universe…
                  </td>
                </tr>
              ) : schemes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sand-500 font-sans">
                    No matching schemes found. All 8 AMFI columns are normalized from NAVAll.txt.
                  </td>
                </tr>
              ) : (
                schemes.map((s, idx) => (
                  <tr key={idx} className="hover:bg-sand-50/60">
                    <td className="py-3 px-4 font-bold text-forest-800">{s.scheme_code}</td>
                    <td className="py-3 px-4 font-sans max-w-md">
                      <div className="font-semibold text-sand-900 leading-snug">{s.scheme_name}</div>
                      <div className="text-[11px] text-sand-500">{s.amc_name || s.category || "Equity"}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        s.plan?.toLowerCase() === "direct"
                          ? "bg-purple-50 text-purple-700 border border-purple-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}>
                        {s.plan || "Regular"}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-bold text-sand-950">
                      ₹{s.latest_nav ? Number(s.latest_nav).toFixed(4) : "—"}
                    </td>
                    <td className="py-3 px-3 text-sand-600 text-[11px]">{s.nav_date || "—"}</td>
                    <td className="py-3 px-3 text-sand-700">{s.ter_pct ? `${s.ter_pct}%` : "—"}</td>
                    <td className="py-3 px-3 text-[11px] text-sand-500 font-mono">
                      {s.isin_growth || s.isin_div || "—"}
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                        Active
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
