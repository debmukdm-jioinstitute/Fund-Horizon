"use client";

import React, { useMemo, useState } from "react";
import {
  getPmsStrategies,
  getPmsProviders,
  getPmsAccountTracker,
  PmsStrategyItem,
  PmsProviderItem,
  PmsAccountTrackerData,
  PmsPositionItem,
} from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";
import { usePolling } from "@/components/backoffice/usePolling";

type Tab = "providers" | "strategies" | "accounts";
type SortKey = "aum_crore" | "return_1m_pct" | "return_3m_pct" | "return_6m_pct" | "return_1y_pct" | "return_3y_cagr_pct" | "return_5y_cagr_pct" | "return_since_inception_pct";

const PAGE = 100;
const fmtAum = (v?: number) => (v !== undefined && v > 0 ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—");

function Pct({ v, bold = false }: { v?: number; bold?: boolean }) {
  if (v === undefined) return <span className="text-sand-400">—</span>;
  return <span className={`${v >= 0 ? "text-emerald-700" : "text-rose-700"} ${bold ? "font-semibold" : ""}`}>{`${v > 0 ? "+" : ""}${v.toFixed(2)}%`}</span>;
}

export default function PmsTrackerPage() {
  const [tab, setTab] = useState<Tab>("providers");
  const [strategies, setStrategies] = useState<PmsStrategyItem[]>([]);
  const [providers, setProviders] = useState<PmsProviderItem[]>([]);
  const [asOn, setAsOn] = useState<string | undefined>();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [accountTracker, setAccountTracker] = useState<PmsAccountTrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [reportingOnly, setReportingOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("aum_crore");
  const [visible, setVisible] = useState(PAGE);

  usePolling(async (silent) => {
    try {
      if (!silent) setLoading(true);
      const [s, p] = await Promise.all([getPmsStrategies(), getPmsProviders()]);
      setStrategies(s.data);
      setProviders(p.data);
      setAsOn(p.as_of ?? s.as_of);
      setError(null);
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : "Failed to load PMS data");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [], 6 * 60 * 60_000);

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

  const q = search.trim().toLowerCase();
  const filteredProviders = useMemo(
    () => providers.filter((p) => (!reportingOnly || p.strategy_count > 0) && (!q || p.name.toLowerCase().includes(q))),
    [providers, q, reportingOnly]
  );
  const filteredStrategies = useMemo(() => {
    const rows = strategies.filter(
      (s) =>
        (typeFilter === "all" || s.strategy_type === typeFilter) &&
        (serviceFilter === "all" || s.service_type === serviceFilter) &&
        (!q || s.strategy_name.toLowerCase().includes(q) || s.provider_name.toLowerCase().includes(q))
    );
    return [...rows].sort((a, b) => (b[sortKey] ?? -Infinity) - (a[sortKey] ?? -Infinity));
  }, [strategies, q, typeFilter, serviceFilter, sortKey]);

  const reportingProviders = providers.filter((p) => p.strategy_count > 0).length;
  const switchTab = (t: Tab) => {
    setTab(t);
    setVisible(PAGE);
    setSearch("");
  };
  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => switchTab(t)}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
        tab === t ? "bg-forest-700 text-white shadow-xs" : "bg-white text-sand-700 border border-sand-300 hover:bg-sand-50"
      }`}
    >
      {label}
    </button>
  );
  const th = (label: string, key?: SortKey) => (
    <th
      className={`py-2.5 px-3 font-medium whitespace-nowrap ${key ? "cursor-pointer hover:text-sand-900 select-none" : ""}`}
      onClick={key ? () => setSortKey(key) : undefined}
      title={key ? "Sort high to low" : undefined}
    >
      {label}
      {key && sortKey === key ? " ▼" : ""}
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Portfolio Management Services (PMS) Universe</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Every SEBI-registered portfolio manager and strategy reported to APMI{asOn ? ` • performance as on ${asOn}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tabBtn("providers", `Providers (${providers.length})`)}
          {tabBtn("strategies", `Strategies (${strategies.length})`)}
          {tabBtn("accounts", "Client Account Tracker")}
        </div>
      </div>

      {tab !== "accounts" && (
        <div className="space-y-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-sand-200">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setVisible(PAGE);
                }}
                placeholder={tab === "providers" ? "Search PMS provider…" : "Search provider or strategy…"}
                className="w-full max-w-sm px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              />
              {tab === "providers" ? (
                <label className="flex items-center gap-1.5 text-xs text-sand-700">
                  <input type="checkbox" checked={reportingOnly} onChange={(e) => setReportingOnly(e.target.checked)} />
                  Reporting strategies only ({reportingProviders})
                </label>
              ) : (
                <>
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600"
                  >
                    <option value="all">All types</option>
                    <option value="Equity">Equity</option>
                    <option value="Debt">Debt</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Multi Asset">Multi Asset</option>
                  </select>
                  <select
                    value={serviceFilter}
                    onChange={(e) => setServiceFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600"
                  >
                    <option value="all">Discretionary + Non-discretionary</option>
                    <option value="Discretionary">Discretionary</option>
                    <option value="Non-Discretionary">Non-discretionary</option>
                  </select>
                </>
              )}
              <span className="text-xs text-sand-500 font-mono">
                {tab === "providers" ? filteredProviders.length : filteredStrategies.length} shown
              </span>
            </div>
            <StatusBadge
              availability={providers.length ? "ready" : "unavailable"}
              freshness="current"
              frequency="monthly"
              asOf={asOn}
              sourceName="APMI"
              sourceUrl="https://www.apmiindia.org/apmi/welcomeiaperformance.htm?action=PMSmenu"
            />
          </div>

          {error && <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">{error}</div>}

          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              {tab === "providers" ? (
                <table className="w-full text-left text-xs">
                  <thead className="bg-sand-50 text-sand-600 font-mono border-b border-sand-200">
                    <tr>
                      {th("#")}
                      {th("PMS Provider")}
                      {th("Strategies")}
                      {th("Total AUM (₹ Cr)")}
                      {th("Strategy types")}
                      {th("Status")}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                    {loading ? (
                      <tr><td colSpan={6} className="py-8 text-center text-sand-500 font-sans">Loading PMS universe…</td></tr>
                    ) : filteredProviders.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-sand-500 font-sans">No providers match. The APMI list loads automatically within a few minutes of deploy.</td></tr>
                    ) : (
                      filteredProviders.slice(0, visible).map((p, idx) => (
                        <tr key={p.apmi_id} className="hover:bg-sand-50/60">
                          <td className="py-2.5 px-3 text-sand-400">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-sans font-semibold text-sand-900">{p.name}</td>
                          <td className="py-2.5 px-3 text-sand-800">{p.strategy_count}</td>
                          <td className="py-2.5 px-3 text-sand-900">{fmtAum(p.total_aum_crore)}</td>
                          <td className="py-2.5 px-3 font-sans text-[11px] text-sand-600">{p.strategy_types.join(", ") || "—"}</td>
                          <td className="py-2.5 px-3 font-sans">
                            {p.strategy_count > 0 ? (
                              <button
                                onClick={() => {
                                  setSearch(p.name);
                                  setTab("strategies");
                                  setVisible(PAGE);
                                }}
                                className="text-forest-700 underline text-[11px] font-medium"
                              >
                                View strategies →
                              </button>
                            ) : (
                              <span className="text-[11px] text-sand-500">No strategies reported for {asOn ?? "this month"}</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-sand-50 text-sand-600 font-mono border-b border-sand-200">
                    <tr>
                      {th("Provider / Strategy")}
                      {th("Type")}
                      {th("AUM (₹ Cr)", "aum_crore")}
                      {th("1M", "return_1m_pct")}
                      {th("3M", "return_3m_pct")}
                      {th("6M", "return_6m_pct")}
                      {th("1Y", "return_1y_pct")}
                      {th("3Y", "return_3y_cagr_pct")}
                      {th("5Y", "return_5y_cagr_pct")}
                      {th("Since inception", "return_since_inception_pct")}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                    {loading ? (
                      <tr><td colSpan={10} className="py-8 text-center text-sand-500 font-sans">Loading PMS strategies…</td></tr>
                    ) : filteredStrategies.length === 0 ? (
                      <tr><td colSpan={10} className="py-8 text-center text-sand-500 font-sans">No strategies match the filters.</td></tr>
                    ) : (
                      filteredStrategies.slice(0, visible).map((s, idx) => (
                        <tr key={`${s.provider_name}-${s.strategy_name}-${s.service_type}-${idx}`} className="hover:bg-sand-50/60">
                          <td className="py-2.5 px-3 font-sans max-w-xs">
                            {s.ia_id ? (
                              <a
                                href={`https://www.apmiindia.org/apmi/IaInsight.htm?IAID=${encodeURIComponent(s.ia_id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-sand-900 hover:text-forest-800 underline-offset-2 hover:underline"
                              >
                                {s.strategy_name}
                              </a>
                            ) : (
                              <span className="font-semibold text-sand-900">{s.strategy_name}</span>
                            )}
                            <div className="text-[11px] text-sand-500">{s.provider_name}</div>
                          </td>
                          <td className="py-2.5 px-3 font-sans text-[11px] text-sand-700">
                            {s.strategy_type || "—"}
                            <div className="text-sand-400">{s.service_type === "Non-Discretionary" ? "Non-disc." : s.service_type === "Discretionary" ? "Disc." : s.service_type}</div>
                          </td>
                          <td className="py-2.5 px-3 text-sand-900 font-semibold">{fmtAum(s.aum_crore)}</td>
                          <td className="py-2.5 px-3"><Pct v={s.return_1m_pct} /></td>
                          <td className="py-2.5 px-3"><Pct v={s.return_3m_pct} /></td>
                          <td className="py-2.5 px-3"><Pct v={s.return_6m_pct} /></td>
                          <td className="py-2.5 px-3"><Pct v={s.return_1y_pct} bold /></td>
                          <td className="py-2.5 px-3"><Pct v={s.return_3y_cagr_pct} bold /></td>
                          <td className="py-2.5 px-3"><Pct v={s.return_5y_cagr_pct} /></td>
                          <td className="py-2.5 px-3"><Pct v={s.return_since_inception_pct} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
            {(tab === "providers" ? filteredProviders.length : filteredStrategies.length) > visible && (
              <div className="p-3 text-center border-t border-sand-100">
                <button onClick={() => setVisible(visible + PAGE)} className="px-4 py-1.5 text-xs font-medium text-forest-800 bg-forest-50 border border-forest-200 rounded-xl hover:bg-forest-100">
                  Show {PAGE} more
                </button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-sand-500">
            Returns are as reported by each provider to APMI (returns over 1 year are annualised). Past performance does not indicate future results.
          </p>
        </div>
      )}

      {tab === "accounts" && (
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
                      Coverage: {accountTracker.holdings_coverage?.total_coverage_pct ?? "—"}% of holdings priced
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
                            <td className="py-2.5 px-3 text-sand-600 font-sans">{pos.asset_class || "—"}</td>
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
