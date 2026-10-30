"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthContext";
import StaffDrawer, { accessSummary } from "@/components/backoffice/StaffDrawer";
import {
  PAGE_GROUPS,
  avatarTone,
  hasAllPages,
  initialsOf,
  roleLabel,
} from "@/components/backoffice/staffGroups";
import {
  listStaffMembers,
  updateStaffMember,
  type StaffMemberItem,
} from "@/lib/backoffice";
import DropdownClose from "@/components/DropdownClose";

const mutedCls = "text-[#706E6B] dark:text-[#A8B4C4]";

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-[#181818]"
      style={{ backgroundColor: avatarTone(name) }}
    >
      {initialsOf(name)}
    </span>
  );
}

function DetailPanel({ member, onClose, onReset }: { member: StaffMemberItem; onClose: () => void; onReset: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="staff-detail-title" className="w-full max-w-lg rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={member.name} />
            <div>
              <h2 id="staff-detail-title" className="text-[16px] font-semibold text-[#181818] dark:text-[#EDF2F7]">
                {member.name}
              </h2>
              <p className={`text-[12px] ${mutedCls}`}>{roleLabel(member.role)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[16px] text-[#706E6B] hover:bg-[#F3F3F3] dark:hover:bg-[#171E27]">
            ✕
          </button>
        </div>
        <dl className="mt-4 space-y-2 text-[13px] text-[#181818] dark:text-[#EDF2F7]">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-semibold">User ID</dt>
            <dd className="break-all font-semibold select-all">{member.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-semibold">Password</dt>
            <dd>
              Stored encrypted, cannot be viewed.{" "}
              <button type="button" onClick={onReset} className="text-[#0176D3] dark:text-[#1B96FF] hover:underline">
                Reset password
              </button>
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-semibold">Mobile</dt>
            <dd>{member.mobile || "Not given"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-semibold">Status</dt>
            <dd>{member.status === "inactive" ? "Inactive" : "Active"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 font-semibold">Page access</dt>
            <dd>
              {hasAllPages(member.role, member.pages) ? (
                "All pages"
              ) : (
                <span className="space-y-1">
                  {PAGE_GROUPS.filter((g) => g.pages.some((p) => (member.pages ?? []).includes(p.href))).map((g) => (
                    <span key={g.key} className="block">
                      <span className="font-semibold">{g.label}: </span>
                      {g.pages.filter((p) => (member.pages ?? []).includes(p.href)).map((p) => p.label).join(", ")}
                    </span>
                  ))}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="terminal-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dedicated Staff & permissions page (admin-only). The list is always the live API response — never hardcoded. */
export default function StaffPermissionsPage() {
  const { customer, loading } = useAuth();
  const isAdmin = customer?.role === "admin";
  const [list, setList] = useState<StaffMemberItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drawer, setDrawer] = useState<{ mode: "create" | "edit"; member?: StaffMemberItem } | null>(null);
  const [detail, setDetail] = useState<StaffMemberItem | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoadingList(true);
    setLoadError(null);
    try {
      setList(await listStaffMembers());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load staff members.");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    if (!loading && isAdmin) load();
    else if (!loading) setLoadingList(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isAdmin]);

  // 'click' (not mousedown): the Manage button's own click toggles first while
  // bubbling, so a mousedown closer would reopen the menu it just closed.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const rolesPresent = useMemo(() => {
    const seen = new Map<string, string>();
    list.forEach((m) => seen.set(m.role, roleLabel(m.role)));
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((m) => {
      if (q && !`${m.name} ${m.email}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (statusFilter !== "all" && (m.status ?? "active") !== statusFilter) return false;
      return true;
    });
  }, [list, search, roleFilter, statusFilter]);

  async function act(member: StaffMemberItem, body: Parameters<typeof updateStaffMember>[1], confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(member.id);
    setActionError(null);
    try {
      const r = await updateStaffMember(member.id, body);
      if (r.temporary_password) {
        setNotice(`New temporary password for ${member.name}: ${r.temporary_password} (shown once, share securely)`);
      } else {
        setNotice("Updated.");
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
      setOpenMenu(null);
    }
  }

  if (loading) {
    return <p className={`p-4 text-[13px] ${mutedCls}`}>Loading…</p>;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div className="pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
          <div className={`text-[11px] ${mutedCls} mb-1`}>
            <Link href="/backoffice/settings" className="hover:underline">Settings</Link>
            {" / "}Staff &amp; permissions
          </div>
          <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">Staff &amp; permissions</h1>
          <p className={`text-[12px] ${mutedCls} mt-0.5`}>Manage your team and their access.</p>
        </div>
        <p className="terminal-panel p-4 text-[13px] text-[#181818] dark:text-[#EDF2F7]">
          This page is for administrators. Ask an admin to change team access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div>
          <div className={`text-[11px] ${mutedCls} mb-1`}>
            <Link href="/backoffice/settings" className="hover:underline">Settings</Link>
            {" / "}Staff &amp; permissions
          </div>
          <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">Staff &amp; permissions</h1>
          <p className={`text-[12px] ${mutedCls} mt-0.5`}>Manage your team and their access.</p>
        </div>
        <button type="button" onClick={() => setDrawer({ mode: "create" })} className="terminal-btn-accent">
          + Add staff
        </button>
      </div>

      {notice && (
        <div role="status" className="rounded border border-[#C5DDF7] bg-[#EAF5FE] dark:border-[#1F4A74] dark:bg-[#0F2A45] px-3 py-2 text-[13px] text-[#181818] dark:text-[#EDF2F7] break-all">
          {notice}{" "}
          <button type="button" onClick={() => setNotice(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="text-[13px] font-medium text-rose-700 dark:text-rose-300">
          {actionError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#706E6B]">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff"
            autoComplete="off"
            aria-label="Search staff"
            className="terminal-input pl-8"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role" className="terminal-input">
          <option value="all">All roles</option>
          {rolesPresent.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className="terminal-input">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <p className={`text-[13px] ${mutedCls}`}>
        {loadingList ? "Loading staff…" : `${filtered.length} staff member${filtered.length === 1 ? "" : "s"}`}
      </p>

      {loadError ? (
        <p role="alert" className="text-[13px] font-medium text-rose-700 dark:text-rose-300">
          {loadError}
        </p>
      ) : (
        <div className="terminal-panel overflow-x-auto">
          <table className="terminal-table min-w-[720px]">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role</th>
                <th>Page access</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const inactive = m.status === "inactive";
                return (
                  <tr key={m.id}>
                    <td>
                      <button type="button" onClick={() => setDetail(m)} className="flex items-center gap-2.5 text-left">
                        <Avatar name={m.name} />
                        <span className="font-medium text-[#0176D3] dark:text-[#1B96FF] hover:underline">{m.name}</span>
                      </button>
                      <span className={`block pl-[46px] text-[11px] ${mutedCls} break-all`}>{m.email}</span>
                    </td>
                    <td>{roleLabel(m.role)}</td>
                    <td title={accessSummary(m)} className="max-w-[320px] truncate">
                      {accessSummary(m)}
                    </td>
                    <td className="whitespace-nowrap">
                      <span aria-hidden className={`mr-1.5 inline-block h-2 w-2 rounded-full ${inactive ? "bg-[#9AA6B8]" : "bg-[#1A9E32]"}`} />
                      {inactive ? "Inactive" : "Active"}
                    </td>
                    <td className="text-right">
                      <div className="relative inline-block" ref={openMenu === m.id ? menuRef : undefined}>
                        <button
                          type="button"
                          aria-haspopup="true"
                          aria-expanded={openMenu === m.id}
                          onClick={() => setOpenMenu((cur) => (cur === m.id ? null : m.id))}
                          className="terminal-btn"
                        >
                          Manage ▾
                        </button>
                        {openMenu === m.id && (
                          <div role="menu" className="absolute right-0 top-9 z-20 w-48 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-1 text-left shadow-xl">
                            <DropdownClose onClose={() => setOpenMenu(null)} />
                            <button type="button" role="menuitem" onClick={() => { setDetail(m); setOpenMenu(null); }} className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-[#F3F3F3] dark:hover:bg-[#10151C]">
                              View details
                            </button>
                            <button type="button" role="menuitem" onClick={() => { setDrawer({ mode: "edit", member: m }); setOpenMenu(null); }} className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-[#F3F3F3] dark:hover:bg-[#10151C]">
                              Edit access
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={busyId === m.id}
                              onClick={() =>
                                act(
                                  m,
                                  { status: inactive ? "active" : "inactive" },
                                  inactive ? undefined : `Deactivate ${m.name}? They will be signed out.`,
                                )
                              }
                              className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-[#F3F3F3] dark:hover:bg-[#10151C] disabled:opacity-50"
                            >
                              {inactive ? "Activate" : "Deactivate"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={busyId === m.id}
                              onClick={() => act(m, { reset_password: true }, `Reset password for ${m.name}? They will be signed out.`)}
                              className="block w-full rounded px-3 py-2 text-left text-[13px] hover:bg-[#F3F3F3] dark:hover:bg-[#10151C] disabled:opacity-50"
                            >
                              Reset password
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loadingList && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center">
                    {list.length === 0 ? (
                      <span>
                        No staff members yet.{" "}
                        <button type="button" onClick={() => setDrawer({ mode: "create" })} className="text-[#0176D3] dark:text-[#1B96FF] hover:underline">
                          Add staff
                        </button>
                      </span>
                    ) : (
                      <span>
                        No staff members match those filters.{" "}
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("");
                            setRoleFilter("all");
                            setStatusFilter("all");
                          }}
                          className="text-[#0176D3] dark:text-[#1B96FF] hover:underline"
                        >
                          Clear filters
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className={`flex items-center gap-1.5 text-[12px] ${mutedCls}`}>
        <span aria-hidden>ⓘ</span> Open a staff member to view contact details and access.
      </p>

      {detail && (
        <DetailPanel
          member={detail}
          onClose={() => setDetail(null)}
          onReset={async () => {
            await act(detail, { reset_password: true }, `Reset password for ${detail.name}? They will be signed out.`);
            setDetail(null);
          }}
        />
      )}
      {drawer && (
        <StaffDrawer
          mode={drawer.mode}
          member={drawer.member}
          onClose={() => setDrawer(null)}
          onDone={(msg) => {
            setNotice(msg);
            setDrawer(null);
            load();
          }}
        />
      )}
    </div>
  );
}
