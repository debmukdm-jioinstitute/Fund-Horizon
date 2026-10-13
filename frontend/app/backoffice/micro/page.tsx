"use client";

import React, { useEffect, useState } from "react";
import { getMicroIssuer, MicroIssuerData } from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

const fmtNum = (v?: number) => (v !== undefined ? v.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—");
const fmtCr = (v?: number) => (v !== undefined ? `₹${fmtNum(v)} Cr` : "—");

export default function MicroFundamentalsPage() {
  const [selectedIssuer, setSelectedIssuer] = useState("INFY");
  const [issuerData, setIssuerData] = useState<MicroIssuerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    async function load(id: string) {
      try {
        setLoading(true);
        setError(null);
        const res = await getMicroIssuer(id);
        setIssuerData(res.data);
        setNotice(res.data ? null : res.message ?? null);
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
            Quarterly revenue, EBITDA and net profit from NSE-filed results (live, cached 6h)
          </p>
        </div>
        <StatusBadge
          availability={issuerData ? "ready" : "unavailable"}
          freshness="current"
          frequency="quarterly"
          sourceName="NSE corporate results"
          sourceUrl="https://www.nseindia.com/companies-listing/corporate-filings-financial-results"
          units="₹ Crore"
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
          {error || notice || "NSE returned no quarterly results for this symbol."}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Key Metric Tiles (latest reported quarter, from NSE results) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Revenue (latest quarter)</div>
              <div className="mt-1 text-2xl font-bold text-sand-950 font-mono tabular-nums">
                {fmtCr(issuerData.revenue_crore)}
              </div>
              <div className="mt-2 text-xs text-sand-500 font-mono">Basis: {issuerData.reporting_scope || "—"}</div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Operating EBITDA Margin</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                {issuerData.ebitda_margin_pct !== undefined ? `${issuerData.ebitda_margin_pct}%` : "—"}
              </div>
              <div className="mt-2 text-xs text-sand-500 font-mono">PBT + interest + depreciation − other income</div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Net Profit (PAT)</div>
              <div className="mt-1 text-2xl font-bold text-sand-950 font-mono tabular-nums">{fmtCr(issuerData.pat_crore)}</div>
              <div className="mt-2 text-xs text-sand-500 font-mono">Latest reported quarter</div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Quarter Ended</div>
              <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-forest-800">{issuerData.fiscal_period || "—"}</div>
              <div className="mt-2 text-xs text-sand-500 font-mono">Filing ref: {issuerData.filing_id || "—"}</div>
            </div>
          </div>

          {/* Quarterly Financials Ledger */}
          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
            <h2 className="text-sm font-semibold text-sand-950 mb-3">Quarterly Results (NSE filings)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Quarter Ended</th>
                    <th className="py-2.5 px-3 font-medium">Revenue (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">EBITDA (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">EBITDA Margin</th>
                    <th className="py-2.5 px-3 font-medium">PAT (₹ Cr)</th>
                    <th className="py-2.5 px-3 font-medium">Filing Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                  {(issuerData.quarters ?? []).map((q) => (
                    <tr key={q.period_end} className="hover:bg-sand-50/60">
                      <td className="py-2.5 px-3 font-semibold text-sand-900">{q.period_end}</td>
                      <td className="py-2.5 px-3 text-sand-900 font-semibold">{fmtNum(q.revenue_crore)}</td>
                      <td className="py-2.5 px-3 text-sand-900">{fmtNum(q.ebitda_crore)}</td>
                      <td className="py-2.5 px-3 text-sand-700">{q.ebitda_margin_pct !== undefined ? `${q.ebitda_margin_pct}%` : "—"}</td>
                      <td className="py-2.5 px-3 text-emerald-700 font-semibold">{fmtNum(q.pat_crore)}</td>
                      <td className="py-2.5 px-3 text-sand-500 text-xs">{q.filing_id || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
