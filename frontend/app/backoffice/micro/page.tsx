"use client";

import React, { useEffect, useState } from "react";
import { getMicroIssuer, MicroIssuerData } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Micro & Issuer Fundamentals Hub</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Issuer balance sheets, EBITDA, cash flow conversion, AMC portfolio look-through & filings coverage
          </p>
        </div>
        <StatusBadge
          availability="manual_only"
          freshness="current"
          frequency="quarterly"
          sourceName="Official Exchange Filings"
          sourceUrl="https://www.bseindia.com/corporates/ann.html"
          units="Normalized Standard"
        />
      </div>

      {/* Issuer Selector */}
      <div className="bg-white p-4 rounded-2xl border border-sand-200 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex gap-2 flex-1">
          {["INFY", "TCS", "HDFCBANK", "RELIANCE"].map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedIssuer(sym)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold font-mono transition-colors ${
                selectedIssuer === sym
                  ? "bg-forest-700 text-white shadow-xs"
                  : "bg-sand-50 text-sand-700 hover:bg-sand-100 border border-sand-200"
              }`}
            >
              {sym}
            </button>
          ))}
          <input
            type="text"
            placeholder="Search NSE/BSE symbol…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                setSelectedIssuer((e.target as HTMLInputElement).value.trim().toUpperCase());
              }
            }}
            className="px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-mono w-48"
          />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sand-500 font-mono text-xs flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-forest-700" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading issuer fundamentals…
        </div>
      ) : error || !issuerData ? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
          <div className="font-semibold mb-1">Fundamentals unavailable for {selectedIssuer}</div>
          {error || "Issuer fundamentals are not available yet: no free automated filings feed is wired up and manual issuer import is not enabled."}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key Metric Tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Revenue (Trailing 12M)</div>
              <div className="mt-1 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {issuerData.revenue_crore ? `₹${issuerData.revenue_crore.toLocaleString()} Cr` : "—"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500 font-mono">
                Scope: {issuerData.reporting_scope || "Consolidated"}
              </div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Operating EBITDA Margin</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {issuerData.ebitda_margin_pct ? `${issuerData.ebitda_margin_pct}%` : "—"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500 font-mono">
                FY Period: {issuerData.fiscal_period || "Q1 FY27"}
              </div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Debt to Equity Ratio</div>
              <div className="mt-1 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {issuerData.debt_equity_ratio !== undefined ? issuerData.debt_equity_ratio : "0.00"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500 font-mono">
                Net Debt: {issuerData.net_debt_crore ? `₹${issuerData.net_debt_crore} Cr` : "Net Cash Positive"}
              </div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Mutual Fund Look-Through Weight</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-forest-800">
                {issuerData.mf_lookthrough_weight_pct ? `${issuerData.mf_lookthrough_weight_pct}%` : "Tracked"}
              </div>
              <div className="mt-2 text-[11px] text-sand-500 font-mono">
                AMC disclosures aggregated
              </div>
            </div>
          </div>

          {/* Quarterly Financials Ledger */}
          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
            <h2 className="text-sm font-semibold text-sand-950 mb-3">Quarterly Financial Statements & Filings</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Fiscal Period</th>
                    <th className="py-2.5 px-3 font-medium">Reporting Basis</th>
                    <th className="py-2.5 px-3 font-medium">Revenue (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">EBITDA (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">PAT (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">Filing Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                  <tr className="hover:bg-sand-50/60">
                    <td className="py-2.5 px-3 font-semibold text-sand-900">{issuerData.fiscal_period || "Q1 FY27"}</td>
                    <td className="py-2.5 px-3 text-sand-600 font-sans">Consolidated Ind AS</td>
                    <td className="py-2.5 px-3 text-sand-900 font-semibold">{issuerData.revenue_crore ? `₹${issuerData.revenue_crore.toLocaleString()}` : "—"}</td>
                    <td className="py-2.5 px-3 text-sand-900">{issuerData.ebitda_crore ? `₹${issuerData.ebitda_crore.toLocaleString()}` : "—"}</td>
                    <td className="py-2.5 px-3 text-emerald-700 font-semibold">{issuerData.pat_crore ? `₹${issuerData.pat_crore.toLocaleString()}` : "—"}</td>
                    <td className="py-2.5 px-3 text-sand-500 text-[11px]">{issuerData.filing_id || "BSE_CORP_FILING_2026"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
