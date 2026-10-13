// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useState } from "react";
import { AdminHealthResponse, fetchAdminHealth, triggerAdminRefresh, fetchAdminPlans } from "@/lib/admin-api";
import { API_URL } from "@/lib/api";

interface AdminOperationsTabProps {
  initialHealth?: AdminHealthResponse | null;
}

export default function AdminOperationsTab({ initialHealth }: AdminOperationsTabProps) {
  const [health, setHealth] = useState<AdminHealthResponse | null>(initialHealth || null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [refreshDryRun, setRefreshDryRun] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{
    success: boolean;
    dry_run: boolean;
    funds_processed: number;
    metrics_processed: number;
    message: string;
  } | null>(null);

  const [exporting, setExporting] = useState(false);

  const checkHealth = async () => {
    setCheckingHealth(true);
    try {
      const data = await fetchAdminHealth();
      setHealth(data);
    } catch (e) {
      alert(`Health check failed: ${e}`);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await triggerAdminRefresh(refreshDryRun);
      setRefreshResult(res);
    } catch (e) {
      alert(`Sync failed: ${e}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleExportPlans = async () => {
    setExporting(true);
    try {
      const data = await fetchAdminPlans(200, 0);
      const blob = new Blob([JSON.stringify(data.plans, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fund-horizon-plans-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-navy-950">Operations & System Diagnostics</h2>
          <p className="text-xs text-navy-500">
            Maintenance controls, data synchronization, vector store health, and backups.
          </p>
        </div>
        <button
          onClick={checkHealth}
          disabled={checkingHealth}
          className="px-3 py-1.5 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
        >
          {checkingHealth ? "Pinging..." : "Ping System"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Database Diagnostics Card */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-navy-950 flex items-center gap-2">
              <span>🗄️</span> Database Engine Diagnostics
            </h3>
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-500 animate-pulse" />
          </div>

          <div className="p-3.5 bg-navy-50/60 rounded-xl space-y-2 text-xs font-mono text-navy-800">
            <div className="flex justify-between">
              <span className="text-navy-500 font-sans">Provider:</span>
              <span className="font-bold">{String(health?.database?.provider || "SQLite")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-navy-500 font-sans">Connection Status:</span>
              <span className="text-teal-700 font-bold">Connected (Active)</span>
            </div>
            {Boolean(health?.database?.path) && (
              <div className="flex justify-between truncate">
                <span className="text-navy-500 font-sans">Storage Path:</span>
                <span className="truncate max-w-[200px]" title={String(health?.database?.path)}>
                  {String(health?.database?.path).split("/").pop()}
                </span>
              </div>
            )}
            {Boolean(health?.database?.size_bytes) && (
              <div className="flex justify-between">
                <span className="text-navy-500 font-sans">File Size:</span>
                <span>{(Number(health?.database?.size_bytes) / 1024).toFixed(1)} KB</span>
              </div>
            )}

          </div>

          <div className="text-xs text-navy-600 bg-teal-50/50 p-3 rounded-lg border border-teal-100">
            <strong>Managed PostgreSQL Ready:</strong> Configure <code className="text-teal-900 bg-white px-1 py-0.5 rounded border border-teal-200">DATABASE_URL</code> in environment to activate connection-pooled Supabase (port 6543) or Neon.
          </div>
        </div>

        {/* Data Refresh Orchestrator Card */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-navy-950 flex items-center gap-2">
            <span>🔄</span> Daily Data Synchronization
          </h3>
          <p className="text-xs text-navy-600">
            Syncs latest scheme metrics into active database and regenerates static RAG documentation dataset.
          </p>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-navy-700 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={refreshDryRun}
                onChange={(e) => setRefreshDryRun(e.target.checked)}
                className="rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
              <span>Dry Run Simulation (no database writes)</span>
            </label>
          </div>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {refreshing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Synchronizing catalog...</span>
              </>
            ) : (
              <span>Execute {refreshDryRun ? "Simulation" : "Full Database Sync"}</span>
            )}
          </button>

          {refreshResult && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-xs text-teal-900 space-y-1">
              <p className="font-bold">Sync Completed!</p>
              <p>{refreshResult.message}</p>
              <p className="text-xs text-teal-700">
                Processed {refreshResult.funds_processed} funds and {refreshResult.metrics_processed} metric sets.
              </p>
            </div>
          )}
        </div>

        {/* Vector Knowledge Base Card */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-navy-950 flex items-center gap-2">
            <span>🧠</span> ChromaDB Vector Store
          </h3>
          <p className="text-xs text-navy-600">
            Local ONNX fastembed vector embeddings for scheme facts and RAG retrieval.
          </p>

          <div className="p-3.5 bg-navy-50/60 rounded-xl space-y-2 text-xs font-mono text-navy-800">
            <div className="flex justify-between">
              <span className="text-navy-500 font-sans">Model:</span>
              <span className="font-semibold">BAAI/bge-small-en-v1.5</span>
            </div>
            <div className="flex justify-between">
              <span className="text-navy-500 font-sans">Embedding Engine:</span>
              <span>fastembed (ONNX runtime)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-navy-500 font-sans">Collection Status:</span>
              <span className="text-teal-700 font-bold">
                {String(health?.rag?.status || "Ready")}
              </span>
            </div>
          </div>
        </div>

        {/* Export & Data Backup Card */}
        <div className="bg-white p-6 rounded-2xl border border-navy-100 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-navy-950 flex items-center gap-2">
            <span>💾</span> Data Exports & Backups
          </h3>
          <p className="text-xs text-navy-600">
            Export repository records for offline auditing or data backup.
          </p>

          <div className="space-y-2">
            <button
              onClick={handleExportPlans}
              disabled={exporting}
              className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-navy-50 hover:bg-navy-100 text-navy-900 border border-navy-200 transition text-left flex items-center justify-between"
            >
              <span>Export Client Plans (JSON)</span>
              <span>↓</span>
            </button>
            <a
              href={`${API_URL}/api/meta`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-navy-50 hover:bg-navy-100 text-navy-900 border border-navy-200 transition text-left flex items-center justify-between block"
            >
              <span>Export Metadata & Questionnaire (JSON)</span>
              <span>↗</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
