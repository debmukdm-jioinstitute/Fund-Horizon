"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Area,
  AreaChart,
  ComposedChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer as RechartsRC,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getMutualFundPerformance, MfPerformance, MfScreenerRow } from "@/lib/backoffice";
import FundQuartile from "./FundQuartile";
import { AmcLogo } from "@/components/BrandLogo";
import Logo from "@/components/Logo";
import { formatISTDate } from "@/lib/terminal-format";

const BLUE = "#0176D3";
const CAT = "#9CA3AF";
const UP = "#0B7A4B";
const DOWN = "#B42332";
const RANGES = [
  { k: "1Y", m: 12 },
  { k: "3Y", m: 36 },
  { k: "5Y", m: 60 },
  { k: "10Y", m: 120 },
  { k: "All", m: 0 },
] as const;

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const f = (v: unknown, d = 2, unit = "") => (n(v) === undefined ? "-" : `${(v as number).toFixed(d)}${unit}`);
const tone = (v?: number) => (v === undefined ? "" : v > 0 ? "text-[#0B7A4B] dark:text-[#5FD3A2]" : v < 0 ? "text-[#B42332] dark:text-[#FF7D86]" : "");

function Stat({ label, value, sub, signed }: { label: string; value: string; sub?: string; signed?: number }) {
  return (
    <div className="terminal-panel p-3">
      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">{label}</div>
      <div className={`text-[18px] font-medium tabular-nums mt-0.5 ${tone(signed) || "text-[#181818] dark:text-[#EDF2F7]"}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">{sub}</div>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="terminal-panel overflow-hidden">
      <div className="px-3 py-2 border-b border-[#E5E5E5] dark:border-[#2B3644] flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7]">{title}</span>
        {note && <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">{note}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// Print layout is not observed by ResizeObserver, so charts get a fixed width while printing (A4 content width).
const PrintCtx = React.createContext(false);
function ResponsiveContainer({ children }: { children: React.ReactElement }) {
  const printing = React.useContext(PrintCtx);
  return <RechartsRC width={printing ? 660 : "100%"} height="100%">{children}</RechartsRC>;
}

const axis = { fontSize: 10, fill: "#706E6B" };

export default function MfOnePager({ row, onClose }: { row: MfScreenerRow | null; onClose: () => void }) {
  const [perf, setPerf] = useState<MfPerformance | null | undefined>(undefined);
  const [range, setRange] = useState<(typeof RANGES)[number]["k"]>("5Y");
  const [printing, setPrinting] = useState(false);
  const code = row?.code;

  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => flushSync(() => setPrinting(false));
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);

  useEffect(() => {
    setPerf(undefined);
    if (!code) return;
    let off = false;
    getMutualFundPerformance(code)
      .then((p) => !off && setPerf(p))
      .catch(() => !off && setPerf(null));
    return () => {
      off = true;
    };
  }, [code]);

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    document.body.classList.add("print-onepager");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "unset";
      document.body.classList.remove("print-onepager");
    };
  }, [row, onClose]);

  const series = useMemo(() => {
    const h = [...(perf?.history ?? [])].filter((x) => x.date && x.nav !== undefined).sort((a, b) => a.date.localeCompare(b.date));
    let peak = 0;
    return h.map((x) => {
      peak = Math.max(peak, x.nav as number);
      return { ...x, dd: ((x.nav as number) / peak - 1) * 100 };
    });
  }, [perf]);

  const view = useMemo(() => {
    const m = RANGES.find((r) => r.k === range)?.m ?? 0;
    const s = m ? series.slice(-m - 1) : series;
    const base = s[0]?.nav;
    // Match by year-month: the fund's in-progress month carries its real date, the benchmark's carries the month-end label.
    const bm = new Map((perf?.benchmark?.history ?? []).map((b) => [b.date.slice(0, 7), b.nav]));
    const bbase = s.length ? bm.get(s[0].date.slice(0, 7)) : undefined;
    return s.map((x) => {
      const b = bm.get(x.date.slice(0, 7));
      return {
        ...x,
        growth: base ? ((x.nav as number) / base) * 100 : undefined,
        bench: bbase && b ? (b / bbase) * 100 : undefined,
      };
    });
  }, [series, range, perf]);
  const hasBench = view.some((x) => x.bench !== undefined);
  const last = view[view.length - 1];
  const gap = hasBench && last?.growth !== undefined && last.bench !== undefined ? last.growth - last.bench : undefined;

  // Calendar-year return from the last NAV of each year (first year is partial, so it is skipped).
  const yearly = useMemo(() => {
    const last = new Map<string, number>();
    series.forEach((x) => last.set(x.date.slice(0, 4), x.nav as number));
    const ys = Array.from(last.keys()).sort();
    return ys.slice(1).map((y, i) => ({ year: y, ret: (last.get(y)! / last.get(ys[i])! - 1) * 100 }));
  }, [series]);

  if (!row) return null;

  const r = row;
  const horizons = [
    ["1M", "ret_1m", "ret_1m_cat"],
    ["3M", "ret_3m", "ret_3m_cat"],
    ["6M", "ret_6m", ""],
    ["1Y", "ret_1y", "ret_1y_cat"],
    ["3Y", "cagr_3y", "cagr_3y_cat"],
    ["5Y", "cagr_5y", "cagr_5y_cat"],
    ["10Y", "cagr_10y", "cagr_10y_cat"],
  ].flatMap(([k, a, c]) => (n(r[a]) === undefined ? [] : [{ h: k, fund: n(r[a]) as number, cat: c ? n(r[c]) : undefined }]));

  const radar = [
    ["Performance", r.perf],
    ["Portfolio", r.port],
    ["Operations", r.ops],
    ["Risk vs Reward", r.risk],
  ].map(([k, v]) => ({ k: k as string, v: typeof v === "number" ? (v / 25) * 100 : 0, raw: v }));

  const name = r.name.replace(/ - (Direct|Regular) Plan - Growth$/i, "");
  const stars = n(r.stars) ?? 0;
  const hi = n(r.hi52);
  const lo = n(r.lo52);
  const nav = n(r.nav);
  const pos = hi !== undefined && lo !== undefined && nav !== undefined && hi > lo ? Math.max(0, Math.min(100, ((nav - lo) / (hi - lo)) * 100)) : undefined;

  return createPortal(
    <PrintCtx.Provider value={printing}>
    <div className="mf-onepager fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${name} one-pager`} onClick={onClose}>
      <div className="mf-op-inner absolute inset-0 bg-[#F3F3F3] dark:bg-[#10151C] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 bg-[#0B2A4A] print:[print-color-adjust:exact] text-white">
          <Logo variant="dark" size="sm" href="#" />
          <span className="hidden sm:block text-[11px] uppercase tracking-wider opacity-80">Fund One-Pager · NAV as of {r.nav_date ? formatISTDate(String(r.nav_date)) : "-"}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => window.print()} className="text-[11px] px-2.5 py-1 rounded border border-white/40 hover:bg-white/10">
              Print / PDF
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="text-[11px] px-2.5 py-1 rounded border border-white/40 hover:bg-white/10">
              ✕ Close
            </button>
          </div>
        </div>

        <div className="mf-op-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 space-y-4">
            <div className="terminal-panel p-4 border-l-4 border-l-[#0176D3] flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase">
                  {r.is_fh_recommended && <span className="px-1.5 py-0.5 rounded bg-[#0176D3] text-white">★ FH Recommended</span>}
                  <span className="px-1.5 py-0.5 rounded border border-[#E5E5E5] dark:border-[#2B3644]">{r.plan} · Growth</span>
                  <span className="px-1.5 py-0.5 rounded border border-[#E5E5E5] dark:border-[#2B3644]">{String(r.cat_label ?? r.cat)}</span>
                  <span className="px-1.5 py-0.5 rounded border border-[#E5E5E5] dark:border-[#2B3644]">AMFI {r.code}</span>
                </div>
                <h2 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] leading-snug">{name}</h2>
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] flex items-center gap-2">
                  {r.amc && <AmcLogo amc={r.amc} className="h-6 min-w-6 max-w-[4rem] text-[8px]" />}
                  {r.amc ?? "-"} · Benchmark: {String(r.benchmark ?? "-")}
                </div>
              </div>
              <div className="flex items-center gap-5">
                <div className="text-right">
                  <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">FH Checklist Score</div>
                  <div className="text-[30px] leading-none font-medium text-[#0176D3] dark:text-[#1B96FF] tabular-nums">
                    {f(r.score, 0)}
                    <span className="text-[13px] text-[#706E6B]"> / 100</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">FH Star Rating</div>
                  <div className="text-[18px] text-[#B45309] dark:text-[#FBBF24]">{stars ? "★".repeat(stars) + "☆".repeat(5 - stars) : "-"}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
              <Stat label="NAV" value={nav === undefined ? "-" : `₹${nav.toFixed(4)}`} sub={`Day ${f(r.day_chg, 2, "%")}`} signed={n(r.day_chg)} />
              <Stat label="1Yr return" value={f(r.ret_1y, 2, "%")} sub={`cat. ${f(r.ret_1y_cat, 2, "%")}`} signed={n(r.ret_1y)} />
              <Stat label="3Yr CAGR" value={f(r.cagr_3y, 2, "%")} sub={`cat. ${f(r.cagr_3y_cat, 2, "%")}`} signed={n(r.cagr_3y)} />
              <Stat label="5Yr CAGR" value={f(r.cagr_5y, 2, "%")} sub={`cat. ${f(r.cagr_5y_cat, 2, "%")}`} signed={n(r.cagr_5y)} />
              <Stat label="Expense ratio" value={f(r.ter, 2, "%")} sub="Net, Growth" />
              <Stat label="AUM" value={n(r.aum_cr) === undefined ? "-" : `₹${Math.round(r.aum_cr as number).toLocaleString("en-IN")} Cr`} sub={`${f(r.history_years, 1)} yrs history`} />
            </div>

            <Panel title={hasBench ? "Fund vs benchmark: growth of 100" : "Growth of 100"} note="Rebased to 100 at the start of the window">
              <div className="flex gap-1 mb-2">
                {RANGES.map((x) => (
                  <button key={x.k} type="button" onClick={() => setRange(x.k)} className={`${range === x.k ? "terminal-btn-accent" : "terminal-btn"} text-[11px] py-0.5 px-2`}>
                    {x.k}
                  </button>
                ))}
              </div>
              {perf === undefined ? (
                <div className="h-[260px] flex items-center justify-center text-[12px] text-[#706E6B]">Loading history…</div>
              ) : view.length < 2 ? (
                <div className="h-[260px] flex items-center justify-center text-[12px] text-[#706E6B]">No NAV history for this scheme.</div>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer>
                    <ComposedChart data={view} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fhg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={BLUE} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF33" />
                      <XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(0, 7)} minTickGap={40} />
                      <YAxis tick={axis} domain={["auto", "auto"]} width={42} />
                      <Tooltip formatter={(v, k) => [Number(v).toFixed(2), String(k)]} labelFormatter={(d) => formatISTDate(String(d))} />
                      {hasBench && <Legend wrapperStyle={{ fontSize: 11 }} />}
                      <Area isAnimationActive={false} type="monotone" dataKey="growth" name="This fund" stroke={BLUE} strokeWidth={2} fill="url(#fhg)" />
                      {hasBench && <Line isAnimationActive={false} type="monotone" dataKey="bench" name={perf?.benchmark?.name ?? "Benchmark"} stroke="#B45309" strokeWidth={1.8} strokeDasharray="5 3" dot={false} connectNulls />}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-2 text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">
                {hasBench ? (
                  <>
                    Benchmark: {perf?.benchmark?.name}, drawn with {perf?.benchmark?.proxy_name} as a tracker (index fund NAV, net of its expense ratio, so it lags the TRI slightly).
                    {gap !== undefined && (
                      <span className={`ml-1 font-medium ${tone(gap)}`}>
                        Over {range}: fund {gap >= 0 ? "ahead of" : "behind"} benchmark by {Math.abs(gap).toFixed(1)} pts.
                      </span>
                    )}
                  </>
                ) : (
                  <>Benchmark: {String(r.benchmark ?? "-")}. No index-tracking fund exists in the dataset for this category, so no benchmark line is drawn.</>
                )}
              </div>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Returns vs category average" note="Same category and plan">
                <div className="h-[250px]">
                  <ResponsiveContainer>
                    <BarChart data={horizons} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF33" vertical={false} />
                      <XAxis dataKey="h" tick={axis} />
                      <YAxis tick={axis} width={36} unit="%" />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar isAnimationActive={false} dataKey="fund" name="This fund" fill={BLUE} radius={[3, 3, 0, 0]} />
                      <Bar isAnimationActive={false} dataKey="cat" name="Category avg" fill={CAT} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title="FH checklist breakdown" note="Each pillar scored out of 25, shown as %">
                <div className="h-[250px]">
                  <ResponsiveContainer>
                    <RadarChart data={radar} outerRadius="72%">
                      <PolarGrid stroke="#9CA3AF66" />
                      <PolarAngleAxis dataKey="k" tick={axis} />
                      <Radar isAnimationActive={false} dataKey="v" stroke={BLUE} fill={BLUE} fillOpacity={0.3} />
                      <Tooltip formatter={(_v, _n2, p) => `${(p.payload as { raw: unknown }).raw ?? "-"} / 25`} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title="Quartile rankings" note="Advisorkhoj, within category">
                <FundQuartile name={r.name} cat={r.cat} />
              </Panel>

              <Panel title="Calendar-year returns" note="From month-end NAV history">
                {yearly.length === 0 ? (
                  <div className="h-[250px] flex items-center justify-center text-[12px] text-[#706E6B]">Not enough history.</div>
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer>
                      <BarChart data={yearly} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF33" vertical={false} />
                        <XAxis dataKey="year" tick={axis} />
                        <YAxis tick={axis} width={36} unit="%" />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                        <Bar isAnimationActive={false} dataKey="ret" name="Return">
                          {yearly.map((y) => (
                            <Cell key={y.year} fill={y.ret >= 0 ? UP : DOWN} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>

              <Panel title="Drawdown from peak" note="Max drawdown (all) shown below">
                {series.length < 2 ? (
                  <div className="h-[250px] flex items-center justify-center text-[12px] text-[#706E6B]">Not enough history.</div>
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer>
                      <AreaChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF33" />
                        <XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} />
                        <YAxis tick={axis} width={36} unit="%" />
                        <Tooltip formatter={(v) => [`${Number(v).toFixed(2)}%`, "Drawdown"]} labelFormatter={(d) => formatISTDate(String(d))} />
                        <Area isAnimationActive={false} type="monotone" dataKey="dd" stroke={DOWN} fill={DOWN} fillOpacity={0.2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>

              <Panel title="Rolling returns" note="1Y / 3Y / 5Y annualised, from NAV history">
                {series.length < 2 ? (
                  <div className="h-[250px] flex items-center justify-center text-[12px] text-[#706E6B]">Not enough history.</div>
                ) : (
                  <div className="h-[250px]">
                    <ResponsiveContainer>
                      <LineChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF33" />
                        <XAxis dataKey="date" tick={axis} tickFormatter={(d: string) => d.slice(0, 4)} minTickGap={40} />
                        <YAxis tick={axis} width={36} unit="%" />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} labelFormatter={(d) => formatISTDate(String(d))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line isAnimationActive={false} type="monotone" dataKey="r1y" name="1Y" stroke={BLUE} dot={false} strokeWidth={1.8} connectNulls />
                        <Line isAnimationActive={false} type="monotone" dataKey="r3y" name="3Y" stroke="#0B7A4B" dot={false} strokeWidth={1.8} connectNulls />
                        <Line isAnimationActive={false} type="monotone" dataKey="r5y" name="5Y" stroke="#B45309" dot={false} strokeWidth={1.8} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>

              <Panel title="Risk &amp; ratios" note="3-year, vs category median">
                <div className="grid grid-cols-3 gap-2.5">
                  <Stat label="Alpha" value={f(r.alpha_3y, 2, "%")} signed={n(r.alpha_3y)} />
                  <Stat label="Beta" value={f(r.beta_3y)} />
                  <Stat label="Sharpe" value={f(r.sharpe_3y)} />
                  <Stat label="Sortino" value={f(r.sortino_3y)} />
                  <Stat label="Std dev" value={f(r.vol_3y, 2, "%")} />
                  <Stat label="Max drawdown" value={f(r.max_dd_all, 2, "%")} signed={n(r.max_dd_all)} sub={`3Y ${f(r.max_dd_3y, 2, "%")}`} />
                </div>
                {pos !== undefined && (
                  <div className="mt-4">
                    <div className="flex justify-between text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">
                      <span>52W low ₹{lo!.toFixed(2)}</span>
                      <span>52W high ₹{hi!.toFixed(2)}</span>
                    </div>
                    <div className="relative mt-1 h-2 rounded bg-[#E5E5E5] dark:bg-[#2B3644]">
                      <div className="absolute top-1/2 h-4 w-1.5 -translate-y-1/2 rounded bg-[#0176D3]" style={{ left: `calc(${pos}% - 3px)` }} />
                    </div>
                    <div className="mt-1 text-center text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">NAV sits {pos.toFixed(0)}% of the way up its 52-week range</div>
                  </div>
                )}
              </Panel>
            </div>

            <p className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] pb-4">
              Source: AMFI + mfapi.in. Alpha, beta and Treynor are measured against the median of the fund&apos;s category and plan, not an index. FH Star Rating is Fund Horizon&apos;s own
              risk-adjusted rank, not Morningstar&apos;s. Past performance is not a guide to future returns.
            </p>
          </div>
        </div>
      </div>
    </div>
    </PrintCtx.Provider>,
    document.body,
  );
}
