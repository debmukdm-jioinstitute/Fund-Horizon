"use client";

import React, { useEffect, useState } from "react";
import {
  getDataHealth,
  refreshSource,
  previewImport,
  commitImport,
  importTemplateUrl,
  SourceHealthData,
  ImportJobData,
} from "@/lib/backoffice";
import { formatISTDateTime } from "@/lib/terminal-format";
import InfoTip from "@/components/InfoTip";

export default function DataHealthPage() {
  const [health, setHealth] = useState<SourceHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Import state
  const [importType, setImportType] = useState("pms_strategies");
  const [fileContent, setFileContent] = useState("");
  const [fileName, setFileName] = useState("upload.csv");
  const [previewJob, setPreviewJob] = useState<ImportJobData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);

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

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setFileContent(text);
  }

  async function handlePreview() {
    if (!fileContent.trim()) return;
    setPreviewing(true);
    setCommitMessage(null);
    try {
      const job = await previewImport({
        import_type: importType,
        file_content: fileContent,
        file_name: fileName,
      });
      setPreviewJob(job);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!previewJob) return;
    setCommitting(true);
    try {
      const res = await commitImport(previewJob);
      setCommitMessage(`Successfully committed ${res.committed_rows} rows inside an atomic transaction.`);
      setPreviewJob(null);
      setFileContent("");
      await loadHealth();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Data Health &amp; Upstream Source Registry
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Diagnostics
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Upstream provider quotas, verified reachability latency, and atomic CSV import hub
          </p>
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
        <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
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
          {/* Telemetry Summary Flat Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
              Upstream Adapters Health Telemetry
            </div>
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[25%]">Adapter Status Category</th>
                  <th className="w-[20%] text-right">Count</th>
                  <th className="w-[55%]">System Condition</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium text-[#087744] dark:text-[#58D6A0]">Ready Adapters</td>
                  <td className="text-right font-medium text-[#087744] dark:text-[#58D6A0]">{health.summary.ready}</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">At least one successful live pull recorded</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Awaiting First Run</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">{health.summary.pending}</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Registered but no successful pull recorded yet</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Needs API Key</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">{health.summary.needs_key}</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Free registration key pending in environment (e.g. FRED_API_KEY)</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#536176] dark:text-[#A8B4C4]">Manual Import Only</td>
                  <td className="text-right font-medium text-[#536176] dark:text-[#A8B4C4]">{health.summary.manual_only}</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Manual CSV / XLSX ingest due to zero-scraping licensing constraint</td>
                </tr>
                <tr>
                  <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">Total Registered Adapters</td>
                  <td className="text-right font-medium text-[#172033] dark:text-[#EDF2F7]">{health.summary.total}</td>
                  <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">Complete backoffice data adapter catalog</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Source Adapters Registry Table */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
              Source Adapters Registry
            </div>
            <div className="overflow-x-auto">
              <table className="terminal-table">
                <thead>
                  <tr>
                    <th className="w-[22%]">Source / Adapter</th>
                    <th className="w-[12%]">
                      <div className="inline-flex items-center gap-1">
                        <span>Status</span>
                        <InfoTip metric="source_health" />
                      </div>
                    </th>
                    <th className="w-[10%]">Frequency</th>
                    <th className="w-[12%] text-right">Rate Budget</th>
                    <th className="w-[16%]">
                      <div className="inline-flex items-center gap-1">
                        <span>Last Success</span>
                        <InfoTip metric="freshness_latency" />
                      </div>
                    </th>
                    <th className="w-[18%]">Attribution Notes</th>
                    <th className="w-[10%] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {health.sources.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div className="font-medium text-[#172033] dark:text-[#EDF2F7]">{s.name}</div>
                        <div className="text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">
                          {s.id} • v{s.adapter_version}
                        </div>
                      </td>
                      <td>
                        <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                          s.health_status === "ready"
                            ? "bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]"
                            : "bg-[#F7F9FB] dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] border border-[#E4E9EF] dark:border-[#2B3644]"
                        }`}>
                          {s.health_status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="text-[11px] font-mono uppercase text-[#536176] dark:text-[#A8B4C4]">
                        {s.supported_frequency}
                      </td>
                      <td className="text-right text-[#536176] dark:text-[#A8B4C4]">
                        {s.rate_budget}/hr
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                        {s.last_success_at ? formatISTDateTime(s.last_success_at) : "Never"}
                      </td>
                      <td className="text-[11px] text-[#536176] dark:text-[#A8B4C4] truncate max-w-xs" title={s.terms_notes}>
                        {s.terms_notes}
                      </td>
                      <td className="text-right">
                        {s.health_status !== "manual_only" && (
                          <button
                            onClick={() => handleRefresh(s.id)}
                            disabled={refreshingId === s.id}
                            className="terminal-btn text-[11px] py-0.5 px-2 text-[#006F64] dark:text-[#75E1CE]"
                          >
                            {refreshingId === s.id ? "Syncing…" : "Sync"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Validated CSV Import Hub */}
          <div className="terminal-panel p-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
              <div>
                <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                  Validated CSV / XLSX Ingestion Hub
                </div>
                <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                  Two-stage safe import: Preview row-level validation → Atomic Commit with formula sanitization
                </div>
              </div>
              <a
                href={importTemplateUrl(importType)}
                download={`${importType}_template.csv`}
                className="terminal-btn text-[11px] py-1 px-2.5 self-start sm:self-auto"
              >
                Download CSV Template
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                  Import Dataset
                </label>
                <select
                  value={importType}
                  onChange={(e) => setImportType(e.target.value)}
                  className="terminal-input w-full text-[12px] py-1 px-2"
                >
                  <option value="pms_strategies">PMS Strategy Performance</option>
                  <option value="issuer_fundamentals">Issuer Financial Statements</option>
                  <option value="macro_yields">Macro Sovereign Yield Series</option>
                  <option value="derivative_reports">Derivatives EOD Bhavcopy</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                  Select CSV File ({fileName})
                </label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileSelect}
                  className="terminal-input w-full text-[12px] py-1 px-2"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePreview}
                disabled={previewing || !fileContent.trim()}
                className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
              >
                {previewing ? "Validating Rows…" : "Preview & Validate Ingest"}
              </button>
            </div>

            {commitMessage && (
              <div className="terminal-panel p-2.5 border border-[#087744]/30 bg-[#087744]/5 text-[#087744] dark:text-[#58D6A0] text-[12px]">
                {commitMessage}
              </div>
            )}

            {previewJob && (
              <div className="terminal-panel p-3 border border-[#E4E9EF] dark:border-[#2B3644] space-y-2.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">
                    Preview Summary: {previewJob.valid_rows_count + previewJob.error_rows_count} total rows ({previewJob.valid_rows_count} valid, {previewJob.error_rows_count} errors)
                  </span>
                  <button
                    onClick={handleCommit}
                    disabled={committing || previewJob.valid_rows_count === 0}
                    className="terminal-btn text-[12px] py-1 px-3 bg-[#087744] text-white border-[#087744] dark:bg-[#58D6A0] dark:text-[#10151C] dark:border-[#58D6A0] font-medium"
                  >
                    {committing ? "Committing Transaction…" : `Commit ${previewJob.valid_rows_count} Rows Atomically`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
