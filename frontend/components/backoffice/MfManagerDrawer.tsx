"use client";

import React, { useEffect, useState } from "react";
import { getMfManagerProfile, MfManagedFund, MfManagerInfo } from "@/lib/backoffice";
import { PmsManagerProfile } from "@/lib/pms-managers";
import { avatarBgFor, initialsOf } from "@/components/backoffice/PmsManagerDrawer";
import SignedValue from "@/components/terminal/SignedValue";

interface MfManagerDrawerProps {
  manager: MfManagerInfo;
  onClose: () => void;
}

export default function MfManagerDrawer({ manager, onClose }: MfManagerDrawerProps) {
  const [data, setData] = useState<{ profile: PmsManagerProfile | null; funds: MfManagedFund[] } | null | undefined>(undefined);
  const name = manager.manager_name;

  useEffect(() => {
    setData(undefined);
    let cancelled = false;
    getMfManagerProfile(name)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const profile = data?.profile ?? null;
  const funds = data?.funds ?? [];

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="mf-manager-title" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-4 sm:pl-10">
        <div className="w-screen max-w-3xl bg-[#FFFFFF] dark:bg-[#10151C] border-l border-[#E5E5E5] dark:border-[#2B3644] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="p-4 sm:p-5 border-b border-[#E5E5E5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27] flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white dark:text-[#10151C] text-[16px] font-semibold shrink-0 ${avatarBgFor(name)}`} aria-hidden="true">
                {initialsOf(name)}
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#0176D3]/10 dark:bg-[#1B96FF]/15 text-[#0176D3] dark:text-[#1B96FF] font-semibold border border-[#0176D3]/20 dark:border-[#1B96FF]/30">
                  Fund Manager
                </span>
                <h2 id="mf-manager-title" className="text-[17px] sm:text-[19px] font-medium text-[#181818] dark:text-[#EDF2F7] leading-snug mt-1">{name}</h2>
                <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5 font-medium">
                  {profile ? `${profile.current_title} · ${profile.firm}` : "Mutual fund manager"}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7] p-1.5 rounded-md hover:bg-[#E5E5E5] dark:hover:bg-[#2B3644] transition shrink-0" aria-label="Close manager details">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            <div className="terminal-panel p-4">
              <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mb-2">Profile</div>
              {profile ? (
                <div className="space-y-3 text-[13px] text-[#3B4757] dark:text-[#C6D0DD] leading-relaxed">
                  <p>{profile.bio_summary}</p>
                  <div><span className="font-medium text-[#181818] dark:text-[#EDF2F7]">Education: </span>{profile.education}</div>
                  {profile.years_experience && (
                    <div><span className="font-medium text-[#181818] dark:text-[#EDF2F7]">Experience: </span>{profile.years_experience} yrs</div>
                  )}
                  {profile.investment_philosophy && (
                    <div><span className="font-medium text-[#181818] dark:text-[#EDF2F7]">Investment approach: </span>{profile.investment_philosophy}</div>
                  )}
                </div>
              ) : (
                <p className="text-[13px] text-[#706E6B] dark:text-[#A8B4C4] leading-relaxed">
                  Education and career details are not published for this manager. The list below comes from AMFI scheme disclosures.
                </p>
              )}
            </div>

            {profile && profile.career_history.length > 0 && (
              <div className="terminal-panel p-4">
                <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mb-2">Career</div>
                <ol className="space-y-2.5">
                  {profile.career_history.map((c, i) => (
                    <li key={i} className="flex gap-3 text-[13px]">
                      <span className="shrink-0 w-24 font-mono text-[11px] text-[#706E6B] dark:text-[#A8B4C4] pt-0.5">{c.period}</span>
                      <span className="text-[#3B4757] dark:text-[#C6D0DD] leading-snug">
                        <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">{c.role}</span>
                        <span className="text-[#706E6B] dark:text-[#A8B4C4]"> · {c.organization}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="terminal-panel overflow-hidden">
              <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                Funds managed ({funds.length})
              </div>
              {data === undefined ? (
                <p className="p-4 text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">Loading…</p>
              ) : funds.length === 0 ? (
                <p className="p-4 text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">No funds on file for this manager.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="terminal-table">
                    <thead>
                      <tr>
                        <th>Fund</th>
                        <th>Managing since</th>
                        <th className="text-right" title="Fund CAGR from the manager's start date (month-end NAV)">Under manager</th>
                        <th className="text-right">1Y</th>
                        <th className="text-right">3Y CAGR</th>
                        <th className="text-right">5Y CAGR</th>
                        <th className="text-right">Sharpe 3Y</th>
                        <th className="text-right">Max DD 3Y</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funds.map((f) => (
                        <tr key={f.scheme_code}>
                          <td>
                            <div className="font-medium leading-snug">{f.scheme_name}</div>
                            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">{f.category ?? "—"}</div>
                          </td>
                          <td className="font-mono">{f.manager_start ?? "—"}</td>
                          <td className="text-right"><SignedValue value={f.tenure_cagr} unit="%" /></td>
                          <td className="text-right"><SignedValue value={f.ret_1y} unit="%" /></td>
                          <td className="text-right"><SignedValue value={f.cagr_3y} unit="%" /></td>
                          <td className="text-right"><SignedValue value={f.cagr_5y} unit="%" /></td>
                          <td className="text-right font-mono">{f.sharpe_3y?.toFixed(2) ?? "—"}</td>
                          <td className="text-right"><SignedValue value={f.max_drawdown_3y} unit="%" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {profile && profile.sources.length > 0 && (
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                Sources: {profile.sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer" className="underline mr-2">{s.label}</a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
