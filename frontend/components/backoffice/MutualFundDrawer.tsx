"use client";

import React, { useEffect, useState } from "react";
import { useRecommended } from "@/lib/recommended";
import Link from "next/link";
import AddToWatchlist from "./AddToWatchlist";
import { getMutualFundPerformance, getMfNavPairCheck, getMfManager, getMfResearchDetail, addMfShortlist, MfManagerInfo, MfPerformance, MfResearchDetail, MutualFundItem } from "@/lib/backoffice";
import SignedValue from "@/components/terminal/SignedValue";
import MfManagerDrawer from "@/components/backoffice/MfManagerDrawer";
import FactsheetList from "@/components/backoffice/FactsheetList";
import { AmcLogo } from "@/components/BrandLogo";
import FundQuartile from "./FundQuartile";
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
  const [manager, setManager] = useState<MfManagerInfo | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [researchDetail, setResearchDetail] = useState<MfResearchDetail | null>(null);
  const [shortlistMsg, setShortlistMsg] = useState("");
  // In-page reason form, never window.prompt (auto-dismissed by automated
  // browsers, which silently aborted every dialog add in the V1 live check).
  const [shortlistForm, setShortlistForm] = useState(false);
  const [shortlistReason, setShortlistReason] = useState("");
  const rec = useRecommended();
  const code = scheme?.scheme_code;

  useEffect(() => {
    setPerf(undefined);
    setNavPairSiblings([]);
    setManager(null);
    setManagerOpen(false);
    setResearchDetail(null);
    setShortlistMsg("");
    setShortlistForm(false);
    setShortlistReason("");
    if (!code) return;
    let cancelled = false;
    getMfManager(code)
      .then((m) => !cancelled && setManager(m))
      .catch(() => !cancelled && setManager(null));
    getMfResearchDetail(code)
      .then((d) => !cancelled && setResearchDetail(d))
      .catch(() => !cancelled && setResearchDetail(null));
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
      if (e.key === "Escape" && !managerOpen) onClose();
    }
    if (scheme) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [scheme, onClose, managerOpen]);

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
          <div className="p-4 sm:p-5 border-b border-[#E5E5E5] dark:border-[#2B3644] flex items-start justify-between gap-3 bg-[#F3F3F3] dark:bg-[#171E27]">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#0176D3]/10 dark:bg-[#1B96FF]/15 text-[#0176D3] dark:text-[#1B96FF] font-semibold border border-[#0176D3]/20 dark:border-[#1B96FF]/30">
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
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F0F3F6] dark:bg-[#202936] text-[#706E6B] dark:text-[#A8B4C4] border border-[#E5E5E5] dark:border-[#2B3644]">
                  {scheme.category || "Mutual Fund"}
                </span>
                {stale && (
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#B45309]/10 text-[#B45309] dark:text-[#FBBF24] border border-[#B45309]/20">
                    Stale NAV
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => rec.toggleMf(scheme.scheme_code, scheme.scheme_name)}
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                    rec.isMfRecommended(scheme.scheme_code)
                      ? "bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-semibold"
                      : "bg-[#F3F3F3] dark:bg-[#171E27] text-[#706E6B] dark:text-[#A8B4C4] border-[#E5E5E5] dark:border-[#2B3644] hover:border-[#0176D3]"
                  }`}
                  title="Click to toggle FH Recommended status"
                >
                  ★ {rec.isMfRecommended(scheme.scheme_code) ? "FH Recommended" : "Mark Recommended"}
                </button>
              </div>
              <h2
                id="mf-drawer-title"
                className="text-[17px] sm:text-[19px] font-medium text-[#181818] dark:text-[#EDF2F7] leading-snug"
              >
                {scheme.scheme_name}
              </h2>
              <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-1 font-medium flex items-center gap-2">
                {scheme.amc_name && <AmcLogo amc={scheme.amc_name} className="h-7 min-w-7" />}
                {scheme.amc_name || "Asset Management Company"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7] p-2.5 rounded-md hover:bg-[#E5E5E5] dark:hover:bg-[#2B3644] transition shrink-0"
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
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Latest NAV</div>
                <div className="text-[17px] font-mono font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {navLabel}
                </div>
                {navPairSiblings.length > 0 && (
                  <div className="text-[10px] text-[#B45309] dark:text-[#FBBF24] font-mono mt-1" title={`Shares an identical NAV with: ${navPairSiblings.join("; ")}`}>
                    ⚠ Data check: identical NAV to {navPairSiblings.length === 1 ? "its Growth/IDCW pair" : `${navPairSiblings.length} sibling options`}
                  </div>
                )}
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">NAV Date</div>
                <div className="text-[13px] font-mono text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {formatISTDate(scheme.nav_date)}
                  {stale ? " · stale" : ""}
                </div>
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Expense Ratio (TER)</div>
                <div className="text-[16px] font-mono font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {scheme.ter_pct ? `${Number(scheme.ter_pct).toFixed(2)}%` : "—"}
                </div>
                {scheme.ter_as_of && (
                  <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] font-mono mt-0.5">
                    As of: {scheme.ter_as_of}
                  </div>
                )}
              </div>

              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Plan Type</div>
                <div className="text-[14px] font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {classified.plan || "—"}
                  {classified.option ? ` · ${classified.option}` : ""}
                </div>
              </div>

              <div className="terminal-panel p-3 col-span-2">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Fund Manager</div>
                {manager ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setManagerOpen(true)}
                      className="text-[14px] font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline mt-0.5 text-left"
                    >
                      {manager.manager_name}
                    </button>
                    {manager.manager_start && (
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] font-mono mt-0.5">
                        Since {manager.manager_start}
                        {manager.tenure_years != null ? ` · ${manager.tenure_years} yrs` : ""}
                      </div>
                    )}
                    <Link
                      href={`/backoffice/mutual-funds/research?tab=managers&manager=${encodeURIComponent(manager.manager_name)}`}
                      className="mt-1 inline-block text-[12px] text-[#0176D3] dark:text-[#1B96FF] hover:underline"
                    >
                      View all funds by this manager →
                    </Link>
                  </>
                ) : (
                  <div className="text-[13px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">Not on file</div>
                )}
              </div>
            </div>

            {/* Performance & history from the AMFI + mfapi.in dataset */}
            {perf === undefined && <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Loading performance…</div>}
            {perf === null && (
              <div className="terminal-panel p-3 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                No performance data for this scheme: the dataset covers Growth-option, open-ended schemes only.
              </div>
            )}
            {perf && (
              <>
                <div className="terminal-panel overflow-hidden">
                  <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] flex justify-between">
                    <span>Performance Horizons</span>
                    <span className="font-normal text-[#706E6B] dark:text-[#A8B4C4]">as of {perf.as_of ?? "—"} · {perf.metrics.history_years ?? "—"} yrs of history</span>
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
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">{label}</div>
                      <div className="text-[14px] font-mono font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                        {typeof perf.metrics[key] === "number" ? `${(perf.metrics[key] as number).toFixed(2)}${unit}` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="terminal-panel overflow-hidden">
                  <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] flex items-center justify-between gap-2">
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

            <FactsheetList kind="mf" id={scheme.scheme_code} />

            {/* ISIN & Identification Table */}
            <div className="terminal-panel overflow-hidden">
              <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                Identification &amp; Settlement Details
              </div>
              <div className="divide-y divide-[#E5E5E5] dark:divide-[#2B3644] text-[12px]">
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#706E6B] dark:text-[#A8B4C4]">AMFI Scheme Code</span>
                  <span className="font-mono font-medium text-[#181818] dark:text-[#EDF2F7]">{scheme.scheme_code}</span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#706E6B] dark:text-[#A8B4C4]">ISIN Growth</span>
                  <span className="font-mono font-medium text-[#181818] dark:text-[#EDF2F7]">
                    {blankDash(scheme.isin_growth)}
                  </span>
                </div>
                {scheme.isin_div && (
                  <div className="p-3 flex items-center justify-between">
                    <span className="text-[#706E6B] dark:text-[#A8B4C4]">ISIN Dividend / IDCW</span>
                    <span className="font-mono font-medium text-[#181818] dark:text-[#EDF2F7]">
                      {scheme.isin_div}
                    </span>
                  </div>
                )}
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#706E6B] dark:text-[#A8B4C4]">Fund House (AMC)</span>
                  <span className="flex items-center gap-2 font-medium text-[#181818] dark:text-[#EDF2F7]">
                    {scheme.amc_name && <AmcLogo amc={scheme.amc_name} className="h-6 min-w-6" />}
                    {scheme.amc_name || "—"}
                  </span>
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-[#706E6B] dark:text-[#A8B4C4]">SEBI Categorization</span>
                  <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">{scheme.category || "—"}</span>
                </div>
              </div>
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <FundQuartile name={scheme.scheme_name} cat={scheme.cat_key ?? scheme.category} plan={classified.plan} />
            </div>

            {/* MF Research blocks (additive): consistency, peer percentiles, computed quartile history. */}
            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Consistency — how steady the fund has been</div>
              {researchDetail ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Rolling 1Y win % (vs category median, last 5Y, monthly windows)", researchDetail.roll_win_pct, "%"],
                    ["Calendar years in top quartile (completed years)", researchDetail.cal_topq_years, ""],
                    ["Calendar win % (vs category median, completed years)", researchDetail.cal_win_pct, "%"],
                    ["Downside deviation 3Y (annualised, returns below 0)", researchDetail.downside_dev_3y, "%"],
                    ["SIP CAGR 3Y (monthly instalment, month-end NAV)", researchDetail.sip_cagr_3y, "%"],
                    ["SIP CAGR 5Y (monthly instalment, month-end NAV)", researchDetail.sip_cagr_5y, "%"],
                    ["Calmar 3Y (3Y CAGR divided by 3Y max drawdown)", researchDetail.calmar_3y, ""],
                  ] as const).map(([label, v, unit]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? `${v.toFixed(2)}${unit}` : "—"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Consistency data is not available for this scheme.</div>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Peer percentiles — better than X% of category + plan peers</div>
              {researchDetail ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Sharpe 3Y", researchDetail.pct_sharpe_3y],
                    ["Sortino 3Y", researchDetail.pct_sortino_3y],
                    ["Alpha 3Y (vs category median)", researchDetail.pct_alpha_3y],
                    ["Volatility 3Y", researchDetail.pct_vol_3y],
                    ["Max drawdown 3Y", researchDetail.pct_max_dd_3y],
                    ["1Y return", researchDetail.pct_ret_1y],
                    ["3Y CAGR", researchDetail.pct_cagr_3y],
                    ["5Y CAGR", researchDetail.pct_cagr_5y],
                  ] as const).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? `Better than ${v.toFixed(0)}% of category + plan peers` : "—"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Peer percentiles are not available for this scheme.</div>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Quartile history (computed, in-house)</div>
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                Computed quartiles rank the fund against its category + plan peers. This is separate from the Advisorkhoj quartile section above, which uses Advisorkhoj figures.
              </p>
              {researchDetail ? (
                <div className="flex flex-wrap gap-2 text-[12px]">
                  {([
                    ["1Y", researchDetail.quartile_1y],
                    ["2Y", researchDetail.quartile_2y],
                    ["3Y", researchDetail.quartile_3y],
                    ["5Y", researchDetail.quartile_5y],
                  ] as const).map(([label, v]) => (
                    <span key={label} className="rounded border border-[#E5E5E5] dark:border-[#2B3644] px-2 py-1">
                      {label}: <span className="font-mono font-medium">{typeof v === "number" ? `Q${v} (computed)` : "—"}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Computed quartile history is not available for this scheme.</div>
              )}
              {researchDetail?.reason && (
                <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{researchDetail.reason}</p>
              )}
            </div>

            {/* MF Research V2 blocks: co-managers + changes + bio, operations, portfolio, vs-index. */}
            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Managers — everyone managing this scheme</div>
              {researchDetail?.co_managers ? (
                <div className="space-y-1.5 text-[12px]">
                  {researchDetail.co_managers.managers.length === 0 && (
                    <div className="text-[#706E6B] dark:text-[#A8B4C4]">No manager roster on file in the AMFI/SEBI reference snapshot for this scheme.</div>
                  )}
                  {researchDetail.co_managers.managers.map((m) => (
                    <div key={m.manager_id ?? m.name ?? "unknown"}>
                      <span className="font-medium">{m.name ?? "—"}</span>
                      {m.designation ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {m.designation}</span> : null}
                      {m.role_as_stated ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {m.role_as_stated}</span> : null}
                      {m.start_date ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · since {m.start_date}</span> : null}
                      {typeof m.tenure_years === "number" ? <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {m.tenure_years.toFixed(1)} yrs</span> : null}
                    </div>
                  ))}
                  {researchDetail.co_managers.shared_record_note && (
                    <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{researchDetail.co_managers.shared_record_note}</p>
                  )}
                  {researchDetail.manager_changes && researchDetail.manager_changes.length > 0 && (
                    <div>
                      <div className="font-medium mt-1">Manager changes on file</div>
                      {researchDetail.manager_changes.map((c, i) => (
                        <div key={i} className="text-[#706E6B] dark:text-[#A8B4C4]">
                          {c.effective_date ?? "—"}: {c.old_manager ?? "—"} → {c.new_manager ?? "—"}
                          {c.notice_url ? <> · <a href={c.notice_url} target="_blank" rel="noreferrer" className="text-[#0176D3] dark:text-[#1B96FF] hover:underline">AMC notice</a></> : null}
                        </div>
                      ))}
                    </div>
                  )}
                  {researchDetail.manager_bio && (
                    <div className="text-[#706E6B] dark:text-[#A8B4C4]">
                      {researchDetail.manager_bio.education ? <div>Education: {researchDetail.manager_bio.education}</div> : null}
                      {researchDetail.manager_bio.bio_summary ? <div>{researchDetail.manager_bio.bio_summary}</div> : null}
                      {researchDetail.manager_bio.sources && researchDetail.manager_bio.sources.length > 0 && (
                        <div>Sources: {researchDetail.manager_bio.sources.map((s) => s.label ?? s.url).filter(Boolean).join(" · ")}</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Manager roster is not available for this scheme.</div>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Operations — what it costs and how it works</div>
              {researchDetail?.operations?.available ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Launch date", researchDetail.operations.launch_date],
                    ["Exit load", researchDetail.operations.exit_load],
                    ["Minimum investment (Rs)", researchDetail.operations.minimum_investment_inr],
                    ["Riskometer", researchDetail.operations.riskometer],
                    ["Benchmark (total-return index, as named in the scheme document)", researchDetail.operations.benchmark_tri],
                    ["Expense ratio, Regular %", researchDetail.operations.ter_regular_pct],
                    ["Expense ratio, Direct %", researchDetail.operations.ter_direct_pct],
                    ["Expense ratio as of", researchDetail.operations.ter_date],
                  ] as const).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{v ?? "—"}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{researchDetail?.operations?.reason ?? "Operations data is not available for this scheme."}</div>
              )}
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                AUM history, investor flows, folio counts and expense-ratio history are not in the reference snapshot, so they are shown as unavailable rather than estimated.
                Past performance is not a guide to future returns.
              </p>
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Portfolio — holdings and sector</div>
              {researchDetail?.portfolio?.available ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                    {([
                      ["Holdings in snapshot", researchDetail.portfolio.summary?.holdings_count],
                      ["Top 10 holdings %", researchDetail.portfolio.summary?.top10_concentration_pct],
                      ["Largest holding %", researchDetail.portfolio.summary?.top_holding_pct],
                      ["Total weight %", researchDetail.portfolio.summary?.total_weight_pct],
                    ] as const).map(([label, v]) => (
                      <div key={label}>
                        <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                        <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? v.toFixed(2) : "—"}</div>
                      </div>
                    ))}
                  </div>
                  {researchDetail.portfolio.sectors && researchDetail.portfolio.sectors.length > 0 && (
                    <div className="text-[12px]">
                      <div className="font-medium mb-1">Sector mix (% of net assets, from the disclosure&apos;s own Industry column)</div>
                      {researchDetail.portfolio.sectors.map((s, i) => (
                        <div key={i} className="flex justify-between text-[#706E6B] dark:text-[#A8B4C4]">
                          <span>{s.sector ?? "Unclassified"}</span>
                          <span className="font-mono">{typeof s.weight_pct === "number" ? s.weight_pct.toFixed(2) : "—"}</span>
                        </div>
                      ))}
                      {typeof researchDetail.portfolio.unclassified_pct === "number" && researchDetail.portfolio.unclassified_pct !== 0 && (
                        <div className="flex justify-between text-[#706E6B] dark:text-[#A8B4C4]">
                          <span>Unclassified (cash and money-market rows, no sector)</span>
                          <span className="font-mono">{researchDetail.portfolio.unclassified_pct.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {researchDetail.portfolio.holdings && researchDetail.portfolio.holdings.length > 0 && (
                    <div className="text-[12px]">
                      <div className="font-medium mb-1">Largest holdings (top 10 of {researchDetail.portfolio.holdings.length})</div>
                      {researchDetail.portfolio.holdings.slice(0, 10).map((h, i) => (
                        <div key={i} className="flex justify-between gap-2 text-[#706E6B] dark:text-[#A8B4C4]">
                          <span className="truncate">{h.name ?? "—"}{h.sector ? ` · ${h.sector}` : ""}</span>
                          <span className="font-mono shrink-0">{typeof h.weight_pct === "number" ? h.weight_pct.toFixed(2) : "—"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                    As of {researchDetail.portfolio.as_of ?? "—"} · {researchDetail.portfolio.amc ?? ""} monthly portfolio disclosure.
                    {researchDetail.portfolio.coverage_pct != null && ` Partial: these holdings cover ${researchDetail.portfolio.coverage_pct}% of the fund (listed equity only).`}
                    {researchDetail.portfolio.note ? ` ${researchDetail.portfolio.note}` : ""}
                    {" "}Market-cap mix, turnover and style are not in the monthly disclosure, so they stay unavailable. Past performance is not a guide to future returns.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                    {researchDetail?.portfolio?.reason ?? "No portfolio holdings snapshot on file for this scheme, so holdings, sector percentages, market-cap mix, turnover, cash %, style and concentration are unavailable — never estimated."}
                  </p>
                  <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Source when ingested: AMFI monthly portfolio disclosures on each fund house&apos;s website.</p>
                </>
              )}
            </div>

            <div className="terminal-panel p-3.5 space-y-2">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">Benchmark — vs the real total-return index</div>
              {researchDetail?.index && researchDetail.index.alpha_3y_pct != null ? (
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  {([
                    ["Index", researchDetail.index.index_name],
                    ["Alpha 3Y % (vs index)", researchDetail.index.alpha_3y_pct],
                    ["Beta 3Y (vs index)", researchDetail.index.beta_3y],
                    ["Tracking error 3Y % (vs index)", researchDetail.index.tracking_error_3y_pct],
                    ["Information ratio 3Y (vs index)", researchDetail.index.information_ratio_3y],
                    ["Index 3Y return %", researchDetail.index.index_ret_3y_pct],
                    ["Fund 3Y return %", researchDetail.index.fund_ret_3y_pct],
                  ] as const).map(([label, v]) => (
                    <div key={label}>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{label}</div>
                      <div className="font-mono font-medium text-[13px]">{typeof v === "number" ? v.toFixed(2) : (v ?? "—")}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                  {researchDetail?.index?.reason ?? "No real total-return index series is stored for this fund's benchmark yet, so vs-index figures are empty. The one-pager's tracker-fund proxy line is kept with its disclosure until a real series is ingested."}
                </div>
              )}
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">These columns are kept separate from the vs-category-median columns above. Past performance is not a guide to future returns.</p>
            </div>

            {/* Quick Link Cards */}
            <div className="terminal-panel p-3.5 space-y-2.5">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                Analytics &amp; External Integrations
              </div>

              <div className="space-y-1.5">
                {perf?.publicPage && (
                <a
                  href={`/funds/${scheme.scheme_code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] hover:border-[#0176D3] dark:hover:border-[#1B96FF] transition text-[12px] group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[#0176D3] dark:text-[#1B96FF] font-medium">Scheme Analytics Page</span>
                    <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">(Regular / Retail)</span>
                  </div>
                  <span className="text-[#706E6B] dark:text-[#A8B4C4] group-hover:text-[#0176D3] dark:group-hover:text-[#1B96FF]">↗</span>
                </a>
                )}

                <a
                  href={`https://api.mfapi.in/mf/${scheme.scheme_code}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] hover:border-[#0176D3] dark:hover:border-[#1B96FF] transition text-[12px] group"
                >
                  <span className="text-[#181818] dark:text-[#EDF2F7]">MFAPI Historical NAV JSON Feed</span>
                  <span className="text-[#706E6B] dark:text-[#A8B4C4] group-hover:text-[#0176D3] dark:group-hover:text-[#1B96FF]">↗</span>
                </a>

                <a
                  // Google Finance quote URLs use Google's own fund ids (not derivable from AMFI data), so link a search that lands on the fund.
                  href={`https://www.google.com/search?q=${encodeURIComponent([scheme.scheme_name, classified.plan, classified.option, "NAV google finance"].filter(Boolean).join(" "))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-2 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] hover:border-[#0176D3] dark:hover:border-[#1B96FF] transition text-[12px] group"
                >
                  <span className="text-[#181818] dark:text-[#EDF2F7]">Search on Google Finance</span>
                  <span className="text-[#706E6B] dark:text-[#A8B4C4] group-hover:text-[#0176D3] dark:group-hover:text-[#1B96FF]">↗</span>
                </a>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-[#E5E5E5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27] flex flex-wrap items-center justify-between gap-2">
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
                  <svg className="w-3.5 h-3.5 text-[#706E6B] dark:text-[#A8B4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Copy Details</span>
                </>
              )}
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {!shortlistForm ? (
                <button
                  type="button"
                  onClick={() => { setShortlistReason(""); setShortlistForm(true); }}
                  className="terminal-btn text-[12px] py-1.5 px-3"
                >
                  Add to shortlist
                </button>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <input aria-label="Shortlist reason" value={shortlistReason}
                    onChange={(e) => setShortlistReason(e.target.value)}
                    placeholder="Why does this fund belong here? (optional)"
                    className="terminal-input text-[12px] py-1 px-2 w-64" />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await addMfShortlist(scheme.scheme_code, shortlistReason.trim() || undefined);
                        setShortlistMsg("Added to the shortlist.");
                        setShortlistForm(false);
                      } catch (e) {
                        setShortlistMsg(e instanceof Error ? e.message : "Could not add to the shortlist.");
                      }
                    }}
                    className="terminal-btn-accent text-[12px] py-1.5 px-3"
                  >
                    Add
                  </button>
                  <button type="button" onClick={() => setShortlistForm(false)}
                    className="terminal-btn text-[12px] py-1.5 px-3">
                    Cancel
                  </button>
                </span>
              )}
              <AddToWatchlist code={scheme.scheme_code} className="terminal-btn text-[12px] py-1.5 px-3" />
              {shortlistMsg && <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{shortlistMsg}</span>}
              <Link
                href={`/backoffice/research?target_type=mutual_fund&target_id=${encodeURIComponent(scheme.scheme_code)}`}
                className="terminal-btn text-[12px] py-1.5 px-3"
              >
                Research Note →
              </Link>
              {perf?.publicPage && (
              <a
                href={`/funds/${scheme.scheme_code}`}
                target="_blank"
                rel="noreferrer"
                className="terminal-btn text-[12px] py-1.5 px-3 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
              >
                Open Analytics ↗
              </a>
              )}
            </div>
          </div></div>
        </div>
      </div>
      {managerOpen && manager && <MfManagerDrawer manager={manager} onClose={() => setManagerOpen(false)} />}
    </div>
  );
}
