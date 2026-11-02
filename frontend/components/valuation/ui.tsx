"use client";

import React from "react";

export const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
export const muted = "text-[#667085] dark:text-[#9AA6B8]";
export const blue = "text-[#175CD3] dark:text-[#7FB0FF]";
export const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#175CD3] hover:text-[#175CD3] disabled:opacity-40 disabled:pointer-events-none";
export const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#175CD3] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#1249A8] disabled:opacity-40 disabled:pointer-events-none";
export const input = "w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-[13px]";
export const th = "px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#667085] dark:text-[#9AA6B8] border-b border-[#CBD3DF] dark:border-[#2B3644]";
export const td = "px-2 py-1.5 text-[12.5px] border-b border-[#EEF1F5] dark:border-[#232D3B] align-top";

const NA = "Not available";
const MONEY = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (v: number | null | undefined) => (v == null ? NA : `₹${MONEY.format(v)}`);
export const pct = (v: number | null | undefined, d = 2) => (v == null ? NA : `${v.toFixed(d)}%`);
export const num = (v: number | null | undefined) => (v == null ? "-" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(v));
export const dateFmt = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-");
export const monthFmt = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const TONES: Record<string, string> = {
  good: "text-[#147A3D] bg-[#E7F5EB] dark:bg-[#12301D] dark:text-[#6EE7A0]",
  warn: "text-[#9A6700] bg-[#FFF6E0] dark:bg-[#332A10] dark:text-[#F5C451]",
  bad: "text-[#B42318] bg-[#FEECEB] dark:bg-[#3A1517] dark:text-[#FF7D86]",
  info: "text-[#175CD3] bg-[#EAF1FE] dark:bg-[#16294D] dark:text-[#7FB0FF]",
  none: "text-[#667085] bg-[#F2F4F7] dark:bg-[#232D3B] dark:text-[#9AA6B8]",
};
const STATUS_TONE: Record<string, string> = {
  approved: "good", clean: "good", passed: "good", extracted: "good", resolved: "info", overridden: "warn", warnings: "warn", warning: "warn",
  blocked: "bad", failed: "bad", error: "bad", manual_review: "bad", rejected: "bad", reconciled: "info", processed: "info", draft: "none", not_run: "none", uploaded: "none", info: "none",
};
export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[STATUS_TONE[status] ?? "none"]}`}>{label ?? status.replace(/_/g, " ")}</span>;
}

export function Notice({ tone, children }: { tone: "warn" | "bad" | "info" | "good"; children: React.ReactNode }) {
  return <div role={tone === "bad" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-[12.5px] ${TONES[tone]}`}>{children}</div>;
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-l border-[#CBD3DF] dark:border-[#2B3644] pl-3">
      <div className={`text-[11px] uppercase tracking-wide ${muted}`}>{label}</div>
      <div className="text-[17px] font-semibold tabular-nums">{value}</div>
      {note && <div className={`text-[11px] ${muted}`}>{note}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-4 border-b border-[#E4E9EF] dark:border-[#2B3644]">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-1 pb-2 text-[13px] font-semibold ${value === t.id ? "border-[#175CD3] text-[#175CD3] dark:text-[#7FB0FF]" : `border-transparent ${muted}`}`}>{t.label}</button>
      ))}
    </div>
  );
}
