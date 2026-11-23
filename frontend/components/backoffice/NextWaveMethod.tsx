"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";

const MUTED = "text-[#5B6B85] dark:text-[#A8B4C4]";
const CARD = "rounded-3xl border border-white/70 bg-white/80 p-5 shadow-[0_10px_30px_-14px_rgba(26,115,232,0.28)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6";
const TH = "px-3 py-2 text-left font-medium";
const TD = "px-3 py-2 align-top";

/** Mirrors COMPONENTS, QUARTILE_POINTS and AUM_BANDS in backend/app/backoffice/fh_next_wave.py. */
const WEIGHTS: [string, number, string][] = [
  ["Quartile", 35, "Where the fund ranks in its category now (level) and whether it is climbing (trend). The biggest part."],
  ["Acceleration", 15, "3 year yearly return minus 5 year yearly return: is the fund getting better?"],
  ["Consistency", 15, "Share of rolling 12 month windows and calendar years beating the category median."],
  ["Momentum", 10, "1 year return and 3 year yearly return against peers. Kept small so last year's winners do not dominate."],
  ["Risk skill", 10, "3 year alpha, Sortino ratio and worst fall against peers."],
  ["Fund size", 10, "Is the fund neither too small nor too large for its category?"],
  ["Cost", 5, "Expense ratio against peers. Lower is better."],
];
const QUARTILES: [string, string, string][] = [
  ["Quartile 2", "1.00", "Upper-middle. Close to the top and able to climb into it."],
  ["Quartile 3", "0.90", "Lower-middle. The biggest room to climb, and the quartile movement we want to catch early."],
  ["Quartile 1", "0.75", "Already the top. Rewarded, but it has less room to climb."],
  ["Quartile 4", "0.20", "Bottom quarter. Lowest credit."],
];
const BANDS: [string, string][] = [
  ["Small Cap", "500 to 10,000"], ["Mid Cap", "1,000 to 25,000"], ["Large Cap", "1,000 to 50,000"], ["Large & Mid Cap", "1,000 to 30,000"],
  ["Sectoral/Thematic", "300 to 8,000"], ["Focused, ELSS", "500 to 20,000"], ["All other categories", "500 to 30,000"],
];
const EXAMPLE: [string, string, string][] = [
  ["Quartile", "Level 0.93 (Q3, Q3, Q2 weighted 37.5%, 37.5%, 25%) and trend 0.67 (climbed one quartile). Average 0.80 × 35", "27.9"],
  ["Acceleration", "Better than 70% of peers × 15", "10.5"],
  ["Consistency", "Better than 65% of peers × 15", "9.8"],
  ["Momentum", "Better than 60% of peers × 10", "6.0"],
  ["Risk skill", "Better than 55% of peers × 10", "5.5"],
  ["Fund size", "8,000 crore rupees in a Mid Cap fund, inside 1,000 to 25,000, so 1.00 × 10", "10.0"],
  ["Cost", "Cheaper than 80% of peers × 5", "4.0"],
];

export default function NextWaveMethod({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[10000] overflow-y-auto bg-gradient-to-br from-[#E4EEFF] via-[#F2F7FF] to-[#DDEBFF] dark:from-[#0B1626] dark:via-[#0E1B2E] dark:to-[#0A1422]" role="dialog" aria-label="How the FH Next Wave score works">
      <header className="sticky top-0 z-10 border-b border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-[#0E1B2E]/70">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <h2 className="text-[20px] font-medium text-[#1B2B45] dark:text-[#EDF2F7]">How the FH Next Wave score works</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-[14px] shadow-sm hover:bg-white dark:border-white/10 dark:bg-white/10">Close ✕</button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 text-[15px] leading-relaxed text-[#1B2B45] dark:text-[#EDF2F7] sm:space-y-6 sm:px-8">
        <section className={CARD}>
          <h3 className="text-[18px] font-medium">What it looks for</h3>
          <p className="mt-2">Funds that could become the next big performer: funds in quartile 2 or 3 of their category that are moving up, with improving and steady performance, and a fund size that still lets the manager add value. Past return size is a small part on purpose. High returns alone would always put last year&apos;s winners first.</p>
          <p className={`mt-2 text-[14px] ${MUTED}`}>Every part is compared inside the fund&apos;s own category and plan. The FH score is not changed by this screen.</p>
        </section>

        <section className={CARD}>
          <h3 className="text-[18px] font-medium">The seven parts (100 points)</h3>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[32rem] text-[14px]"><thead className={MUTED}><tr><th className={TH}>Part</th><th className={`${TH} text-right`}>Points</th><th className={TH}>What it asks</th></tr></thead>
            <tbody className="divide-y divide-[#DCE6F5] dark:divide-white/10">{WEIGHTS.map(([n, w, t]) => <tr key={n}><td className={`${TD} font-medium`}>{n}</td><td className={`${TD} text-right tabular-nums`}>{w}</td><td className={TD}>{t}</td></tr>)}</tbody></table></div>
        </section>

        <section className={CARD}>
          <h3 className="text-[18px] font-medium">Quartile: level and trend</h3>
          <p className="mt-2">Quartile 1 is the top quarter of a category and quartile 4 the bottom. Each calendar period earns points by its quartile. The latest two years carry the most weight (this year so far 25%, last year 37.5%, the year before 37.5%).</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[28rem] text-[14px]"><thead className={MUTED}><tr><th className={TH}>Quartile</th><th className={`${TH} text-right`}>Points</th><th className={TH}>Why</th></tr></thead>
            <tbody className="divide-y divide-[#DCE6F5] dark:divide-white/10">{QUARTILES.map(([q, p, t]) => <tr key={q}><td className={`${TD} font-medium`}>{q}</td><td className={`${TD} text-right tabular-nums`}>{p}</td><td className={TD}>{t}</td></tr>)}</tbody></table></div>
          <p className="mt-3"><strong>Trend</strong> counts how many quartiles the fund moved up between its oldest and latest period: quartile 4 to 1 scores 1.00, no move 0.50, quartile 1 to 4 scores 0. A fund already in quartile 1 cannot move up, so it earns its credit through the level. The part is the average of level and trend.</p>
        </section>

        <section className={CARD}>
          <h3 className="text-[18px] font-medium">Fund size (AUM) check</h3>
          <p className="mt-2">A fund that is too small can be shaky and costly. A fund that is too large struggles to find enough stocks to beat its category, most of all in small and mid caps. Inside the sweet spot the fund scores 1.00. Below it the score fades in a straight line toward 0.20. Above it the score drops by 0.40 for every doubling (twice the top of the range = 0.60, four times = 0.20).</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[22rem] text-[14px]"><thead className={MUTED}><tr><th className={TH}>Category</th><th className={`${TH} text-right`}>Full score between (crore rupees)</th></tr></thead>
            <tbody className="divide-y divide-[#DCE6F5] dark:divide-white/10">{BANDS.map(([c, b]) => <tr key={c}><td className={`${TD} font-medium`}>{c}</td><td className={`${TD} text-right tabular-nums`}>{b}</td></tr>)}</tbody></table></div>
          <p className={`mt-3 text-[13px] ${MUTED}`}>Ranges are our working judgement from how Indian equity funds are sized, not a regulatory rule. If a fund has no size on record this part is dropped and its points are spread over the others.</p>
        </section>

        <section className={CARD}>
          <h3 className="text-[18px] font-medium">Worked example</h3>
          <p className={`mt-1 text-[14px] ${MUTED}`}>A Mid Cap fund with 4 years of history that finished quartile 3 two years ago, quartile 3 last year and quartile 2 this year.</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[32rem] text-[14px]"><thead className={MUTED}><tr><th className={TH}>Part</th><th className={TH}>How</th><th className={`${TH} text-right`}>Points</th></tr></thead>
            <tbody className="divide-y divide-[#DCE6F5] dark:divide-white/10">{EXAMPLE.map(([p, h, v]) => <tr key={p}><td className={`${TD} font-medium`}>{p}</td><td className={TD}>{h}</td><td className={`${TD} text-right tabular-nums`}>{v}</td></tr>)}
              <tr><td className={`${TD} font-medium`} colSpan={2}>Total, scaled to 100</td><td className={`${TD} text-right font-medium tabular-nums`}>73.7</td></tr></tbody></table></div>
          <ol className="mt-4 list-decimal space-y-1.5 pl-5">
            <li>Points add up to 73.7 of 100, so the scaled score is 73.7.</li>
            <li>With 4 years of history, confidence = 0.5 + 0.5 × (4 ÷ 5) = 0.90. Short history pulls the score toward the middle (50).</li>
            <li>Final score = 0.90 × 73.7 + 0.10 × 50 = <strong>71.3</strong>. That is above the pass mark of 70, so the fund passes.</li>
          </ol>
          <p className={`mt-3 text-[14px] ${MUTED}`}>A part with no data is dropped and its points are spread over the other parts, never counted as zero. A fund needs 3 years of history, 8 funds in its category and plan, and data for at least 60 of the 100 points.</p>
        </section>

        <section className="rounded-3xl border border-[#F2D58A] bg-[#FFF8E6] p-5 text-[14px] text-[#6B4A10] dark:border-[#5C4510] dark:bg-[#2A2008] dark:text-[#E8CFA0] sm:p-6">
          <p>This is a research screen, not a forecast. Use it to build a shortlist. Descriptive data, not investment advice.</p>
        </section>
      </main>
    </div>,
    document.body,
  );
}
