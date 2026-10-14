"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getFlows, FlowsData, BackofficeEnvelope, refreshSource } from "@/lib/backoffice";
import { formatISTDate, formatISTDateTime, formatNumber } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";
import InfoTip from "@/components/InfoTip";

// Item 17: gross buy/sell formatted as ₹ Cr with Indian digit grouping
// (e.g. ₹1,23,456.7 Cr).
function formatGrossCrore(v?: number): string {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return formatNumber(v, 1, { prefix: "₹", suffix: " Cr" });
}

type SortColumn = "report_date" | "category" | "segment" | "buy_crore" | "sell_crore" | "net_crore" | "provisional";
type SortDirection = "asc" | "desc";

function FlowsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromParam = searchParams.get("from") || "";
  const toParam = searchParams.get("to") || "";

  const [data, setData] = useState<BackofficeEnvelope<FlowsData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [fromDate, setFromDate] = useState(fromParam);
  const [toDate, setToDate] = useState(toParam);

  // Sorting
  const [sortCol, setSortCol] = useState<SortColumn>("report_date");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  // Keep local filter inputs synced if URL parameters change externally
  useEffect(() => {
    setFromDate(fromParam);
    setToDate(toParam);
  }, [fromParam, toParam]);

  const loadData = async (start?: string, end?: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await getFlows(start, end);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load institutional flows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(fromParam || undefined, toParam || undefined);
  }, [fromParam, toParam]);

  const handleApplyFilter = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const params = new URLSearchParams();
    if (fromDate.trim()) params.set("from", fromDate.trim());
    if (toDate.trim()) params.set("to", toDate.trim());
    const qs = params.toString();
    router.replace(`/backoffice/flows${qs ? `?${qs}` : ""}`);
  };

  const handleClearFilter = () => {
    setFromDate("");
    setToDate("");
    router.replace("/backoffice/flows");
  };

  const handleRetry = async () => {
    try {
      setRetrying(true);
      setError(null);
      await refreshSource("SRC_NSE_FNO");
      await loadData(fromParam || undefined, toParam || undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Retry refresh failed");
    } finally {
      setRetrying(false);
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortCol === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(column);
      setSortDir("desc");
    }
  };

  const flows = data?.data || { daily: [] };

  const sortedDaily = useMemo(() => {
    const list = [...(flows.daily || [])];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "report_date":
          cmp = a.report_date.localeCompare(b.report_date);
          break;
        case "category":
          cmp = a.category.localeCompare(b.category);
          break;
        case "segment":
          cmp = a.segment.localeCompare(b.segment);
          break;
        case "buy_crore":
          cmp = (a.buy_crore ?? -Infinity) - (b.buy_crore ?? -Infinity);
          break;
        case "sell_crore":
          cmp = (a.sell_crore ?? -Infinity) - (b.sell_crore ?? -Infinity);
          break;
        case "net_crore":
          cmp = (a.net_crore ?? -Infinity) - (b.net_crore ?? -Infinity);
          break;
        case "provisional":
          cmp = (a.provisional ? 1 : 0) - (b.provisional ? 1 : 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [flows.daily, sortCol, sortDir]);

  function handleExportCSV() {
    if (!flows.daily || flows.daily.length === 0) return;
    const headers = ["Report Date", "Category", "Segment", "Gross Buy (Cr)", "Gross Sell (Cr)", "Net Flow (Cr)", "Status"];
    const rows = sortedDaily.map((r) => [
      r.report_date,
      r.category,
      r.segment === "equity_cash" ? "Equity (Cash)" : r.segment,
      r.buy_crore != null ? r.buy_crore.toFixed(2) : "",
      r.sell_crore != null ? r.sell_crore.toFixed(2) : "",
      r.net_crore != null ? r.net_crore.toFixed(2) : "",
      r.provisional ? "provisional" : "final",
    ]);

    const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);

    const istDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    link.setAttribute("download", `fii_dii_flows_${istDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const latestProvisional = flows.daily
    .filter((r) => r.report_date === flows.as_of)
    .some((r) => r.provisional);

  const isStale = data?.freshness === "stale" || flows.is_stale;
  const isBlocked = data?.availability === "blocked" || flows.availability === "source_blocked";
  const errorMessage = flows.error || data?.message;

  const renderSortIndicator = (column: SortColumn) => {
    if (sortCol !== column) {
      return <span className="text-[#A8B4C4]/50 dark:text-[#536176] ml-1">↕</span>;
    }
    return <span className="text-[#006F64] dark:text-[#75E1CE] ml-1 font-bold">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Institutional FII / FPI & DII Capital Flows
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Equity (Cash)
            </span>
            {isStale ? (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                Stale {flows.age_days ? `(${flows.age_days}d ago)` : ""}
              </span>
            ) : flows.as_of ? (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                Current
              </span>
            ) : null}
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Foreign and domestic institutional cash market gross buy, sell, and net flows in ₹ Crore.
            {flows.as_of && <span> As-of {formatISTDate(flows.as_of)}.</span>}
            {flows.fetched_at && <span> Fetched at {formatISTDateTime(flows.fetched_at)}.</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Force refresh NSE flows feed"
          >
            <svg
              className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {retrying ? "Refreshing…" : "Retry / Poll"}
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!flows.daily || flows.daily.length === 0}
            className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Date Range Filter Bar */}
      <form
        onSubmit={handleApplyFilter}
        className="terminal-panel p-2.5 flex flex-wrap items-center gap-3 text-[12px]"
      >
        <span className="font-medium text-[#536176] dark:text-[#A8B4C4]">Filter Dates:</span>
        <div className="flex items-center gap-1.5">
          <label className="text-[#536176] dark:text-[#A8B4C4] font-mono text-[11px]">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-[#FFFFFF] dark:bg-[#101720] border border-[#E4E9EF] dark:border-[#2B3644] rounded px-2 py-1 text-[12px] font-mono text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[#536176] dark:text-[#A8B4C4] font-mono text-[11px]">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-[#FFFFFF] dark:bg-[#101720] border border-[#E4E9EF] dark:border-[#2B3644] rounded px-2 py-1 text-[12px] font-mono text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
          />
        </div>
        <button
          type="submit"
          className="terminal-btn text-[11px] py-1 px-2.5 font-medium cursor-pointer"
        >
          Apply
        </button>
        {(fromParam || toParam || fromDate || toDate) && (
          <button
            type="button"
            onClick={handleClearFilter}
            className="text-[11px] text-[#536176] hover:text-[#172033] dark:text-[#A8B4C4] dark:hover:text-[#EDF2F7] underline ml-auto cursor-pointer"
          >
            Reset to Last 365 Days
          </button>
        )}
      </form>

      {/* Real State Alerts & Errors */}
      {isBlocked && (
        <div className="terminal-panel p-3 border border-[#B42332]/40 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] flex items-center justify-between gap-3">
          <div>
            <strong>Source Blocked:</strong> NSE server returned access denied (HTTP 401/403) or rate-limit block.
            {errorMessage && <span className="block text-[11px] font-mono mt-0.5">{errorMessage}</span>}
          </div>
          <button onClick={handleRetry} className="terminal-btn text-[11px] py-1 px-2 cursor-pointer whitespace-nowrap">
            Retry Connection
          </button>
        </div>
      )}

      {!isBlocked && isStale && (
        <div className="terminal-panel p-3 border border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300 text-[12px] flex items-center justify-between gap-3">
          <div>
            <strong>Stale Data Notice:</strong> Last reported flow ({flows.as_of ? formatISTDate(flows.as_of) : "unknown"}) is older than the last trading day ({flows.last_trading_day ? formatISTDate(flows.last_trading_day) : "recent"}).
            {errorMessage && <span className="block text-[11px] font-mono mt-0.5">Last error: {errorMessage}</span>}
          </div>
          <button onClick={handleRetry} className="terminal-btn text-[11px] py-1 px-2 cursor-pointer whitespace-nowrap">
            Retry Poll
          </button>
        </div>
      )}

      {error && (
        <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] flex items-center justify-between">
          <div>
            <strong>Error:</strong> {error}
          </div>
          <button onClick={handleRetry} className="terminal-btn text-[11px] py-1 px-2 cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* Summary Highlight Table */}
      <div className="terminal-panel overflow-hidden">
        <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE] flex items-center justify-between">
          <span>Latest Session Institutional Net Positions</span>
          {flows.as_of && (
            <span className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4] font-normal lowercase">
              session: {formatISTDate(flows.as_of)}
            </span>
          )}
        </div>
        <table className="terminal-table">
          <thead>
            <tr>
              <th className="w-[35%] text-left">Investor Class</th>
              <th className="w-[25%] text-right">Net Flow (₹ Cr)</th>
              <th className="w-[25%] text-left">Market Segment</th>
              <th className="w-[15%] text-left">Reporting Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-left font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>FII / FPI Net Cash Position</span>
                <InfoTip metric="fii_net_flow" meta={data?.meta?.fii_net_flow ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={flows.fii_net_crore} unit="Cr" />
              </td>
              <td className="text-left text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                Foreign Portfolio Investors (Equity Cash)
              </td>
              <td className="text-left text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644]">
                  {latestProvisional ? "provisional" : "final"}
                </span>
              </td>
            </tr>
            <tr>
              <td className="text-left font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>DII Net Cash Position</span>
                <InfoTip metric="dii_net_flow" meta={data?.meta?.dii_net_flow ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={flows.dii_net_crore} unit="Cr" />
              </td>
              <td className="text-left text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                Domestic Institutions (MFs, Banks, Insurance)
              </td>
              <td className="text-left text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644]">
                  {latestProvisional ? "provisional" : "final"}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Historical Flows Ledger */}
      <div className="terminal-panel overflow-hidden">
        <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4] flex items-center justify-between">
          <span>Daily Institutional Activity Ledger</span>
          <span className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4] font-normal lowercase">
            {sortedDaily.length} records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th
                  onClick={() => handleSort("report_date")}
                  className="w-[15%] text-left cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center">
                    <span>Report Date</span>
                    {renderSortIndicator("report_date")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("category")}
                  className="w-[12%] text-left cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center">
                    <span>Category</span>
                    {renderSortIndicator("category")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("segment")}
                  className="w-[18%] text-left cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center">
                    <span>Segment</span>
                    {renderSortIndicator("segment")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("buy_crore")}
                  className="w-[18%] text-right cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center justify-end">
                    <span>Gross Buy (₹ Cr)</span>
                    {renderSortIndicator("buy_crore")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("sell_crore")}
                  className="w-[18%] text-right cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center justify-end">
                    <span>Gross Sell (₹ Cr)</span>
                    {renderSortIndicator("sell_crore")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("net_crore")}
                  className="w-[19%] text-right cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center justify-end">
                    <span>Net Flow (₹ Cr)</span>
                    {renderSortIndicator("net_crore")}
                  </div>
                </th>
                <th
                  onClick={() => handleSort("provisional")}
                  className="w-[10%] text-left cursor-pointer hover:bg-[#F2F5F8] dark:hover:bg-[#1c2430] select-none"
                >
                  <div className="flex items-center">
                    <span>Status</span>
                    {renderSortIndicator("provisional")}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                    Loading institutional flows ledger…
                  </td>
                </tr>
              ) : sortedDaily.length > 0 ? (
                sortedDaily.map((row) => {
                  const stableKey = row.id || `${row.report_date}_${row.category}_${row.segment}`;
                  // Item 17: gross buy/sell as ₹ Cr with Indian grouping.
                  const buyDisplay = formatGrossCrore(row.buy_crore);
                  const sellDisplay = formatGrossCrore(row.sell_crore);
                  const segmentLabel = row.segment === "equity_cash" ? "Equity (Cash)" : row.segment;

                  return (
                    <tr key={stableKey}>
                      <td className="text-left font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {formatISTDate(row.report_date)}
                      </td>
                      <td className="text-left">
                        <span
                          className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                            row.category === "FII"
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                              : "bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20"
                          }`}
                        >
                          {row.category}
                        </span>
                      </td>
                      <td className="text-left text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                        {segmentLabel}
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4] font-mono">
                        {buyDisplay}
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4] font-mono">
                        {sellDisplay}
                      </td>
                      <td className="text-right font-mono">
                        <SignedValue value={row.net_crore} unit="Cr" />
                      </td>
                      <td className="text-left">
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
                          {row.provisional ? "provisional" : "final"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                    No institutional flow records matching the criteria. Click &quot;Retry / Poll&quot; to fetch recent exchange data.
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

export default function FlowsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading institutional flows…
        </div>
      }
    >
      <FlowsContent />
    </Suspense>
  );
}
