"use client";

import React, { useEffect, useState } from "react";
import { getMicroIssuer, MicroIssuerData } from "@/lib/backoffice";
import { formatCrore, formatPercent } from "@/lib/terminal-format";

export default function MicroFundamentalsPage() {
  const [selectedIssuer, setSelectedIssuer] = useState("INFY");
  const [issuerData, setIssuerData] = useState<MicroIssuerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load(id: string) {
      try {
        setLoading(true);
        setError(null);
        const res = await getMicroIssuer(id);
        setIssuerData(res.data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load issuer fundamentals");
        setIssuerData(null);
      } finally {
        setLoading(false);
      }
    }
    load(selectedIssuer);
  }, [selectedIssuer]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Corporate Fundamentals & Issuer Metrics
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Ind AS Filings
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Quarterly financial statements, EBITDA margins, net debt-to-equity, and AMC portfolio look-through weights
          </p>
        </div>

        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
          Exchange: <a href="https://www.bseindia.com" target="_blank" rel="noreferrer" className="underline hover:text-[#172033] dark:hover:text-[#EDF2F7]">BSE / NSE Corporate Filings</a>
        </div>
      </div>

      {/* Issuer Selector Toolbar */}
      <div className="terminal-panel p-2.5 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4] mr-1">
          Issuer:
        </span>
        {["INFY", "TCS", "HDFCBANK", "RELIANCE"].map((sym) => (
          <button
            key={sym}
            onClick={() => setSelectedIssuer(sym)}
            className={`terminal-btn text-[12px] py-0.5 px-2.5 font-mono ${
              selectedIssuer === sym
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            {sym}
          </button>
        ))}
        <input
          type="text"
          placeholder="Custom symbol (e.g. ITC)…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
              setSelectedIssuer((e.target as HTMLInputElement).value.trim().toUpperCase());
            }
          }}
          className="terminal-input text-[12px] py-0.5 px-2 font-mono w-40 ml-auto"
        />
      </div>

      {loading ? (
        <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading fundamentals for {selectedIssuer}…
        </div>
      ) : error || !issuerData ? (
        <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
          <div className="font-medium mb-1">Fundamentals unavailable for {selectedIssuer}</div>
          <div>{error || "No quarterly statement uploaded. Import corporate financial statements via Data Health."}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Key Fundamentals Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
              Key Issuer Ratios & AMC Look-Through ({selectedIssuer})
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[30%]">Financial Metric</th>
                  <th className="w-[25%] text-right">Reported Value</th>
                  <th className="w-[25%]">Accounting Scope</th>
                  <th className="w-[20%]">Filing Period</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Revenue (TTM)</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {issuerData.revenue_crore ? formatCrore(issuerData.revenue_crore) : "—"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{issuerData.reporting_scope || "Consolidated Ind AS"}</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{issuerData.fiscal_period || "Q1 FY27"}</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Operating EBITDA Margin</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {issuerData.ebitda_margin_pct ? formatPercent(issuerData.ebitda_margin_pct) : "—"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Core Operating Margin</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{issuerData.fiscal_period || "Q1 FY27"}</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Debt-to-Equity Ratio</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {issuerData.debt_equity_ratio !== undefined ? issuerData.debt_equity_ratio.toFixed(2) : "0.00"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                    {issuerData.net_debt_crore ? `Net Debt: ${formatCrore(issuerData.net_debt_crore)}` : "Net Cash Positive"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Latest Balance Sheet</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">AMC Look-Through Weight</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {issuerData.mf_lookthrough_weight_pct ? formatPercent(issuerData.mf_lookthrough_weight_pct) : "Tracked"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Aggregated Mutual Fund Disclosures</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Active Portfolio</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Quarterly Statements Ledger Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
              Quarterly Statement Filings History
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th>Fiscal Period</th>
                  <th>Reporting Basis</th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">EBITDA</th>
                  <th className="text-right">PAT</th>
                  <th>Filing Reference</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{issuerData.fiscal_period || "Q1 FY27"}</td>
                  <td className="text-[#536176] dark:text-[#A8B4C4]">Consolidated Ind AS</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {issuerData.revenue_crore ? formatCrore(issuerData.revenue_crore) : "—"}
                  </td>
                  <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                    {issuerData.ebitda_crore ? formatCrore(issuerData.ebitda_crore) : "—"}
                  </td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {issuerData.pat_crore ? formatCrore(issuerData.pat_crore) : "—"}
                  </td>
                  <td className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">
                    {issuerData.filing_id || "BSE_CORP_FILING_2026"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
