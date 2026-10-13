"use client";

import React, { useEffect, useState } from "react";
import {
  getDataHealth,
  refreshSource,
  previewImport,
  commitImport,
  SourceHealthData,
  ImportJobData,
} from "@/lib/backoffice";
import { StatusBadge } from "@/components/backoffice/StatusBadge";

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
    if (!previewJob?.id) return;
    setCommitting(true);
    try {
      const res = await commitImport(previewJob.id);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Data Health & Source Registry</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Primary provider quotas, verified reachability, manual import hub & atomic rollback guarantees
          </p>
        </div>
        <button
          onClick={loadHealth}
          className="px-3 py-1.5 bg-sand-100 hover:bg-sand-200 text-sand-800 rounded-xl text-xs font-medium transition-colors border border-sand-300"
        >
          ↻ Refresh Diagnostics
        </button>
      </div>

      {loading && !health ? (
        <div className="p-8 text-center text-sand-500 font-mono text-xs">
          Running provider diagnostics…
        </div>
      ) : error ? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
          {error}
        </div>
      ) : health ? (
        <div className="space-y-6">
          {/* Telemetry Tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Ready Adapters</div>
              <div className="mt-1 text-2xl font-bold font-mono text-emerald-700">{health.summary.ready}</div>
              <div className="text-[10px] text-sand-400 mt-1">Passing verified schemas</div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Needs Key</div>
              <div className="mt-1 text-2xl font-bold font-mono text-amber-700">{health.summary.needs_key}</div>
              <div className="text-[10px] text-sand-400 mt-1">Free key registration required</div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Manual Import Only</div>
              <div className="mt-1 text-2xl font-bold font-mono text-blue-700">{health.summary.manual_only}</div>
              <div className="text-[10px] text-sand-400 mt-1">Private or unlicensed sources</div>
            </div>
            <div className="p-4 bg-white rounded-2xl border border-sand-200 shadow-2xs">
              <div className="text-xs text-sand-500 font-medium">Total Registered</div>
              <div className="mt-1 text-2xl font-bold font-mono text-sand-800">{health.summary.total}</div>
              <div className="text-[10px] text-sand-400 mt-1">Registered source adapters</div>
            </div>
          </div>

          {/* Sources Table */}
          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-sand-950">Source Adapters Registry</h2>
                <p className="text-[11px] text-sand-500">Official documentation, license attribution & rate limits</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Source / Adapter</th>
                    <th className="py-2.5 px-3 font-medium">Health Status</th>
                    <th className="py-2.5 px-3 font-medium">Frequency</th>
                    <th className="py-2.5 px-3 font-medium">Rate Budget</th>
                    <th className="py-2.5 px-3 font-medium">Last Success</th>
                    <th className="py-2.5 px-3 font-medium">Terms & Attribution</th>
                    <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                  {health.sources.map((s) => (
                    <tr key={s.id} className="hover:bg-sand-50/60">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-sand-900 font-sans">{s.name}</div>
                        <div className="text-[11px] text-sand-500">
                          {s.id} • v{s.adapter_version}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge
                          availability={s.health_status}
                          freshness="current"
                        />
                      </td>
                      <td className="py-3 px-3 text-sand-700 uppercase text-[10px]">{s.supported_frequency}</td>
                      <td className="py-3 px-3 text-sand-700">{s.rate_budget}/hr</td>
                      <td className="py-3 px-3 text-sand-500 text-[11px]">
                        {s.last_success_at ? s.last_success_at.slice(0, 16).replace("T", " ") : "Never"}
                      </td>
                      <td className="py-3 px-3 max-w-xs truncate text-[11px] text-sand-600 font-sans" title={s.terms_notes}>
                        {s.terms_notes}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {s.health_status !== "manual_only" && (
                          <button
                            onClick={() => handleRefresh(s.id)}
                            disabled={refreshingId === s.id}
                            className="px-2.5 py-1 text-[11px] font-sans font-medium text-forest-700 hover:bg-forest-50 border border-forest-300 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {refreshingId === s.id ? "Fetching…" : "Trigger Sync"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Manual Import Workflow */}
          <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-sand-100">
              <div>
                <h2 className="text-sm font-semibold text-sand-950">Validated CSV / XLSX Import Hub</h2>
                <p className="text-[11px] text-sand-500">
                  Two-stage safe import: Preview with row-level validation → Atomic Commit. Defends against CSV formula injection.
                </p>
              </div>
              <a
                href={`/api/backoffice/imports/templates/${importType}`}
                download={`${importType}_template.csv`}
                className="px-3 py-1.5 text-xs text-forest-800 bg-forest-50 border border-forest-200 rounded-xl hover:bg-forest-100 font-medium self-start sm:self-auto"
              >
                📥 Download Template CSV
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-sand-700 block mb-1">Import Dataset Type</label>
                <select
                  value={importType}
                  onChange={(e) => setImportType(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600"
                >
                  <option value="pms_strategies">PMS Strategy Performance</option>
                  <option value="option_chain">Option Chain & PCR Contracts</option>
                  <option value="flows">FII / DII Institutional Flows</option>
                  <option value="fundamentals">Issuer Fundamentals & Ratios</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-sand-700 block mb-1">Upload CSV File</label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileSelect}
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 bg-sand-50 text-sand-700 file:mr-3 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-forest-700 file:text-white hover:file:bg-forest-800"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Or Paste CSV Content Directly</label>
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                rows={5}
                placeholder="Paste CSV rows with headers here…"
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600"
              />
            </div>

            <button
              onClick={handlePreview}
              disabled={previewing || !fileContent.trim()}
              className="px-4 py-2 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 disabled:opacity-50 transition-colors shadow-xs"
            >
              {previewing ? "Validating Content…" : "Preview & Validate Mapping"}
            </button>

            {commitMessage && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold">
                {commitMessage}
              </div>
            )}

            {previewJob && (
              <div className="p-4 bg-sand-50 rounded-xl border border-sand-200 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between font-sans">
                  <div>
                    <span className="font-semibold text-sand-900">Preview Results: </span>
                    <span className="text-emerald-700 font-bold">{previewJob.valid_rows_count} valid rows</span>
                    {previewJob.error_rows_count > 0 && (
                      <span className="text-rose-700 ml-2 font-bold">• {previewJob.error_rows_count} rejected rows</span>
                    )}
                  </div>
                  <button
                    onClick={handleCommit}
                    disabled={committing || previewJob.valid_rows_count === 0}
                    className="px-4 py-1.5 bg-forest-800 text-white rounded-xl text-xs font-semibold hover:bg-forest-900 disabled:opacity-50 shadow-xs"
                  >
                    {committing ? "Committing Transaction…" : `Commit ${previewJob.valid_rows_count} Rows to Database`}
                  </button>
                </div>

                {previewJob.error_rows_count > 0 && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-rose-800 font-sans space-y-1">
                    <div className="font-semibold">Row Rejections:</div>
                    {previewJob.errors?.slice(0, 5).map((err: { row: number; error: string }, idx: number) => (
                      <div key={idx} className="text-[11px] font-mono">
                        Row {err.row}: {err.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
