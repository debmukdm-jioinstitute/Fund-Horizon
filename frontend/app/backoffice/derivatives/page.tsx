"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getDerivatives, DerivativesData, BackofficeEnvelope } from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

const INDICES = [
  { id: "NIFTY", name: "NIFTY 50", type: "index_fno" },
  { id: "BANKNIFTY", name: "NIFTY Bank", type: "index_fno" },
  { id: "FINNIFTY", name: "NIFTY Financial", type: "index_fno" },
  { id: "MIDCPNIFTY", name: "NIFTY Midcap", type: "index_fno" },
  { id: "SENSEX", name: "BSE SENSEX", type: "index_fno" },
  { id: "NIFTYNXT50", name: "NIFTY Next 50", type: "cash_only" },
];

export default function DerivativesPage() {
  const [selectedIndex, setSelectedIndex] = useState("NIFTY");
  const [data, setData] = useState<BackofficeEnvelope<DerivativesData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await getDerivatives(selectedIndex);
        setData(res);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load derivatives data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedIndex]);

  const currentIndexMeta = INDICES.find((i) => i.id === selectedIndex);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Index Derivatives, Open Interest & PCR Analytics
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              NSE / BSE F&amp;O
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Option chain contracts, Put-Call Ratio (PCR) by OI and volume, and max pain distribution
          </p>
        </div>

        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
          Feed: <a href="https://www.nseindia.com" target="_blank" rel="noreferrer" className="underline hover:text-[#172033] dark:hover:text-[#EDF2F7]">NSE Official F&amp;O Reports</a>
        </div>
      </div>

      {/* Index Selector Bar */}
      <div className="terminal-panel p-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4] mr-2">
          Underlying:
        </span>
        {INDICES.map((idx) => {
          const isSelected = selectedIndex === idx.id;
          return (
            <button
              key={idx.id}
              onClick={() => setSelectedIndex(idx.id)}
              className={`terminal-btn text-[12px] py-1 px-2.5 ${
                isSelected
                  ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                  : ""
              }`}
            >
              <span>{idx.name}</span>
              {idx.type === "cash_only" && (
                <span className="ml-1 text-[10px] opacity-75 font-mono">(Cash)</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Cash-Only Notice */}
      {currentIndexMeta?.type === "cash_only" && (
        <div className="terminal-panel p-3 border border-[#E4E9EF] dark:border-[#2B3644] text-[12px] text-[#536176] dark:text-[#A8B4C4]">
          <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">Cash Index Notice: </span>
          Cash index levels do not have intrinsic traded open interest. Traded volume is available strictly for listed derivative contracts.
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading option chain snapshot…
        </div>
      ) : error || !data ? (
        <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
          <div className="font-medium mb-1">Error fetching derivatives</div>
          <div>{error}</div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Key Analytics Flat Table (No oversized KPI cards; absolute levels stay neutral) */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
              Index PCR &amp; Key Analytics Summary ({selectedIndex})
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[30%]">Derivative Metric</th>
                  <th className="w-[20%] text-right">Value</th>
                  <th className="w-[30%]">Analytical Breakdown</th>
                  <th className="w-[20%]">Status / Expiry</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Put-Call Ratio (Open Interest)</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {data.data.pcr_oi !== null && data.data.pcr_oi !== undefined ? data.data.pcr_oi.toFixed(2) : "—"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                    {data.data.pcr_oi_reason || `Total Call OI: ${formatNumber(data.data.total_call_oi)} | Total Put OI: ${formatNumber(data.data.total_put_oi)}`}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Neutral Indicator</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Put-Call Ratio (Traded Volume)</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {data.data.pcr_volume !== null && data.data.pcr_volume !== undefined ? data.data.pcr_volume.toFixed(2) : "—"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Put Traded Volume ÷ Call Traded Volume</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Active Session</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Max Pain Strike</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {data.data.max_pain_strike ? formatNumber(data.data.max_pain_strike) : "—"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Minimum aggregate option payoff level</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Calculated</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Underlying Spot / Future Price</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {data.data.underlying_price ? `₹${formatNumber(data.data.underlying_price)}` : "—"}
                  </td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Index underlying reference price</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                    Expiry: {data.data.expiry_date || "Nearest listed"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Option Chain Dense Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
              Dense Option Chain Matrix
            </div>

            {data.data.contracts.length === 0 ? (
              <div className="p-8 text-center text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                <div className="font-medium mb-1">Option Chain Contracts Awaiting Import</div>
                <p className="max-w-md mx-auto mb-3">
                  Upload verified EOD bhavcopy / derivative reports via Data Health.
                </p>
                <Link
                  href="/backoffice/data-health"
                  className="terminal-btn text-[12px] py-1 px-3 inline-block"
                >
                  Import Derivative Reports →
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="terminal-table text-center">
                  <thead>
                    <tr className="border-b border-[#E4E9EF] dark:border-[#2B3644]">
                      <th colSpan={3} className="text-center font-semibold bg-[#F7F9FB] dark:bg-[#171E27] border-r border-[#E4E9EF] dark:border-[#2B3644]">
                        CALLS (CE)
                      </th>
                      <th className="text-center font-semibold bg-[#E4E9EF]/50 dark:bg-[#2B3644]/50">
                        STRIKE
                      </th>
                      <th colSpan={3} className="text-center font-semibold bg-[#F7F9FB] dark:bg-[#171E27] border-l border-[#E4E9EF] dark:border-[#2B3644]">
                        PUTS (PE)
                      </th>
                    </tr>
                    <tr className="text-[11px]">
                      <th className="text-right">Call OI</th>
                      <th className="text-right">Volume</th>
                      <th className="text-right border-r border-[#E4E9EF] dark:border-[#2B3644]">IV (%)</th>
                      <th className="text-center font-semibold bg-[#E4E9EF]/20 dark:bg-[#2B3644]/20">Strike Price</th>
                      <th className="text-right border-l border-[#E4E9EF] dark:border-[#2B3644]">IV (%)</th>
                      <th className="text-right">Volume</th>
                      <th className="text-right">Put OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.contracts.map((c, idx) => (
                      <tr key={idx}>
                        <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                          {c.option_type === "CE" ? formatNumber(c.oi) : "—"}
                        </td>
                        <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                          {c.option_type === "CE" ? formatNumber(c.volume) : "—"}
                        </td>
                        <td className="text-right text-[#536176] dark:text-[#A8B4C4] border-r border-[#E4E9EF] dark:border-[#2B3644]">
                          {c.option_type === "CE" && c.implied_volatility ? `${c.implied_volatility}%` : "—"}
                        </td>
                        <td className="text-center font-medium text-[#172033] dark:text-[#EDF2F7] bg-[#F7F9FB] dark:bg-[#171E27]">
                          {formatNumber(c.strike_price)}
                        </td>
                        <td className="text-right text-[#536176] dark:text-[#A8B4C4] border-l border-[#E4E9EF] dark:border-[#2B3644]">
                          {c.option_type === "PE" && c.implied_volatility ? `${c.implied_volatility}%` : "—"}
                        </td>
                        <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                          {c.option_type === "PE" ? formatNumber(c.volume) : "—"}
                        </td>
                        <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                          {c.option_type === "PE" ? formatNumber(c.oi) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
