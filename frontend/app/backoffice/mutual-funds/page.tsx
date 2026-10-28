"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRecommended } from "@/lib/recommended";
import { useRouter, useSearchParams } from "next/navigation";
import { AmcLogo } from "@/components/BrandLogo";
import {
  getMfScreener,
  mfScreenerCsvUrl,
  MfScreenerGroup,
  MfScreenerQuery,
  MfScreenerRow,
  MutualFundItem,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import { shortDisplayName } from "@/components/backoffice/mfDisplayName";
import MfMetricExplain from "@/components/backoffice/MfMetricExplain";
import MfOnePager from "@/components/backoffice/MfOnePager";
import MfQuartileRankings from "@/components/backoffice/MfQuartileRankings";
import CompareTray from "@/components/compare/CompareTray";
import CompareView from "@/components/compare/CompareView";
import { mfCompareId, useCompareSelection } from "@/lib/compare-selection";
import InfoTip from "@/components/InfoTip";

const SECTIONS = ["Summary", "Checklist", "Returns", "Risk Vs Reward", "Capture Ratio", "One-Pager", "Quartile Rankings"] as const;
type Section = (typeof SECTIONS)[number];
const PAGE_SIZES = [5, 8, 10, 20, 25, 50, 100];
const DEFAULT_CATEGORIES = ["flexi_cap", "multi_cap"];
const PLANS = ["Regular", "Direct"];

type Kind = "pct" | "num" | "score" | "stars" | "aum" | "text";
interface Col {
  key: string;
  label: string;
  kind: Kind;
  digits?: number;
  /** Category-average column shown beneath the value (Returns tab). */
  avg?: string;
  /** Date column shown beneath the value (52-week range). */
  date?: string;
  /** Percent column that is not good/bad by sign (volatility). */
  plain?: boolean;
  tip?: string;
}

const pct = (key: string, label: string, avg?: string, tip?: string): Col => ({ key, label, kind: "pct", digits: 2, avg, tip });
const num = (key: string, label: string, digits = 2, tip?: string): Col => ({ key, label, kind: "num", digits, tip });
const YEARS = [1, 3, 5, 10];
const perYear = (key: string, label: string, kind: "pct" | "num", plain = false): Col[] =>
  YEARS.map((y) => ({ key: `${key}_${y}y`, label: `${label} ${y}Yr`, kind, digits: 2, plain, tip: key }));

const COLUMNS: Record<Section, Col[]> = {
  "One-Pager": [],
  "Quartile Rankings": [],
  Summary: [
    { key: "cat_label", label: "Category", kind: "text" },
    pct("out_1y", "1Y", undefined, "Fund 1Yr return minus its category-plan average, in percentage points"),
    pct("out_3y", "3Y"),
    pct("out_5y", "5Y"),
    { key: "fh_score", label: "FH score / 100", kind: "score" },
    { key: "fh_rating", label: "FH rating", kind: "stars" },
    { key: "aum_cr", label: "AUM (\u20B9 Cr)", kind: "aum" },
    num("ter", "Expense (%)"),
  ],
  Checklist: [
    { key: "score", label: "FH Checklist Score / 100", kind: "score" },
    { key: "perf", label: "Performance / 25", kind: "score" },
    { key: "port", label: "Portfolio / 25", kind: "score" },
    { key: "ops", label: "Operations / 25", kind: "score" },
    { key: "risk", label: "Risk vs Reward / 25", kind: "score" },
  ],
  Returns: [
    pct("ret_1m", "Returns 1M %", "ret_1m_cat"),
    pct("ret_3m", "Returns 3M %", "ret_3m_cat"),
    pct("ret_6m", "Returns 6M %"),
    pct("ret_1y", "Returns 1Yr %", "ret_1y_cat"),
    pct("ret_2y", "2Yr CAGR %", "ret_2y_cat"),
    pct("cagr_3y", "3Yr CAGR %", "cagr_3y_cat"),
    pct("cagr_5y", "5Yr CAGR %", "cagr_5y_cat"),
    pct("cagr_7y", "7Yr CAGR %"),
    pct("cagr_10y", "10Yr CAGR %", "cagr_10y_cat"),
    pct("cagr_si", "Since inception CAGR %"),
    { key: "hi52", label: "NAV 52W High", kind: "num", digits: 2, date: "hi52_date" },
    { key: "lo52", label: "NAV 52W Low", kind: "num", digits: 2, date: "lo52_date" },
  ],
  "Capture Ratio": [
    ...perYear("cap_up", "Up Capture", "pct", true),
    ...perYear("cap_down", "Down Capture", "pct", true),
    ...perYear("cap_ratio", "Capture Ratio", "num"),
  ],
  "Risk Vs Reward": [
    ...perYear("alpha", "Alpha %", "pct"),
    ...perYear("beta", "Beta", "num"),
    ...perYear("sharpe", "Sharpe Ratio", "num"),
    ...perYear("sortino", "Sortino Ratio", "num"),
    ...perYear("treynor", "Treynor Ratio %", "pct"),
    ...perYear("vol", "Std Dev %", "pct", true),
    pct("max_dd_3y", "Max Drawdown 3Yr %"),
    pct("max_dd_all", "Max Drawdown All %"),
    pct("roll1y_pos", "Rolling 1Yr positive %"),
  ],
};

const FILTERABLE: { key: string; label: string }[] = [
  { key: "score", label: "FH Checklist Score" },
  { key: "stars", label: "FH Star Rating" },
  { key: "aum_cr", label: "AUM Cr" },
  { key: "alpha_3y", label: "Alpha 3Yr %" },
  { key: "ter", label: "Net Expense Ratio %" },
  { key: "ret_1y", label: "1Yr return %" },
  { key: "cagr_3y", label: "3Yr CAGR %" },
  { key: "cagr_5y", label: "5Yr CAGR %" },
  { key: "sharpe_3y", label: "Sharpe 3Yr" },
  { key: "vol_3y", label: "Std Dev 3Yr %" },
  { key: "history_years", label: "Fund age (years)" },
];

function fmt(v: unknown, digits = 2): string {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "-";
}

function tone(v: unknown): string {
  if (typeof v !== "number") return "";
  return v > 0 ? "text-[#0B7A4B] dark:text-[#5FD3A2]" : v < 0 ? "text-[#B42332] dark:text-[#FF7D86]" : "";
}

function toItem(r: MfScreenerRow): MutualFundItem {
  return {
    scheme_code: r.code,
    scheme_name: r.name,
    amc_name: r.amc ?? undefined,
    cat_key: r.cat,
    plan: r.plan,
    option: "Growth",
    latest_nav: typeof r.nav === "number" ? r.nav : undefined,
    nav_date: r.nav_date ?? undefined,
    ter_pct: typeof r.ter === "number" ? r.ter : undefined,
    isin_growth: r.isin ?? undefined,
    is_fh_recommended: r.is_fh_recommended,
  };
}

// Opens the staff detail view in a new tab; the row travels in ?s= so the page needs no extra fetch.
const fundHref = (r: MfScreenerRow) => `/backoffice/mutual-funds/${encodeURIComponent(r.code)}?s=${encodeURIComponent(JSON.stringify({ ...toItem(r), fh_status: r.fh_status }))}`;

export default function MutualFundsPage() {
  return (
    <Suspense fallback={null}>
      <MutualFunds />
    </Suspense>
  );
}

function MutualFunds() {
  const router = useRouter();
  const params = useSearchParams();
  const compare = useCompareSelection("mf");
  const [explain, setExplain] = useState<{ metric: Col; row: MfScreenerRow } | null>(null);

  const category = useMemo(() => (params.has("category") ? params.getAll("category") : params.has("q") || params.has("section") ? [] : DEFAULT_CATEGORIES), [params]);
  const plan = useMemo(() => (params.has("plan") || params.has("section") ? params.getAll("plan") : PLANS), [params]);
  const section = (SECTIONS.find((s) => s === params.get("section")) ?? "Summary") as Section;

  const [sort, setSort] = useState("fh_score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(8);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [search, setSearch] = useState((params.get("q") ?? "").trim());
  const [recommended, setRecommended] = useState(false);
  const [ranges, setRanges] = useState<Record<string, { min?: string; max?: string }>>({});
  const [draft, setDraft] = useState<Record<string, { min?: string; max?: string }>>({});
  const [showFilter, setShowFilter] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [planSelectOpen, setPlanSelectOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => {
    try {
      if (typeof window === "undefined") return [];
      const raw = window.localStorage.getItem("fh-mf-columns");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const rec = useRecommended();
  const [recDropdownOpen, setRecDropdownOpen] = useState(false);
  const [newRecCode, setNewRecCode] = useState("");
  const [newRecName, setNewRecName] = useState("");
  const [activeGroup, setActiveGroup] = useState("Equity");
  const [rows, setRows] = useState<MfScreenerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<MfScreenerGroup[]>([]);
  const [asOf, setAsOf] = useState<string | null | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [onePager, setOnePager] = useState<MfScreenerRow | null>(null);

  const q: MfScreenerQuery = { category, plan, search, sort, order, ranges, recommended };
  const qKey = JSON.stringify(q);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  // Phase 0: clearing the box (debounced) resets the applied search filter — the
  // effect above sets search to "" and mfScreenerParams omits an empty search.
  // Panels close on Escape; Quick Filter also closes on outside click (backdrop below).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setShowFilter(false); setRecDropdownOpen(false); setCatOpen(false); setPlanSelectOpen(false); setPlanSelectOpen(false); setColsOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setOffset(0), [qKey, pageSize]);

  useEffect(() => {
    try {
      window.localStorage.setItem("fh-mf-columns", JSON.stringify(hiddenCols));
    } catch {
      /* private mode: column choice just does not persist */
    }
  }, [hiddenCols]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    getMfScreener({ ...q, limit: pageSize, offset }, ctl.signal)
      .then((res) => {
        setRows(res.data);
        setTotal(res.total);
        setGroups(res.groups);
        setAsOf(res.as_of);
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "Failed to load mutual funds");
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey, pageSize, offset, retry]);

  function setUrl(next: { category?: string[]; plan?: string[]; section?: Section }) {
    const p = new URLSearchParams();
    (next.category ?? category).forEach((c) => p.append("category", c));
    (next.plan ?? plan).forEach((x) => p.append("plan", x));
    p.set("section", next.section ?? section);
    router.replace(`?${p.toString()}`, { scroll: false });
  }

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const group = groups.find((g) => g.group === activeGroup);
  const groupKeys = group?.categories.map((c) => c.key) ?? [];
  const allSelected = groupKeys.length > 0 && groupKeys.every((k) => category.includes(k));
  const selectedCats = groups.flatMap((g) => g.categories).filter((c) => category.includes(c.key));
  const selectedLabels = selectedCats.map((c) => c.label);
  // Phase 0 (a): keep the selection on asset-class tab switch, but never let heading, tab and list
  // silently disagree — selected categories from other groups are named in a note below.
  const otherGroupSelected = groups.filter((g) => g.group !== activeGroup).flatMap((g) => g.categories).filter((c) => category.includes(c.key));
  const quartileCategories = groups.flatMap((g) => g.categories).filter((c) => category.includes(c.key)).map((c) => ({ key: c.key, label: c.label }));

  function onSort(key: string) {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder(key === "name" || key === "ter" ? "asc" : "desc");
    }
  }
  const arrow = (key: string) => (sort === key ? (order === "asc" ? " ▲" : " ▼") : <span className="opacity-30"> ⇅</span>);

  const cols = COLUMNS[section];
  const visibleCols = cols.filter((c) => !hiddenCols.includes(c.key));
  const isSummary = section === "Summary";
  const visibleOutCols = visibleCols.filter((c) => c.key.startsWith("out_"));
  const visibleNonOutCols = visibleCols.filter((c) => !c.key.startsWith("out_") && c.key !== "cat_label");
  const planValue = plan.length === 2 ? "Both" : plan[0] === "Regular" ? "Regular" : plan[0] === "Direct" ? "Direct" : "Both";
  const planButtonLabel = planValue === "Both" ? "Both" : planValue === "Regular" ? "Regular only" : "Direct only";
  const colDisplayLabel = (c: Col) =>
    c.key === "out_1y" ? "Return vs category average \u2014 1Y" :
    c.key === "out_3y" ? "Return vs category average \u2014 3Y" :
    c.key === "out_5y" ? "Return vs category average \u2014 5Y" : c.label;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + pageSize, total);
  const page = Math.floor(offset / pageSize);
  const activeFilters = Object.values(ranges).filter((r) => r.min || r.max).length;

  return (
    <div className={`space-y-4 ${compare.selectedIds.length ? "pb-[88px]" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-[#181818] dark:text-[#EDF2F7] tracking-tight">Mutual fund screener</h1>
          <p className="text-[14px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
            {selectedLabels.length ? selectedLabels.join(" & ") : "All categories"} · Growth option
          </p>
        </div>
        <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] sm:text-right">
          <div>NAV as of {asOf ? formatISTDate(asOf) : "-"}</div>
          <div>Source: AMFI + mfapi.in</div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center gap-2">
        <div className="contents">
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={catOpen}
            onClick={() => { setCatOpen((v) => !v); setPlanSelectOpen(false); }}
            className="terminal-btn text-[13px] py-2 px-3 flex items-center gap-2"
          >
            Categories
            {category.length > 0 && <span className="rounded-full bg-[#D8E9FB] text-[#0176D3] dark:bg-[#1B3A5C] dark:text-[#1B96FF] text-[12px] px-2 leading-5">{category.length}</span>}
            <span className="text-[10px]">▾</span>
          </button>
          {catOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setCatOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 w-full max-w-[760px] max-h-[70vh] overflow-y-auto rounded-xl bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] p-3 shadow-2xl z-50 space-y-2.5">

        <div role="tablist" className="flex flex-wrap gap-1">
          {groups.map((g) => (
            <button
              key={g.group}
              role="tab"
              aria-selected={activeGroup === g.group}
              onClick={() => setActiveGroup(g.group)}
              className={`${activeGroup === g.group ? "terminal-btn-accent" : "terminal-btn"} text-[12px] py-1 px-3`}
            >
              {g.group}
            </button>
          ))}
        </div>
        {otherGroupSelected.length > 0 && (
          <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
            Also selected from other groups (kept, not cleared): {otherGroupSelected.map((c) => c.label).join(", ")}.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
          <label className="flex items-center gap-2 text-[12px] font-medium text-[#0176D3] dark:text-[#1B96FF] cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#0176D3]"
              checked={allSelected}
              onChange={() =>
                setUrl({ category: allSelected ? category.filter((c) => !groupKeys.includes(c)) : Array.from(new Set([...category, ...groupKeys])) })
              }
            />
            Select All ({groupKeys.length})
          </label>
          {group?.categories.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-[12px] text-[#181818] dark:text-[#EDF2F7] cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#0176D3]"
                checked={category.includes(c.key)}
                onChange={() => setUrl({ category: toggle(category, c.key) })}
              />
              {c.label} <span className="text-[#706E6B] dark:text-[#A8B4C4]">({c.count})</span>
            </label>
          ))}
        </div>
              </div>
            </>
          )}
        </div>
        {selectedCats.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-2 rounded-md bg-[#D8E9FB] text-[#0176D3] dark:bg-[#1B3A5C] dark:text-[#1B96FF] text-[13px] py-1.5 px-3">
            {c.label}
            <button type="button" aria-label={`Remove ${c.label}`} onClick={() => setUrl({ category: toggle(category, c.key) })} className="cursor-pointer leading-none">
              ✕
            </button>
          </span>
        ))}
      </div>

      <div role="tablist" className="flex flex-wrap items-center gap-1 border-b border-[#E5E5E5] dark:border-[#2B3644]">
          {SECTIONS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={section === s}
              onClick={() => {
                setUrl({ section: s });
                setShowFilter(false);
                setRecDropdownOpen(false);
                setPlanSelectOpen(false);
                setColsOpen(false);
                setSort(s === "Risk Vs Reward" ? "sharpe_3y" : s === "Capture Ratio" ? "cap_ratio_3y" : s === "Returns" ? "cagr_3y" : "fh_score");
                setOrder("desc");
              }}
              className={`text-[13px] py-1 px-3 border-b-2 ${section === s ? "border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] font-medium" : "border-transparent text-[#706E6B] dark:text-[#A8B4C4]"}`}
            >
              {s.replace("Vs", "vs")}
            </button>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fund, AMC or scheme code"
          aria-label="Search fund, AMC or scheme code"
          className="terminal-input flex-1 min-w-[220px] text-[13px] py-2 px-3"
        />
        <div className="relative">
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={planSelectOpen}
            onClick={() => { setPlanSelectOpen((v) => !v); setCatOpen(false); setColsOpen(false); }}
            className="terminal-btn text-[13px] py-2 px-3 flex items-center gap-2"
          >
            <span className="text-[#706E6B] dark:text-[#A8B4C4]">Plan:</span> {planButtonLabel}
            <span className="text-[10px]">▾</span>
          </button>
          {planSelectOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPlanSelectOpen(false)} />
              <div className="absolute left-0 top-full mt-1.5 rounded-xl bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] p-1.5 shadow-2xl z-50 text-[13px] text-[#181818] dark:text-[#EDF2F7] min-w-[160px]">
                {([
                  ["Both", PLANS],
                  ["Regular only", ["Regular"]],
                  ["Direct only", ["Direct"]],
                ] as const).map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setUrl({ plan: [...value] }); setPlanSelectOpen(false); }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733] text-left"
                  >
                    {label}
                    {planValue === label.replace(" only", "") || (label === "Both" && planValue === "Both") ? <span aria-hidden>✓</span> : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          aria-pressed={recommended}
          onClick={() => setRecommended((v) => !v)}
          className={`${recommended ? "terminal-btn-accent" : "terminal-btn"} text-[13px] py-2 px-3`}
        >
          ☆ FH Recommended ({Object.keys(rec.mfMap).length})
        </button>
        <button type="button" aria-expanded={showFilter} onClick={() => setShowFilter((v) => !v)} className="terminal-btn text-[13px] py-2 px-3">
          Filters{activeFilters ? ` (${activeFilters})` : ""} <span className="text-[10px]">▾</span>
        </button>
        <button
          type="button"
          className="text-[13px] font-medium text-[#0176D3] dark:text-[#1B96FF] px-2 hover:underline"
          onClick={() => {
            setQuery("");
            setRecommended(false);
            setRanges({});
            setDraft({});
            setSort("fh_score");
            setOrder("desc");
            setShowFilter(false);
            setUrl({ plan: PLANS });
          }}
        >
          Reset
        </button>
      </div>

      {showFilter && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => setShowFilter(false)} />
        <div className="terminal-panel p-2.5 space-y-2.5 relative z-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {FILTERABLE.map((f) => (
              <div key={f.key} className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                <div className="mb-1">{f.label}</div>
                <div className="flex gap-1.5">
                  {(["min", "max"] as const).map((side) => (
                    <input
                      key={side}
                      type="number"
                      inputMode="decimal"
                      placeholder={side}
                      aria-label={`${f.label} ${side}`}
                      value={draft[f.key]?.[side] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.key]: { ...d[f.key], [side]: e.target.value } }))}
                      className="terminal-input w-full text-[12px] py-1 px-2"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="terminal-btn-accent text-[12px] py-1 px-3" onClick={() => setRanges(draft)}>
              Apply
            </button>
            <button
              type="button"
              className="terminal-btn text-[12px] py-1 px-3"
              onClick={() => {
                setDraft({});
                setRanges({});
              }}
            >
              Reset
            </button>
          </div>
        </div>
        </>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="text-[14px] text-[#706E6B] dark:text-[#A8B4C4] pt-2">{loading ? "Loading\u2026" : `${total.toLocaleString("en-IN")} funds`}</div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          <div className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={recDropdownOpen}
              onClick={() => setRecDropdownOpen((v) => !v)}
              className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5"
              title="Settings & manage FH Recommended mutual funds"
            >
              <span>⚙ Settings</span>
              <span className="text-[10px] font-mono">▾</span>
            </button>
            {recDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setRecDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-80 sm:w-96 rounded-xl bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] p-3.5 shadow-2xl z-50 space-y-3 text-left">
                  <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-2">
                    <span className="text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
                      ★ FH Recommended Mutual Funds ({Object.keys(rec.mfMap).length})
                    </span>
                    <button type="button" onClick={() => setRecDropdownOpen(false)} className="text-[#706E6B] dark:text-[#A8B4C4] text-xs">
                      ✕
                    </button>
                  </div>
                  <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                    Add scheme code to mark as recommended, or click Remove.
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="Scheme Code (e.g. 108466)"
                      value={newRecCode}
                      onChange={(e) => setNewRecCode(e.target.value)}
                      className="terminal-input text-[11px] py-1 px-2 font-mono flex-1"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!newRecCode.trim()) return;
                        await rec.addMf(newRecCode.trim(), newRecName.trim() || undefined);
                        setNewRecCode("");
                        setNewRecName("");
                      }}
                      className="terminal-btn-accent text-[11px] py-1 px-3 shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-[#E5E5E5]/40 dark:divide-[#2B3644]/40">
                    {Object.entries(rec.mfMap).map(([code, name]) => (
                      <div key={code} className="pt-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <div className="truncate">
                          <span className="font-mono text-[#0176D3] dark:text-[#1B96FF] font-medium mr-1.5">{code}</span>
                          <span className="text-[#181818] dark:text-[#EDF2F7] truncate">{name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => rec.removeMf(code)}
                          className="text-[10px] text-[#B42332] dark:text-[#FF7D86] hover:underline shrink-0 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644] text-[11px] flex justify-between items-center">
                    <Link href="/backoffice/settings" className="text-[#0176D3] dark:text-[#1B96FF] hover:underline font-medium">
                      All Settings →
                    </Link>
                    <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Saves live across terminal</span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={colsOpen}
              onClick={() => { setColsOpen((v) => !v); setPlanSelectOpen(false); }}
              className="terminal-btn text-[13px] py-2 px-3 flex items-center gap-2"
            >
              Columns
              <span className="text-[10px]">▾</span>
            </button>
            {colsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColsOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] p-3 shadow-2xl z-50 space-y-1.5 text-left">
                  {cols.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-[12px] text-[#181818] dark:text-[#EDF2F7] cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#0176D3]"
                        checked={!hiddenCols.includes(c.key)}
                        onChange={(e) => setHiddenCols((h) => e.target.checked ? h.filter((x) => x !== c.key) : [...h, c.key])}
                      />
                      {colDisplayLabel(c)}
                    </label>
                  ))}
                  <button type="button" onClick={() => setHiddenCols([])} className="text-[12px] font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline pt-1">
                    Show all columns
                  </button>
                </div>
              </>
            )}
          </div>
          <a href={mfScreenerCsvUrl(q)} download className="terminal-btn text-[13px] py-2 px-3 no-underline">
            ⤓ Export CSV
          </a>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={compare.selectedIds.length < 2}
              onClick={compare.openCompare}
              className="terminal-btn-accent text-[13px] py-2 px-3 disabled:opacity-40"
            >
              Compare ({compare.selectedIds.length})
            </button>
            {compare.selectedIds.length < 2 && <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Select at least 2 funds to compare</span>}
          </div>
        </div>
      </div>

      {error && (
        <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" className="terminal-btn text-[12px] py-1 px-3" onClick={() => setRetry((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}

      <div className="terminal-panel overflow-hidden">
        {section === "Quartile Rankings" && <MfQuartileRankings screenerCategories={quartileCategories} plans={plan} query={query} recommended={recommended} />}
        {section === "One-Pager" && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 p-2.5 min-h-[420px] content-start">
            {!loading && rows.length === 0 && <div className="col-span-full py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">No funds match the current categories and filters.</div>}
            {rows.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => setOnePager(r)}
                className={`text-left terminal-panel p-3 border-l-4 border-l-[#0176D3] hover:shadow-md cursor-pointer space-y-2 ${loading ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-[13px] text-[#0176D3] dark:text-[#1B96FF] leading-snug">{shortDisplayName(r.name)}</div>
                  {(r.is_fh_recommended || rec.isMfRecommended(r.code)) && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#0176D3] text-white shrink-0">★ FH</span>}
                </div>
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] flex items-center gap-1.5">
                  {r.amc ? <AmcLogo amc={r.amc} className="h-5 min-w-5 max-w-[4rem] text-[8px]" /> : null}
                  {r.amc ?? "-"} · {r.plan}
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
                  {([["Score", "fh_score"], ["1Yr", "ret_1y"], ["3Yr", "cagr_3y"], ["5Yr", "cagr_5y"]] as const).map(([l, k]) => (
                    <div key={k}>
                      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">{l}</div>
                      <div className={`tabular-nums font-medium ${k === "fh_score" ? "" : tone(r[k])}`}>{fmt(r[k], k === "fh_score" ? 0 : 1)}{k === "fh_score" || typeof r[k] !== "number" ? "" : "%"}</div>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
        <div className={`overflow-x-auto overflow-y-auto max-h-[calc(100vh-270px)] min-h-[420px] ${section === "One-Pager" || section === "Quartile Rankings" ? "hidden" : ""}`}>
          <table className="terminal-table">
            <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
              {isSummary ? (
                <>
                  <tr>
                    <th rowSpan={2} className="w-[40px]" aria-label="Compare" />
                    <th rowSpan={2} className="min-w-[240px]">
                      <button type="button" onClick={() => onSort("name")} className="hover:underline cursor-pointer text-left">
                        Fund / Plan{arrow("name")}
                      </button>
                    </th>
                    {!hiddenCols.includes("cat_label") && (
                      <th rowSpan={2} className="whitespace-nowrap">
                        Category{" "}
                        <span className="text-[#706E6B] dark:text-[#A8B4C4]" title="The fund's category, e.g. Flexi Cap" aria-label="About Category">ⓘ</span>
                      </th>
                    )}
                    {visibleOutCols.length > 0 && (
                      <th colSpan={visibleOutCols.length} className="text-center whitespace-nowrap" title="Fund return minus its category-plan average, in percentage points">
                        Return vs category average
                        <div className="relative mx-1 mt-1 h-3" aria-hidden>
                          <div className="absolute left-0 right-0 top-1/2 border-t border-dotted border-[#706E6B] dark:border-[#A8B4C4]" />
                          {visibleOutCols.map((c, i) => (
                            <span key={c.key} className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#706E6B] dark:bg-[#A8B4C4]" style={{ left: `${((i + 0.5) / visibleOutCols.length) * 100}%` }} />
                          ))}
                        </div>
                      </th>
                    )}
                    {visibleNonOutCols.map((c) => (
                      <th key={c.key} rowSpan={2} className="text-right whitespace-nowrap">
                        <button type="button" onClick={() => onSort(c.key)} className="hover:underline cursor-pointer" title={`Sort by ${c.label}`}>
                          {c.label}
                          {c.key === "fh_score" ? (sort === "fh_score" ? (order === "asc" ? " \u2191" : " \u2193") : <span className="opacity-30"> \u21c5</span>) : arrow(c.key)}
                        </button>
                        {(c.key === "fh_score" || c.key === "fh_rating") && <InfoTip metric={c.key} meta={{ source: "amfi", fetched_at: asOf ?? null }} />}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {visibleOutCols.map((c) => (
                      <th key={c.key} className="text-right whitespace-nowrap">
                        <button type="button" onClick={() => onSort(c.key)} className="hover:underline cursor-pointer" title={`Sort by ${c.label}`}>
                          {c.label}
                          {arrow(c.key)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </>
              ) : (
                <tr>
                  <th className="w-[40px]" aria-label="Compare" />
                  <th className="min-w-[240px]">
                    <button type="button" onClick={() => onSort("name")} className="hover:underline cursor-pointer text-left">
                      Fund Name{arrow("name")}
                    </button>
                  </th>
                  {visibleCols.map((c) => (
                    <th key={c.key} className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button type="button" onClick={() => onSort(c.key)} className="hover:underline cursor-pointer" title={`Sort by ${c.label}`}>
                          {c.label}
                          {arrow(c.key)}
                        </button>
                        <InfoTip metric={c.tip ?? c.key} />
                      </div>
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={visibleCols.length + 2} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                    No funds match the current categories and filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const cid = mfCompareId({ scheme_code: r.code });
                  const checked = compare.selectedIds.includes(cid);
                  return (
                    <tr key={r.code} className={loading ? "opacity-50" : ""}>
                      <td className="text-center align-middle">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && compare.maxSelected}
                          aria-label={`Compare ${r.name}`}
                          className="h-4 w-4 accent-[#0176D3]"
                          onChange={() => compare.toggle(cid, r.name)}
                        />
                      </td>
                      {isSummary ? (
                        <td>
                          <div className="flex items-start gap-2">
                            {r.amc ? <AmcLogo amc={r.amc} className="h-8 min-w-8 max-w-[4rem] text-[9px] shrink-0" /> : null}
                            <div className="min-w-0">
                              <a
                                href={fundHref(r)}
                                target="_blank" rel="noopener noreferrer"
                                className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline cursor-pointer leading-snug"
                              >
                                {shortDisplayName(r.name)}
                              </a>
                              {(r.is_fh_recommended || rec.isMfRecommended(r.code)) && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    rec.toggleMf(r.code, r.name);
                                  }}
                                  title="Click to toggle FH Recommended status"
                                  className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] hover:opacity-85 cursor-pointer align-middle"
                                >
                                  ★ FH
                                </button>
                              )}
                              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{r.amc ?? "-"} · {r.plan}</div>
                            </div>
                          </div>
                        </td>
                      ) : (
                        <td>
                          <a
                            href={fundHref(r)}
                            target="_blank" rel="noopener noreferrer"
                            className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline cursor-pointer leading-snug"
                          >
                            {shortDisplayName(r.name)}
                          </a>
                          {(r.is_fh_recommended || rec.isMfRecommended(r.code)) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                rec.toggleMf(r.code, r.name);
                              }}
                              title="Click to toggle FH Recommended status"
                              className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] hover:opacity-85 cursor-pointer align-middle"
                            >
                              ★ FH
                            </button>
                          )}
                          <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                            <span className="inline-flex items-center gap-1.5">
                              {r.amc ? <AmcLogo amc={r.amc} className="h-5 min-w-5 max-w-[4rem] text-[8px]" /> : null}
                              {r.amc ?? "-"} · {r.plan}
                            </span>
                          </div>
                        </td>
                      )}
                      {visibleCols.map((c) => (
                        <Cell key={c.key} col={c} row={r} summary={isSummary} onExplain={() => setExplain({ metric: c, row: r })} />
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-[#E5E5E5] dark:border-[#2B3644] text-[12px] text-[#706E6B] dark:text-[#A8B4C4] flex flex-wrap items-center justify-between gap-2">
          <div>
            Showing {showingFrom.toLocaleString("en-IN")}–{showingTo.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5">
              Rows
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="terminal-input text-[11px] py-0.5 px-1.5">
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" aria-label="Previous page" className="terminal-btn text-[13px] py-0.5 px-2" disabled={page <= 0 || loading} onClick={() => setOffset(offset - pageSize)}>
              ‹
            </button>
            <button type="button" aria-label="Next page" className="terminal-btn text-[13px] py-0.5 px-2" disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>
              ›
            </button>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
        FH score (out of 100) combines fund manager and history, quartile consistency, risk-adjusted ratios, benchmark and category outperformance and the size of excess
        returns, minus penalties for failed tests plus a consistency adjustment. FH rating (1 to 5) is banded from that score, not Morningstar&apos;s. Click any score for the
        full breakdown, flags and data coverage, or the info icon for methodology. The Checklist tab keeps the older four-pillar score. Alpha, Beta and Treynor are measured against the median of the fund&apos;s category and plan, not an index.
        AUM is AMFI&apos;s latest quarterly average (all plans). Day, week and 52-week figures use the AMFI NAV history. Past performance is not a guide to future returns.
      </p>

      <CompareTray
        labels={compare.selectedIds.map((id) => ({ id, name: compare.resolveLabel(id) }))}
        onRemove={compare.remove}
        onClear={compare.clear}
        onCompare={compare.openCompare}
      />
      <CompareView
        open={compare.compareOpen}
        type="mf"
        ids={compare.selectedIds}
        onClose={compare.closeCompare}
        onRemoveId={compare.remove}
        resolveLabel={compare.resolveLabel}
      />
      <MfMetricExplain metric={explain?.metric ?? null} row={explain?.row ?? null} onClose={() => setExplain(null)} />
      <MfOnePager row={onePager} onClose={() => setOnePager(null)} />
    </div>
  );
}

const FH_STATUS: Record<string, [string, string]> = {
  auto: ["Auto", "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C]"],
  manual_include: ["Manual", "bg-[#2E844A] text-white"],
  manual_exclude: ["Excluded", "bg-[#B42332] text-white"],
  blocked: ["Review", "bg-[#E8A317] text-[#181818]"],
};
const fhTitle = (row: MfScreenerRow) => {
  const flags = Array.isArray(row.fh_flags) ? (row.fh_flags as unknown as string[]) : [];
  return `Click for the full score breakdown${flags.length ? `. Flags: ${flags.join(", ").replaceAll("_", " ")}` : ""}`;
};

function Cell({ col, row, summary, onExplain }: { col: Col; row: MfScreenerRow; summary?: boolean; onExplain: () => void }) {
  const v = row[col.key];
  // Whole cell opens the plain-language explanation; keyboard users get Enter/Space.
  const click = {
    role: "button" as const, tabIndex: 0, onClick: onExplain,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onExplain(); } },
  };
  const cls = "cursor-pointer hover:bg-[#EAF5FE] dark:hover:bg-[#10243A] ";
  if (col.kind === "score" && summary) {
    return (
      <td {...click} title={fhTitle(row)} className={cls + "text-right whitespace-nowrap"}>
        <span className="font-medium tabular-nums">{typeof v === "number" ? v.toFixed(1) : "-"}</span>
        {FH_STATUS[String(row.fh_status)] && (
          <span className={`ml-1.5 align-middle rounded px-1 py-0.5 text-[9px] uppercase ${FH_STATUS[String(row.fh_status)][1]}`}>{FH_STATUS[String(row.fh_status)][0]}</span>
        )}
      </td>
    );
  }
  if (col.kind === "score") {
    const max = col.key === "score" ? 100 : 25;
    const label =
      col.key === "perf" ? row.perf_label : col.key === "ops" ? row.ops_label : col.key === "risk" ? row.risk_label : col.key === "port" ? row.port_label : null;
    const w = typeof v === "number" ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    return (
      <td {...click} title="Click to see why" className={cls + "text-right whitespace-nowrap"}>
        {label && <span className="mr-2 text-[10px] uppercase text-[#706E6B] dark:text-[#A8B4C4]">{label}</span>}
        <span className="font-medium tabular-nums">{typeof v === "number" ? v : "-"}</span>
        <div className="mt-1 ml-auto h-1 w-20 rounded bg-[#E5E5E5] dark:bg-[#2B3644]" aria-hidden>
          <div className="h-1 rounded bg-[#0176D3] dark:bg-[#1B96FF]" style={{ width: `${w}%` }} />
        </div>
      </td>
    );
  }
  if (col.kind === "stars") {
    const n = typeof v === "number" ? v : 0;
    return (
      <td {...click} className={cls + "text-right whitespace-nowrap"} title={n ? `${n} of 5 (FH rating from the FH score, not Morningstar)` : "Not rated: too little data behind the FH score"}>
        {n ? (
          <>
            <span className="text-[#E8A317] dark:text-[#FBBF24]">★</span> <span className="tabular-nums text-[#181818] dark:text-[#EDF2F7]">{n}/5</span>
          </>
        ) : (
          <span className="text-[#706E6B] dark:text-[#A8B4C4]">-</span>
        )}
        
      </td>
    );
  }
  if (col.kind === "text" && summary)
    return (
      <td {...click} title="Click to see why" className={cls}>
        <div className="flex items-center gap-1">
          {String(v ?? "-")}
          <span className="text-[#706E6B] dark:text-[#A8B4C4]" title={`Benchmark: ${String(row.benchmark ?? "-")}`} aria-label="About Category">ⓘ</span>
        </div>
      </td>
    );
  if (col.kind === "text")
    return (
      <td {...click} title="Click to see why" className={cls + "min-w-[200px]"}>
        <div>{String(v ?? "-")}</div>
        <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Benchmark: {String(row.benchmark ?? "-")}</div>
      </td>
    );
  if (col.kind === "aum") return <td {...click} title="Click to see why" className={cls + "text-right tabular-nums"}>{fmt(v, 0)}</td>;
  if (summary && col.kind === "pct" && typeof v !== "number") return <td {...click} title="Click to see why" className={cls + "text-right tabular-nums"}>–</td>;
  const avg = col.avg ? row[col.avg] : undefined;
  const when = col.date ? row[col.date] : undefined;
  return (
    <td {...click} title="Click to see why" className={`${cls}text-right tabular-nums ${col.kind === "pct" && !col.plain ? tone(v) : ""}`}>
      {fmt(v, col.digits)}
      {col.kind === "pct" && typeof v === "number" ? "%" : ""}
      {typeof when === "string" && when && <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">{formatISTDate(when)}</div>}
      {col.avg && (
        <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">cat. {typeof avg === "number" ? `${fmt(avg)}%` : "-"}</div>
      )}
    </td>
  );
}
