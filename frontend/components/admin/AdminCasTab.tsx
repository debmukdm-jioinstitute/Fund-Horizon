// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useState, useEffect } from "react";
import { AdminCasSummary, fetchAdminCasSessions } from "@/lib/admin-api";
import { inr, pct } from "@/lib/format";

export default function AdminCasTab() {
  const [sessions, setSessions] = useState<AdminCasSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [inspectSession, setInspectSession] = useState<AdminCasSummary | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminCasSessions(50, 0);
      setSessions(data.sessions);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-navy-950">CAS Portfolio Statements</h2>
          <p className="text-xs text-navy-500">
            {total} statement parsing sessions recorded in memory. Zero plain-text PDF files stored on disk.
          </p>
        </div>
        <button
          onClick={loadSessions}
          className="px-3 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
        >
          Refresh
        </button>
      </div>

      {/* CAS Table */}
      <div className="bg-white rounded-2xl border border-navy-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-navy-500">Loading CAS statement sessions...</div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center text-xs text-navy-500">
            No CAS statements parsed yet. Upload a statement in the client portal.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy-50/80 text-navy-700 uppercase tracking-wider font-semibold border-b border-navy-100 text-[11px]">
                <tr>
                  <th className="px-5 py-3.5">Investor</th>
                  <th className="px-4 py-3.5">Total Valuation</th>
                  <th className="px-4 py-3.5">Portfolio XIRR</th>
                  <th className="px-4 py-3.5">Holdings</th>
                  <th className="px-4 py-3.5">Direct vs Regular</th>
                  <th className="px-4 py-3.5">Date</th>
                  <th className="px-5 py-3.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 text-navy-800">
                {sessions.map((s) => (
                  <tr key={s.session_id} className="hover:bg-teal-50/20 transition">
                    <td className="px-5 py-4">
                      <div className="font-bold text-navy-950 text-sm">{s.investor_name}</div>
                      <div className="text-[11px] text-navy-400 font-mono mt-0.5">
                        {s.session_id.slice(0, 8)}...
                      </div>
                    </td>

                    <td className="px-4 py-4 font-bold text-navy-950">
                      {inr(s.total_value)}
                    </td>

                    <td className="px-4 py-4">
                      {s.xirr !== undefined && s.xirr !== null ? (
                        <span className="px-2.5 py-0.5 rounded-full font-bold text-xs bg-teal-100 text-teal-800">
                          {pct(s.xirr)}
                        </span>
                      ) : (
                        <span className="text-navy-400">n/a</span>
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <span className="bg-navy-50 text-navy-700 px-2 py-0.5 rounded text-[11px] font-medium">
                        {s.holdings_count} funds
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <div className="w-32">
                        <div className="flex justify-between text-[10px] text-navy-600 mb-1">
                          <span>Dir: {s.direct_pct.toFixed(0)}%</span>
                          <span>Reg: {s.regular_pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-navy-100 overflow-hidden flex">
                          <div
                            style={{ width: `${s.direct_pct}%` }}
                            className="bg-teal-500 h-full"
                            title={`Direct: ${s.direct_pct}%`}
                          />
                          <div
                            style={{ width: `${s.regular_pct}%` }}
                            className="bg-navy-700 h-full"
                            title={`Regular: ${s.regular_pct}%`}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-4 text-navy-500 text-[11px]">
                      {new Date(s.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>

                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => setInspectSession(s)}
                        className="px-2.5 py-1 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded transition"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CAS Session Details Modal */}
      {inspectSession && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-navy-100 flex items-center justify-between bg-navy-950 text-white rounded-t-2xl">
              <div>
                <h3 className="font-bold text-lg">{inspectSession.investor_name} - Portfolio Breakdown</h3>
                <span className="text-xs text-navy-400">Total Value: {inr(inspectSession.total_value)}</span>
              </div>
              <button
                onClick={() => setInspectSession(null)}
                className="text-navy-300 hover:text-white p-1 rounded"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-navy-50 rounded-xl">
                <div>
                  <span className="text-navy-500">Calculated Portfolio XIRR</span>
                  <p className="font-bold text-sm text-teal-800">
                    {inspectSession.xirr ? pct(inspectSession.xirr) : "–"}
                  </p>
                </div>
                <div>
                  <span className="text-navy-500">Direct vs Regular Ratio</span>
                  <p className="font-bold text-sm text-navy-900">
                    {inspectSession.direct_pct.toFixed(1)}% Direct / {inspectSession.regular_pct.toFixed(1)}% Regular
                  </p>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-sm text-navy-900 mb-2">Portfolio Holdings</h4>
                <div className="space-y-2">
                  {(((inspectSession.payload?.holdings as unknown) as Array<{
                    scheme_name?: string;
                    name?: string;
                    category?: string;
                    units?: number;
                    current_value?: number;
                    value?: number;
                    plan?: string;
                  }>) || []).map((h, i) => (
                    <div key={i} className="p-3 border border-navy-100 rounded-lg flex justify-between items-center">
                      <div>
                        <p className="font-bold text-navy-950">{h.scheme_name || h.name}</p>
                        <p className="text-[11px] text-navy-500">
                          {h.category || "Mutual Fund"} · Units: {h.units?.toFixed(3) || "–"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-navy-950">{inr(h.current_value || h.value)}</p>
                        {h.plan && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${h.plan === "Direct" ? "bg-teal-100 text-teal-800" : "bg-navy-100 text-navy-800"}`}>
                            {h.plan}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
