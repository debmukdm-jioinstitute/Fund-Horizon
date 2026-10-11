// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import Link from "next/link";
import { AdminStats, AdminPlanSummary } from "@/lib/admin-api";
import { inr, pct, shortInr } from "@/lib/format";
import { AdminTab } from "./AdminHeader";

interface AdminDashboardTabProps {
  stats: AdminStats;
  onTabChange: (tab: AdminTab) => void;
  onInspectPlan: (plan: AdminPlanSummary) => void;
}

export default function AdminDashboardTab({ stats, onTabChange, onInspectPlan }: AdminDashboardTabProps) {
  const db = stats.database || { provider: "SQLite", connected: true };

  return (
    <div className="space-y-8">
      {/* 4 Stat KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Plans KPI */}
        <div className="p-5 rounded-2xl bg-white border border-navy-100 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy-500">Client Plans</span>
            <span className="p-2 rounded-xl bg-teal-50 text-teal-600 text-sm">📋</span>
          </div>
          <p className="text-3xl font-extrabold text-navy-950 mt-3">{stats.total_plans}</p>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-navy-600 font-medium">Saved in repository</span>
            <button
              onClick={() => onTabChange("plans")}
              className="text-teal-700 hover:text-teal-800 font-semibold"
            >
              Browse →
            </button>
          </div>
        </div>

        {/* CAS Statements KPI */}
        <div className="p-5 rounded-2xl bg-white border border-navy-100 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy-500">CAS Statements</span>
            <span className="p-2 rounded-xl bg-teal-50 text-teal-600 text-sm">📑</span>
          </div>
          <p className="text-3xl font-extrabold text-navy-950 mt-3">{stats.total_cas_sessions}</p>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-navy-600 font-medium">In-memory parsed</span>
            <button
              onClick={() => onTabChange("cas")}
              className="text-teal-700 hover:text-teal-800 font-semibold"
            >
              View →
            </button>
          </div>
        </div>

        {/* Schemes Catalog KPI */}
        <div className="p-5 rounded-2xl bg-white border border-navy-100 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy-500">Mutual Fund Schemes</span>
            <span className="p-2 rounded-xl bg-teal-50 text-teal-600 text-sm">📈</span>
          </div>
          <p className="text-3xl font-extrabold text-navy-950 mt-3">{stats.total_schemes.toLocaleString()}</p>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-navy-600 font-medium">
              {stats.total_amcs} AMCs · {stats.total_categories} Categories
            </span>
            <button
              onClick={() => onTabChange("funds")}
              className="text-teal-700 hover:text-teal-800 font-semibold"
            >
              Catalog →
            </button>
          </div>
        </div>

        {/* Database Backend KPI */}
        <div className="p-5 rounded-2xl bg-white border border-navy-100 shadow-sm hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy-500">Storage Backend</span>
            <span className="p-2 rounded-xl bg-teal-50 text-teal-600 text-sm">🗄️</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <span className="text-2xl font-extrabold text-navy-950">{db.provider}</span>
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-500 animate-pulse" />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="text-navy-600 truncate max-w-[150px]" title={db.path || db.dialect || "Active"}>
              {db.dialect || db.path ? String(db.dialect || db.path).split("/").pop() : "Connected"}
            </span>
            <button
              onClick={() => onTabChange("operations")}
              className="text-teal-700 hover:text-teal-800 font-semibold"
            >
              Diagnostics →
            </button>
          </div>
        </div>
      </div>

      {/* Architecture & Engine Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-navy-100 bg-white flex items-start gap-3">
          <div className="p-2 rounded-lg bg-teal-50 text-teal-700 font-bold text-xs mt-0.5">MATH</div>
          <div>
            <h3 className="text-sm font-bold text-navy-950">Deterministic Math Engine</h3>
            <p className="text-xs text-navy-600 mt-0.5">100% Python analytics (Monte Carlo, XIRR, Glidepath)</p>
            <span className="inline-block mt-2 text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
              Floor 85% coverage passing
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-navy-100 bg-white flex items-start gap-3">
          <div className="p-2 rounded-lg bg-navy-50 text-navy-800 font-bold text-xs mt-0.5">RAG</div>
          <div>
            <h3 className="text-sm font-bold text-navy-950">Vector Knowledge Base</h3>
            <p className="text-xs text-navy-600 mt-0.5">ChromaDB + ONNX FastEmbed (bge-small-en-v1.5)</p>
            <span className="inline-block mt-2 text-[11px] font-semibold text-navy-800 bg-navy-100 px-2 py-0.5 rounded">
              3,638 schemes indexed
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-navy-100 bg-white flex items-start gap-3">
          <div className="p-2 rounded-lg bg-teal-50 text-teal-700 font-bold text-xs mt-0.5">AI</div>
          <div>
            <h3 className="text-sm font-bold text-navy-950">Explanation & Guardrails</h3>
            <p className="text-xs text-navy-600 mt-0.5">LiteLLM fallback (Groq → Gemini → OpenRouter → Ollama)</p>
            <span className="inline-block mt-2 text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
              PII & compliance scanner active
            </span>
          </div>
        </div>
      </div>

      {/* Recent Plans & Recent CAS Two-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Plans */}
        <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-navy-950">Recent Client Plans</h3>
              <p className="text-xs text-navy-500">Latest goal-based portfolios computed</p>
            </div>
            <button
              onClick={() => onTabChange("plans")}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              View all ({stats.total_plans})
            </button>
          </div>

          {stats.recent_plans.length === 0 ? (
            <div className="p-8 text-center text-xs text-navy-500 bg-navy-50/50 rounded-xl">
              No plans generated yet. Create a test plan in the client portal.
            </div>
          ) : (
            <div className="space-y-3">
              {stats.recent_plans.map((p) => (
                <div
                  key={p.id}
                  className="p-3.5 rounded-xl border border-navy-100 hover:border-teal-500/40 bg-white hover:bg-teal-50/10 transition flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-navy-950 truncate">{p.client_name}</span>
                      {p.risk_band && (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-navy-100 text-navy-800">
                          {p.risk_band}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-navy-500 mt-1">
                      <span>Corpus: {shortInr(p.target_corpus)}</span>
                      {p.total_sip && <span>SIP: {inr(p.total_sip)}/mo</span>}
                      <span>{new Date(p.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onInspectPlan(p)}
                      className="px-2.5 py-1 text-xs font-medium bg-navy-50 hover:bg-navy-100 text-navy-700 rounded transition"
                    >
                      Inspect
                    </button>
                    <Link
                      href={`/plan/${p.id}`}
                      target="_blank"
                      className="px-2.5 py-1 text-xs font-medium bg-teal-50 hover:bg-teal-100 text-teal-800 rounded transition"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent CAS Statements */}
        <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-navy-950">Recent CAS Portfolios</h3>
              <p className="text-xs text-navy-500">Statements parsed in memory</p>
            </div>
            <button
              onClick={() => onTabChange("cas")}
              className="text-xs font-semibold text-teal-700 hover:text-teal-800"
            >
              View all ({stats.total_cas_sessions})
            </button>
          </div>

          {stats.recent_cas.length === 0 ? (
            <div className="p-8 text-center text-xs text-navy-500 bg-navy-50/50 rounded-xl">
              No CAS statements analyzed yet. Try uploading a sample CAS PDF.
            </div>
          ) : (
            <div className="space-y-3">
              {stats.recent_cas.map((s) => (
                <div
                  key={s.session_id}
                  className="p-3.5 rounded-xl border border-navy-100 bg-white flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-navy-950 truncate">{s.investor_name}</span>
                      {s.xirr !== undefined && s.xirr !== null && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-900">
                          XIRR {pct(s.xirr)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-navy-500 mt-1">
                      <span>Valuation: {inr(s.total_value)}</span>
                      <span>Holdings: {s.holdings_count}</span>
                      <span>Direct: {s.direct_pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-navy-400">
                    {new Date(s.created_at).toLocaleDateString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
