"use client";

import React, { useEffect, useState } from "react";
import {
  getPmsStrategies,
  getPmsAccountTracker,
  PmsStrategyItem,
  PmsAccountTrackerData,
  FH_RECOMMENDED_BENCHMARK,
} from "@/lib/backoffice";
import { formatCurrencyPaiseToINR } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";
import PmsStrategyDrawer from "@/components/backoffice/PmsStrategyDrawer";
import PmsManagerDrawer from "@/components/backoffice/PmsManagerDrawer";

export default function PmsTrackerPage() {
  const [tab, setTab] = useState<"strategies" | "accounts">("strategies");
  const [strategies, setStrategies] = useState<PmsStrategyItem[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<PmsStrategyItem | null>(null);
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [accountTracker, setAccountTracker] = useState<PmsAccountTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Strategy filters & search
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fhSubTab, setFhSubTab] = useState<"returns" | "details">("returns");
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

  const isRecommended = categoryFilter === "fh-recommended";
  const fhRecCount = strategies.filter((s) => s.is_fh_recommended).length || 11;

  const filteredStrategies = strategies.filter((s) => {
    if (isRecommended) {
      if (!s.is_fh_recommended) return false;
    } else if (categoryFilter !== "all") {
      const matchesCat = s.investment_approach?.toLowerCase().includes(categoryFilter.toLowerCase());
      if (!matchesCat) return false;
    }
    const matchesSearch =
      !search ||
      s.strategy_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.provider_name?.toLowerCase().includes(search.toLowerCase()) ||
      (s.principal_officer && s.principal_officer.toLowerCase().includes(search.toLowerCase()));
    return matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              PMS Performance & Account Tracker
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              APMI Standard
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Portfolio Management Services strategy registry, XIRR returns, and high-water mark fee auditing
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <button
            onClick={() => setTab("strategies")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "strategies"
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            Strategy Research ({strategies.length})
          </button>
          <button
            onClick={() => setTab("accounts")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "accounts"
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            Client Accounts
          </button>
        </div>
      </div>

      {tab === "strategies" ? (
        /* STRATEGY RESEARCH VIEW */
        <div className="space-y-3">
          {/* Filter Toolbar */}
          <div className="terminal-panel p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PMS provider, strategy or manager…"
                className="terminal-input w-full max-w-xs text-[12px] py-1 px-2.5"
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="terminal-input text-[12px] py-1 px-2.5 font-medium"
              >
                <option value="all">All Approaches</option>
                <option value="fh-recommended">★ FH Recommended ({fhRecCount})</option>
                <option value="equity">Equity</option>
                <option value="multi-asset">Multi-Asset</option>
                <option value="debt">Debt</option>
              </select>

              {/* Quick filter toggle for FH Recommended */}
              <button
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === "fh-recommended" ? "all" : "fh-recommended")}
                className={`terminal-btn text-[12px] py-1 px-3 flex items-center gap-1.5 font-medium transition cursor-pointer ${
                  categoryFilter === "fh-recommended"
                    ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE]"
                    : "bg-[#F7F9FB] dark:bg-[#171E27] text-[#006F64] dark:text-[#75E1CE] border-[#006F64]/40 hover:border-[#006F64]"
                }`}
              >
                <span className="text-[12px]">★</span>
                <span>FH Recommended ({fhRecCount})</span>
              </button>
            </div>
            <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono shrink-0">
              Source: <a href="https://www.apmiindia.org" target="_blank" rel="noreferrer" className="underline hover:text-[#172033] dark:hover:text-[#EDF2F7]">APMI Disclosures</a>
            </div>
          </div>

          {/* Sub-view toggle when FH Recommended is active */}
          {isRecommended && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1 bg-[#F0F3F6] dark:bg-[#202936] p-0.5 rounded border border-[#E4E9EF] dark:border-[#2B3644]">
                <button
                  type="button"
                  onClick={() => setFhSubTab("returns")}
                  className={`text-[11px] font-medium py-1 px-2.5 rounded transition cursor-pointer ${
                    fhSubTab === "returns"
                      ? "bg-white dark:bg-[#10151C] text-[#172033] dark:text-[#EDF2F7] shadow-sm"
                      : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7]"
                  }`}
                >
                  Returns Comparison vs Benchmark
                </button>
                <button
                  type="button"
                  onClick={() => setFhSubTab("details")}
                  className={`text-[11px] font-medium py-1 px-2.5 rounded transition cursor-pointer ${
                    fhSubTab === "details"
                      ? "bg-white dark:bg-[#10151C] text-[#172033] dark:text-[#EDF2F7] shadow-sm"
                      : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7]"
                  }`}
                >
                  Fund Details &amp; Structure
                </button>
              </div>
              <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
                Click any fund to inspect complete factsheet &amp; history
              </span>
            </div>
          )}

          {/* Strategy Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="terminal-table">
                <thead>
                  {isRecommended ? (
                    fhSubTab === "returns" ? (
                      <tr>
                        <th className="w-[5%] text-center">SR</th>
                        <th className="w-[30%]">PMS</th>
                        <th className="w-[9%] text-right">1M</th>
                        <th className="w-[9%] text-right">3M</th>
                        <th className="w-[9%] text-right">6M</th>
                        <th className="w-[9%] text-right">1Y</th>
                        <th className="w-[9%] text-right">3Y</th>
                        <th className="w-[9%] text-right">5Y</th>
                        <th className="w-[11%] text-right">Since Inception</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="w-[5%] text-center">SR</th>
                        <th className="w-[28%]">PMS</th>
                        <th className="w-[14%]">Type</th>
                        <th className="w-[10%] text-right">AUM</th>
                        <th className="w-[12%] text-right">Min Investment</th>
                        <th className="w-[11%]">Inception</th>
                        <th className="w-[12%]">Principal Officer</th>
                        <th className="w-[8%]">Benchmark</th>
                      </tr>
                    )
                  ) : (
                    <tr>
                      <th className="w-[30%]">Provider / Strategy</th>
                      <th className="w-[14%]">Approach</th>
                      <th className="w-[12%] text-right">AUM (₹ Cr)</th>
                      <th className="w-[10%] text-right">1M Return</th>
                      <th className="w-[10%] text-right">1Y Return</th>
                      <th className="w-[12%] text-right">3Y CAGR</th>
                      <th className="w-[12%]">Benchmark</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={isRecommended ? 9 : 7} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                        Loading PMS strategies…
                      </td>
                    </tr>
                  ) : filteredStrategies.length === 0 ? (
                    <tr>
                      <td colSpan={isRecommended ? 9 : 7} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                        No PMS strategies found matching query.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {filteredStrategies.map((s, idx) => (
                        <tr key={idx}>
                          {isRecommended && (
                            <td className="text-center font-mono text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                              {idx + 1}
                            </td>
                          )}

                          <td>
                            <button
                              type="button"
                              onClick={() => setSelectedStrategy(s)}
                              className="text-left font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline focus:outline-none transition group cursor-pointer block leading-snug"
                            >
                              <span className="group-hover:opacity-90">{s.strategy_name}</span>
                            </button>
                            <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-0.5 flex items-center gap-1.5 flex-wrap">
                              <span>{s.provider_name}</span>
                              {s.is_fh_recommended && !isRecommended && (
                                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#006F64]/10 text-[#006F64] dark:bg-[#75E1CE]/15 dark:text-[#75E1CE] font-medium border border-[#006F64]/20">
                                  ★ FH Rec
                                </span>
                              )}
                            </div>
                          </td>

                          {isRecommended ? (
                            fhSubTab === "returns" ? (
                              <>
                                <td className="text-right">
                                  <SignedValue value={s.return_1m_pct} unit="%" />
                                </td>
                                <td className="text-right">
                                  <SignedValue value={s.return_3m_pct} unit="%" />
                                </td>
                                <td className="text-right">
                                  <SignedValue value={s.return_6m_pct} unit="%" />
                                </td>
                                <td className="text-right">
                                  <SignedValue value={s.return_1y_pct} unit="%" />
                                </td>
                                <td className="text-right">
                                  <SignedValue value={s.return_3y_cagr_pct} unit="%" />
                                </td>
                                <td className="text-right">
                                  <SignedValue value={s.return_5y_cagr_pct} unit="%" />
                                </td>
                                <td className="text-right font-medium">
                                  <SignedValue value={s.return_since_inception_pct} unit="%" />
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="text-[#536176] dark:text-[#A8B4C4]">
                                  {s.investment_approach || s.strategy_type || "Multicap & Flexicap"}
                                </td>
                                <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7] font-mono">
                                  {s.aum_crore ? `₹${s.aum_crore.toLocaleString()} Cr` : "—"}
                                </td>
                                <td className="text-right text-[#536176] dark:text-[#A8B4C4] font-mono">
                                  {s.min_investment || "₹50,00,000"}
                                </td>
                                <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                                  {s.inception_date || "—"}
                                </td>
                                <td className="text-[12px]">
                                  {s.principal_officer ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedManager(s.principal_officer as string)}
                                      className="text-left font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline focus:outline-none transition cursor-pointer"
                                      title="Open manager profile"
                                    >
                                      {s.principal_officer}
                                    </button>
                                  ) : (
                                    <span className="text-[#172033] dark:text-[#EDF2F7]">—</span>
                                  )}
                                </td>
                                <td className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                                  {s.benchmark_name || "S&P BSE 500 TRI"}
                                </td>
                              </>
                            )
                          ) : (
                            <>
                              <td className="text-[#536176] dark:text-[#A8B4C4]">{s.investment_approach || "Equity"}</td>
                              <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                                {s.aum_crore ? `₹${s.aum_crore.toLocaleString()} Cr` : "—"}
                              </td>
                              <td className="text-right">
                                <SignedValue value={s.return_1m_pct} unit="%" />
                              </td>
                              <td className="text-right">
                                <SignedValue value={s.return_1y_pct} unit="%" />
                              </td>
                              <td className="text-right">
                                <SignedValue value={s.return_3y_cagr_pct} unit="%" />
                              </td>
                              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{s.benchmark_name || "NIFTY 50 TRI"}</td>
                            </>
                          )}
                        </tr>
                      ))}

                      {/* Benchmark comparison row when viewing FH Recommended in Returns mode */}
                      {isRecommended && fhSubTab === "returns" && (
                        <tr className="bg-[#FAF3E0] dark:bg-[#2A2315] font-medium border-t-2 border-[#D97706]/60">
                          <td className="text-center font-mono text-[11px] text-[#92400E] dark:text-[#FBBF24]">★</td>
                          <td>
                            <div className="font-semibold text-[#92400E] dark:text-[#FBBF24]">
                              {FH_RECOMMENDED_BENCHMARK.name}
                            </div>
                            <div className="text-[11px] text-[#92400E]/80 dark:text-[#FBBF24]/80">
                              Official Benchmark Index Comparison
                            </div>
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_1m_pct} unit="%" />
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_3m_pct} unit="%" />
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_6m_pct} unit="%" />
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_1y_pct} unit="%" />
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_3y_cagr_pct} unit="%" />
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_5y_cagr_pct} unit="%" />
                          </td>
                          <td className="text-right font-medium">
                            <SignedValue value={FH_RECOMMENDED_BENCHMARK.return_since_inception_pct} unit="%" />
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* CLIENT ACCOUNT TRACKER VIEW */
        <div className="space-y-3">
          {/* Account Selector Toolbar */}
          <div className="terminal-panel p-2.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              placeholder="Enter client PMS Account ID (e.g. acc_pms_01)"
              className="terminal-input flex-1 text-[12px] py-1 px-2.5 font-mono"
            />
            <button
              onClick={() => handleLoadAccount(selectedAccountId)}
              disabled={loading || !selectedAccountId.trim()}
              className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
            >
              {loading ? "Loading…" : "Track Account"}
            </button>
          </div>

          {error && (
            <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px]">
              {error}
            </div>
          )}

          {accountTracker && (
            <div className="space-y-3">
              {/* Account Metrics Flat Table */}
              <div className="terminal-panel overflow-hidden">
                <table className="terminal-table">
                  <thead>
                    <tr>
                      <th>Account Metric</th>
                      <th className="text-right">Valuation / Return</th>
                      <th className="text-right">Benchmark / HWM</th>
                      <th>Methodology</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">Portfolio Current Valuation</td>
                      <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {accountTracker.current_valuation_paise
                          ? formatCurrencyPaiseToINR(accountTracker.current_valuation_paise)
                          : "—"}
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                        Fee: {accountTracker.hwm_fee?.estimated_fee_paise ? formatCurrencyPaiseToINR(accountTracker.hwm_fee.estimated_fee_paise) : "₹0"}
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Latest Closing Valuation</td>
                      <td className="text-[12px] text-[#087744] dark:text-[#58D6A0]">Audited</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Annualized XIRR Return</td>
                      <td className="text-right">
                        <SignedValue value={accountTracker.xirr?.xirr_pct} unit="%" />
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                        Status: {accountTracker.xirr?.status || "Computed"}
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">SEBI Cashflow IRR Standard</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Audited</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Modified Dietz Return (CY)</td>
                      <td className="text-right">
                        <SignedValue value={accountTracker.modified_dietz?.return_pct} unit="%" />
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">—</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Time-Weighted Cashflows</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Daily-weighted</td>
                    </tr>
                    <tr>
                      <td className="font-medium">High Water Mark (HWM) Status</td>
                      <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {accountTracker.hwm_fee?.hwm_exceeded ? "Above HWM (Fee Triggered)" : "Below HWM (No Performance Fee)"}
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                        {accountTracker.hwm_fee?.estimated_fee_paise
                          ? `Est. Fee: ${formatCurrencyPaiseToINR(accountTracker.hwm_fee.estimated_fee_paise)}`
                          : "No Fee Due"}
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">SEBI Performance Fee Rule</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Compliant</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Positions List */}
              {accountTracker.positions && accountTracker.positions.length > 0 && (
                <div className="terminal-panel overflow-hidden">
                  <div className="p-2 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
                    Portfolio Holdings & Weight Breakdown
                  </div>
                  <div className="overflow-x-auto">
                    <table className="terminal-table">
                      <thead>
                        <tr>
                          <th>Asset Name</th>
                          <th>Symbol / Class</th>
                          <th className="text-right">Quantity</th>
                          <th className="text-right">Market Value</th>
                          <th className="text-right">Valuation Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountTracker.positions.map((pos, pIdx) => (
                          <tr key={pIdx}>
                            <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{pos.asset_name || pos.symbol || "Asset"}</td>
                            <td className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">{pos.symbol || pos.asset_class || "—"}</td>
                            <td className="text-right font-mono">{pos.quantity !== undefined ? pos.quantity.toLocaleString() : "—"}</td>
                            <td className="text-right font-medium font-mono">
                              {formatCurrencyPaiseToINR(pos.market_value_paise)}
                            </td>
                            <td className="text-right text-[12px] text-[#536176] dark:text-[#A8B4C4] font-mono">{pos.valuation_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Slide-over Inspection Drawer for PMS Strategy */}
      <PmsStrategyDrawer
        strategy={selectedStrategy}
        onClose={() => setSelectedStrategy(null)}
      />

      {/* Slide-over Manager Profile Drawer */}
      <PmsManagerDrawer
        managerName={selectedManager}
        strategies={strategies}
        onClose={() => setSelectedManager(null)}
        onSelectStrategy={(st) => {
          setSelectedManager(null);
          setSelectedStrategy(st);
        }}
      />
    </div>
  );
}
