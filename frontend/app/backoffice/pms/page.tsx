"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  getPmsStrategies,
  getPmsAccountTracker,
  PmsStrategyItem,
  PmsAccountTrackerData,
  PmsPositionItem,
} from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

export default function PmsTrackerPage() {
  const [tab, setTab] = useState<"strategies" | "accounts">("strategies");
  const [strategies, setStrategies] = useState<PmsStrategyItem[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [accountTracker, setAccountTracker] = useState<PmsAccountTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Strategy filters
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await getPmsStrategies();
        setStrategies(res.data || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load PMS data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleLoadAccount(accId: string) {
    if (!accId.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const res = await getPmsAccountTracker(accId.trim());
      setAccountTracker(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load account tracker");
      setAccountTracker(null);
    } finally {
      setLoading(false);
    }
  }

  const filteredStrategies = strategies.filter((s) => {
    const matchesCat = categoryFilter === "all" || s.investment_approach?.toLowerCase().includes(categoryFilter.toLowerCase());
    const matchesSearch = !search || s.strategy_name?.toLowerCase().includes(search.toLowerCase()) || s.provider_name?.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Portfolio Management Services (PMS) Tracker</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Strategy research & scoped client account cashflows, XIRR, Modified Dietz & HWM estimation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab("strategies")}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
              tab === "strategies"
                ? "bg-forest-700 text-white shadow-xs"
                : "bg-white text-sand-700 border border-sand-300 hover:bg-sand-50"
            }`}
          >
            Strategy Research ({strategies.length})
          </button>
          <button
            onClick={() => setTab("accounts")}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
              tab === "accounts"
                ? "bg-forest-700 text-white shadow-xs"
                : "bg-white text-sand-700 border border-sand-300 hover:bg-sand-50"
            }`}
          >
            Client Account Tracker
          </button>
        </div>
      </div>

      {tab === "strategies" ? (
        /* STRATEGY RESEARCH VIEW */
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-sand-200">
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PMS provider or strategy…"
                className="w-full max-w-sm px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                <option value="all">All Categories</option>
                <option value="equity">Equity</option>
                <option value="multi-asset">Multi-Asset</option>
                <option value="debt">Debt</option>
              </select>
            </div>
            <StatusBadge
              availability="manual_only"
              freshness="current"
              frequency="monthly"
              sourceName="APMI / Manager Disclosures"
              sourceUrl="https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu"
            />
          </div>

          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-sand-50 text-sand-600 font-mono border-b border-sand-200">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Provider / Strategy</th>
                    <th className="py-2.5 px-3 font-medium">Approach</th>
                    <th className="py-2.5 px-3 font-medium">AUM (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">1M</th>
                    <th className="py-2.5 px-3 font-medium">1Y</th>
                    <th className="py-2.5 px-3 font-medium">3Y CAGR</th>
                    <th className="py-2.5 px-3 font-medium">Benchmark</th>
                    <th className="py-2.5 px-3 font-medium">Report Month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-sand-500 font-sans">
                        Loading PMS strategies…
                      </td>
                    </tr>
                  ) : filteredStrategies.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-sand-500 font-sans">
                        No PMS strategies found. Import strategy disclosure files via{" "}
                        <Link href="/backoffice/data-health" className="text-forest-700 underline font-medium">
                          Data Health Imports
                        </Link>.
                      </td>
                    </tr>
                  ) : (
                    filteredStrategies.map((s, idx) => (
                      <tr key={idx} className="hover:bg-sand-50/60">
                        <td className="py-3 px-4 font-sans">
                          <div className="font-semibold text-sand-900">{s.strategy_name}</div>
                          <div className="text-[11px] text-sand-500">{s.provider_name}</div>
                        </td>
                        <td className="py-3 px-3 text-sand-700 font-sans">{s.investment_approach || "Equity"}</td>
                        <td className="py-3 px-3 font-semibold text-sand-900">
                          {s.aum_crore ? `₹${s.aum_crore.toLocaleString()}` : "—"}
                        </td>
                        <td className={`py-3 px-3 ${s.return_1m_pct !== undefined && s.return_1m_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {s.return_1m_pct !== undefined ? `${s.return_1m_pct > 0 ? "+" : ""}${s.return_1m_pct}%` : "—"}
                        </td>
                        <td className={`py-3 px-3 ${s.return_1y_pct !== undefined && s.return_1y_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {s.return_1y_pct !== undefined ? `${s.return_1y_pct > 0 ? "+" : ""}${s.return_1y_pct}%` : "—"}
                        </td>
                        <td className={`py-3 px-3 font-semibold ${s.return_3y_cagr_pct !== undefined && s.return_3y_cagr_pct >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                          {s.return_3y_cagr_pct !== undefined ? `${s.return_3y_cagr_pct > 0 ? "+" : ""}${s.return_3y_cagr_pct}%` : "—"}
                        </td>
                        <td className="py-3 px-3 text-sand-600 font-sans text-[11px]">{s.benchmark_name || "NIFTY 50 TRI"}</td>
                        <td className="py-3 px-3 text-sand-500 text-[11px]">{s.report_month || "2026-09"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* CLIENT ACCOUNT TRACKER VIEW */
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-sand-200 shadow-2xs">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="text"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                placeholder="Enter client PMS Account ID (e.g. acc_pms_01)"
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-mono"
              />
              <button
                onClick={() => handleLoadAccount(selectedAccountId)}
                className="px-4 py-2 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 transition-colors shadow-xs"
              >
                Track Client Account
              </button>
            </div>
            <p className="text-[11px] text-sand-500 mt-2 font-sans">
              Role-based security: RMs can only inspect assigned clients. Operations and Analysts are scoped according to backoffice permissions.
            </p>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
              {error}
            </div>
          )}

          {accountTracker && (
            <div className="space-y-6">
              {/* Account Overview Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
                  <div className="text-xs text-sand-500 font-medium">Latest Account Valuation</div>
                  <div className="mt-1 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                    ₹{accountTracker.current_valuation_paise ? (accountTracker.current_valuation_paise / 100).toLocaleString("en-IN") : "—"}
                  </div>
                  <div className="mt-2 text-[11px] text-sand-500">
                    Latest dated portfolio valuation (not invested principal)
                  </div>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
                  <div className="text-xs text-sand-500 font-medium">Annualized XIRR</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {accountTracker.xirr?.xirr_pct !== null && accountTracker.xirr?.xirr_pct !== undefined
                      ? `${accountTracker.xirr.xirr_pct > 0 ? "+" : ""}${accountTracker.xirr.xirr_pct.toFixed(2)}%`
                      : "Diagnostic"}
                  </div>
                  <div className="mt-2 text-[11px] text-sand-500">
                    {accountTracker.xirr?.status || "Cashflow dates & terminal value"}
                  </div>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
                  <div className="text-xs text-sand-500 font-medium">Modified Dietz Return</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {accountTracker.modified_dietz?.return_pct !== null && accountTracker.modified_dietz?.return_pct !== undefined
                      ? `${accountTracker.modified_dietz.return_pct > 0 ? "+" : ""}${accountTracker.modified_dietz.return_pct.toFixed(2)}%`
                      : "—"}
                  </div>
                  <div className="mt-2 text-[11px] text-sand-500">
                    Flow-weighted timing estimate
                  </div>
                </div>

                <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
                  <div className="text-xs text-sand-500 font-medium">Estimated Performance Fee (HWM)</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-sand-900">
                    ₹{accountTracker.hwm_fee?.estimated_fee_paise ? (accountTracker.hwm_fee.estimated_fee_paise / 100).toLocaleString("en-IN") : "0"}
                  </div>
                  <div className="mt-2 text-[11px] text-sand-500">
                    {accountTracker.hwm_fee?.hwm_exceeded ? "HWM exceeded • Labeled estimate" : "Below High-Water Mark"}
                  </div>
                </div>
              </div>

              {/* Positions Table */}
              <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-semibold text-sand-900">Current Portfolio Holdings</h2>
                    <p className="text-[11px] text-sand-500">
                      Coverage: {accountTracker.holdings_coverage?.total_coverage_pct || 100}% of holdings priced
                    </p>
                  </div>
                  <span className="text-xs font-mono bg-sand-100 text-sand-700 px-2.5 py-1 rounded-full">
                    {accountTracker.positions?.length || 0} Positions
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                      <tr>
                        <th className="py-2 px-3 font-medium">Asset / Security</th>
                        <th className="py-2 px-3 font-medium">Asset Class</th>
                        <th className="py-2 px-3 font-medium">Quantity</th>
                        <th className="py-2 px-3 font-medium">Market Value (₹)</th>
                        <th className="py-2 px-3 font-medium">Weight</th>
                        <th className="py-2 px-3 font-medium">Valuation Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                      {accountTracker.positions && accountTracker.positions.length > 0 ? (
                        accountTracker.positions.map((pos: PmsPositionItem, idx: number) => (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-sans font-semibold text-sand-900">{pos.asset_name || pos.symbol}</td>
                            <td className="py-2.5 px-3 text-sand-600 font-sans">{pos.asset_class || "Equity"}</td>
                            <td className="py-2.5 px-3 text-sand-700">{pos.quantity ? pos.quantity.toLocaleString() : "—"}</td>
                            <td className="py-2.5 px-3 font-semibold text-sand-900">
                              ₹{(pos.market_value_paise / 100).toLocaleString("en-IN")}
                            </td>
                            <td className="py-2.5 px-3 text-sand-600">
                              {accountTracker.current_valuation_paise
                                ? `${((pos.market_value_paise / accountTracker.current_valuation_paise) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-sand-500">{pos.valuation_date}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-sand-500 font-sans">
                            No position rows recorded. Import client portfolio statements via Data Health.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
