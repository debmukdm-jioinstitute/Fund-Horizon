"use client";

import React, { useEffect, useState } from "react";
import {
  getWatchlists,
  createWatchlist,
  deleteWatchlist,
  listStaffMembers,
  createStaffMember,
  WatchlistItem,
  StaffMemberItem,
} from "@/lib/backoffice";
import { useAuth } from "@/components/AuthContext";

export default function SettingsPage() {
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";

  // Watchlist state
  const [watchlists, setWatchlists] = useState<WatchlistItem[]>([]);
  const [wlName, setWlName] = useState("");
  const [wlType, setWlType] = useState("scheme");
  const [wlId, setWlId] = useState("");
  const [savingWl, setSavingWl] = useState(false);

  // Staff state (Admin only)
  const [staffList, setStaffList] = useState<StaffMemberItem[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffMobile, setStaffMobile] = useState("");
  const [staffRole, setStaffRole] = useState("analyst");
  const [savingStaff, setSavingStaff] = useState(false);
  const [provisionedCredentials, setProvisionedCredentials] = useState<{ email: string; temp_pass: string } | null>(null);

  useEffect(() => {
    loadWatchlists();
    if (isAdmin) {
      loadStaff();
    }
  }, [isAdmin]);

  async function loadWatchlists() {
    try {
      const res = await getWatchlists();
      setWatchlists(res || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadStaff() {
    try {
      const res = await listStaffMembers();
      setStaffList(res || []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAddWatchlist(e: React.FormEvent) {
    e.preventDefault();
    if (!wlName.trim() || !wlId.trim()) return;
    setSavingWl(true);
    try {
      const created = await createWatchlist({
        name: wlName.trim(),
        item_type: wlType,
        item_id: wlId.trim(),
      });
      setWatchlists([created, ...watchlists]);
      setWlName("");
      setWlId("");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to add watchlist item");
    } finally {
      setSavingWl(false);
    }
  }

  async function handleDeleteWatchlist(id: string) {
    try {
      await deleteWatchlist(id);
      setWatchlists(watchlists.filter((w) => w.id !== id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete watchlist item");
    }
  }

  async function handleProvisionStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!staffName.trim() || !staffEmail.trim() || !staffMobile.trim()) return;
    setSavingStaff(true);
    try {
      const res = await createStaffMember({
        name: staffName.trim(),
        email: staffEmail.trim().toLowerCase(),
        mobile: staffMobile.trim(),
        role: staffRole,
      });
      setProvisionedCredentials({
        email: res.staff_member.email,
        temp_pass: res.temporary_password ?? "(account promoted - existing password unchanged)",
      });
      setStaffName("");
      setStaffEmail("");
      setStaffMobile("");
      await loadStaff();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to provision staff member");
    } finally {
      setSavingStaff(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Settings, Watchlists & Staff Provisioning</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Internal role-based permissions, monitoring thresholds & operator account lifecycle
          </p>
        </div>
      </div>

      {/* Admin-only Staff Provisioning */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-sand-100">
            <div>
              <h2 className="text-sm font-semibold text-sand-950">Staff Account Management (Admin Scope)</h2>
              <p className="text-[11px] text-sand-500">
                Provision internal staff accounts. Zero external email dependency: temporary credentials displayed directly to operator.
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200">
              Admin Exclusive
            </span>
          </div>

          {/* Provision Form */}
          <form onSubmit={handleProvisionStaff} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Full Name</label>
              <input
                type="text"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="Staff Member Name"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Email Address</label>
              <input
                type="email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="staff@fundhorizon.com"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Mobile (10 Digits)</label>
              <input
                type="text"
                value={staffMobile}
                onChange={(e) => setStaffMobile(e.target.value)}
                placeholder="9876543210"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Role Permission</label>
              <div className="flex gap-2">
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
                >
                  <option value="analyst">Analyst</option>
                  <option value="rm">Relationship Manager (RM)</option>
                  <option value="operations">Operations</option>
                  <option value="read_only">Read Only</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="px-3.5 py-1.5 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 disabled:opacity-50 transition-colors shrink-0"
                >
                  {savingStaff ? "Adding…" : "+ Provision"}
                </button>
              </div>
            </div>
          </form>

          {/* Provisioned credentials alert */}
          {provisionedCredentials && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
              <div className="text-xs font-semibold text-emerald-800">
                Staff Account Provisioned Successfully
              </div>
              <p className="text-xs text-emerald-700 font-sans">
                Copy these temporary credentials and securely share them with the staff member:
              </p>
              <div className="p-2.5 bg-white rounded-lg border border-emerald-200 font-mono text-xs text-sand-900 select-all">
                Email: <span className="font-semibold">{provisionedCredentials.email}</span> • Temporary Password: <span className="font-semibold">{provisionedCredentials.temp_pass}</span>
              </div>
            </div>
          )}

          {/* Staff directory table */}
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left text-xs">
              <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
                <tr>
                  <th className="py-2 px-3 font-medium">Name</th>
                  <th className="py-2 px-3 font-medium">Email</th>
                  <th className="py-2 px-3 font-medium">Role</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Staff Marker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
                {staffList.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 px-3 font-semibold text-sand-900 font-sans">{s.name}</td>
                    <td className="py-2.5 px-3 text-sand-700">{s.email}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-sand-100 text-sand-700">
                        {s.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-emerald-700">{s.status || "active"}</td>
                    <td className="py-2.5 px-3 text-sand-500 font-sans text-[11px]">
                      {s.is_staff ? "Yes (Staff)" : "Customer"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Watchlist Management */}
      <div className="bg-white rounded-2xl border border-sand-200 shadow-2xs p-5 space-y-4">
        <div className="pb-3 border-b border-sand-100">
          <h2 className="text-sm font-semibold text-sand-950">Active Watchlists</h2>
          <p className="text-[11px] text-sand-500">
            Target instruments, strategies, or macro indicators pinned across research desks
          </p>
        </div>

        <form onSubmit={handleAddWatchlist} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-sand-700 block mb-1">Watchlist Group</label>
            <input
              type="text"
              value={wlName}
              onChange={(e) => setWlName(e.target.value)}
              placeholder="e.g. Core Equity or Midcap Focus"
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-sand-700 block mb-1">Item Category</label>
            <select
              value={wlType}
              onChange={(e) => setWlType(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
            >
              <option value="scheme">Mutual Fund Scheme</option>
              <option value="strategy">PMS Strategy</option>
              <option value="issuer">Micro Issuer</option>
              <option value="macro">Macro Series</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-sand-700 block mb-1">Target Identifier</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={wlId}
                onChange={(e) => setWlId(e.target.value)}
                placeholder="e.g. 119551 or IN10Y"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-mono"
                required
              />
              <button
                type="submit"
                disabled={savingWl}
                className="px-4 py-1.5 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 disabled:opacity-50 transition-colors shrink-0"
              >
                {savingWl ? "Adding…" : "+ Pin Item"}
              </button>
            </div>
          </div>
        </form>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left text-xs">
            <thead className="bg-sand-50 text-sand-600 font-mono border-y border-sand-200">
              <tr>
                <th className="py-2 px-3 font-medium">Watchlist Name</th>
                <th className="py-2 px-3 font-medium">Type</th>
                <th className="py-2 px-3 font-medium">Target Identifier</th>
                <th className="py-2 px-3 font-medium">Scope</th>
                <th className="py-2 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100 font-mono tabular-nums">
              {watchlists.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sand-500 font-sans">
                    No active watchlists pinned. Add items above to pin them to the overview dashboard.
                  </td>
                </tr>
              ) : (
                watchlists.map((w) => (
                  <tr key={w.id} className="hover:bg-sand-50/60">
                    <td className="py-2.5 px-3 font-semibold text-sand-900 font-sans">{w.name}</td>
                    <td className="py-2.5 px-3 uppercase text-[10px] text-sand-600">{w.item_type}</td>
                    <td className="py-2.5 px-3 font-bold text-forest-800">{w.item_id}</td>
                    <td className="py-2.5 px-3 text-sand-500 font-sans">{w.scope || "shared"}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleDeleteWatchlist(w.id)}
                        className="text-rose-600 hover:text-rose-800 font-medium text-[11px]"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
