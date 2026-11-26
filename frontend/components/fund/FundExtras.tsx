"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FundPeers, FundPortfolio } from "@/lib/types";
import { pct } from "@/lib/format";

const ACCENT = "#0176D3";
const PALETTE = ["#0176D3", "#1B96FF", "#00A1A0", "#7F8DE1", "#E8A33D", "#C2548A", "#5C9C4A", "#8A6FD6", "#D9663F", "#4E7FA8", "#9AA7B8", "#3DB8A5"];
const GLASS = "rounded-2xl border border-[var(--glass-border)] bg-[var(--glass)] p-4 shadow-[var(--glass-shadow)]";
const CHIP = "rounded-full border px-3 py-1 text-xs font-medium transition-all active:scale-95";
const chipCls = (on: boolean) => `${CHIP} ${on ? "border-[#0176D3] bg-[#0176D3] text-white shadow-md" : "border-[var(--glass-line)] hover:bg-[var(--glass-hover)]"}`;

/** Bar whose width animates from 0 when it scrolls into view. */
function Bar({ value, max, color = ACCENT, h = 8 }: { value: number; max: number; color?: string; h?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full overflow-hidden rounded-full bg-[var(--glass-line)]" style={{ height: h }}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: on ? `${Math.max(0, Math.min(100, (value / max) * 100))}%` : "0%", background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
    </div>
  );
}

/** Eases a number toward its target so changing sliders feels alive. */
function useCountUp(target: number) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setV(target); from.current = target; return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      const cur = a + (target - a) * e;
      from.current = cur; setV(cur);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** SIP / lumpsum what-if using the fund's own trailing CAGR. Illustrative, not a forecast. */
export function ReturnsCalculator({ cagr }: { cagr: { "3Y": number | null; "5Y": number | null } }) {
  const [mode, setMode] = useState<"sip" | "lump">("sip");
  const [amount, setAmount] = useState(10000);
  const [years, setYears] = useState(5);
  const [basis, setBasis] = useState<"3Y" | "5Y">(cagr["5Y"] != null ? "5Y" : "3Y");
  const [hover, setHover] = useState<number | null>(null);
  const rate = cagr[basis];
  const r = rate ?? 0;
  const mr = Math.pow(1 + r, 1 / 12) - 1;
  const at = (y: number) => {
    const invested = mode === "sip" ? amount * 12 * y : amount;
    const value = mode === "sip" ? (mr === 0 ? invested : amount * ((Math.pow(1 + mr, y * 12) - 1) / mr) * (1 + mr)) : amount * Math.pow(1 + r, y);
    return { invested, value };
  };
  const final = at(years);
  const shownYear = hover ?? years;
  const shown = at(shownYear);
  const animated = useCountUp(shown.value);
  if (rate == null) return <p className="text-sm opacity-70">Not enough history to illustrate returns for this fund.</p>;
  const pts = Array.from({ length: years + 1 }, (_, y) => ({ y, ...at(y) }));
  const maxV = final.value || 1;
  const X = (y: number) => (y / years) * 300, Y = (v: number) => 112 - (v / maxV) * 100;
  const valueLine = pts.map((p) => `${X(p.y)},${Y(p.value)}`).join(" ");
  const investedLine = pts.map((p) => `${X(p.y)},${Y(p.invested)}`).join(" ");
  const gainShare = shown.value > 0 ? ((shown.value - shown.invested) / shown.value) * 100 : 0;
  const multiple = shown.invested > 0 ? shown.value / shown.invested : 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className={`${GLASS} space-y-4 text-sm`}>
        <div className="inline-flex rounded-full border border-[var(--glass-line)] p-0.5" role="group" aria-label="Investment type">
          {(["sip", "lump"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`rounded-full px-4 py-1.5 text-xs font-medium transition-all ${mode === m ? "bg-[#0176D3] text-white shadow" : "opacity-70 hover:opacity-100"}`}>
              {m === "sip" ? "Monthly SIP" : "One-time"}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="flex justify-between text-xs opacity-70"><span>{mode === "sip" ? "Monthly amount" : "Amount"}</span><b className="text-base text-[#0176D3] dark:text-[#1B96FF]">{inr(amount)}</b></span>
          <input type="range" min={mode === "sip" ? 500 : 5000} max={mode === "sip" ? 100000 : 5000000} step={mode === "sip" ? 500 : 5000} value={amount} onChange={(e) => setAmount(+e.target.value)} className="w-full accent-[#0176D3]" />
        </label>
        <label className="block">
          <span className="flex justify-between text-xs opacity-70"><span>Period</span><b className="text-base text-[#0176D3] dark:text-[#1B96FF]">{years} years</b></span>
          <input type="range" min={1} max={30} value={years} onChange={(e) => { setYears(+e.target.value); setHover(null); }} className="w-full accent-[#0176D3]" />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs opacity-90">
          <span className="opacity-70">Rate used:</span>
          {(["3Y", "5Y"] as const).map((b) => cagr[b] != null && (
            <button key={b} type="button" onClick={() => setBasis(b)} aria-pressed={basis === b} className={chipCls(basis === b)}>{b} CAGR {pct(cagr[b]!)}</button>
          ))}
        </div>
      </div>
      <div className={`${GLASS} text-sm`}>
        <p className="text-xs opacity-70">Illustrative value {hover != null ? `at year ${hover}` : `after ${years} years`}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-[#0176D3] dark:text-[#1B96FF]" data-testid="calc-value">{inr(animated)}</p>
        <p className="text-xs opacity-70">Your money becomes <b>{multiple.toFixed(2)}×</b> · {gainShare.toFixed(0)}% of the value is growth</p>
        <svg viewBox="0 0 300 120" className="mt-3 h-36 w-full touch-none select-none" role="img" aria-label="Growth of invested amount versus estimated value over time"
          onPointerMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(years, Math.round(((e.clientX - b.left) / b.width) * years)))); }}
          onPointerLeave={() => setHover(null)}>
          <defs><linearGradient id="calcFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" /><stop offset="100%" stopColor={ACCENT} stopOpacity="0" /></linearGradient></defs>
          <polygon points={`0,112 ${valueLine} 300,112`} fill="url(#calcFill)" />
          <polyline points={investedLine} fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 3" />
          <polyline points={valueLine} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinejoin="round" />
          {hover != null && (<g><line x1={X(hover)} x2={X(hover)} y1="4" y2="112" stroke={ACCENT} strokeOpacity="0.4" /><circle cx={X(hover)} cy={Y(shown.value)} r="4" fill={ACCENT} /><circle cx={X(hover)} cy={Y(shown.invested)} r="3" fill="currentColor" fillOpacity="0.6" /></g>)}
        </svg>
        <div className="flex justify-between text-[10px] opacity-60"><span>Today</span><span>Hover or drag to scrub the years</span><span>{years}y</span></div>
        <div className="mt-3" aria-hidden><div className="flex h-3 overflow-hidden rounded-full"><div className="bg-slate-400/60 transition-all duration-500" style={{ width: `${100 - gainShare}%` }} /><div className="bg-emerald-500 transition-all duration-500" style={{ width: `${gainShare}%` }} /></div></div>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <div><dt className="flex items-center gap-1.5 text-xs opacity-70"><i className="inline-block h-2 w-2 rounded-full bg-slate-400/70" />Invested</dt><dd className="font-semibold tabular-nums">{inr(shown.invested)}</dd></div>
          <div className="text-right"><dt className="flex items-center justify-end gap-1.5 text-xs opacity-70"><i className="inline-block h-2 w-2 rounded-full bg-emerald-500" />Est. gain</dt><dd className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{inr(shown.value - shown.invested)}</dd></div>
        </dl>
        <p className="mt-3 text-[11px] opacity-70">Assumes the fund repeats its past {basis} CAGR every year. Past performance is not a guide to future returns; this is not a forecast.</p>
      </div>
    </div>
  );
}

type Metric = "cagr_3y" | "ret_1y" | "cagr_5y" | "sharpe_3y";
const METRICS: [Metric, string][] = [["cagr_3y", "3Y CAGR"], ["ret_1y", "1 Year"], ["cagr_5y", "5Y CAGR"], ["sharpe_3y", "Sharpe 3Y"]];

/** Leaderboard: pick a metric, peers re-rank and their bars race to the new order. */
export function PeerTable({ data, code, hrefBase = "/funds" }: { data: FundPeers; code: string; hrefBase?: string }) {
  const [metric, setMetric] = useState<Metric>("cagr_3y");
  const val = (p: FundPeers["peers"][number]) => p[metric];
  const rows = [...data.peers].sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity));
  const max = Math.max(...rows.map((p) => Math.abs(val(p) ?? 0)), 1e-9);
  const fmt = (v: number | null | undefined) => (v == null ? "—" : metric === "sharpe_3y" ? v.toFixed(2) : pct(v));
  const label = METRICS.find(([k]) => k === metric)![1];
  return (
    <div className={`${GLASS} space-y-3`}>
      {data.rank && <p className="text-sm opacity-80">Ranks <b className="text-[#0176D3] dark:text-[#1B96FF]">#{data.rank}</b> of {data.count} funds in its category by 3Y CAGR.</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rank peers by">
        {METRICS.map(([k, l]) => <button key={k} type="button" onClick={() => setMetric(k)} aria-pressed={metric === k} className={chipCls(metric === k)}>{l}</button>)}
      </div>
      <ol className="space-y-1.5">
        {rows.map((p, i) => {
          const me = p.scheme_code === code, v = val(p);
          return (
            <li key={p.scheme_code} className={`group rounded-xl border px-3 py-2 transition-all hover:-translate-y-px hover:bg-[var(--glass-hover)] ${me ? "border-[#0176D3] bg-[var(--glass-tint)] shadow" : "border-transparent"}`}>
              <div className="flex items-center gap-3 text-sm">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i === 0 ? "bg-amber-400 text-white" : "bg-[var(--glass-line)]"}`}>{i + 1}</span>
                <Link href={`${hrefBase}/${p.scheme_code}`} className="min-w-0 flex-1 truncate hover:underline">{p.scheme_name}{me && <span className="ml-2 rounded-full bg-[#0176D3] px-2 py-0.5 text-[10px] font-semibold text-white">This fund</span>}</Link>
                <b className="shrink-0 tabular-nums">{fmt(v)}</b>
              </div>
              <div className="mt-1.5 pl-9"><Bar value={Math.abs(v ?? 0)} max={max} color={v != null && v < 0 ? "#E5484D" : me ? ACCENT : "#7F8DE1"} h={6} /></div>
              <p className="mt-1 hidden pl-9 text-[11px] opacity-70 group-hover:block group-focus-within:block">1Y {fmt2(p.ret_1y)} · 3Y {fmt2(p.cagr_3y)} · 5Y {fmt2(p.cagr_5y)} · Sharpe {p.sharpe_3y != null ? p.sharpe_3y.toFixed(2) : "—"}</p>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] opacity-60">Ranked by {label}. Missing values sink to the bottom and are never estimated.</p>
    </div>
  );
}
const fmt2 = (v: number | null | undefined) => (v == null ? "—" : pct(v));

const Unavailable = ({ what }: { what: string }) => (
  <p className="text-sm opacity-70">{what} is not available for this fund yet: its monthly portfolio file is not ingested. Shown as unavailable, never estimated.</p>
);

const Meta = ({ p }: { p: FundPortfolio }) => (
  <p className="text-[11px] opacity-70">
    As of {p.as_of ?? "—"}{p.amc ? ` · ${p.amc} monthly disclosure` : ""}
    {p.coverage_pct != null && p.coverage_pct < 99 ? ` · covers ${p.coverage_pct.toFixed(0)}% of the portfolio (equity only)` : ""}
  </p>
);

export function AssetAllocation({ p }: { p: FundPortfolio | null }) {
  const [hi, setHi] = useState<number | null>(null);
  if (!p) return <Unavailable what="Asset allocation" />;
  const eq = p.holdings.filter((h) => h.instrument_type === "equity").reduce((a, h) => a + (h.weight_pct ?? 0), 0);
  const cash = p.summary.cash_pct ?? 0;
  const other = Math.max(0, p.total_weight_pct - eq - cash);
  const rows = ([["Equity", eq, ACCENT], ["Cash & equivalents", cash, "#9AA7B8"], ["Debt / other", other, "#E8A33D"]] as [string, number, string][]).filter(([, v]) => v > 0.005);
  const total = rows.reduce((a, [, v]) => a + v, 0) || 1;
  const R = 15.915; // circumference 100
  let acc = 0;
  const focus = hi != null ? rows[hi] : rows[0];
  return (
    <div className={`${GLASS} space-y-3`}>
      <div className="flex flex-wrap items-center gap-6">
        <svg viewBox="0 0 42 42" className="h-40 w-40 -rotate-90" role="img" aria-label="Asset allocation donut">
          <circle cx="21" cy="21" r={R} fill="none" stroke="var(--glass-line)" strokeWidth="5" />
          {rows.map(([l, v, c], i) => { const len = (v / total) * 100, off = -acc; acc += len; return (
            <circle key={l} cx="21" cy="21" r={R} fill="none" stroke={c} strokeWidth={hi === i ? 6.5 : 5} strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={off} className="cursor-pointer transition-all duration-300" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} />
          ); })}
          <g className="rotate-90 origin-center"><text x="21" y="21.5" textAnchor="middle" className="fill-current text-[6px] font-bold">{focus[1].toFixed(1)}%</text><text x="21" y="27" textAnchor="middle" className="fill-current text-[2.6px] opacity-60">{focus[0]}</text></g>
        </svg>
        <ul className="min-w-[180px] flex-1 space-y-2 text-sm">
          {rows.map(([l, v, c], i) => (
            <li key={l} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} className={`flex items-center justify-between rounded-lg px-2 py-1 transition-colors ${hi === i ? "bg-[var(--glass-hover)]" : ""}`}><span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span><b className="tabular-nums">{v.toFixed(2)}%</b></li>
          ))}
        </ul>
      </div>
      <Meta p={p} />
    </div>
  );
}

export function SectorAllocation({ p }: { p: FundPortfolio | null }) {
  const [hi, setHi] = useState<string | null>(null);
  if (!p || p.sectors.length === 0) return <Unavailable what="Sector allocation" />;
  const list = p.sectors.slice(0, 12);
  const max = list[0].weight_pct;
  const top3 = list.slice(0, 3).reduce((a, s) => a + s.weight_pct, 0);
  return (
    <div className={`${GLASS} space-y-3`}>
      <p className="text-sm opacity-80">Top 3 sectors hold <b className="text-[#0176D3] dark:text-[#1B96FF]">{top3.toFixed(1)}%</b> of the portfolio. Hover a sector to spotlight it.</p>
      <div className="flex h-4 overflow-hidden rounded-full" aria-hidden>
        {list.map((s, i) => <div key={s.sector} title={`${s.sector} ${s.weight_pct.toFixed(2)}%`} onMouseEnter={() => setHi(s.sector)} onMouseLeave={() => setHi(null)} className="transition-opacity duration-200" style={{ width: `${s.weight_pct}%`, background: PALETTE[i % PALETTE.length], opacity: hi && hi !== s.sector ? 0.25 : 1 }} />)}
      </div>
      <div className="space-y-2">
        {list.map((s, i) => (
          <div key={s.sector} onMouseEnter={() => setHi(s.sector)} onMouseLeave={() => setHi(null)} className={`rounded-lg px-2 py-1 transition-all ${hi === s.sector ? "bg-[var(--glass-hover)]" : ""} ${hi && hi !== s.sector ? "opacity-50" : ""}`}>
            <div className="mb-1 flex justify-between text-sm"><span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />{s.sector}</span><b className="tabular-nums">{s.weight_pct.toFixed(2)}%</b></div>
            <Bar value={s.weight_pct} max={max} color={PALETTE[i % PALETTE.length]} />
          </div>
        ))}
      </div>
      {p.unclassified_pct > 0 && <p className="text-xs opacity-70">Unclassified (cash, debt, other): {p.unclassified_pct.toFixed(2)}%</p>}
      <Meta p={p} />
    </div>
  );
}

export function HoldingsTable({ p }: { p: FundPortfolio | null }) {
  const [all, setAll] = useState(false);
  if (!p || p.holdings.length === 0) return <Unavailable what="Holdings" />;
  const rows = [...p.holdings].sort((a, b) => (b.weight_pct ?? 0) - (a.weight_pct ?? 0));
  const shown = all ? rows : rows.slice(0, 10);
  const max = rows[0].weight_pct ?? 1;
  const w = (n: number) => rows.slice(0, n).reduce((a, h) => a + (h.weight_pct ?? 0), 0);
  const t1 = w(1), t5 = w(5), t10 = w(10), rest = Math.max(0, p.total_weight_pct - t10);
  const seg: [string, number, string][] = [["Top 1", t1, "#0176D3"], ["Next 4", t5 - t1, "#1B96FF"], ["Next 5", t10 - t5, "#7F8DE1"], ["Rest", rest, "#9AA7B8"]];
  return (
    <div className={`${GLASS} space-y-3`}>
      <p className="text-sm opacity-80">{p.summary.holdings_count} holdings · top 10 are <b className="text-[#0176D3] dark:text-[#1B96FF]">{p.summary.top10_concentration_pct?.toFixed(1)}%</b> of the portfolio.</p>
      <div>
        <div className="flex h-3 overflow-hidden rounded-full" aria-hidden>{seg.map(([l, v, c]) => <div key={l} title={`${l}: ${v.toFixed(1)}%`} style={{ width: `${v}%`, background: c }} className="transition-all duration-500" />)}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] opacity-70">{seg.map(([l, v, c]) => <span key={l} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{l} {v.toFixed(1)}%</span>)}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="border-b border-[var(--glass-line)] text-left text-xs opacity-70"><th className="py-1.5 pr-2">Company</th><th className="px-2">Sector</th><th className="w-44 px-2 text-right">Weight</th></tr></thead>
          <tbody>
            {shown.map((h, i) => (
              <tr key={`${h.isin ?? h.name}-${i}`} className="border-b border-[var(--glass-line)] transition-colors hover:bg-[var(--glass-hover)]">
                <td className="py-1.5 pr-2"><span className="mr-2 text-xs opacity-50">{i + 1}</span>{h.name}</td>
                <td className="px-2 opacity-70">{h.sector ?? "—"}</td>
                <td className="px-2"><div className="flex items-center gap-2"><div className="flex-1"><Bar value={h.weight_pct ?? 0} max={max} color={PALETTE[i % PALETTE.length]} h={6} /></div><span className="w-14 text-right tabular-nums">{(h.weight_pct ?? 0).toFixed(2)}%</span></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && <button type="button" onClick={() => setAll(!all)} className={chipCls(false)}>{all ? "Show top 10" : `Show all ${rows.length}`}</button>}
      <Meta p={p} />
    </div>
  );
}
