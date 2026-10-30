"use client";

import React, { useEffect, useState } from "react";
import { getFhMethodology, setFhScoringMode, type FhExplain, type FhFilter, type FhMethodology, type MfScreenerRow, type FhBreakdownRow } from "@/lib/backoffice";
import { useRecommended } from "@/lib/recommended";
import { useAuth } from "@/components/AuthContext";
import { formatISTDate } from "@/lib/terminal-format";
import { BOX, MUTED, Comparison, History, RiskMeasures, StatusChips, Title, useModeExplain } from "./FhHistoryPanel";

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
  "Needs review": "bg-[#F1F3F4] text-[#5F6368] dark:bg-[#1D2939] dark:text-[#98A2B3]",
};
const STATUS: Record<string, string> = {
  auto: "Recommended by score", manual_include: "On the FH Recommended list", manual_exclude: "Removed by the team",
  blocked: "Score qualifies, but a rule keeps it off the list", none: "Not on the FH Recommended list",
};
const MODES: Record<string, [string, string]> = {
  A: ["Ranked against peers", "Points come only from how the fund ranks among similar funds."],
  B: ["Ranked, with a quality bonus", "Same ranking, plus a small bonus when Sharpe or Sortino is above 1.0."],
};

function Part({ fl, note }: { fl: FhFilter; note?: string }) {
  const [open, setOpen] = useState(false);
  const [name, what] = PART[fl.key] ?? [fl.label, ""];
  const pct = fl.weight ? Math.max(0, Math.min(100, ((fl.points ?? 0) / fl.weight) * 100)) : 0;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left cursor-pointer">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px]">{name}{fl.status === "insufficient" && <span className="ml-2 rounded-full bg-[#FEF7E0] px-2 py-0.5 text-[11px] text-[#B06000]">not enough data</span>}</span>
          <span className="text-[14px] tabular-nums">{f(fl.points)} <span className={MUTED}>of {fl.weight}</span></span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[#EEF0F2] dark:bg-[#2B3644]"><div className="h-1.5 rounded-full bg-[#1A73E8]" style={{ width: `${pct}%` }} /></div>
        <p className={`mt-1.5 text-[12px] ${MUTED}`}>{what} Data available: {f((fl.coverage ?? NaN) * 100, 0)}%.</p>
      </button>
      {open && (
        <ul className="mt-3 space-y-1.5 rounded-xl bg-[#F8F9FA] dark:bg-[#111A24] p-3 text-[13px]">
          {note && <li className={MUTED}>{note}</li>}
          {fl.key !== "ratios" && fl.components.map((c) => (
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
    <div className="space-y-6 text-[14px] text-[#202124] dark:text-[#EDF2F7]">
      <section className={BOX}>
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <div><span className="text-[44px] leading-none font-light tabular-nums">{f(shown.score)}</span><span className={`ml-1.5 text-[15px] ${MUTED}`}>out of 100</span></div>
          <div className="pb-1 space-y-1">
            {stars ? <div className="text-[18px] text-[#F29900]" aria-label={`${shown.rating} out of 5 stars`}>{stars}</div> : <div className={MUTED}>Not rated yet</div>}
            {shown.signal && <span className={`inline-block rounded-full px-3 py-0.5 text-[13px] font-medium ${SIGNAL[shown.signal]}`}>{shown.signal}</span>}
          </div>
        </div>
        <p className={`mt-3 text-[13px] ${MUTED}`}>
          Compared with other {row.cat_label ?? "similar"} funds{row.benchmark ? `, against the ${row.benchmark} benchmark` : ""}. Data coverage is {f((shown.coverage ?? NaN) * 100, 0)}%{row.nav_date ? `, as of ${row.nav_date}` : ""}.
        </p>
        <div className="mt-4"><StatusChips data={shown.data_status} review={shown.review_status} text={shown.data_status_text} /></div>

        <div className="mt-5 border-t border-[#EEF0F2] dark:border-[#2B3644] pt-4">
          <div className="inline-flex rounded-full bg-[#F1F3F4] dark:bg-[#202936] p-1" role="tablist" aria-label="Scoring style">
            {Object.entries(MODES).map(([k, [label]]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={`rounded-full px-4 py-1.5 text-[13px] ${mode === k ? "bg-white dark:bg-[#151C26] shadow-sm font-medium" : MUTED}`}>{label}{k === live ? " (live)" : ""}</button>
            ))}
          </div>
          <p className={`mt-2 text-[12px] ${MUTED}`}>{MODES[mode]?.[1]} {loading && "Working out this style for every fund in the category, which can take about 15 seconds."}</p>
          {mode !== live && customer?.role === "admin" && (
            <button type="button" disabled={busy} onClick={makeLive} className="terminal-btn mt-2 py-1 px-3 text-[12px]">Make this the live style</button>
          )}
          {msg && <p className={`mt-1 text-[12px] ${MUTED}`}>{msg}</p>}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={toggle} className="terminal-btn py-1.5 px-4 text-[13px]">{recommended ? "Remove from FH Recommended" : "Add to FH Recommended"}</button>
          <span className={`text-[12px] ${MUTED}`}>{STATUS[status] ?? STATUS.none}. Your choices are saved, and automatic refreshes never undo them.</span>
        </div>
      </section>

      {shown.signal_reasons && shown.signal_reasons.length > 0 && (
        <section className={BOX}>
          <Title>Why this rating</Title>
          <ul className="space-y-2.5">{shown.signal_reasons.map((r, i) => <li key={i} className="flex gap-2.5"><span className="text-[#1A73E8]">•</span><span>{r}</span></li>)}</ul>
        </section>
      )}

      <section className={BOX}>
        <Title hint="Tap a row to see what it is made of.">How the score adds up</Title>
        <ul className="divide-y divide-[#EEF0F2] dark:divide-[#2B3644]">
          {shown.filters.map((fl) => <Part key={fl.key} fl={fl} note={fl.key === "ratios" ? "The detailed numbers are in the Risk and reward section below." : undefined} />)}
        </ul>
        <p className={`mt-4 text-[13px] ${MUTED}`}>
          The parts add up to {f(shown.base)}. Penalties take off {f(Math.abs(shown.penalty_total ?? 0))}, and the consistency adjustment {sign(shown.adjustment.total)}, which gives {f(shown.score)}, kept between 0 and 100.
        </p>
      </section>

      <RiskMeasures rows={ratioRows} />
      <Comparison code={row.code} />

      {(shown.flags.length > 0 || shown.blockers.length > 0) && (
        <section className={BOX}>
          <Title>Things to know</Title>
          <ul className="space-y-2 text-[13px]">
            {shown.flags.map((x) => <li key={x.code} className="flex gap-2.5"><span className={MUTED}>•</span><span>{x.text}</span></li>)}
            {shown.blockers.map((x) => <li key={x.code} className="flex gap-2.5"><span className={MUTED}>•</span><span>{x.text}</span></li>)}
          </ul>
        </section>
      )}

      <History code={row.code} />

      <details className={BOX}>
        <summary className="cursor-pointer text-[14px] font-medium">How this is calculated, and where the data comes from</summary>
        <div className={`mt-3 space-y-2 text-[13px] ${MUTED}`}>
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
