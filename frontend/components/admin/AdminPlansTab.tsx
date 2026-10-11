// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AdminPlanSummary, fetchAdminPlans, deleteAdminPlan } from "@/lib/admin-api";
import { inr, shortInr } from "@/lib/format";
import { reportUrl } from "@/lib/api";

interface AdminPlansTabProps {
  onInspectPlan: (plan: AdminPlanSummary) => void;
}

const RISK_BANDS = ["All", "Conservative", "Moderate", "Balanced", "Growth", "Aggressive"];

export default function AdminPlansTab({ onInspectPlan }: AdminPlansTabProps) {
  const [plans, setPlans] = useState<AdminPlanSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedBand, setSelectedBand] = useState("All");
  const [page, setPage] = useState(0);
  const limit = 20;

  const loadPlans = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminPlans(limit, page * limit, search || undefined);
      setPlans(data.plans);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);


  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the plan for ${name}?`)) return;
    try {
      await deleteAdminPlan(id);
      loadPlans();
    } catch (e) {
      alert(`Failed to delete plan: ${e}`);
    }
  };

  const filteredPlans = plans.filter((p) => {
    if (selectedBand === "All") return true;
    return p.risk_band?.toLowerCase() === selectedBand.toLowerCase();
  });

  return (
    <div className="space-y-6">
      {/* Header & Search Bar */}
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-navy-950">Client Planning Repository</h2>
          <p className="text-xs text-navy-500">
            Total {total} plans recorded. Search and inspect portfolio inputs and outputs.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search by client name or ID..."
              className="w-full pl-9 pr-4 py-2 rounded-xl text-xs border border-navy-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-navy-900"
            />
            <svg
              className="w-4 h-4 text-navy-400 absolute left-3 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          <button
            onClick={loadPlans}
            className="px-3 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Risk Band Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs font-semibold text-navy-500 mr-1">Risk Band:</span>
        {RISK_BANDS.map((band) => (
          <button
            key={band}
            onClick={() => setSelectedBand(band)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
              selectedBand === band
                ? "bg-navy-900 text-white shadow-sm"
                : "bg-white border border-navy-200 text-navy-700 hover:bg-navy-50"
            }`}
          >
            {band}
          </button>
        ))}
      </div>

      {/* Plans Table */}
      <div className="bg-white rounded-2xl border border-navy-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-navy-500">Loading client plans...</div>
        ) : filteredPlans.length === 0 ? (
          <div className="p-12 text-center text-xs text-navy-500">
            No plans found matching the search criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy-50/80 text-navy-700 uppercase tracking-wider font-semibold border-b border-navy-100 text-[11px]">
                <tr>
                  <th className="px-5 py-3.5">Client</th>
                  <th className="px-4 py-3.5">Risk Profile</th>
                  <th className="px-4 py-3.5">Target Corpus</th>
                  <th className="px-4 py-3.5">Monthly SIP</th>
                  <th className="px-4 py-3.5">Goals</th>
                  <th className="px-4 py-3.5">Created Date</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 text-navy-800">
                {filteredPlans.map((p) => (
                  <tr key={p.id} className="hover:bg-teal-50/20 transition">
                    <td className="px-5 py-4">
                      <div className="font-bold text-navy-950 text-sm">{p.client_name}</div>
                      <div className="text-[11px] text-navy-400 font-mono mt-0.5">
                        {p.id.slice(0, 8)}... {p.age ? `(Age ${p.age})` : ""}
                      </div>
                    </td>

                    <td className="px-4 py-4">
                      {p.risk_band ? (
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-full font-semibold text-[11px] bg-navy-100 text-navy-800">
                            {p.risk_band}
                          </span>
                          {p.risk_score !== undefined && (
                            <span className="text-[11px] text-navy-500 font-medium">({p.risk_score})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-navy-400">–</span>
                      )}
                    </td>

                    <td className="px-4 py-4 font-semibold text-navy-950">
                      {shortInr(p.target_corpus)}
                    </td>

                    <td className="px-4 py-4 font-semibold text-teal-700">
                      {p.total_sip ? inr(p.total_sip) : "–"}
                    </td>

                    <td className="px-4 py-4">
                      <span className="bg-navy-50 text-navy-700 px-2 py-0.5 rounded text-[11px] font-medium">
                        {p.goals_count} {p.goals_count === 1 ? "goal" : "goals"}
                      </span>
                    </td>

                    <td className="px-4 py-4 text-navy-500 text-[11px]">
                      {new Date(p.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onInspectPlan(p)}
                          className="px-2.5 py-1 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded transition"
                        >
                          Inspect
                        </button>
                        <Link
                          href={`/plan/${p.id}`}
                          target="_blank"
                          className="px-2.5 py-1 text-xs font-semibold bg-teal-50 hover:bg-teal-100 text-teal-800 rounded transition"
                        >
                          View
                        </Link>
                        <a
                          href={reportUrl(p.id)}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 text-xs font-semibold bg-navy-900 hover:bg-navy-800 text-white rounded transition"
                          title="Download PDF"
                        >
                          PDF
                        </a>
                        <button
                          onClick={() => handleDelete(p.id, p.client_name)}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded transition"
                          title="Delete Plan"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-4 bg-navy-50/50 border-t border-navy-100 flex items-center justify-between text-xs text-navy-600">
          <span>
            Showing {filteredPlans.length} of {total} records
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded bg-white border border-navy-200 disabled:opacity-50 hover:bg-navy-50 font-medium"
            >
              Previous
            </button>
            <span className="font-semibold text-navy-800">Page {page + 1}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="px-3 py-1 rounded bg-white border border-navy-200 disabled:opacity-50 hover:bg-navy-50 font-medium"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
