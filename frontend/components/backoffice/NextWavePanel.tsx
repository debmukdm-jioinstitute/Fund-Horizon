"use client";

import React, { useEffect, useState } from "react";
import type { MfScreenerRow } from "@/lib/backoffice";
import { CountUp } from "@/components/operations/CalcCharts";

/** Weights and labels mirror COMPONENTS in backend/app/backoffice/fh_next_wave.py. Every number shown comes from the row. */
const PARTS: { key: string; name: string; short: string; weight: number; what: string; inputs: { pct: string; label: string; value: string; unit: string }[] }[] = [
  { key: "momentum", name: "Momentum", short: "Mom.", weight: 30, what: "Is the fund ahead of its peers right now?", inputs: [
    { pct: "ret_1y", label: "1 year return", value: "ret_1y", unit: "%" }, { pct: "cagr_3y", label: "3 year yearly return", value: "cagr_3y", unit: "%" }] },
  { key: "acceleration", name: "Acceleration", short: "Accel.", weight: 15, what: "Is the fund getting better? The 3 year yearly return minus the 5 year yearly return.", inputs: [
    { pct: "accel_3y_5y", label: "3 year minus 5 year yearly return", value: "accel_3y_5y", unit: " points" }] },
  { key: "consistency", name: "Consistency", short: "Consist.", weight: 25, what: "Does the fund keep winning, not just once?", inputs: [
    { pct: "roll_win_pct", label: "Rolling windows won", value: "roll_win_pct", unit: "%" }, { pct: "cal_win_pct", label: "Calendar years won", value: "cal_win_pct", unit: "%" }] },
  { key: "risk", name: "Risk skill", short: "Risk", weight: 20, what: "Did the fund earn its returns without taking wild risks?", inputs: [
    { pct: "alpha_3y", label: "3 year alpha", value: "alpha_3y", unit: "%" }, { pct: "sortino_3y", label: "3 year Sortino ratio", value: "sortino_3y", unit: "" },
    { pct: "max_dd_3y", label: "3 year worst fall (smaller is better)", value: "max_dd_3y", unit: "%" }] },
  { key: "cost", name: "Cost", short: "Cost", weight: 10, what: "How much of your return does the fund keep for itself? Lower is better.", inputs: [
    { pct: "ter", label: "Expense ratio", value: "ter", unit: "%" }] },
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const f = (v: number | null, d = 1) => (v == null ? "not available" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const MUTED = "text-[#5B6B85] dark:text-[#A8B4C4]";
// rounded-3xl makes the global rise-in animation apply (it respects reduced motion); hover lifts the card a little.
const CARD = "rounded-3xl border border-white/70 bg-white/75 p-5 shadow-[0_10px_30px_-14px_rgba(26,115,232,0.28)] backdrop-blur transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-14px_rgba(26,115,232,0.38)] motion-reduce:transition-none dark:border-white/10 dark:bg-white/5 sm:p-6";
const tone = (ratio: number) => (ratio >= 0.75 ? { bar: "bg-[#2E844A]", chip: "bg-[#E6F4EA] text-[#137333] dark:bg-[#0F2A1B] dark:text-[#7EE2A0]", word: "Strong" }
  : ratio >= 0.4 ? { bar: "bg-[#0176D3] dark:bg-[#1B96FF]", chip: "bg-[#E8F1FD] text-[#0B5CAB] dark:bg-[#10243A] dark:text-[#7FB2FF]", word: "Average" }
  : { bar: "bg-[#E8A317]", chip: "bg-[#FEF7E0] text-[#B06000] dark:bg-[#2D2006] dark:text-[#FDB022]", word: "Weak" });

function Gauge({ score, pass }: { score: number | null; pass: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  const R = 62, C = 2 * Math.PI * R, shown = on && score != null ? Math.max(0, Math.min(100, score)) : 0;
  const tick = (-90 + 0.7 * 360) * (Math.PI / 180); // the 70 pass mark
  return (
    <div className="relative mx-auto h-[190px] w-[190px] shrink-0 sm:h-[210px] sm:w-[210px]" role="img" aria-label={score != null ? `Score ${score.toFixed(1)} out of 100, pass mark 70` : "Not scored"}>
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" strokeWidth="12" className="stroke-[#DCE6F5] dark:stroke-[#2B3644]" />
        <circle cx="80" cy="80" r={R} fill="none" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)}
          className={`${pass ? "stroke-[#2E844A]" : "stroke-[#0176D3] dark:stroke-[#1B96FF]"} transition-[stroke-dashoffset] duration-[1100ms] ease-out motion-reduce:transition-none`} />
      </svg>
      <svg viewBox="0 0 160 160" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        <line x1={80 + (R - 11) * Math.cos(tick)} y1={80 + (R - 11) * Math.sin(tick)} x2={80 + (R + 11) * Math.cos(tick)} y2={80 + (R + 11) * Math.sin(tick)} strokeWidth="2.5" className="stroke-[#1B2B45] dark:stroke-white" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[44px] font-medium leading-none tabular-nums sm:text-[50px]">{score != null ? <CountUp value={score} fmt={(n) => n.toFixed(1)} /> : "n/a"}</span>
        <span className={`mt-1 text-[13px] ${MUTED}`}>out of 100</span>
      </div>
    </div>
  );
}

export default function NextWavePanel({ row }: { row: MfScreenerRow }) {
  const r = row as unknown as Record<string, unknown>;
  const [on, setOn] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setOn(true), 80); return () => clearTimeout(t); }, []);
  const score = num(r.nw_score), raw = num(r.nw_raw), conf = num(r.nw_conf), avail = num(r.nw_wt_avail), years = num(r.history_years), peers = num(r.nw_peers);
  const reason = typeof r.nw_reason === "string" ? r.nw_reason : "";
  const accel = num(r.cagr_3y) != null && num(r.cagr_5y) != null ? (num(r.cagr_3y) as number) - (num(r.cagr_5y) as number) : null;
  const value = (k: string) => (k === "accel_3y_5y" ? accel : num(r[k]));
  // from the unrounded score, so the steps below always agree with the final number
  const earned = raw != null && avail != null ? (raw * avail) / 100 : PARTS.reduce((a, p) => a + (num(r[`nw_pts_${p.key}`]) ?? 0), 0);
  const pass = r.nw_pass === true;
  const rows = PARTS.map((p) => ({ ...p, pts: num(r[`nw_pts_${p.key}`]) })).map((p) => ({ ...p, ratio: p.pts != null ? p.pts / p.weight : null }));
  const live = rows.filter((p) => p.ratio != null) as (typeof rows[number] & { pts: number; ratio: number })[];
  const best = [...live].sort((a, b) => b.ratio - a.ratio)[0], worst = [...live].sort((a, b) => a.ratio - b.ratio)[0];
  const go = (k: string) => { setActive(k); document.getElementById(`nw-part-${k}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); };

  const nudges: string[] = [];
  if (score != null) nudges.push(pass ? `Clears the pass mark of 70 by ${f(score - 70)} points.` : `Needs ${f(70 - score)} more points to reach the pass mark of 70.`);
  else nudges.push(reason || "Not enough data to score this fund.");
  if (best && worst && best.key !== worst.key) {
    nudges.push(`Strongest part: ${best.name} (${f(best.pts)} of ${best.weight}).`);
    nudges.push(`Most room to improve: ${worst.name}, ${f(worst.weight - worst.pts)} points still available.`);
  }
  if (conf != null && conf < 1) nudges.push(`Shorter history: about ${Math.round((1 - conf) * 100)}% of this score is held at the middle (50) until more history builds up.`);
  if (rows.some((p) => p.pts == null)) nudges.push("A part with no data is dropped and its points are spread over the other parts. It never counts as zero.");

  const tiles: [string, string][] = [
    ["History", years != null ? `${f(years, 1)} years` : "n/a"], ["Peer funds", peers != null ? `${peers} funds` : "n/a"],
    ["Confidence", conf != null ? `${Math.round(conf * 100)}%` : "n/a"], ["Data used", avail != null ? `${f(avail, 0)} of 100 points` : "n/a"],
  ];

  return (
    <div className="space-y-5 text-[15px] leading-relaxed text-[#1B2B45] dark:text-[#EDF2F7] sm:space-y-6">
      {/* Hero */}
      <section className={`${CARD} grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,18rem)] lg:items-center lg:gap-10`}>
        <Gauge score={score} pass={pass} />
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${pass ? "bg-[#2E844A] text-white" : "bg-white/90 text-[#5B6B85] dark:bg-white/10 dark:text-[#A8B4C4]"}`}>
              {pass ? "◈ Passes the Next Wave screen" : score != null ? "Below the pass mark of 70" : "Not scored"}
            </span>
            <span className={`text-[13px] ${MUTED}`}>Pass mark: 70 or more</span>
          </div>
          <ul className="space-y-1.5">
            {nudges.map((t) => (
              <li key={t} className="flex gap-2.5 text-[15px]"><span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0176D3] dark:bg-[#1B96FF]" /><span>{t}</span></li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {tiles.map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-white/80 px-3.5 py-2.5 dark:bg-white/10">
                <p className={`text-[12px] uppercase tracking-wide ${MUTED}`}>{k}</p>
                <p className="mt-0.5 text-[16px] font-medium tabular-nums">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-white/80 p-4 dark:bg-white/10">
          <p className={`text-[12px] uppercase tracking-wide ${MUTED}`}>Beside the FH score</p>
          <p className="mt-1 text-[28px] font-medium leading-tight tabular-nums">{f(num(r.fh_score))}<span className={`text-[14px] ${MUTED}`}> / 100</span></p>
          <p className={`mt-1 text-[14px] ${MUTED}`}>{f(num(r.fh_rating), 0)} of 5 stars · {String(r.fh_signal ?? "no signal")}</p>
          <p className={`mt-3 border-t border-[#DCE6F5] pt-3 text-[13px] dark:border-white/10 ${MUTED}`}>Two different questions. The FH score rewards a long, proven record. Next Wave looks at recent, widening and steady leadership. Neither changes the other.</p>
        </div>
      </section>

      {/* Where the points came from: one bar, each part sized by its weight, filled by what the fund earned */}
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[18px] font-medium">Where the points came from</h3>
          <p className={`text-[13px] ${MUTED}`}>Wider block = worth more points. Filled part = points earned. Tap a block to jump to its detail.</p>
        </div>
        <div className="mt-4 flex gap-1.5" role="list">
          {rows.map((p) => {
            const t = p.ratio != null ? tone(p.ratio) : null;
            return (
              <button key={p.key} type="button" role="listitem" onClick={() => go(p.key)} onMouseEnter={() => setActive(p.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(p.key)} onBlur={() => setActive(null)}
                style={{ flexGrow: p.weight, flexBasis: 0, minWidth: "3.4rem" }} title={`${p.name}: ${p.pts != null ? f(p.pts) : "no data"} of ${p.weight}`}
                className={`group min-w-0 rounded-xl text-left outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#0176D3] motion-reduce:transition-none ${active === p.key ? "ring-2 ring-[#0176D3]" : ""}`}>
                <div className="h-3.5 overflow-hidden rounded-full bg-[#DCE6F5] dark:bg-[#2B3644]">
                  <div className={`h-full rounded-full ${t ? t.bar : "bg-transparent"} transition-[width] duration-[900ms] ease-out motion-reduce:transition-none`} style={{ width: `${on && p.ratio != null ? p.ratio * 100 : 0}%` }} />
                </div>
                <p className="mt-1.5 truncate text-[11px] font-medium sm:text-[13px]"><span className="sm:hidden">{p.short}</span><span className="hidden sm:inline">{p.name}</span></p>
                <p className={`truncate text-[11px] tabular-nums sm:text-[12px] ${MUTED}`}>{p.pts != null ? `${f(p.pts)}/${p.weight}` : "dropped"}</p>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 sm:gap-6 xl:grid-cols-12">
        {/* Parts */}
        <div className="grid gap-5 sm:gap-6 md:grid-cols-2 xl:col-span-8">
          {rows.map((p, idx) => {
            const t = p.ratio != null ? tone(p.ratio) : null;
            return (
              <article key={p.key} id={`nw-part-${p.key}`} onMouseEnter={() => setActive(p.key)} onMouseLeave={() => setActive(null)}
                style={{ animationDelay: `${idx * 70}ms` }}
                className={`${CARD} scroll-mt-28 ${active === p.key ? "ring-2 ring-[#0176D3]/70" : ""} ${p.key === "cost" ? "md:col-span-2" : ""} ${p.pts == null ? "opacity-80" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h4 className="text-[18px] font-medium">{p.name}</h4>
                    <p className={`text-[13px] ${MUTED}`}>Worth up to {p.weight} points</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[26px] font-medium leading-none tabular-nums">{p.pts != null ? f(p.pts) : "dropped"}{p.pts != null && <span className={`text-[14px] ${MUTED}`}> / {p.weight}</span>}</p>
                    {t && <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium ${t.chip}`}>{t.word}</span>}
                  </div>
                </div>
                <p className={`mt-2 text-[14px] ${MUTED}`}>{p.what}</p>
                <ul className="mt-4 space-y-3.5">
                  {p.inputs.map((i, j) => {
                    const pc = num(r[`nw_pct_${i.pct}`]);
                    const v = value(i.value);
                    return (
                      <li key={i.pct}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
                          <span>{i.label}: <span className="font-medium tabular-nums">{v != null ? `${f(v, 2)}${i.unit}` : "not available"}</span></span>
                          <span className={`tabular-nums ${MUTED}`}>{pc != null ? `better than ${f(pc, 0)}% of peers` : "no rank"}</span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#DCE6F5] dark:bg-[#2B3644]" aria-hidden>
                          <div className={`h-full rounded-full ${t ? t.bar : "bg-[#0176D3]"} transition-[width] duration-[900ms] ease-out motion-reduce:transition-none`} style={{ width: `${on ? pc ?? 0 : 0}%`, transitionDelay: `${150 + idx * 70 + j * 90}ms` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {p.pts == null && <p className={`mt-3 text-[13px] ${MUTED}`}>No input is available for this part, so its {p.weight} points are spread across the other parts instead of counting as zero.</p>}
              </article>
            );
          })}
        </div>

        {/* Method, rules and caution */}
        <div className="space-y-5 sm:space-y-6 xl:col-span-4 xl:sticky xl:top-24 xl:self-start">
          <section className={CARD}>
            <h3 className="text-[18px] font-medium">From points to the final score</h3>
            <ol className="mt-4 space-y-4">
              {[
                ["Add up the points", <>Points earned: <strong className="tabular-nums">{f(earned)}</strong> out of the <strong className="tabular-nums">{f(avail, 0)}</strong> that have data.</>],
                ["Scale to 100", <>{f(earned)} ÷ {f(avail, 0)} × 100 = <strong className="tabular-nums">{f(raw)}</strong></>],
                ["Adjust for history", <>Confidence = 0.5 + 0.5 × (years ÷ 5, at most 1). With {f(years, 1)} years that is <strong className="tabular-nums">{f(conf, 2)}</strong>. Short history moves the score toward the middle (50) instead of excluding the fund.</>],
                ["Final score", <>{f(conf, 2)} × {f(raw)} + (1 − {f(conf, 2)}) × 50 = <strong className="text-[18px] tabular-nums">{score != null ? score.toFixed(1) : "not scored"}</strong></>],
              ].map(([title, body], i, all) => (
                <li key={String(title)} className="relative flex gap-3.5">
                  {i < all.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-0.5rem)] w-px bg-[#C9D8EE] dark:bg-white/15" />}
                  <span className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-medium text-white ${i === all.length - 1 ? "bg-[#2E844A]" : "bg-[#0176D3]"}`}>{i + 1}</span>
                  <div className="min-w-0"><p className="font-medium">{title as string}</p><p className={`text-[14px] ${MUTED}`}>{body}</p></div>
                </li>
              ))}
            </ol>
          </section>

          <section className={CARD}>
            <h3 className="text-[18px] font-medium">Rules to be scored</h3>
            <ul className="mt-3 space-y-2.5">
              {([
                [`At least 3 years of history. This fund: ${f(years, 1)} years.`, years != null && years >= 3],
                [`At least 8 funds in its category and plan. Here: ${peers ?? "not available"}.`, peers != null && peers >= 8],
                [`At least 60 of the 100 points have data. Here: ${f(avail, 0)}.`, avail != null && avail >= 60],
              ] as [string, boolean][]).map(([t, ok]) => (
                <li key={t} className="flex items-start gap-2.5 text-[14px]">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] text-white ${ok ? "bg-[#2E844A]" : "bg-[#B42332]"}`} aria-label={ok ? "met" : "not met"}>{ok ? "✓" : "✕"}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <p className={`mt-3 text-[13px] ${MUTED}`}>There is no 5 year age rule. A fund passes the screen at 70 or more.</p>
          </section>

          <section className="rounded-3xl border border-[#F2D58A] bg-[#FFF8E6] p-5 dark:border-[#5C4510] dark:bg-[#2A2008] sm:p-6">
            <h3 className="text-[18px] font-medium text-[#7A4A00] dark:text-[#FDD48A]">Read this before using it</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] text-[#6B4A10] dark:text-[#E8CFA0]">
              <li>In our past data tests this screen showed no reliable edge over the FH score or over a simple last year return rule. Use it to build a research shortlist, not as a prediction.</li>
              <li>Recent returns carry weight, so it can favour funds that just had a good year.</li>
              <li>Ranks use the category and plan as peers. No market index series is stored yet.</li>
              <li>Descriptive data, not investment advice.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
