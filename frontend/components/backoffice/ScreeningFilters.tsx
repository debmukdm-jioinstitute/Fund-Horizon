"use client";

import React, { useState } from "react";
import { MfScreeningRatioMeta, ScreeningPresetItem } from "@/lib/backoffice";

export interface ScreeningFiltersState {
  [key: string]: unknown;
  min_tenure_years: number;
  columns: string[];
  bounds: Record<string, { min?: number | null; max?: number | null }>;
  quartiles_action: number[];
  include_retain: boolean;
  filter_ter_median: boolean;
  include_missing: boolean;
  cat?: string;
  amc?: string;
  q_search?: string;
}

interface ScreeningFiltersProps {
  ratios: MfScreeningRatioMeta[];
  categories: string[];
  amcs: string[];
  filters: ScreeningFiltersState;
  presets: ScreeningPresetItem[];
  currentPresetId: string | null;
  loading: boolean;
  onChange: (updated: ScreeningFiltersState) => void;
  onApply: () => void;
  onSavePreset: (name: string) => void;
  onSelectPreset: (preset: ScreeningPresetItem) => void;
  onDeletePreset: (id: string) => void;
}

export default function ScreeningFilters({
  ratios,
  categories,
  amcs,
  filters,
  presets,
  currentPresetId,
  loading,
  onChange,
  onApply,
  onSavePreset,
  onSelectPreset,
  onDeletePreset,
}: ScreeningFiltersProps) {
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [showRatioSelector, setShowRatioSelector] = useState(false);

  function handleColumnToggle(colKey: string) {
    const exists = filters.columns.includes(colKey);
    const newCols = exists
      ? filters.columns.filter((c) => c !== colKey)
      : [...filters.columns, colKey];
    onChange({ ...filters, columns: newCols });
  }

  function handleBoundChange(key: string, boundType: "min" | "max", val: string) {
    const parsed = val.trim() === "" ? null : parseFloat(val);
    const existing = filters.bounds[key] || {};
    onChange({
      ...filters,
      bounds: {
        ...filters.bounds,
        [key]: { ...existing, [boundType]: parsed },
      },
    });
  }

  // Capture ratios are stored as ratios (1.0) but entered and shown as percent (100).
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? 100 : Math.round(v * 10000) / 100);
  function handleCaptureChange(key: string, boundType: "min" | "max", val: string) {
    handleBoundChange(key, boundType, val.trim() === "" ? "" : String(parseFloat(val) / 100));
  }
  const currentPreset = presets.find((p) => p.id === currentPresetId);

  return (
    <div className="terminal-panel p-3.5 space-y-3">
      {/* Top Bar: Search, Category, AMC, Preset controls & Apply */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Quick Search */}
          <input
            type="text"
            value={filters.q_search || ""}
            onChange={(e) => onChange({ ...filters, q_search: e.target.value })}
            placeholder="Search scheme name or code (e.g. HDFC, 119551)…"
            className="terminal-input w-full sm:w-60 text-[12px] py-1 px-2.5"
          />

          {/* Category Filter */}
          <select
            value={filters.cat || ""}
            onChange={(e) => onChange({ ...filters, cat: e.target.value || undefined })}
            className="terminal-input text-[12px] py-1 px-2.5 max-w-[160px]"
          >
            <option value="">All Categories ({categories.length})</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          {/* AMC Filter */}
          <select
            value={filters.amc || ""}
            onChange={(e) => onChange({ ...filters, amc: e.target.value || undefined })}
            className="terminal-input text-[12px] py-1 px-2.5 max-w-[160px]"
          >
            <option value="">All AMCs ({amcs.length})</option>
            {amcs.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {/* Presets Dropdown */}
          <select
            value={currentPresetId || ""}
            onChange={(e) => {
              const selected = presets.find((p) => p.id === e.target.value);
              if (selected) onSelectPreset(selected);
            }}
            className="terminal-input text-[12px] py-1 px-2.5 max-w-[160px]"
          >
            <option value="">Presets ({presets.length})</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {currentPreset && !currentPreset.builtin && (
            <button
              type="button"
              onClick={() => onDeletePreset(currentPreset.id)}
              title="Delete selected preset"
              className="text-[#B42332] dark:text-[#FF7D86] text-[11px] hover:underline"
            >
              Delete
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowPresetModal(true)}
            className="terminal-btn text-[11px] py-1 px-2"
          >
            Save Preset…
          </button>
        </div>

        {/* Action Button: Apply Funnel */}
        <div className="flex items-center gap-2 self-end md:self-auto">
          <button
            type="button"
            disabled={loading}
            onClick={onApply}
            className="terminal-btn text-[12px] py-1.5 px-4 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
          >
            {loading ? "Running Funnel…" : "Apply Funnel"}
          </button>
        </div>
      </div>

      {/* Funnel Stage Controls Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[12px]">
        {/* S1: Manager Tenure */}
        <div className="p-2.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">
              S1 Manager Tenure
            </span>
            <label className="flex items-center gap-1 text-[10px] text-[#172033] dark:text-[#EDF2F7]">
              <input
                type="checkbox"
                checked={filters.include_missing}
                onChange={(e) => onChange({ ...filters, include_missing: e.target.checked })}
                className="accent-[#006F64] dark:accent-[#75E1CE]"
              />
              Include funds with missing data
            </label>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
              Min tenure:
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={filters.min_tenure_years}
              onChange={(e) =>
                onChange({ ...filters, min_tenure_years: parseFloat(e.target.value) || 0 })
              }
              className="terminal-input w-20 py-0.5 px-2 text-[12px] tabular-nums"
            />
            <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">years</span>
          </div>
          <p className="text-[10px] text-[#536176] dark:text-[#A8B4C4] leading-tight">
            Unknown manager or start date → kept and flagged needs data when the toggle is on.
          </p>
        </div>

        {/* S2: Selected Columns & Bounds */}
        <div className="p-2.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">
              S2 Ratio Columns ({filters.columns.length})
            </span>
            <button
              type="button"
              onClick={() => setShowRatioSelector(!showRatioSelector)}
              className="text-[#006F64] dark:text-[#75E1CE] text-[11px] font-medium hover:underline"
            >
              {showRatioSelector ? "Close" : "Select Columns"}
            </button>
          </div>
          <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] truncate">
            {filters.columns.join(", ") || "None"}
          </div>
          <p className="text-[10px] text-[#536176] dark:text-[#A8B4C4] leading-tight">
            Columns without a min/max do not filter.
          </p>
        </div>

        {/* S3: 2Y Capture Ratios & Quartiles */}
        <div className="p-2.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">
              S3 Capture &amp; Quartile
            </span>
            <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4]">2Y Window</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div>
              <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4] block">Up capture &gt; (%)</span>
              <input
                type="number"
                step="5"
                placeholder="100"
                value={pct(filters.bounds.up_capture?.min)}
                onChange={(e) => handleCaptureChange("up_capture", "min", e.target.value)}
                className="terminal-input w-full py-0.5 px-1.5 text-[11px] tabular-nums"
              />
            </div>
            <div>
              <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4] block">Down capture &lt; (%)</span>
              <input
                type="number"
                step="5"
                placeholder="100"
                value={pct(filters.bounds.down_capture?.max)}
                onChange={(e) => handleCaptureChange("down_capture", "max", e.target.value)}
                className="terminal-input w-full py-0.5 px-1.5 text-[11px] tabular-nums"
              />
            </div>
          </div>
          <p className="text-[10px] text-[#536176] dark:text-[#A8B4C4] leading-tight">
            Q1 = Retain (excluded from action); Q2+Q3 = Review; Q4 = Dropped.
          </p>
        </div>

        {/* S4a & S4c: Risk Ratios & TER */}
        <div className="p-2.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">
              S4 Risk &amp; TER
            </span>
            <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4]">3Y Window</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div>
              <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4] block">Sharpe ≥ 1</span>
              <input
                type="number"
                step="0.1"
                placeholder="1.0"
                value={filters.bounds.sharpe?.min ?? 1.0}
                onChange={(e) => handleBoundChange("sharpe", "min", e.target.value)}
                className="terminal-input w-full py-0.5 px-1.5 text-[11px] tabular-nums"
              />
            </div>
            <div>
              <span className="text-[10px] text-[#536176] dark:text-[#A8B4C4] block">Sortino ≥ 1</span>
              <input
                type="number"
                step="0.1"
                placeholder="1.0"
                value={filters.bounds.sortino?.min ?? 1.0}
                onChange={(e) => handleBoundChange("sortino", "min", e.target.value)}
                className="terminal-input w-full py-0.5 px-1.5 text-[11px] tabular-nums"
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5 pt-0.5">
            <input
              type="checkbox"
              id="ter-median"
              checked={filters.filter_ter_median}
              onChange={(e) => onChange({ ...filters, filter_ter_median: e.target.checked })}
              className="accent-[#006F64] dark:accent-[#75E1CE]"
            />
            <label htmlFor="ter-median" className="text-[11px] text-[#172033] dark:text-[#EDF2F7]">
              TER ≤ Cat Median
            </label>
          </div>
        </div>
      </div>

      {/* S2 Ratio Selector Drawer/Dropdown */}
      {showRatioSelector && (
        <div className="p-3 bg-[#F7F9FB] dark:bg-[#171E27] border border-[#006F64]/40 dark:border-[#75E1CE]/40 rounded space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#E4E9EF] dark:border-[#2B3644]">
            <span className="text-[11px] font-semibold text-[#172033] dark:text-[#EDF2F7]">
              Select Ratio Columns &amp; Configure Optional Bounds
            </span>
            <button
              type="button"
              onClick={() => setShowRatioSelector(false)}
              className="text-[11px] text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7]"
            >
              Done
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {ratios.map((r) => {
              const selected = filters.columns.includes(r.key);
              const b = filters.bounds[r.key] || {};
              return (
                <div
                  key={r.key}
                  className={`p-2 rounded border text-[11px] ${
                    selected
                      ? "bg-white dark:bg-[#10151C] border-[#006F64] dark:border-[#75E1CE]"
                      : "bg-[#F7F9FB] dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <input
                      type="checkbox"
                      id={`chk-${r.key}`}
                      checked={selected}
                      onChange={() => handleColumnToggle(r.key)}
                      className="accent-[#006F64] dark:accent-[#75E1CE]"
                    />
                    <label
                      htmlFor={`chk-${r.key}`}
                      className="font-medium text-[#172033] dark:text-[#EDF2F7] cursor-pointer"
                    >
                      {r.label}
                    </label>
                  </div>
                  {selected && (
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      <input
                        type="number"
                        step="0.05"
                        placeholder="Min"
                        value={b.min ?? ""}
                        onChange={(e) => handleBoundChange(r.key, "min", e.target.value)}
                        className="terminal-input w-full py-0.5 px-1 text-[10px] tabular-nums"
                      />
                      <input
                        type="number"
                        step="0.05"
                        placeholder="Max"
                        value={b.max ?? ""}
                        onChange={(e) => handleBoundChange(r.key, "max", e.target.value)}
                        className="terminal-input w-full py-0.5 px-1 text-[10px] tabular-nums"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Preset Name Modal */}
      {showPresetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="terminal-panel max-w-sm w-full p-4 space-y-3 bg-white dark:bg-[#171E27]">
            <div className="text-[13px] font-semibold text-[#172033] dark:text-[#EDF2F7]">
              Save Screening Preset
            </div>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
              Give this filter and ratio configuration a name to recall later.
            </p>
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="e.g. Strict Alpha & Low Vol"
              className="terminal-input w-full text-[12px] py-1 px-2.5"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPresetModal(false)}
                className="terminal-btn text-[12px] py-1 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newPresetName.trim()) {
                    onSavePreset(newPresetName.trim());
                    setShowPresetModal(false);
                    setNewPresetName("");
                  }
                }}
                disabled={!newPresetName.trim()}
                className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
