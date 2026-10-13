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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Settings, Watchlists &amp; Staff Administration
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Terminal Configuration
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Role-based permissions (RBAC), operator account lifecycle, and custom asset watchlists
          </p>
        </div>
      </div>

      {/* Admin-only Staff Provisioning */}
      {isAdmin && (
        <div className="terminal-panel p-3.5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
            <div>
              <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                Staff Account Management (Admin Scope)
              </div>
              <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                Provision internal operator credentials with role-based permissions
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] px-1.5 py-0.5 rounded font-medium">
              Admin Exclusive
            </span>
          </div>

          {/* Provision Form */}
          <form onSubmit={handleProvisionStaff} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Full Name</label>
              <input
                type="text"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="Staff Member Name"
                className="terminal-input w-full text-[12px] py-1 px-2"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Email Address</label>
              <input
                type="email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="staff@fundhorizon.com"
                className="terminal-input w-full text-[12px] py-1 px-2"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Mobile (10 Digits)</label>
              <input
                type="text"
                value={staffMobile}
                onChange={(e) => setStaffMobile(e.target.value)}
                placeholder="9876543210"
                className="terminal-input w-full text-[12px] py-1 px-2"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Role Permission</label>
              <div className="flex gap-2">
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value)}
                  className="terminal-input w-full text-[12px] py-1 px-2"
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
                  className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium shrink-0"
                >
                  {savingStaff ? "Adding…" : "+ Provision"}
                </button>
              </div>
            </div>
          </form>

          {/* Provisioned credentials alert */}
          {provisionedCredentials && (
            <div className="terminal-panel p-2.5 border border-[#087744]/30 bg-[#087744]/5 text-[#087744] dark:text-[#58D6A0] text-[12px] space-y-1">
              <div className="font-semibold">
                Staff Account Provisioned Successfully
              </div>
              <p className="text-[11px]">
                Copy these temporary credentials and securely share them with the staff member:
              </p>
              <div className="p-2 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#087744]/30 rounded font-mono text-[12px] text-[#172033] dark:text-[#EDF2F7] select-all">
                Email: <span className="font-medium">{provisionedCredentials.email}</span> • Temporary Password: <span className="font-medium">{provisionedCredentials.temp_pass}</span>
              </div>
            </div>
          )}

          {/* Staff directory table */}
          <div className="terminal-panel overflow-hidden mt-3">
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[30%]">Staff Member</th>
                  <th className="w-[30%]">Email</th>
                  <th className="w-[20%]">Role</th>
                  <th className="w-[20%]">Status</th>
                </tr>
              </thead>
              <tbody>
                {staffList.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{s.name}</td>
                    <td className="font-mono text-[12px] text-[#536176] dark:text-[#A8B4C4]">{s.email}</td>
                    <td>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#006F64] dark:text-[#75E1CE] font-medium">
                        {s.role}
                      </span>
                    </td>
                    <td className="text-[12px] text-[#087744] dark:text-[#58D6A0] font-medium">{s.status || "active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Watchlist Manager */}
      <div className="terminal-panel p-3.5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
          <div>
            <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7]">
              Watchlist Items ({watchlists.length})
            </div>
            <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
              Monitored mutual fund schemes, issuers, and PMS strategies
            </div>
          </div>
        </div>

        {/* Add Watchlist Form */}
        <form onSubmit={handleAddWatchlist} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div>
            <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Watchlist Group</label>
            <input
              type="text"
              value={wlName}
              onChange={(e) => setWlName(e.target.value)}
              placeholder="e.g. Core Equity"
              className="terminal-input w-full text-[12px] py-1 px-2"
              required
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Item Type</label>
            <select
              value={wlType}
              onChange={(e) => setWlType(e.target.value)}
              className="terminal-input w-full text-[12px] py-1 px-2"
            >
              <option value="scheme">Mutual Fund Scheme</option>
              <option value="issuer">Micro Issuer / Stock</option>
              <option value="strategy">PMS Strategy</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Identifier</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={wlId}
                onChange={(e) => setWlId(e.target.value)}
                placeholder="Scheme Code or Symbol"
                className="terminal-input w-full text-[12px] py-1 px-2 font-mono"
                required
              />
              <button
                type="submit"
                disabled={savingWl}
                className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium shrink-0"
              >
                {savingWl ? "Adding…" : "+ Add"}
              </button>
            </div>
          </div>
        </form>

        {/* Watchlist Table */}
        <div className="terminal-panel overflow-hidden mt-3">
          <table className="terminal-table">
            <thead>
              <tr>
                <th className="w-[30%]">Group Name</th>
                <th className="w-[30%]">Item Type</th>
                <th className="w-[25%]">Identifier</th>
                <th className="w-[15%] text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {watchlists.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-[#536176] dark:text-[#A8B4C4]">
                    No watchlists configured. Add an item above to track.
                  </td>
                </tr>
              ) : (
                watchlists.map((w) => (
                  <tr key={w.id}>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{w.name}</td>
                    <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{w.item_type}</td>
                    <td className="font-mono text-[12px] text-[#006F64] dark:text-[#75E1CE] font-medium">{w.item_id}</td>
                    <td className="text-right">
                      <button
                        onClick={() => handleDeleteWatchlist(w.id)}
                        className="text-[11px] text-[#B42332] dark:text-[#FF7D86] hover:underline"
                      >
                        Remove
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
