"use client";

import React, { useEffect, useState } from "react";
import { getFlows, FlowsData, BackofficeEnvelope } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";
import InfoTip from "@/components/InfoTip";

export default function FlowsPage() {
  const [data, setData] = useState<BackofficeEnvelope<FlowsData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await getFlows();
        setData(res);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load institutional flows");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function handleExportCSV() {
    if (!data?.data.daily || data.data.daily.length === 0) return;
    const headers = ["Report Date", "Category", "Segment", "Gross Buy (Cr)", "Gross Sell (Cr)", "Net Flow (Cr)", "Status"];
    const rows = data.data.daily.map((r) => [
      r.report_date,
      r.category,
      r.segment,
      r.buy_crore !== undefined ? r.buy_crore.toFixed(1) : "",
      r.sell_crore !== undefined ? r.sell_crore.toFixed(1) : "",
      r.net_crore !== undefined ? r.net_crore.toFixed(1) : "",
      r.provisional ? "Provisional" : "Final",
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `fii_dii_flows_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (loading && !data) {
    return (
      <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading institutional FII / DII flows…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
        <div className="font-medium mb-1">Failed to load flows data</div>
        <div>{error}</div>
      </div>
    );
  }

  const flows = data?.data || { daily: [] };
  const latestProvisional = flows.daily.filter((r) => r.report_date === flows.as_of).some((r) => r.provisional);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Institutional FII / FPI & DII Capital Flows
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Cash Market
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Foreign and domestic institutional cash market gross buy, sell, and net flows in ₹ Crore
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Highlight Table */}
      <div className="terminal-panel overflow-hidden">
        <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
          Latest Session Institutional Net Positions
        </div>
        <table className="terminal-table">
          <thead>
            <tr>
              <th className="w-[30%]">Investor Class</th>
              <th className="w-[25%] text-right">Net Flow (₹ Cr)</th>
              <th className="w-[25%]">Market Segment</th>
              <th className="w-[20%]">Reporting Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>FII / FPI Net Cash Position</span>
                <InfoTip metric="fii_net_flow" meta={data?.meta?.fii_net_flow ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={flows.fii_net_crore} unit="Cr" />
              </td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Foreign Portfolio Investors (Equity)</td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{latestProvisional ? "Provisional" : "Final"}</td>
            </tr>
            <tr>
              <td className="font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>DII Net Cash Position</span>
                <InfoTip metric="dii_net_flow" meta={data?.meta?.dii_net_flow ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={flows.dii_net_crore} unit="Cr" />
              </td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Domestic Institutions (MFs, Insurance)</td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{latestProvisional ? "Provisional" : "Final"}</td>
            </tr>
            <tr>
              <td className="font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>{flows.sessions ?? 0}-Session Cumulative Net Flow (FII + DII)</span>
                <InfoTip metric="fii_dii_net" meta={data?.meta?.fii_dii_net ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={flows.cumulative_7d_net_crore} unit="Cr" />
              </td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Combined net over the sessions on record (max 7)</td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Aggregated</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Historical Flows Ledger */}
      <div className="terminal-panel overflow-hidden">
        <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
          Daily Institutional Activity Ledger
        </div>
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th className="w-[15%]">Report Date</th>
                <th className="w-[15%]">Category</th>
                <th className="w-[15%]">Segment</th>
                <th className="w-[15%] text-right">Gross Buy (₹ Cr)</th>
                <th className="w-[15%] text-right">Gross Sell (₹ Cr)</th>
                <th className="w-[15%] text-right">Net Flow (₹ Cr)</th>
                <th className="w-[10%]">Status</th>
              </tr>
            </thead>
            <tbody>
              {flows.daily && flows.daily.length > 0 ? (
                flows.daily.map((row, idx) => {
                  const buyCr = row.buy_crore !== undefined ? row.buy_crore.toFixed(1) : "—";
                  const sellCr = row.sell_crore !== undefined ? row.sell_crore.toFixed(1) : "—";
                  const netCr = row.net_crore;
                  return (
                    <tr key={idx}>
                      <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {formatISTDate(row.report_date)}
                      </td>
                      <td className="text-[#536176] dark:text-[#A8B4C4]">{row.category}</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{row.segment}</td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">{buyCr}</td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">{sellCr}</td>
                      <td className="text-right">
                        <SignedValue value={netCr} unit="Cr" />
                      </td>
                      <td>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
                          {row.provisional ? "Provisional" : "Final"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-[#536176] dark:text-[#A8B4C4]">
                    Awaiting next official exchange session report or manual flow import.
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
