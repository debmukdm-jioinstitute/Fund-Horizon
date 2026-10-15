"use client";

import React, { useEffect, useState } from "react";
import { getScreeningFund, ScreeningFundDetail } from "@/lib/backoffice";
import { findManagerProfile } from "@/lib/pms-managers";
import { SignedValue } from "@/components/terminal/SignedValue";

interface ScreeningFundDrawerProps {
  schemeCode: string | null;
  onClose: () => void;
}

export default function ScreeningFundDrawer({
  schemeCode,
  onClose,
}: ScreeningFundDrawerProps) {
  const [data, setData] = useState<ScreeningFundDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!schemeCode) {
      setData(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await getScreeningFund(schemeCode!);
        if (!cancelled) {
          setData(res.data);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load fund details");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [schemeCode]);

  if (!schemeCode) return null;

  const fund = data;
  const managerProfile = fund?.manager_name ? findManagerProfile(fund.manager_name) : null;
  const pmsMatches = data?.pms_matches || [];
  const notes = data?.notes || [];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-xl bg-white dark:bg-[#10151C] shadow-2xl flex flex-col border-l border-[#E5E5E5] dark:border-[#2B3644]">
          {/* Header */}
          <div className="p-4 bg-[#F3F3F3] dark:bg-[#171E27] border-b border-[#E5E5E5] dark:border-[#2B3644] flex items-start justify-between">
            <div className="pr-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono uppercase bg-[#0176D3]/15 text-[#0176D3] dark:text-[#1B96FF] px-1.5 py-0.5 rounded font-medium">
                  {fund?.cat ? fund.cat.replace(/_/g, " ") : "Mutual Fund"}
                </span>
                <span className="text-[11px] font-mono text-[#706E6B] dark:text-[#A8B4C4]">
                  Code: {schemeCode}
                </span>
              </div>
              <h2 className="text-[16px] font-medium text-[#181818] dark:text-[#EDF2F7] leading-tight">
                {fund?.scheme_name || `Scheme ${schemeCode}`}
              </h2>
              {fund?.amc && (
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                  AMC: {fund.amc}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[#706E6B] hover:text-[#181818] dark:text-[#A8B4C4] dark:hover:text-[#EDF2F7] p-1.5 rounded-lg hover:bg-[#E5E5E5] dark:hover:bg-[#2B3644] transition"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {loading && (
              <div className="py-12 text-center text-[#706E6B] dark:text-[#A8B4C4] text-[12px] font-mono">
                Loading scheme inspection data…
              </div>
            )}

            {error && (
              <div className="p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] rounded">
                {error}
              </div>
            )}

            {fund && !loading && (
              <>
                {/* TER & Quartile Banner */}
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div className="p-2.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644]">
                    <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Regular TER</div>
                    <div className="text-[16px] font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums mt-0.5">
                      {fund.expense_ratio !== null && fund.expense_ratio !== undefined
                        ? `${fund.expense_ratio.toFixed(2)}%`
                        : "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644]">
                    <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">2Y Category Quartile</div>
                    <div className="text-[16px] font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums mt-0.5">
                      {fund.quartile_2y ? `Q${fund.quartile_2y}` : "Unavailable"}
                    </div>
                    <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">
                      Source: {fund.quartile_source || "computed"}
                    </div>
                  </div>
                </div>

                {/* Manager Profile & PMS Evidence */}
                <div className="p-3 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] space-y-2">
                  <div className="flex items-center justify-between pb-1.5 border-b border-[#E5E5E5] dark:border-[#2B3644]">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0176D3] dark:text-[#1B96FF]">
                      Manager Track Record &amp; Cross-Evidence
                    </span>
                    <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] font-mono">
                      {fund.manager_tenure_years !== null && fund.manager_tenure_years !== undefined
                        ? `${fund.manager_tenure_years.toFixed(1)} yrs tenure`
                        : "Unknown start"}
                    </span>
                  </div>

                  <div className="text-[13px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                    {fund.manager_name || "No manager on record (S1 Insufficient)"}
                  </div>

                  {managerProfile && (
                    <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] space-y-1">
                      {managerProfile.bio_summary && <p className="leading-relaxed">{managerProfile.bio_summary}</p>}
                      {managerProfile.education && (
                        <div className="pt-1">
                          <span className="px-1.5 py-0.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] text-[10px] font-mono">
                            {managerProfile.education}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PMS Cross-Matches */}
                  {pmsMatches.length > 0 && (
                    <div className="pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644] space-y-1">
                      <div className="text-[10px] font-semibold text-[#0176D3] dark:text-[#1B96FF] uppercase">
                        Matched PMS Strategies ({pmsMatches.length})
                      </div>
                      <div className="space-y-1">
                        {pmsMatches.map((pm, idx) => (
                          <div key={idx} className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] flex items-center justify-between text-[11px]">
                            <div>
                              <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">{pm.strategy_name}</span>
                              <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] block">{pm.provider}</span>
                            </div>
                            <div className="text-right tabular-nums text-[10px]">
                              {pm.return_1y !== null && pm.return_1y !== undefined && (
                                <div>1Y: <SignedValue value={pm.return_1y} isPercent /></div>
                              )}
                              {pm.aum_crore && <div>₹{pm.aum_crore} Cr</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Performance Horizon Comparison Table */}
                <div className="rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] overflow-hidden">
                  <div className="p-2 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Multi-Horizon Returns vs Benchmark &amp; Category
                  </div>
                  <table className="terminal-table text-[11px]">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th className="text-right">Fund</th>
                        <th className="text-right">Benchmark</th>
                        <th className="text-right">Cat Median</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>1Y Return</td>
                        <td className="text-right">
                          <SignedValue value={fund.ret_1y ? fund.ret_1y * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.bench_1y ? fund.bench_1y * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.cat_avg_1y ? fund.cat_avg_1y * 100 : null} isPercent />
                        </td>
                      </tr>
                      <tr>
                        <td>3Y CAGR</td>
                        <td className="text-right">
                          <SignedValue value={fund.cagr_3y ? fund.cagr_3y * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.bench_3y ? fund.bench_3y * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.cat_avg_3y ? fund.cat_avg_3y * 100 : null} isPercent />
                        </td>
                      </tr>
                      <tr>
                        <td>5Y CAGR</td>
                        <td className="text-right">
                          <SignedValue value={fund.cagr_5y ? fund.cagr_5y * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.bench_5y ? fund.bench_5y * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.cat_avg_5y ? fund.cat_avg_5y * 100 : null} isPercent />
                        </td>
                      </tr>
                      <tr>
                        <td>Since Inception</td>
                        <td className="text-right">
                          <SignedValue value={fund.cagr_si ? fund.cagr_si * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.bench_si ? fund.bench_si * 100 : null} isPercent />
                        </td>
                        <td className="text-right">
                          <SignedValue value={fund.cat_avg_si ? fund.cat_avg_si * 100 : null} isPercent />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Risk and Capture Ratios Grid */}
                <div className="rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] p-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Risk &amp; Capture Profile (3Y Risk / 2Y Capture)
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Up Capture</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.up_capture ? `${fund.up_capture.toFixed(2)}x` : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Down Capture</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.down_capture ? `${fund.down_capture.toFixed(2)}x` : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Sharpe</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.sharpe ? fund.sharpe.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Sortino</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.sortino ? fund.sortino.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Jensen Alpha</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.alpha !== null && fund.alpha !== undefined ? (
                          <SignedValue value={fund.alpha * 100} isPercent />
                        ) : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Beta</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.beta ? fund.beta.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Info Ratio</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.information_ratio ? fund.information_ratio.toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className="p-1.5 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644]">
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Max Drawdown</div>
                      <div className="font-semibold text-[#181818] dark:text-[#EDF2F7] tabular-nums">
                        {fund.max_drawdown ? (
                          <SignedValue value={fund.max_drawdown * 100} isPercent />
                        ) : "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Research Notes */}
                <div className="rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] p-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Analyst Notes ({notes.length})
                  </div>
                  {notes.length === 0 ? (
                    <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] italic">
                      No analyst notes logged for this scheme yet.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {notes.map((n) => (
                        <div key={n.id} className="p-2 rounded bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] text-[11px] space-y-0.5">
                          <div className="font-medium text-[#181818] dark:text-[#EDF2F7]">{n.title}</div>
                          <p className="text-[#706E6B] dark:text-[#A8B4C4] leading-relaxed">{n.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
