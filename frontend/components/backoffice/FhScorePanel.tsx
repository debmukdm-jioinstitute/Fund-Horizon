"use client";

import React, { useEffect, useState } from "react";
import { getFhMethodology, setFhScoringMode, type FhExplain, type FhFilter, type FhMethodology, type MfScreenerRow, type FhBreakdownRow } from "@/lib/backoffice";
import { useRecommended } from "@/lib/recommended";
import { useAuth } from "@/components/AuthContext";
import { formatISTDate } from "@/lib/terminal-format";
import { BOX, MUTED, arrow, Comparison, History, RiskMeasures, StatusChips, Title, useModeExplain } from "./FhHistoryPanel";

const f = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "n/a");
const sign = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? `+${v.toFixed(1)}` : f(v));

const PART: Record<string, [string, string]> = {
  history: ["Track record", "How long the manager and the fund have been around."],
  quartile: ["Year-by-year ranking", "Where the fund ranked among similar funds in each recent year."],
  ratios: ["Risk and reward", "Return for the risk taken, compared with similar funds."],
  outperf: ["Beating the market", "Returns against the benchmark and against similar funds."],
  excess: ["Size of the lead", "How far ahead of similar funds the returns are."],
  drawdown: ["Worst fall", "The biggest drop, compared with similar funds."],
};
const SIGNAL: Record<string, string> = {
  Buy: "bg-[#E6F4EA] text-[#137333] dark:bg-[#0F2A1B] dark:text-[#7EE2A0]",
  Hold: "bg-[#FEF7E0] text-[#B06000] dark:bg-[#2D2006] dark:text-[#FDB022]",
  Sell: "bg-[#FCE8E6] text-[#B3261E] dark:bg-[#331114] dark:text-[#FDA29B]",
  "Needs review": "bg-white/70 text-[#5B6B85] dark:bg-[#1D2939] dark:text-[#98A2B3]",
};
const STATUS: Record<string, string> = {
  auto: "Recommended by score", qualifies: "Meets the score bar, but only the team adds funds to the list", manual_include: "On the FH Recommended list", manual_exclude: "Removed by the team",
  blocked: "Score qualifies, but a rule keeps it off the list", none: "Not on the FH Recommended list",
};
const MODES: Record<string, [string, string]> = {
  A: ["Ranked against peers", "Points come only from how the fund ranks among similar funds."],
  B: ["Ranked, with a quality bonus", "Same ranking, plus a small bonus when Sharpe or Sortino is above 1.0."],
};

/** Fund return against the benchmark and against similar funds, one row per period, with a tick when the fund is ahead. */
function OutperfTable({ comps, bench }: { comps: FhFilter["components"]; bench?: string }) {
  const periods = Array.from(new Set(comps.map((c) => c.period)));
  const get = (p: string | undefined, a: string) => comps.find((c) => c.period === p && c.against === a);
  const th = "px-4 py-3 text-left text-[13px] font-medium whitespace-nowrap";
  const td = "px-4 py-4 text-[14px] whitespace-nowrap";
  const cell = (c?: { lead?: number | null; pass?: boolean | null }) => (
    <td className={`${td} font-medium ${c?.pass == null ? "" : c.pass ? "text-[#1E7B3A]" : "text-[#B3261E]"}`}>{arrow(c?.lead)} {c?.pass == null ? "" : c.pass ? "✓" : "✗"}</td>
  );
  return (
    <div>
      <p className={`mb-3 text-[13px] leading-6 ${MUTED}`}>Benchmark: {bench ?? "not available"}. A tick means the fund finished ahead.</p>
      <div className="overflow-x-auto rounded-xl border border-white/70 dark:border-white/10">
        <table className="w-full min-w-[34rem] border-separate border-spacing-0 tabular-nums">
          <thead><tr className={`bg-[#DCE9FF]/70 dark:bg-[#1A73E8]/20 ${MUTED}`}><th className={th}>Period</th><th className={th}>This fund</th><th className={th}>Benchmark</th><th className={th}>Similar funds</th><th className={th}>Vs benchmark</th><th className={th}>Vs similar funds</th></tr></thead>
          <tbody>{periods.map((p) => { const b = get(p, "benchmark"), c = get(p, "similar funds"); return (
            <tr key={p} className="border-t border-white/70"><td className={`${td} font-medium`}>{p}</td><td className={td}>{f(b?.fund ?? c?.fund, 2)}%</td><td className={td}>{f(b?.ref, 2)}%</td><td className={td}>{f(c?.ref, 2)}%</td>{cell(b)}{cell(c)}</tr>); })}</tbody>
        </table>
      </div>
    </div>
  );
}

function Part({ fl, note, bench }: { fl: FhFilter; note?: string; bench?: string }) {
  const [open, setOpen] = useState(false);
  const [name, what] = PART[fl.key] ?? [fl.label, ""];
  const pct = fl.weight ? Math.max(0, Math.min(100, ((fl.points ?? 0) / fl.weight) * 100)) : 0;
  return (
    <li className="py-6 first:pt-0 last:pb-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left cursor-pointer">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[16px]">{name}{fl.status === "insufficient" && <span className="ml-2 rounded-full bg-[#FEF7E0] px-2 py-0.5 text-[11px] text-[#B06000]">not enough data</span>}</span>
          <span className="text-[16px] tabular-nums">{f(fl.points)} <span className={MUTED}>of {fl.weight}</span></span>
        </div>
        <div className="mt-3 h-2.5 rounded-full bg-[#CFE0FA]/70 dark:bg-[#2B3644]"><div className="h-2.5 rounded-full bg-gradient-to-r from-[#4C9AFF] to-[#1A73E8] shadow-[0_2px_8px_rgba(26,115,232,0.45)]" style={{ width: `${pct}%` }} /></div>
        <p className={`mt-3 text-[13px] leading-6 ${MUTED}`}>{what} Data available: {f((fl.coverage ?? NaN) * 100, 0)}%.</p>
      </button>
      {open && (
        <ul className="mt-4 space-y-3 rounded-2xl bg-white/60 dark:bg-white/5 p-5 text-[14px] leading-6">
          {note && <li className={MUTED}>{note}</li>}
          {fl.key === "outperf" ? <li><OutperfTable comps={fl.components} bench={bench} /></li> : fl.key !== "ratios" && fl.components.map((c) => (
            <li key={c.label} className="flex justify-between gap-3"><span className={MUTED}>{c.label}{c.note ? `, ${c.note.toLowerCase()}` : ""}</span>
              <span className="tabular-nums whitespace-nowrap">{c.value == null ? "not available" : f(c.value, 2)}{c.pass != null && <span className={c.pass ? " text-[#1E7B3A]" : " text-[#B3261E]"}>{c.pass ? " ✓" : " ✗"}</span>}</span></li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FhScorePanel({ fh, row }: { fh: FhExplain; row: MfScreenerRow }) {
  const rec = useRecommended();
  const { customer } = useAuth();
  const live = fh.scoring_mode ?? "B";
  const [mode, setMode] = useState<string>(live);
  const [meth, setMeth] = useState<FhMethodology | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { ex, loading } = useModeExplain(row.code, mode, live, fh);
  useEffect(() => { getFhMethodology().then(setMeth).catch(() => setMeth(null)); }, []);
  const recommended = rec.isMfRecommended(row.code);
  const status = String(row.fh_status ?? "none");
  const toggle = async () => { setBusy(true); try { await rec.toggleMf(row.code, row.name); } finally { setBusy(false); } };
  const makeLive = async () => {
    setBusy(true);
    try { await setFhScoringMode(mode as "A" | "B"); setMsg("Saved. Scores refresh within a few minutes."); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); }
  };
  const shown = ex ?? fh;
  const ratioRows = (shown.filters.find((x) => x.key === "ratios")?.components ?? []) as unknown as FhBreakdownRow[];
  const stars = shown.rating ? "★".repeat(shown.rating) + "☆".repeat(5 - shown.rating) : null;

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-12 text-[15px] text-[#1B2B45] dark:text-[#EDF2F7]">
      <section className={`${BOX} xl:col-span-12`}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div><span className="text-[72px] leading-none font-extralight tabular-nums">{f(shown.score)}</span><span className={`ml-2 text-[16px] ${MUTED}`}>out of 100</span></div>
          <div className="pb-2 space-y-2">
            {stars ? <div className="text-[22px] tracking-wider text-[#F29900]" aria-label={`${shown.rating} out of 5 stars`}>{stars}</div> : <div className={MUTED}>Not rated yet</div>}
            {shown.signal && <span className={`inline-block rounded-full px-4 py-1 text-[14px] font-medium shadow-sm ${SIGNAL[shown.signal]}`}>{shown.signal}</span>}
          </div>
        </div>
        <p className={`mt-5 max-w-3xl text-[14px] leading-7 ${MUTED}`}>
          Compared with other {row.cat_label ?? "similar"} funds{row.benchmark ? `, against the ${row.benchmark} benchmark` : ""}. Data coverage is {f((shown.coverage ?? NaN) * 100, 0)}%{row.nav_date ? `, as of ${row.nav_date}` : ""}.
        </p>
        <div className="mt-6"><StatusChips data={shown.data_status} review={shown.review_status} text={shown.data_status_text} /></div>

        <div className="mt-8 border-t border-white/80 dark:border-white/10 pt-7">
          <div className="inline-flex rounded-full bg-[#F1F3F4] dark:bg-[#202936] p-1" role="tablist" aria-label="Scoring style">
            {Object.entries(MODES).map(([k, [label]]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={`rounded-full px-5 py-2 text-[14px] ${mode === k ? "bg-white dark:bg-[#151C26] shadow-sm font-medium" : MUTED}`}>{label}{k === live ? " (live)" : ""}</button>
            ))}
          </div>
          <p className={`mt-4 text-[13px] leading-6 ${MUTED}`}>{MODES[mode]?.[1]} {loading && "Working out this style for every fund in the category, which can take about 15 seconds."}</p>
          {mode !== live && customer?.role === "admin" && (
            <button type="button" disabled={busy} onClick={makeLive} className="terminal-btn mt-2 py-1 px-3 text-[12px]">Make this the live style</button>
          )}
          {msg && <p className={`mt-1 text-[12px] ${MUTED}`}>{msg}</p>}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button type="button" disabled={busy} onClick={toggle} className="terminal-btn py-1.5 px-4 text-[13px]">{recommended ? "Remove from FH Recommended" : "Add to FH Recommended"}</button>
          <span className={`text-[12px] ${MUTED}`}>{STATUS[status] ?? STATUS.none}. Your choices are saved, and automatic refreshes never undo them.</span>
        </div>
      </section>

      {shown.signal_reasons && shown.signal_reasons.length > 0 && (
        <section className={`${BOX} xl:col-span-5 xl:self-start`}>
          <Title>Why this rating</Title>
          <ul className="space-y-4 leading-7">{shown.signal_reasons.map((r, i) => <li key={i} className="flex gap-2.5"><span className="text-[#1A73E8]">•</span><span>{r}</span></li>)}</ul>
        </section>
      )}

      <section className={`${BOX} xl:col-span-7`}>
        <Title hint="Tap a row to see what it is made of.">How the score adds up</Title>
        <ul className="divide-y divide-white/80 dark:divide-white/10">
          {shown.filters.map((fl) => <Part key={fl.key} fl={fl} bench={shown.benchmark ? [shown.benchmark.name, shown.benchmark.stand_in_fund && `tracked here by ${shown.benchmark.stand_in_fund}`].filter(Boolean).join(", ") : undefined} note={fl.key === "ratios" ? "The detailed numbers are in the Risk and reward section below." : undefined} />)}
        </ul>
        <p className={`mt-6 text-[14px] leading-7 ${MUTED}`}>
          The parts add up to {f(shown.base)}. Penalties take off {f(Math.abs(shown.penalty_total ?? 0))}, and the consistency adjustment {sign(shown.adjustment.total)}, which gives {f(shown.score)}, kept between 0 and 100.
        </p>
      </section>

      <div className="xl:col-span-12"><RiskMeasures rows={ratioRows} /></div>
      <div className="xl:col-span-12"><Comparison code={row.code} /></div>

      {(shown.flags.length > 0 || shown.blockers.length > 0) && (
        <section className={`${BOX} xl:col-span-12`}>
          <Title>Things to know</Title>
          <ul className="space-y-3 text-[14px] leading-7">
            {shown.flags.map((x) => <li key={x.code} className="flex gap-2.5"><span className={MUTED}>•</span><span>{x.text}</span></li>)}
            {shown.blockers.map((x) => <li key={x.code} className="flex gap-2.5"><span className={MUTED}>•</span><span>{x.text}</span></li>)}
          </ul>
        </section>
      )}

      <div className="xl:col-span-12"><History code={row.code} /></div>

      <details className={`${BOX} xl:col-span-12`}>
        <summary className="cursor-pointer text-[16px] font-medium">How this is calculated, and where the data comes from</summary>
        <div className={`mt-5 space-y-3 text-[14px] leading-7 ${MUTED}`}>
          {meth && (
            <>
              <p>A fund can join the list automatically at {meth.config.recommend.threshold} points or more with {Math.round(meth.config.recommend.min_coverage * 100)}% of its data, when that switch is on.</p>
              <ul className="list-disc pl-5">{meth.sources.map((s) => <li key={s.name}>{s.name}: {s.source}, updated {s.as_of ? formatISTDate(s.as_of) : "on an unknown date"}.</li>)}</ul>
              <p>Refresh: {meth.refresh.cadence}. Next run: {meth.refresh.next_run_ist}.</p>
            </>
          )}
          <p className="font-medium text-[#202124] dark:text-[#EDF2F7]">Assumptions still to be confirmed</p>
          <ul className="list-disc pl-5">{shown.provisional.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </details>
    </div>
  );
}
