"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getMfScreener,
  mfScreenerCsvUrl,
  MfScreenerGroup,
  MfScreenerQuery,
  MfScreenerRow,
  MutualFundItem,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";
import MutualFundDrawer from "@/components/backoffice/MutualFundDrawer";
import CompareTray from "@/components/compare/CompareTray";
import CompareView from "@/components/compare/CompareView";
import { mfCompareId, useCompareSelection } from "@/lib/compare-selection";

const SECTIONS = ["Summary", "Checklist", "Returns", "Risk Vs Reward"] as const;
type Section = (typeof SECTIONS)[number];
const PAGE_SIZES = [5, 10, 20, 25, 50, 100];
const DEFAULT_CATEGORIES = ["flexi_cap", "multi_cap"];
const PLANS = ["Regular", "Direct"];

type Kind = "pct" | "num" | "score" | "text";
interface Col {
  key: string;
  label: string;
  kind: Kind;
  digits?: number;
  /** Category-average column shown beneath the value (Returns tab). */
  avg?: string;
}

const pct = (key: string, label: string, avg?: string): Col => ({ key, label, kind: "pct", digits: 2, avg });
const num = (key: string, label: string, digits = 2): Col => ({ key, label, kind: "num", digits });

const COLUMNS: Record<Section, Col[]> = {
  Summary: [
    { key: "score", label: "FH Checklist Score / 100", kind: "score" },
    num("ter", "Net Expense Ratio"),
    num("nav", "Current NAV"),
    pct("ret_1m", "Month change %"),
    pct("ret_3m", "Returns 3M %"),
    pct("ret_1y", "Returns 1Yr %"),
    pct("ret_2y", "2Yr CAGR %"),
    pct("cagr_3y", "3Yr CAGR %"),
    pct("cagr_5y", "5Yr CAGR %"),
  ],
  Checklist: [
    { key: "score", label: "FH Checklist Score / 100", kind: "score" },
    { key: "perf", label: "Performance / 25", kind: "score" },
    { key: "ops", label: "Operations / 25", kind: "score" },
    { key: "risk", label: "Risk vs Reward / 25", kind: "score" },
  ],
  Returns: [
    pct("ret_3m", "Returns 3M %", "ret_3m_cat"),
    pct("ret_6m", "Returns 6M %"),
    pct("ret_1y", "Returns 1Yr %", "ret_1y_cat"),
    pct("ret_2y", "2Yr CAGR %", "ret_2y_cat"),
    pct("cagr_3y", "3Yr CAGR %", "cagr_3y_cat"),
    pct("cagr_5y", "5Yr CAGR %", "cagr_5y_cat"),
    pct("cagr_7y", "7Yr CAGR %"),
    pct("cagr_10y", "10Yr CAGR %", "cagr_10y_cat"),
    pct("cagr_si", "Since inception CAGR %"),
  ],
  "Risk Vs Reward": [
    pct("vol_3y", "Std Dev 3Yr %"),
    num("sharpe_3y", "Sharpe Ratio 3Yr"),
    num("sortino_3y", "Sortino Ratio 3Yr"),
    pct("max_dd_3y", "Max Drawdown 3Yr %"),
    pct("max_dd_all", "Max Drawdown All %"),
    pct("roll1y_pos", "Rolling 1Yr positive %"),
  ],
};

const FILTERABLE: { key: string; label: string }[] = [
  { key: "score", label: "FH Checklist Score" },
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
    plan: r.plan,
    option: "Growth",
    latest_nav: typeof r.nav === "number" ? r.nav : undefined,
    nav_date: r.nav_date ?? undefined,
    ter_pct: typeof r.ter === "number" ? r.ter : undefined,
    isin_growth: r.isin ?? undefined,
    is_fh_recommended: r.is_fh_recommended,
  };
}

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

  const category = useMemo(() => (params.has("category") ? params.getAll("category") : DEFAULT_CATEGORIES), [params]);
  const plan = useMemo(() => (params.has("plan") ? params.getAll("plan") : PLANS), [params]);
  const section = (SECTIONS.find((s) => s === params.get("section")) ?? "Summary") as Section;

  const [sort, setSort] = useState("score");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState(25);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [ranges, setRanges] = useState<Record<string, { min?: string; max?: string }>>({});
  const [draft, setDraft] = useState<Record<string, { min?: string; max?: string }>>({});
  const [showFilter, setShowFilter] = useState(false);
  const [activeGroup, setActiveGroup] = useState("Equity");
  const [rows, setRows] = useState<MfScreenerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<MfScreenerGroup[]>([]);
  const [asOf, setAsOf] = useState<string | null | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<MutualFundItem | null>(null);

  const q: MfScreenerQuery = { category, plan, search, sort, order, ranges, recommended };
  const qKey = JSON.stringify(q);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => setOffset(0), [qKey, pageSize]);

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
  const selectedLabels = groups.flatMap((g) => g.categories).filter((c) => category.includes(c.key)).map((c) => c.label);

  function onSort(key: string) {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder(key === "name" || key === "ter" ? "asc" : "desc");
    }
  }
  const arrow = (key: string) => (sort === key ? (order === "asc" ? " ▲" : " ▼") : <span className="opacity-30"> ⇅</span>);

  const cols = COLUMNS[section];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize);
  const activeFilters = Object.values(ranges).filter((r) => r.min || r.max).length;

  return (
    <div className={`space-y-4 ${compare.selectedIds.length ? "pb-[88px]" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
            {selectedLabels.length ? `Top ${selectedLabels.slice(0, 3).join(", ")}${selectedLabels.length > 3 ? " & more" : ""} mutual funds` : "Mutual funds"}
          </h1>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Compare Growth-option schemes by returns, risk, expense ratio and FH checklist score. NAV as of {asOf ? formatISTDate(asOf) : "-"}. Source: AMFI + mfapi.in.
          </p>
        </div>
        <button
          type="button"
          disabled={compare.selectedIds.length < 2}
          onClick={compare.openCompare}
          className="terminal-btn-accent text-[12px] py-1 px-3 disabled:opacity-40"
        >
          Compare{compare.selectedIds.length ? ` (${compare.selectedIds.length})` : ""}
        </button>
      </div>

      <div className="terminal-panel p-2.5 space-y-2.5">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
          <label className="flex items-center gap-2 text-[12px] font-medium text-[#006F64] dark:text-[#75E1CE] cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#006F64]"
              checked={allSelected}
              onChange={() =>
                setUrl({ category: allSelected ? category.filter((c) => !groupKeys.includes(c)) : Array.from(new Set([...category, ...groupKeys])) })
              }
            />
            Select All ({groupKeys.length})
          </label>
          {group?.categories.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-[12px] text-[#172033] dark:text-[#EDF2F7] cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#006F64]"
                checked={category.includes(c.key)}
                onChange={() => setUrl({ category: toggle(category, c.key) })}
              />
              {c.label} <span className="text-[#536176] dark:text-[#A8B4C4]">({c.count})</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div role="tablist" className="flex flex-wrap items-center gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={section === s}
              onClick={() => {
                setUrl({ section: s });
                setSort(s === "Risk Vs Reward" ? "sharpe_3y" : s === "Returns" ? "cagr_3y" : "score");
                setOrder("desc");
              }}
              className={`text-[13px] py-1 px-3 border-b-2 ${section === s ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE] font-medium" : "border-transparent text-[#536176] dark:text-[#A8B4C4]"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#172033] dark:text-[#EDF2F7]">
          {PLANS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-[#006F64]" checked={plan.includes(p)} onChange={() => setUrl({ plan: toggle(plan, p) })} />
              {p}
            </label>
          ))}
          <button
            type="button"
            aria-pressed={recommended}
            onClick={() => setRecommended((v) => !v)}
            className={`${recommended ? "terminal-btn-accent" : "terminal-btn"} text-[12px] py-1 px-3`}
          >
            ★ FH Recommended
          </button>
          <button type="button" aria-expanded={showFilter} onClick={() => setShowFilter((v) => !v)} className="terminal-btn text-[12px] py-1 px-3">
            Quick Filter{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          <a href={mfScreenerCsvUrl(q)} download className="terminal-btn text-[12px] py-1 px-3 no-underline">
            Export CSV
          </a>
        </div>
      </div>

      {showFilter && (
        <div className="terminal-panel p-2.5 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {FILTERABLE.map((f) => (
              <div key={f.key} className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
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
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fund, AMC or scheme code…"
          className="terminal-input w-full max-w-md text-[12px] py-1 px-2.5"
        />
        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">{loading ? "Loading…" : `${total.toLocaleString("en-IN")} funds`}</div>
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
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th className="w-[40px]" aria-label="Compare" />
                <th className="min-w-[240px]">
                  <button type="button" onClick={() => onSort("name")} className="hover:underline cursor-pointer text-left">
                    Fund Name{arrow("name")}
                  </button>
                </th>
                {cols.map((c) => (
                  <th key={c.key} className="text-right whitespace-nowrap">
                    <button type="button" onClick={() => onSort(c.key)} className="hover:underline cursor-pointer" title={`Sort by ${c.label}`}>
                      {c.label}
                      {arrow(c.key)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 2} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
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
                          className="h-4 w-4 accent-[#006F64]"
                          onChange={() => compare.toggle(cid, r.name)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setSelected(toItem(r))}
                          className="text-left font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline cursor-pointer leading-snug"
                        >
                          {r.name.replace(/ - (Direct|Regular) Plan - Growth$/i, "")}
                        </button>
                        {r.is_fh_recommended && (
                          <span className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded bg-[#006F64] text-white dark:bg-[#75E1CE] dark:text-[#10151C]">★ FH</span>
                        )}
                        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                          {r.amc ?? "-"} · {r.plan}
                        </div>
                      </td>
                      {cols.map((c) => (
                        <Cell key={c.key} col={c} row={r} />
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-[#E4E9EF] dark:border-[#2B3644] text-[11px] text-[#536176] dark:text-[#A8B4C4] flex flex-wrap items-center justify-between gap-2">
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
          <div className="flex items-center gap-1.5">
            <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={page <= 0 || loading} onClick={() => setOffset(offset - pageSize)}>
              Previous
            </button>
            <span>
              Page {page + 1} of {pageCount}
            </span>
            <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>
              Next
            </button>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
        FH checklist score = percentile rank inside the same category and plan across Performance (1Y/3Y/5Y returns), Operations (expense ratio and track record) and
        Risk vs Reward (Sharpe, Sortino, drawdown, volatility), scaled to 100. Portfolio quality needs holdings data and is not included. Past performance is not a guide to future returns.
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
      <MutualFundDrawer scheme={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Cell({ col, row }: { col: Col; row: MfScreenerRow }) {
  const v = row[col.key];
  if (col.kind === "score") {
    const max = col.key === "score" ? 100 : 25;
    const label = col.key === "perf" ? row.perf_label : col.key === "ops" ? row.ops_label : col.key === "risk" ? row.risk_label : null;
    const w = typeof v === "number" ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
    return (
      <td className="text-right whitespace-nowrap">
        {label && <span className="mr-2 text-[10px] uppercase text-[#536176] dark:text-[#A8B4C4]">{label}</span>}
        <span className="font-medium tabular-nums">{typeof v === "number" ? v : "-"}</span>
        <div className="mt-1 ml-auto h-1 w-20 rounded bg-[#E4E9EF] dark:bg-[#2B3644]" aria-hidden>
          <div className="h-1 rounded bg-[#006F64] dark:bg-[#75E1CE]" style={{ width: `${w}%` }} />
        </div>
      </td>
    );
  }
  const avg = col.avg ? row[col.avg] : undefined;
  return (
    <td className={`text-right tabular-nums ${col.kind === "pct" ? tone(v) : ""}`}>
      {fmt(v, col.digits)}
      {col.kind === "pct" && typeof v === "number" ? "%" : ""}
      {col.avg && (
        <div className="text-[10px] text-[#536176] dark:text-[#A8B4C4]">cat. {typeof avg === "number" ? `${fmt(avg)}%` : "-"}</div>
      )}
    </td>
  );
}
