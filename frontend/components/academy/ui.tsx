"use client";

import React from "react";

export const card = "border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg bg-[#FFFFFF] dark:bg-[#10151C]";
export const muted = "text-[#536176] dark:text-[#A8B4C4]";
export const accent = "text-[#0176D3] dark:text-[#1B96FF]";
export const btn =
  "inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-md text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0176D3] dark:focus-visible:outline-[#1B96FF] disabled:opacity-50 disabled:cursor-not-allowed";
export const btnPrimary = `${btn} bg-[#0176D3] text-white hover:bg-[#005A51] dark:bg-[#1B96FF] dark:text-[#10151C] dark:hover:bg-[#8EEBDA]`;
export const btnGhost = `${btn} border border-[#E4E9EF] dark:border-[#2B3644] text-[#172033] dark:text-[#EDF2F7] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]`;
export const chip = (on: boolean) =>
  `min-h-8 px-3 rounded-full text-sm border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0176D3] dark:focus-visible:outline-[#1B96FF] ${
    on ? "bg-[#EAF5FE] dark:bg-[#11304F] border-[#0176D3] dark:border-[#1B96FF] font-medium " + accent : `border-[#E4E9EF] dark:border-[#2B3644] ${muted} hover:text-[#172033] dark:hover:text-[#EDF2F7]`
  }`;

export function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-[#E4E9EF] dark:bg-[#2B3644] overflow-hidden">
      <div className="h-full bg-[#0176D3] dark:bg-[#1B96FF] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Ring({ value, size = 56, label, children }: { value: number; size?: number; label: string; children?: React.ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(pct * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-[#E4E9EF] dark:stroke-[#2B3644]" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          className="stroke-[#0176D3] dark:stroke-[#1B96FF] transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">{children ?? `${Math.round(pct * 100)}%`}</div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className={`flex items-center gap-2 text-[15px] ${muted}`}>
      <svg className="animate-spin motion-reduce:animate-none h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {label}…
    </div>
  );
}

export const LEVEL_LABEL: Record<string, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
