"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getPmsStrategyDetail, PmsStrategyDetail, PmsStrategyItem } from "@/lib/backoffice";
import SignedValue from "@/components/terminal/SignedValue";
import { formatCrore } from "@/lib/terminal-format";
import { normalizeApproach, normalizeProviderName, pmsReturnWarning, sourceBenchmark } from "@/lib/backoffice-display";

interface PmsStrategyDrawerProps {
  strategy: PmsStrategyItem | null;
  onClose: () => void;
  onSelectSibling?: (iaId: string) => void;
}

export default function PmsStrategyDrawer({ strategy, onClose, onSelectSibling }: PmsStrategyDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<PmsStrategyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyView, setHistoryView] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const iaId = strategy?.ia_id;

  // Pull the full APMI profile (fees, manager, turnover, history) whenever a strategy is opened.
  useEffect(() => {
    setDetail(null);
    if (!iaId) return;
    let cancelled = false;
    setDetailLoading(true);
    getPmsStrategyDetail(iaId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => undefined)
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [iaId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (strategy) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [strategy, onClose]);

  if (!strategy) return null;

  async function handleCopy() {
    if (!strategy) return;
    const text = [
      `Strategy: ${strategy.strategy_name}`,
      `Provider: ${normalizeProviderName(strategy.provider_name) || strategy.provider_name}`,
      `Approach: ${normalizeApproach(strategy.investment_approach || strategy.strategy_type) || "—"}`,
      `Service Type: ${strategy.service_type || "—"}`,
      `Benchmark: ${sourceBenchmark(strategy.benchmark_name) || sourceBenchmark(detail?.profile?.benchmark) || "—"}`,
      `AUM: ${strategy.aum_crore != null ? formatCrore(strategy.aum_crore) : "N/A"}`,
      `1M Return: ${strategy.return_1m_pct !== undefined ? `${strategy.return_1m_pct}%` : "—"}`,
      `1Y Return: ${strategy.return_1y_pct !== undefined ? `${strategy.return_1y_pct}%` : "—"}`,
      `3Y CAGR: ${strategy.return_3y_cagr_pct !== undefined ? `${strategy.return_3y_cagr_pct}%` : "—"}`,
      `5Y CAGR: ${strategy.return_5y_cagr_pct !== undefined ? `${strategy.return_5y_cagr_pct}%` : "—"}`,
      `Since Inception: ${strategy.return_since_inception_pct !== undefined ? `${strategy.return_since_inception_pct}%` : "—"}`,
      `As Of: ${strategy.report_month || "Latest"}`,
      `Source: APMI Disclosure`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  // Quarterly = calendar quarter-ends, yearly = March (Indian FY end); the latest month is always kept.
  const historyRows = (detail?.history ?? []).filter((h, i) => {
    const m = Number(h.as_on.slice(5, 7));
    return i === 0 || historyView === "monthly" || (historyView === "quarterly" ? m % 3 === 0 : m === 3);
  });

  const horizons: { label: string; period: string; val: number | undefined }[] = [
    { label: "1 Month", period: "Short-term", val: strategy.return_1m_pct },
    { label: "3 Month", period: "Quarterly", val: strategy.return_3m_pct },
    { label: "6 Month", period: "Half-yearly", val: strategy.return_6m_pct },
    { label: "1 Year", period: "Annual", val: strategy.return_1y_pct },
    { label: "3 Year CAGR", period: "Annualized", val: strategy.return_3y_cagr_pct },
    { label: "5 Year CAGR", period: "Annualized", val: strategy.return_5y_cagr_pct },
    { label: "Since Inception", period: "Full Track Record", val: strategy.return_since_inception_pct },
  ];

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pms-drawer-title"
      onClick={onClose}
    >
      <div className="absolute inset-0 flex">
        <div
          className="w-full h-full bg-[#FFFFFF] dark:bg-[#10151C] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-start justify-between gap-3 bg-[#F7F9FB] dark:bg-[#171E27]">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                {strategy.is_fh_recommended && (
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#006F64] text-white font-semibold dark:bg-[#75E1CE] dark:text-[#10151C]">
                    ★ FH Recommended
                  </span>
                )}
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#006F64]/10 dark:bg-[#75E1CE]/15 text-[#006F64] dark:text-[#75E1CE] font-semibold border border-[#006F64]/20 dark:border-[#75E1CE]/30">
                  PMS Strategy
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#F0F3F6] dark:bg-[#202936] text-[#536176] dark:text-[#A8B4C4] border border-[#E4E9EF] dark:border-[#2B3644]">
                  {normalizeApproach(strategy.investment_approach || strategy.strategy_type) || "—"}
                </span>
                {strategy.service_type && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F0F3F6] dark:bg-[#202936] text-[#536176] dark:text-[#A8B4C4] border border-[#E4E9EF] dark:border-[#2B3644]">
                    {strategy.service_type}
                  </span>
                )}
              </div>
              <h2
                id="pms-drawer-title"
                className="text-[17px] sm:text-[19px] font-medium text-[#172033] dark:text-[#EDF2F7] leading-snug"
              >
                {strategy.strategy_name}
              </h2>
              <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5 font-medium">
                {normalizeProviderName(strategy.provider_name) || strategy.provider_name}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7] p-2.5 rounded-md hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition shrink-0"
              aria-label="Close"
            >
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-5xl p-4 sm:p-8 space-y-4">
            {pmsReturnWarning(strategy) && (
              <div className="terminal-panel p-3 text-[12px] text-[#B45309] dark:text-[#FBBF24] bg-[#B45309]/5 border border-[#B45309]/20">
                ⚠ {pmsReturnWarning(strategy)}
              </div>
            )}
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">AUM (₹ Crore)</div>
                <div className="text-[16px] font-mono font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {strategy.aum_crore != null ? formatCrore(strategy.aum_crore) : "Not Disclosed"}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Benchmark</div>
                <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5 truncate" title={sourceBenchmark(strategy.benchmark_name) || sourceBenchmark(detail?.profile?.benchmark) || "—"}>
                  {sourceBenchmark(strategy.benchmark_name) || sourceBenchmark(detail?.profile?.benchmark) || (detailLoading ? "Loading…" : "—")}
                </div>
              </div>

              {(strategy.min_investment || detail?.profile?.min_investment_inr !== undefined) && (
                <div className="terminal-panel p-3">
                  <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Min Investment</div>
                  <div className="text-[14px] font-mono font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                    {strategy.min_investment ?? `₹${(detail?.profile?.min_investment_inr ?? 0).toLocaleString("en-IN")}`}
                  </div>
                </div>
              )}

              {(strategy.inception_date || detail?.profile?.inception_date) && (
                <div className="terminal-panel p-3">
                  <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Inception Date</div>
                  <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                    {strategy.inception_date ?? detail?.profile?.inception_date}
                    {detail?.profile?.age ? ` · ${detail.profile.age}` : ""}
                  </div>
                </div>
              )}

              {(strategy.principal_officer || detail?.profile?.fund_manager) && (
                <div className="terminal-panel p-3 col-span-2">
                  <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">
                    {strategy.principal_officer ? "Principal Officer" : "Fund Manager"}
                  </div>
                  <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                    {strategy.principal_officer ?? detail?.profile?.fund_manager}
                    {!strategy.principal_officer && detail?.profile?.fund_manager_experience
                      ? ` (${detail.profile.fund_manager_experience} experience)`
                      : ""}
                  </div>
                </div>
              )}

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Report As-Of Month</div>
                <div className="text-[13px] font-mono text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {strategy.report_month || "Latest Disclosure"}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Approach / Category</div>
                <div className="text-[13px] font-mono text-[#172033] dark:text-[#EDF2F7] mt-0.5 truncate" title={normalizeApproach(strategy.investment_approach || strategy.strategy_type) || "—"}>
                  {normalizeApproach(strategy.investment_approach || strategy.strategy_type) || "—"}
                </div>
              </div>
            </div>

            {/* Performance Horizon Table */}
            <div className="terminal-panel overflow-hidden">
              <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between">
                <div className="text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                  Performance Horizons (APMI Standard)
                </div>
                <div className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">
                  XIRR / CAGR
                </div>
              </div>
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th>Horizon</th>
                    <th>Type</th>
                    <th className="text-right">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {horizons.map((h, i) => {
                    return (
                      <tr key={i}>
                        <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{h.label}</td>
                        <td className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">{h.period}</td>
                        <td className="text-right font-medium">
                          <SignedValue value={h.val} unit="%" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* APMI profile: fees, turnover, approach (fetched per strategy) */}
            {iaId && (
              <div className="terminal-panel overflow-hidden">
                <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                  Fees, Turnover &amp; Approach (APMI)
                </div>
                {detailLoading && !detail ? (
                  <div className="p-3 text-[12px] text-[#536176] dark:text-[#A8B4C4]">Loading APMI profile…</div>
                ) : detail?.profile ? (
                  <div className="p-3 space-y-3">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[12px]">
                      {[
                        ["Fixed fee", detail.profile.fixed_fees ?? "Not disclosed"],
                        ["Variable fee", detail.profile.variable_fees ?? "Not disclosed"],
                        ["Exit load", detail.profile.exit_load ?? "Not disclosed"],
                        [
                          `Turnover${detail.profile.turnover_as_on ? ` (${detail.profile.turnover_as_on})` : ""}`,
                          detail.profile.turnover_1y !== undefined
                            ? `1M ${detail.profile.turnover_1m ?? "—"}x · 1Y ${detail.profile.turnover_1y}x`
                            : "—",
                        ],
                      ].map(([k, v]) => (
                        <div key={k as string}>
                          <dt className="text-[#536176] dark:text-[#A8B4C4]">{k}</dt>
                          <dd className="font-medium text-[#172033] dark:text-[#EDF2F7] break-words">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {detail.profile.purpose && (
                      <div>
                        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium mb-0.5">Investment approach</div>
                        <p className="text-[12px] leading-relaxed text-[#172033] dark:text-[#EDF2F7] whitespace-pre-line">
                          {detail.profile.purpose}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                    {detail?.profile_error ?? "APMI profile is not available right now."}
                  </div>
                )}
              </div>
            )}

            {/* Monthly history from stored APMI snapshots */}
            {detail && detail.history.length > 0 && (
              <div className="terminal-panel overflow-hidden">
                <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center justify-between gap-2">
                  <span>History</span>
                  <div className="flex gap-1">
                    {(["monthly", "quarterly", "yearly"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setHistoryView(v)}
                        className={historyView === v ? "terminal-btn-accent text-[11px] py-0.5 px-2 capitalize" : "terminal-btn text-[11px] py-0.5 px-2 capitalize"}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="terminal-table">
                    <thead>
                      <tr>
                        <th>As on</th>
                        <th className="text-right">AUM (₹ Cr)</th>
                        <th className="text-right">1M</th>
                        <th className="text-right">3M</th>
                        <th className="text-right">6M</th>
                        <th className="text-right">1Y</th>
                        <th className="text-right">3Y</th>
                        <th className="text-right">5Y</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((h) => (
                        <tr key={h.as_on}>
                          <td className="font-mono">{h.as_on}</td>
                          <td className="text-right font-mono">{formatCrore(h.aum_crore)}</td>
                          <td className="text-right"><SignedValue value={h.r1m} unit="%" /></td>
                          <td className="text-right"><SignedValue value={h.r3m} unit="%" /></td>
                          <td className="text-right"><SignedValue value={h.r6m} unit="%" /></td>
                          <td className="text-right"><SignedValue value={h.r1y} unit="%" /></td>
                          <td className="text-right"><SignedValue value={h.r3y} unit="%" /></td>
                          <td className="text-right"><SignedValue value={h.r5y} unit="%" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Same provider's other strategies */}
            {detail && detail.siblings.length > 0 && (
              <div className="terminal-panel overflow-hidden">
                <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                  More from this provider ({detail.siblings.length})
                </div>
                <ul className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                  {detail.siblings.map((x, i) => (
                    <li key={`${x.ia_id ?? x.strategy_name}-${i}`}>
                      <button
                        type="button"
                        onClick={() => x.ia_id && onSelectSibling?.(x.ia_id)}
                        className="w-full text-left p-3 text-[12px] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition"
                      >
                        <div className="font-medium text-[#172033] dark:text-[#EDF2F7]">{x.strategy_name}</div>
                        <div className="font-mono text-[#536176] dark:text-[#A8B4C4]">
                          {formatCrore(x.aum_crore)} · 1Y{" "}
                          <SignedValue value={x.r1y} unit="%" /> · 3Y <SignedValue value={x.r3y} unit="%" />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Regulatory & Methodology Note */}
            <div className="terminal-panel p-3 bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[11px] text-[#536176] dark:text-[#A8B4C4] space-y-1 leading-relaxed">
              <div className="font-medium text-[#172033] dark:text-[#EDF2F7]">APMI Verification & Compliance</div>
              <div>
                Data sourced from official monthly Association of Portfolio Managers in India (APMI) performance disclosures under SEBI Portfolio Managers Regulations. Returns for &gt; 1 year are annualized (CAGR).
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="terminal-btn text-[12px] py-1.5 px-3 flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-[#087744] dark:text-[#58D6A0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Copied Strategy</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5 text-[#536176] dark:text-[#A8B4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy Details</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <Link
                href={`/backoffice/research?target_type=strategy&target_id=${encodeURIComponent(strategy.strategy_name)}`}
                className="terminal-btn text-[12px] py-1.5 px-3"
              >
                Research Note →
              </Link>
              <a
                href={detail?.source_url ?? "https://www.apmiindia.org"}
                target="_blank"
                rel="noreferrer"
                className="terminal-btn text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
              >
                APMI Portal ↗
              </a>
            </div>
          </div></div>
        </div>
      </div>
    </div>
  );
}
