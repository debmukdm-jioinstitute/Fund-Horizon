"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PmsLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { useRecommended } from "@/lib/recommended";
import CompareTray from "@/components/compare/CompareTray";
import CompareView from "@/components/compare/CompareView";
import { pmsCompareId, useCompareSelection } from "@/lib/compare-selection";
import {
  getPmsStrategies,
  getPmsAccountTracker,
  PmsStrategyItem,
  PmsAccountTrackerData,
  evaluatePmsScreening,
  PMS_BENCHMARKS,
} from "@/lib/backoffice";
import { ApiError } from "@/lib/api";
import { formatCurrencyPaiseToINR, formatCrore, formatISTDate } from "@/lib/terminal-format";
import SignedValue from "@/components/terminal/SignedValue";
import PmsStrategyDrawer from "@/components/backoffice/PmsStrategyDrawer";
import PmsManagerDrawer from "@/components/backoffice/PmsManagerDrawer";
import PmsDocumentModal from "@/components/backoffice/PmsDocumentModal";
import PmsMatrixModal from "@/components/backoffice/PmsMatrixModal";
import PmsMethodologyModal from "@/components/backoffice/PmsMethodologyModal";
import InfoTip, { InfoTipMeta } from "@/components/InfoTip";
import {
  approachesMatch,
  isMissingNumber,
  normalizeApproach,
  normalizeProviderName,
  pmsReturnWarning,
  pmsCellReturnWarning,
} from "@/lib/backoffice-display";
import DropdownClose from "@/components/DropdownClose";

type SortKey = "aum" | "return_1m" | "return_1y" | "return_3y" | "name" | "score";
const PAGE_SIZE = 50;

function ReturnCell({
  value,
  warning,
}: {
  value?: number | null;
  warning?: string | null;
}) {
  if (isMissingNumber(value)) {
    return (
      <span className="text-[#706E6B] dark:text-[#A8B4C4] font-normal" title="No data">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <SignedValue value={value} unit="%" />
      {warning && (
        <span
          className="text-[11px] text-[#B45309] dark:text-[#FBBF24]"
          title={warning}
          aria-label={warning}
        >
          ⚠
        </span>
      )}
    </span>
  );
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  align = "left",
  onSort,
  metric,
  meta,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  align?: "left" | "right";
  onSort: (key: SortKey) => void;
  metric?: string;
  meta?: InfoTipMeta | null;
}) {
  const active = sortKey === column;
  return (
    <th className={align === "right" ? "text-right" : undefined} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <div className={`inline-flex items-center ${align === "right" ? "justify-end" : ""}`}>
        <button
          type="button"
          onClick={() => onSort(column)}
          className={`inline-flex items-center gap-1 uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]`}
        >
          <span>{label}</span>
          <span className="font-mono text-[10px]" aria-hidden>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
        {metric && <InfoTip metric={metric} meta={meta} />}
      </div>
    </th>
  );
}

export default function PmsTrackerPage() {
  return (
    <Suspense fallback={null}>
      <PmsTracker />
    </Suspense>
  );
}

function PmsTracker() {
  const urlQuery = useSearchParams().get("q") ?? "";
  const compare = useCompareSelection("pms");
  const rec = useRecommended();
  const [pmsRecDropdownOpen, setPmsRecDropdownOpen] = useState(false);
  const [newPmsId, setNewPmsId] = useState("");
  const [newPmsName, setNewPmsName] = useState("");
  const [tab, setTab] = useState<"strategies" | "accounts">("strategies");
  const [strategies, setStrategies] = useState<PmsStrategyItem[]>([]);
  const [asOf, setAsOf] = useState<string | undefined>();
  const [selectedStrategy, setSelectedStrategy] = useState<PmsStrategyItem | null>(null);
  const [selectedManager, setSelectedManager] = useState<string | null>(null);
  const [managerProvider, setManagerProvider] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [accountTracker, setAccountTracker] = useState<PmsAccountTrackerData | null>(null);
  const [strategiesLoading, setStrategiesLoading] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountHint, setAccountHint] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, InfoTipMeta> | undefined>();

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [fhSubTab, setFhSubTab] = useState<"returns" | "details">("returns");
  const [search, setSearch] = useState(urlQuery);
  const [sortKey, setSortKey] = useState<SortKey>("aum");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [matrixModalOpen, setMatrixModalOpen] = useState(false);
  const [selectedBenchmark, setSelectedBenchmark] = useState("BSE 500 TRI");
  const [methodologyModalOpen, setMethodologyModalOpen] = useState(false);
  const [methodologyStrategy, setMethodologyStrategy] = useState<PmsStrategyItem | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setStrategiesLoading(true);
        const res = await getPmsStrategies();
        setStrategies(res.data || []);
        setAsOf(res.as_of);
        setMeta(res.meta);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load PMS data");
      } finally {
        setStrategiesLoading(false);
      }
    }
    load();
  }, []);

  async function handleLoadAccount(accId: string) {
    if (!accId.trim()) return;
    try {
      setAccountLoading(true);
      setError(null);
      setAccountHint(null);
      const res = await getPmsAccountTracker(accId.trim());
      setAccountTracker(res.data);
    } catch (err: unknown) {
      setAccountTracker(null);
      if (err instanceof ApiError && err.status === 404) {
        setAccountHint(
          "No PMS account was found for that id. Check the spelling, or confirm the account exists in the client ledger."
        );
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load account tracker");
      }
    } finally {
      setAccountLoading(false);
    }
  }

  const isRecommended = categoryFilter === "fh-recommended";
  const isStrategyRecommended = useCallback((s: PmsStrategyItem) => Boolean(s.ia_id && rec.isPmsRecommended(s.ia_id)) || Boolean(s.is_fh_recommended), [rec]);
  const fhRecCount = strategies.filter(isStrategyRecommended).length;

  const approachOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of strategies) {
      const label = normalizeApproach(s.investment_approach || s.strategy_type);
      if (label) set.add(label);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [strategies]);

  const filtersActive = Boolean(search.trim()) || categoryFilter !== "all" || sortKey !== "aum" || sortDir !== "desc";

  const evaluatedStrategies = useMemo(() => {
    return strategies.map((s) => {
      const evalRes = evaluatePmsScreening(s, selectedBenchmark);
      return {
        ...s,
        benchmark_name: selectedBenchmark,
        fh_score: evalRes.score,
        fh_rating: evalRes.rating,
        fh_signal: evalRes.signal,
        fh_signal_reasons: evalRes.reasons,
      };
    });
  }, [strategies, selectedBenchmark]);

  const filteredStrategies = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = evaluatedStrategies.filter((s) => {
      if (isRecommended) {
        if (!isStrategyRecommended(s)) return false;
      } else if (categoryFilter !== "all") {
        if (!approachesMatch(s.investment_approach || s.strategy_type, categoryFilter)) return false;
      }
      if (!q) return true;
      const provider = normalizeProviderName(s.provider_name).toLowerCase();
      return (
        (s.strategy_name || "").toLowerCase().includes(q) ||
        (s.provider_name || "").toLowerCase().includes(q) ||
        provider.includes(q) ||
        (s.principal_officer || "").toLowerCase().includes(q)
      );
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const numVal = (s: PmsStrategyItem) => {
      if (sortKey === "aum") return s.aum_crore;
      if (sortKey === "return_1m") return s.return_1m_pct;
      if (sortKey === "return_1y") return s.return_1y_pct;
      if (sortKey === "return_3y") return s.return_3y_cagr_pct;
      if (sortKey === "score") return s.fh_score;
      return undefined;
    };
    rows.sort((a, b) => {
      if (sortKey === "name") {
        return dir * (a.strategy_name || "").localeCompare(b.strategy_name || "");
      }
      const av = numVal(a);
      const bv = numVal(b);
      const aMissing = isMissingNumber(av);
      const bMissing = isMissingNumber(bv);
      if (aMissing && bMissing) return (a.strategy_name || "").localeCompare(b.strategy_name || "");
      if (aMissing) return 1;
      if (bMissing) return -1;
      return dir * ((av as number) - (bv as number));
    });
    return rows;
  }, [evaluatedStrategies, isRecommended, categoryFilter, search, sortKey, sortDir, isStrategyRecommended]);

  useEffect(() => {
    setPage(0);
  }, [categoryFilter, search, sortKey, sortDir, isRecommended, selectedBenchmark]);

  const pageCount = Math.max(1, Math.ceil(filteredStrategies.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filteredStrategies.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const from = filteredStrategies.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const to = Math.min(filteredStrategies.length, (safePage + 1) * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setSortKey("aum");
    setSortDir("desc");
    setPage(0);
  }

  const colSpan = 12;
  const trayVisible = tab === "strategies" && compare.selectedIds.length > 0;

  return (
    <div className={`space-y-4 ${trayVisible ? "pb-[88px]" : ""}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">
              PMS Performance & Account Tracker
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] text-[#706E6B] dark:text-[#A8B4C4]">
              APMI Standard
            </span>
          </div>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
            Portfolio Management Services strategy registry, XIRR returns, and high-water mark fee auditing
          </p>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {tab === "strategies" && (
            <button
              type="button"
              disabled={compare.selectedIds.length < 2}
              onClick={compare.openCompare}
              className="terminal-btn-accent text-[12px] py-1 px-3 disabled:opacity-40"
            >
              Compare{compare.selectedIds.length ? ` (${compare.selectedIds.length})` : ""}
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab("strategies")}
            className={tab === "strategies" ? "terminal-btn-accent text-[12px] py-1 px-3" : "terminal-btn text-[12px] py-1 px-3"}
          >
            Strategy Research ({strategies.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("accounts")}
            className={tab === "accounts" ? "terminal-btn-accent text-[12px] py-1 px-3" : "terminal-btn text-[12px] py-1 px-3"}
          >
            Client Accounts
          </button>
        </div>
      </div>

      {tab === "strategies" ? (
        <div className="space-y-3">
          <div className="terminal-panel p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PMS provider, strategy or manager…"
                className="terminal-input w-full max-w-xs text-[12px] py-1 px-2.5"
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="terminal-input text-[12px] py-1 px-2.5 font-medium"
              >
                <option value="all">All Approaches</option>
                <option value="fh-recommended">★ FH Recommended ({fhRecCount})</option>
                {approachOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === "fh-recommended" ? "all" : "fh-recommended")}
                className={`text-[12px] py-1 px-3 flex items-center gap-1.5 font-medium transition cursor-pointer ${
                  categoryFilter === "fh-recommended" ? "terminal-btn-accent" : "terminal-btn text-[#0176D3] dark:text-[#1B96FF]"
                }`}
              >
                <span className="text-[12px]">★</span>
                <span>FH Recommended ({fhRecCount})</span>
              </button>

              <div className="flex items-center gap-1.5 bg-[#F0F3F6] dark:bg-[#1A2332] px-2.5 py-1 rounded-lg border border-[#E5E5E5] dark:border-[#2B3644]">
                <span className="text-[11px] font-bold text-[#706E6B] dark:text-[#A8B4C4]">Benchmark:</span>
                <select
                  value={selectedBenchmark}
                  onChange={(e) => setSelectedBenchmark(e.target.value)}
                  className="bg-transparent text-[11.5px] font-bold text-[#0176D3] dark:text-[#1B96FF] focus:outline-none cursor-pointer"
                  title="Change comparison benchmark for real-time dynamic score recalculation"
                >
                  {Object.keys(PMS_BENCHMARKS).map((b) => (
                    <option key={b} value={b} className="bg-white dark:bg-[#10151C] text-[#181818] dark:text-[#EDF2F7]">
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMethodologyStrategy(null);
                  setMethodologyModalOpen(true);
                }}
                className="terminal-btn text-[12px] py-1 px-3 flex items-center gap-1.5 font-medium cursor-pointer"
                title="Inspect step-by-step mathematical calculations and methodology formulas"
              >
                <span>📐 Methodology &amp; Live Formulas</span>
              </button>

              <button
                type="button"
                onClick={() => setMatrixModalOpen(true)}
                className="terminal-btn text-[12px] py-1 px-3 flex items-center gap-1.5 font-medium cursor-pointer"
                title="View data availability & screening matrix for the 9 curated PMS strategies"
              >
                <span>📊 9 Strategies Matrix</span>
              </button>

              <button
                type="button"
                onClick={() => setDocModalOpen(true)}
                className="rounded-lg bg-[#0176D3] text-white px-3 py-1 text-[12px] font-semibold hover:opacity-90 flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Upload client portfolio report, factsheet or WealthSpectrum PDF"
              >
                <span>Upload PMS Document</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={pmsRecDropdownOpen}
                  onClick={() => setPmsRecDropdownOpen((v) => !v)}
                  className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5 cursor-pointer"
                  title="Settings & manage FH Recommended PMS strategies"
                >
                  <span>⚙ Settings</span>
                  <span className="text-[10px] font-mono">▾</span>
                </button>
                {pmsRecDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setPmsRecDropdownOpen(false)} />
                    <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-80 sm:w-96 rounded-xl bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] p-3.5 shadow-2xl z-50 space-y-3 text-left">
                      <DropdownClose onClose={() => setPmsRecDropdownOpen(false)} />
                      <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] pb-2">
                        <span className="text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
                          ★ FH Recommended PMS Strategies ({Object.keys(rec.pmsMap).length})
                        </span>
                        <button type="button" onClick={() => setPmsRecDropdownOpen(false)} className="text-[#706E6B] dark:text-[#A8B4C4] text-xs">
                          ✕
                        </button>
                      </div>
                      <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                        Add APMI Strategy ID to mark as recommended, or click Remove.
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="APMI ID (e.g. 174)"
                          value={newPmsId}
                          onChange={(e) => setNewPmsId(e.target.value)}
                          className="terminal-input text-[11px] py-1 px-2 font-mono w-28 shrink-0"
                        />
                        <input
                          type="text"
                          placeholder="Strategy name (optional)"
                          value={newPmsName}
                          onChange={(e) => setNewPmsName(e.target.value)}
                          className="terminal-input text-[11px] py-1 px-2 flex-1"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            if (!newPmsId.trim()) return;
                            await rec.addPms(newPmsId.trim(), newPmsName.trim() || undefined);
                            setNewPmsId("");
                            setNewPmsName("");
                          }}
                          className="terminal-btn-accent text-[11px] py-1 px-3 shrink-0"
                        >
                          + Add
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1 divide-y divide-[#E5E5E5]/40 dark:divide-[#2B3644]/40">
                        {Object.entries(rec.pmsMap).map(([id, name]) => (
                          <div key={id} className="pt-1.5 flex items-center justify-between gap-2 text-[11px]">
                            <div className="truncate">
                              <span className="font-mono text-[#0176D3] dark:text-[#1B96FF] font-medium mr-1.5">#{id}</span>
                              <span className="text-[#181818] dark:text-[#EDF2F7] truncate">{name}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => rec.removePms(id)}
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

              {filtersActive && (
                <button type="button" onClick={clearFilters} className="terminal-btn text-[12px] py-1 px-3">
                  Clear filters
                </button>
              )}
            </div>
            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-mono shrink-0 text-right">
              {asOf ? <div>As of {formatISTDate(asOf)}</div> : <div>As-of date not in this APMI snapshot</div>}
              <div>
                Source:{" "}
                <a href="https://www.apmiindia.org" target="_blank" rel="noreferrer" className="underline hover:text-[#181818] dark:hover:text-[#EDF2F7]">
                  APMI Disclosures
                </a>
              </div>
            </div>
          </div>

          {isRecommended && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-1 bg-[#F0F3F6] dark:bg-[#202936] p-0.5 rounded border border-[#E5E5E5] dark:border-[#2B3644]">
                <button
                  type="button"
                  onClick={() => setFhSubTab("returns")}
                  className={`text-[11px] font-medium py-1 px-2.5 rounded transition cursor-pointer ${
                    fhSubTab === "returns"
                      ? "bg-white dark:bg-[#10151C] text-[#181818] dark:text-[#EDF2F7] shadow-sm"
                      : "text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
                  }`}
                >
                  Returns Comparison vs Benchmark
                </button>
                <button
                  type="button"
                  onClick={() => setFhSubTab("details")}
                  className={`text-[11px] font-medium py-1 px-2.5 rounded transition cursor-pointer ${
                    fhSubTab === "details"
                      ? "bg-white dark:bg-[#10151C] text-[#181818] dark:text-[#EDF2F7] shadow-sm"
                      : "text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
                  }`}
                >
                  Fund Details &amp; Structure
                </button>
              </div>
              <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-mono">
                Click any fund to inspect complete factsheet &amp; history
              </span>
            </div>
          )}

          <div className="terminal-panel overflow-hidden">
            <div className="px-3 py-2 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-mono flex flex-wrap items-center justify-between gap-2">
              <span>
                {filteredStrategies.length === 0
                  ? "No strategies match the current filters"
                  : `Showing ${from}–${to} of ${filteredStrategies.length.toLocaleString("en-IN")}`}
                {filteredStrategies.length !== strategies.length ? ` matching · ${strategies.length.toLocaleString("en-IN")} total` : filteredStrategies.length === 0 ? "" : " strategies"}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="terminal-btn text-[11px] py-0.5 px-2"
                  disabled={safePage <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <span>
                  Page {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  className="terminal-btn text-[11px] py-0.5 px-2"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-270px)] min-h-[420px]">
              <table className="terminal-table">
                <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
                  {isRecommended ? (
                    fhSubTab === "returns" ? (
                      <tr>
                        <th className="w-[40px]" aria-label="Compare" />
                        <th className="w-[5%] text-center">SR</th>
                        <SortHeader label="PMS" column="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label="1M" column="return_1m" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="ret_1m" meta={meta?.ret_1m ?? meta?._default} />
                        <th className="text-right">
                          <div className="inline-flex items-center justify-end">
                            <span>3M</span>
                            <InfoTip metric="ret_3m" meta={meta?.ret_3m ?? meta?._default} />
                          </div>
                        </th>
                        <th className="text-right">
                          <div className="inline-flex items-center justify-end">
                            <span>6M</span>
                            <InfoTip metric="ret_6m" meta={meta?.ret_6m ?? meta?._default} />
                          </div>
                        </th>
                        <SortHeader label="1Y" column="return_1y" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="ret_1y" meta={meta?.ret_1y ?? meta?._default} />
                        <SortHeader label="3Y" column="return_3y" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="cagr_3y" meta={meta?.cagr_3y ?? meta?._default} />
                        <th className="text-right">
                          <div className="inline-flex items-center justify-end">
                            <span>Since Inception</span>
                            <InfoTip metric="ret_si" meta={meta?.ret_si ?? meta?._default} />
                          </div>
                        </th>
                        <SortHeader label="FH Score" column="score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                        <th className="text-center cursor-pointer hover:underline" onClick={() => { setMethodologyStrategy(null); setMethodologyModalOpen(true); }} title="Click to view methodology">FH Rating</th>
                        <th>FH Signal</th>
                        <th>Benchmark</th>
                      </tr>
                    ) : (
                      <tr>
                        <th className="w-[40px]" aria-label="Compare" />
                        <th className="w-[5%] text-center">SR</th>
                        <SortHeader label="PMS" column="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th>Type</th>
                        <SortHeader label="AUM" column="aum" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="aum" meta={meta?.aum ?? meta?._default} />
                        <th className="text-right">Min Investment</th>
                        <th>Inception</th>
                        <th>Principal Officer</th>
                        <SortHeader label="FH Score" column="score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                        <th className="text-center cursor-pointer hover:underline" onClick={() => { setMethodologyStrategy(null); setMethodologyModalOpen(true); }} title="Click to view methodology">FH Rating</th>
                        <th>FH Signal</th>
                        <th>Benchmark</th>
                      </tr>
                    )
                  ) : (
                    <tr>
                      <th className="w-[40px]" aria-label="Compare" />
                      <SortHeader label="Provider / Strategy" column="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                      <th>Approach</th>
                      <SortHeader label="AUM (₹ Cr)" column="aum" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="aum" meta={meta?.aum ?? meta?._default} />
                      <SortHeader label="1M Return" column="return_1m" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="ret_1m" meta={meta?.ret_1m ?? meta?._default} />
                      <SortHeader label="1Y Return" column="return_1y" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="ret_1y" meta={meta?.ret_1y ?? meta?._default} />
                      <SortHeader label="3Y CAGR" column="return_3y" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" metric="cagr_3y" meta={meta?.cagr_3y ?? meta?._default} />
                      <SortHeader label="FH Score" column="score" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
                      <th className="text-center cursor-pointer hover:underline" onClick={() => { setMethodologyStrategy(null); setMethodologyModalOpen(true); }} title="Click to view methodology">FH Rating</th>
                      <th>FH Signal</th>
                      <th>Benchmark</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {strategiesLoading ? (
                    <tr>
                      <td colSpan={colSpan} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                        Loading PMS strategies…
                      </td>
                    </tr>
                  ) : filteredStrategies.length === 0 ? (
                    <tr>
                      <td colSpan={colSpan} className="py-8 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                        No PMS strategies found matching query.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {pageRows.map((s, idx) => {
                        const warning = pmsReturnWarning(s);
                        const approach = normalizeApproach(s.investment_approach || s.strategy_type) || "—";
                        const rowKey = `${s.ia_id || s.strategy_name}-${s.provider_name}-${s.service_type || ""}-${idx}`;
                        const cid = pmsCompareId(s);
                        const checked = compare.selectedIds.includes(cid);
                        const capped = !checked && compare.maxSelected;
                        return (
                          <tr
                            key={rowKey}
                            className="cursor-pointer"
                            onClick={() => setSelectedStrategy(s)}
                          >
                            <td className="w-[40px] text-center align-middle" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={capped}
                                title={capped ? "Max 4 to compare" : undefined}
                                aria-label={`Compare ${s.strategy_name}`}
                                className="h-4 w-4 accent-[#0176D3]"
                                onChange={() => compare.toggle(cid, s.strategy_name)}
                              />
                            </td>
                            {isRecommended && (
                              <td className="text-center font-mono text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                                {safePage * PAGE_SIZE + idx + 1}
                              </td>
                            )}

                            <td>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedStrategy(s);
                                }}
                                className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline focus:outline-none transition group cursor-pointer block leading-snug"
                              >
                                <span className="group-hover:opacity-90">{s.strategy_name}</span>
                              </button>
                              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1.5">
                                  <PmsLogo firm={s.provider_name} className="h-5 min-w-5 max-w-[4rem] text-[8px]" />
                                  {normalizeProviderName(s.provider_name) || s.provider_name}
                                </span>
                                {isStrategyRecommended(s) && !isRecommended && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (s.ia_id) rec.togglePms(s.ia_id, s.strategy_name);
                                    }}
                                    title="Click to toggle FH Recommended status"
                                    className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] font-medium hover:opacity-80 cursor-pointer"
                                  >
                                    ★ FH Rec
                                  </button>
                                )}
                                {warning && (
                                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#B45309]/10 text-[#B45309] dark:text-[#FBBF24] border border-[#B45309]/20" title={warning}>
                                    Outlier
                                  </span>
                                )}
                              </div>
                            </td>

                            {isRecommended ? (
                              fhSubTab === "returns" ? (
                                <>
                                  <td className="text-right">
                                    <ReturnCell value={s.return_1m_pct} warning={pmsCellReturnWarning("1m", s.return_1m_pct)} />
                                  </td>
                                  <td className="text-right">
                                    <ReturnCell value={s.return_3m_pct} warning={pmsCellReturnWarning("3m", s.return_3m_pct)} />
                                  </td>
                                  <td className="text-right">
                                    <ReturnCell value={s.return_6m_pct} warning={pmsCellReturnWarning("6m", s.return_6m_pct)} />
                                  </td>
                                  <td className="text-right">
                                    <ReturnCell value={s.return_1y_pct} warning={pmsCellReturnWarning("1y", s.return_1y_pct)} />
                                  </td>
                                  <td className="text-right">
                                    <ReturnCell value={s.return_3y_cagr_pct} warning={pmsCellReturnWarning("3y", s.return_3y_cagr_pct) ?? warning} />
                                  </td>
                                  <td className="text-right font-medium">
                                    <ReturnCell value={s.return_since_inception_pct} warning={pmsCellReturnWarning("si", s.return_since_inception_pct)} />
                                  </td>
                                  <td
                                    className="text-center font-bold tabular-nums cursor-pointer hover:bg-[#F2F4F7] dark:hover:bg-[#202936] transition"
                                    onClick={() => {
                                      setMethodologyStrategy(s);
                                      setMethodologyModalOpen(true);
                                    }}
                                    title="Click to view step-by-step formula and live calculations"
                                  >
                                    {s.fh_score != null ? (
                                      <span className="text-[#181818] dark:text-[#EDF2F7]">
                                        {s.fh_score} <span className="text-[10px] font-normal text-[#706E6B] dark:text-[#A8B4C4]">/ 100</span>
                                      </span>
                                    ) : (
                                      <span className="text-[#98A2B3]">—</span>
                                    )}
                                  </td>
                                  <td
                                    className="text-center font-bold text-[#D97706] text-[12px] cursor-pointer hover:bg-[#F2F4F7] dark:hover:bg-[#202936] transition"
                                    onClick={() => {
                                      setMethodologyStrategy(s);
                                      setMethodologyModalOpen(true);
                                    }}
                                    title="Click to view ranking methodology & formula breakdown"
                                  >
                                    {s.fh_rating != null ? `★ ${s.fh_rating}/5` : "—"}
                                  </td>
                                  <td className="whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMethodologyStrategy(s);
                                        setMethodologyModalOpen(true);
                                      }}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition hover:opacity-85 ${
                                        s.fh_signal === "Buy"
                                          ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                                          : s.fh_signal === "Hold"
                                          ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                                          : s.fh_signal === "Sell"
                                          ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                                          : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]"
                                      }`}
                                      title={s.fh_signal_reasons && s.fh_signal_reasons.length > 0 ? s.fh_signal_reasons.join(" • ") : undefined}
                                    >
                                      <span className="h-1 w-1 rounded-full bg-current" />
                                      {s.fh_signal || "Needs review"}
                                    </button>
                                  </td>
                                  <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">{selectedBenchmark}</td>
                                </>
                              ) : (
                                <>
                                  <td className="text-[#706E6B] dark:text-[#A8B4C4]">{approach}</td>
                                  <td className="text-right font-medium text-[#181818] dark:text-[#EDF2F7] font-mono">
                                    {formatCrore(s.aum_crore)}
                                  </td>
                                  <td className="text-right text-[#706E6B] dark:text-[#A8B4C4] font-mono">
                                    {s.min_investment || "₹50,00,000"}
                                  </td>
                                  <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                                    {s.inception_date || "—"}
                                  </td>
                                  <td className="text-[12px]">
                                    {s.principal_officer ? (
                                      <button
                                        type="button"
                                        onClick={() => { setManagerProvider(s.provider_name); setSelectedManager(s.principal_officer as string); }}
                                        className="text-left font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline focus:outline-none transition cursor-pointer"
                                        title="Open manager profile"
                                      >
                                        {s.principal_officer}
                                      </button>
                                    ) : (
                                      <span className="text-[#181818] dark:text-[#EDF2F7]">—</span>
                                    )}
                                  </td>
                                  <td
                                    className="text-center font-bold tabular-nums cursor-pointer hover:bg-[#F2F4F7] dark:hover:bg-[#202936] transition"
                                    onClick={() => {
                                      setMethodologyStrategy(s);
                                      setMethodologyModalOpen(true);
                                    }}
                                    title="Click to view step-by-step formula and live calculations"
                                  >
                                    {s.fh_score != null ? (
                                      <span className="text-[#181818] dark:text-[#EDF2F7]">
                                        {s.fh_score} <span className="text-[10px] font-normal text-[#706E6B] dark:text-[#A8B4C4]">/ 100</span>
                                      </span>
                                    ) : (
                                      <span className="text-[#98A2B3]">—</span>
                                    )}
                                  </td>
                                  <td
                                    className="text-center font-bold text-[#D97706] text-[12px] cursor-pointer hover:bg-[#F2F4F7] dark:hover:bg-[#202936] transition"
                                    onClick={() => {
                                      setMethodologyStrategy(s);
                                      setMethodologyModalOpen(true);
                                    }}
                                    title="Click to view ranking methodology & formula breakdown"
                                  >
                                    {s.fh_rating != null ? `★ ${s.fh_rating}/5` : "—"}
                                  </td>
                                  <td className="whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMethodologyStrategy(s);
                                        setMethodologyModalOpen(true);
                                      }}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition hover:opacity-85 ${
                                        s.fh_signal === "Buy"
                                          ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                                          : s.fh_signal === "Hold"
                                          ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                                          : s.fh_signal === "Sell"
                                          ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                                          : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]"
                                      }`}
                                      title={s.fh_signal_reasons && s.fh_signal_reasons.length > 0 ? s.fh_signal_reasons.join(" • ") : undefined}
                                    >
                                      <span className="h-1 w-1 rounded-full bg-current" />
                                      {s.fh_signal || "Needs review"}
                                    </button>
                                  </td>
                                  <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">{selectedBenchmark}</td>
                                </>
                              )
                            ) : (
                              <>
                                <td className="text-[#706E6B] dark:text-[#A8B4C4]">{approach}</td>
                                <td className="text-right font-medium text-[#181818] dark:text-[#EDF2F7] font-mono">
                                  {formatCrore(s.aum_crore)}
                                </td>
                                <td className="text-right">
                                  <ReturnCell value={s.return_1m_pct} warning={pmsCellReturnWarning("1m", s.return_1m_pct)} />
                                </td>
                                <td className="text-right">
                                  <ReturnCell value={s.return_1y_pct} warning={pmsCellReturnWarning("1y", s.return_1y_pct)} />
                                </td>
                                <td className="text-right">
                                  <ReturnCell value={s.return_3y_cagr_pct} warning={pmsCellReturnWarning("3y", s.return_3y_cagr_pct) ?? warning} />
                                </td>
                                <td
                                  className="text-center font-bold tabular-nums cursor-pointer hover:bg-[#F2F4F7] dark:hover:bg-[#202936] transition"
                                  onClick={() => {
                                    setMethodologyStrategy(s);
                                    setMethodologyModalOpen(true);
                                  }}
                                  title="Click to view step-by-step formula and live calculations"
                                >
                                  {s.fh_score != null ? (
                                    <span className="text-[#181818] dark:text-[#EDF2F7]">
                                      {s.fh_score} <span className="text-[10px] font-normal text-[#706E6B] dark:text-[#A8B4C4]">/ 100</span>
                                    </span>
                                  ) : (
                                    <span className="text-[#98A2B3]">—</span>
                                  )}
                                </td>
                                <td
                                  className="text-center font-bold text-[#D97706] text-[12px] cursor-pointer hover:bg-[#F2F4F7] dark:hover:bg-[#202936] transition"
                                  onClick={() => {
                                    setMethodologyStrategy(s);
                                    setMethodologyModalOpen(true);
                                  }}
                                  title="Click to view ranking methodology & formula breakdown"
                                >
                                  {s.fh_rating != null ? `★ ${s.fh_rating}/5` : "—"}
                                </td>
                                <td className="whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMethodologyStrategy(s);
                                      setMethodologyModalOpen(true);
                                    }}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer transition hover:opacity-85 ${
                                      s.fh_signal === "Buy"
                                        ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                                        : s.fh_signal === "Hold"
                                        ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                                        : s.fh_signal === "Sell"
                                        ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                                        : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]"
                                    }`}
                                    title={s.fh_signal_reasons && s.fh_signal_reasons.length > 0 ? s.fh_signal_reasons.join(" • ") : undefined}
                                  >
                                    <span className="h-1 w-1 rounded-full bg-current" />
                                    {s.fh_signal || "Needs review"}
                                  </button>
                                </td>
                                <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] font-medium">{selectedBenchmark}</td>
                              </>
                            )}
                          </tr>
                        );
                      })}

                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="terminal-panel p-2.5 space-y-2">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                placeholder="e.g. acc_pms_01"
                className="terminal-input flex-1 text-[12px] py-1 px-2.5 font-mono"
                aria-describedby="pms-account-id-hint"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLoadAccount(selectedAccountId);
                }}
              />
              <button
                type="button"
                onClick={() => handleLoadAccount(selectedAccountId)}
                disabled={accountLoading || !selectedAccountId.trim()}
                className="terminal-btn-accent text-[12px] py-1 px-3"
              >
                {accountLoading ? "Loading…" : "Track Account"}
              </button>
            </div>
            <p id="pms-account-id-hint" className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
              Use the internal account id from the client ledger (for example <span className="font-mono">acc_pms_01</span>). Matching is exact and case-sensitive.
            </p>
          </div>

          {error && (
            <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px]">
              {error}
            </div>
          )}

          {accountHint && (
            <div className="terminal-panel p-3 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
              {accountHint}
            </div>
          )}

          {accountTracker && (
            <div className="space-y-3">
              <div className="terminal-panel overflow-hidden">
                <table className="terminal-table">
                  <thead>
                    <tr>
                      <th>Account Metric</th>
                      <th className="text-right">Valuation / Return</th>
                      <th className="text-right">Benchmark / HWM</th>
                      <th>Methodology</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          Portfolio Current Valuation
                          <InfoTip metric="aum" />
                        </span>
                      </td>
                      <td className="text-right font-medium text-[#181818] dark:text-[#EDF2F7]">
                        {accountTracker.current_valuation_paise
                          ? formatCurrencyPaiseToINR(accountTracker.current_valuation_paise)
                          : "—"}
                      </td>
                      <td className="text-right text-[#706E6B] dark:text-[#A8B4C4]">
                        Fee: {accountTracker.hwm_fee?.estimated_fee_paise ? formatCurrencyPaiseToINR(accountTracker.hwm_fee.estimated_fee_paise) : "₹0"}
                      </td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Latest Closing Valuation</td>
                      <td className="text-[12px] text-[#087744] dark:text-[#58D6A0]">Audited</td>
                    </tr>
                    <tr>
                      <td className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          Annualized XIRR Return
                          <InfoTip metric="xirr" />
                        </span>
                      </td>
                      <td className="text-right">
                        <SignedValue value={accountTracker.xirr?.xirr_pct} unit="%" />
                      </td>
                      <td className="text-right text-[#706E6B] dark:text-[#A8B4C4]">
                        Status: {accountTracker.xirr?.status || "Computed"}
                      </td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">SEBI Cashflow IRR Standard</td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Audited</td>
                    </tr>
                    <tr>
                      <td className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          Modified Dietz Return (CY)
                          <InfoTip metric="dietz_return" />
                        </span>
                      </td>
                      <td className="text-right">
                        <SignedValue value={accountTracker.modified_dietz?.return_pct} unit="%" />
                      </td>
                      <td className="text-right text-[#706E6B] dark:text-[#A8B4C4]">—</td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Time-Weighted Cashflows</td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Daily-weighted</td>
                    </tr>
                    <tr>
                      <td className="font-medium">
                        <span className="inline-flex items-center gap-1">
                          High Water Mark (HWM) Status
                          <InfoTip metric="hwm" />
                        </span>
                      </td>
                      <td className="text-right font-medium text-[#181818] dark:text-[#EDF2F7]">
                        {accountTracker.hwm_fee?.hwm_exceeded ? "Above HWM (Fee Triggered)" : "Below HWM (No Performance Fee)"}
                      </td>
                      <td className="text-right text-[#706E6B] dark:text-[#A8B4C4]">
                        {accountTracker.hwm_fee?.estimated_fee_paise
                          ? `Est. Fee: ${formatCurrencyPaiseToINR(accountTracker.hwm_fee.estimated_fee_paise)}`
                          : "No Fee Due"}
                      </td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">SEBI Performance Fee Rule</td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Compliant</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {accountTracker.positions && accountTracker.positions.length > 0 && (
                <div className="terminal-panel overflow-hidden">
                  <div className="p-2 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
                    Portfolio Holdings & Weight Breakdown
                  </div>
                  <div className="overflow-x-auto">
                    <table className="terminal-table">
                      <thead>
                        <tr>
                          <th>Asset Name</th>
                          <th>Symbol / Class</th>
                          <th className="text-right">Quantity</th>
                          <th className="text-right">Market Value</th>
                          <th className="text-right">Valuation Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accountTracker.positions.map((pos, pIdx) => (
                          <tr key={pIdx}>
                            <td className="font-medium text-[#181818] dark:text-[#EDF2F7]">{pos.asset_name || pos.symbol || "Asset"}</td>
                            <td className="text-[11px] font-mono text-[#706E6B] dark:text-[#A8B4C4]">{pos.symbol || pos.asset_class || "—"}</td>
                            <td className="text-right font-mono">{pos.quantity !== undefined ? pos.quantity.toLocaleString("en-IN") : "—"}</td>
                            <td className="text-right font-medium font-mono">
                              {formatCurrencyPaiseToINR(pos.market_value_paise)}
                            </td>
                            <td className="text-right text-[12px] text-[#706E6B] dark:text-[#A8B4C4] font-mono">{pos.valuation_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "strategies" && (
        <>
          <CompareTray
            labels={compare.selectedIds.map((id) => ({ id, name: compare.resolveLabel(id) }))}
            onRemove={compare.remove}
            onClear={compare.clear}
            onCompare={compare.openCompare}
          />
          <CompareView
            open={compare.compareOpen}
            type="pms"
            ids={compare.selectedIds}
            onClose={compare.closeCompare}
            onRemoveId={compare.remove}
            resolveLabel={compare.resolveLabel}
          />
        </>
      )}

      <PmsStrategyDrawer
        strategy={selectedStrategy}
        onClose={() => setSelectedStrategy(null)}
        onSelectSibling={(iaId) => {
          const next = strategies.find((s) => s.ia_id === iaId);
          if (next) setSelectedStrategy(next);
        }}
        onSelectManager={(name, provider) => {
          setSelectedStrategy(null);
          setManagerProvider(provider);
          setSelectedManager(name);
        }}
      />

      <PmsManagerDrawer
        managerName={selectedManager}
        provider={managerProvider}
        strategies={strategies}
        onClose={() => setSelectedManager(null)}
        onSelectStrategy={(st) => {
          setSelectedManager(null);
          setSelectedStrategy(st);
        }}
      />

      {docModalOpen && (
        <PmsDocumentModal
          onClose={() => setDocModalOpen(false)}
          onUploaded={() => {}}
        />
      )}

      {matrixModalOpen && (
        <PmsMatrixModal
          onClose={() => setMatrixModalOpen(false)}
        />
      )}

      {methodologyModalOpen && (
        <PmsMethodologyModal
          strategy={methodologyStrategy}
          initialBenchmark={selectedBenchmark}
          onClose={() => {
            setMethodologyModalOpen(false);
            setMethodologyStrategy(null);
          }}
          onBenchmarkChange={(b) => setSelectedBenchmark(b)}
        />
      )}
    </div>
  );
}
