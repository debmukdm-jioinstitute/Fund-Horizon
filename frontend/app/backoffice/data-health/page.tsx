"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getDataHealth,
  refreshSource,
  SourceHealthData,
  SourceItem,
} from "@/lib/backoffice";

function formatLastSuccess(dateStr?: string) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    const day = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
    return `${day}, ${time}`;
  } catch {
    return "—";
  }
}

function getAdapterIcon(source: SourceItem) {
  const id = (source.id || "").toLowerCase();
  const name = (source.name || "").toLowerCase();

  if (name.includes("nav") || id.includes("nav")) {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M4 19h4V9H4v10zm6 0h4V5h-4v14zm6 0h4v-7h-4v7z" />
      </svg>
    );
  }
  if (name.includes("expense") || name.includes("ter") || id.includes("ter")) {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 16H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V7h10v2z" />
      </svg>
    );
  }
  if (name.includes("volatility") || name.includes("cboe") || id.includes("cboe")) {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2 0v8.99L21.99 11C21.47 5.92 17.08 2 12 2zm0 11.01V22c5.08 0 9.47-3.92 9.99-9h-8.99z" />
      </svg>
    );
  }
  if (name.includes("fx") || name.includes("ecb") || id.includes("fx")) {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2v1h2c.55 0 1 .45 1 1v2c0 .55-.45 1-1 1h-1v1h-2v-1H9v-2h3v-1H9c-.55 0-1-.45-1-1V9c0-.55.45-1 1-1h1V7h2v1h1c.55 0 1 .45 1 1v1c0 .55-.45 1-1 1z" />
      </svg>
    );
  }
  if (name.includes("reserve") || name.includes("fred") || name.includes("economic")) {
    return (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2L1 7l11 5 11-5-11-5zM1 12l11 5 11-5-1.5-0.68L12 15.68 2.5 11.32 1 12zm0 5l11 5 11-5-1.5-0.68L12 20.68 2.5 16.32 1 17z" />
    </svg>
  );
}

function renderStatusPill(status: string) {
  switch (status) {
    case "ready":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#ECFDF3] text-[#027A48] border border-[#A6F4C5] dark:bg-[#0E3824] dark:text-[#6CE9A6] dark:border-[#1E5D3A]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#12B76A]" />
          Ready
        </span>
      );
    case "needs_key":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF] dark:bg-[#102A4C] dark:text-[#84CAFF] dark:border-[#1E4775]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2E90FA]" />
          Needs Key
        </span>
      );
    case "manual_only":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F8F9FA] text-[#475467] border border-[#E4E7EC] dark:bg-[#1E242F] dark:text-[#98A2B3] dark:border-[#344054]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#98A2B3]" />
          Manual Only
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F8F9FA] text-[#475467] border border-[#E4E7EC] dark:bg-[#1E242F] dark:text-[#98A2B3]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#98A2B3]" />
          {status.replace(/_/g, " ")}
        </span>
      );
  }
}

export default function DataHealthPage() {
  const [health, setHealth] = useState<SourceHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadHealth();
  }, []);

  async function loadHealth() {
    try {
      setLoading(true);
      const res = await getDataHealth();
      setHealth(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data health");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh(sourceId: string) {
    setRefreshingId(sourceId);
    try {
      await refreshSource(sourceId);
      await loadHealth();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshingId(null);
    }
  }

  const filteredSources = useMemo(() => {
    if (!health?.sources) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return health.sources;
    return health.sources.filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }, [health?.sources, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div className="flex items-center gap-2">
          <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">
            Data Health &amp; Upstream Source Registry
          </h1>
          <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] text-[#706E6B] dark:text-[#A8B4C4]">
            Diagnostics
          </span>
        </div>

        <button
          onClick={loadHealth}
          className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh Diagnostics
        </button>
      </div>

      {loading && !health ? (
        <div className="p-8 text-center text-[#706E6B] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Running upstream provider telemetry…
        </div>
      ) : error ? (
        <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
          <div className="font-medium mb-1">Failed to load data health diagnostics</div>
          <div>{error}</div>
        </div>
      ) : health ? (
        <div className="space-y-4">
          {/* Source Adapters Registry Card matching screenshot strictly */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#121824] shadow-sm overflow-hidden">
            {/* Card Header with Icon + Title & Search input */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2.5">
                <div className="text-[#1A73E8]">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L1 7l11 5 11-5-11-5zM1 12l11 5 11-5-1.5-0.68L12 15.68 2.5 11.32 1 12zm0 5l11 5 11-5-1.5-0.68L12 20.68 2.5 16.32 1 17z" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Source Adapters Registry
                </h2>
              </div>

              <div className="relative w-full sm:w-64">
                <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search adapters..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800/80 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-5">Adapter</th>
                    <th className="py-3 px-5">Status</th>
                    <th className="py-3 px-5">Frequency</th>
                    <th className="py-3 px-5">Last Success</th>
                    <th className="py-3 px-5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {filteredSources.map((s) => {
                    const formattedDate = formatLastSuccess(s.last_success_at);
                    return (
                      <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#1A73E8] dark:text-[#8AB8FF] flex items-center justify-center shrink-0">
                              {getAdapterIcon(s)}
                            </div>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {s.name}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-5">
                          {renderStatusPill(s.health_status)}
                        </td>
                        <td className="py-3.5 px-5 text-slate-600 dark:text-slate-400 font-medium">
                          {s.supported_frequency ? s.supported_frequency.charAt(0).toUpperCase() + s.supported_frequency.slice(1).toLowerCase() : "Daily"}
                        </td>
                        <td className="py-3.5 px-5 text-slate-600 dark:text-slate-400 font-medium">
                          {formattedDate !== "—" ? (
                            <span className="inline-flex items-center gap-1.5">
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formattedDate}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <button
                            type="button"
                            onClick={() => handleRefresh(s.id)}
                            disabled={refreshingId === s.id}
                            className="rounded-full px-3.5 py-1 text-xs font-medium text-[#1A73E8] bg-[#EFF8FF] hover:bg-[#D1E9FF] border border-[#B2DDFF] dark:bg-[#102A4C] dark:text-[#84CAFF] dark:border-[#1E4775] transition-colors disabled:opacity-50"
                          >
                            {refreshingId === s.id ? "Syncing…" : "Sync"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSources.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No adapters found matching &ldquo;{searchQuery}&rdquo;
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
