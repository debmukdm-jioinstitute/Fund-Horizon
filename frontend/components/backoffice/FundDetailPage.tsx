"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AddToWatchlist from "./AddToWatchlist";
import {
  addMfShortlist, getMfExplain, getMfManager, getMfPeers, getMfResearchDetail, getMutualFundPerformance,
  type FhExplain, type MfManagerInfo, type MfPerformance, type MfResearchDetail, type MfScreenerRow, type MutualFundItem,
} from "@/lib/backoffice";
import { useRecommended } from "@/lib/recommended";
import { AmcLogo } from "@/components/BrandLogo";
import FactsheetList from "@/components/backoffice/FactsheetList";
import FhScorePanel from "@/components/backoffice/FhScorePanel";
import FundQuartile from "@/components/backoffice/FundQuartile";
import MfManagerDrawer from "@/components/backoffice/MfManagerDrawer";
import MfResearchBlocks from "@/components/backoffice/MfResearchBlocks";
import { NavChart } from "@/components/FundCharts";
import FundTabs from "@/components/fund/FundTabs";
import { AssetAllocation, HoldingsTable, PeerTable, ReturnsCalculator, SectorAllocation } from "@/components/fund/FundExtras";
import type { FundPeers, FundPortfolio } from "@/lib/types";
import SignedValue from "@/components/terminal/SignedValue";
import { shortDisplayName } from "@/components/backoffice/mfDisplayName";
import { blankDash, classifyPlanOption, isNavStale } from "@/lib/backoffice-display";
import { formatISTDate, formatNumber } from "@/lib/terminal-format";

const TABS = [
  { id: "fund-price", label: "Fund Price" }, { id: "performance", label: "Performance" }, { id: "peers", label: "Peer Comparison" },
  { id: "calculator", label: "Calculator" }, { id: "asset-allocation", label: "Asset Allocation" }, { id: "sector-allocation", label: "Sector Allocation" },
  { id: "holdings", label: "Holdings" }, { id: "fund-overview", label: "Overview" }, { id: "about", label: "About" },
  { id: "compare", label: "Compare Funds" }, { id: "faqs", label: "FAQs" },
];
const MUTED = "text-[#706E6B] dark:text-[#A8B4C4]";
const H2 = "text-[20px] sm:text-[22px] font-semibold text-[#181818] dark:text-[#EDF2F7]";

/** A value tile, tinted green or red by sign like the design; plain when `plain`. */
function Tile({ label, value, unit = "%", plain = false, digits = 2 }: { label: string; value?: number | string | null; unit?: string; plain?: boolean; digits?: number }) {
  const n = typeof value === "number" ? value : undefined;
  const tint = plain || n === undefined ? "bg-[#F3F3F3] dark:bg-[#171E27]" : n < 0 ? "bg-[#FDE7E9] dark:bg-[#3A1519]" : "bg-[#E6F4EA] dark:bg-[#10291B]";
  return (
    <div className={`rounded-md p-3 ${tint}`}>
      <div className={`text-[12px] ${MUTED}`}>{label}</div>
      <div className="mt-1 text-[17px] font-semibold tabular-nums">
        {n === undefined ? "—" : plain ? `${n.toFixed(digits)}${unit}` : <SignedValue value={n} unit={unit} decimals={digits} />}
      </div>
    </div>
  );
}

const Section = ({ id, title, sub, children }: { id?: string; title?: string; sub?: string; children: React.ReactNode }) => (
  <section id={id} className="space-y-3 scroll-mt-28">
    {title && (
      <div>
        <h2 className={H2}>{title}</h2>
        {sub && <p className={`text-[13px] ${MUTED}`}>{sub}</p>}
      </div>
    )}
    {children}
  </section>
);

const PAGE_SIZES = [5, 10, 25, 50];

function NavHistory({ perf, code }: { perf: MfPerformance; code: string }) {
  const [view, setView] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [year, setYear] = useState("all");
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(0);
  const years = useMemo(() => Array.from(new Set(perf.history.map((h) => h.date.slice(0, 4)))), [perf.history]);
  const rows = useMemo(
    () =>
      perf.history.filter((h, i) => {
        const m = Number(h.date.slice(5, 7));
        return (i === 0 || view === "monthly" || (view === "quarterly" ? m % 3 === 0 : m === 3)) && (year === "all" || h.date.startsWith(year));
      }),
    [perf.history, view, year],
  );
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  const exportCsv = () => {
    const csv = ["Date,NAV,1M %,1Y %,3Y %,5Y %", ...rows.map((h) => [h.date, h.nav, h.r1m, h.r1y, h.r3y, h.r5y].map((v) => v ?? "").join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `nav-history-${code}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Section id="nav-history" title="NAV history" sub="Browse historical snapshots without a long scroll.">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-[#E5E5E5] dark:border-[#2B3644]">
          {(["monthly", "quarterly", "yearly"] as const).map((v) => (
            <button key={v} type="button" onClick={() => { setView(v); setPage(0); }} className={`px-3 py-1.5 text-[13px] capitalize ${view === v ? "bg-[#E8F1FB] text-[#0B5CAB] dark:bg-[#10243A] dark:text-[#1B96FF]" : ""}`}>{v}</button>
          ))}
        </div>
        <select aria-label="Year" value={year} onChange={(e) => { setYear(e.target.value); setPage(0); }} className="terminal-btn text-[13px] py-1.5 px-2">
          <option value="all">All years</option>
          {years.map((y) => <option key={y} value={y}>Year: {y}</option>)}
        </select>
        <button type="button" onClick={exportCsv} className="terminal-btn text-[13px] py-1.5 px-3">Export CSV</button>
      </div>
      <div className="overflow-x-auto">
        <table className="terminal-table w-full">
          <thead><tr><th>As on</th><th className="text-right">NAV (₹)</th><th className="text-right">1M</th><th className="text-right">1Y</th><th className="text-right">3Y</th><th className="text-right">5Y</th></tr></thead>
          <tbody>
            {rows.slice(cur * size, cur * size + size).map((h) => (
              <tr key={h.date}>
                <td>{formatISTDate(h.date)}</td>
                <td className="text-right font-semibold tabular-nums">{h.nav?.toFixed(4) ?? "—"}</td>
                {[h.r1m, h.r1y, h.r3y, h.r5y].map((v, i) => <td key={i} className="text-right"><SignedValue value={v} unit="%" /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <label className="flex items-center gap-2">Rows per page
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} className="terminal-btn py-1 px-2">{PAGE_SIZES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous page" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="terminal-btn px-2.5 py-1 disabled:opacity-40">‹</button>
          <span>{cur + 1} of {pages}</span>
          <button type="button" aria-label="Next page" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="terminal-btn px-2.5 py-1 disabled:opacity-40">›</button>
        </div>
      </div>
    </Section>
  );
}

export default function FundDetailPage({ scheme }: { scheme: MutualFundItem & { fh_status?: string } }) {
  const code = scheme.scheme_code;
  const rec = useRecommended();
  const [peers, setPeers] = useState<FundPeers | null>(null);
  const [perf, setPerf] = useState<MfPerformance | null | undefined>(undefined);
  const [manager, setManager] = useState<MfManagerInfo | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [detail, setDetail] = useState<MfResearchDetail | null>(null);
  const [fh, setFh] = useState<FhExplain | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let off = false;
    getMutualFundPerformance(code).then((p) => !off && setPerf(p)).catch(() => !off && setPerf(null));
    getMfManager(code).then((m) => !off && setManager(m)).catch(() => undefined);
    getMfResearchDetail(code).then((d) => !off && setDetail(d)).catch(() => undefined);
    getMfPeers(code).then((p) => !off && setPeers(p)).catch(() => undefined);
    getMfExplain(code, "fh_score").then((e) => !off && setFh(e.fh ?? null)).catch(() => undefined);
    return () => { off = true; };
  }, [code]);
  useEffect(() => { document.title = `${scheme.scheme_name} | Fund Horizon`; }, [scheme.scheme_name]);

  const classified = classifyPlanOption(scheme.scheme_name, scheme.plan, scheme.option);
  const m = perf?.metrics ?? {};
  const mv = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : undefined);
  const nav = scheme.latest_nav != null && scheme.latest_nav !== "" && Number.isFinite(Number(scheme.latest_nav)) ? `₹${formatNumber(Number(scheme.latest_nav), 4)}` : "—";
  const row = { code, name: scheme.scheme_name, plan: scheme.plan ?? "", cat: scheme.cat_key ?? "", is_fh_recommended: false, perf_label: "", risk_label: "", ops_label: "", fh_status: scheme.fh_status } as MfScreenerRow;

  const pf = detail?.portfolio;
  const portfolio: FundPortfolio | null = pf?.available
    ? {
        holdings: pf.holdings.map((h) => ({ name: h.name ?? null, isin: h.isin ?? null, sector: h.sector ?? null, weight_pct: h.weight_pct ?? null, instrument_type: h.instrument_type ?? null })),
        sectors: pf.sectors.filter((x) => x.sector && x.weight_pct != null).map((x) => ({ sector: x.sector as string, weight_pct: x.weight_pct as number })),
        unclassified_pct: pf.unclassified_pct ?? 0, total_weight_pct: pf.total_weight_pct ?? 0,
        summary: { holdings_count: pf.summary?.holdings_count ?? pf.holdings.length, top10_concentration_pct: pf.summary?.top10_concentration_pct ?? null, top_holding_pct: pf.summary?.top_holding_pct ?? null, cash_pct: pf.summary?.cash_pct ?? null },
        as_of: pf.as_of ?? null, source: pf.source ?? null, amc: pf.amc ?? null, coverage_pct: pf.coverage_pct ?? null, note: pf.note ?? null,
      }
    : null;
  const f = (v?: number) => (v === undefined ? "not available" : `${v.toFixed(1)}%`);
  const faqs: [string, string][] = [
    [`What are the returns of ${shortDisplayName(scheme.scheme_name)}?`, `1 year ${f(mv("ret_1y"))}, 3 year CAGR ${f(mv("cagr_3y"))}, 5 year CAGR ${f(mv("cagr_5y"))}${perf ? `, as of ${formatISTDate(perf.as_of)}` : ""}. Past performance is not a guide to future returns.`],
    ["How risky is this fund?", `3 year volatility ${f(mv("vol_3y"))}; largest fall from a peak over all history ${f(mv("max_drawdown_all"))}.`],
    ["What is the expense ratio?", scheme.ter_pct ? `${Number(scheme.ter_pct).toFixed(2)}% a year for the ${classified.plan || "listed"} plan.` : "Not on file for this plan."],
    ["What does it hold?", portfolio ? `${portfolio.summary.holdings_count} holdings as of ${portfolio.as_of ?? "the latest disclosure"}; see Holdings and Sector Allocation above.` : "Its monthly portfolio file is not ingested yet, so holdings are shown as unavailable, never estimated."],
  ];

  const copy = async () => {
    const text = [`Scheme: ${scheme.scheme_name}`, `Code: ${code}`, `AMC: ${scheme.amc_name || "—"}`, `Category: ${scheme.category || "—"}`, `Plan: ${classified.plan || "—"}`, `Option: ${classified.option || "—"}`, `Latest NAV: ${nav}`, `NAV date: ${formatISTDate(scheme.nav_date)}`, `TER: ${scheme.ter_pct ? `${Number(scheme.ter_pct).toFixed(2)}%` : "—"}`, `ISIN Growth: ${blankDash(scheme.isin_growth)}`].join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const shortlist = async () => {
    try { await addMfShortlist(code, reason.trim() || undefined); setMsg("Added to the shortlist."); setForm(false); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not add to the shortlist."); }
  };

  const returns = (
    <Section id="returns" title="Returns across horizons" sub={perf ? `As of ${formatISTDate(perf.as_of)} · ${m.history_years ?? "—"} years of available history` : undefined}>
      <div className="grid gap-4 lg:grid-cols-[4fr_5fr]">
        <div>
          <div className={`mb-2 text-[13px] font-semibold`}>Point-to-point returns</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["1 Month", "ret_1m"], ["3 Month", "ret_3m"], ["6 Month", "ret_6m"], ["1 Year", "ret_1y"]] as const).map(([l, k]) => <Tile key={k} label={l} value={mv(k)} />)}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-semibold">Annualised returns · CAGR</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {([["3 Year", "cagr_3y"], ["5 Year", "cagr_5y"], ["7 Year", "cagr_7y"], ["10 Year", "cagr_10y"], ["Since inception", "cagr_since_inception"]] as const).map(([l, k]) => <Tile key={k} label={l} value={mv(k)} />)}
          </div>
        </div>
      </div>
    </Section>
  );
  const risk = (
    <Section id="risk" title="Risk at a glance" sub="Drawdown = largest fall from a previous peak.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Volatility (3Y)" value={mv("vol_3y")} plain />
        <Tile label="Max drawdown (3Y)" value={mv("max_drawdown_3y")} />
        <Tile label="Max drawdown (all history)" value={mv("max_drawdown_all")} />
        <Tile label="Sharpe (3Y)" value={mv("sharpe_3y")} unit="" plain />
        <Tile label="Sortino (3Y)" value={mv("sortino_3y")} unit="" plain />
      </div>
    </Section>
  );
  const rankings = (
    <Section id="rankings">
      <FundQuartile name={scheme.scheme_name} cat={scheme.cat_key ?? scheme.category} plan={classified.plan} />
    </Section>
  );
  const score = (
    <Section id="fh-score" title="FH score" sub="Our own score out of 100, built by comparing the fund with similar funds.">
      {fh ? <FhScorePanel fh={fh} row={row} /> : <p className={`text-[13px] ${MUTED}`}>Computing the FH score…</p>}
    </Section>
  );
  const managerBlock = (
    <Section title="Fund manager">
      {manager ? (
        <div className="text-[14px]">
          <button type="button" onClick={() => setManagerOpen(true)} className="text-[18px] font-semibold text-[#0176D3] dark:text-[#1B96FF] hover:underline">{manager.manager_name}</button>
          <div className={MUTED}>Since {manager.manager_start ? formatISTDate(manager.manager_start) : "—"}{manager.tenure_years != null ? ` · ${manager.tenure_years.toFixed(1)} years` : ""}</div>
          <button type="button" onClick={() => setManagerOpen(true)} className="mt-1 text-[#0176D3] dark:text-[#1B96FF] hover:underline">View all funds by this manager →</button>
        </div>
      ) : <p className={`text-[13px] ${MUTED}`}>No manager on file for this scheme.</p>}
    </Section>
  );
  const identity = (
    <Section title="Identification & settlement">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
        {([
          ["AMFI scheme code", code],
          ["ISIN (Growth)", blankDash(scheme.isin_growth)],
          ["ISIN (Dividend)", blankDash(scheme.isin_div)],
          ["Fund house", scheme.amc_name || "—"],
          ["Category", scheme.category || "—"],
          ["Category benchmark", scheme.benchmark || row?.benchmark || "SEBI TRI Benchmark"],
        ] as const).map(([k, v]) => (
          <React.Fragment key={k}><dt className={MUTED}>{k}</dt><dd className="font-medium">{v}</dd></React.Fragment>
        ))}
      </dl>
    </Section>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-4 sm:px-6">
      <nav className={`text-[13px] ${MUTED}`}><Link href="/backoffice/mutual-funds" className="hover:underline">Mutual funds</Link> / <span className="text-[#181818] dark:text-[#EDF2F7]">{shortDisplayName(scheme.scheme_name)}</span></nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {scheme.amc_name && <AmcLogo amc={scheme.amc_name} className="h-14 min-w-14 max-w-[5rem] text-[10px] shrink-0" />}
            <div className="min-w-0">
              <h1 className="text-[24px] sm:text-[30px] font-semibold leading-tight">{shortDisplayName(scheme.scheme_name)}</h1>
              <div className={`text-[14px] ${MUTED}`}>{scheme.amc_name || "Asset management company"}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!form ? (
              <button type="button" onClick={() => { setReason(""); setForm(true); }} className="terminal-btn text-[13px] py-1.5 px-3">☆ Add to shortlist</button>
            ) : (
              <span className="flex flex-wrap items-center gap-1.5">
                <input aria-label="Shortlist reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" maxLength={200} className="terminal-input text-[13px] py-1 px-2" />
                <button type="button" onClick={shortlist} className="terminal-btn-accent text-[13px] py-1 px-3">Save</button>
                <button type="button" onClick={() => setForm(false)} className="terminal-btn text-[13px] py-1 px-2">Cancel</button>
              </span>
            )}
            <AddToWatchlist code={code} className="terminal-btn text-[13px] py-1.5 px-3" />
            <button type="button" onClick={copy} className="terminal-btn text-[13px] py-1.5 px-3">{copied ? "Copied" : "Copy details"}</button>
            {perf?.publicPage && <a href={`/funds/${code}`} target="_blank" rel="noreferrer" className="terminal-btn text-[13px] py-1.5 px-3">Public page ↗</a>}
          </div>
        </div>
        {msg && <p className={`text-[12px] ${MUTED}`}>{msg}</p>}
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          {[scheme.category, scheme.benchmark || row?.benchmark, classified.plan, classified.option, code].filter(Boolean).map((t) => <span key={String(t)} className="rounded-md bg-[#EEF1F5] dark:bg-[#202936] px-2.5 py-1">{t}</span>)}
          <button type="button" onClick={() => rec.toggleMf(code, scheme.scheme_name)} title="Toggle FH Recommended" className={`rounded-md px-2.5 py-1 ${rec.isMfRecommended(code) ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C]" : "bg-[#EEF1F5] dark:bg-[#202936]"}`}>★ {rec.isMfRecommended(code) ? "FH Recommended" : "Mark recommended"}</button>
          {isNavStale(scheme.nav_date) && <span className="rounded-md bg-[#FFF4D6] px-2.5 py-1 text-[#7A5600] dark:bg-[#3A2E0A] dark:text-[#FBBF24]">Stale NAV</span>}
        </div>
      </header>

      <div className="grid gap-4 border-y border-[#E5E5E5] dark:border-[#2B3644] py-4 sm:grid-cols-3 sm:divide-x sm:divide-[#E5E5E5] dark:sm:divide-[#2B3644]">
        <div><div className={`text-[13px] ${MUTED}`}>Latest NAV</div><div className="text-[28px] font-semibold tabular-nums">{nav}</div><div className={`text-[13px] ${MUTED}`}>As of {formatISTDate(scheme.nav_date)}</div></div>
        <div className="sm:pl-6"><div className={`text-[13px] ${MUTED}`}>Expense ratio (TER)</div><div className="text-[28px] font-semibold tabular-nums">{scheme.ter_pct ? `${Number(scheme.ter_pct).toFixed(2)}%` : "—"}</div></div>
        <div className="sm:pl-6"><div className={`text-[13px] ${MUTED}`}>Fund manager</div>
          {manager ? <><button type="button" onClick={() => setManagerOpen(true)} className="text-[20px] font-semibold text-[#0176D3] dark:text-[#1B96FF] hover:underline">{manager.manager_name}</button><div className={`text-[13px] ${MUTED}`}>Since {manager.manager_start ? formatISTDate(manager.manager_start) : "—"}</div></> : <div className="text-[20px] font-semibold">—</div>}
        </div>
      </div>

      <FundTabs
        tabs={TABS}
        barCls="bg-white dark:bg-[#10151C]"
        activeCls="border-[#0176D3] font-semibold text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF]"
      />

      {perf === undefined && <p className={`text-[13px] ${MUTED}`}>Loading performance…</p>}
      {perf === null && <div className="terminal-panel p-3 text-[13px]"><span className={MUTED}>No performance data: the dataset covers Growth-option, open-ended schemes only.</span></div>}

      <div id="fund-price" className="scroll-mt-28 space-y-6">
        {perf && <Section title="NAV chart"><NavChart navs={[...perf.history].reverse().flatMap((h) => (h.nav == null ? [] : [{ date: h.date, nav: h.nav }]))} /></Section>}
        {perf ? <NavHistory perf={perf} code={code} /> : <p className={`text-[13px] ${MUTED}`}>No NAV history for this scheme.</p>}
      </div>

      <div id="performance" className="scroll-mt-28 space-y-6">
        {perf && <>{returns}{risk}</>}
        {perf && (
          <Section title="Consistency of returns">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Rolling 1Y win %" value={detail?.roll_win_pct ?? undefined} plain digits={1} />
              <Tile label="Calendar win %" value={detail?.cal_win_pct ?? undefined} plain digits={1} />
              <Tile label="SIP CAGR 3Y" value={detail?.sip_cagr_3y ?? undefined} />
              <Tile label="SIP CAGR 5Y" value={detail?.sip_cagr_5y ?? undefined} />
            </div>
            <p className={`text-[12px] ${MUTED}`}>Win percentages are against the category median.</p>
          </Section>
        )}
        {perf && (
          <Section title="Risk against peers">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Downside deviation (3Y)" value={detail?.downside_dev_3y ?? undefined} plain />
              <Tile label="Calmar (3Y)" value={detail?.calmar_3y ?? undefined} unit="" plain />
              <Tile label="Sharpe percentile (3Y)" value={detail?.pct_sharpe_3y ?? undefined} unit="" plain digits={0} />
              <Tile label="Sortino percentile (3Y)" value={detail?.pct_sortino_3y ?? undefined} unit="" plain digits={0} />
              <Tile label="Alpha percentile (3Y)" value={detail?.pct_alpha_3y ?? undefined} unit="" plain digits={0} />
              <Tile label="Volatility percentile (3Y)" value={detail?.pct_vol_3y ?? undefined} unit="" plain digits={0} />
              <Tile label="Drawdown percentile (3Y)" value={detail?.pct_max_dd_3y ?? undefined} unit="" plain digits={0} />
            </div>
            <p className={`text-[12px] ${MUTED}`}>Percentiles rank the fund among its category and plan peers; higher is better.</p>
          </Section>
        )}
        {score}
        {rankings}
      </div>

      <Section id="peers" title="Peer comparison">
        {peers?.peers?.length ? <PeerTable data={peers} code={code} hrefBase="/backoffice/mutual-funds" /> : <p className={`text-[13px] ${MUTED}`}>No peers on file for this category and plan.</p>}
      </Section>

      <Section id="calculator" title="Returns calculator">
        <ReturnsCalculator cagr={{ "3Y": mv("cagr_3y") != null ? (mv("cagr_3y") as number) / 100 : null, "5Y": mv("cagr_5y") != null ? (mv("cagr_5y") as number) / 100 : null }} />
      </Section>

      <Section id="asset-allocation" title="Asset allocation"><AssetAllocation p={portfolio} /></Section>
      <Section id="sector-allocation" title="Sector allocation"><SectorAllocation p={portfolio} /></Section>
      <Section id="holdings" title="Holdings"><HoldingsTable p={portfolio} /></Section>

      <div id="fund-overview" className="scroll-mt-28 space-y-6">
        {managerBlock}
        {identity}
        <Section title="Research coverage" sub="Missing data is shown explicitly, never estimated."><MfResearchBlocks researchDetail={detail} /></Section>
        <Section title="Factsheets"><FactsheetList kind="mf" id={code} /></Section>
        <Section title="Research & external links">
          <div className="flex flex-wrap gap-2 text-[13px]">
            <a className="terminal-btn px-3 py-1.5" target="_blank" rel="noreferrer" href={`https://api.mfapi.in/mf/${code}`}>Historical NAV feed ↗</a>
            <a className="terminal-btn px-3 py-1.5" target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent([scheme.scheme_name, "NAV google finance"].join(" "))}`}>Google Finance search ↗</a>
          </div>
        </Section>
      </div>

      <Section id="about" title={`About ${shortDisplayName(scheme.scheme_name)}`}>
        <p className="text-[14px]">
          {shortDisplayName(scheme.scheme_name)} is a {scheme.category || "mutual fund"} scheme from {scheme.amc_name || "its fund house"} ({[classified.plan, classified.option].filter(Boolean).join(" · ") || "plan not classified"}).
          {perf ? ` ${m.history_years ?? "—"} years of NAV history, last published ${formatISTDate(scheme.nav_date)}.` : ""}
        </p>
      </Section>

      <Section id="compare" title="Compare funds">
        <p className={`text-[13px] ${MUTED}`}>Select this fund and others in the screener, then open the comparison tray.</p>
        <Link href="/backoffice/mutual-funds" className="terminal-btn inline-block px-3 py-1.5 text-[13px]">Open the screener →</Link>
      </Section>

      <Section id="faqs" title="Frequently asked questions">
        {faqs.map(([q, a]) => (
          <details key={q} className="group border-b border-[#E5E5E5] py-2 dark:border-[#2B3644]">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium">{q}<span className="ml-2 transition-transform group-open:rotate-45">+</span></summary>
            <p className={`mt-1.5 text-[13px] ${MUTED}`}>{a}</p>
          </details>
        ))}
      </Section>

      <p className={`border-t border-[#E5E5E5] dark:border-[#2B3644] pt-3 text-[12px] ${MUTED}`}>Past performance is not a guide to future returns. Descriptive data, not investment advice. Source: AMFI, mfapi.in, Advisorkhoj.</p>
      {managerOpen && manager && <MfManagerDrawer manager={manager} onClose={() => setManagerOpen(false)} />}
    </div>
  );
}
