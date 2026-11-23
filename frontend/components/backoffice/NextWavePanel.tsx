"use client";

import React from "react";
import type { MfScreenerRow } from "@/lib/backoffice";

/** Weights and labels mirror COMPONENTS in backend/app/backoffice/fh_next_wave.py. Every number shown comes from the row. */
const PARTS: { key: string; name: string; weight: number; what: string; inputs: { pct: string; label: string; value: string; unit: string; lower?: boolean }[] }[] = [
  { key: "momentum", name: "Momentum", weight: 30, what: "Is the fund ahead of its peers right now?", inputs: [
    { pct: "ret_1y", label: "1 year return", value: "ret_1y", unit: "%" }, { pct: "cagr_3y", label: "3 year yearly return", value: "cagr_3y", unit: "%" }] },
  { key: "acceleration", name: "Acceleration", weight: 15, what: "Is the fund getting better? The 3 year yearly return minus the 5 year yearly return.", inputs: [
    { pct: "accel_3y_5y", label: "3 year minus 5 year yearly return", value: "accel_3y_5y", unit: " points" }] },
  { key: "consistency", name: "Consistency", weight: 25, what: "Does the fund keep winning, not just once?", inputs: [
    { pct: "roll_win_pct", label: "Rolling windows won", value: "roll_win_pct", unit: "%" }, { pct: "cal_win_pct", label: "Calendar years won", value: "cal_win_pct", unit: "%" }] },
  { key: "risk", name: "Risk skill", weight: 20, what: "Did the fund earn its returns without taking wild risks?", inputs: [
    { pct: "alpha_3y", label: "3 year alpha", value: "alpha_3y", unit: "%" }, { pct: "sortino_3y", label: "3 year Sortino ratio", value: "sortino_3y", unit: "" },
    { pct: "max_dd_3y", label: "3 year worst fall (smaller is better)", value: "max_dd_3y", unit: "%" }] },
  { key: "cost", name: "Cost", weight: 10, what: "How much of your return does the fund keep for itself? Lower is better.", inputs: [
    { pct: "ter", label: "Expense ratio", value: "ter", unit: "%", lower: true }] },
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f = (v: number | null, d = 1) => (v == null ? "not available" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const MUTED = "text-[#5B6B85] dark:text-[#A8B4C4]";
const BOX = "rounded-xl border border-white/70 dark:border-white/10 bg-white/70 dark:bg-white/5 p-4 shadow-sm";

export default function NextWavePanel({ row }: { row: MfScreenerRow }) {
  const r = row as unknown as Record<string, unknown>;
  const score = num(r.nw_score), raw = num(r.nw_raw), conf = num(r.nw_conf), avail = num(r.nw_wt_avail), years = num(r.history_years), peers = num(r.nw_peers);
  const reason = typeof r.nw_reason === "string" ? r.nw_reason : "";
  const accel = num(r.cagr_3y) != null && num(r.cagr_5y) != null ? (num(r.cagr_3y) as number) - (num(r.cagr_5y) as number) : null;
  const value = (k: string) => (k === "accel_3y_5y" ? accel : num(r[k]));
  // from the unrounded score, so the steps below always agree with the final number
  const earned = raw != null && avail != null ? (raw * avail) / 100 : PARTS.reduce((a, p) => a + (num(r[`nw_pts_${p.key}`]) ?? 0), 0);
  const pass = r.nw_pass === true;
  return (
    <div className="space-y-5 text-[14px] text-[#1B2B45] dark:text-[#EDF2F7]">
      <section className={`${BOX} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <p className={`text-[12px] uppercase ${MUTED}`}>FH Next Wave score</p>
          <p className="text-[40px] font-medium tabular-nums leading-none">{score != null ? score.toFixed(1) : "Not scored"}<span className={`text-[16px] ${MUTED}`}> / 100</span></p>
          {score == null && <p className={`mt-1 text-[13px] ${MUTED}`}>{reason || "Not enough data"}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-[12px] ${pass ? "bg-[#2E844A] text-white" : "bg-white/80 text-[#5B6B85] dark:bg-white/10 dark:text-[#A8B4C4]"}`}>
            {pass ? "Passes the Next Wave screen (70 or more)" : score != null ? "Below the Next Wave pass mark of 70" : "Not scored"}
          </span>
          <span className={`rounded-full bg-white/80 px-3 py-1 text-[12px] dark:bg-white/10 ${MUTED}`}>
            FH score {f(num(r.fh_score))} · {f(num(r.fh_rating), 0)} of 5 stars · {String(r.fh_signal ?? "no signal")}
          </span>
        </div>
      </section>

      <section className={BOX}>
        <h3 className="text-[16px] font-medium">What this score is</h3>
        <p className={`mt-1 ${MUTED}`}>
          A forward looking screen. It looks for funds whose lead is recent, widening and steady. Every input is ranked against funds in the same category and plan ({peers != null ? `${peers} funds here` : "peers"}), so 80 means better than 80 percent of them.
          It sits beside the FH score and does not change it. It is a screen, not a forecast.
        </p>
      </section>

      <section className={BOX}>
        <h3 className="text-[16px] font-medium">Points by part</h3>
        <div className="mt-3 space-y-4">
          {PARTS.map((p) => {
            const pts = num(r[`nw_pts_${p.key}`]);
            return (
              <div key={p.key} className="border-t border-white/60 pt-3 first:border-t-0 first:pt-0 dark:border-white/10">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className="font-medium">{p.name} <span className={`text-[12px] ${MUTED}`}>(worth up to {p.weight} points)</span></p>
                    <p className={`text-[12px] ${MUTED}`}>{p.what}</p>
                  </div>
                  <p className="shrink-0 text-[18px] font-medium tabular-nums">{pts != null ? `${pts.toFixed(1)} / ${p.weight}` : "dropped"}</p>
                </div>
                <ul className="mt-2 space-y-2">
                  {p.inputs.map((i) => {
                    const pc = num(r[`nw_pct_${i.pct}`]);
                    const v = value(i.value);
                    return (
                      <li key={i.pct}>
                        <div className="flex justify-between gap-3 text-[13px]">
                          <span>{i.label}: <span className="font-medium tabular-nums">{v != null ? `${f(v, 2)}${i.unit}` : "not available"}</span></span>
                          <span className={`tabular-nums ${MUTED}`}>{pc != null ? `better than ${f(pc, 0)}% of peers` : "no rank"}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded bg-[#DCE6F5] dark:bg-[#2B3644]" aria-hidden><div className="h-1.5 rounded bg-[#0176D3] dark:bg-[#1B96FF]" style={{ width: `${pc ?? 0}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
                {pts == null && <p className={`mt-1 text-[12px] ${MUTED}`}>No input is available for this part, so its {p.weight} points are spread across the other parts instead of counting as zero.</p>}
              </div>
            );
          })}
        </div>
        <p className={`mt-3 text-[12px] ${MUTED}`}>Points for a part = average rank of its inputs (0 to 1) multiplied by the points it is worth.</p>
      </section>

      <section className={BOX}>
        <h3 className="text-[16px] font-medium">From points to the final score</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>Points earned: <strong className="tabular-nums">{f(earned)}</strong> out of the <strong className="tabular-nums">{f(avail, 0)}</strong> points that have data.</li>
          <li>Scaled to 100: {f(earned)} ÷ {f(avail, 0)} × 100 = <strong className="tabular-nums">{f(raw)}</strong>.</li>
          <li>
            Confidence for history: 0.5 + 0.5 × (years ÷ 5, at most 1) with {f(years, 1)} years = <strong className="tabular-nums">{f(conf, 2)}</strong>.
            Short history moves the score toward the middle (50) instead of excluding the fund.
          </li>
          <li>Final score: {f(conf, 2)} × {f(raw)} + (1 − {f(conf, 2)}) × 50 = <strong className="tabular-nums">{score != null ? score.toFixed(1) : "not scored"}</strong>.</li>
        </ol>
      </section>

      <section className={BOX}>
        <h3 className="text-[16px] font-medium">Rules that must be met to be scored</h3>
        <ul className="mt-2 space-y-1.5">
          {([
            [`At least 3 years of history (this fund: ${f(years, 1)} years)`, years != null && years >= 3],
            [`At least 8 funds in its category and plan (here: ${peers ?? "not available"})`, peers != null && peers >= 8],
            [`At least 60% of the points have data (here: ${f(avail, 0)}%)`, avail != null && avail >= 60],
          ] as [string, boolean][]).map(([t, ok]) => (
            <li key={t} className="flex items-start gap-2"><span className={ok ? "text-[#2E844A]" : "text-[#B42332]"}>{ok ? "✓" : "✕"}</span><span>{t}</span></li>
          ))}
        </ul>
        <p className={`mt-2 text-[12px] ${MUTED}`}>There is no 5 year age rule. A fund passes the screen at 70 or more.</p>
      </section>

      <section className={BOX}>
        <h3 className="text-[16px] font-medium">Read this before using it</h3>
        <ul className={`mt-1 list-disc space-y-1 pl-5 ${MUTED}`}>
          <li>In our past data tests this screen showed no reliable edge over the FH score or over a simple last year return rule. Use it to build a research shortlist, not as a prediction.</li>
          <li>Recent returns carry weight, so it can favour funds that just had a good year.</li>
          <li>Ranks use the category and plan as peers. No market index series is stored yet.</li>
          <li>Descriptive data, not investment advice.</li>
        </ul>
      </section>
    </div>
  );
}
