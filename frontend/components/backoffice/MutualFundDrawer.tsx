"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { getMutualFundPerformance, getMfNavPairCheck, MfPerformance, MutualFundItem } from "@/lib/backoffice";
import SignedValue from "@/components/terminal/SignedValue";
import { formatISTDate, formatNumber } from "@/lib/terminal-format";
import { blankDash, classifyPlanOption, isNavStale } from "@/lib/backoffice-display";

interface MutualFundDrawerProps {
  scheme: MutualFundItem | null;
  onClose: () => void;
}

export default function MutualFundDrawer({ scheme, onClose }: MutualFundDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [perf, setPerf] = useState<MfPerformance | null | undefined>(undefined); // undefined = loading, null = no data
  const [view, setView] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [navPairSiblings, setNavPairSiblings] = useState<string[]>([]);
  const code = scheme?.scheme_code;

  useEffect(() => {
    setPerf(undefined);
    setNavPairSiblings([]);
    if (!code) return;
    let cancelled = false;
    getMutualFundPerformance(code)
      .then((p) => !cancelled && setPerf(p))
      .catch(() => !cancelled && setPerf(null));
    getMfNavPairCheck(200)
      .then((pairs) => {
        if (cancelled) return;
        const siblings = pairs
          .filter((p) => p.growth_code === code || p.idcw_code === code)
          .map((p) => (p.growth_code === code ? p.idcw_name : p.growth_name));
        setNavPairSiblings(siblings);
      })
      .catch(() => !cancelled && setNavPairSiblings([]));
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (scheme) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [scheme, onClose]);

  if (!scheme) return null;

  async function handleCopy() {
    if (!scheme) return;
    const classified = classifyPlanOption(scheme.scheme_name, scheme.plan, scheme.option);
    const nav = scheme.latest_nav != null && scheme.latest_nav !== "" ? `₹${formatNumber(Number(scheme.latest_nav), 4)}` : "—";
    const text = [
      `Scheme: ${scheme.scheme_name}`,
      `Code: ${scheme.scheme_code}`,
      `AMC: ${scheme.amc_name || "—"}`,
      `Category: ${scheme.category || "—"}`,
      `Plan: ${classified.plan || "—"}`,
      `Option: ${classified.option || "—"}`,
      `Latest NAV: ${nav}`,
      `NAV Date: ${formatISTDate(scheme.nav_date)}`,
      `TER: ${scheme.ter_pct ? `${Number(scheme.ter_pct).toFixed(2)}%` : "—"}`,
      `ISIN Growth: ${blankDash(scheme.isin_growth)}`,
      `ISIN Div: ${blankDash(scheme.isin_div)}`,
      `Source: AMFI NAVAll.txt Feed`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  const classified = classifyPlanOption(scheme.scheme_name, scheme.plan, scheme.option);
  const isDirect = classified.plan === "Direct";
  const stale = isNavStale(scheme.nav_date);
  const navLabel =
    scheme.latest_nav != null && scheme.latest_nav !== "" && Number.isFinite(Number(scheme.latest_nav))
      ? `₹${formatNumber(Number(scheme.latest_nav), 4)}`
      : "—";

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-drawer-title"
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
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#006F64]/10 dark:bg-[#75E1CE]/15 text-[#006F64] dark:text-[#75E1CE] font-semibold border border-[#006F64]/20 dark:border-[#75E1CE]/30">
                  Code: {scheme.scheme_code}
                </span>
                <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${
                  isDirect
                    ? "bg-[#2170E4]/10 text-[#2170E4] dark:text-[#68A2FF] border-[#2170E4]/20"
                    : "bg-[#087744]/10 text-[#087744] dark:text-[#58D6A0] border-[#087744]/20"
                }`}>
                  {classified.plan || "—"}
                  {classified.option ? ` · ${classified.option}` : ""}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F0F3F6] dark:bg-[#202936] text-[#536176] dark:text-[#A8B4C4] border border-[#E4E9EF] dark:border-[#2B3644]">
                  {scheme.category || "Mutual Fund"}
                </span>
                {stale && (
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#B45309]/10 text-[#B45309] dark:text-[#FBBF24] border border-[#B45309]/20">
                    Stale NAV
                  </span>
                )}
              </div>
              <h2
                id="mf-drawer-title"
                className="text-[17px] sm:text-[19px] font-medium text-[#172033] dark:text-[#EDF2F7] leading-snug"
              >
                {scheme.scheme_name}
              </h2>
              <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5 font-medium">
                {scheme.amc_name || "Asset Management Company"}
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
            {/* Key Metrics Cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Latest NAV</div>
                <div className="text-[17px] font-mono font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {navLabel}
                </div>
                {navPairSiblings.length > 0 && (
                  <div className="text-[10px] text-[#B45309] dark:text-[#FBBF24] font-mono mt-1" title={`Shares an identical NAV with: ${navPairSiblings.join("; ")}`}>
                    ⚠ Data check: identical NAV to {navPairSiblings.length === 1 ? "its Growth/IDCW pair" : `${navPairSiblings.length} sibling options`}
                  </div>
                )}
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">NAV Date</div>
                <div className="text-[13px] font-mono text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {formatISTDate(scheme.nav_date)}
                  {stale ? " · stale" : ""}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Expense Ratio (TER)</div>
                <div className="text-[16px] font-mono font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {scheme.ter_pct ? `${Number(scheme.ter_pct).toFixed(2)}%` : "—"}
                </div>
                {scheme.ter_as_of && (
                  <div className="text-[10px] text-[#536176] dark:text-[#A8B4C4] font-mono mt-0.5">
                    As of: {scheme.ter_as_of}
                  </div>
                )}
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">Plan Type</div>
                <div className="text-[14px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                  {classified.plan || "—"}
                  {classified.option ? ` · ${classified.option}` : ""}
                </div>
              </div>
            </div>

            {/* Performance & history from the AMFI + mfapi.in dataset */}
            {perf === undefined && <div className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Loading performance…</div>}
            {perf === null && (
              <div className="terminal-panel p-3 text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                No performance data for this scheme: the dataset covers Growth-option, open-ended schemes only.
              </div>
            )}
            {perf && (
              <>
                <div className="terminal-panel overflow-hidden">
                  <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7] flex justify-between">
                    <span>Performance Horizons</span>
                    <span className="font-normal text-[#536176] dark:text-[#A8B4C4]">as of {perf.as_of ?? "—"} · {perf.metrics.history_years ?? "—"} yrs of history</span>
                  </div>
                  <table className="terminal-table">
                    <thead>
                      <tr><th>Horizon</th><th className="text-right">Return</th></tr>
                    </thead>
                    <tbody>
                      {([["1 Month", "ret_1m"], ["3 Month", "ret_3m"], ["6 Month", "ret_6m"], ["1 Year", "ret_1y"], ["3 Year CAGR", "cagr_3y"], ["5 Year CAGR", "cagr_5y"], ["7 Year CAGR", "cagr_7y"], ["10 Year CAGR", "cagr_10y"], ["Since Inception CAGR", "cagr_since_inception"]] as const).map(([label, key]) => (
                        <tr key={key}>
                          <td className="font-medium">{label}</td>
                          <td className="text-right"><SignedValue value={perf.metrics[key] as number | undefined} unit="%" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {([["Volatility (3Y)", "vol_3y", "%"], ["Max Drawdown (3Y)", "max_drawdown_3y", "%"], ["Max Drawdown (All)", "max_drawdown_all", "%"], ["Sharpe (3Y)", "sharpe_3y", ""], ["Sortino (3Y)", "sortino_3y", ""]] as const).map(([label, key, unit]) => (
                    <div key={key} className="terminal-panel p-3">
                      <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-medium">{label}</div>
                      <div className="text-[14px] font-mono font-medium text-[#172033] dark:text-[#EDF2F7] mt-0.5">
                        {typeof perf.metrics[key] === "number" ? `${(perf.metrics[key] as number).toFixed(2)}${unit}` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="terminal-panel overflow-hidden">
                  <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center justify-between gap-2">
                    <span>NAV History</span>
                    <div className="flex gap-1">
                      {(["monthly", "quarterly", "yearly"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setView(v)}
                          className={view === v ? "terminal-btn-accent text-[11px] py-0.5 px-2 capitalize" : "terminal-btn text-[11px] py-0.5 px-2 capitalize"}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[50vh]">
                    <table className="terminal-table">
                      <thead>
                        <tr>
                          <th>As on</th>
                          <th className="text-right">NAV (₹)</th>
                          <th className="text-right">1M</th>
                          <th className="text-right">1Y</th>
                          <th className="text-right">3Y</th>
                          <th className="text-right">5Y</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perf.history
                          .filter((h, i) => {
                            const m = Number(h.date.slice(5, 7));
                            return i === 0 || view === "monthly" || (view === "quarterly" ? m % 3 === 0 : m === 3);
                          })
                          .map((h) => (
                            <tr key={h.date}>
                              <td className="font-mono">{formatISTDate(h.date)}</td>
                              <td className="text-right font-mono">{h.nav?.toFixed(4) ?? "—"}</td>
                              <td className="text-right"><SignedValue value={h.r1m} unit="%" /></td>
                              <td className="text-right"><SignedValue value={h.r1y} unit="%" /></td>
                              <td className="text-right"><SignedValue value={h.r3y} unit="%" /></td>
                              <td className="text-right"><SignedValue value={h.r5y} unit="%" /></td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* ISIN & Identification Table */}
            <div className="terminal-panel overflow-hidden">
              <div className="p-3 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                Identification &amp; Settlement Details
              </div>
              <div className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644] text-[12px]">
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">AMFI Scheme Code</span>
                  <span className="font-mono font-medium text-[#172033] dark:text-[#EDF2F7]">{scheme.scheme_code}</span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">ISIN Growth</span>
                  <span className="font-mono font-medium text-[#172033] dark:text-[#EDF2F7]">
                    {blankDash(scheme.isin_growth)}
                  </span>
                </div>
                {scheme.isin_div && (
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-[#536176] dark:text-[#A8B4C4]">ISIN Dividend / IDCW</span>
                    <span className="font-mono font-medium text-[#172033] dark:text-[#EDF2F7]">
                      {scheme.isin_div}
                    </span>
                  </div>
                )}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">Fund House (AMC)</span>
                  <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">{scheme.amc_name || "—"}</span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">SEBI Categorization</span>
                  <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">{scheme.category || "—"}</span>
                </div>
              </div>
            </div>

            {/* Quick Link Cards */}
            <div className="terminal-panel p-3.5 space-y-2.5">
              <div className="text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                Analytics &amp; External Integrations
              </div>

              <div className="space-y-1.5">
                <a
                  href={`/funds/${scheme.scheme_code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64] dark:hover:border-[#75E1CE] transition text-[12px] group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[#006F64] dark:text-[#75E1CE] font-medium">Scheme Analytics Page</span>
                    <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4]">(Regular / Retail)</span>
                  </div>
                  <span className="text-[#536176] dark:text-[#A8B4C4] group-hover:text-[#006F64] dark:group-hover:text-[#75E1CE]">↗</span>
                </a>

                <a
                  href={`https://api.mfapi.in/mf/${scheme.scheme_code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64] dark:hover:border-[#75E1CE] transition text-[12px] group"
                >
                  <span className="text-[#172033] dark:text-[#EDF2F7]">MFAPI Historical NAV JSON Feed</span>
                  <span className="text-[#536176] dark:text-[#A8B4C4] group-hover:text-[#006F64] dark:group-hover:text-[#75E1CE]">↗</span>
                </a>

                <a
                  href={`https://www.google.com/finance/quote/${encodeURIComponent(scheme.scheme_name)}:MUTF_IN`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64] dark:hover:border-[#75E1CE] transition text-[12px] group"
                >
                  <span className="text-[#172033] dark:text-[#EDF2F7]">Search on Google Finance</span>
                  <span className="text-[#536176] dark:text-[#A8B4C4] group-hover:text-[#006F64] dark:group-hover:text-[#75E1CE]">↗</span>
                </a>
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
                  <span>Copied Scheme</span>
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
                href={`/backoffice/research?target_type=mutual_fund&target_id=${encodeURIComponent(scheme.scheme_code)}`}
                className="terminal-btn text-[12px] py-1.5 px-3"
              >
                Research Note →
              </Link>
              <a
                href={`/funds/${scheme.scheme_code}`}
                target="_blank"
                rel="noreferrer"
                className="terminal-btn text-[12px] py-1.5 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
              >
                Open Analytics ↗
              </a>
            </div>
          </div></div>
        </div>
      </div>
    </div>
  );
}
