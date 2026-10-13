// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import ExplainModal from "@/components/ExplainModal";
import { uploadCas } from "@/lib/api";
import type { CasAnalysisResult } from "@/lib/types";

const TARGET_BANDS = [
  "Conservative",
  "Moderately Conservative",
  "Moderate",
  "Moderately Aggressive",
  "Aggressive",
];

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

function formatPercent(val: number | null | undefined, showPlus = true): string {
  if (val === null || val === undefined) return "N/A";
  const num = val * 100;
  const prefix = showPlus && num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(2)}%`;
}

export default function CasUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [band, setBand] = useState("Moderate");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CasAnalysisResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Please select a CAS PDF statement to upload.");
      return;
    }
    if (!consent) {
      setError("Please check the consent box to proceed.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await uploadCas(file, password, consent, band);
      setResult(res);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to process CAS statement. Please check your password and file.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Privacy Notice Box */}
      <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-5 text-sm text-navy-800">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-teal-500/20 p-1 text-teal-800">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="space-y-1">
            <h2 className="font-semibold text-navy-950">Statutory Privacy & In-Memory Processing Guarantee</h2>
            <p>
              Your CAS PDF statement and password are processed entirely in memory. They are never written to disk,
              cached, or stored in any database. Only computed portfolio summaries are returned to your browser.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      {!result ? (
        <form onSubmit={handleSubmit} className="card space-y-6">
          <h2 className="text-xl font-bold text-navy-950">Upload Consolidated Account Statement (CAS)</h2>
          <p className="text-sm text-navy-700">
            Upload your monthly or half-yearly CAS PDF from CAMS, KFintech, NSDL, or CDSL to review your mutual fund portfolio,
            historical returns (XIRR), and asset allocation.
          </p>

          <div>
            <label htmlFor="cas-file" className="block text-sm font-semibold text-navy-900">
              CAS PDF Document
            </label>
            <input
              id="cas-file"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-navy-800 file:mr-4 file:rounded-md file:border-0 file:bg-teal-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-navy-950 hover:file:bg-teal-400 focus:outline-none"
              required
            />
            <p className="mt-1 text-xs text-navy-600">Max file size: 15MB. Only valid PDF files accepted.</p>
          </div>

          <div>
            <label htmlFor="cas-password" className="block text-sm font-semibold text-navy-900">
              PDF Password (Usually your PAN in lowercase/uppercase or DOB)
            </label>
            <div className="relative mt-1">
              <input
                id="cas-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank if PDF is not password-protected"
                className="input pr-20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-navy-600 hover:bg-navy-100"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="target-band" className="block text-sm font-semibold text-navy-900">
              Target Asset Allocation Profile
            </label>
            <select
              id="target-band"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              className="input mt-1"
            >
              {TARGET_BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-start gap-2 pt-2">
            <input
              id="cas-consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              required
            />
            <label htmlFor="cas-consent" className="text-xs leading-relaxed text-navy-700">
              I confirm that I am the owner of this Consolidated Account Statement (CAS). I consent to parsing the
              statement in memory to compute illustrative portfolio analytics. My PDF and password will not be stored.
            </label>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-accent w-full disabled:opacity-50 py-3.5 text-base"
          >
            {loading ? "Parsing Statement in Memory..." : "Analyze Portfolio"}
          </button>
        </form>
      ) : (
        /* Results View */
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-teal-700">CAS Portfolio Summary</span>
              <h2 className="text-2xl font-bold text-navy-950">
                {result.investor_name || "Investor Portfolio"}
              </h2>
              {result.email && (
                <p className="text-sm text-navy-600">{result.email}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ExplainModal
                buttonLabel="Explain Portfolio Analysis"
                kind="cas"
                casData={result as unknown as Record<string, unknown>}
              />
              <button
                onClick={() => setResult(null)}
                className="btn border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
              >
                Upload Another Statement
              </button>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="card">
              <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Total Portfolio Value</span>
              <p className="mt-1 text-2xl font-bold text-navy-950">{formatCurrency(result.total_value)}</p>
            </div>
            <div className="card">
              <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Total Invested</span>
              <p className="mt-1 text-2xl font-bold text-navy-950">
                {result.total_invested ? formatCurrency(result.total_invested) : "—"}
              </p>
            </div>
            <div className="card">
              <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Total Gain / P&amp;L</span>
              <p
                className={`mt-1 text-2xl font-bold ${
                  result.total_gain && result.total_gain >= 0
                    ? "text-emerald-600"
                    : result.total_gain && result.total_gain < 0
                    ? "text-rose-600"
                    : "text-navy-950"
                }`}
              >
                {result.total_gain !== null && result.total_gain !== undefined
                  ? `${result.total_gain >= 0 ? "+" : ""}${formatCurrency(result.total_gain)}`
                  : "—"}
              </p>
            </div>
            <div className="card">
              <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Portfolio Returns</span>
              <p className="mt-1 text-2xl font-bold text-teal-700">
                {result.overall_xirr !== null ? `${formatPercent(result.overall_xirr)} XIRR` : "N/A"}
              </p>
            </div>
            <div className="card">
              <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Folios / Schemes</span>
              <p className="mt-1 text-2xl font-bold text-navy-950">
                {result.folios_count} <span className="text-sm font-normal text-navy-600">/ {result.holdings_count}</span>
              </p>
            </div>
          </div>

          {/* Direct vs Regular Breakdown */}
          <div className="card space-y-4">
            <h3 className="text-lg font-bold text-navy-950">Direct vs Regular Plan Breakdown</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-navy-200 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Direct Plans</span>
                <p className="mt-1 text-xl font-bold text-navy-950">{formatCurrency(result.plan_breakdown.direct.value)}</p>
                <p className="text-sm text-navy-600">{result.plan_breakdown.direct.pct.toFixed(1)}% of portfolio</p>
              </div>
              <div className="rounded-lg border border-navy-200 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-navy-600">Regular Plans</span>
                <p className="mt-1 text-xl font-bold text-navy-950">{formatCurrency(result.plan_breakdown.regular.value)}</p>
                <p className="text-sm text-navy-600">{result.plan_breakdown.regular.pct.toFixed(1)}% of portfolio</p>
              </div>
            </div>
            <p className="text-xs text-navy-600">
              {result.plan_breakdown.notice ||
                "Statutory Information: Regular mutual fund plans include distributor commissions paid out of scheme expenses. Direct plans carry lower total expense ratios. Fund Horizon provides distribution support under ARN 345439."}
            </p>
          </div>

          {/* Asset Allocation Comparison Table */}
          {result.band_comparison && (
            <div className="card space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold text-navy-950">
                  Asset Allocation vs Target Profile ({result.band_comparison.target_band})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-navy-200 text-xs uppercase tracking-wider text-navy-600">
                      <th className="py-2">Asset Class</th>
                      <th className="py-2 text-right">Current Share</th>
                      <th className="py-2 text-right">Target Share</th>
                      <th className="py-2 text-right">Rebalancing Gap</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100">
                    {result.band_comparison.comparison.map((row) => (
                      <tr key={row.asset_class}>
                        <td className="py-2 font-medium text-navy-900">{row.asset_class}</td>
                        <td className="py-2 text-right font-medium text-navy-900">{row.actual_pct.toFixed(1)}%</td>
                        <td className="py-2 text-right text-navy-700">{row.target_pct.toFixed(1)}%</td>
                        <td className="py-2 text-right">
                          <span
                            className={`font-semibold ${
                              row.gap_pct > 2
                                ? "text-blue-700"
                                : row.gap_pct < -2
                                ? "text-amber-700"
                                : "text-green-700"
                            }`}
                          >
                            {row.gap_pct > 0 ? `+${row.gap_pct.toFixed(1)}%` : `${row.gap_pct.toFixed(1)}%`}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-semibold capitalize ${
                              row.status === "aligned"
                                ? "bg-green-100 text-green-800"
                                : row.status === "overweight"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Holdings Breakdown */}
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-navy-950">Folios &amp; Scheme Holdings</h3>
                <p className="text-xs text-navy-600">Complete breakdown with verified AMFI scheme codes, NAVs, and annualized returns</p>
              </div>
              <span className="rounded-full bg-navy-100 px-3 py-1 text-xs font-medium text-navy-800">
                {result.holdings.length} {result.holdings.length === 1 ? "Holding" : "Holdings"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-navy-200 text-xs uppercase tracking-wider text-navy-600">
                    <th className="py-3 px-2">Scheme Name &amp; Code</th>
                    <th className="py-3 px-2">Folio / Demat</th>
                    <th className="py-3 px-2">Category</th>
                    <th className="py-3 px-2">Plan</th>
                    <th className="py-3 px-2 text-right">Units</th>
                    <th className="py-3 px-2 text-right">NAV</th>
                    <th className="py-3 px-2 text-right">Invested Value</th>
                    <th className="py-3 px-2 text-right">Current Valuation</th>
                    <th className="py-3 px-2 text-right">Returns (XIRR / CAGR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {result.holdings.map((h, i) => {
                    const isZeroHolding = h.units === 0 && h.current_value === 0;
                    return (
                      <tr
                        key={`${h.folio}-${h.isin || i}`}
                        className={`hover:bg-navy-50/50 transition-colors ${isZeroHolding ? "opacity-60" : ""}`}
                      >
                        <td className="py-3 px-2">
                          <div className="space-y-1">
                            <span className="font-semibold text-navy-950 block leading-snug">
                              {h.scheme_name}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              {h.scheme_code && (
                                <span className="inline-flex items-center rounded bg-teal-50 px-1.5 py-0.5 text-xs font-semibold text-teal-800 border border-teal-200">
                                  AMFI: {h.scheme_code}
                                </span>
                              )}
                              {h.isin && (
                                <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700 border border-slate-200">
                                  ISIN: {h.isin}
                                </span>
                              )}
                              {h.asset_class && (
                                <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 border border-blue-200 capitalize">
                                  {h.asset_class}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md bg-navy-50 px-2 py-1 text-xs font-mono font-medium text-navy-700 border border-navy-200">
                            {h.folio}
                          </span>
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <span className="text-xs font-medium text-navy-800 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                            {h.category || "Unclassified"}
                          </span>
                        </td>
                        <td className="py-3 px-2 whitespace-nowrap">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold border ${
                              h.is_direct
                                ? "bg-teal-50 text-teal-800 border-teal-200"
                                : "bg-navy-50 text-navy-800 border-navy-200"
                            }`}
                          >
                            {h.plan}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-xs text-navy-800 whitespace-nowrap">
                          {h.units.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-xs text-navy-800 whitespace-nowrap">
                          {h.nav !== null ? `₹${h.nav.toFixed(2)}` : "—"}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-xs text-navy-800 whitespace-nowrap">
                          {h.invested_value ? formatCurrency(h.invested_value) : "—"}
                        </td>
                        <td className="py-3 px-2 text-right whitespace-nowrap">
                          <div className="font-semibold text-navy-950 font-mono text-sm">
                            {formatCurrency(h.current_value)}
                          </div>
                          {h.weight_pct > 0 && (
                            <span className="text-xs text-navy-500 font-sans block">
                              {h.weight_pct.toFixed(1)}% weight
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-2 text-right whitespace-nowrap">
                          {h.xirr !== null && h.xirr !== undefined ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                                h.xirr >= 0
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border-rose-200"
                              }`}
                            >
                              {formatPercent(h.xirr)} XIRR
                            </span>
                          ) : h.cagr !== null && h.cagr !== undefined ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                                h.cagr >= 0
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border-rose-200"
                              }`}
                            >
                              {formatPercent(h.cagr)} CAGR
                            </span>
                          ) : h.cagr_3y !== null && h.cagr_3y !== undefined ? (
                            <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 border border-teal-200">
                              {formatPercent(h.cagr_3y)} 3Y
                            </span>
                          ) : (
                            <span className="text-xs text-navy-600">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
