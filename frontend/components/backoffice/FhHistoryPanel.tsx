"use client";

import React, { useEffect, useState } from "react";
import {
  getFhBreakdown, getFhComparison, getFhHistory, getFhOutcome, getFhSnapshotAsOf, getFhThenNow,
  type FhBreakdownRow, type FhComparison, type FhExplain, type FhHistory, type FhOutcome, type FhThenNow,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

export const MUTED = "text-[#5B6B85] dark:text-[#A8B4C4]";
// Tinted glass card: frosted blue-white fill, bright top edge, soft blue shadow, small lift on hover. Avoids splitting across printed pages.
export const BOX = "break-inside-avoid rounded-3xl border border-white/70 dark:border-white/10 bg-white/55 dark:bg-[#12233A]/55 backdrop-blur-xl p-7 sm:p-9 shadow-[0_18px_50px_-18px_rgba(26,115,232,0.35),inset_0_1px_0_rgba(255,255,255,0.95)] transition-transform duration-200 hover:-translate-y-0.5";
export const PILL = "rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/10 shadow-sm";
const f = (v: number | string | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : v == null ? "n/a" : String(v));
const pp = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "n/a");
const tone = (v: number | null | undefined) => (typeof v !== "number" ? "" : v > 0 ? "text-[#1E7B3A] dark:text-[#6FD493]" : v < 0 ? "text-[#B3261E] dark:text-[#F2B8B5]" : "");

export function Title({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <div className="mb-7"><h3 className="text-[20px] font-medium tracking-tight text-[#1B2B45] dark:text-[#EDF2F7]">{children}</h3>{hint && <p className={`mt-2 text-[14px] leading-relaxed ${MUTED}`}>{hint}</p>}</div>;
}

const DATA: Record<string, string> = { complete: "Data is complete", partial: "Some data is missing", insufficient_history: "Fund is too new", missing_series: "A data series is missing", insufficient_peers: "Too few similar funds", stale_or_bad_data: "Data is out of date" };
const REVIEW: Record<string, string> = { none: "No review needed", investment_review_required: "Needs an investment review", data_incomplete: "Cannot be judged yet" };
export function StatusChips({ data, review, text }: { data?: string; review?: string; text?: string }) {
  if (!data) return null;
  const chip = `${PILL} px-4 py-1.5 text-[13px]`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={chip}>{DATA[data] ?? data}</span>
      {review && <span className={chip}>{REVIEW[review] ?? review}</span>}
      {text && <span className={`text-[13px] ${MUTED}`}>{text}</span>}
    </div>
  );
}

export function Comparison({ code }: { code: string }) {
  const [d, setD] = useState<FhComparison | null>(null);
  useEffect(() => { getFhComparison(code).then(setD).catch(() => setD(null)); }, [code]);
  if (!d) return null;
  const th = "px-5 py-4 text-left text-[13px] font-medium whitespace-nowrap";
  const td = "px-5 py-5 text-[15px] whitespace-nowrap";
  return (
    <section className={BOX}>
      <Title hint={`Returns in percent. The benchmark is ${d.benchmark}.`}>How it compares</Title>
      <div className="overflow-x-auto rounded-2xl border border-white/70 dark:border-white/10 bg-white/50 dark:bg-white/5">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 tabular-nums">
          <thead>
            <tr className={`bg-[#DCE9FF]/70 dark:bg-[#1A73E8]/20 ${MUTED}`}>
              <th className={th}>Period</th><th className={th}>This fund</th><th className={th}>Benchmark</th><th className={th}>Similar funds</th><th className={th}>Ahead of benchmark</th><th className={th}>Ahead of similar funds</th>
            </tr>
          </thead>
          <tbody>
            {d.periods.map((p, i) => (
              <tr key={p.period} title={p.return_basis} className={i % 2 ? "bg-white/40 dark:bg-white/[0.03]" : ""}>
                <td className={`${td} font-medium`}>{p.period.toUpperCase()}</td><td className={td}>{f(p.fund)}</td><td className={td}>{f(p.benchmark)}</td><td className={td}>{f(p.category_average)}</td>
                <td className={`${td} font-medium ${tone(p.excess_vs_benchmark_pp)}`}>{pp(p.excess_vs_benchmark_pp)}</td><td className={`${td} font-medium ${tone(p.excess_vs_category_pp)}`}>{pp(p.excess_vs_category_pp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`mt-6 max-w-4xl text-[13px] leading-7 ${MUTED}`}>
        Periods up to one year show total return, and longer periods show yearly growth.
        <br />
        Similar funds are the {d.peer_universe.eligible} funds in the same category and plan, weighted equally, including this one.
        <br />
        The benchmark is the closest index fund, not the official total-return index, so it can lag slightly. Data is as of {d.as_of ?? "n/a"}.
      </p>
    </section>
  );
}

const METRIC: Record<string, [string, string]> = {
  sharpe: ["Sharpe", "Return earned for each unit of risk. Higher is better."],
  sortino: ["Sortino", "Like Sharpe, but counts only the falls. Higher is better."],
  cap_up: ["Up-market capture", "How much of a rising market the fund captures. Higher is better."],
  cap_down: ["Down-market capture", "How much of a falling market the fund suffers. Lower is better."],
  treynor: ["Treynor", "Return per unit of market sensitivity. For information only."],
  beta: ["Beta", "How strongly the fund moves with its category. For information only."],
};

export function RiskMeasures({ rows }: { rows: FhBreakdownRow[] }) {
  const [period, setPeriod] = useState("3Y");
  const shown = rows.filter((r) => r.period === period);
  return (
    <section className={BOX}>
      <Title hint="Each measure is ranked against similar funds, and the rank decides the points.">Risk and reward</Title>
      <div className="mb-7 inline-flex rounded-full bg-white/50 dark:bg-white/10 border border-white/70 dark:border-white/10 p-1.5 shadow-inner" role="tablist" aria-label="Period">
        {["1Y", "3Y", "5Y"].map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
            className={`rounded-full px-4 py-1 text-[13px] ${period === p ? "bg-white dark:bg-[#1A73E8] shadow-md font-medium" : MUTED}`}>{p}</button>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((r) => {
          const [name, what] = METRIC[r.metric] ?? [r.metric, ""];
          const better = r.percentile != null ? Math.round(r.percentile * 100) : null;
          return (
            <li key={r.metric} className="rounded-2xl border border-white/80 dark:border-white/10 bg-white/60 dark:bg-white/5 p-6 shadow-[0_8px_24px_-12px_rgba(26,115,232,0.3)]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium">{name}</span>
                <span className={`text-[12px] tabular-nums ${MUTED}`}>{r.scored && r.points != null ? `${f(r.points, 1)} of ${f(r.max_points, 1)} points` : r.scored ? "not scored" : "for information"}</span>
              </div>
              <div className="mt-4 flex items-baseline gap-3 tabular-nums"><span className="text-[30px] font-light">{f(r.value)}</span><span className={`text-[12px] ${MUTED}`}>similar funds: {f(r.category_average)}</span></div>
              {r.scored && better != null && (
                <div className="mt-4"><div className="h-2 rounded-full bg-[#CFE0FA]/70 dark:bg-[#2B3644]"><div className="h-2 rounded-full bg-gradient-to-r from-[#4C9AFF] to-[#1A73E8]" style={{ width: `${better}%` }} /></div>
                  <p className={`mt-1 text-[12px] ${MUTED}`}>Ranks ahead of {better}% of {r.peer_count} funds.</p></div>
              )}
              <p className={`mt-4 text-[13px] leading-6 ${MUTED}`}>{what}</p>
              {r.scored && <p className="mt-2 text-[13px] leading-6">{r.text}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Tab = "timeline" | "then" | "after";
export function History({ code }: { code: string }) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [h, setH] = useState<FhHistory | null>(null);
  const [on, setOn] = useState("");
  const [snap, setSnap] = useState("");
  const [then, setThen] = useState("");
  const [tn, setTn] = useState<FhThenNow | null>(null);
  const [out, setOut] = useState<FhOutcome | null>(null);
  useEffect(() => { getFhHistory(code).then(setH).catch(() => setH(null)); getFhOutcome(code).then(setOut).catch(() => setOut(null)); }, [code]);
  const ask = () => on && getFhSnapshotAsOf(code, on).then((s) => setSnap(s.available ? `We have a record from ${formatISTDate(s.snapshot_date ?? "")}, ${s.age_days} days before that date.` : s.message ?? "")).catch(() => setSnap("Could not load."));
  const compare = () => then && getFhThenNow(code, then).then(setTn).catch(() => setTn(null));
  const tabBtn = (k: Tab, label: string) => (
    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1 text-[13px] ${tab === k ? "bg-white dark:bg-[#1A73E8] shadow-md font-medium" : MUTED}`}>{label}</button>
  );
  return (
    <section className={BOX}>
      <Title hint="Every add, review and removal is kept, along with what we knew at the time.">Recommendation history</Title>
      <div className="mb-7 inline-flex rounded-full bg-white/50 dark:bg-white/10 border border-white/70 dark:border-white/10 p-1.5 shadow-inner" role="tablist">{tabBtn("timeline", "Timeline")}{tabBtn("then", "Then and now")}{tabBtn("after", "After we recommended")}</div>
      {tab === "timeline" && (
        <div className="space-y-6 text-[14px] leading-7">
          {h && h.events.length === 0 && <p className={MUTED}>No events have been recorded for this fund yet.</p>}
          {h && h.events.length > 0 && (
            <ol className="space-y-5 border-l-2 border-[#BBD4F8] dark:border-[#2B3644] pl-6">
              {h.events.map((e) => (
                <li key={e.id}><div><strong className="font-medium">{e.event_type}</strong>, {e.effective_date ? formatISTDate(e.effective_date) : "date not recorded"}, by {e.actor}.</div>
                  {(e.reason || e.notes) && <div className={MUTED}>{[e.reason, e.notes].filter(Boolean).join(". ")}</div>}</li>))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span>What did we know on</span><input type="date" value={on} onChange={(e) => setOn(e.target.value)} className="terminal-btn py-1 px-2" /><button type="button" className="terminal-btn py-1 px-3" onClick={ask}>Check</button>
          </div>
          {snap && <p>{snap}</p>}
        </div>
      )}
      {tab === "then" && (
        <div className="space-y-6 text-[14px] leading-7">
          <div className="flex flex-wrap items-center gap-2">
            <span>Compare this record</span>
            <select value={then} onChange={(e) => setThen(e.target.value)} className="terminal-btn py-1 px-2"><option value="">choose one</option>{h?.snapshots.map((s) => <option key={s.id} value={s.id}>{formatISTDate(s.captured_at)}, {s.label}</option>)}</select>
            <span>with today</span><button type="button" className="terminal-btn py-1 px-3" onClick={compare}>Compare</button>
          </div>
          {tn && (
            <>
              <table className="w-full tabular-nums"><thead><tr className={`bg-[#DCE9FF]/70 dark:bg-[#1A73E8]/20 text-left ${MUTED}`}><th className="px-5 py-3 font-medium">What</th><th className="px-5 py-3 font-medium">Then</th><th className="px-5 py-3 font-medium">Now</th><th className="px-5 py-3 font-medium">Change</th></tr></thead>
                <tbody>{tn.rows.map((r) => <tr key={r.dimension} className="border-t border-white/70 dark:border-white/10"><td className="px-5 py-4">{r.dimension}</td><td className="px-5 py-4">{f(r.then)}</td><td className="px-5 py-4">{f(r.now)}</td><td className={`px-5 py-4 font-medium ${typeof r.change === "number" ? tone(r.change) : ""}`}>{f(r.change)}</td></tr>)}</tbody></table>
              {tn.qualitative_events.map((e) => <p key={e.type}><strong className="font-medium">{e.type.replace("_", " ")}</strong> ({e.status}): {e.detail}. {e.explanation}</p>)}
              <p className={MUTED}>{tn.missing_evidence.join(" ")}</p>
            </>
          )}
        </div>
      )}
      {tab === "after" && (
        <div className="space-y-3 text-[13px]">
          {out && out.available === false && <p className={MUTED}>{out.message}</p>}
          {out?.periods && (
            <>
              <ul className="space-y-2">{Object.entries(out.periods).map(([k, p]) => (
                <li key={k}><strong className="font-medium">{k}:</strong>{" "}{p.available && p.while_recommended
                  ? `the fund returned ${f(p.while_recommended.fund?.return_pct)}% (${p.while_recommended.fund?.basis}), ${pp(p.while_recommended.excess_vs_benchmark_pp)} points against the benchmark and ${pp(p.while_recommended.excess_vs_category_pp)} against similar funds.`
                  : p.reason}</li>))}</ul>
              <p className={`text-[12px] ${MUTED}`}>{out.limitations?.join(" ")}</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function useModeExplain(code: string, mode: string, live: string, liveExplain: FhExplain) {
  const [ex, setEx] = useState<FhExplain | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (mode === live) { setEx(liveExplain); return; }
    setLoading(true);
    getFhBreakdown(code, mode).then(setEx).catch(() => setEx(null)).finally(() => setLoading(false));
  }, [code, mode, live, liveExplain]);
  return { ex, loading };
}
