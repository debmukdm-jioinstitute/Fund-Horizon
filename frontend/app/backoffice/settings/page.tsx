"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRecommended } from "@/lib/recommended";
import {
  getWatchlists,
  createWatchlist,
  deleteWatchlist,
  listStaffMembers,
  createStaffMember,
  updateStaffMember,
  WatchlistItem,
  StaffMemberItem,
} from "@/lib/backoffice";
import { useAuth } from "@/components/AuthContext";
import { NAV_ITEMS } from "@/components/backoffice/navItems";

const PAGE_OPTIONS = NAV_ITEMS.map((i) => ({ href: i.href.split("?")[0], label: i.label }));

function PagePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <button type="button" className="text-[12px] underline" onClick={() => onChange(value.length === PAGE_OPTIONS.length ? [] : PAGE_OPTIONS.map((o) => o.href))}>
        {value.length === PAGE_OPTIONS.length ? "Clear all" : "All pages"}
      </button>
      {PAGE_OPTIONS.map((o) => (
        <label key={o.href} className="flex items-center gap-1 text-[12px]">
          <input
            type="checkbox"
            checked={value.includes(o.href)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.href] : value.filter((h) => h !== o.href))}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function PageEditor({ current, onSave }: { current: string[]; onSave: (v: string[]) => void }) {
  const [sel, setSel] = useState(current);
  return (
    <div className="mt-1 space-y-1.5">
      <PagePicker value={sel} onChange={setSel} />
      <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" disabled={!sel.length} onClick={() => onSave(sel)}>
        Save pages
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";
  const [activeTab, setActiveTab] = useState<'lead'|'staff'|'recommended'|'watchlists'>('lead');

  // Watchlist state
  const [watchlists, setWatchlists] = useState<WatchlistItem[]>([]);
  const [wlName, setWlName] = useState("");
  const [wlType, setWlType] = useState("scheme");
  const [wlId, setWlId] = useState("");
  const [savingWl, setSavingWl] = useState(false);

  // FH Recommended management
  const rec = useRecommended();
  const [recKind, setRecKind] = useState<"mf" | "pms">("mf");
  const [recId, setRecId] = useState("");
  const [recName, setRecName] = useState("");
  const [savingRec, setSavingRec] = useState(false);
  const [recSuccess, setRecSuccess] = useState<string | null>(null);

  // QR Code & Lead Capture state
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [gameQr, setGameQr] = useState<string>("");
  const [gameUrl, setGameUrl] = useState<string>("https://fundhorizon.up.railway.app/crossword");
  const [copiedGame, setCopiedGame] = useState(false);
  const [leadUrl, setLeadUrl] = useState<string>("https://fundhorizon.up.railway.app/lead");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const url = `${window.location.origin}/lead`;
      setLeadUrl(url);
      const game = `${window.location.origin}/crossword`;
      setGameUrl(game);
      import("qrcode").then((QRCode) => {
        const opts = { width: 320, margin: 2, color: { dark: "#0176D3", light: "#FFFFFF" } };
        QRCode.toDataURL(url, opts).then(setQrDataUrl).catch(console.error);
        QRCode.toDataURL(game, opts).then(setGameQr).catch(console.error);
      });
    }
  }, []);

  const copyLeadUrl = () => {
    navigator.clipboard.writeText(leadUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const currentRecList = useMemo(() => {
    const map = recKind === "mf" ? rec.mfMap : rec.pmsMap;
    return Object.entries(map).map(([id, name]) => ({ id, name }));
  }, [recKind, rec.mfMap, rec.pmsMap]);

  async function handleAddRecommended(e: React.FormEvent) {
    e.preventDefault();
    if (!recId.trim()) return;
    try {
      setSavingRec(true);
      if (recKind === "mf") {
        await rec.addMf(recId.trim(), recName.trim() || undefined);
      } else {
        await rec.addPms(recId.trim(), recName.trim() || undefined);
      }
      setRecSuccess(`Added ${recId.trim()} to FH Recommended ${recKind === "mf" ? "Mutual Funds" : "PMS"}`);
      setRecId("");
      setRecName("");
      setTimeout(() => setRecSuccess(null), 3000);
    } catch {
      /* ignore */
    } finally {
      setSavingRec(false);
    }
  }

  async function handleRemoveRecommended(id: string) {
    try {
      if (recKind === "mf") {
        await rec.removeMf(id);
      } else {
        await rec.removePms(id);
      }
      setRecSuccess(`Removed ${id} from FH Recommended`);
      setTimeout(() => setRecSuccess(null), 3000);
    } catch {
      /* ignore */
    }
  }

  // Staff provisioning state (admin only)
  const [staffList, setStaffList] = useState<StaffMemberItem[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState("analyst");
  const [staffMobile, setStaffMobile] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [staffPages, setStaffPages] = useState<string[]>([]);
  const [staffNotice, setStaffNotice] = useState<string | null>(null);
  const [savingStaff, setSavingStaff] = useState(false);

  useEffect(() => {
    loadWatchlists();
    if (isAdmin) {
      loadStaff();
    }
  }, [isAdmin]);

  async function loadWatchlists() {
    try {
      const data = await getWatchlists();
      setWatchlists(data);
    } catch {
      /* fallback */
    }
  }

  async function loadStaff() {
    try {
      const data = await listStaffMembers();
      setStaffList(data);
    } catch {
      /* fallback */
    }
  }

  async function handleAddWatchlist(e: React.FormEvent) {
    e.preventDefault();
    if (!wlId.trim() || !wlName.trim()) return;
    try {
      setSavingWl(true);
      await createWatchlist({
        name: wlName.trim(),
        item_type: wlType,
        item_id: wlId.trim(),
      });
      setWlId("");
      await loadWatchlists();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to add watchlist item");
    } finally {
      setSavingWl(false);
    }
  }

  async function handleDeleteWatchlist(id: string | number) {
    try {
      await deleteWatchlist(String(id));
      await loadWatchlists();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to remove watchlist item");
    }
  }

  async function changeStaff(id: string, body: Parameters<typeof updateStaffMember>[1]) {
    try {
      const r = await updateStaffMember(id, body);
      setStaffNotice(r.temporary_password ? `New temporary password ${r.temporary_password} (shown once, share securely)` : "Updated.");
      await loadStaff();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function handleProvisionStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!staffEmail.trim() || !staffName.trim()) return;
    if (staffRole !== "admin" && !staffPages.length) {
      alert("Tick at least one allowed page.");
      return;
    }
    try {
      setSavingStaff(true);
      const res = await createStaffMember({
        name: staffName.trim(),
        email: staffEmail.trim(),
        role: staffRole,
        mobile: staffMobile.trim() || "",
        password: staffPassword || undefined,
        pages: staffPages,
      });
      setStaffNotice(
        res.temporary_password
          ? `Login ${staffEmail.trim().toLowerCase()} · temporary password ${res.temporary_password} (shown once, share securely)`
          : `Account created. Login ${staffEmail.trim().toLowerCase()} with the password you set.`,
      );
      setStaffPassword("");
      setStaffPages([]);
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

  const activeCls = "bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] font-medium";
  const inactiveCls = "text-[#706E6B] dark:text-[#A8B4C4] hover:bg-[#F3F3F3] dark:hover:bg-[#171E27]";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] mb-1">Backoffice / Settings</div>
        <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">Settings</h1>
        <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
          Manage lead capture, staff access and your research lists.
        </p>
      </div>

      {/* Layout: sidebar + content */}
      <div className="flex gap-6 items-start">
        {/* Sidebar */}
        <nav className="w-40 shrink-0 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("lead")}
            className={`w-full text-left px-3 py-2 rounded-full text-[13px] flex items-start gap-2 transition ${activeTab === "lead" ? activeCls : inactiveCls}`}
          >
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
            <span>Lead generation</span>
          </button>
          {isAdmin && (
          <button
            type="button"
            onClick={() => setActiveTab("staff")}
            className={`w-full text-left px-3 py-2 rounded-full text-[13px] flex items-start gap-2 transition ${activeTab === "staff" ? activeCls : inactiveCls}`}
          >
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="5" r="3"/><path d="M2 13c0-3 2-5 6-5s6 2 6 5"/></svg>
            <span>Staff &amp; permissions</span>
          </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab("recommended")}
            className={`w-full text-left px-3 py-2 rounded-full text-[13px] flex items-start gap-2 transition ${activeTab === "recommended" ? activeCls : inactiveCls}`}
          >
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="2" rx="1"/><rect x="2" y="6" width="8" height="2" rx="1"/><rect x="2" y="10" width="10" height="2" rx="1"/></svg>
            <div>
              <div>FH Recommended</div>
              <div className="text-[10px] opacity-70">{Object.keys(rec.mfMap).length} MF · {Object.keys(rec.pmsMap).length} PMS</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("watchlists")}
            className={`w-full text-left px-3 py-2 rounded-full text-[13px] flex items-start gap-2 transition ${activeTab === "watchlists" ? activeCls : inactiveCls}`}
          >
            <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h10a1 1 0 011 1v11l-5-3-5 3V3a1 1 0 011-1z"/></svg>
            <div>
              <div>Watchlists</div>
              <div className="text-[10px] opacity-70">{watchlists.length}</div>
            </div>
          </button>
        </nav>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">

      {activeTab === "lead" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[18px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Lead generation</h2>
              <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">Two ways to bring new enquiries into your CRM.</p>
            </div>
            <Link
              href="/backoffice/crm?tab=leads"
              className="px-3 py-1.5 rounded-lg border border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F] text-[12px] font-medium flex items-center gap-1 transition"
            >
              View CRM ↗
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card 1: Client intake */}
            <div className="bg-white dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Client intake</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] border border-[#C5DDF7] dark:border-[#1F4A74]">CRM sync</span>
                  </div>
                  <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Collect contact details and investment interests.</p>
                </div>
              </div>

              {/* QR Preview box with corner viewfinder brackets */}
              <div className="flex flex-col items-center justify-center py-2">
                <div className="relative w-32 h-32 flex items-center justify-center p-3">
                  <span className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
                  <span className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />
                  <span className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />

                  {qrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrDataUrl} alt="Client intake QR" className="w-full h-full object-contain" />
                  ) : (
                    <div className="grid grid-cols-2 gap-2 text-[#94A3B8]">
                      <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                      <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                      <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                      <div className="w-4 h-4 flex flex-wrap gap-1 p-0.5"><div className="w-1 h-1 bg-current" /><div className="w-1 h-1 bg-current" /></div>
                    </div>
                  )}
                </div>

                <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mt-2">QR preview</div>
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Use original QR when implementing</div>

                <div className="flex items-center gap-3 mt-3">
                  <a
                    href={qrDataUrl || "#"}
                    download="fund-horizon-intake-qr.png"
                    className="px-3 py-1.5 rounded-lg border border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F] text-[12px] font-medium flex items-center gap-1.5 transition"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download QR
                  </a>
                  <Link
                    href="/lead"
                    target="_blank"
                    className="text-[12px] text-[#0176D3] dark:text-[#1B96FF] hover:underline font-medium flex items-center gap-1"
                  >
                    Test form ↗
                  </Link>
                </div>
              </div>

              {/* URL bar */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F8FAFC] dark:bg-[#111722] border border-[#E2E8F0] dark:border-[#2B3644] text-[12px]">
                <div className="flex items-center gap-2 text-[#536176] dark:text-[#A8B4C4] font-mono truncate">
                  <svg className="w-4 h-4 shrink-0 text-[#706E6B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="truncate">fundhorizon.website/lead</span>
                </div>
                <button
                  type="button"
                  onClick={copyLeadUrl}
                  title="Copy link"
                  className="p-1 text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#0176D3] dark:hover:text-[#1B96FF] transition shrink-0"
                >
                  {copiedLink ? (
                    <svg className="w-4 h-4 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="8" y="8" width="12" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Information collected */}
              <div className="pt-2">
                <div className="text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7] mb-2.5">Information collected</div>
                <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span>Full name</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <span>Mobile number</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Email address</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="12 6 12 12 16 14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Investment interest</span>
                  </div>
                </div>
              </div>

              {/* Flow diagram */}
              <div className="pt-4 border-t border-[#E5E5E5] dark:border-[#2B3644]">
                <div className="flex flex-col items-center">
                  <div className="px-3 py-1 rounded-full text-[11px] font-semibold text-[#0176D3] dark:text-[#1B96FF] bg-[#EAF5FE] dark:bg-[#11304F] border border-[#C5DDF7] dark:border-[#1F4A74]">
                    Client intake
                  </div>
                  <div className="w-full max-w-[280px] flex flex-col items-center">
                    <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    <div className="w-[180px] border-t border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    <div className="w-[180px] flex justify-between">
                      <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                      <div className="w-px h-2.5 border-r border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-3 w-full">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-dashed border-[#0176D3] dark:border-[#1B96FF] bg-white dark:bg-[#10151C] text-[11px] text-[#181818] dark:text-[#EDF2F7]">
                      <svg className="w-3 h-3 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Contact details
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-dashed border-[#0176D3] dark:border-[#1B96FF] bg-white dark:bg-[#10151C] text-[11px] text-[#181818] dark:text-[#EDF2F7]">
                      <svg className="w-3 h-3 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Investment interest
                    </div>
                  </div>
                  <div className="w-full max-w-[280px] flex flex-col items-center">
                    <div className="w-[180px] flex justify-between">
                      <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                      <div className="w-px h-2.5 border-r border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    </div>
                    <div className="w-[180px] border-b border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-[#EAF5FE] dark:bg-[#11304F] border border-[#0176D3] dark:border-[#1B96FF] text-[#0176D3] dark:text-[#1B96FF]">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                    CRM lead • New
                  </div>
                  <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] mt-1">Source: qr_code</span>
                </div>
              </div>
            </div>

            {/* Card 2: Cross₹word */}
            <div className="bg-white dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="2" y="6" width="20" height="12" rx="6" />
                    <circle cx="8" cy="12" r="1.5" />
                    <circle cx="16" cy="12" r="1.5" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-[#181818] dark:text-[#EDF2F7]">Cross₹word</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] border border-[#C5DDF7] dark:border-[#1F4A74]">Lead magnet</span>
                  </div>
                  <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">A 2-minute financial word-search game.</p>
                </div>
              </div>

              {/* QR Preview box with corner viewfinder brackets */}
              <div className="flex flex-col items-center justify-center py-2">
                <div className="relative w-32 h-32 flex items-center justify-center p-3">
                  <span className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
                  <span className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />
                  <span className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-[#94A3B8] dark:border-[#64748B]" />
                  <span className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-[#94A3B8] dark:border-[#64748B]" />

                  {gameQr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={gameQr} alt="Crossword game QR" className="w-full h-full object-contain" />
                  ) : (
                    <div className="grid grid-cols-2 gap-2 text-[#94A3B8]">
                      <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                      <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                      <div className="w-4 h-4 border-2 border-current rounded-sm flex items-center justify-center"><div className="w-1.5 h-1.5 bg-current" /></div>
                      <div className="w-4 h-4 flex flex-wrap gap-1 p-0.5"><div className="w-1 h-1 bg-current" /><div className="w-1 h-1 bg-current" /></div>
                    </div>
                  )}
                </div>

                <div className="text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] mt-2">QR preview</div>
                <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Use original QR when implementing</div>

                <div className="flex items-center gap-3 mt-3">
                  <a
                    href={gameQr || "#"}
                    download="fund-horizon-crossword-qr.png"
                    className="px-3 py-1.5 rounded-lg border border-[#0176D3] text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F] text-[12px] font-medium flex items-center gap-1.5 transition"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download QR
                  </a>
                  <Link
                    href="/crossword"
                    target="_blank"
                    className="text-[12px] text-[#0176D3] dark:text-[#1B96FF] hover:underline font-medium flex items-center gap-1"
                  >
                    Test game ↗
                  </Link>
                </div>
              </div>

              {/* URL bar */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F8FAFC] dark:bg-[#111722] border border-[#E2E8F0] dark:border-[#2B3644] text-[12px]">
                <div className="flex items-center gap-2 text-[#536176] dark:text-[#A8B4C4] font-mono truncate">
                  <svg className="w-4 h-4 shrink-0 text-[#706E6B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="truncate">fundhorizon.website/crossword</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(gameUrl);
                    setCopiedGame(true);
                    setTimeout(() => setCopiedGame(false), 2000);
                  }}
                  title="Copy link"
                  className="p-1 text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#0176D3] dark:hover:text-[#1B96FF] transition shrink-0"
                >
                  {copiedGame ? (
                    <svg className="w-4 h-4 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="8" y="8" width="12" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Game experience */}
              <div className="pt-2">
                <div className="text-[12px] font-semibold text-[#181818] dark:text-[#EDF2F7] mb-2.5">Game experience</div>
                <div className="space-y-2.5 text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="8" y1="6" x2="21" y2="6" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="8" y1="12" x2="21" y2="12" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="8" y1="18" x2="21" y2="18" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="4" cy="6" r="1.5" fill="currentColor" />
                      <circle cx="4" cy="12" r="1.5" fill="currentColor" />
                      <circle cx="4" cy="18" r="1.5" fill="currentColor" />
                    </svg>
                    <span>Random game from 20 puzzles</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                      <polyline points="21 15 16 10 5 21" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Screenshot token on completion</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="20" x2="18" y2="10" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="12" y1="20" x2="12" y2="4" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="6" y1="20" x2="6" y2="14" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Words-correct score saved to CRM</span>
                  </div>
                </div>
              </div>

              {/* Flow diagram */}
              <div className="pt-4 border-t border-[#E5E5E5] dark:border-[#2B3644]">
                <div className="flex flex-col items-center">
                  <div className="px-3 py-1 rounded-full text-[11px] font-semibold text-[#0176D3] dark:text-[#1B96FF] bg-[#EAF5FE] dark:bg-[#11304F] border border-[#C5DDF7] dark:border-[#1F4A74]">
                    Cross₹word
                  </div>
                  <div className="w-full max-w-[280px] flex flex-col items-center">
                    <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    <div className="w-[180px] border-t border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    <div className="w-[180px] flex justify-between">
                      <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                      <div className="w-px h-2.5 border-r border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-3 w-full">
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-dashed border-[#0176D3] dark:border-[#1B96FF] bg-white dark:bg-[#10151C] text-[11px] text-[#181818] dark:text-[#EDF2F7]">
                      <svg className="w-3 h-3 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Player details
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-dashed border-[#0176D3] dark:border-[#1B96FF] bg-white dark:bg-[#10151C] text-[11px] text-[#181818] dark:text-[#EDF2F7]">
                      <svg className="w-3 h-3 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="20" x2="18" y2="10" />
                        <line x1="12" y1="20" x2="12" y2="4" />
                        <line x1="6" y1="20" x2="6" y2="14" />
                      </svg>
                      Game score
                    </div>
                  </div>
                  <div className="w-full max-w-[280px] flex flex-col items-center">
                    <div className="w-[180px] flex justify-between">
                      <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                      <div className="w-px h-2.5 border-r border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    </div>
                    <div className="w-[180px] border-b border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                    <div className="w-px h-2.5 border-l border-dashed border-[#0176D3] dark:border-[#1B96FF]" />
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-[#EAF5FE] dark:bg-[#11304F] border border-[#0176D3] dark:border-[#1B96FF] text-[#0176D3] dark:text-[#1B96FF]">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                    CRM lead
                  </div>
                  <span className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4] mt-1">Source: crossword</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tip Banner */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[#EBF6FE] dark:bg-[#112438] border border-[#C5DDF7] dark:border-[#1F4A74] text-[12px] text-[#0176D3] dark:text-[#1B96FF]">
            <span className="text-[14px]">💡</span>
            <span>Place QR codes on reception desks, brochures or presentation slides.</span>
          </div>
        </div>
      )}

      {/* Admin-only Staff Provisioning */}
      {activeTab === "staff" && isAdmin && (
        <div className="terminal-panel p-3.5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5] dark:border-[#2B3644]">
            <div>
              <div className="text-[13px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                Staff Account Management (Admin Scope)
              </div>
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                Provision internal operator credentials with role-based permissions
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] px-1.5 py-0.5 rounded font-medium">
              Admin Exclusive
            </span>
          </div>

          {staffNotice && (
            <div className="rounded border border-[#C5DDF7] bg-[#EAF5FE] p-2 text-[12px] font-mono break-all dark:border-[#1F4A74] dark:bg-[#0F2A45]/40">
              {staffNotice} <button type="button" className="ml-2 underline" onClick={() => setStaffNotice(null)}>dismiss</button>
            </div>
          )}

          {/* Provision Form */}
          <form onSubmit={handleProvisionStaff} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Full Name</label>
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
              <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Email / Username</label>
              <input
                type="text"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="staff@fundhorizon.com or username"
                className="terminal-input w-full text-[12px] py-1 px-2"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Password (blank = generate)</label>
              <input
                type="password"
                autoComplete="new-password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                placeholder="blank = generate"
                className="terminal-input w-full text-[12px] py-1 px-2"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Assigned Role</label>
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value)}
                className="terminal-input w-full text-[12px] py-1 px-2"
              >
                <option value="analyst">Analyst (Research &amp; Terminal)</option>
                <option value="rm">Relationship Manager (Client Portfolios)</option>
                <option value="operations">Operations (Data Management)</option>
                <option value="compliance">Compliance (Audit &amp; Oversight)</option>
                <option value="read_only">Read-only (Academy / viewing)</option>
                <option value="admin">System Administrator</option>
              </select>
            </div>
            <div className="sm:col-span-4">
              <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
                Allowed pages (required; ignored for System Administrator)
              </label>
              <PagePicker value={staffPages} onChange={setStaffPages} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Mobile</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={staffMobile}
                  onChange={(e) => setStaffMobile(e.target.value)}
                  placeholder="9876543210"
                  className="terminal-input w-full text-[12px] py-1 px-2"
                />
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="terminal-btn text-[12px] py-1 px-3 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium shrink-0"
                >
                  {savingStaff ? "Saving…" : "Provision"}
                </button>
              </div>
            </div>
          </form>

          {/* Staff Table */}
          <div className="terminal-panel overflow-hidden mt-3">
            <table className="terminal-table">
              <thead>
                <tr>
                  <th className="w-[30%]">Staff Member</th>
                  <th className="w-[25%]">Role</th>
                  <th className="w-[25%]">Contact</th>
                  <th className="w-[20%] text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {staffList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                      No additional staff members provisioned yet.
                    </td>
                  </tr>
                ) : (
                  staffList.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium text-[#181818] dark:text-[#EDF2F7]">
                        {s.name}
                        <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-normal">{s.email}</div>
                        {s.role !== "admin" && (
                          <details className="text-[11px] font-normal">
                            <summary className="cursor-pointer text-[#0176D3] dark:text-[#1B96FF]">
                              Pages: {s.pages?.length ? s.pages.map((h) => PAGE_OPTIONS.find((o) => o.href === h)?.label ?? h).join(", ") : "all"}
                            </summary>
                            <PageEditor current={s.pages ?? []} onSave={(v) => changeStaff(s.id, { pages: v })} />
                          </details>
                        )}
                      </td>
                      <td>
                        <span className="font-mono uppercase text-[10px] px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644]">
                          {s.role}
                        </span>
                      </td>
                      <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{s.mobile || "–"}</td>
                      <td className="text-right whitespace-nowrap">
                        <span className="text-[11px] text-[#0176D3] dark:text-[#1B96FF] font-medium mr-2">{s.status}</span>
                        <button type="button" className="terminal-btn text-[11px] py-0.5 px-2 mr-1" onClick={() => changeStaff(s.id, { status: s.status === "inactive" ? "active" : "inactive" })}>
                          {s.status === "inactive" ? "Activate" : "Deactivate"}
                        </button>
                        <button type="button" className="terminal-btn text-[11px] py-0.5 px-2" onClick={() => confirm(`Reset password for ${s.name}? They will be signed out.`) && changeStaff(s.id, { reset_password: true })}>
                          Reset password
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* FH Recommended Picks Manager */}
      {activeTab === "recommended" && <div className="terminal-panel p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#E5E5E5] dark:border-[#2B3644]">
          <div>
            <div className="text-[13px] font-medium text-[#181818] dark:text-[#EDF2F7] flex items-center gap-1.5">
              <span>★</span>
              <span>FH Recommended Picks ({currentRecList.length} {recKind === "mf" ? "Funds" : "Strategies"})</span>
            </div>
            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
              Curated shortlist of top-performing Mutual Funds and PMS strategies highlighted across the terminal
            </div>
          </div>

          {/* Toggle MF vs PMS */}
          <div className="inline-flex rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] p-0.5 bg-[#F3F3F3] dark:bg-[#111722]">
            <button
              type="button"
              onClick={() => setRecKind("mf")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition ${
                recKind === "mf"
                  ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] shadow-sm"
                  : "text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
              }`}
            >
              Mutual Funds ({Object.keys(rec.mfMap).length})
            </button>
            <button
              type="button"
              onClick={() => setRecKind("pms")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition ${
                recKind === "pms"
                  ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] shadow-sm"
                  : "text-[#706E6B] dark:text-[#A8B4C4] hover:text-[#181818] dark:hover:text-[#EDF2F7]"
              }`}
            >
              PMS Strategies ({Object.keys(rec.pmsMap).length})
            </button>
          </div>
        </div>

        {recSuccess && (
          <div className="text-[11px] p-2 rounded bg-[#EAF5FE] dark:bg-[#10372A] text-[#0176D3] dark:text-[#7FE0B5] border border-[#C5DDF7] dark:border-[#1F4A74]">
            {recSuccess}
          </div>
        )}

        {/* Add Recommended Form */}
        <form onSubmit={handleAddRecommended} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
              {recKind === "mf" ? "AMFI Scheme Code" : "APMI Strategy ID"}
            </label>
            <input
              type="text"
              value={recId}
              onChange={(e) => setRecId(e.target.value)}
              placeholder={recKind === "mf" ? "e.g. 108466" : "e.g. 174"}
              className="terminal-input w-full text-[12px] py-1 px-2 font-mono"
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
              {recKind === "mf" ? "Fund / Scheme Name" : "PMS Strategy Name"}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={recName}
                onChange={(e) => setRecName(e.target.value)}
                placeholder={recKind === "mf" ? "e.g. ICICI Prudential Large Cap Fund" : "e.g. Stallion Asset Core Fund"}
                className="terminal-input w-full text-[12px] py-1 px-2"
              />
              <button
                type="submit"
                disabled={savingRec}
                className="terminal-btn text-[12px] py-1 px-3 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium shrink-0"
              >
                {savingRec ? "Saving…" : "+ Add Recommended"}
              </button>
            </div>
          </div>
        </form>

        {/* Table of Recommended Picks */}
        <div className="terminal-panel overflow-hidden mt-3 max-h-72 overflow-y-auto">
          <table className="terminal-table">
            <thead className="sticky top-0 z-10 bg-[#F3F3F3] dark:bg-[#171E27]">
              <tr>
                <th className="w-[20%]">{recKind === "mf" ? "Code" : "APMI ID"}</th>
                <th className="w-[60%]">{recKind === "mf" ? "Fund Name" : "Strategy Name"}</th>
                <th className="w-[20%] text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {currentRecList.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                    No {recKind === "mf" ? "mutual funds" : "PMS strategies"} marked as recommended.
                  </td>
                </tr>
              ) : (
                currentRecList.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-[12px] text-[#0176D3] dark:text-[#1B96FF] font-medium">{item.id}</td>
                    <td className="font-medium text-[#181818] dark:text-[#EDF2F7]">{item.name}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveRecommended(item.id)}
                        className="text-[11px] text-[#B42332] dark:text-[#FF7D86] hover:underline cursor-pointer"
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
      </div>}

      {/* Watchlist Manager */}
      {activeTab === "watchlists" && <div className="terminal-panel p-3.5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5] dark:border-[#2B3644]">
          <div>
            <div className="text-[13px] font-medium text-[#181818] dark:text-[#EDF2F7]">
              Watchlist Items ({watchlists.length})
            </div>
            <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
              Monitored mutual fund schemes, issuers, and PMS strategies
            </div>
          </div>
        </div>

        {/* Add Watchlist Form */}
        <form onSubmit={handleAddWatchlist} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div>
            <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Watchlist Group</label>
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
            <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Item Type</label>
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
            <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">Identifier</label>
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
                className="terminal-btn text-[12px] py-1 px-3 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium shrink-0"
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
                  <td colSpan={4} className="py-6 text-center text-[#706E6B] dark:text-[#A8B4C4]">
                    No watchlists configured. Add an item above to track.
                  </td>
                </tr>
              ) : (
                watchlists.map((w) => (
                  <tr key={w.id}>
                    <td className="font-medium text-[#181818] dark:text-[#EDF2F7]">{w.name}</td>
                    <td className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{w.item_type}</td>
                    <td className="font-mono text-[12px] text-[#0176D3] dark:text-[#1B96FF] font-medium">{w.item_id}</td>
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
      </div>}
        </div>{/* flex-1 */}
      </div>{/* flex */}
    </div>
  );
}
