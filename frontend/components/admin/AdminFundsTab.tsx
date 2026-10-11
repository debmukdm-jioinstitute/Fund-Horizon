// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { AdminSchemeRecord, fetchAdminSchemes } from "@/lib/admin-api";
import { pct } from "@/lib/format";

export default function AdminFundsTab() {
  const [schemes, setSchemes] = useState<AdminSchemeRecord[]>([]);
  const [amcs, setAmcs] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedAmc, setSelectedAmc] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [selectedPlan, setSelectedPlan] = useState("");
  const [sortBy, setSortBy] = useState("scheme_name");
  const [order, setOrder] = useState("asc");
  const [page, setPage] = useState(0);
  const limit = 25;

  const loadSchemes = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAdminSchemes({
        search: search || undefined,
        amc: selectedAmc || undefined,
        category: selectedCat || undefined,
        plan: selectedPlan || undefined,
        sort_by: sortBy,
        order: order,
        limit: limit,
        offset: page * limit,
      });
      setSchemes(data.schemes);
      setTotal(data.total);
      if (data.amcs?.length && !amcs.length) setAmcs(data.amcs);
      if (data.categories?.length && !categories.length) setCategories(data.categories);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search, selectedAmc, selectedCat, selectedPlan, sortBy, order, amcs.length, categories.length]);

  useEffect(() => {
    loadSchemes();
  }, [loadSchemes]);


  const handleSort = (field: string) => {
    if (sortBy === field) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setOrder("desc");
    }
    setPage(0);
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter Bar */}
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-navy-950">Mutual Fund Master Catalog</h2>
            <p className="text-xs text-navy-500">
              {total.toLocaleString()} schemes indexed with calculated returns, risk, and volatility.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSearch("");
                setSelectedAmc("");
                setSelectedCat("");
                setSelectedPlan("");
                setSortBy("scheme_name");
                setOrder("asc");
                setPage(0);
              }}
              className="px-3 py-1.5 text-xs text-navy-600 hover:text-navy-900 border border-navy-200 rounded-lg hover:bg-navy-50"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Keyword Search */}
          <div className="relative col-span-1 sm:col-span-2">
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search scheme name or code..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-navy-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-navy-900"
            />
            <svg
              className="w-4 h-4 text-navy-400 absolute left-3 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          {/* AMC Filter */}
          <div>
            <select
              value={selectedAmc}
              onChange={(e) => {
                setSelectedAmc(e.target.value);
                setPage(0);
              }}
              className="w-full px-3 py-2 text-xs border border-navy-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-navy-900 bg-white"
            >
              <option value="">All AMCs ({amcs.length})</option>
              {amcs.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <select
              value={selectedCat}
              onChange={(e) => {
                setSelectedCat(e.target.value);
                setPage(0);
              }}
              className="w-full px-3 py-2 text-xs border border-navy-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-navy-900 bg-white"
            >
              <option value="">All Categories ({categories.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Plan Filter */}
          <div>
            <select
              value={selectedPlan}
              onChange={(e) => {
                setSelectedPlan(e.target.value);
                setPage(0);
              }}
              className="w-full px-3 py-2 text-xs border border-navy-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-navy-900 bg-white"
            >
              <option value="">All Plans</option>
              <option value="Regular">Regular Only</option>
              <option value="Direct">Direct Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Schemes Table */}
      <div className="bg-white rounded-2xl border border-navy-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-navy-500">Loading scheme directory...</div>
        ) : schemes.length === 0 ? (
          <div className="p-12 text-center text-xs text-navy-500">
            No mutual fund schemes match your filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy-50/80 text-navy-700 uppercase tracking-wider font-semibold border-b border-navy-100 text-[11px]">
                <tr>
                  <th
                    onClick={() => handleSort("scheme_name")}
                    className="px-5 py-3.5 cursor-pointer hover:bg-navy-100/50"
                  >
                    Scheme {sortBy === "scheme_name" ? (order === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="px-4 py-3.5">Category & AMC</th>
                  <th className="px-3 py-3.5">NAV</th>
                  <th
                    onClick={() => handleSort("ret_1y")}
                    className="px-3 py-3.5 cursor-pointer hover:bg-navy-100/50 text-right"
                  >
                    1Y Ret {sortBy === "ret_1y" ? (order === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    onClick={() => handleSort("cagr_3y")}
                    className="px-3 py-3.5 cursor-pointer hover:bg-navy-100/50 text-right"
                  >
                    3Y CAGR {sortBy === "cagr_3y" ? (order === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    onClick={() => handleSort("cagr_5y")}
                    className="px-3 py-3.5 cursor-pointer hover:bg-navy-100/50 text-right"
                  >
                    5Y CAGR {sortBy === "cagr_5y" ? (order === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    onClick={() => handleSort("sharpe_3y")}
                    className="px-3 py-3.5 cursor-pointer hover:bg-navy-100/50 text-right"
                  >
                    Sharpe {sortBy === "sharpe_3y" ? (order === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th
                    onClick={() => handleSort("vol_3y")}
                    className="px-3 py-3.5 cursor-pointer hover:bg-navy-100/50 text-right"
                  >
                    Vol {sortBy === "vol_3y" ? (order === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="px-4 py-3.5 text-right">Deep Analytics</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 text-navy-800">
                {schemes.map((s) => (
                  <tr key={s.scheme_code} className="hover:bg-teal-50/20 transition">
                    <td className="px-5 py-3.5 max-w-xs">
                      <div className="font-bold text-navy-950 truncate" title={s.scheme_name}>
                        {s.scheme_name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-navy-400 font-mono">
                        <span>Code: {s.scheme_code}</span>
                        <span className={`px-1.5 py-0.2 rounded font-semibold text-[10px] ${s.plan === "Direct" ? "bg-teal-50 text-teal-700" : "bg-navy-50 text-navy-700"}`}>
                          {s.plan}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-[200px]">
                      <div className="text-navy-900 font-medium truncate" title={s.category}>
                        {s.category}
                      </div>
                      <div className="text-[11px] text-navy-500 truncate" title={s.amc}>
                        {s.amc}
                      </div>
                    </td>

                    <td className="px-3 py-3.5 font-mono text-navy-900">
                      {s.latest_nav ? `₹${s.latest_nav.toFixed(2)}` : "–"}
                    </td>

                    <td className="px-3 py-3.5 text-right font-medium">
                      {s.ret_1y !== undefined && s.ret_1y !== null ? (
                        <span className={s.ret_1y >= 0 ? "text-teal-700 font-semibold" : "text-rose-700 font-semibold"}>
                          {pct(s.ret_1y)}
                        </span>
                      ) : (
                        <span className="text-navy-400">–</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-right font-medium">
                      {s.cagr_3y !== undefined && s.cagr_3y !== null ? (
                        <span className={s.cagr_3y >= 0 ? "text-teal-800 font-semibold" : "text-rose-700"}>
                          {pct(s.cagr_3y)}
                        </span>
                      ) : (
                        <span className="text-navy-400">–</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-right font-medium">
                      {s.cagr_5y !== undefined && s.cagr_5y !== null ? (
                        <span className="text-navy-900 font-semibold">{pct(s.cagr_5y)}</span>
                      ) : (
                        <span className="text-navy-400">–</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-right font-mono">
                      {s.sharpe_3y !== undefined && s.sharpe_3y !== null ? (
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${s.sharpe_3y > 1 ? "bg-teal-50 text-teal-800" : "bg-navy-50 text-navy-700"}`}>
                          {s.sharpe_3y.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-navy-400">–</span>
                      )}
                    </td>

                    <td className="px-3 py-3.5 text-right font-mono text-navy-600">
                      {s.vol_3y !== undefined && s.vol_3y !== null ? pct(s.vol_3y) : "–"}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <Link
                        href={`/funds/${s.scheme_code}`}
                        target="_blank"
                        className="px-2.5 py-1 text-xs font-semibold bg-teal-50 hover:bg-teal-100 text-teal-800 rounded transition inline-flex items-center gap-1"
                      >
                        Analytics →
                      </Link>
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
            Showing {schemes.length} of {total.toLocaleString()} records
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 rounded bg-white border border-navy-200 disabled:opacity-50 hover:bg-navy-50 font-medium"
            >
              Previous
            </button>
            <span className="font-semibold text-navy-800">
              Page {page + 1} of {Math.max(1, Math.ceil(total / limit))}
            </span>
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
