"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  getBriefing,
  getBriefingDates,
  rebuildBriefing,
  getResearchNotes,
  createResearchNote,
  BriefingPayload,
  BriefingSection,
  BriefingItem,
  ResearchNoteItem,
} from "@/lib/backoffice";
import { ApiError } from "@/lib/api";
import { formatISTDate } from "@/lib/terminal-format";
import { useAuth } from "@/components/AuthContext";
import FundScreening from "@/components/backoffice/FundScreening";
import briefingCopy from "@/lib/briefing-copy.json";
import printStyles from "./briefing-print.module.css";

type ResearchTab = "briefing" | "notes" | "screening";
type BriefingView = "advisor" | "analyst";

// Advisor view: business-first order (section keys 7, 2, 4, 5, 1).
const ADVISOR_ORDER = [
  "client_actions",
  "fund_movers",
  "cost_manager_changes",
  "regulatory_news",
  "market_pulse",
];

// Analyst fallback order if the payload arrives unordered.
const ANALYST_ORDER = [
  "market_pulse",
  "fund_movers",
  "screening_changes",
  "cost_manager_changes",
  "regulatory_news",
  "pms",
  "client_actions",
  "data_freshness",
];

function orderSections(sections: BriefingSection[], order: string[]): BriefingSection[] {
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const ordered = order
    .map((k) => byKey.get(k))
    .filter((s): s is BriefingSection => s != null);
  const orderedKeys = new Set(ordered.map((s) => s.key));
  return [...ordered, ...sections.filter((s) => !orderedKeys.has(s.key))];
}

function formatISTTimeHM(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    return (
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d) + " IST"
    );
  } catch {
    return "—";
  }
}

function formatISTDateTimeShort(dateInput?: string | number | Date | null): string {
  if (!dateInput) return "—";
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "—";
    return (
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d) + " IST"
    );
  } catch {
    return "—";
  }
}

function formatBriefDate(briefDate: string): string {
  if (!briefDate) return "—";
  // brief_date is YYYY-MM-DD; format as DD MMM YYYY without timezone drift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(briefDate);
  if (m) {
    try {
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+05:30`);
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(d);
      }
    } catch {
      /* fall through to generic formatter */
    }
  }
  return formatISTDate(briefDate);
}

function ChangeMark({ item }: { item: BriefingItem }) {
  const changeText = item.change ?? (item.change_pct != null ? `${item.change_pct > 0 ? "+" : ""}${item.change_pct}%` : null);
  if (changeText == null) return null;
  const up = item.direction === "up";
  const down = item.direction === "down";
  return (
    <span
      className={`font-mono text-[12px] font-medium ${
        up
          ? "text-[#0E7C3A] dark:text-[#6FD598]"
          : down
            ? "text-[#B42332] dark:text-[#FF7D86]"
            : "text-[#536176] dark:text-[#A8B4C4]"
      }`}
    >
      {up ? "▲ " : down ? "▼ " : ""}
      {changeText}
    </span>
  );
}

function BriefingItemRow({ item, detailed }: { item: BriefingItem; detailed: boolean }) {
  const headline = item.value ?? item.text ?? "—";
  return (
    <div className="py-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] last:border-b-0 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-[#172033] dark:text-[#EDF2F7]">{headline}</span>
        <ChangeMark item={item} />
      </div>
      {item.text != null && item.value != null && item.text !== item.value && (
        <p className="text-[12px] text-[#172033] dark:text-[#EDF2F7] leading-relaxed">{item.text}</p>
      )}
      {item.so_what != null && (
        <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] leading-relaxed">{item.so_what}</p>
      )}
      {detailed && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-[#536176] dark:text-[#A8B4C4]">
          {item.as_of != null && <span>{formatISTDateTimeShort(item.as_of)}</span>}
          {item.source != null && (
            <span>
              {item.source_url != null ? (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener"
                  className="text-[#006F64] dark:text-[#75E1CE] hover:underline"
                >
                  {item.source}
                </a>
              ) : (
                item.source
              )}
            </span>
          )}
          {item.link != null && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener"
              className="text-[#006F64] dark:text-[#75E1CE] hover:underline"
            >
              Details
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function BriefingSectionCard({ section, detailed }: { section: BriefingSection; detailed: boolean }) {
  if (section.items.length === 0) {
    return (
      <details className={`terminal-panel p-6 mb-6 ${printStyles.card}`}>
        <summary className="cursor-pointer text-[13px] font-medium text-[#536176] dark:text-[#A8B4C4] list-none flex items-center gap-2">
          <span aria-hidden="true">▸</span>
          <span>{section.title || section.key}</span>
          <span className="text-[11px] font-mono">— no data</span>
        </summary>
        <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-2">
          {section.note ?? "—"}
        </p>
      </details>
    );
  }
  return (
    <section className={`terminal-panel p-6 mb-6 ${printStyles.card}`}>
      <h2 className="text-[14px] font-semibold text-[#172033] dark:text-[#EDF2F7] mb-4">
        {section.title || section.key}
      </h2>
      <div>
        {section.items.map((item, idx) => (
          <BriefingItemRow key={idx} item={item} detailed={detailed} />
        ))}
      </div>
    </section>
  );
}

function BriefingSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading briefing">
      {[0, 1, 2].map((i) => (
        <div key={i} className="terminal-panel p-6 mb-6 animate-pulse">
          <div className="h-4 w-40 bg-[#E4E9EF] dark:bg-[#2B3644] rounded mb-4" />
          {[0, 1, 2].map((j) => (
            <div key={j} className="py-2.5 space-y-2">
              <div className="h-3 w-3/4 bg-[#E4E9EF] dark:bg-[#2B3644] rounded" />
              <div className="h-3 w-1/2 bg-[#E4E9EF] dark:bg-[#2B3644] rounded" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ResearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";

  const tabParam = searchParams.get("tab") as ResearchTab | null;
  const [tab, setTab] = useState<ResearchTab>(
    tabParam === "screening" || tabParam === "notes" ? tabParam : "briefing"
  );

  const [briefing, setBriefing] = useState<BriefingPayload | null>(null);
  const [briefingDates, setBriefingDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [briefingNotFound, setBriefingNotFound] = useState(false);
  const [view, setView] = useState<BriefingView>("advisor");
  const [notes, setNotes] = useState<ResearchNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);

  // New research note form state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [targetType, setTargetType] = useState("scheme");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadBriefing = useCallback(async (date?: string) => {
    setBriefingLoading(true);
    setBriefingNotFound(false);
    setError(null);
    try {
      const payload = await getBriefing(date || undefined);
      setBriefing(payload);
      setSelectedDate(payload.brief_date);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setBriefing(null);
        setBriefingNotFound(true);
        if (date) setSelectedDate(date);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load briefing");
      }
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tabParam === "screening" || tabParam === "notes" || tabParam === "briefing") {
      setTab(tabParam);
    }
  }, [tabParam]);

  // Scope the print stylesheet to the briefing tab only.
  useEffect(() => {
    const body = document.body;
    if (tab === "briefing") {
      body.classList.add("print-briefing");
    } else {
      body.classList.remove("print-briefing");
    }
    return () => {
      body.classList.remove("print-briefing");
    };
  }, [tab]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [datesRes, notesRes] = await Promise.all([
          getBriefingDates().catch(() => [] as string[]),
          getResearchNotes(),
        ]);
        setBriefingDates(datesRes);
        setNotes(notesRes || []);
        await loadBriefing();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load research data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadBriefing]);

  function handleTabChange(nextTab: ResearchTab) {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleDateChange(nextDate: string) {
    if (!nextDate) return;
    loadBriefing(nextDate);
  }

  async function handleRebuild() {
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const res = await rebuildBriefing();
      setRebuildMsg(res.ok ? `Rebuilt briefing for ${res.brief_date}.` : "Rebuild request accepted.");
      const datesRes = await getBriefingDates().catch(() => [] as string[]);
      setBriefingDates(datesRes);
      await loadBriefing(res.brief_date || undefined);
    } catch (err: unknown) {
      setRebuildMsg(err instanceof Error ? err.message : "Rebuild failed");
    } finally {
      setRebuilding(false);
    }
  }

  function handleDownloadPdf() {
    window.print();
  }

  async function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      const created = await createResearchNote({
        target_type: targetType,
        target_id: targetId.trim() || "GENERAL",
        title: title.trim(),
        content: content.trim(),
      });
      setNotes([created, ...notes]);
      setTitle("");
      setContent("");
      setTargetId("");
      setShowNoteForm(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setSubmitting(false);
    }
  }

  const orderedSections = briefing
    ? orderSections(
        briefing.sections,
        view === "advisor" ? ADVISOR_ORDER : ANALYST_ORDER
      ).filter((s) => view === "analyst" || ADVISOR_ORDER.includes(s.key))
    : [];

  const minDate = briefingDates.length ? briefingDates[briefingDates.length - 1] : undefined;
  const maxDate = briefingDates.length ? briefingDates[0] : undefined;

  if (loading) {
    return <BriefingSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644] ${printStyles.noPrint}`}>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Market Briefings, Research &amp; Fund Screening
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Internal Research
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Daily market briefings, strategy evaluations, analyst commentary, and systematic fund screening
          </p>
        </div>

        {/* Tab Switcher (matches PMS page pattern) */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <button
            onClick={() => handleTabChange("briefing")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "briefing"
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            Briefing
          </button>
          <button
            onClick={() => handleTabChange("notes")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "notes"
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            Analyst Notes ({notes.length})
          </button>
          <button
            onClick={() => handleTabChange("screening")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "screening"
                ? "bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                : ""
            }`}
          >
            Fund Screening
          </button>
        </div>
      </div>

      {error && (
        <div className={`terminal-panel p-3 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[12px] ${printStyles.noPrint}`}>
          {error}
        </div>
      )}

      {/* TAB 1: BRIEFING VIEW */}
      {tab === "briefing" && (
        <div className="space-y-4">
          {/* Briefing header: title, date, controls */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
                  Daily Briefing
                </h2>
                <div className="text-[12px] text-[#536176] dark:text-[#A8B4C4] font-mono mt-0.5">
                  {briefing ? (
                    <>
                      {formatBriefDate(briefing.brief_date)}
                      <span className="mx-1.5">·</span>
                      Generated {formatISTTimeHM(briefing.generated_at)}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </div>

              <div className={`flex flex-wrap items-center gap-2 ${printStyles.noPrint}`}>
                {/* Archive date picker */}
                <label className="text-[11px] text-[#536176] dark:text-[#A8B4C4] flex items-center gap-1.5">
                  Archive
                  <input
                    type="date"
                    value={selectedDate}
                    min={minDate}
                    max={maxDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="terminal-input text-[12px] py-1 px-2 font-mono"
                    aria-label="Briefing archive date"
                  />
                </label>

                {/* Advisor / Analyst toggle */}
                <div
                  className="flex items-center gap-1 p-0.5 rounded border border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27]"
                  role="group"
                  aria-label="Briefing view"
                >
                  {(["advisor", "analyst"] as BriefingView[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`text-[12px] py-1 px-3 rounded capitalize ${
                        view === v
                          ? "bg-[#006F64] text-white dark:bg-[#75E1CE] dark:text-[#10151C] font-medium"
                          : "text-[#536176] dark:text-[#A8B4C4]"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleDownloadPdf}
                  className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download PDF
                </button>

                {isAdmin && (
                  <button
                    onClick={handleRebuild}
                    disabled={rebuilding}
                    className="terminal-btn text-[12px] py-1 px-2.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                  >
                    {rebuilding ? "Rebuilding…" : "Rebuild"}
                  </button>
                )}
              </div>
            </div>

            {rebuildMsg && (
              <div className={`text-[12px] text-[#536176] dark:text-[#A8B4C4] ${printStyles.noPrint}`}>
                {rebuildMsg}
              </div>
            )}
          </div>

          {briefingLoading && <BriefingSkeleton />}

          {!briefingLoading && briefingNotFound && (
            <div className="terminal-panel p-8 text-center space-y-3">
              <div className="text-[14px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                No briefing stored for {selectedDate || "this date"}
              </div>
              <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                Briefings are stored once a day. Pick another date from the archive or return to the latest.
              </p>
              <button
                onClick={() => loadBriefing()}
                className="terminal-btn text-[12px] py-1 px-3"
              >
                Go to latest
              </button>
            </div>
          )}

          {!briefingLoading && !briefingNotFound && briefing && (
            <>
              {orderedSections.map((section) => (
                <BriefingSectionCard
                  key={section.key}
                  section={section}
                  detailed={view === "analyst"}
                />
              ))}
              <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] pt-2 border-t border-[#E4E9EF] dark:border-[#2B3644]">
                {briefingCopy.disclaimer}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: ANALYST NOTES VIEW */}
      {tab === "notes" && (
        <div className="space-y-4">
          <div className={`flex justify-end ${printStyles.noPrint}`}>
            <button
              onClick={() => setShowNoteForm(!showNoteForm)}
              className="terminal-btn text-[12px] py-1 px-2.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
            >
              {showNoteForm ? "Cancel Note" : "+ New Research Note"}
            </button>
          </div>

          {/* Note Creation Form */}
          {showNoteForm && (
            <form onSubmit={handleCreateNote} className="terminal-panel p-3.5 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-[#006F64] dark:text-[#75E1CE]">
                  New Internal Research Note
                </span>
                <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">Staff Memo</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                    Target Instrument
                  </label>
                  <select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value)}
                    className="terminal-input w-full text-[12px] py-1 px-2"
                  >
                    <option value="scheme">Mutual Fund Scheme</option>
                    <option value="strategy">PMS Strategy</option>
                    <option value="issuer">Micro Issuer / Stock</option>
                    <option value="macro">Macro Indicator</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                    Identifier (Code or Symbol)
                  </label>
                  <input
                    type="text"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="e.g. 119551 or INFY"
                    className="terminal-input w-full text-[12px] py-1 px-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                  Note Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Q2 Portfolio Rebalancing Commentary"
                  className="terminal-input w-full text-[12px] py-1 px-2"
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
                  Research Content &amp; Rationale
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={3}
                  placeholder="Detail observations, macro context, fee structure, or risk flags…"
                  className="terminal-input w-full text-[12px] py-1 px-2"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNoteForm(false)}
                  className="terminal-btn text-[12px] py-1 px-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="terminal-btn text-[12px] py-1 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
                >
                  {submitting ? "Saving Note…" : "Publish Research Note"}
                </button>
              </div>
            </form>
          )}

          {/* Notes List */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E4E9EF] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
              Internal Analyst Research Notes ({notes.length})
            </div>

            {notes.length === 0 ? (
              <div className="p-8 text-center text-[12px] text-[#536176] dark:text-[#A8B4C4]">
                No research notes published yet. Click &quot;+ New Research Note&quot; to log internal analysis.
              </div>
            ) : (
              <div className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
                {notes.map((n) => (
                  <div key={n.id} className="p-3 hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition-colors space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">{n.title}</span>
                        <span className="text-[10px] font-mono uppercase bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4] px-1.5 py-0.2 rounded">
                          {n.target_type}: {n.target_id}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
                        {formatISTDate(n.created_at)}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] leading-relaxed">
                      {n.content}
                    </p>
                    <div className="text-[10px] text-[#536176]/80 dark:text-[#A8B4C4]/80 font-mono">
                      Author: {n.author_name || "Staff Analyst"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: FUND SCREENING VIEW */}
      {tab === "screening" && <FundScreening />}
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px]">
          Loading research hub…
        </div>
      }
    >
      <ResearchPageContent />
    </Suspense>
  );
}
