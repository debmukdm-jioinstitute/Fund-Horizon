"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { FundPeers, FundPortfolio } from "@/lib/types";
import { pct } from "@/lib/format";
import { AmcLogo } from "@/components/BrandLogo";
import { getHoldingStockDetail, type StockDetail } from "@/lib/api";

import { useUrlState } from "@/lib/useUrlState";
const ACCENT = "#0176D3";
const PALETTE = ["#0176D3", "#1B96FF", "#00A1A0", "#7F8DE1", "#E8A33D", "#C2548A", "#5C9C4A", "#8A6FD6", "#D9663F", "#4E7FA8", "#9AA7B8", "#3DB8A5"];
const GLASS = "rounded-2xl border border-[var(--glass-border)] bg-[var(--glass)] p-5 shadow-[var(--glass-shadow)]";
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
  const [mode, setMode] = useUrlState<"sip" | "lump">("calc", "sip");
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
    <div className={`${GLASS} space-y-4`}>
      {data.rank && (
        <p className="text-sm opacity-80">
          Ranks <b className="text-[#0176D3] dark:text-[#1B96FF]">#{data.rank}</b> of {data.count} funds in its category by 3Y CAGR.
        </p>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Rank peers by">
        {METRICS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMetric(k)} aria-pressed={metric === k} className={chipCls(metric === k)}>
            {l}
          </button>
        ))}
      </div>
      <ol className="space-y-2">
        {rows.map((p, i) => {
          const me = p.scheme_code === code;
          const v = val(p);
          return (
            <li
              key={p.scheme_code}
              className={`group rounded-xl border p-3 transition-all hover:-translate-y-px hover:bg-[var(--glass-hover)] ${
                me
                  ? "border-[#0176D3] bg-[var(--glass-tint)] shadow-sm"
                  : "border-slate-200/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-900/40"
              }`}
            >
              <div className="flex items-center gap-3 text-sm">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    i === 0
                      ? "bg-amber-400 text-white"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {i + 1}
                </span>

                {/* AMC Brand Logo Tile */}
                <AmcLogo
                  amc={p.amc || ""}
                  className="h-8 w-8 min-w-8 rounded-lg shrink-0 shadow-sm border border-slate-200/70 dark:border-slate-800 bg-white"
                />

                <div className="min-w-0 flex-1 truncate">
                  <Link
                    href={`${hrefBase}/${p.scheme_code}`}
                    className="truncate font-semibold text-slate-900 dark:text-slate-100 hover:text-[#0176D3] dark:hover:text-[#1B96FF] hover:underline"
                  >
                    {p.scheme_name}
                  </Link>
                  {me && (
                    <span className="ml-2 inline-block rounded-full bg-[#0176D3] px-2 py-0.5 text-[10px] font-semibold text-white">
                      This fund
                    </span>
                  )}
                  {p.amc && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {p.amc}
                    </div>
                  )}
                </div>

                <b className="shrink-0 tabular-nums text-slate-900 dark:text-slate-100 font-bold text-sm">
                  {fmt(v)}
                </b>
              </div>

              <div className="mt-2 pl-9">
                <Bar
                  value={Math.abs(v ?? 0)}
                  max={max}
                  color={v != null && v < 0 ? "#E5484D" : me ? ACCENT : "#7F8DE1"}
                  h={6}
                />
              </div>

              <p className="mt-1 pl-9 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-3">
                <span>1Y: <b>{fmt2(p.ret_1y)}</b></span>
                <span>3Y: <b>{fmt2(p.cagr_3y)}</b></span>
                <span>5Y: <b>{fmt2(p.cagr_5y)}</b></span>
                <span>Sharpe: <b>{p.sharpe_3y != null ? p.sharpe_3y.toFixed(2) : "—"}</b></span>
              </p>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] opacity-60">
        Ranked by {label}. Missing values sink to the bottom and are never estimated.
      </p>
    </div>
  );
}

const fmt2 = (v: number | null | undefined) => (v == null ? "—" : pct(v));

const Unavailable = ({ what }: { what: string }) => (
  <p className="text-sm opacity-70">
    {what} is not available for this fund yet: its monthly portfolio file is not ingested. Shown as unavailable, never estimated.
  </p>
);

const Meta = ({ p }: { p: FundPortfolio }) => (
  <p className="text-[11px] opacity-70">
    As of {p.as_of ?? "—"}
    {p.amc ? ` · ${p.amc} monthly disclosure` : ""}
    {p.coverage_pct != null && p.coverage_pct < 99
      ? ` · covers ${p.coverage_pct.toFixed(0)}% of the portfolio (equity only)`
      : ""}
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

/** Interactive Stock Holding Detail Modal */
function HoldingDetailModal({
  holding,
  rank,
  onClose,
}: {
  holding: FundPortfolio["holdings"][number];
  rank: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    if (!holding.name) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getHoldingStockDetail(holding.name)
      .then((res) => {
        if (!cancel) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [holding.name]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-white/80 dark:border-slate-800 bg-white/95 dark:bg-[#10151C]/95 p-6 shadow-2xl space-y-5 text-slate-900 dark:text-slate-100 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-50 text-[#0176D3] dark:bg-blue-950/60 dark:text-[#8AB8FF] border border-blue-200 dark:border-blue-800/60">
                Holding #{rank}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {holding.instrument_type?.toUpperCase() || "EQUITY"}
              </span>
              {holding.sector && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {holding.sector}
                </span>
              )}
            </div>
            <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {holding.name}
            </h3>
            {data?.symbol && (
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                NSE: <b className="text-slate-900 dark:text-slate-100">{data.symbol}</b>
                {holding.isin && <span className="ml-2">· ISIN: {holding.isin}</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Portfolio Stats Highlight */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl border border-blue-100 dark:border-blue-950/60 bg-blue-50/40 dark:bg-blue-950/20">
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Portfolio Weight</div>
            <div className="text-lg font-bold text-[#0176D3] dark:text-[#1B96FF]">
              {(holding.weight_pct ?? 0).toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Live Price</div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {data?.price != null ? `₹${data.price.toFixed(2)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Day Change</div>
            <div
              className={`text-lg font-bold ${
                (data?.change_pct ?? 0) >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {data?.change_pct != null
                ? `${data.change_pct >= 0 ? "+" : ""}${data.change_pct.toFixed(2)}%`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Market Cap</div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {data?.market_cap_fmt || "—"}
            </div>
          </div>
        </div>

        {/* Fundamental Metrics & Valuation */}
        {loading ? (
          <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-[#0176D3]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading stock analysis &amp; live fundamentals…
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Key Valuation &amp; Financial Metrics
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Trailing P/E</span>
                  <b className="text-sm text-slate-900 dark:text-slate-100">{data?.pe_trailing?.toFixed(2) ?? "—"}</b>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Price-to-Book (P/B)</span>
                  <b className="text-sm text-slate-900 dark:text-slate-100">{data?.pb_ratio?.toFixed(2) ?? "—"}</b>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">52-Week Range</span>
                  <b className="text-xs text-slate-900 dark:text-slate-100">
                    {data?.low_52w != null && data?.high_52w != null
                      ? `₹${data.low_52w} – ₹${data.high_52w}`
                      : "—"}
                  </b>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">ROE</span>
                  <b className="text-sm text-slate-900 dark:text-slate-100">{data?.roe != null ? pct(data.roe) : "—"}</b>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Dividend Yield</span>
                  <b className="text-sm text-slate-900 dark:text-slate-100">
                    {data?.dividend_yield != null ? pct(data.dividend_yield) : "—"}
                  </b>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Beta (Volatility)</span>
                  <b className="text-sm text-slate-900 dark:text-slate-100">{data?.beta?.toFixed(2) ?? "—"}</b>
                </div>
              </div>
            </div>

            {/* Profile summary */}
            {data?.profile?.summary && (
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  Business Overview
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-h-36 overflow-y-auto pr-1">
                  {data.profile.summary}
                </p>
              </div>
            )}

            {/* Analyst view */}
            {data?.analyst && (data.analyst.target_mean != null || data.analyst.recommendation != null) && (
              <div className="p-3 rounded-xl border border-slate-200/70 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Analyst Consensus: </span>
                  <b className="text-slate-900 dark:text-slate-100 capitalize">{data.analyst.recommendation || "Neutral"}</b>
                </div>
                {data.analyst.target_mean != null && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Mean Target: </span>
                    <b className="text-[#0176D3] dark:text-[#1B96FF]">₹{data.analyst.target_mean.toFixed(2)}</b>
                    {data.analyst.upside_pct != null && (
                      <span className={`ml-1 font-semibold ${data.analyst.upside_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        ({data.analyst.upside_pct >= 0 ? "+" : ""}{data.analyst.upside_pct}%)
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-200/80 dark:border-slate-800 text-xs">
          <div className="text-slate-400 text-[11px]">
            Data via official fund disclosure &amp; exchange telemetry
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#0176D3] text-white hover:bg-[#015fb0] dark:bg-[#1B96FF] font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function HoldingsTable({ p }: { p: FundPortfolio | null }) {
  const [all, setAll] = useState(false);
  const [selectedHolding, setSelectedHolding] = useState<{ holding: FundPortfolio["holdings"][number]; rank: number } | null>(null);

  if (!p || p.holdings.length === 0) return <Unavailable what="Holdings" />;
  const rows = [...p.holdings].sort((a, b) => (b.weight_pct ?? 0) - (a.weight_pct ?? 0));
  const shown = all ? rows : rows.slice(0, 10);
  const max = rows[0].weight_pct ?? 1;
  const w = (n: number) => rows.slice(0, n).reduce((a, h) => a + (h.weight_pct ?? 0), 0);
  const t1 = w(1), t5 = w(5), t10 = w(10), rest = Math.max(0, p.total_weight_pct - t10);
  const seg: [string, number, string][] = [["Top 1", t1, "#0176D3"], ["Next 4", t5 - t1, "#1B96FF"], ["Next 5", t10 - t5, "#7F8DE1"], ["Rest", rest, "#9AA7B8"]];

  return (
    <div className={`${GLASS} space-y-3`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <p className="text-sm opacity-80">
          {p.summary.holdings_count} holdings · top 10 are <b className="text-[#0176D3] dark:text-[#1B96FF]">{p.summary.top10_concentration_pct?.toFixed(1)}%</b> of the portfolio.
        </p>
        <span className="text-xs text-[#0176D3] dark:text-[#1B96FF] font-medium">
          💡 Click any holding to view full stock metrics &amp; analysis
        </span>
      </div>

      <div>
        <div className="flex h-3 overflow-hidden rounded-full" aria-hidden>
          {seg.map(([l, v, c]) => (
            <div key={l} title={`${l}: ${v.toFixed(1)}%`} style={{ width: `${v}%`, background: c }} className="transition-all duration-500" />
          ))}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] opacity-70">
          {seg.map(([l, v, c]) => (
            <span key={l} className="flex items-center gap-1">
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />
              {l} {v.toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="border-b border-[var(--glass-line)] text-left text-xs opacity-70">
              <th className="py-2 pr-2">Company</th>
              <th className="px-2">Sector</th>
              <th className="w-44 px-2 text-right">Weight</th>
              <th className="w-24 px-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((h, i) => (
              <tr
                key={`${h.isin ?? h.name}-${i}`}
                onClick={() => setSelectedHolding({ holding: h, rank: i + 1 })}
                className="border-b border-[var(--glass-line)] transition-colors hover:bg-[var(--glass-hover)] cursor-pointer group"
              >
                <td className="py-2.5 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs opacity-50 w-5">{i + 1}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-[#0176D3] dark:group-hover:text-[#1B96FF] transition-colors">
                      {h.name}
                    </span>
                  </div>
                </td>
                <td className="px-2 opacity-70 text-xs">{h.sector ?? "—"}</td>
                <td className="px-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Bar value={h.weight_pct ?? 0} max={max} color={PALETTE[i % PALETTE.length]} h={6} />
                    </div>
                    <span className="w-14 text-right tabular-nums font-semibold">
                      {(h.weight_pct ?? 0).toFixed(2)}%
                    </span>
                  </div>
                </td>
                <td className="px-2 text-right">
                  <span className="text-xs text-[#0176D3] dark:text-[#1B96FF] opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                    Analysis →
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-1">
        {rows.length > 10 && (
          <button type="button" onClick={() => setAll(!all)} className={chipCls(false)}>
            {all ? "Show top 10" : `Show all ${rows.length}`}
          </button>
        )}
        <Meta p={p} />
      </div>

      {selectedHolding && (
        <HoldingDetailModal
          holding={selectedHolding.holding}
          rank={selectedHolding.rank}
          onClose={() => setSelectedHolding(null)}
        />
      )}
    </div>
  );
}
