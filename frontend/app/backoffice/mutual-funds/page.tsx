"use client";

import React, { useEffect, useState } from "react";
import { getMutualFundsTracker, MutualFundItem } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import MutualFundDrawer from "@/components/backoffice/MutualFundDrawer";

export default function MutualFundsTrackerPage() {
  const [query, setQuery] = useState("");
  const [schemes, setSchemes] = useState<MutualFundItem[]>([]);
  const [selectedScheme, setSelectedScheme] = useState<MutualFundItem | null>(null);
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Mutual Fund Tracker & AMFI NAV Hub
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              AMFI NAVAll.txt Feed
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Normalized 8-column AMFI master scheme registry, direct vs regular plan distinctions, and NAV valuations
          </p>
        </div>

        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
          Feed: <a href="https://portal.amfiindia.com/spages/NAVAll.txt" target="_blank" rel="noreferrer" className="underline hover:text-[#172033] dark:hover:text-[#EDF2F7]">portal.amfiindia.com</a>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="terminal-panel p-2.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by scheme code, fund name, AMC, or ISIN (e.g. 119551, HDFC, Parag Parikh)…"
            className="terminal-input w-full max-w-md text-[12px] py-1 px-2.5"
          />
        </div>
        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono shrink-0">
          {loading ? "Searching…" : `${schemes.length} schemes loaded`}
        </div>
      </div>

      {error && (
        <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px]">
          {error}
        </div>
      )}

      {/* Schemes Flat Table */}
      <div className="terminal-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th className="w-[10%]">Code</th>
                <th className="w-[32%]">Scheme Name & Category</th>
                <th className="w-[10%]">Plan Type</th>
                <th className="w-[12%] text-right">Latest NAV (₹)</th>
                <th className="w-[12%]">NAV Date</th>
                <th className="w-[10%] text-right">TER (%)</th>
                <th className="w-[14%]">ISIN (Growth)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                    Loading scheme universe from AMFI registry…
                  </td>
                </tr>
              ) : schemes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                    No schemes found matching &quot;{query}&quot;.
                  </td>
                </tr>
              ) : (
                schemes.map((s, idx) => (
                  <tr key={idx}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedScheme(s)}
                        className="font-mono text-[12px] text-[#006F64] dark:text-[#75E1CE] font-medium hover:underline cursor-pointer"
                        title={`Inspect scheme ${s.scheme_code}`}
                      >
                        {s.scheme_code}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedScheme(s)}
                        className="text-left font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline focus:outline-none transition group cursor-pointer block leading-snug"
                      >
                        <span className="group-hover:opacity-90">{s.scheme_name}</span>
                      </button>
                      <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
                        {s.amc_name || s.category || "Equity"}
                      </div>
                    </td>
                    <td>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
                        {s.plan || "Regular"}
                      </span>
                    </td>
                    <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {s.latest_nav ? `₹${Number(s.latest_nav).toFixed(4)}` : "—"}
                    </td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                      {formatISTDate(s.nav_date)}
                    </td>
                    <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                      {s.ter_pct ? `${Number(s.ter_pct).toFixed(2)}%` : "—"}
                    </td>
                    <td className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">
                      {s.isin_growth || s.isin_div || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Inspection Drawer for Mutual Fund */}
      <MutualFundDrawer
        scheme={selectedScheme}
        onClose={() => setSelectedScheme(null)}
      />
    </div>
  );
}
