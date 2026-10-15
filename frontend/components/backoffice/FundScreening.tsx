"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  getScreeningMetrics,
  runScreening,
  listScreeningPresets,
  saveScreeningPreset,
  deleteScreeningPreset,
  screeningExportUrl,
  ScreeningMetricsData,
  ScreeningRunData,
  ScreeningPresetItem,
  MfScreeningRow,
} from "@/lib/backoffice";
import ScreeningFunnel, { FunnelStageKey } from "./ScreeningFunnel";
import ScreeningFilters, { ScreeningFiltersState } from "./ScreeningFilters";
import ScreeningTable from "./ScreeningTable";
import ScreeningFundDrawer from "./ScreeningFundDrawer";

const DEFAULT_COLUMNS = [
  "sharpe",
  "sortino",
  "up_capture",
  "down_capture",
  "expense_ratio",
];

// Thresholds below are placeholders until metrics load; the real defaults come from screening.yaml via the API.
const DEFAULT_FILTERS: ScreeningFiltersState = {
  cat: "flexi_cap",
  min_tenure_years: 3,
  columns: DEFAULT_COLUMNS,
  bounds: {
    sharpe: { min: 1.0 },
    sortino: { min: 1.0 },
    up_capture: { min: 1.0 },
    down_capture: { max: 1.0 },
    expense_ratio: { max: null },
  },
  quartiles_action: [2, 3],
  include_retain: false,
  filter_ter_median: true,
  include_missing: true,
};

const STAGE_LABEL: Record<string, string> = {
  s1: "S1 Manager tenure",
  s2: "S2 Ratio bounds",
  s3: "S3 Capture & quartile",
  s4a: "S4a Risk (Sharpe/Sortino/tenure)",
  s4c: "S4c TER vs category median",
};

// One step looser for the stage that emptied the funnel.
function relaxStage(f: ScreeningFiltersState, stage: string): ScreeningFiltersState {
  const b = f.bounds;
  switch (stage) {
    case "s1":
      return f.include_missing ? { ...f, min_tenure_years: Math.max(0, f.min_tenure_years - 1) } : { ...f, include_missing: true };
    case "s2":
      return { ...f, bounds: { ...b, ...Object.fromEntries(Object.keys(b).filter((k) => !["up_capture", "down_capture", "sharpe", "sortino"].includes(k)).map((k) => [k, {}])) } };
    case "s3":
      return { ...f, bounds: { ...b, up_capture: { min: (b.up_capture?.min ?? 1) - 0.05 }, down_capture: { max: (b.down_capture?.max ?? 1) + 0.05 } } };
    case "s4a":
      return { ...f, bounds: { ...b, sharpe: { min: (b.sharpe?.min ?? 1) - 0.25 }, sortino: { min: (b.sortino?.min ?? 1) - 0.25 } } };
    default:
      return { ...f, filter_ter_median: false };
  }
}

export default function FundScreening() {
  const [metricsData, setMetricsData] = useState<ScreeningMetricsData | null>(null);
  const [runData, setRunData] = useState<ScreeningRunData | null>(null);
  const [presets, setPresets] = useState<ScreeningPresetItem[]>([]);
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ScreeningFiltersState>(DEFAULT_FILTERS);
  const [activeStage, setActiveStage] = useState<FunnelStageKey>("final");
  const [selectedSchemeCode, setSelectedSchemeCode] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [runningFunnel, setRunningFunnel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [availability, setAvailability] = useState<string>("ready");

  // Load metrics data and presets on mount
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setError(null);
        const [mRes, pRes] = await Promise.all([
          getScreeningMetrics(),
          listScreeningPresets(),
        ]);
        setMetricsData(mRes.data);
        if (mRes.data.defaults) setFilters((f) => ({ ...f, ...mRes.data.defaults }));
        setAvailability(mRes.availability || "ready");
        setPresets(pRes.data || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load screening engine");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Run the funnel; a newer run cancels the one in flight so a stale response never lands.
  async function handleApplyFunnel() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunningFunnel(true);
    setError(null);
    try {
      const res = await runScreening({ preset_id: currentPresetId, filters }, controller.signal);
      setRunData(res.data);
      setActiveStage("final");
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to execute screening funnel");
    } finally {
      if (abortRef.current === controller) setRunningFunnel(false);
    }
  }

  // Auto-apply 300ms after the last filter change (search box is client-side only, so it is left out).
  const applyKey = JSON.stringify({ ...filters, q_search: undefined });
  useEffect(() => {
    const t = setTimeout(handleApplyFunnel, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyKey]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Handle Preset Save
  async function handleSavePreset(name: string) {
    try {
      const res = await saveScreeningPreset(name, filters);
      setPresets([res.data, ...presets]);
      setCurrentPresetId(res.data.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save preset");
    }
  }

  // Handle Preset Select
  function handleSelectPreset(preset: ScreeningPresetItem) {
    setCurrentPresetId(preset.id);
    if (preset.filters) {
      const pb = (preset.filters.bounds ?? {}) as ScreeningFiltersState["bounds"];
      setFilters({
        ...DEFAULT_FILTERS,
        ...preset.filters,
        bounds: { ...DEFAULT_FILTERS.bounds, ...pb },
      });
    }
  }

  // Handle Preset Delete
  async function handleDeletePreset(id: string) {
    if (!confirm("Are you sure you want to delete this preset?")) return;
    try {
      await deleteScreeningPreset(id);
      setPresets(presets.filter((p) => p.id !== id));
      if (currentPresetId === id) setCurrentPresetId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete preset");
    }
  }

  // Filter rows based on active funnel stage and table filters
  const displayedRows = useMemo(() => {
    if (!runData) return [];

    let pool: MfScreeningRow[] = [];
    if (activeStage === "retain") {
      pool = runData.retain || [];
    } else if (activeStage === "final") {
      pool = runData.action || [];
    } else if (activeStage === "all") {
      pool = metricsData?.rows || [];
    } else {
      // Stage previews from action and retain set
      const combined = [...runData.action, ...runData.retain];
      pool = combined.filter((r) => r.stage_flags?.[activeStage as keyof typeof r.stage_flags]);
    }

    // Apply local query, category, AMC filters
    return pool.filter((r) => {
      if (filters.cat && r.cat !== filters.cat) return false;
      if (filters.amc && r.amc !== filters.amc) return false;
      if (filters.q_search) {
        const q = filters.q_search.toLowerCase();
        const matchName = r.scheme_name.toLowerCase().includes(q);
        const matchCode = r.scheme_code.toLowerCase().includes(q);
        if (!matchName && !matchCode) return false;
      }
      return true;
    });
  }, [runData, metricsData, activeStage, filters.cat, filters.amc, filters.q_search]);

  return (
    <div className="space-y-4">
      {/* Availability warning banner if engine not ready */}
      {availability !== "ready" && (
        <div className="terminal-panel p-3 border border-[#C26200]/30 bg-[#C26200]/5 text-[#C26200] dark:text-[#EAA847] text-[12px] flex items-center justify-between">
          <div>
            Screening metrics table is currently <strong>{availability}</strong>. Nightly precomputed data will be served.
          </div>
          <span className="font-mono text-[10px] uppercase">{availability}</span>
        </div>
      )}

      {error && (
        <div className="terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px]">
          {error}
        </div>
      )}

      {/* Funnel Stepper Banner */}
      <ScreeningFunnel
        counts={runData?.counts || null}
        stageAsOf={metricsData?.stage_as_of}
        activeStage={activeStage}
        onSelectStage={setActiveStage}
      />

      {/* Empty result: say which stage emptied it and why */}
      {runData && !runningFunnel && runData.counts.final === 0 && runData.counts.zeroed_stage && (
        <div className="terminal-panel p-3 border border-[#C26200]/30 bg-[#C26200]/5 text-[12px] text-[#181818] dark:text-[#EDF2F7] flex flex-wrap items-center justify-between gap-2">
          <div>
            <strong>0 funds after {STAGE_LABEL[runData.counts.zeroed_stage]}.</strong>
            {(runData.counts.zeroed_reasons?.length ?? 0) > 0 && (
              <span> Dropped by: {runData.counts.zeroed_reasons!.map((x) => `${x.rule} (${x.count})`).join("; ")}.</span>
            )}
            {(() => {
              const m = Object.entries(runData.counts.missing_by_stage?.[runData.counts.zeroed_stage] ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
              return m.length > 0 ? (
                <span> Most missing: {m.map(([k, n]) => `${k.replace(/_/g, " ")} (${n})`).join(", ")}.</span>
              ) : null;
            })()}
          </div>
          <button
            type="button"
            className="terminal-btn text-[11px] py-1 px-2.5"
            onClick={() => setFilters(relaxStage(filters, runData.counts.zeroed_stage as string))}
          >
            Relax this filter
          </button>
        </div>
      )}

      {/* Interactive Filters & Presets Toolbar */}
      <ScreeningFilters
        ratios={metricsData?.ratios || []}
        categories={metricsData?.facets?.cats || []}
        amcs={metricsData?.facets?.amcs || []}
        filters={filters}
        presets={presets}
        currentPresetId={currentPresetId}
        loading={runningFunnel || loading}
        onChange={setFilters}
        onApply={handleApplyFunnel}
        onSavePreset={handleSavePreset}
        onSelectPreset={handleSelectPreset}
        onDeletePreset={handleDeletePreset}
      />

      {/* Table Action Header & Export Link */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
        <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
          Showing <strong>{displayedRows.length}</strong> schemes for stage{" "}
          <span className="font-mono text-[#0176D3] dark:text-[#1B96FF] uppercase font-semibold">
            {activeStage}
          </span>
          {runData?.as_of && (
            <span> • As of <span className="font-mono">{runData.as_of}</span></span>
          )}
        </div>

        {runData?.run_id && (
          <div className="flex items-center gap-2">
            <a
              href={screeningExportUrl(runData.run_id, false)}
              className="terminal-btn text-[11px] py-1 px-2.5 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Action CSV
            </a>
            <a
              href={screeningExportUrl(runData.run_id, true)}
              className="terminal-btn text-[11px] py-1 px-2 text-[#706E6B] dark:text-[#A8B4C4]"
              title="Includes Q1 Retain peers in the CSV export"
            >
              + with Retain
            </a>
          </div>
        )}
      </div>

      {/* Main Screening Table */}
      <ScreeningTable
        rows={displayedRows}
        ratios={metricsData?.ratios || []}
        selectedColumns={filters.columns}
        isRetainView={activeStage === "retain"}
        onSelectScheme={setSelectedSchemeCode}
      />

      {/* Strategy / Manager Inspection Drawer */}
      <ScreeningFundDrawer
        schemeCode={selectedSchemeCode}
        onClose={() => setSelectedSchemeCode(null)}
      />
    </div>
  );
}
