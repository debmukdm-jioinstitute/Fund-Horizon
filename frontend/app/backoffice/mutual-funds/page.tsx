"use client";

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { getMutualFundsTracker, MutualFundItem } from "@/lib/backoffice";
import { formatISTDate, formatNumber } from "@/lib/terminal-format";
import MutualFundDrawer from "@/components/backoffice/MutualFundDrawer";
import { blankDash, classifyPlanOption, isNavStale } from "@/lib/backoffice-display";
import InfoTip, { InfoTipMeta } from "@/components/InfoTip";
import CompareTray from "@/components/compare/CompareTray";
import CompareView from "@/components/compare/CompareView";
import { mfCompareId, useCompareSelection } from "@/lib/compare-selection";

const PAGE_SIZE = 50;

function schemeLabel(s: MutualFundItem): { plan?: string; option?: string } {
  return classifyPlanOption(s.scheme_name, s.plan, s.option);
}

function formatNav(nav?: number | string): string {
  if (nav === null || nav === undefined || nav === "") return "—";
  const n = Number(nav);
  if (!Number.isFinite(n)) return "—";
  return `₹${formatNumber(n, 4)}`;
}

export default function MutualFundsTrackerPage() {
  return (
    <Suspense fallback={null}>
      <MutualFundsTracker />
    </Suspense>
  );
}

function MutualFundsTracker() {
  const compare = useCompareSelection("mf");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [amc, setAmc] = useState("");
  const [category, setCategory] = useState("");
  const [plan, setPlan] = useState("");
  const [recommended, setRecommended] = useState(false);
  const [recommendedCount, setRecommendedCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [schemes, setSchemes] = useState<MutualFundItem[]>([]);
  const [total, setTotal] = useState(0);
  const [amcs, setAmcs] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [planCounts, setPlanCounts] = useState<Record<string, number>>({});
  const [asOf, setAsOf] = useState<string | undefined>();
  const [meta, setMeta] = useState<Record<string, InfoTipMeta> | undefined>();
  const [selectedScheme, setSelectedScheme] = useState<MutualFundItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "nav" | "nav_date" | "ter" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQuery, amc, category, plan, recommended]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function search() {
      try {
        setLoading(true);
        setError(null);
        const res = await getMutualFundsTracker({
          search: debouncedQuery || undefined,
          amc: amc || undefined,
          category: category || undefined,
          plan: plan || undefined,
          recommended,
          limit: PAGE_SIZE,
          offset,
          signal: controller.signal,
        });
        if (cancelled) return;
        setSchemes(res.data || []);
        setTotal(res.total ?? (res.data || []).length);
        setAmcs(res.facets.amcs);
        setCategories(res.facets.categories);
        setPlanCounts(res.facets.plan_counts || {});
        setAsOf(res.as_of);
        setMeta(res.meta);
        setRecommendedCount(res.recommended_count);
      } catch (err: unknown) {
        // Aborted requests are superseded by a newer page/filter change — not an error.
        if (controller.signal.aborted || cancelled) return;
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load mutual funds tracker");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    search();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [debouncedQuery, amc, category, plan, recommended, offset, retryTick]);

  const filtersActive = Boolean(query.trim() || amc || category || plan || recommended);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(total, offset + schemes.length);

  const sortedSchemes = useMemo(() => {
    if (!sortKey) return schemes;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...schemes].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * (a.scheme_name || "").localeCompare(b.scheme_name || "");
        case "nav":
          return dir * ((Number(a.latest_nav) || 0) - (Number(b.latest_nav) || 0));
        case "nav_date":
          return dir * String(a.nav_date || "").localeCompare(String(b.nav_date || ""));
        case "ter":
          return dir * ((Number(a.ter_pct) || 0) - (Number(b.ter_pct) || 0));
        default:
          return 0;
      }
    });
  }, [schemes, sortKey, sortDir]);

  function toggleSort(key: "name" | "nav" | "nav_date" | "ter") {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  function sortIndicator(key: "name" | "nav" | "nav_date" | "ter") {
    if (sortKey !== key) return <span className="opacity-30 ml-1">⇅</span>;
    return <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const planBreakdown = useMemo(() => {
    const direct = planCounts["Direct"] ?? 0;
    const regular = planCounts["Regular"] ?? 0;
    const unclassified = planCounts["Unclassified"] ?? 0;
    if (!direct && !regular && !unclassified) return null;
    return { direct, regular, unclassified };
  }, [planCounts]);

  const showingLabel = useMemo(() => {
    const noun = total === 1 ? "scheme" : "schemes";
    return `Showing ${from.toLocaleString("en-IN")}–${to.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} ${noun}`;
  }, [from, to, total]);

  return (
    <div className={`space-y-4 ${compare.selectedIds.length ? "pb-[88px]" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Mutual Fund Tracker & AMFI NAV Hub
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              AMFI NAVAll.txt Feed
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Normalized 8-column AMFI master scheme registry, direct vs regular plan distinctions, and NAV valuations
          </p>
        </div>

        <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={compare.selectedIds.length < 2}
          onClick={compare.openCompare}
          className="terminal-btn-accent text-[12px] py-1 px-3 disabled:opacity-40"
        >
          Compare{compare.selectedIds.length ? ` (${compare.selectedIds.length})` : ""}
        </button>
        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono text-right">
          {asOf && <div>NAV as of {formatISTDate(asOf)}</div>}
          <div>
            Feed:{" "}
            <a href="https://portal.amfiindia.com/spages/NAVAll.txt" target="_blank" rel="noreferrer" className="underline hover:text-[#172033] dark:hover:text-[#EDF2F7]">
              portal.amfiindia.com
            </a>
          </div>
        </div>
        </div>
      </div>

      <div className="terminal-panel p-2.5 flex flex-col gap-2.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by scheme code, fund name, AMC, or ISIN (e.g. 119551, HDFC, Parag Parikh)…"
            className="terminal-input w-full max-w-md text-[12px] py-1 px-2.5"
          />
          <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono shrink-0">
            {loading ? "Searching…" : showingLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={recommended}
            onClick={() => setRecommended((v) => !v)}
            className={recommended ? "terminal-btn-accent text-[12px] py-1 px-3" : "terminal-btn text-[12px] py-1 px-3"}
          >
            ★ FH Recommended{recommendedCount ? ` (${recommendedCount})` : ""}
          </button>
          <select value={amc} onChange={(e) => setAmc(e.target.value)} className="terminal-input text-[12px] py-1 px-2.5 max-w-xs">
            <option value="">All AMCs</option>
            {amcs.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="terminal-input text-[12px] py-1 px-2.5 max-w-sm">
            <option value="">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select value={plan} onChange={(e) => setPlan(e.target.value)} className="terminal-input text-[12px] py-1 px-2.5">
            <option value="">Direct & Regular</option>
            <option value="Direct">Direct</option>
            <option value="Regular">Regular</option>
          </select>
          {filtersActive && (
            <button
              type="button"
              className="terminal-btn text-[12px] py-1 px-3"
              onClick={() => {
                setQuery("");
                setAmc("");
                setCategory("");
                setPlan("");
                setRecommended(false);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            className="terminal-btn text-[12px] py-1 px-3"
            onClick={() => setRetryTick((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      )}

      {planBreakdown && (
        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
          Plan split: Direct {planBreakdown.direct.toLocaleString("en-IN")} · Regular{" "}
          {planBreakdown.regular.toLocaleString("en-IN")} · Unclassified{" "}
          {planBreakdown.unclassified.toLocaleString("en-IN")} · Total {total.toLocaleString("en-IN")}
        </div>
      )}

      <div className="terminal-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="terminal-table">
            <thead>
              <tr>
                <th className="w-[40px]" aria-label="Compare" />
                <th className="w-[10%]">Code</th>
                <th className="w-[32%]">
                  <button type="button" onClick={() => toggleSort("name")} className="hover:underline cursor-pointer" title="Sort by scheme name">
                    Scheme Name & Category{sortIndicator("name")}
                  </button>
                </th>
                <th className="w-[12%]">Plan / Option</th>
                <th className="w-[12%] text-right">
                  <div className="inline-flex items-center justify-end">
                    <button type="button" onClick={() => toggleSort("nav")} className="hover:underline cursor-pointer" title="Sort by NAV">
                      Latest NAV (₹){sortIndicator("nav")}
                    </button>
                    <InfoTip metric="nav" meta={meta?.nav ?? meta?._default} />
                  </div>
                </th>
                <th className="w-[12%]">
                  <button type="button" onClick={() => toggleSort("nav_date")} className="hover:underline cursor-pointer" title="Sort by NAV date">
                    NAV Date{sortIndicator("nav_date")}
                  </button>
                </th>
                <th className="w-[10%] text-right">
                  <div className="inline-flex items-center justify-end">
                    <button type="button" onClick={() => toggleSort("ter")} className="hover:underline cursor-pointer" title="Sort by TER">
                      TER (%){sortIndicator("ter")}
                    </button>
                    <InfoTip metric="ter" meta={meta?.ter ?? meta?._default} />
                  </div>
                </th>
                <th className="w-[12%]">ISIN</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                    Loading scheme universe from AMFI registry…
                  </td>
                </tr>
              ) : schemes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#536176] dark:text-[#A8B4C4]">
                    No schemes found matching the current search and filters.
                  </td>
                </tr>
              ) : (
                sortedSchemes.map((s) => {
                  const classified = schemeLabel(s);
                  const stale = isNavStale(s.nav_date);
                  const cid = mfCompareId(s);
                  const checked = compare.selectedIds.includes(cid);
                  const capped = !checked && compare.maxSelected;
                  return (
                    <tr key={s.scheme_code} className="cursor-pointer" onClick={() => setSelectedScheme(s)}>
                      <td className="w-[40px] text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={capped}
                          title={capped ? "Max 4 to compare" : undefined}
                          aria-label={`Compare ${s.scheme_name}`}
                          className="h-4 w-4 accent-[#006F64]"
                          onChange={() => compare.toggle(cid, s.scheme_name)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedScheme(s);
                          }}
                          className="font-mono text-[12px] text-[#006F64] dark:text-[#75E1CE] font-medium hover:underline cursor-pointer"
                          title={`Inspect scheme ${s.scheme_code}`}
                        >
                          {s.scheme_code}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedScheme(s);
                          }}
                          className="text-left font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline focus:outline-none transition group cursor-pointer block leading-snug"
                        >
                          <span className="group-hover:opacity-90">{s.scheme_name}</span>
                          {s.is_fh_recommended && (
                            <span className="ml-2 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#006F64] text-white dark:bg-[#75E1CE] dark:text-[#10151C] align-middle">★ FH</span>
                          )}
                        </button>
                        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
                          {s.amc_name || s.category || "—"}
                        </div>
                      </td>
                      <td>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
                          {classified.plan || "—"}
                          {classified.option ? ` · ${classified.option}` : ""}
                        </span>
                      </td>
                      <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7] font-mono">
                        {formatNav(s.latest_nav)}
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                        <span className="inline-flex items-center gap-1.5">
                          {formatISTDate(s.nav_date)}
                          {stale && (
                            <span className="text-[9px] font-mono uppercase px-1 py-0.2 rounded bg-[#B45309]/10 text-[#B45309] dark:text-[#FBBF24] border border-[#B45309]/20">
                              Stale
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                        {s.ter_pct ? `${Number(s.ter_pct).toFixed(2)}%` : "—"}
                      </td>
                      <td className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">
                        {blankDash(s.isin_growth || s.isin_div)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-[#E4E9EF] dark:border-[#2B3644] text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono flex items-center justify-between gap-2">
          <span>{showingLabel}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="terminal-btn text-[11px] py-0.5 px-2"
              disabled={page <= 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span>
              Page {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="terminal-btn text-[11px] py-0.5 px-2"
              disabled={offset + PAGE_SIZE >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

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

      <MutualFundDrawer
        scheme={selectedScheme}
        onClose={() => setSelectedScheme(null)}
      />
    </div>
  );
}
