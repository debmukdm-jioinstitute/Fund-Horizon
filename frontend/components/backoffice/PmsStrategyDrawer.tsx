"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PmsStrategyItem } from "@/lib/backoffice";
import SignedValue from "@/components/terminal/SignedValue";

interface PmsStrategyDrawerProps {
  strategy: PmsStrategyItem | null;
  onClose: () => void;
}

export default function PmsStrategyDrawer({ strategy, onClose }: PmsStrategyDrawerProps) {
  const [copied, setCopied] = useState(false);

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
      `Provider: ${strategy.provider_name}`,
      `Approach: ${strategy.investment_approach || strategy.strategy_type || "Equity"}`,
      `Service Type: ${strategy.service_type || "Discretionary"}`,
      `Benchmark: ${strategy.benchmark_name || "NIFTY 50 TRI"}`,
      `AUM: ${strategy.aum_crore ? `₹${strategy.aum_crore} Cr` : "N/A"}`,
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
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-4 sm:pl-10">
        <div
          className="w-screen max-w-lg bg-[#FFFFFF] dark:bg-[#10151C] border-l border-[#E4E9EF] dark:border-[#2B3644] flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-start justify-between gap-3 bg-[#F7F9FB] dark:bg-[#171E27]">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#006F64]/10 dark:bg-[#75E1CE]/15 text-[#006F64] dark:text-[#75E1CE] font-semibold border border-[#006F64]/20 dark:border-[#75E1CE]/30">
                  PMS Strategy
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#F0F3F6] dark:bg-[#202936] text-[#536176] dark:text-[#A8B4C4] border border-[#E4E9EF] dark:border-[#2B3644]">
                  {strategy.investment_approach || strategy.strategy_type || "Equity"}
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
                {strategy.provider_name}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7] p-1.5 rounded-md hover:bg-[#E4E9EF] dark:hover:bg-[#2B3644] transition shrink-0"
              aria-label="Close drawer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">AUM (₹ Crore)</div>
                <div className="text-[16px] font-mono font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {strategy.aum_crore ? `₹${strategy.aum_crore.toLocaleString()} Cr` : "Not Disclosed"}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Benchmark</div>
                <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5 truncate" title={strategy.benchmark_name || "NIFTY 50 TRI"}>
                  {strategy.benchmark_name || "NIFTY 50 TRI"}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Report As-Of Month</div>
                <div className="text-[13px] font-mono text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {strategy.report_month || "Latest Disclosure"}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Approach / IA ID</div>
                <div className="text-[13px] font-mono text-[#172033] dark:text-[#EDF2F7] mt-0.5 truncate" title={strategy.ia_id || "Registered"}>
                  {strategy.ia_id || "Registered Strategy"}
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
                  {horizons.map((h, i) => (
                    <tr key={i}>
                      <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{h.label}</td>
                      <td className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">{h.period}</td>
                      <td className="text-right font-medium">
                        <SignedValue value={h.val} unit="%" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

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
                href="https://www.apmiindia.org"
                target="_blank"
                rel="noreferrer"
                className="terminal-btn text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
              >
                APMI Portal ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
