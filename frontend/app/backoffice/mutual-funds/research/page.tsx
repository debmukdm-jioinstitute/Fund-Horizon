"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRecommended } from "@/lib/recommended";
import {
  getMfScreener, getScreeningMetrics, listScreeningPresets, saveScreeningPreset, deleteScreeningPreset,
  getMfManagers, listMfShortlist, addMfShortlist, removeMfShortlist, mfShortlistCsvUrl, mfScreenerCsvUrl,
  getMfClientOverlap,
  type MfScreenerGroup, type MfScreenerRow, type MfManagerDirectoryRow, type MfShortlistItem,
  type ScreeningPresetItem, type MutualFundItem, type MfScreenerFreshness, type MfClientOverlap,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import MutualFundDrawer from "@/components/backoffice/MutualFundDrawer";
import MfManagerDrawer from "@/components/backoffice/MfManagerDrawer";
import MfOnePager from "@/components/backoffice/MfOnePager";
import CompareTray from "@/components/compare/CompareTray";
import CompareView from "@/components/compare/CompareView";
import { mfCompareId, useCompareSelection } from "@/lib/compare-selection";
import { shortDisplayName, normalizeDisplayName } from "@/components/backoffice/mfDisplayName";

const PAGE_SIZES = [5, 10, 20, 25, 50, 100];
const PLANS = ["Regular", "Direct"];
const QUARTILE_PERIODS = ["1y", "2y", "3y", "5y"] as const;
const CAPTURE_PERIODS = ["1y", "3y", "5y", "10y"] as const;
const COLUMNS_KEY = "fh-mf-research-columns";

type Range = { min?: string; max?: string };
type Ranges = Record<string, Range>;

interface ResearchFilters {
  category: string[];
  plan: string[];
  amc: string[];
  search: string;
  ranges: Ranges;
  quartile: number[];
  quartilePeriod: string;
  includeUnavailable: boolean;
  manager: string;
  minTenure: string;
  includeUnknown: boolean;
  capturePeriod: string;
}

const DEFAULT_COLUMNS = [
  "fund", "category", "plan", "score", "stars", "quartile_period",
  "ret_1y", "cagr_3y", "cagr_5y", "sharpe_3y", "sortino_3y", "cap_spread_3y",
  "ter_gap_pp", "aum_cr", "ter", "manager",
];

const ALL_COLUMNS: { key: string; label: string; sortable?: string; pct?: boolean; digits?: number }[] = [
  { key: "fund", label: "Fund" },
  { key: "category", label: "Category" },
  { key: "plan", label: "Plan" },
  { key: "score", label: "FH Checklist Score / 100", sortable: "score", digits: 0 },
  { key: "stars", label: "FH Star Rating", sortable: "stars", digits: 0 },
  { key: "quartile_period", label: "Quartile (computed)", sortable: "quartile_period" },
  { key: "ret_1y", label: "1Y return %", sortable: "ret_1y", pct: true },
  { key: "ret_2y", label: "2Y CAGR %", sortable: "ret_2y", pct: true },
  { key: "cagr_3y", label: "3Y CAGR %", sortable: "cagr_3y", pct: true },
  { key: "cagr_5y", label: "5Y CAGR %", sortable: "cagr_5y", pct: true },
  { key: "sharpe_3y", label: "Sharpe 3Y", sortable: "sharpe_3y" },
  { key: "sortino_3y", label: "Sortino 3Y", sortable: "sortino_3y" },
  { key: "alpha_3y", label: "Alpha 3Y % (vs category median)", sortable: "alpha_3y", pct: true },
  { key: "beta_3y", label: "Beta 3Y (vs category median)", sortable: "beta_3y" },
  { key: "vol_3y", label: "Volatility 3Y %", sortable: "vol_3y", pct: true },
  { key: "max_dd_3y", label: "Max drawdown 3Y %", sortable: "max_dd_3y", pct: true },
  { key: "cap_up_3y", label: "Up capture 3Y %", sortable: "cap_up_3y", pct: true },
  { key: "cap_down_3y", label: "Down capture 3Y %", sortable: "cap_down_3y", pct: true },
  { key: "cap_spread_3y", label: "Capture spread 3Y (pp)", sortable: "cap_spread_3y" },
  { key: "calmar_3y", label: "Calmar 3Y", sortable: "calmar_3y" },
  { key: "ter_gap_pp", label: "TER gap vs category + plan median (pp)", sortable: "ter_gap_pp" },
  { key: "ter", label: "Expense ratio (TER) %", sortable: "ter", pct: true },
  { key: "aum_cr", label: "AUM (Rs cr)", sortable: "aum_cr", digits: 0 },
  { key: "history_years", label: "Fund age (years)", sortable: "history_years", digits: 1 },
  { key: "roll1y_pos", label: "Rolling 1Y positive % (vs zero, not vs category)", sortable: "roll1y_pos", pct: true },
  { key: "pct_sharpe_3y", label: "Sharpe 3Y percentile", sortable: "pct_sharpe_3y", digits: 0 },
  { key: "pct_sortino_3y", label: "Sortino 3Y percentile", sortable: "pct_sortino_3y", digits: 0 },
  { key: "pct_alpha_3y", label: "Alpha 3Y percentile", sortable: "pct_alpha_3y", digits: 0 },
  { key: "pct_cagr_3y", label: "3Y CAGR percentile", sortable: "pct_cagr_3y", digits: 0 },
  { key: "pct_cagr_5y", label: "5Y CAGR percentile", sortable: "pct_cagr_5y", digits: 0 },
  { key: "roll_win_pct", label: "Rolling 1Y win % (vs category median, precomputed)", sortable: "roll_win_pct", pct: true },
  { key: "cal_topq_years", label: "Calendar top-quartile years (precomputed)", sortable: "cal_topq_years", digits: 0 },
  { key: "cal_win_pct", label: "Calendar win % (vs category median, precomputed)", sortable: "cal_win_pct", pct: true },
  { key: "downside_dev_3y", label: "Downside deviation 3Y % (precomputed)", sortable: "downside_dev_3y", pct: true },
  { key: "sip_cagr_3y", label: "SIP CAGR 3Y % (precomputed)", sortable: "sip_cagr_3y", pct: true },
  { key: "sip_cagr_5y", label: "SIP CAGR 5Y % (precomputed)", sortable: "sip_cagr_5y", pct: true },
  { key: "idx_alpha_3y", label: "Alpha 3Y % (vs index TRI — null until a TRI series is ingested)", sortable: "idx_alpha_3y", pct: true },
  { key: "idx_beta_3y", label: "Beta 3Y (vs index TRI — null until a TRI series is ingested)", sortable: "idx_beta_3y" },
  { key: "idx_tracking_error_3y", label: "Tracking error 3Y % (vs index TRI — null until a TRI series is ingested)", sortable: "idx_tracking_error_3y", pct: true },
  { key: "idx_information_ratio_3y", label: "Information ratio 3Y (vs index TRI — null until a TRI series is ingested)", sortable: "idx_information_ratio_3y" },
  { key: "manager", label: "Manager + tenure" },
];

function fmt(v: unknown, digits = 2): string {
  return typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}
function numOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function fmtAsOf(v?: string | null): string {
  return v ? formatISTDate(v) : "Not recorded";
}
function quartileKey(period: string): string {
  return `quartile_${period}`;
}
function parseRanges(params: URLSearchParams): Ranges {
  const out: Ranges = {};
  params.getAll("f").forEach((f) => {
    const [k, mn, mx] = f.split(":");
    if (k) out[k] = { min: mn || undefined, max: mx || undefined };
  });
  return out;
}
function toItem(r: MfScreenerRow): MutualFundItem {
  return {
    scheme_code: r.code, scheme_name: r.name, amc_name: r.amc ?? undefined, cat_key: r.cat,
    plan: r.plan, option: "Growth",
    latest_nav: typeof r.nav === "number" ? r.nav : undefined, nav_date: r.nav_date ?? undefined,
    ter_pct: typeof r.ter === "number" ? r.ter : undefined, isin_growth: r.isin ?? undefined,
    is_fh_recommended: r.is_fh_recommended,
  };
}
function shortlistRow(item: MfShortlistItem): MfScreenerRow {
  return {
    code: item.scheme_code, name: strOf(item.name ?? item.scheme_name) || item.scheme_code,
    amc: typeof item.amc === "string" ? item.amc : null, plan: strOf(item.plan) || "—",
    cat: strOf(item.cat ?? item.category), is_fh_recommended: item.is_fh_recommended === true,
    perf_label: "", risk_label: "", ops_label: "",
    ret_1y: numOf(item.ret_1y), cagr_3y: numOf(item.cagr_3y), cagr_5y: numOf(item.cagr_5y),
    sharpe_3y: numOf(item.sharpe_3y), cap_spread_3y: numOf(item.cap_spread_3y),
    score: numOf(item.score), quartile_2y: numOf(item.quartile_2y),
    manager_name: typeof item.manager_name === "string" ? item.manager_name : null,
    manager_tenure_years: numOf(item.manager_tenure_years),
  };
}
function shortlistItem(r: MfScreenerRow): MutualFundItem {
  return toItem(r);
}

function initialFilters(params: URLSearchParams): ResearchFilters {
  const q = params.getAll("quartile").map((x) => Number(x)).filter((n) => [1, 2, 3, 4].includes(n));
  return {
    category: params.getAll("category"),
    plan: params.has("plan") ? params.getAll("plan") : [...PLANS],
    amc: params.getAll("amc"),
    search: params.get("search") ?? "",
    ranges: parseRanges(params),
    quartile: q,
    quartilePeriod: QUARTILE_PERIODS.includes(params.get("quartile_period") as never) ? (params.get("quartile_period") as string) : "2y",
    includeUnavailable: params.get("include_unavailable") !== "false",
    manager: params.get("manager") ?? "",
    minTenure: params.get("min_tenure") ?? "",
    includeUnknown: params.get("include_unknown") !== "false",
    capturePeriod: "3y",
  };
}

export default function MfResearchPage() {
  return (
    <Suspense fallback={null}>
      <MfResearch />
    </Suspense>
  );
}

function MfResearch() {
  const router = useRouter();
  const params = useSearchParams();
  const compare = useCompareSelection("mf");
  const rec = useRecommended();

  const [tab, setTab] = useState<string>(() => (["research", "managers", "shortlist"].includes(params.get("tab") ?? "") ? (params.get("tab") as string) : "research"));
  const [filters, setFilters] = useState<ResearchFilters>(() => initialFilters(params));
  const [query, setQuery] = useState(params.get("search") ?? "");
  const [sort, setSort] = useState("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(25);
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<MfScreenerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<MfScreenerGroup[]>([]);
  const [freshness, setFreshness] = useState<MfScreenerFreshness | null>(null);
  const [asOf, setAsOf] = useState<string | null | undefined>();
  const [amcs, setAmcs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const [columns, setColumns] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "[]");
      return Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === "string") : [...DEFAULT_COLUMNS];
    } catch { return [...DEFAULT_COLUMNS]; }
  });
  const [showColumns, setShowColumns] = useState(false);
  const [presets, setPresets] = useState<ScreeningPresetItem[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetMsg, setPresetMsg] = useState("");
  const [presetToDelete, setPresetToDelete] = useState("");

  const [selected, setSelected] = useState<MutualFundItem | null>(null);
  const [onePager, setOnePager] = useState<MfScreenerRow | null>(null);

  // Managers tab state
  const [mgrQuery, setMgrQuery] = useState(params.get("tab") === "managers" ? (params.get("manager") ?? "") : "");
  const [mgrSearch, setMgrSearch] = useState(mgrQuery);
  const [mgrMinTenure, setMgrMinTenure] = useState("");
  const [mgrSort, setMgrSort] = useState("schemes");
  const [mgrOrder, setMgrOrder] = useState<"asc" | "desc">("desc");
  const [mgrPageSize, setMgrPageSize] = useState(25);
  const [mgrOffset, setMgrOffset] = useState(0);
  const [mgrRows, setMgrRows] = useState<MfManagerDirectoryRow[]>([]);
  const [mgrTotal, setMgrTotal] = useState(0);
  const [mgrLoading, setMgrLoading] = useState(false);
  const [mgrDrawer, setMgrDrawer] = useState<{ manager_name: string } | null>(null);

  // Shortlist tab state
  const [shortlist, setShortlist] = useState<MfShortlistItem[]>([]);
  const [shortLoading, setShortLoading] = useState(false);
  const [shortMsg, setShortMsg] = useState("");
  // Client check (read-only): shortlisted fund vs one client's CRM holdings.
  const [clientContact, setClientContact] = useState("");
  const [clientHorizon, setClientHorizon] = useState("");
  const [clientFund, setClientFund] = useState("");
  const [clientResult, setClientResult] = useState<MfClientOverlap | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState("");

  const synced = useRef(false);
  const fKey = JSON.stringify(filters);

  // Debounced search: clearing the box resets the applied search filter.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === query.trim() ? f : { ...f, search: query.trim() })), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => { setOffset(0); }, [fKey, pageSize]);
  useEffect(() => {
    const t = setTimeout(() => setMgrSearch(mgrQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [mgrQuery]);
  useEffect(() => { setMgrOffset(0); }, [mgrSearch, mgrMinTenure, mgrPageSize]);

  // Shareable URL: reload reproduces the table.
  useEffect(() => {
    if (!synced.current) { synced.current = true; return; }
    const p = new URLSearchParams();
    p.set("tab", tab);
    filters.category.forEach((c) => p.append("category", c));
    filters.plan.forEach((x) => p.append("plan", x));
    filters.amc.forEach((a) => p.append("amc", a));
    if (filters.search) p.set("search", filters.search);
    if (filters.manager) p.set("manager", filters.manager);
    if (filters.minTenure) p.set("min_tenure", filters.minTenure);
    filters.quartile.forEach((v) => p.append("quartile", String(v)));
    p.set("quartile_period", filters.quartilePeriod);
    p.set("include_unknown", String(filters.includeUnknown));
    p.set("include_unavailable", String(filters.includeUnavailable));
    Object.entries(filters.ranges).forEach(([k, r]) => {
      if (r.min || r.max) p.append("f", `${k}:${r.min ?? ""}:${r.max ?? ""}`);
    });
    router.replace(`?${p.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fKey, tab]);

  useEffect(() => {
    getScreeningMetrics()
      .then((res) => setAmcs(res.data?.facets?.amcs ?? []))
      .catch(() => setAmcs([]));
    listScreeningPresets().then((res) => setPresets(res.data ?? [])).catch(() => setPresets([]));
  }, []);

  useEffect(() => {
    if (tab !== "research") return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    const sortKey = sort === "quartile_period" ? quartileKey(filters.quartilePeriod) : sort;
    const minTenure = filters.minTenure.trim() ? Number(filters.minTenure) : undefined;
    getMfScreener({
      category: filters.category, plan: filters.plan, search: filters.search || undefined,
      sort: sortKey, order, ranges: filters.ranges, limit: pageSize, offset,
      amc: filters.amc, manager: filters.manager.trim() || undefined,
      min_tenure: Number.isFinite(minTenure) ? minTenure : undefined,
      include_unknown: filters.includeUnknown, quartile: filters.quartile,
      quartile_period: filters.quartilePeriod, include_unavailable: filters.includeUnavailable,
    }, ctl.signal)
      .then((res) => {
        // Stable secondary sort by fund name within the fetched page.
        const sorted = [...res.data].sort((a, b) => {
          const av = a[sortKey]; const bv = b[sortKey];
          if (typeof av === "number" && typeof bv === "number" && av !== bv) return order === "desc" ? bv - av : av - bv;
          if (typeof av === "number" && typeof bv !== "number") return -1;
          if (typeof av !== "number" && typeof bv === "number") return 1;
          return shortDisplayName(a.name).localeCompare(shortDisplayName(b.name));
        });
        setRows(sorted);
        setTotal(res.total);
        setGroups(res.groups);
        setAsOf(res.as_of);
        setFreshness(res.screenerMeta ?? null);
        if (amcs.length === 0) {
          const derived = Array.from(new Set(res.data.map((r) => r.amc).filter((x): x is string => typeof x === "string"))).sort();
          if (derived.length) setAmcs(derived);
        }
      })
      .catch((e: unknown) => { if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : "Failed to load research funds"); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fKey, sort, order, pageSize, offset, retry, tab]);

  useEffect(() => {
    if (tab !== "managers") return;
    setMgrLoading(true);
    const minT = mgrMinTenure.trim() ? Number(mgrMinTenure) : undefined;
    getMfManagers({
      search: mgrSearch || undefined, min_tenure: Number.isFinite(minT) ? minT : undefined,
      sort: mgrSort, order: mgrOrder, limit: mgrPageSize, offset: mgrOffset,
    })
      .then((res) => { setMgrRows(res.data); setMgrTotal(res.total); })
      .catch(() => { setMgrRows([]); setMgrTotal(0); })
      .finally(() => setMgrLoading(false));
  }, [tab, mgrSearch, mgrMinTenure, mgrSort, mgrOrder, mgrPageSize, mgrOffset]);

  const loadShortlist = () => {
    setShortLoading(true);
    listMfShortlist()
      .then((items) => setShortlist(items))
      .catch(() => setShortlist([]))
      .finally(() => setShortLoading(false));
  };
  useEffect(() => { if (tab === "shortlist") loadShortlist(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRange = (key: string, side: "min" | "max", value: string) =>
    setFilters((f) => ({ ...f, ranges: { ...f.ranges, [key]: { ...f.ranges[key], [side]: value || undefined } } }));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const toggleNum = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const onSort = (key: string) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(key); setOrder("desc"); }
  };
  const arrow = (key: string) => (sort === key ? (order === "asc" ? " ▲" : " ▼") : "");

  const addToShortlist = async (code: string, name: string) => {
    const reason = window.prompt(`Why does this fund belong on the shortlist? (${name})`, "");
    if (reason === null) return;
    try {
      await addMfShortlist(code, reason.trim() || undefined);
      setShortMsg("Added to the shortlist.");
      if (tab === "shortlist") loadShortlist();
    } catch (e) { setShortMsg(e instanceof Error ? e.message : "Could not add to the shortlist."); }
  };

  const applyPreset = (p: ScreeningPresetItem) => {
    const f = (p.filters ?? {}) as Record<string, unknown>;
    const arrStr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const arrNum = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => [1, 2, 3, 4].includes(n)) : []);
    setFilters((prev) => ({
      ...prev,
      category: arrStr(f.category),
      plan: arrStr(f.plan).length ? arrStr(f.plan) : [...PLANS],
      amc: arrStr(f.amc),
      search: typeof f.search === "string" ? f.search : prev.search,
      ranges: (f.ranges as Ranges) ?? prev.ranges,
      quartile: arrNum(f.quartile),
      quartilePeriod: typeof f.quartile_period === "string" ? f.quartile_period : prev.quartilePeriod,
      includeUnavailable: f.include_unavailable !== false,
      manager: typeof f.manager === "string" ? f.manager : prev.manager,
      minTenure: typeof f.min_tenure === "string" || typeof f.min_tenure === "number" ? String(f.min_tenure) : prev.minTenure,
      includeUnknown: f.include_unknown !== false,
    }));
    if (typeof f.search === "string") setQuery(f.search);
    setPresetMsg(`Preset "${p.name}" applied.`);
  };

  const savePreset = async () => {
    if (!presetName.trim()) { setPresetMsg("Enter a preset name first."); return; }
    try {
      await saveScreeningPreset(presetName.trim(), {
        category: filters.category, plan: filters.plan, amc: filters.amc, search: filters.search,
        ranges: filters.ranges, quartile: filters.quartile, quartile_period: filters.quartilePeriod,
        include_unavailable: filters.includeUnavailable, manager: filters.manager,
        min_tenure: filters.minTenure, include_unknown: filters.includeUnknown,
      });
      const res = await listScreeningPresets().catch(() => null);
      if (res) setPresets(res.data ?? []);
      setPresetMsg(`Preset "${presetName.trim()}" saved.`);
      setPresetName("");
    } catch (e) { setPresetMsg(e instanceof Error ? e.message : "Could not save the preset."); }
  };

  const catLabel = (key: string) => groups.flatMap((g) => g.categories).find((c) => c.key === key)?.label ?? key;
  const visibleCols = ALL_COLUMNS.filter((c) => columns.includes(c.key));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize);
  const mgrPageCount = Math.max(1, Math.ceil(mgrTotal / mgrPageSize));
  const mgrPage = Math.floor(mgrPageSize ? mgrOffset / mgrPageSize : 0);
  const qKeyForCsv = {
    category: filters.category, plan: filters.plan, search: filters.search || undefined,
    sort: sort === "quartile_period" ? quartileKey(filters.quartilePeriod) : sort, order,
    ranges: filters.ranges, amc: filters.amc, manager: filters.manager.trim() || undefined,
    quartile: filters.quartile, quartile_period: filters.quartilePeriod,
    include_unknown: filters.includeUnknown, include_unavailable: filters.includeUnavailable,
  };
  const universeLine = `${filters.category.length ? filters.category.map(catLabel).join(", ") : "All categories"} · ${filters.plan.join(" + ")} plans`;
  const fresh = freshness ?? { nav_as_of: asOf ?? null };

  const rangeField = (key: string, label: string) => (
    <div key={key} className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
      <div className="mb-1">{label}</div>
      <div className="flex gap-1.5">
        {(["min", "max"] as const).map((side) => (
          <input key={side} type="number" inputMode="decimal" placeholder={side} aria-label={`${label} ${side}`}
            value={filters.ranges[key]?.[side] ?? ""}
            onChange={(e) => setRange(key, side, e.target.value)}
            className="terminal-input w-full text-[12px] py-1 px-2" />
        ))}
      </div>
    </div>
  );

  return (
    <div className={`space-y-4 ${compare.selectedIds.length ? "pb-[88px]" : ""}`}>
      <div className="pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">MF Research</h1>
        <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
          {universeLine} · {loading && tab === "research" ? "Loading…" : `${total.toLocaleString("en-IN")} funds`}
        </p>
        <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
          Freshness — NAV: {fmtAsOf(fresh.nav_as_of)} · AUM: {fmtAsOf(fresh.aum_as_of)} · Expense ratio: {fmtAsOf(fresh.ter_as_of)} · Managers: {fmtAsOf(fresh.managers_as_of)} · Quartile (computed): {fmtAsOf(fresh.quartile_as_of)}
        </p>
        <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">Past performance is not a guide to future returns. FH Star Rating is our own risk-adjusted rank, not Morningstar&apos;s. Alpha, beta and Treynor are vs category median; the separate &ldquo;vs index TRI&rdquo; columns stay empty until a real total-return index series is ingested, and are never filled with the tracker-fund proxy.</p>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1">
        {(["research", "managers", "shortlist"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`${tab === t ? "terminal-btn-accent" : "terminal-btn"} text-[13px] py-1 px-3 capitalize`}>
            {t === "research" ? "Research" : t === "managers" ? "Managers" : "Shortlist"}
          </button>
        ))}
      </div>

      {tab === "research" && (
        <>
          <div className="terminal-panel p-2.5 space-y-3">
            <div>
              <div className="text-[12px] font-semibold mb-1.5">Universe — category, plan, fund house, search, fund age</div>
              <div className="space-y-1.5">
                {groups.map((g) => (
                  <div key={g.group} className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <span className="font-medium w-20 shrink-0">{g.group}</span>
                    {g.categories.map((c) => (
                      <label key={c.key} className="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={filters.category.includes(c.key)}
                          onChange={() => setFilters((f) => ({ ...f, category: toggle(f.category, c.key) }))} />
                        {c.label} <span className="text-[#706E6B] dark:text-[#A8B4C4]">({c.count})</span>
                      </label>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Loading categories…</div>}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" className="terminal-btn text-[12px] py-1 px-2" onClick={() => setFilters((f) => ({ ...f, category: groups.flatMap((g) => g.categories.map((c) => c.key)) }))}>All categories</button>
                <button type="button" className="terminal-btn text-[12px] py-1 px-2" onClick={() => setFilters((f) => ({ ...f, category: [] }))}>No category filter</button>
                {PLANS.map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-[12px] cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={filters.plan.includes(p)}
                      onChange={() => setFilters((f) => ({ ...f, plan: toggle(f.plan, p) }))} /> {p}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-medium">Fund house (AMC):</span>
                {amcs.length === 0 && <span className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Loading fund houses…</span>}
                {amcs.map((a) => (
                  <label key={a} className="flex items-center gap-1 text-[12px] cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={filters.amc.includes(a)}
                      onChange={() => setFilters((f) => ({ ...f, amc: toggle(f.amc, a) }))} /> {normalizeDisplayName(a)}
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-2">
                {rangeField("history_years", "Fund age (years)")}
              </div>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5">Performance — returns and quartile (computed)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {rangeField("ret_1y", "1Y return %")}
                {rangeField("cagr_3y", "3Y CAGR %")}
                {rangeField("cagr_5y", "5Y CAGR %")}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
                <span className="font-medium">Quartile (computed, category + plan peers):</span>
                {[1, 2, 3, 4].map((q) => (
                  <label key={q} className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={filters.quartile.includes(q)}
                      onChange={() => setFilters((f) => ({ ...f, quartile: toggleNum(f.quartile, q) }))} /> Q{q}
                  </label>
                ))}
                <label className="flex items-center gap-1.5">
                  Period
                  <select value={filters.quartilePeriod} onChange={(e) => setFilters((f) => ({ ...f, quartilePeriod: e.target.value }))} className="terminal-input text-[12px] py-1 px-2">
                    {QUARTILE_PERIODS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={filters.includeUnavailable}
                    onChange={(e) => setFilters((f) => ({ ...f, includeUnavailable: e.target.checked }))} />
                  Include unavailable (shown as Unavailable)
                </label>
              </div>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5">Risk — Sharpe, Sortino, alpha, beta, volatility, drawdown, capture</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {rangeField("sharpe_3y", "Sharpe 3Y")}
                {rangeField("sortino_3y", "Sortino 3Y")}
                {rangeField("alpha_3y", "Alpha 3Y % (vs category median)")}
                {rangeField("beta_3y", "Beta 3Y (vs category median)")}
                {rangeField("vol_3y", "Volatility 3Y %")}
                {rangeField("max_dd_3y", "Max drawdown 3Y %")}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
                <span className="font-medium">Capture period:</span>
                <select value={filters.capturePeriod} onChange={(e) => setFilters((f) => ({ ...f, capturePeriod: e.target.value }))} className="terminal-input text-[12px] py-1 px-2">
                  {CAPTURE_PERIODS.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                </select>
                <button type="button" className="terminal-btn text-[12px] py-1 px-2"
                  onClick={() => setFilters((f) => ({
                    ...f,
                    ranges: {
                      ...f.ranges,
                      [`cap_up_${f.capturePeriod}`]: { ...f.ranges[`cap_up_${f.capturePeriod}`], min: "100" },
                      [`cap_down_${f.capturePeriod}`]: { ...f.ranges[`cap_down_${f.capturePeriod}`], max: "100" },
                    },
                  }))}>
                  Up &gt; 100% and down &lt; 100%
                </button>
                <span className="text-[#706E6B] dark:text-[#A8B4C4]">No capture filter is applied unless you set one.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-2">
                {rangeField(`cap_up_${filters.capturePeriod}`, `Up capture ${filters.capturePeriod.toUpperCase()} min %`)}
                {rangeField(`cap_down_${filters.capturePeriod}`, `Down capture ${filters.capturePeriod.toUpperCase()} max %`)}
                {rangeField(`cap_spread_${filters.capturePeriod}`, `Capture spread ${filters.capturePeriod.toUpperCase()} min (pp)`)}
              </div>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5">Cost &amp; size — expense ratio, TER gap, AUM</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {rangeField("ter", "Expense ratio (TER) %")}
                {rangeField("ter_gap_pp", "TER gap vs category + plan median (pp)")}
                {rangeField("aum_cr", "AUM (Rs cr)")}
              </div>
              <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-1">TER gap = a fund&apos;s expense ratio minus the median expense ratio of its category + plan, in percentage points.</p>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5">Portfolio — holdings and sector (not yet available)</div>
              <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                Sector filter is shown here but disabled: no portfolio holdings snapshot is on file yet. AMFI monthly portfolio
                disclosures live on each fund house&apos;s website in its own format, and none has been ingested, so holdings,
                sector percentages, market-cap mix, turnover, cash %, style, concentration and fund-to-fund overlap are all
                shown as unavailable — never estimated. Open any fund dialog for the per-fund portfolio status.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px]">
                <label className="flex items-center gap-1.5">
                  Sector
                  <select disabled aria-label="Sector filter (unavailable)" className="terminal-input text-[12px] py-1 px-2 opacity-50">
                    <option>Sector data unavailable</option>
                  </select>
                </label>
                <span className="text-[#706E6B] dark:text-[#A8B4C4]">Filtering by sector needs an ingested holdings snapshot; until then this filter stays off rather than returning a partial list.</span>
              </div>
            </div>

            <div>
              <div className="text-[12px] font-semibold mb-1.5">Manager</div>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <input type="text" value={filters.manager} onChange={(e) => setFilters((f) => ({ ...f, manager: e.target.value }))}
                  placeholder="Manager name" className="terminal-input py-1 px-2 max-w-[220px]" />
                <label className="flex items-center gap-1.5">
                  Min tenure (years)
                  <input type="number" inputMode="decimal" value={filters.minTenure}
                    onChange={(e) => setFilters((f) => ({ ...f, minTenure: e.target.value }))}
                    className="terminal-input w-20 py-1 px-2" />
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={filters.includeUnknown}
                    onChange={(e) => setFilters((f) => ({ ...f, includeUnknown: e.target.checked }))} />
                  Include unknown manager (shown as Unknown)
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search fund, fund house or scheme code…" className="terminal-input max-w-md flex-1 text-[12px] py-1 px-2.5" />
              <button type="button" className="terminal-btn text-[12px] py-1 px-3" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
                Columns ({columns.length})
              </button>
              <a href={mfScreenerCsvUrl(qKeyForCsv)} download className="terminal-btn text-[12px] py-1 px-3 no-underline">Export CSV</a>
              <button type="button" className="terminal-btn text-[12px] py-1 px-3"
                onClick={() => {
                  setFilters((f) => ({
                    ...f, category: [], plan: [...PLANS], amc: [], search: "", ranges: {}, quartile: [],
                    manager: "", minTenure: "", includeUnknown: true, includeUnavailable: true,
                  }));
                  setQuery("");
                }}>
                Clear all filters
              </button>
            </div>
            {showColumns && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 text-[12px]">
                {ALL_COLUMNS.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 accent-[#0176D3]" checked={columns.includes(c.key)}
                      onChange={() => setColumns((prev) => {
                        const next = prev.includes(c.key) ? prev.filter((x) => x !== c.key) : [...prev, c.key];
                        try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
                        return next;
                      })} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name"
                className="terminal-input py-1 px-2 max-w-[200px]" />
              <button type="button" className="terminal-btn-accent text-[12px] py-1 px-3" onClick={savePreset}>Save preset</button>
              <select aria-label="Load preset" defaultValue="" onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value);
                if (p) applyPreset(p);
                e.target.value = "";
              }} className="terminal-input text-[12px] py-1 px-2">
                <option value="">Load a preset…</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.builtin ? " (built-in)" : ""}</option>)}
              </select>
              <select aria-label="Delete preset" value={presetToDelete} onChange={(e) => setPresetToDelete(e.target.value)} className="terminal-input text-[12px] py-1 px-2">
                <option value="">Delete a preset…</option>
                {presets.filter((p) => !p.builtin).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" className="terminal-btn text-[12px] py-1 px-3" disabled={!presetToDelete}
                onClick={async () => {
                  try {
                    await deleteScreeningPreset(presetToDelete);
                    const res = await listScreeningPresets().catch(() => null);
                    if (res) setPresets(res.data ?? []);
                    setPresetMsg("Preset deleted.");
                    setPresetToDelete("");
                  } catch (e) { setPresetMsg(e instanceof Error ? e.message : "Could not delete the preset."); }
                }}>
                Delete preset
              </button>
              {presetMsg && <span className="text-[#706E6B] dark:text-[#A8B4C4]">{presetMsg}</span>}
            </div>
            <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
              Presets are shared with the screening funnel: a preset saved here appears there and vice versa. What the funnel carries over:
              category (one or several), fund house (one or several), search, quartile period and quartile set, manager name search,
              minimum manager tenure, and bounds for Sharpe, Sortino, up/down capture, capture spread, TER gap (funnel: vs category
              median; this table: vs category + plan median) and the precomputed consistency metrics. What it does not carry over, so funnel results for the same preset name may still differ: plan
              (the funnel&apos;s metrics carry no plan), return / TER / AUM ranges (research-table-only fields), the include-unknown
              and include-unavailable toggles (the funnel keeps missing-data funds flagged under its own rule instead), and the
              quartile definition itself — the funnel ranks quartiles per category with its external-first cascade, while this
              table ranks per category + plan from computed returns, and the funnel always retains Q1 funds even when a preset&apos;s
              quartile set excludes Q1, so a funnel run may include Q1 funds the research filter left out.
            </p>
            <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
              Missing values show as —, never 0. Quartile values here are computed in-house (category + plan peers); the screener&apos;s Quartile Rankings tab
              uses Advisorkhoj figures and is a separate cross-check.
            </p>
          </div>

          {error && (
            <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              <button type="button" className="terminal-btn text-[12px] py-1 px-3" onClick={() => setRetry((t) => t + 1)}>Retry</button>
            </div>
          )}

          <div className="terminal-panel overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-270px)] min-h-[420px]">
              <table className="terminal-table">
                <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
                  <tr>
                    <th className="w-[40px]" aria-label="Compare" />
                    <th className="min-w-[240px]">
                      <button type="button" onClick={() => onSort("name")} className="hover:underline cursor-pointer text-left">Fund{arrow("name")}</button>
                    </th>
                    {visibleCols.filter((c) => c.key !== "fund").map((c) => {
                      const label = c.key === "quartile_period" ? `Quartile ${filters.quartilePeriod.toUpperCase()} (computed)` : c.label;
                      return (
                        <th key={c.key} className="text-right whitespace-nowrap">
                          {c.sortable
                            ? <button type="button" onClick={() => onSort(c.sortable as string)} className="hover:underline cursor-pointer">{label}{arrow(c.sortable)}</button>
                            : label}
                        </th>
                      );
                    })}
                    <th className="text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={visibleCols.length + 2} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">No funds match the current filters.</td></tr>
                  )}
                  {rows.map((r) => {
                    const cid = mfCompareId({ scheme_code: r.code });
                    const checked = compare.selectedIds.includes(cid);
                    const qv = r[quartileKey(filters.quartilePeriod)];
                    const mgr = typeof r.manager_name === "string" ? r.manager_name : null;
                    return (
                      <tr key={r.code} className={loading ? "opacity-50" : ""}>
                        <td className="text-center align-middle">
                          <input type="checkbox" checked={checked} disabled={!checked && compare.maxSelected}
                            aria-label={`Compare ${r.name}`} className="h-4 w-4 accent-[#0176D3]"
                            onChange={() => compare.toggle(cid, r.name)} />
                        </td>
                        {visibleCols.map((c) => {
                          if (c.key === "fund") {
                            return (
                              <td key={c.key}>
                                <button type="button" onClick={() => setSelected(toItem(r))}
                                  className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline cursor-pointer leading-snug">
                                  {shortDisplayName(r.name)}
                                </button>
                                {(r.is_fh_recommended || rec.isMfRecommended(r.code)) && (
                                  <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#0176D3] text-white align-middle">★ FH</span>
                                )}
                                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{r.amc ? normalizeDisplayName(r.amc) : "—"} · {r.plan}</div>
                              </td>
                            );
                          }
                          if (c.key === "category") return <td key={c.key}>{catLabel(r.cat)}</td>;
                          if (c.key === "plan") return <td key={c.key}>{r.plan}</td>;
                          if (c.key === "stars") {
                            const n = typeof r.stars === "number" ? r.stars : 0;
                            return <td key={c.key} className="text-right whitespace-nowrap text-[#B45309] dark:text-[#FBBF24]">{n ? "★".repeat(n) + "☆".repeat(5 - n) : "—"}</td>;
                          }
                          if (c.key === "quartile_period") {
                            return (
                              <td key={c.key} className="text-right whitespace-nowrap">
                                {typeof qv === "number" ? `Q${qv}` : <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] text-[#706E6B] dark:text-[#A8B4C4]">Unavailable</span>}
                              </td>
                            );
                          }
                          if (c.key === "manager") {
                            return (
                              <td key={c.key} className="whitespace-nowrap">
                                {mgr ? (
                                  <button type="button" className="text-[#0176D3] dark:text-[#1B96FF] hover:underline"
                                    onClick={() => setMgrDrawer({ manager_name: mgr })}>{normalizeDisplayName(mgr)}</button>
                                ) : (
                                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] text-[#706E6B] dark:text-[#A8B4C4]">Unknown</span>
                                )}
                                {typeof r.manager_tenure_years === "number" && <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]"> · {r.manager_tenure_years.toFixed(1)} yrs</span>}
                              </td>
                            );
                          }
                          const v = r[c.key];
                          return (
                            <td key={c.key} className="text-right tabular-nums whitespace-nowrap">
                              {fmt(v, c.digits ?? 2)}{c.pct && typeof v === "number" ? "%" : ""}
                            </td>
                          );
                        })}
                        <td className="text-right whitespace-nowrap">
                          <button type="button" className="terminal-btn text-[11px] py-0.5 px-2 mr-1" onClick={() => setOnePager(r)}>One-pager</button>
                          <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" onClick={() => addToShortlist(r.code, shortDisplayName(r.name))}>Add to shortlist</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-[#E5E5E5] dark:border-[#2B3644] text-[11px] text-[#706E6B] dark:text-[#A8B4C4] flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5">
                Rows
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="terminal-input text-[11px] py-0.5 px-1.5">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-1.5">
                <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={page <= 0 || loading} onClick={() => setOffset(offset - pageSize)}>Previous</button>
                <span>Page {page + 1} of {pageCount}</span>
                <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>Next</button>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "managers" && (
        <div className="space-y-3">
          <div className="terminal-panel p-2.5 flex flex-wrap items-center gap-2 text-[12px]">
            <input type="text" value={mgrQuery} onChange={(e) => setMgrQuery(e.target.value)} placeholder="Search manager name…"
              className="terminal-input py-1 px-2 max-w-[260px]" />
            <label className="flex items-center gap-1.5">
              Min tenure (years)
              <input type="number" inputMode="decimal" value={mgrMinTenure} onChange={(e) => setMgrMinTenure(e.target.value)} className="terminal-input w-20 py-1 px-2" />
            </label>
            <label className="flex items-center gap-1.5">
              Sort
              <select value={mgrSort} onChange={(e) => setMgrSort(e.target.value)} className="terminal-input py-1 px-2">
                <option value="schemes">Schemes</option>
                <option value="tenure">Tenure</option>
                <option value="aum_estimate">AUM estimate</option>
                <option value="name">Name</option>
              </select>
            </label>
            <button type="button" className="terminal-btn text-[12px] py-1 px-2" onClick={() => setMgrOrder((o) => (o === "asc" ? "desc" : "asc"))}>
              {mgrOrder === "desc" ? "Descending ▼" : "Ascending ▲"}
            </button>
            <span className="text-[#706E6B] dark:text-[#A8B4C4]">{mgrLoading ? "Loading…" : `${mgrTotal.toLocaleString("en-IN")} managers`}</span>
          </div>
          <div className="terminal-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th className="min-w-[220px]">Manager</th>
                    <th className="text-right">Schemes</th>
                    <th className="text-right">Portfolios</th>
                    <th className="text-right">Longest tenure (yrs)</th>
                    <th className="text-right">Avg tenure (yrs)</th>
                    <th className="text-right">AUM estimate (distinct portfolios, Rs cr)</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!mgrLoading && mgrRows.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">No managers match the current filters.</td></tr>
                  )}
                  {mgrRows.map((m, i) => (
                    <tr key={m.manager_name ?? `unknown-${i}`} className={mgrLoading ? "opacity-50" : ""}>
                      <td>
                        {m.manager_name ? (
                          <button type="button" onClick={() => setMgrDrawer({ manager_name: m.manager_name as string })}
                            className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline">
                            {normalizeDisplayName(m.manager_name)}
                          </button>
                        ) : (
                          <span className="font-medium">Unknown manager</span>
                        )}
                        <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                          {m.needs_data ? "Needs data: a scheme has no start date. " : ""}
                          {m.aum_incomplete ? "AUM incomplete: a portfolio has no AUM." : ""}
                        </div>
                      </td>
                      <td className="text-right tabular-nums">{m.schemes}</td>
                      <td className="text-right tabular-nums">{m.portfolios}</td>
                      <td className="text-right tabular-nums">{fmt(m.longest_tenure_years, 1)}</td>
                      <td className="text-right tabular-nums">{fmt(m.avg_tenure_years, 1)}</td>
                      <td className="text-right tabular-nums">{fmt(m.aum_estimate_cr, 0)}</td>
                      <td className="text-right whitespace-nowrap">
                        {m.manager_name && (
                          <button type="button" className="terminal-btn text-[11px] py-0.5 px-2"
                            onClick={() => {
                              setFilters((f) => ({ ...f, manager: m.manager_name as string }));
                              setTab("research");
                            }}>
                            View in Research
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-[#E5E5E5] dark:border-[#2B3644] text-[11px] text-[#706E6B] dark:text-[#A8B4C4] flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5">
                Rows
                <select value={mgrPageSize} onChange={(e) => setMgrPageSize(Number(e.target.value))} className="terminal-input text-[11px] py-0.5 px-1.5">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-1.5">
                <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={mgrPage <= 0 || mgrLoading} onClick={() => setMgrOffset(mgrOffset - mgrPageSize)}>Previous</button>
                <span>Page {mgrPage + 1} of {mgrPageCount}</span>
                <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={mgrOffset + mgrPageSize >= mgrTotal || mgrLoading} onClick={() => setMgrOffset(mgrOffset + mgrPageSize)}>Next</button>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">AUM estimate sums AUM over distinct portfolios (Regular and Direct rows of one fund count once), so it is an estimate, never an audited total. Funds with no manager on file are listed under Unknown manager with their count, never dropped.</p>
        </div>
      )}

      {tab === "shortlist" && (
        <div className="space-y-3">
          <div className="terminal-panel p-2.5 flex flex-wrap items-center gap-2 text-[12px]">
            <span>{shortLoading ? "Loading…" : `${shortlist.length} funds on the shortlist`}</span>
            <a href={mfShortlistCsvUrl()} download className="terminal-btn text-[12px] py-1 px-3 no-underline">Export CSV</a>
            <button type="button" className="terminal-btn text-[12px] py-1 px-3" onClick={loadShortlist}>Refresh</button>
            {shortMsg && <span className="text-[#706E6B] dark:text-[#A8B4C4]">{shortMsg}</span>}
          </div>
          <div className="terminal-panel p-2.5 space-y-2">
            <div className="text-[12px] font-semibold">Client check — read-only: does a shortlisted fund duplicate what a client already holds?</div>
            <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Nothing here changes client data, sends anything, or marks a pick. Enter a CRM contact id, pick a shortlisted fund, and optionally a goal horizon in years.</p>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <input type="text" value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="CRM contact id"
                className="terminal-input py-1 px-2 max-w-[220px]" />
              <select value={clientFund} onChange={(e) => setClientFund(e.target.value)} className="terminal-input py-1 px-2 max-w-[300px]">
                <option value="">Pick a shortlisted fund…</option>
                {shortlist.map((item) => (
                  <option key={item.scheme_code} value={item.scheme_code}>{shortDisplayName(strOf(item.name ?? item.scheme_name) || item.scheme_code)}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5">
                Goal horizon (years)
                <input type="number" inputMode="decimal" value={clientHorizon} onChange={(e) => setClientHorizon(e.target.value)} className="terminal-input w-20 py-1 px-2" />
              </label>
              <button type="button" className="terminal-btn-accent text-[12px] py-1 px-3" disabled={!clientContact.trim() || !clientFund || clientLoading}
                onClick={async () => {
                  setClientLoading(true); setClientError(""); setClientResult(null);
                  try {
                    const horizon = clientHorizon.trim() ? Number(clientHorizon) : undefined;
                    const res = await getMfClientOverlap({
                      scheme_code: clientFund, contact_id: clientContact.trim(),
                      horizon_years: Number.isFinite(horizon) ? horizon : undefined,
                    });
                    if (!res) setClientError("No result returned.");
                    else setClientResult(res);
                  } catch (e) { setClientError(e instanceof Error ? e.message : "Could not run the client check."); }
                  finally { setClientLoading(false); }
                }}>
                {clientLoading ? "Checking…" : "Check client overlap"}
              </button>
            </div>
            {clientError && <p className="text-[12px] text-[#B42332] dark:text-[#FF7D86]">{clientError}</p>}
            {clientResult && (
              <div className="text-[12px] space-y-1.5">
                <div><span className="font-medium">{clientResult.fund ?? clientResult.scheme_code}</span>
                  {clientResult.contact_name ? ` · Client: ${clientResult.contact_name}` : ""} · Holdings on file: {clientResult.holdings_count}</div>
                {clientResult.crm_error && <p className="text-[#706E6B] dark:text-[#A8B4C4]">{clientResult.crm_error}</p>}
                {clientResult.overlap && <p>{clientResult.overlap.duplication_note}</p>}
                {clientResult.overlap && clientResult.overlap.same_category_holdings.length > 0 && (
                  <p className="text-[#706E6B] dark:text-[#A8B4C4]">Same-category holdings on file: {clientResult.overlap.same_category_holdings.map((h) => String(h.scheme_name ?? h.scheme_code)).join(", ")}</p>
                )}
                {clientResult.horizon?.level && <p>Horizon flag ({clientResult.horizon.level}): {clientResult.horizon.message ?? "No concern from the simple horizon rule."}</p>}
                {clientResult.suitability && <p>Risk-profile flag ({clientResult.suitability.level}): {clientResult.suitability.message ?? "Within the client's recorded risk limit."}</p>}
                {clientResult.replacement_candidates && clientResult.replacement_candidates.length > 0 && (
                  <div>
                    <div className="font-medium">Replacement candidates (same category, higher checklist score, lower expense ratio, longer manager tenure):</div>
                    <ul className="list-disc ml-5">
                      {clientResult.replacement_candidates.map((r) => (
                        <li key={String(r.scheme_code)}>{String(r.fund)} · Score {String(r.score)} · TER {String(r.ter)}% · Manager {String(r.manager_name)} ({String(r.manager_tenure_years)} yrs)</li>
                      ))}
                    </ul>
                  </div>
                )}
                {clientResult.tax_notes && clientResult.tax_notes.length > 0 && (
                  <div>
                    <div className="font-medium">Tax notes (general information, not advice):</div>
                    <ul className="list-disc ml-5 text-[#706E6B] dark:text-[#A8B4C4]">
                      {clientResult.tax_notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}
                {clientResult.scope_note && <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{clientResult.scope_note}</p>}
              </div>
            )}
          </div>
          <div className="terminal-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th className="min-w-[220px]">Fund</th>
                    <th>Category</th>
                    <th>Plan</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">1Y %</th>
                    <th className="text-right">3Y CAGR %</th>
                    <th className="text-right">5Y CAGR %</th>
                    <th className="text-right">Sharpe 3Y</th>
                    <th className="text-right">Capture spread 3Y (pp)</th>
                    <th className="text-right">Quartile 2Y (computed)</th>
                    <th>Manager + tenure</th>
                    <th>Reason</th>
                    <th>Date added</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!shortLoading && shortlist.length === 0 && (
                    <tr><td colSpan={14} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">Nothing on the shortlist yet. Add a fund from the Research tab or from a fund dialog.</td></tr>
                  )}
                  {shortlist.map((item) => {
                    const r = shortlistRow(item);
                    const qv = r.quartile_2y;
                    const marked = rec.isMfRecommended(item.scheme_code);
                    return (
                      <tr key={String(item.id ?? item.scheme_code)}>
                        <td>
                          <button type="button" onClick={() => setSelected(shortlistItem(r))}
                            className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline leading-snug">
                            {shortDisplayName(r.name)}
                          </button>
                        </td>
                        <td>{catLabel(r.cat) || "—"}</td>
                        <td>{r.plan}</td>
                        <td className="text-right tabular-nums">{fmt(r.score, 0)}</td>
                        <td className="text-right tabular-nums">{fmt(r.ret_1y)}%</td>
                        <td className="text-right tabular-nums">{fmt(r.cagr_3y)}%</td>
                        <td className="text-right tabular-nums">{fmt(r.cagr_5y)}%</td>
                        <td className="text-right tabular-nums">{fmt(r.sharpe_3y)}</td>
                        <td className="text-right tabular-nums">{fmt(r.cap_spread_3y)}</td>
                        <td className="text-right whitespace-nowrap">{typeof qv === "number" ? `Q${qv}` : "—"}</td>
                        <td className="whitespace-nowrap">
                          {typeof r.manager_name === "string" && r.manager_name ? normalizeDisplayName(r.manager_name) : "Unknown"}
                          {typeof r.manager_tenure_years === "number" ? ` · ${r.manager_tenure_years.toFixed(1)} yrs` : ""}
                        </td>
                        <td className="min-w-[160px]">{strOf(item.reason) || "—"}</td>
                        <td className="whitespace-nowrap">{typeof item.date_added === "string" || typeof item.date_added === "number" ? formatISTDate(item.date_added) : "—"}</td>
                        <td className="text-right whitespace-nowrap">
                          <button type="button" className="terminal-btn text-[11px] py-0.5 px-2 mr-1" onClick={() => setOnePager(r)}>One-pager</button>
                          <button type="button" className="terminal-btn text-[11px] py-0.5 px-2 mr-1"
                            onClick={() => rec.toggleMf(item.scheme_code, r.name)}>
                            {marked ? "★ FH Recommended" : "Mark FH Recommended"}
                          </button>
                          <button type="button" className="terminal-btn text-[11px] py-0.5 px-2"
                            onClick={async () => {
                              try { await removeMfShortlist(item.scheme_code); setShortMsg("Removed from the shortlist."); loadShortlist(); }
                              catch (e) { setShortMsg(e instanceof Error ? e.message : "Could not remove."); }
                            }}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Adding to or removing from the shortlist never changes FH Recommended status. Marking FH Recommended is a separate, explicit action above.</p>
        </div>
      )}

      <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Past performance is not a guide to future returns.</p>

      <CompareTray
        labels={compare.selectedIds.map((id) => ({ id, name: compare.resolveLabel(id) }))}
        onRemove={compare.remove} onClear={compare.clear} onCompare={compare.openCompare}
      />
      <CompareView open={compare.compareOpen} type="mf" ids={compare.selectedIds} onClose={compare.closeCompare} onRemoveId={compare.remove} resolveLabel={compare.resolveLabel} />
      <MutualFundDrawer scheme={selected} onClose={() => setSelected(null)} />
      <MfOnePager row={onePager} onClose={() => setOnePager(null)} />
      {mgrDrawer && <MfManagerDrawer manager={mgrDrawer} onClose={() => setMgrDrawer(null)} />}
    </div>
  );
}
