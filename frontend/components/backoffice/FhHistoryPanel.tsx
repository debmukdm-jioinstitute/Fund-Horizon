"use client";

import React, { useEffect, useState } from "react";
import {
  getFhBreakdown, getFhComparison, getFhHistory, getFhOutcome, getFhSnapshotAsOf, getFhThenNow,
  type FhBreakdownRow, type FhComparison, type FhExplain, type FhHistory, type FhOutcome, type FhThenNow,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

const f = (v: number | string | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : v == null ? "n/a" : String(v));
const pp = (v: number | null | undefined) => (typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(2)}` : "n/a");
const MUTED = "text-[#706E6B] dark:text-[#A8B4C4]";
const BOX = "border border-[#E5E5E5] dark:border-[#2B3644] rounded";
const STATUS: Record<string, string> = { complete: "Data complete", partial: "Data partly missing", insufficient_history: "Insufficient history", missing_series: "Missing series", insufficient_peers: "Too few peers", stale_or_bad_data: "Stale or flagged data" };
const REVIEW: Record<string, string> = { none: "No review triggered", investment_review_required: "Investment review required", data_incomplete: "Not assessable: data incomplete" };

export function FhStatusBadges({ data, review, text }: { data?: string; review?: string; text?: string }) {
  if (!data) return null;
  return (
    <p className="text-[12px]" title={text}>
      <span className="rounded bg-[#EEF1F5] dark:bg-[#202936] px-1.5 py-0.5">{STATUS[data] ?? data}</span>{" "}
      {review && <span className="rounded bg-[#EEF1F5] dark:bg-[#202936] px-1.5 py-0.5">{REVIEW[review] ?? review}</span>}
      {text && <span className={`ml-1.5 ${MUTED}`}>{text}</span>}
    </p>
  );
}

function Comparison({ code }: { code: string }) {
  const [d, setD] = useState<FhComparison | null>(null);
  useEffect(() => { getFhComparison(code).then(setD).catch(() => setD(null)); }, [code]);
  if (!d) return null;
  return (
    <section>
      <h3 className="font-semibold">Benchmark and category, shown separately</h3>
      <div className="overflow-x-auto"><table className={`w-full text-[12px] tabular-nums ${BOX}`}>
        <thead><tr className="text-left"><th className="p-1">Period</th><th>Fund %</th><th>Benchmark %</th><th>Category avg %</th><th>vs benchmark (pp)</th><th>vs category (pp)</th></tr></thead>
        <tbody>{d.periods.map((p) => (
          <tr key={p.period} className="border-t border-[#E5E5E5] dark:border-[#2B3644]" title={p.return_basis}>
            <td className="p-1">{p.period}</td><td>{f(p.fund)}</td><td>{f(p.benchmark)}</td><td>{f(p.category_average)}</td><td>{pp(p.excess_vs_benchmark_pp)}</td><td>{pp(p.excess_vs_category_pp)}</td>
          </tr>))}</tbody>
      </table></div>
      <p className={`mt-1 text-[11px] ${MUTED}`}>
        Benchmark: {d.benchmark}. {d.benchmark_basis} Category average: equal-weight mean of {d.peer_universe.eligible} eligible {d.peer_universe.id.replace("|", " / ")} peers, including this fund. Data as of {d.as_of ?? "n/a"}.
        Excess return is a simple difference, not alpha. Imported 3Y alpha {f(d.jensen_alpha_3y.value)} ({d.jensen_alpha_3y.basis}).
      </p>
    </section>
  );
}

const MODE_NAME: Record<string, string> = { legacy: "Legacy (fixed thresholds)", A: "Mode A: category-relative", B: "Mode B: category-relative + quality bonus" };

function Breakdown({ code, current, liveScore }: { code: string; current: string; liveScore: number | null }) {
  const [mode, setMode] = useState(current === "legacy" ? "B" : current);
  const [ex, setEx] = useState<FhExplain | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    getFhBreakdown(code, mode).then(setEx).catch(() => setEx(null)).finally(() => setLoading(false));
  }, [code, mode]);
  const rows = (ex?.filters.find((x) => x.key === "ratios")?.components as unknown as FhBreakdownRow[] | undefined) ?? [];
  const ratios = ex?.filters.find((x) => x.key === "ratios");
  return (
    <section className={`${BOX} p-3 space-y-2`}>
      <h3 className="font-semibold">What changed: category-relative risk scoring</h3>
      <p className="text-[12px]">
        Sharpe, Sortino and capture used to be judged against fixed numbers (for example Sharpe above 1). The new modes rank the fund against its own category
        (same category and plan) and give points by how it compares with those peers. A fund below 1.0 still earns credit if it beats its category.
        The category average is the equal-weight mean of eligible peers, including this fund.
      </p>
      <p className={`text-[12px] ${MUTED}`}>Live scoring is <strong>{MODE_NAME[current] ?? current}</strong>. The modes below are previews and do not change the live score or any recommendation until approved.</p>
      <label className="block text-[12px]">Preview mode{" "}
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="terminal-btn py-0.5 px-1">
          {Object.entries(MODE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {loading && <p className={`text-[12px] ${MUTED}`}>Calculating this mode for every fund in the category (the first load can take about 15 seconds)…</p>}
      {!loading && ex && (
        <>
          <p className="text-[13px]">
            Score in this mode: <strong className="tabular-nums">{f(ex.score, 1)}</strong> ({ex.signal ?? "n/a"}, {ex.rating ? `${ex.rating}★` : "not rated"})
            {liveScore != null && mode !== current && <> versus <strong className="tabular-nums">{f(liveScore, 1)}</strong> live ({f((ex.score ?? 0) - liveScore, 1)} points). </>}
            {ratios && <> Risk-adjusted ratios contribute <strong className="tabular-nums">{f(ratios.points, 1)} / {ratios.weight}</strong>.</>}
          </p>
          {mode === "legacy" ? (
            <p className={`text-[12px] ${MUTED}`}>Legacy has no category percentile; the fixed-threshold rows are in the Filters list below.</p>
          ) : (
            <ul className={`divide-y divide-[#E5E5E5] dark:divide-[#2B3644] ${BOX}`}>
              {rows.map((r) => (
                <li key={`${r.metric}${r.period}`} className="px-2 py-1 text-[12px]">
                  <div className="flex justify-between gap-2"><span>{r.metric.replace("_", " ")} {r.period} · {r.direction.replace(/_/g, " ")}</span>
                    <span className="tabular-nums whitespace-nowrap">{r.scored ? `${f(r.points)} / ${f(r.max_points)} pts` : "informational"}</span></div>
                  <div className={`tabular-nums ${MUTED}`}>Fund {f(r.value)} · category {f(r.category_average)} ({r.peer_count} peers){r.percentile != null ? ` · percentile ${f(r.percentile * 100, 0)}` : ""}{r.absolute_threshold != null ? ` · threshold ${r.absolute_threshold}` : ""} · as of {r.as_of ?? "n/a"}</div>
                  <div>{r.text}</div>
                </li>))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function History({ code }: { code: string }) {
  const [h, setH] = useState<FhHistory | null>(null);
  const [on, setOn] = useState("");
  const [snap, setSnap] = useState<string>("");
  const [then, setThen] = useState("");
  const [tn, setTn] = useState<FhThenNow | null>(null);
  const [out, setOut] = useState<FhOutcome | null>(null);
  useEffect(() => { getFhHistory(code).then(setH).catch(() => setH(null)); getFhOutcome(code).then(setOut).catch(() => setOut(null)); }, [code]);
  const ask = () => on && getFhSnapshotAsOf(code, on).then((s) => setSnap(s.available ? `Snapshot taken ${formatISTDate(s.snapshot_date ?? "")} (${s.age_days} days before ${formatISTDate(on)}), ${s.label}.` : s.message ?? "")).catch(() => setSnap("Could not load."));
  const compare = () => then && getFhThenNow(code, then).then(setTn).catch(() => setTn(null));
  return (
    <details open>
      <summary className="cursor-pointer font-semibold text-[13px]">Recommendation history, then vs now, outcome</summary>
      <div className="mt-1 space-y-2 text-[12px]">
        {h && h.events.length === 0 && <p className={MUTED}>No recommendation events recorded for this fund.</p>}
        {h && h.events.length > 0 && (
          <ul className={`divide-y divide-[#E5E5E5] dark:divide-[#2B3644] ${BOX}`}>
            {h.events.map((e) => (
              <li key={e.id} className="px-2 py-1"><strong>{e.event_type}</strong> · {e.effective_date ? formatISTDate(e.effective_date) : "date not recorded"} · {e.actor}
                <div className={MUTED}>{e.reason ?? ""}{e.notes ? ` · ${e.notes}` : ""}</div></li>))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span>What did we know on</span><input type="date" value={on} onChange={(e) => setOn(e.target.value)} className="terminal-btn py-0.5 px-1" />
          <button type="button" className="terminal-btn py-0.5 px-2" onClick={ask}>Check</button>
        </div>
        {snap && <p>{snap}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span>Then vs now: compare snapshot</span>
          <select value={then} onChange={(e) => setThen(e.target.value)} className="terminal-btn py-0.5 px-1">
            <option value="">choose…</option>
            {h?.snapshots.map((s) => <option key={s.id} value={s.id}>{formatISTDate(s.captured_at)} · {s.label} · {s.kind}</option>)}
          </select>
          <button type="button" className="terminal-btn py-0.5 px-2" onClick={compare}>Compare with live</button>
        </div>
        {tn && (
          <div className="overflow-x-auto"><table className={`w-full tabular-nums ${BOX}`}>
            <thead><tr className="text-left"><th className="p-1">Dimension</th><th>Then</th><th>Now</th><th>Change</th></tr></thead>
            <tbody>{tn.rows.map((r) => <tr key={r.dimension} className="border-t border-[#E5E5E5] dark:border-[#2B3644]"><td className="p-1">{r.dimension}</td><td>{f(r.then)}</td><td>{f(r.now)}</td><td>{f(r.change)}</td></tr>)}</tbody>
          </table>
            {tn.qualitative_events.map((e) => <p key={e.type}><strong>{e.type}</strong> ({e.status}): {e.detail}. {e.explanation}</p>)}
            <p className={MUTED}>{tn.missing_evidence.join(" ")}</p></div>
        )}
        {out && (out.available === false ? <p className={MUTED}>{out.message}</p> : out.periods && (
          <div>
            <p className="font-semibold">Outcome since the recorded recommendation date</p>
            <ul>{Object.entries(out.periods).map(([k, p]) => (
              <li key={k}>{k}: {p.available && p.while_recommended ? `fund ${f(p.while_recommended.fund?.return_pct)}% (${p.while_recommended.fund?.basis}), vs benchmark ${pp(p.while_recommended.excess_vs_benchmark_pp)} pp, vs category ${pp(p.while_recommended.excess_vs_category_pp)} pp` : p.reason}</li>))}</ul>
            <p className={MUTED}>{out.limitations?.join(" ")}</p>
          </div>))}
      </div>
    </details>
  );
}

export default function FhHistoryPanel({ code, mode, score }: { code: string; mode?: string; score?: number | null }) {
  return <div className="space-y-3"><Comparison code={code} /><Breakdown code={code} current={mode ?? "legacy"} liveScore={score ?? null} /><History code={code} /></div>;
}
