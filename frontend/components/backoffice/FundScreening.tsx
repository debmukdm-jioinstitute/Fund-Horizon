"use client";

import React, { useEffect, useState, useMemo } from "react";
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

const DEFAULT_FILTERS: ScreeningFiltersState = {
  min_tenure_years: 3,
  columns: DEFAULT_COLUMNS,
  bounds: {
    sharpe: { min: 1.0 },
    sortino: { min: 1.0 },
    up_capture: { min: 1.0000001 },
    down_capture: { max: 0.999999 },
    expense_ratio: { max: null },
  },
  quartiles_action: [2, 3],
  include_retain: false,
  filter_ter_median: true,
};

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
        setAvailability(mRes.availability || "ready");
        setPresets(pRes.data || []);

        // Initial run with default filters
        const runRes = await runScreening({ filters: DEFAULT_FILTERS });
        setRunData(runRes.data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load screening engine");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Handle Apply Funnel
  async function handleApplyFunnel() {
    setRunningFunnel(true);
    setError(null);
    try {
      const res = await runScreening({
        preset_id: currentPresetId,
        filters,
      });
      setRunData(res.data);
      setActiveStage("final");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to execute screening funnel");
    } finally {
      setRunningFunnel(false);
    }
  }

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
      setFilters({
        ...DEFAULT_FILTERS,
        ...preset.filters,
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
        activeStage={activeStage}
        onSelectStage={setActiveStage}
      />

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
        <div className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
          Showing <strong>{displayedRows.length}</strong> schemes for stage{" "}
          <span className="font-mono text-[#006F64] dark:text-[#75E1CE] uppercase font-semibold">
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
              className="terminal-btn text-[11px] py-1 px-2 text-[#536176] dark:text-[#A8B4C4]"
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
