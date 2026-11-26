"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getNextWaveDetail, type NwHistory, type NwPeerRow, type NwPeers } from "@/lib/backoffice";

import { useUrlState } from "@/lib/useUrlState";
const MUTED = "text-[#5B6B85] dark:text-[#A8B4C4]";
const CARD = "rounded-3xl border border-white/70 bg-white/80 p-5 shadow-[0_10px_30px_-14px_rgba(26,115,232,0.28)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6";
const POS = "text-[#137333] dark:text-[#7EE2A0]";
const NEG = "text-[#B3261E] dark:text-[#FDA29B]";
const PART_NAMES: [string, string][] = [["quartile", "Quartile"], ["momentum", "Momentum"], ["acceleration", "Acceleration"], ["consistency", "Consistency"], ["risk", "Risk skill"], ["size", "Fund size"], ["cost", "Cost"]];
const n1 = (v: number | null | undefined, d = 1) => (typeof v === "number" ? v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "n/a");

function Tiles({ items }: { items: { label: string; value: string; hint?: string | null }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className="rounded-2xl bg-white/80 px-4 py-3 dark:bg-white/10">
          <p className={`text-[12px] uppercase tracking-wide ${MUTED}`}>{t.label}</p>
          <p className="mt-0.5 text-[20px] font-medium leading-tight tabular-nums">{t.value}</p>
          {t.hint && <p className={`text-[13px] ${MUTED}`}>{t.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/** Responsive SVG chart. bars: one signed series (green above zero, red below). lines: fund against the category median. */
function Chart({ chart }: { chart: NonNullable<NwHistory["chart"]> }) {
  const [hover, setHover] = useState<number | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  const W = 920, H = 300, L = 54, R = 12, T = 12, B = 30;
  const all = chart.series.flatMap((s) => s.values);
  let lo = Math.min(...all, chart.kind === "bars" ? 0 : Infinity), hi = Math.max(...all, chart.kind === "bars" ? 0 : -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const N = chart.x.length;
  const X = (i: number) => L + (chart.kind === "bars" ? (i + 0.5) / N : N > 1 ? i / (N - 1) : 0.5) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const labelEvery = Math.max(1, Math.ceil(N / 7));
  const bw = Math.max(1.5, ((W - L - R) / N) * 0.7);
  const colors = ["#0176D3", "#E8A317"];
  const fmt = (v: number) => `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${chart.unit}`;
  const move = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(N - 1, Math.round(chart.kind === "bars" ? f * N - 0.5 : f * (N - 1)))));
  };
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[16px] font-medium">{chart.title}</h4>
        <div className={`flex flex-wrap gap-x-4 text-[13px] ${MUTED}`} aria-hidden>
          {chart.kind === "lines" && chart.series.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: colors[i] }} />{s.name}</span>)}
          {chart.kind === "bars" && <><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#2E844A]" />Ahead</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#B42332]" />Behind</span></>}
        </div>
      </div>
      <p className={`mt-1 min-h-[1.5rem] text-[14px] tabular-nums ${hover == null ? MUTED : ""}`} aria-live="polite">
        {hover == null ? "Move over the chart for the value at each point." : <><strong>{chart.x[hover]}</strong>{chart.series.map((s, i) => <span key={s.name}> · {chart.kind === "bars" ? "" : `${s.name} `}<span style={{ color: chart.kind === "bars" ? undefined : colors[i] }} className={chart.kind === "bars" ? (s.values[hover] >= 0 ? POS : NEG) : ""}>{fmt(s.values[hover])}</span></span>)}</>}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full touch-pan-y select-none" role="img" aria-label={chart.title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="stroke-[#DCE6F5] dark:stroke-[#2B3644]" strokeWidth="1" />
            <text x={L - 8} y={Y(t) + 4} textAnchor="end" fontSize="12" className="fill-[#5B6B85] dark:fill-[#A8B4C4]">{t.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</text>
          </g>
        ))}
        {lo < 0 && hi > 0 && <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} className="stroke-[#5B6B85] dark:stroke-[#A8B4C4]" strokeWidth="1.5" />}
        {chart.x.map((x, i) => i % labelEvery === 0 && <text key={x + i} x={X(i)} y={H - 8} textAnchor="middle" fontSize="12" className="fill-[#5B6B85] dark:fill-[#A8B4C4]">{x}</text>)}
        {chart.kind === "bars" && chart.series[0].values.map((v, i) => (
          <rect key={i} x={X(i) - bw / 2} width={bw} y={on ? Math.min(Y(v), Y(0)) : Y(0)} height={on ? Math.abs(Y(v) - Y(0)) : 0} rx="1.5" fill={v >= 0 ? "#2E844A" : "#B42332"} opacity={hover == null || hover === i ? 1 : 0.45}
            style={{ transition: "y 700ms ease-out, height 700ms ease-out, opacity 120ms" }} />
        ))}
        {chart.kind === "lines" && chart.series.map((s, k) => (
          <polyline key={s.name} fill="none" stroke={colors[k]} strokeWidth={k === 0 ? 2.6 : 2} strokeDasharray={k === 0 ? undefined : "6 4"} strokeLinejoin="round" strokeLinecap="round"
            points={s.values.map((v, i) => `${X(i)},${on ? Y(v) : Y(lo)}`).join(" ")} style={{ transition: "all 800ms ease-out" }} />
        ))}
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} className="stroke-[#0176D3]" strokeWidth="1" strokeDasharray="3 3" />}
        {hover != null && chart.kind === "lines" && chart.series.map((s, k) => <circle key={s.name} cx={X(hover)} cy={Y(s.values[hover])} r="4.5" fill={colors[k]} stroke="white" strokeWidth="1.5" />)}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} />
      </svg>
    </div>
  );
}

function History({ d }: { d: NwHistory }) {
  if (!d.available) return <div className={CARD}><p className="text-[16px]">{d.reason ?? "Not available."}</p></div>;
  return (
    <div className="space-y-5 sm:space-y-6">
      {d.tiles && <Tiles items={d.tiles} />}
      <div className="grid gap-5 sm:gap-6 xl:grid-cols-12 [&>*]:min-w-0">
        <section className={`${CARD} xl:col-span-4`}>
          <h3 className="text-[18px] font-medium">What the history says</h3>
          <ul className="mt-3 space-y-3">
            {(d.insights ?? []).map((t) => <li key={t} className="flex gap-2.5 text-[15px] leading-relaxed"><span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0176D3]" /><span>{t}</span></li>)}
          </ul>
          <p className={`mt-4 border-t border-[#DCE6F5] pt-3 text-[13px] dark:border-white/10 ${MUTED}`}>{d.basis}</p>
        </section>
        <div className="space-y-5 sm:space-y-6 xl:col-span-8 [&>*]:min-w-0">
          {d.chart && <section className={CARD}><Chart chart={d.chart} /></section>}
          {d.table && (
            <section className={CARD}>
              <div className="max-h-[60vh] overflow-auto rounded-2xl border border-[#DCE6F5] dark:border-white/10">
                <table className="w-full min-w-[34rem] border-collapse text-left text-[14px] tabular-nums">
                  <thead className="sticky top-0 z-[1] bg-[#EAF1FC] text-[12px] uppercase tracking-wide dark:bg-[#16263B]">
                    <tr>{d.table.columns.map((c, i) => <th key={c} className={`px-3 py-2.5 font-medium ${i ? "text-right" : "sticky left-0 bg-[#EAF1FC] dark:bg-[#16263B]"}`}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {d.table.rows.map((r, ri) => (
                      <tr key={ri} className="border-t border-[#E6EEF9] odd:bg-white/50 hover:bg-[#EAF5FE] dark:border-white/5 dark:odd:bg-white/[0.03] dark:hover:bg-[#10243A]">
                        {r.map((c, ci) => {
                          const [txt, tone] = Array.isArray(c) ? c : [c, null];
                          return <td key={ci} className={`px-3 py-2 ${ci ? "text-right" : "sticky left-0 bg-inherit font-medium"} ${tone === "pos" ? POS : tone === "neg" ? NEG : ""}`}>{txt}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Peers({ d, unit }: { d: NwPeers; unit: string }) {
  const [view, setView] = useUrlState<"all" | "top" | "near">("nwview", "all");
  const meRef = useRef<HTMLTableRowElement | null>(null);
  const rows = useMemo(() => {
    if (view === "top") return d.rows.slice(0, 10);
    if (view === "near") { const i = d.rows.findIndex((r) => r.this); return i < 0 ? d.rows.slice(0, 10) : d.rows.slice(Math.max(0, i - 5), i + 6); }
    return d.rows;
  }, [d.rows, view]);
  useEffect(() => { const t = setTimeout(() => meRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 450); return () => clearTimeout(t); }, [view]);
  const vals = d.rows.map((r) => r.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pos = (v: number) => 2 + ((v - lo) / span) * 96;
  const me = d.rows.find((r) => r.this);
  const diffTone = (r: NwPeerRow) => (me ? ((r.value - me.value) * (d.higher_is_better ? 1 : -1) > 0 ? NEG : POS) : "");
  return (
    <div className="space-y-5 sm:space-y-6">
      <Tiles items={[
        { label: "This fund's rank", value: d.this_rank ? `${d.this_rank} of ${d.peers_with_data}` : "n/a", hint: d.percentile != null ? `better than ${n1(d.percentile, 0)}% of peers` : null },
        { label: "This fund", value: me ? `${n1(me.value, 2)}${unit}` : "n/a" }, { label: "Peer median", value: `${n1(d.median, 2)}${unit}` },
        { label: d.higher_is_better ? "Best peer" : "Cheapest peer", value: `${n1(d.best, 2)}${unit}`, hint: `Weakest: ${n1(d.worst, 2)}${unit}` }]} />
      <section className={CARD}>
        <h3 className="text-[18px] font-medium">Where this fund sits among {d.peers_with_data} peers</h3>
        <p className={`text-[13px] ${MUTED}`}>{d.category}, {d.plan} plan. Each dot is a fund. {d.higher_is_better ? "Further right is better." : "Further left is better (lower cost)."} Blue is this fund, the line is the peer median.</p>
        <div className="relative mt-6 h-12" aria-hidden>
          <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded bg-[#DCE6F5] dark:bg-[#2B3644]" />
          {d.median != null && <div className="absolute top-1 h-10 w-0.5 bg-[#5B6B85]" style={{ left: `${pos(d.median)}%` }} />}
          {d.rows.map((r) => <span key={r.code} title={`${r.name}: ${n1(r.value, 2)}${unit}`} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${r.this ? "z-[2] h-5 w-5 bg-[#0176D3] ring-4 ring-[#0176D3]/25" : "h-2.5 w-2.5 bg-[#9BB3D6] dark:bg-[#6F86A8]"}`} style={{ left: `${pos(r.value)}%` }} />)}
        </div>
        <div className={`mt-1 flex justify-between text-[12px] tabular-nums ${MUTED}`}><span>{n1(lo, 1)}{unit}</span><span>{n1(hi, 1)}{unit}</span></div>
      </section>
      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[18px] font-medium">Peer ranking</h3>
          <div className="flex gap-1.5 rounded-full bg-white/80 p-1 dark:bg-white/10" role="tablist">
            {([["all", "All"], ["top", "Top 10"], ["near", "Around this fund"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${view === k ? "bg-[#0176D3] text-white" : MUTED + " hover:bg-white dark:hover:bg-white/10"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="mt-4 max-h-[65vh] overflow-auto rounded-2xl border border-[#DCE6F5] dark:border-white/10">
          <table className="w-full min-w-[40rem] border-collapse text-left text-[14px] tabular-nums">
            <thead className="sticky top-0 z-[2] bg-[#EAF1FC] text-[12px] uppercase tracking-wide dark:bg-[#16263B]">
              <tr>
                <th className="px-3 py-2.5 font-medium">Rank</th><th className="sticky left-0 bg-[#EAF1FC] px-3 py-2.5 font-medium dark:bg-[#16263B]">Fund</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th><th className="px-3 py-2.5 text-right font-medium">Against this fund</th>
                <th className="px-3 py-2.5 text-right font-medium">Next Wave</th>
                {PART_NAMES.map(([k, l]) => <th key={k} className="hidden px-3 py-2.5 text-right font-medium lg:table-cell">{l}</th>)}
                <th className="hidden px-3 py-2.5 text-right font-medium md:table-cell">History</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} ref={r.this ? meRef : undefined} className={`border-t border-[#E6EEF9] dark:border-white/5 ${r.this ? "bg-[#DCEBFF] font-medium dark:bg-[#12335A]" : "odd:bg-white/50 hover:bg-[#EAF5FE] dark:odd:bg-white/[0.03] dark:hover:bg-[#10243A]"}`}>
                  <td className="px-3 py-2">{r.rank}</td>
                  <td className="sticky left-0 max-w-[16rem] bg-inherit px-3 py-2"><span className="block truncate">{r.name.replace(/ - (Regular|Direct) Plan - Growth$/i, "")}{r.this && <span className="ml-2 rounded bg-[#0176D3] px-1.5 py-0.5 text-[10px] uppercase text-white">This fund</span>}</span>{r.amc && <span className={`block truncate text-[12px] font-normal ${MUTED}`}>{r.amc}</span>}<span className="block text-[13px] font-medium sm:hidden">{n1(r.value, 2)}{unit}{r.nw_score != null ? ` · Next Wave ${n1(r.nw_score)}` : ""}</span></td>
                  <td className="px-3 py-2 text-right">{n1(r.value, 2)}{unit}</td>
                  <td className={`px-3 py-2 text-right ${r.this ? "" : diffTone(r)}`}>{r.this || !me ? "this fund" : `${r.value - me.value >= 0 ? "+" : ""}${n1(r.value - me.value, 2)}`}</td>
                  <td className="px-3 py-2 text-right">{r.nw_score != null ? n1(r.nw_score) : "n/a"}{r.nw_pass && <span className="ml-1.5 rounded bg-[#2E844A] px-1 py-0.5 text-[9px] uppercase text-white">NW</span>}</td>
                  {PART_NAMES.map(([k]) => <td key={k} className="hidden px-3 py-2 text-right lg:table-cell">{r.parts[k] != null ? n1(r.parts[k]) : "n/a"}</td>)}
                  <td className="hidden px-3 py-2 text-right md:table-cell">{r.history_years != null ? `${n1(r.history_years)} yrs` : "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={`mt-3 text-[13px] ${MUTED}`}>Peers are funds in the same category and plan with data for this input. The Next Wave columns show each peer&apos;s own score and points by part, so you can see which parts lift the leaders.</p>
      </section>
    </div>
  );
}

export default function NextWaveDetail({ code, input, label, unit, fundName, initialKind, onClose }: { code: string; input: string; label: string; unit: string; fundName: string; initialKind: "history" | "peers"; onClose: () => void }) {
  const [kind, setKind] = useState(initialKind);
  const [res, setRes] = useState<{ kind: "history" | "peers"; input: string; d: NwHistory | NwPeers } | null>(null);
  const data = res && res.kind === kind && res.input === input ? res.d : null; // never render one view with the other view's data
  const [err, setErr] = useState("");
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(true); }, []);
  useEffect(() => {
    const ac = new AbortController();
    setErr("");
    getNextWaveDetail<NwHistory | NwPeers>(code, input, kind, ac.signal).then((d) => setRes({ kind, input, d })).catch((e) => { if (!ac.signal.aborted) setErr(e instanceof Error ? e.message : "Could not load this detail. Try again in a moment."); });
    return () => ac.abort();
  }, [code, input, kind]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`fixed inset-0 z-[10000] overflow-y-auto bg-gradient-to-br from-[#E4EEFF] via-[#F2F7FF] to-[#DDEBFF] transition-all duration-300 motion-reduce:transition-none dark:from-[#0B1626] dark:via-[#0E1B2E] dark:to-[#0A1422] ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}
      role="dialog" data-nw-sheet aria-label={`${label}: ${kind === "peers" ? "peer ranking" : "history"}`}>
      <header className="sticky top-0 z-10 border-b border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-[#0E1B2E]/70">
        <div className="mx-auto flex max-w-[110rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-12">
          <div className="min-w-0">
            <p className={`text-[12px] uppercase tracking-wide ${MUTED}`}>FH Next Wave · {fundName}</p>
            <h2 className="truncate text-[20px] font-medium text-[#1B2B45] dark:text-[#EDF2F7]">{label}</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-full bg-white/80 p-1 dark:bg-white/10" role="tablist">
              {([["history", "History"], ["peers", "Peers"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-full px-4 py-1.5 text-[14px] transition-colors ${kind === k ? "bg-[#0176D3] text-white" : MUTED + " hover:bg-white dark:hover:bg-white/10"}`}>{l}</button>
              ))}
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-full border border-white/70 bg-white/80 px-4 py-2 text-[14px] shadow-sm hover:bg-white dark:border-white/10 dark:bg-white/10">Close ✕</button>
          </div>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-[110rem] px-4 py-6 text-[15px] text-[#1B2B45] dark:text-[#EDF2F7] sm:px-8 lg:px-12 lg:py-8">
        {err && <div role="alert" className={`${CARD} text-[#B3261E]`}>{err}</div>}
        {!data && !err && (
          <div className="space-y-5" aria-busy="true"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/70 dark:bg-white/10" />)}</div><div className="h-72 animate-pulse rounded-3xl bg-white/70 dark:bg-white/10" /></div>
        )}
        {data && kind === "history" && <History d={data as NwHistory} />}
        {data && kind === "peers" && <Peers d={data as NwPeers} unit={unit} />}
      </main>
    </div>,
    document.body,
  );
}
