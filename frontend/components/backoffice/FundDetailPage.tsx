"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addMfShortlist, getMfExplain, getMfManager, getMfResearchDetail, getMutualFundPerformance,
  type FhExplain, type MfManagerInfo, type MfPerformance, type MfResearchDetail, type MfScreenerRow, type MutualFundItem,
} from "@/lib/backoffice";
import { useRecommended } from "@/lib/recommended";
import { AmcLogo } from "@/components/BrandLogo";
import FactsheetList from "@/components/backoffice/FactsheetList";
import FhScorePanel from "@/components/backoffice/FhScorePanel";
import FundQuartile from "@/components/backoffice/FundQuartile";
import MfManagerDrawer from "@/components/backoffice/MfManagerDrawer";
import MfResearchBlocks from "@/components/backoffice/MfResearchBlocks";
import SignedValue from "@/components/terminal/SignedValue";
import { shortDisplayName } from "@/components/backoffice/mfDisplayName";
import { blankDash, classifyPlanOption, isNavStale } from "@/lib/backoffice-display";
import { formatISTDate, formatNumber } from "@/lib/terminal-format";

const TABS = ["Overview", "Returns", "Risk", "Rankings", "NAV history", "Fund details"] as const;
type Tab = (typeof TABS)[number];
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
  const [tab, setTab] = useState<Tab>("Overview");
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
    getMfExplain(code, "fh_score").then((e) => !off && setFh(e.fh ?? null)).catch(() => undefined);
    return () => { off = true; };
  }, [code]);
  useEffect(() => { document.title = `${scheme.scheme_name} | Fund Horizon`; }, [scheme.scheme_name]);

  const classified = classifyPlanOption(scheme.scheme_name, scheme.plan, scheme.option);
  const m = perf?.metrics ?? {};
  const mv = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : undefined);
  const nav = scheme.latest_nav != null && scheme.latest_nav !== "" && Number.isFinite(Number(scheme.latest_nav)) ? `₹${formatNumber(Number(scheme.latest_nav), 4)}` : "—";
  const row = { code, name: scheme.scheme_name, plan: scheme.plan ?? "", cat: scheme.cat_key ?? "", is_fh_recommended: false, perf_label: "", risk_label: "", ops_label: "", fh_status: scheme.fh_status } as MfScreenerRow;

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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["1Y", detail?.quartile_1y], ["2Y", detail?.quartile_2y], ["3Y", detail?.quartile_3y], ["5Y", detail?.quartile_5y]] as const).map(([l, q]) => (
          <Tile key={l} label={`Computed quartile ${l}`} value={q ?? undefined} unit="" plain digits={0} />
        ))}
      </div>
    </Section>
  );
  const score = (
    <Section id="fh-score" title="FH score" sub="Our own 0 to 100 score. Open the breakdown for filters, penalties, flags and data coverage.">
      {fh ? <div className="terminal-panel p-3.5 text-[13px]"><FhScorePanel fh={fh} row={row} /></div> : <p className={`text-[13px] ${MUTED}`}>Computing the FH score…</p>}
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
        {([["AMFI scheme code", code], ["ISIN (Growth)", blankDash(scheme.isin_growth)], ["ISIN (Dividend)", blankDash(scheme.isin_div)], ["Fund house", scheme.amc_name || "—"], ["Category", scheme.category || "—"]] as const).map(([k, v]) => (
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
            <button type="button" onClick={copy} className="terminal-btn text-[13px] py-1.5 px-3">{copied ? "Copied" : "Copy details"}</button>
            {perf?.publicPage && <a href={`/funds/${code}`} target="_blank" rel="noreferrer" className="terminal-btn text-[13px] py-1.5 px-3">Public page ↗</a>}
          </div>
        </div>
        {msg && <p className={`text-[12px] ${MUTED}`}>{msg}</p>}
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          {[scheme.category, classified.plan, classified.option, code].filter(Boolean).map((t) => <span key={String(t)} className="rounded-md bg-[#EEF1F5] dark:bg-[#202936] px-2.5 py-1">{t}</span>)}
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

      <div role="tablist" className="sticky top-0 z-20 -mx-4 flex gap-5 overflow-x-auto border-b border-[#E5E5E5] bg-white px-4 dark:border-[#2B3644] dark:bg-[#10151C] sm:-mx-6 sm:px-6">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`shrink-0 border-b-2 py-3 text-[14px] font-medium ${tab === t ? "border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF]" : "border-transparent"}`}>{t}</button>
        ))}
      </div>

      {perf === undefined && <p className={`text-[13px] ${MUTED}`}>Loading performance…</p>}
      {perf === null && <div className="terminal-panel p-3 text-[13px]"><span className={MUTED}>No performance data: the dataset covers Growth-option, open-ended schemes only.</span></div>}

      {tab === "Overview" && <>{perf && <>{returns}{risk}</>}{score}{rankings}{managerBlock}{identity}</>}
      {tab === "Returns" && perf && <>
        {returns}
        <Section title="Consistency of returns">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Rolling 1Y win %" value={detail?.roll_win_pct ?? undefined} plain digits={1} />
            <Tile label="Calendar win %" value={detail?.cal_win_pct ?? undefined} plain digits={1} />
            <Tile label="SIP CAGR 3Y" value={detail?.sip_cagr_3y ?? undefined} />
            <Tile label="SIP CAGR 5Y" value={detail?.sip_cagr_5y ?? undefined} />
          </div>
          <p className={`text-[12px] ${MUTED}`}>Win percentages are against the category median.</p>
        </Section>
      </>}
      {tab === "Risk" && perf && <>
        {risk}
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
      </>}
      {tab === "Rankings" && <>{rankings}{score}</>}
      {tab === "NAV history" && (perf ? <NavHistory perf={perf} code={code} /> : <p className={`text-[13px] ${MUTED}`}>No NAV history for this scheme.</p>)}
      {tab === "Fund details" && <>
        <Section title="Research coverage" sub="Missing data is shown explicitly, never estimated."><MfResearchBlocks researchDetail={detail} /></Section>
        <Section title="Factsheets"><FactsheetList kind="mf" id={code} /></Section>
        {identity}
        <Section title="Research & external links">
          <div className="flex flex-wrap gap-2 text-[13px]">
            <a className="terminal-btn px-3 py-1.5" target="_blank" rel="noreferrer" href={`https://api.mfapi.in/mf/${code}`}>Historical NAV feed ↗</a>
            <a className="terminal-btn px-3 py-1.5" target="_blank" rel="noreferrer" href={`https://www.google.com/search?q=${encodeURIComponent([scheme.scheme_name, "NAV google finance"].join(" "))}`}>Google Finance search ↗</a>
          </div>
        </Section>
      </>}

      <p className={`border-t border-[#E5E5E5] dark:border-[#2B3644] pt-3 text-[12px] ${MUTED}`}>Past performance is not a guide to future returns. Descriptive data, not investment advice. Source: AMFI, mfapi.in, Advisorkhoj.</p>
      {managerOpen && manager && <MfManagerDrawer manager={manager} onClose={() => setManagerOpen(false)} />}
    </div>
  );
}
