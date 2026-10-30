"use client";

import React, { useEffect, useState } from "react";
import {
  getFhBreakdown, getFhComparison, getFhHistory, getFhOutcome, getFhSnapshotAsOf, getFhThenNow,
  type FhBreakdownRow, type FhComparison, type FhExplain, type FhHistory, type FhOutcome, type FhThenNow,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

export const MUTED = "text-[#5F6368] dark:text-[#A8B4C4]";
export const BOX = "rounded-2xl border border-[#E3E6EA] dark:border-[#2B3644] bg-white dark:bg-[#151C26] p-5";
const f = (v: number | string | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : v == null ? "n/a" : String(v));
const pp = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "n/a");
const tone = (v: number | null | undefined) => (typeof v !== "number" ? "" : v > 0 ? "text-[#1E7B3A] dark:text-[#6FD493]" : v < 0 ? "text-[#B3261E] dark:text-[#F2B8B5]" : "");

export function Title({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <div className="mb-4"><h3 className="text-[16px] font-medium text-[#202124] dark:text-[#EDF2F7]">{children}</h3>{hint && <p className={`mt-1 text-[13px] ${MUTED}`}>{hint}</p>}</div>;
}

const DATA: Record<string, string> = { complete: "Data is complete", partial: "Some data is missing", insufficient_history: "Fund is too new", missing_series: "A data series is missing", insufficient_peers: "Too few similar funds", stale_or_bad_data: "Data is out of date" };
const REVIEW: Record<string, string> = { none: "No review needed", investment_review_required: "Needs an investment review", data_incomplete: "Cannot be judged yet" };
export function StatusChips({ data, review, text }: { data?: string; review?: string; text?: string }) {
  if (!data) return null;
  const chip = "rounded-full bg-[#F1F3F4] dark:bg-[#202936] px-3 py-1 text-[12px]";
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
  return (
    <section className={BOX}>
      <Title hint={`Returns in percent. Benchmark: ${d.benchmark}.`}>How it compares</Title>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[13px] tabular-nums">
          <thead><tr className={`text-left ${MUTED}`}><th className="px-1 pb-2 font-normal">Period</th><th className="pb-2 font-normal">This fund</th><th className="pb-2 font-normal">Benchmark</th><th className="pb-2 font-normal">Similar funds</th><th className="pb-2 font-normal">Ahead of benchmark</th><th className="pb-2 font-normal">Ahead of similar funds</th></tr></thead>
          <tbody>{d.periods.map((p) => (
            <tr key={p.period} className="border-t border-[#EEF0F2] dark:border-[#2B3644]" title={p.return_basis}>
              <td className="px-1 py-2.5">{p.period.toUpperCase()}</td><td>{f(p.fund)}</td><td>{f(p.benchmark)}</td><td>{f(p.category_average)}</td>
              <td className={tone(p.excess_vs_benchmark_pp)}>{pp(p.excess_vs_benchmark_pp)}</td><td className={tone(p.excess_vs_category_pp)}>{pp(p.excess_vs_category_pp)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className={`mt-4 text-[12px] leading-relaxed ${MUTED}`}>
        Periods up to 1 year show total return, longer periods show yearly growth. Similar funds are the {d.peer_universe.eligible} funds in the same category and plan, weighted equally, including this one.
        The benchmark is the closest index fund, not the official total-return index, so it can lag slightly. Data as of {d.as_of ?? "n/a"}.
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
      <div className="mb-4 inline-flex rounded-full bg-[#F1F3F4] dark:bg-[#202936] p-1" role="tablist" aria-label="Period">
        {["1Y", "3Y", "5Y"].map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
            className={`rounded-full px-4 py-1 text-[13px] ${period === p ? "bg-white dark:bg-[#151C26] shadow-sm font-medium" : MUTED}`}>{p}</button>
        ))}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {shown.map((r) => {
          const [name, what] = METRIC[r.metric] ?? [r.metric, ""];
          const better = r.percentile != null ? Math.round(r.percentile * 100) : null;
          return (
            <li key={r.metric} className="rounded-xl border border-[#EEF0F2] dark:border-[#2B3644] p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium">{name}</span>
                <span className={`text-[12px] tabular-nums ${MUTED}`}>{r.scored && r.points != null ? `${f(r.points, 1)} of ${f(r.max_points, 1)} points` : r.scored ? "not scored" : "for information"}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2 tabular-nums"><span className="text-[22px]">{f(r.value)}</span><span className={`text-[12px] ${MUTED}`}>similar funds: {f(r.category_average)}</span></div>
              {r.scored && better != null && (
                <div className="mt-2"><div className="h-1.5 rounded-full bg-[#EEF0F2] dark:bg-[#2B3644]"><div className="h-1.5 rounded-full bg-[#1A73E8]" style={{ width: `${better}%` }} /></div>
                  <p className={`mt-1 text-[12px] ${MUTED}`}>Ranks ahead of {better}% of {r.peer_count} funds.</p></div>
              )}
              <p className={`mt-2 text-[12px] leading-relaxed ${MUTED}`}>{what}</p>
              {r.scored && <p className="mt-1 text-[12px] leading-relaxed">{r.text}</p>}
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
    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1 text-[13px] ${tab === k ? "bg-white dark:bg-[#151C26] shadow-sm font-medium" : MUTED}`}>{label}</button>
  );
  return (
    <section className={BOX}>
      <Title hint="Every add, review and removal is kept, along with what we knew at the time.">Recommendation history</Title>
      <div className="mb-4 inline-flex rounded-full bg-[#F1F3F4] dark:bg-[#202936] p-1" role="tablist">{tabBtn("timeline", "Timeline")}{tabBtn("then", "Then and now")}{tabBtn("after", "After we recommended")}</div>
      {tab === "timeline" && (
        <div className="space-y-4 text-[13px]">
          {h && h.events.length === 0 && <p className={MUTED}>No events have been recorded for this fund yet.</p>}
          {h && h.events.length > 0 && (
            <ol className="space-y-3 border-l border-[#E3E6EA] dark:border-[#2B3644] pl-4">
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
        <div className="space-y-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span>Compare this record</span>
            <select value={then} onChange={(e) => setThen(e.target.value)} className="terminal-btn py-1 px-2"><option value="">choose one</option>{h?.snapshots.map((s) => <option key={s.id} value={s.id}>{formatISTDate(s.captured_at)}, {s.label}</option>)}</select>
            <span>with today</span><button type="button" className="terminal-btn py-1 px-3" onClick={compare}>Compare</button>
          </div>
          {tn && (
            <>
              <table className="w-full tabular-nums"><thead><tr className={`text-left ${MUTED}`}><th className="pb-2 font-normal">What</th><th className="pb-2 font-normal">Then</th><th className="pb-2 font-normal">Now</th><th className="pb-2 font-normal">Change</th></tr></thead>
                <tbody>{tn.rows.map((r) => <tr key={r.dimension} className="border-t border-[#EEF0F2] dark:border-[#2B3644]"><td className="py-2">{r.dimension}</td><td>{f(r.then)}</td><td>{f(r.now)}</td><td className={typeof r.change === "number" ? tone(r.change) : ""}>{f(r.change)}</td></tr>)}</tbody></table>
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
