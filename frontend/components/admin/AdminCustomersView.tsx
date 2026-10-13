// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AccountRole,
  CustomerRecord,
  fetchCustomers,
  patchCustomer,
} from "./account-api";

const PAGE_SIZE = 20;

const ROLE_STYLES: Record<AccountRole, string> = {
  customer: "bg-sky-50 text-sky-800 border-sky-200",
  rm: "bg-amber-50 text-amber-800 border-amber-200",
  admin: "bg-rose-50 text-rose-700 border-rose-200",
};

const ROLE_LABELS: Record<AccountRole, string> = {
  customer: "Customer",
  rm: "Relationship manager",
  admin: "Admin",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "–";
  }
}

export default function AdminCustomersView() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomers(PAGE_SIZE, page * PAGE_SIZE);
      setCustomers(data.customers);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load customers");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const rms = customers.filter((c) => c.role === "rm");
  const rmName = (id: string | null) =>
    id ? rms.find((r) => r.id === id)?.name ?? "–" : "–";

  const handleRoleChange = async (customer: CustomerRecord, role: AccountRole) => {
    if (role === customer.role) return;
    setSavingId(customer.id);
    setError(null);
    try {
      const updated = await patchCustomer(customer.id, { role });
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update role");
    } finally {
      setSavingId(null);
    }
  };

  const handleRmAssign = async (customer: CustomerRecord, assignedRmId: string) => {
    const next = assignedRmId === "" ? null : assignedRmId;
    if (next === customer.assigned_rm_id) return;
    setSavingId(customer.id);
    setError(null);
    try {
      const updated = await patchCustomer(customer.id, { assigned_rm_id: next });
      setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign relationship manager");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-navy-950">Customers</h2>
          <p className="text-xs text-navy-500">
            {total} registered account{total === 1 ? "" : "s"}. Change roles and assign
            relationship managers from here.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition self-start md:self-auto"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-navy-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-navy-500">Loading customers...</div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-xs text-navy-500">
            No customer accounts yet. Accounts appear here once someone signs up.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy-50/80 text-navy-700 uppercase tracking-wider font-semibold border-b border-navy-100 text-xs">
                <tr>
                  <th className="px-5 py-3.5">Customer</th>
                  <th className="px-4 py-3.5">Contact</th>
                  <th className="px-4 py-3.5">Role</th>
                  <th className="px-4 py-3.5">Assigned RM</th>
                  <th className="px-4 py-3.5">Plans</th>
                  <th className="px-4 py-3.5">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 text-navy-800">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-teal-50/20 transition">
                    <td className="px-5 py-4">
                      <div className="font-bold text-navy-950 text-sm">{c.name}</div>
                      <div className="text-xs text-navy-600 font-mono mt-0.5">
                        {c.id.slice(0, 8)}...
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-navy-900 break-all">{c.email}</div>
                      <div className="text-xs text-navy-500 mt-0.5">{c.mobile}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full font-semibold text-xs border ${ROLE_STYLES[c.role]}`}
                        >
                          {ROLE_LABELS[c.role]}
                        </span>
                        <select
                          aria-label={`Change role for ${c.name}`}
                          value={c.role}
                          disabled={savingId === c.id}
                          onChange={(e) => handleRoleChange(c, e.target.value as AccountRole)}
                          className="text-xs font-medium border border-navy-200 rounded-lg px-2 py-1 bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                        >
                          <option value="customer">Customer</option>
                          <option value="rm">Relationship manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        aria-label={`Assign relationship manager for ${c.name}`}
                        value={c.assigned_rm_id ?? ""}
                        disabled={savingId === c.id}
                        onChange={(e) => handleRmAssign(c, e.target.value)}
                        className="text-xs font-medium border border-navy-200 rounded-lg px-2 py-1 bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 max-w-[10rem]"
                      >
                        <option value="">Unassigned</option>
                        {rms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      {c.assigned_rm_id && (
                        <div className="text-xs text-navy-500 mt-1">{rmName(c.assigned_rm_id)}</div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className="bg-navy-50 text-navy-700 px-2 py-0.5 rounded text-xs font-medium">
                        {c.plan_count} {c.plan_count === 1 ? "plan" : "plans"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-navy-500 text-xs">
                      {formatDate(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-4 bg-navy-50/50 border-t border-navy-100 flex items-center justify-between text-xs text-navy-600">
          <span>
            Showing {customers.length} of {total} accounts
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
              disabled={(page + 1) * PAGE_SIZE >= total}
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
