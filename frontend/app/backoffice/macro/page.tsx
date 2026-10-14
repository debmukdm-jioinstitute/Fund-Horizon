"use client";

import React, { useEffect, useState } from "react";
import { getYieldsBoard, YieldsBoardData, BackofficeEnvelope } from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";
import InfoTip from "@/components/InfoTip";

export default function MacroYieldsPage() {
  const [data, setData] = useState<BackofficeEnvelope<YieldsBoardData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string>("ALL");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await getYieldsBoard();
        setData(res);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load yields board");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading sovereign yield curves and term structure…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
        <div className="font-medium mb-1">Failed to load yields data</div>
        <div>{error}</div>
      </div>
    );
  }

  const yieldsData = data?.data || { curves: {}, spreads: {} };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Global Sovereign Yields & Macro Curve Matrix
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Trading Economics (India, indicative) • US Treasury
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            India and United States term structure, canonical basis point spreads, and slope metrics
          </p>
        </div>

        <div className="flex items-center gap-2">
          {["ALL", "IN", "US"].map((code) => (
            <button
              key={code}
              onClick={() => setSelectedCountry(code)}
              className={`terminal-btn text-[12px] py-1 px-2.5 ${
                selectedCountry === code
                  ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                  : ""
              }`}
            >
              {code === "ALL" ? "All Sovereign" : code}
            </button>
          ))}
        </div>
      </div>

      {/* Benchmark Spreads Flat Table */}
      <div className="terminal-panel overflow-hidden">
        <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
          Canonical Sovereign Spreads & Term Slopes
        </div>
        <table className="terminal-table">
          <thead>
            <tr>
              <th className="w-[35%]">Spread Metric</th>
              <th className="w-[20%] text-right">Spread (bps)</th>
              <th className="w-[25%]">Formula / Series</th>
              <th className="w-[20%]">Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>India – US 10Y Sovereign Spread</span>
                <InfoTip metric="yield_spread_in_us" meta={data?.meta?.yield_spread_in_us ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={yieldsData.spreads?.in_us_10y_bps} unit="bps" />
              </td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">India 10Y minus US 10Y, same-date values only</td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Trading Economics / US Treasury</td>
            </tr>
            <tr>
              <td className="font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>US 10Y – 2Y Term Structure Slope</span>
                <InfoTip metric="us_yield_curve_slope" meta={data?.meta?.us_yield_curve_slope ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={yieldsData.spreads?.us_10y_2y_bps} unit="bps" />
              </td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">US 10Y minus 2Y constant-maturity yield</td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">US Treasury</td>
            </tr>
            <tr>
              <td className="font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center">
                <span>India 10Y – 2Y G-Sec Term Slope</span>
                <InfoTip metric="us_yield_curve_slope" meta={data?.meta?.us_yield_curve_slope ?? data?.meta?._default} />
              </td>
              <td className="text-right">
                <SignedValue value={yieldsData.spreads?.in_10y_2y_bps} unit="bps" />
              </td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">India 10Y minus 2Y</td>
              <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Trading Economics (indicative)</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Tenor Term Structure Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* India Sovereign Curve */}
        {(selectedCountry === "ALL" || selectedCountry === "IN") && (
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  India Sovereign G-Sec Curve
                </span>
                <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4] ml-2">
                  (Indicative quotes)
                </span>
              </div>
              <a href="https://tradingeconomics.com/india/government-bond-yield" target="_blank" rel="noreferrer" className="text-[11px] text-[#536176] dark:text-[#A8B4C4] hover:underline">
                Trading Economics (indicative)
              </a>
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[25%]">Tenor</th>
                  <th className="w-[25%] text-right">Yield (%)</th>
                  <th className="w-[25%]">Observed Date</th>
                  <th className="w-[25%]">Source</th>
                </tr>
              </thead>
              <tbody>
                {yieldsData.curves?.IN && Object.keys(yieldsData.curves.IN).length > 0 ? (
                  Object.entries(yieldsData.curves.IN).map(([tenor, val]: [string, { value: number; observed_at: string; source: string }]) => (
                    <tr key={tenor}>
                      <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{tenor}</td>
                      <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {val.value.toFixed(2)}%
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(val.observed_at)}</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{val.source}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#536176] dark:text-[#A8B4C4]">
                      India G-Sec yields have not been collected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* US Treasury Curve */}
        {(selectedCountry === "ALL" || selectedCountry === "US") && (
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  US Treasury Yield Curve
                </span>
                <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4] ml-2">
                  (Semi-Annual Constant Maturity)
                </span>
              </div>
              <a href="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve" target="_blank" rel="noreferrer" className="text-[11px] text-[#536176] dark:text-[#A8B4C4] hover:underline">
                US Treasury
              </a>
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[25%]">Tenor</th>
                  <th className="w-[25%] text-right">Yield (%)</th>
                  <th className="w-[25%]">Observed Date</th>
                  <th className="w-[25%]">Source</th>
                </tr>
              </thead>
              <tbody>
                {yieldsData.curves?.US && Object.keys(yieldsData.curves.US).length > 0 ? (
                  Object.entries(yieldsData.curves.US).map(([tenor, val]: [string, { value: number; observed_at: string; source: string }]) => (
                    <tr key={tenor}>
                      <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{tenor}</td>
                      <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {val.value.toFixed(2)}%
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{formatISTDate(val.observed_at)}</td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{val.source}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#536176] dark:text-[#A8B4C4]">
                      US Treasury yields have not been collected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
