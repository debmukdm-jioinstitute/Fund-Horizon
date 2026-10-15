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
        const opts = { width: 320, margin: 2, color: { dark: "#006F64", light: "#FFFFFF" } };
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

  async function handleProvisionStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!staffEmail.trim() || !staffName.trim()) return;
    try {
      setSavingStaff(true);
      await createStaffMember({
        name: staffName.trim(),
        email: staffEmail.trim(),
        role: staffRole,
        mobile: staffMobile.trim() || "",
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
              Settings, Lead Generation &amp; Terminal Administration
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Terminal Configuration
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Client intake QR generator, FH Recommended fund curation, watchlists, and operator permissions
          </p>
        </div>
      </div>

      {/* Client Intake QR Code & Lead Capture Section */}
      <div className="terminal-panel p-4 space-y-4 bg-gradient-to-br from-white to-[#F7FAF9] dark:from-[#171E27] dark:to-[#111A24] border-[#C2E9E0] dark:border-[#234542]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px]">📱</span>
              <div className="text-[14px] font-semibold text-[#172033] dark:text-[#EDF2F7]">
                Client Intake QR Code &amp; Lead Generation
              </div>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-[#E1F3EC] dark:bg-[#10372A] text-[#006F64] dark:text-[#7FE0B5] border border-[#C2E9E0] dark:border-[#224845]">
                Live CRM Sync
              </span>
            </div>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
              When prospective clients scan this QR code on their phone, it opens the branded Fund Horizon intake form. All submissions automatically sync to your Backoffice CRM.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/lead"
              target="_blank"
              className="terminal-btn text-[11px] py-1 px-2.5 text-[#006F64] dark:text-[#75E1CE] border-[#C2E9E0] dark:border-[#224845] hover:bg-[#E7F5F2] dark:hover:bg-[#1A3034] font-medium flex items-center gap-1"
            >
              <span>Test Intake Form</span>
              <span>↗</span>
            </Link>
            <Link
              href="/backoffice/crm?tab=leads"
              className="terminal-btn text-[11px] py-1 px-2.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium flex items-center gap-1"
            >
              <span>View in CRM</span>
              <span>→</span>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
          {/* QR Card */}
          <div className="md:col-span-4 flex flex-col items-center text-center p-4 bg-white dark:bg-[#111722] rounded-xl border border-[#D8E3E0] dark:border-[#25373E] shadow-sm">
            <div className="w-48 h-48 sm:w-52 sm:h-52 bg-white p-2 rounded-lg border border-[#E4E9EF] flex items-center justify-center">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="Fund Horizon Client Intake QR Code"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-xs text-[#536176] animate-pulse">Generating QR…</div>
              )}
            </div>

            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#006F64] dark:bg-[#75E1CE]" />
              SCAN WITH PHONE CAMERA
            </div>

            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download="fund-horizon-intake-qr.png"
                className="mt-2.5 text-[11px] text-[#006F64] dark:text-[#75E1CE] hover:underline font-medium flex items-center gap-1"
              >
                <span>↓ Download QR (PNG)</span>
              </a>
            )}
          </div>

          {/* Details & Copy Link */}
          <div className="md:col-span-8 space-y-3.5">
            <div>
              <label className="text-[11px] font-semibold text-[#536176] dark:text-[#A8B4C4] block mb-1">
                Client Intake URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={leadUrl}
                  className="terminal-input w-full text-[12px] py-1.5 px-2.5 font-mono bg-[#F7F9FB] dark:bg-[#111722]"
                />
                <button
                  type="button"
                  onClick={copyLeadUrl}
                  className="terminal-btn text-[12px] py-1.5 px-3.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-semibold shrink-0 transition"
                >
                  {copiedLink ? "✓ Copied!" : "Copy Link"}
                </button>
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-[#F7F9FB] dark:bg-[#111722] border border-[#E4E9EF] dark:border-[#2B3644] space-y-2 text-[12px]">
              <div className="font-semibold text-[#172033] dark:text-[#EDF2F7] flex items-center gap-1.5">
                <span>📋</span>
                <span>Collected Customer Information</span>
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                <li className="flex items-center gap-1.5">
                  <span className="text-[#006F64] dark:text-[#75E1CE]">✓</span>
                  <span><strong>Customer Name</strong> (Full Legal Name)</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-[#006F64] dark:text-[#75E1CE]">✓</span>
                  <span><strong>Phone Number</strong> (10-Digit Mobile)</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-[#006F64] dark:text-[#75E1CE]">✓</span>
                  <span><strong>Email Address</strong> (Direct Correspondence)</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-[#006F64] dark:text-[#75E1CE]">✓</span>
                  <span><strong>Investment Interest</strong> (MF, PMS, Advisory)</span>
                </li>
              </ul>
            </div>

            <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] leading-relaxed">
              💡 <strong>Usage Tip:</strong> Print or place this QR code on reception desks, presentation slides, or client brochures. When scanned, leads flow directly into the CRM with source tag <span className="font-mono text-[#006F64] dark:text-[#75E1CE] font-semibold">qr_code</span> and status <span className="font-mono text-[#006F64] dark:text-[#75E1CE] font-semibold">new</span>.
            </div>
          </div>
        </div>
      </div>

      {/* Cross₹word Game QR */}
      <div className="terminal-panel p-4 space-y-3 bg-gradient-to-br from-white to-[#F7FAF9] dark:from-[#171E27] dark:to-[#111A24] border-[#C2E9E0] dark:border-[#234542]">
        <div className="flex items-center gap-2 pb-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644]">
          <span className="text-[14px]">🧩</span>
          <div className="text-[14px] font-semibold text-[#172033] dark:text-[#EDF2F7]">Cross₹word Game QR</div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-[#E1F3EC] dark:bg-[#10372A] text-[#006F64] dark:text-[#7FE0B5] border border-[#C2E9E0] dark:border-[#224845]">Lead Magnet</span>
        </div>
        <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
          Scanners play a 2-minute word-search of basic financial terms (1 of 20, random each scan), get a token to screenshot, and are saved to CRM Leads with source <span className="font-mono font-semibold text-[#006F64] dark:text-[#75E1CE]">crossword</span> plus words-correct score.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
          <div className="md:col-span-4 flex flex-col items-center p-4 bg-white dark:bg-[#111722] rounded-xl border border-[#D8E3E0] dark:border-[#25373E]">
            <div className="w-48 h-48 sm:w-52 sm:h-52 bg-white p-2 rounded-lg border border-[#E4E9EF] flex items-center justify-center">
              {gameQr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={gameQr} alt="Fund Horizon Crossword Game QR Code" className="w-full h-full object-contain" />
              ) : (
                <div className="text-xs text-[#536176] animate-pulse">Generating QR…</div>
              )}
            </div>
            {gameQr && (
              <a href={gameQr} download="fund-horizon-crossword-qr.png" className="mt-2.5 text-[11px] text-[#006F64] dark:text-[#75E1CE] hover:underline font-medium">↓ Download QR (PNG)</a>
            )}
          </div>
          <div className="md:col-span-8 space-y-3">
            <label className="text-[11px] font-semibold text-[#536176] dark:text-[#A8B4C4] block">Game URL</label>
            <div className="flex gap-2">
              <input type="text" readOnly value={gameUrl} className="terminal-input w-full text-[12px] py-1.5 px-2.5 font-mono bg-[#F7F9FB] dark:bg-[#111722]" />
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(gameUrl); setCopiedGame(true); setTimeout(() => setCopiedGame(false), 2000); }}
                className="terminal-btn text-[12px] py-1.5 px-3.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-semibold shrink-0"
              >
                {copiedGame ? "✓ Copied!" : "Copy Link"}
              </button>
            </div>
            <div className="flex gap-2">
              <Link href="/crossword" target="_blank" className="terminal-btn text-[11px] py-1 px-2.5 text-[#006F64] dark:text-[#75E1CE] border-[#C2E9E0] dark:border-[#224845] font-medium">Test Game ↗</Link>
              <Link href="/backoffice/crm?tab=leads" className="terminal-btn text-[11px] py-1 px-2.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium">View in CRM →</Link>
            </div>
          </div>
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
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Assigned Role</label>
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value)}
                className="terminal-input w-full text-[12px] py-1 px-2"
              >
                <option value="analyst">Analyst (Research &amp; Terminal)</option>
                <option value="rm">Relationship Manager (Client Portfolios)</option>
                <option value="operations">Operations (Data Management)</option>
                <option value="compliance">Compliance (Audit &amp; Oversight)</option>
                <option value="admin">System Administrator</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">Mobile</label>
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
                  className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium shrink-0"
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
                    <td colSpan={4} className="py-6 text-center text-[#536176] dark:text-[#A8B4C4]">
                      No additional staff members provisioned yet.
                    </td>
                  </tr>
                ) : (
                  staffList.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">
                        {s.name}
                        <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-normal">{s.email}</div>
                      </td>
                      <td>
                        <span className="font-mono uppercase text-[10px] px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644]">
                          {s.role}
                        </span>
                      </td>
                      <td className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">{s.mobile || "–"}</td>
                      <td className="text-right">
                        <span className="text-[11px] text-[#006F64] dark:text-[#75E1CE] font-medium">
                          {s.status}
                        </span>
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
      <div className="terminal-panel p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
          <div>
            <div className="text-[13px] font-medium text-[#172033] dark:text-[#EDF2F7] flex items-center gap-1.5">
              <span>★</span>
              <span>FH Recommended Picks ({currentRecList.length} {recKind === "mf" ? "Funds" : "Strategies"})</span>
            </div>
            <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
              Curated shortlist of top-performing Mutual Funds and PMS strategies highlighted across the terminal
            </div>
          </div>

          {/* Toggle MF vs PMS */}
          <div className="inline-flex rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] p-0.5 bg-[#F7F9FB] dark:bg-[#111722]">
            <button
              type="button"
              onClick={() => setRecKind("mf")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition ${
                recKind === "mf"
                  ? "bg-[#006F64] text-white dark:bg-[#75E1CE] dark:text-[#10151C] shadow-sm"
                  : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7]"
              }`}
            >
              Mutual Funds ({Object.keys(rec.mfMap).length})
            </button>
            <button
              type="button"
              onClick={() => setRecKind("pms")}
              className={`px-3 py-1 text-[11px] font-medium rounded-md transition ${
                recKind === "pms"
                  ? "bg-[#006F64] text-white dark:bg-[#75E1CE] dark:text-[#10151C] shadow-sm"
                  : "text-[#536176] dark:text-[#A8B4C4] hover:text-[#172033] dark:hover:text-[#EDF2F7]"
              }`}
            >
              PMS Strategies ({Object.keys(rec.pmsMap).length})
            </button>
          </div>
        </div>

        {recSuccess && (
          <div className="text-[11px] p-2 rounded bg-[#E1F3EC] dark:bg-[#10372A] text-[#006F64] dark:text-[#7FE0B5] border border-[#C2E9E0] dark:border-[#224845]">
            {recSuccess}
          </div>
        )}

        {/* Add Recommended Form */}
        <form onSubmit={handleAddRecommended} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
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
            <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
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
                className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium shrink-0"
              >
                {savingRec ? "Saving…" : "+ Add Recommended"}
              </button>
            </div>
          </div>
        </form>

        {/* Table of Recommended Picks */}
        <div className="terminal-panel overflow-hidden mt-3 max-h-72 overflow-y-auto">
          <table className="terminal-table">
            <thead className="sticky top-0 z-10 bg-[#F7F9FB] dark:bg-[#171E27]">
              <tr>
                <th className="w-[20%]">{recKind === "mf" ? "Code" : "APMI ID"}</th>
                <th className="w-[60%]">{recKind === "mf" ? "Fund Name" : "Strategy Name"}</th>
                <th className="w-[20%] text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {currentRecList.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-[#536176] dark:text-[#A8B4C4]">
                    No {recKind === "mf" ? "mutual funds" : "PMS strategies"} marked as recommended.
                  </td>
                </tr>
              ) : (
                currentRecList.map((item) => (
                  <tr key={item.id}>
                    <td className="font-mono text-[12px] text-[#006F64] dark:text-[#75E1CE] font-medium">{item.id}</td>
                    <td className="font-medium text-[#172033] dark:text-[#EDF2F7]">{item.name}</td>
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
      </div>

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
