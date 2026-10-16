"use client";

import React, { useEffect, useState } from "react";
import { PmsLogo } from "@/components/BrandLogo";
import { getPmsManager, PmsStrategyItem } from "@/lib/backoffice";
import {
  findManagerProfile,
  getManagerStrategies,
  PmsManagerProfile,
} from "@/lib/pms-managers";
import SignedValue from "@/components/terminal/SignedValue";

interface PmsManagerDrawerProps {
  managerName: string | null;
  /** Firm of the strategy the manager was opened from; lets the drawer look the manager up when the list has no manager names. */
  provider?: string | null;
  strategies: PmsStrategyItem[];
  onClose: () => void;
  onSelectStrategy: (s: PmsStrategyItem) => void;
}

export function initialsOf(name: string): string {
  const parts = name.replace(/^(mr|mrs|ms|dr)\.?\s+/i, "").trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_BG = [
  "bg-[#0176D3] dark:bg-[#1B96FF]",
  "bg-[#1D4ED8] dark:bg-[#93C5FD]",
  "bg-[#7C3AED] dark:bg-[#C4B5FD]",
  "bg-[#B45309] dark:bg-[#FCD34D]",
  "bg-[#0E7490] dark:bg-[#67E8F9]",
  "bg-[#BE123C] dark:bg-[#FDA4AF]",
];

export function avatarBgFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}

export default function PmsManagerDrawer({
  managerName,
  provider,
  strategies,
  onClose,
  onSelectStrategy,
}: PmsManagerDrawerProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (managerName) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [managerName, onClose]);

  const [remote, setRemote] = useState<{ experience?: string; strategies: PmsStrategyItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setRemote(null);
    if (!managerName || !provider) return;
    let cancelled = false;
    setLoading(true);
    getPmsManager(managerName, provider)
      .then((r) => !cancelled && setRemote(r))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [managerName, provider]);

  if (!managerName) return null;

  const profile: PmsManagerProfile | null = findManagerProfile(managerName);
  const local = getManagerStrategies(managerName, strategies);
  const seen = new Set(local.map((s) => s.ia_id));
  const managed = [...local, ...(remote?.strategies ?? []).filter((s) => !seen.has(s.ia_id))];
  const totalAum = managed.reduce((sum, s) => sum + (s.aum_crore || 0), 0);
  const displayName = profile ? profile.name : managerName;
  const asOf = managed.find((s) => s.report_month)?.report_month;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pms-manager-title"
      onClick={onClose}
    >
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-4 sm:pl-10">
        <div
          className="w-screen max-w-xl bg-[#FFFFFF] dark:bg-[#10151C] border-l border-[#E5E5E5] dark:border-[#2B3644] flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-[#E5E5E5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white dark:text-[#10151C] text-[16px] font-semibold shrink-0 ${avatarBgFor(displayName)}`}
                  aria-hidden="true"
                >
                  {initialsOf(displayName)}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#0176D3]/10 dark:bg-[#1B96FF]/15 text-[#0176D3] dark:text-[#1B96FF] font-semibold border border-[#0176D3]/20 dark:border-[#1B96FF]/30">
                      Principal Officer
                    </span>
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#F0F3F6] dark:bg-[#202936] text-[#706E6B] dark:text-[#A8B4C4] border border-[#E5E5E5] dark:border-[#2B3644]">
                      PMS
                    </span>
                  </div>
                  <h2
                    id="pms-manager-title"
                    className="text-[17px] sm:text-[19px] font-medium text-[#181818] dark:text-[#EDF2F7] leading-snug"
                  >
                    {displayName}
                  </h2>
                  <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-1 font-medium flex items-center gap-2">
                    {profile && <PmsLogo firm={profile.firm} className="h-6 min-w-6" />}
                    {profile ? `${profile.current_title} · ${profile.firm}` : "Principal Officer"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7] p-1.5 rounded-md hover:bg-[#E5E5E5] dark:hover:bg-[#2B3644] transition shrink-0"
                aria-label="Close drawer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Key figures */}
            <div className="grid grid-cols-3 gap-2.5 mt-4">
              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Strategies managed</div>
                <div className="text-[18px] font-mono font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {managed.length}
                </div>
              </div>
              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Combined AUM</div>
                <div className="text-[18px] font-mono font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {totalAum > 0 ? `₹${totalAum.toLocaleString("en-IN")} Cr` : "—"}
                </div>
              </div>
              <div className="terminal-panel p-3">
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">Experience</div>
                <div className="text-[18px] font-mono font-medium text-[#181818] dark:text-[#EDF2F7] mt-0.5">
                  {profile?.years_experience ? `${profile.years_experience} yrs` : remote?.experience || "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {/* Profile / bio */}
            <div className="terminal-panel p-4">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mb-2">
                Profile
              </div>
              {profile ? (
                <div className="space-y-3 text-[13px] text-[#3B4757] dark:text-[#C6D0DD] leading-relaxed">
                  <p>{profile.bio_summary}</p>
                  <div>
                    <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">Education: </span>
                    {profile.education}
                  </div>
                  {profile.investment_philosophy && (
                    <div>
                      <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">Investment approach: </span>
                      {profile.investment_philosophy}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-[#706E6B] dark:text-[#A8B4C4] leading-relaxed">
                  A compiled profile for this manager is not available yet. The strategies
                  and figures below are drawn from APMI disclosures.
                </p>
              )}
            </div>

            {/* Career timeline */}
            {profile && profile.career_history.length > 0 && (
              <div className="terminal-panel p-4">
                <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mb-2">
                  Career
                </div>
                <ol className="space-y-2.5">
                  {profile.career_history.map((c, i) => (
                    <li key={i} className="flex gap-3 text-[13px]">
                      <span className="shrink-0 w-24 font-mono text-[11px] text-[#706E6B] dark:text-[#A8B4C4] pt-0.5">
                        {c.period}
                      </span>
                      <span className="text-[#3B4757] dark:text-[#C6D0DD] leading-snug">
                        <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">{c.role}</span>
                        <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {c.organization}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Strategies managed */}
            <div className="terminal-panel overflow-hidden">
              <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] flex items-center justify-between">
                <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                  Strategies managed ({managed.length})
                </div>
                <div className="text-[11px] font-mono text-[#706E6B] dark:text-[#A8B4C4]">
                  {asOf ? `As of ${asOf}` : "APMI disclosures"}
                </div>
              </div>
              {managed.length === 0 ? (
                <p className="p-4 text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">
                  {loading ? "Looking up this manager's strategies…" : "No strategies found for this manager in the current dataset."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="terminal-table">
                    <thead>
                      <tr>
                        <th>Strategy</th>
                        <th className="text-right">AUM (₹ Cr)</th>
                        <th className="text-right">1Y</th>
                        <th className="text-right">3Y CAGR</th>
                        <th className="text-right">5Y CAGR</th>
                        <th className="text-right">Since inception</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managed.map((s, i) => (
                        <tr key={i}>
                          <td>
                            <button
                              type="button"
                              onClick={() => onSelectStrategy(s)}
                              className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline cursor-pointer leading-snug"
                            >
                              {s.strategy_name}
                            </button>
                            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
                              {s.investment_approach || s.strategy_type || "—"}
                            </div>
                          </td>
                          <td className="text-right font-mono">
                            {s.aum_crore ? `₹${s.aum_crore.toLocaleString("en-IN")}` : "—"}
                          </td>
                          <td className="text-right">
                            <SignedValue value={s.return_1y_pct} unit="%" />
                          </td>
                          <td className="text-right">
                            <SignedValue value={s.return_3y_cagr_pct} unit="%" />
                          </td>
                          <td className="text-right">
                            <SignedValue value={s.return_5y_cagr_pct} unit="%" />
                          </td>
                          <td className="text-right">
                            <SignedValue value={s.return_since_inception_pct} unit="%" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="px-3 py-2 text-[11px] text-[#706E6B] dark:text-[#A8B4C4] border-t border-[#E5E5E5] dark:border-[#2B3644]">
                Select a strategy to open its full factsheet and return history.
              </p>
            </div>

            {/* Disclaimer */}
            <div className="terminal-panel p-3 bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] text-[11px] text-[#706E6B] dark:text-[#A8B4C4] space-y-1 leading-relaxed">
              <div className="font-medium text-[#181818] dark:text-[#EDF2F7]">Data &amp; methodology note</div>
              <div>
                Strategy figures are from official monthly APMI performance disclosures under
                SEBI Portfolio Managers Regulations. Returns over 1 year are annualised.
                Past performance does not indicate future returns.
              </div>
            </div>

            {/* Sources */}
            {profile && profile.sources.length > 0 && (
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">Sources: </span>
                {profile.sources.map((src, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[#181818] dark:hover:text-[#EDF2F7]"
                    >
                      {src.label}
                    </a>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
