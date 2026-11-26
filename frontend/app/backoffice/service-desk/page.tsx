"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchHouseholds } from "@/lib/crmApi";
import { useUrlFlag, useUrlState } from "@/lib/useUrlState";
import {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  createQuery,
  deleteQuery,
  dmy,
  formatRelativeTime,
  listQueries,
  reportTracker,
  setQueryStatus,
  updateQuery,
  type Category,
  type Priority,
  type QueryListResult,
  type ReportTracker,
  type ServiceQuery,
  type Status,
} from "@/lib/serviceDesk";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const input = "w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#0F1621] px-3 py-2 text-[13.5px] text-[#172033] dark:text-[#EDF1F6] focus:outline-none focus:ring-1 focus:ring-[#006F64]";
const btn = "inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#006F64] hover:text-[#006F64] transition-colors disabled:opacity-50";
const btnPrimary = "inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg bg-[#006F64] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#00554D] transition-colors disabled:opacity-50";

const QUICK_LINKS = [
  ["PMS tracker", "/backoffice/pms"],
  ["Recommended mutual funds", "/backoffice/mutual-funds?rec=1"],
  ["Recommended PMS", "/backoffice/pms?approach=fh-recommended"],
  ["Mutual fund overlap", "/backoffice/mutual-funds/tools"],
  ["Investment proposal", "/backoffice/mutual-funds/proposal"],
  ["Operations Forms", "/backoffice/operations"],
  ["Sent emails", "/backoffice/operations/emails"],
] as const;

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: (e: { error?: string }) => void;
  start: () => void;
  stop: () => void;
};

const speechCtor = (): (new () => Rec) | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export default function ServiceDeskPage() {
  const [data, setData] = useState<QueryListResult | null>(null);
  const [tracker, setTracker] = useState<ReportTracker | null>(null);
  const [clients, setClients] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters & Search
  const [searchQ, setSearchQ] = useUrlState<string>("q", "");
  const [statusFilter, setStatusFilter] = useUrlState<string>("status", "all", { push: true });
  const [priorityFilter, setPriorityFilter] = useUrlState<string>("priority", "");
  const [categoryFilter, setCategoryFilter] = useUrlState<string>("category", "");

  // Create Form State
  const [formOpen, setFormOpen] = useUrlFlag("new");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [other, setOther] = useState("");
  const [details, setDetails] = useState("");
  const [viaVoice, setViaVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit Modal State
  const [editing, setEditing] = useState<ServiceQuery | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const rec = useRef<Rec | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const load = useCallback(() => {
    listQueries({
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter || undefined,
      category: categoryFilter || undefined,
      q: searchQ || undefined,
      limit: 200,
    })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(e.message));

    reportTracker()
      .then(setTracker)
      .catch(() => setTracker(null));
  }, [statusFilter, priorityFilter, categoryFilter, searchQ]);

  useEffect(() => {
    load();
    setCanSpeak(!!speechCtor());
    fetchHouseholds()
      .then((h) => setClients(h.map((x) => x.name)))
      .catch(() => undefined);
  }, [load]);

  useEffect(() => () => rec.current?.stop(), []);

  const dictate = () => {
    if (listening) return rec.current?.stop();
    const R = speechCtor();
    if (!R) return;
    const r = new R();
    r.lang = "en-IN";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const t = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(" ")
        .trim();
      if (t) {
        setDetails((d) => `${d}${d ? " " : ""}${t}`);
        setViaVoice(true);
      }
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError("Microphone unavailable or blocked. You can type instead.");
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return setError("Choose a service category.");
    setBusy(true);
    try {
      const res = await createQuery({
        client_name: name,
        category,
        other_text: other,
        details,
        priority,
        source: viaVoice ? "voice" : "typed",
      });
      setName("");
      setCategory("");
      setOther("");
      setDetails("");
      setPriority("medium");
      setViaVoice(false);
      setFormOpen(false);
      notify(`Ticket ${res.ticket_code} created successfully.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const handleMoveStatus = async (id: string, nextStatus: Status, note?: string) => {
    setBusy(true);
    try {
      await setQueryStatus(id, nextStatus, note);
      setResolvingId(null);
      setResolutionText("");
      notify(`Status updated to ${nextStatus.replace("_", " ")}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await updateQuery(editing.id, {
        client_name: editing.client_name,
        category: editing.category,
        other_text: editing.other_text ?? "",
        details: editing.details ?? "",
        priority: editing.priority,
        status: editing.status,
        resolution_note: editing.resolution_note ?? "",
      });
      notify(`Ticket ${editing.ticket_code} updated.`);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update record.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, ticketCode: string) => {
    setBusy(true);
    try {
      await deleteQuery(id);
      notify(`Ticket ${ticketCode} deleted.`);
      setDeletingId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete record.");
    } finally {
      setBusy(false);
    }
  };

  const copyTicket = (code: string) => {
    navigator.clipboard?.writeText(code);
    notify(`Copied ${code} to clipboard.`);
  };

  const exportCsv = () => {
    if (!data?.rows.length) return notify("No records to export.");
    const headers = ["Ticket ID", "Client Name", "Category", "Priority", "Status", "Source", "Logged Date", "Completed Date", "Details", "Resolution Note"];
    const lines = data.rows.map((r) => [
      r.ticket_code,
      `"${r.client_name.replace(/"/g, '""')}"`,
      `"${(r.category === "other" ? r.other_text : r.category) ?? ""}"`,
      r.priority,
      r.status,
      r.source,
      dmy(r.created_at),
      r.completed_at ? dmy(r.completed_at) : "",
      `"${(r.details ?? "").replace(/"/g, '""')}"`,
      `"${(r.resolution_note ?? "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...lines.map((l) => l.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `service-desk-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify("Exported CSV log.");
  };

  const rows = data?.rows ?? [];
  const counts = useMemo(() => data?.counts ?? {}, [data?.counts]);
  const totalCount = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  return (
    <div className="space-y-4 pb-14">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-[#172033] px-4 py-2.5 text-[13px] font-medium text-white shadow-lg animate-in fade-in duration-200">
          <span>{toast}</span>
        </div>
      )}

      {/* Header & Controls */}
      <div className={`${card} px-5 py-4 sm:flex sm:items-center sm:justify-between gap-4`}>
        <div>
          <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>Service desk</h1>
        </div>
        <div className="mt-3 sm:mt-0 flex flex-wrap gap-2">
          <button type="button" onClick={exportCsv} className={btn} title="Export daily query log to CSV">
            <svg className="w-4 h-4 text-[#667085]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export Log
          </button>
          <button type="button" onClick={() => setFormOpen(!formOpen)} className={btnPrimary}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {formOpen ? "Close Form" : "New Service Query"}
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className={`${card} p-3.5`}>
          <span className={`block text-[11.5px] font-bold uppercase tracking-wider ${muted}`}>Active Tickets</span>
          <span className={`text-2xl font-bold ${ink}`}>{data?.active_count ?? 0}</span>
        </div>
        <div className={`${card} p-3.5`}>
          <span className="block text-[11.5px] font-bold uppercase tracking-wider text-[#1D5BD8] dark:text-[#60A5FA]">Incoming (New)</span>
          <span className="text-2xl font-bold text-[#1D5BD8] dark:text-[#60A5FA]">{counts.incoming ?? 0}</span>
        </div>
        <div className={`${card} p-3.5`}>
          <span className="block text-[11.5px] font-bold uppercase tracking-wider text-[#B54708] dark:text-[#FDB022]">In Progress</span>
          <span className="text-2xl font-bold text-[#B54708] dark:text-[#FDB022]">{(counts.in_progress ?? 0) + (counts.waiting_client ?? 0)}</span>
        </div>
        <div className={`${card} p-3.5`}>
          <span className="block text-[11.5px] font-bold uppercase tracking-wider text-[#027A48] dark:text-[#6CE9A6]">Completed</span>
          <span className="text-2xl font-bold text-[#027A48] dark:text-[#6CE9A6]">{counts.completed ?? 0}</span>
        </div>
        <div className={`${card} p-3.5 ${(data?.urgent_count ?? 0) > 0 ? "border-[#FDA29B] bg-[#FEF3F2] dark:bg-[#3D1412]" : ""}`}>
          <span className="block text-[11.5px] font-bold uppercase tracking-wider text-[#B42318] dark:text-[#FDA29B]">Urgent Tickets</span>
          <span className="text-2xl font-bold text-[#B42318] dark:text-[#FDA29B]">{data?.urgent_count ?? 0}</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg bg-[#FEF3F2] dark:bg-[#381412] px-4 py-2.5 text-[13px] text-[#B42318] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-[12px] underline">Dismiss</button>
        </div>
      )}

      {/* New Query Drawer / Form */}
      {formOpen && (
        <form onSubmit={handleCreate} className={`${card} space-y-3.5 p-5 animate-in fade-in duration-200 border-2 border-[#006F64]/40`} aria-label="New service query">
          <div className="flex items-center justify-between">
            <h2 className={`text-[16px] font-bold ${ink}`}>Log incoming client query</h2>
            <button type="button" onClick={() => setFormOpen(false)} className={`text-[12px] ${muted} hover:underline`}>Cancel</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className={`block text-[12.5px] font-semibold ${muted}`}>
              Client name
              <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} list="sd-clients" required maxLength={120} placeholder="Type or select household…" />
              <datalist id="sd-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
            </label>

            <label className={`block text-[12.5px] font-semibold ${muted}`}>
              Service Category
              <select className={`${input} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as Category)} required>
                <option value="" disabled>Select category…</option>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>

            <label className={`block text-[12.5px] font-semibold ${muted}`}>
              Priority Level
              <select className={`${input} mt-1`} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>

          {category === "other" && (
            <label className={`block text-[12.5px] font-semibold ${muted}`}>
              Describe the service
              <input className={`${input} mt-1`} value={other} onChange={(e) => setOther(e.target.value)} required maxLength={200} placeholder="e.g. Bank mandate change or capital gains statement" />
            </label>
          )}

          <label className={`block text-[12.5px] font-semibold ${muted}`}>
            Query details & request notes (voice or text)
            <textarea className={`${input} mt-1 min-h-[85px]`} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} placeholder="Provide specific folio details, requested transaction, or meeting notes…" />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex gap-2">
              {canSpeak && (
                <button type="button" onClick={dictate} aria-pressed={listening} className={`${btn} ${listening ? "!bg-red-50 !border-red-400 !text-red-600 animate-pulse" : ""}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  {listening ? "Listening… Stop dictation" : "Dictate with voice"}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className={btn}>Discard</button>
              <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save Query"}</button>
            </div>
          </div>
        </form>
      )}

      {/* Search & Lifecycle Filtering */}
      <div className={`${card} p-4 space-y-3`}>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-[#9AA6B8]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by ticket ID (e.g. SR-XXXXXX), client name, or keywords…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className={`${input} pl-9`}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <select className={`${input} !w-auto text-[12.5px]`} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Filter Priority">
              <option value="">All Priorities</option>
              {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select className={`${input} !w-auto text-[12.5px]`} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter Category">
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Status Pipeline Tabs */}
        <div role="tablist" className="flex flex-wrap gap-1.5 pt-1 border-t border-[#E4E9EF] dark:border-[#2B3644]">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`${btn} text-[12px] ${statusFilter === "all" ? "!border-[#006F64] !text-[#006F64] dark:!text-[#75E1CE] bg-[#F4F9F8] dark:bg-[#122A25]" : ""}`}
          >
            All Queries ({totalCount})
          </button>
          {STATUSES.map((s) => {
            const c = counts[s.id] ?? 0;
            const active = statusFilter === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusFilter(s.id)}
                className={`${btn} text-[12px] ${active ? "!border-[#006F64] !text-[#006F64] dark:!text-[#75E1CE] bg-[#F4F9F8] dark:bg-[#122A25]" : ""}`}
              >
                {s.label} ({c})
              </button>
            );
          })}
        </div>
      </div>

      {/* Ticket List & Process Workflow */}
      <div className={`${card} overflow-hidden`}>
        <div className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
          {rows.length === 0 ? (
            <div className="py-12 text-center">
              <svg className="mx-auto h-10 w-10 text-[#9AA6B8]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className={`mt-2 text-[14px] font-semibold ${ink}`}>No queries match the selected criteria</p>
              <p className={`mt-0.5 text-[12.5px] ${muted}`}>Try clearing search or changing status filter.</p>
            </div>
          ) : (
            rows.map((r) => {
              const statusMeta = STATUSES.find((s) => s.id === r.status) ?? STATUSES[0];
              const priorityMeta = PRIORITIES.find((p) => p.id === r.priority) ?? PRIORITIES[2];
              const isResolving = resolvingId === r.id;
              const isDeleting = deletingId === r.id;

              return (
                <div key={r.id} className="p-4 sm:p-5 hover:bg-[#F8FAFC]/50 dark:hover:bg-[#1C2534]/40 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    {/* Left: Identifiers, Tags & Client Details */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Ticket ID Badge */}
                        <button
                          type="button"
                          onClick={() => copyTicket(r.ticket_code)}
                          className="inline-flex items-center gap-1 rounded bg-[#E4E9EF] dark:bg-[#253245] px-2 py-0.5 font-mono text-[12px] font-bold text-[#172033] dark:text-[#EDF1F6] hover:bg-[#D0D7E2] transition-colors"
                          title="Click to copy Ticket ID"
                        >
                          <span>{r.ticket_code}</span>
                          <svg className="w-3 h-3 text-[#667085]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>

                        {/* Priority Badge */}
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${priorityMeta.badge}`}>
                          {priorityMeta.label}
                        </span>

                        {/* Status Badge */}
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.tone}`}>
                          {statusMeta.label}
                        </span>

                        {/* Category Badge */}
                        <span className="rounded bg-[#F2F4F7] dark:bg-[#1F2937] px-2 py-0.5 text-[11px] font-medium text-[#475467] dark:text-[#9CA3AF]">
                          {r.category === "other" ? `Other: ${r.other_text}` : CATEGORIES.find((c) => c.id === r.category)?.label}
                        </span>

                        {/* Voice tag if dictated */}
                        {r.source === "voice" && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#006F64] dark:text-[#75E1CE]">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                            Voice note
                          </span>
                        )}
                      </div>

                      {/* Client Title and CRM jump */}
                      <div className="flex flex-wrap items-baseline gap-2 pt-0.5">
                        <h3 className={`text-[15.5px] font-bold ${ink}`}>{r.client_name}</h3>
                        <Link
                          href={`/backoffice/crm?q=${encodeURIComponent(r.client_name)}`}
                          className="text-[12px] font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline"
                        >
                          Open in CRM ↗
                        </Link>
                      </div>

                      {/* Details Content */}
                      {r.details && (
                        <p className={`text-[13.5px] break-words text-[#334155] dark:text-[#CBD5E1] whitespace-pre-wrap`}>
                          {r.details}
                        </p>
                      )}

                      {/* Resolution Note if resolved */}
                      {r.resolution_note && (
                        <div className="mt-1 rounded-lg bg-[#F0FDF4] dark:bg-[#062417] p-2.5 text-[12.5px] border border-[#BBF7D0] dark:border-[#14532D]">
                          <span className="font-semibold text-[#15803D] dark:text-[#4ADE80]">Resolution Note: </span>
                          <span className="text-[#166534] dark:text-[#86EFAC]">{r.resolution_note}</span>
                        </div>
                      )}

                      {/* Audit & Timestamps */}
                      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] ${muted} pt-1`}>
                        <span>Logged {dmy(r.created_at)} ({formatRelativeTime(r.created_at)})</span>
                        {r.updated_at && r.updated_at !== r.created_at && <span>· Updated {formatRelativeTime(r.updated_at)}</span>}
                        {r.completed_at && <span className="text-[#027A48] dark:text-[#6CE9A6]">· Completed {dmy(r.completed_at)}</span>}
                      </div>
                    </div>

                    {/* Right: Process Flow & Action Buttons */}
                    <div className="flex flex-col sm:items-end gap-2 shrink-0 pt-2 lg:pt-0">
                      {/* State transition buttons */}
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "incoming" && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMoveStatus(r.id, "in_progress")}
                              className={`${btn} !bg-[#EAF2FE] !border-[#B8D3FC] !text-[#1D5BD8] dark:!bg-[#162A4A] dark:!text-[#60A5FA]`}
                            >
                              Start Progress
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveStatus(r.id, "waiting_client")}
                              className={btn}
                            >
                              Wait on Client
                            </button>
                          </>
                        )}

                        {r.status === "in_progress" && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMoveStatus(r.id, "waiting_client")}
                              className={`${btn} !bg-[#F4EBFF] !border-[#D8B4FE] !text-[#6927DA] dark:!bg-[#2C194D] dark:!text-[#D8B4FE]`}
                            >
                              Wait on Client/RTA
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResolvingId(r.id);
                                setResolutionText(r.resolution_note || "");
                              }}
                              className={`${btn} !bg-[#ECFDF3] !border-[#A6F4C5] !text-[#027A48] dark:!bg-[#0E3824] dark:!text-[#6CE9A6]`}
                            >
                              Resolve…
                            </button>
                          </>
                        )}

                        {r.status === "waiting_client" && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMoveStatus(r.id, "in_progress")}
                              className={`${btn} !bg-[#FFF4E5] !border-[#FEDF89] !text-[#B54708] dark:!bg-[#3D2506] dark:!text-[#FDB022]`}
                            >
                              Resume Progress
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResolvingId(r.id);
                                setResolutionText(r.resolution_note || "");
                              }}
                              className={`${btn} !bg-[#ECFDF3] !border-[#A6F4C5] !text-[#027A48] dark:!bg-[#0E3824] dark:!text-[#6CE9A6]`}
                            >
                              Resolve…
                            </button>
                          </>
                        )}

                        {r.status === "completed" && (
                          <button
                            type="button"
                            onClick={() => handleMoveStatus(r.id, "incoming")}
                            className={btn}
                          >
                            Reopen Ticket
                          </button>
                        )}

                        {/* Edit Record */}
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className={btn}
                          title="Modify ticket details"
                        >
                          Edit
                        </button>

                        {/* Delete Record */}
                        <button
                          type="button"
                          onClick={() => setDeletingId(r.id)}
                          className={`${btn} hover:!border-red-400 hover:!text-red-600`}
                          title="Delete query record"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>

                      {/* Quick integrated actions */}
                      <div className="flex gap-2 text-[12px]">
                        <Link href="/backoffice/operations#forms" className={`hover:underline ${muted}`}>
                          Start Form
                        </Link>
                        <span className={muted}>·</span>
                        <Link href="/backoffice/operations#review" className={`hover:underline ${muted}`}>
                          Portfolio Review
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Inline Resolve Note Dialog */}
                  {isResolving && (
                    <div className="mt-3 rounded-lg border border-[#A6F4C5] dark:border-[#14532D] bg-[#F0FDF4] dark:bg-[#082015] p-3 space-y-2">
                      <label className={`block text-[12.5px] font-semibold text-[#15803D] dark:text-[#4ADE80]`}>
                        Resolution details & action summary (optional)
                        <input
                          type="text"
                          value={resolutionText}
                          onChange={(e) => setResolutionText(e.target.value)}
                          placeholder="e.g. KYC update submitted to CAMS; ack #109438"
                          className={`${input} mt-1`}
                        />
                      </label>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setResolvingId(null)} className={btn}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveStatus(r.id, "completed", resolutionText)}
                          disabled={busy}
                          className={btnPrimary}
                        >
                          Mark Completed
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delete Confirmation Dialog */}
                  {isDeleting && (
                    <div className="mt-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] dark:bg-[#381412] p-3 space-y-2">
                      <p className="text-[13px] font-semibold text-[#B42318] dark:text-[#FDA29B]">
                        Are you sure you want to permanently delete ticket {r.ticket_code}?
                      </p>
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setDeletingId(null)} className={btn}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id, r.ticket_code)}
                          disabled={busy}
                          className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-[#D92D20] px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#B42318]"
                        >
                          Confirm Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Edit Record Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className={`${card} w-full max-w-lg p-5 space-y-3.5 shadow-2xl animate-in zoom-in-95 duration-150`}>
            <div className="flex items-center justify-between border-b border-[#E4E9EF] dark:border-[#2B3644] pb-2.5">
              <div>
                <h3 className={`text-[16px] font-bold ${ink}`}>Modify Service Query</h3>
                <span className="font-mono text-[12px] font-semibold text-[#006F64] dark:text-[#75E1CE]">{editing.ticket_code}</span>
              </div>
              <button type="button" onClick={() => setEditing(null)} className={`text-[13px] ${muted} hover:underline`}>Close</button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <label className={`block text-[12.5px] font-semibold ${muted}`}>
                Client name
                <input
                  className={`${input} mt-1`}
                  value={editing.client_name}
                  onChange={(e) => setEditing({ ...editing, client_name: e.target.value })}
                  required
                  maxLength={120}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className={`block text-[12.5px] font-semibold ${muted}`}>
                  Category
                  <select
                    className={`${input} mt-1`}
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value as Category })}
                  >
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>

                <label className={`block text-[12.5px] font-semibold ${muted}`}>
                  Priority
                  <select
                    className={`${input} mt-1`}
                    value={editing.priority}
                    onChange={(e) => setEditing({ ...editing, priority: e.target.value as Priority })}
                  >
                    {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
              </div>

              {editing.category === "other" && (
                <label className={`block text-[12.5px] font-semibold ${muted}`}>
                  Describe other service
                  <input
                    className={`${input} mt-1`}
                    value={editing.other_text ?? ""}
                    onChange={(e) => setEditing({ ...editing, other_text: e.target.value })}
                    required
                  />
                </label>
              )}

              <label className={`block text-[12.5px] font-semibold ${muted}`}>
                Lifecycle Status
                <select
                  className={`${input} mt-1`}
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value as Status })}
                >
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>

              <label className={`block text-[12.5px] font-semibold ${muted}`}>
                Query details
                <textarea
                  className={`${input} mt-1 min-h-[70px]`}
                  value={editing.details ?? ""}
                  onChange={(e) => setEditing({ ...editing, details: e.target.value })}
                  maxLength={2000}
                />
              </label>

              <label className={`block text-[12.5px] font-semibold ${muted}`}>
                Resolution note
                <input
                  className={`${input} mt-1`}
                  value={editing.resolution_note ?? ""}
                  onChange={(e) => setEditing({ ...editing, resolution_note: e.target.value })}
                  placeholder="Record summary of action taken…"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E4E9EF] dark:border-[#2B3644]">
                <button type="button" onClick={() => setEditing(null)} className={btn}>Cancel</button>
                <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save Changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Monthly Review SLA Section */}
      <div className={`${card} px-4 py-4 sm:px-5`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-[15px] font-bold ${ink}`}>Monthly portfolio review send tracker</h2>
          <Link href="/backoffice/operations#report" className="text-[12.5px] font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline">
            Open Report Builder →
          </Link>
        </div>
        {tracker ? (
          <div className="mt-2.5 space-y-2 text-[13.5px]">
            <p className={ink}>
              {tracker.report_month} cycle: finalize by <b>{dmy(tracker.finalize_by)}</b>, send by <b>{dmy(tracker.send_by)}</b>{" "}
              (hard cutoff <b>{dmy(tracker.hard_deadline)}</b>, {tracker.days_left >= 0 ? `${tracker.days_left} days left` : "overdue"}).
            </p>
            <p className={muted}>
              Generated: <b>{tracker.generated}</b> · Emailed: <b>{tracker.emailed}</b> · Not yet emailed: <b>{tracker.unsent.length}</b>
            </p>
            {tracker.unsent.length > 0 && (
              <p className="text-[#9A6700] dark:text-[#F5C451] text-[12.5px]">
                Pending clients: {tracker.unsent.map((u) => u.name).join(", ")}
              </p>
            )}
          </div>
        ) : (
          <p className={`mt-2 text-[13.5px] ${muted}`}>Tracker loaded.</p>
        )}
      </div>

      {/* Tools Grid */}
      <div className={`${card} px-4 py-4 sm:px-5`}>
        <h2 className={`text-[15px] font-bold ${ink}`}>Integrated Tools</h2>
        <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(([l, h]) => (
            <Link key={h} href={h} className={btn}>
              {l}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
