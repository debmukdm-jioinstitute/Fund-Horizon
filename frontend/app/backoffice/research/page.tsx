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

// Item 1-frontend: advisor caps per section key (regulatory max 8, short market
// pulse max 5, every other advisor section max 8).
const ADVISOR_ITEM_CAPS: Record<string, number> = {
  regulatory_news: 8,
  market_pulse: 5,
};
const ADVISOR_DEFAULT_CAP = 8;

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

function formatISTDateTimeHM(dateInput?: string | number | Date | null): string {
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

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Item 11: show the real observation time. When only a date is known, show the
// date with no time (never a fake "00:00 IST").
function formatAsOf(asOf?: string): string {
  if (!asOf) return "—";
  const trimmed = asOf.trim();
  if (DATE_ONLY_RE.test(trimmed)) return formatBriefDate(trimmed);
  return formatISTDateTimeHM(trimmed);
}

function itemAgeHours(asOf?: string): number | null {
  if (!asOf) return null;
  const t = new Date(asOf).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / 3600000;
}

function isFxItem(sectionKey: string, item: BriefingItem): boolean {
  if (sectionKey !== "market_pulse") return false;
  const hay = `${item.text ?? ""} ${item.value ?? ""} ${item.source ?? ""}`.toUpperCase();
  return /USD\/INR|EUR\/INR|GBP\/INR|\bFX\b|USDINR/.test(hay);
}

// Item 11: stale flags — FX older than 1 trading day, screening/PMS older than
// 7 days. An explicit payload flag always wins; otherwise derive from as_of.
function itemIsStale(sectionKey: string, item: BriefingItem): boolean {
  if (item.stale === true) return true;
  const age = itemAgeHours(item.as_of);
  if (age == null || age < 0) return false;
  if (isFxItem(sectionKey, item)) return age > 36; // ~1 trading day, weekend-safe
  if (sectionKey === "screening_changes" || sectionKey === "pms") return age > 7 * 24;
  return false;
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

// Item 14: percentages to 2 dp, plain numeric changes to 2 dp, bps/FX keep their
// backend unit formatting. Every change gets an arrow plus colour by sign;
// flat shows "—".
function ChangeMark({ item }: { item: BriefingItem }) {
  const pct = item.change_pct;
  let sign: 1 | -1 | 0 = 0;
  let text: string | null = null;

  if (typeof pct === "number" && isFinite(pct)) {
    sign = pct > 1e-9 ? 1 : pct < -1e-9 ? -1 : 0;
    text = sign === 0 ? "—" : `${sign > 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;
  } else if (item.change != null && item.change.trim() !== "") {
    const m = /([+-−]?\d[\d,]*(\.\d+)?)/.exec(item.change.replace(/−/g, "-"));
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (isFinite(n)) {
        sign = n > 1e-9 ? 1 : n < -1e-9 ? -1 : 0;
        if (sign === 0) {
          text = "—";
        } else if (/bps|%|₹|\$|cr/i.test(item.change)) {
          // Backend-formatted unit strings (bps as integers, FX to 2 dp) stay as-is.
          text = item.change;
        } else {
          text = `${sign > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
        }
      }
    }
  }

  const upCls = "text-[#0E7C3A] dark:text-[#6FD598]";
  const downCls = "text-[#B42332] dark:text-[#FF7D86]";
  const flatCls = "text-[#706E6B] dark:text-[#A8B4C4]";

  if (text == null) {
    // No numeric change on file: fall back to the backend direction for the
    // arrow only, without inventing a number.
    if (item.direction === "up")
      return <span className={`font-mono text-[12px] font-medium ${upCls}`}>▲</span>;
    if (item.direction === "down")
      return <span className={`font-mono text-[12px] font-medium ${downCls}`}>▼</span>;
    return null;
  }
  const cls = sign > 0 ? upCls : sign < 0 ? downCls : flatCls;
  const arrow = sign > 0 ? "▲ " : sign < 0 ? "▼ " : "";
  return (
    <span className={`font-mono text-[12px] font-medium ${cls}`}>
      {arrow}
      {text}
    </span>
  );
}

function BriefingItemRow({
  item,
  sectionKey,
  detailed,
}: {
  item: BriefingItem;
  sectionKey: string;
  detailed: boolean;
}) {
  const headline = item.value ?? item.text ?? "—";
  const stale = itemIsStale(sectionKey, item);
  const sourceUrl = item.source_url ?? undefined;
  // Item 15: when the source link equals the details link, render just one.
  const detailsUrl = item.link && item.link !== sourceUrl ? item.link : undefined;
  return (
    <div className={`py-2.5 border-b border-[#E5E5E5] dark:border-[#2B3644] last:border-b-0 space-y-1 ${printStyles.item}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-[#181818] dark:text-[#EDF2F7]">{headline}</span>
        <ChangeMark item={item} />
        {stale && (
          <span
            className="text-[10px] font-mono uppercase px-1 py-0.5 rounded border border-[#B42332]/40 text-[#B42332] dark:text-[#FF7D86]"
            title="Observation is older than the freshness limit for this source"
          >
            Stale
          </span>
        )}
      </div>
      {item.text != null && item.value != null && item.text !== item.value && (
        <p className="text-[12px] text-[#181818] dark:text-[#EDF2F7] leading-relaxed">{item.text}</p>
      )}
      {item.so_what != null && (
        <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] leading-relaxed">{item.so_what}</p>
      )}
      {detailed && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-[#706E6B] dark:text-[#A8B4C4]">
          {item.as_of != null && <span>{formatAsOf(item.as_of)}</span>}
          {item.source != null && (
            <span>
              {sourceUrl != null ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-[#0176D3] dark:text-[#1B96FF] hover:underline"
                >
                  {item.source}
                </a>
              ) : (
                item.source
              )}
            </span>
          )}
          {detailsUrl != null && (
            <a
              href={detailsUrl}
              target="_blank"
              rel="noopener"
              className="text-[#0176D3] dark:text-[#1B96FF] hover:underline"
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
  // Item 9: empty sections show the backend reason string, never a generic blank.
  if (section.items.length === 0) {
    return (
      <details className={`terminal-panel p-6 mb-6 ${printStyles.card}`}>
        <summary className="cursor-pointer text-[13px] font-medium text-[#706E6B] dark:text-[#A8B4C4] list-none flex items-center gap-2">
          <span aria-hidden="true">▸</span>
          <span>{section.title || section.key}</span>
          <span className="text-[11px] font-mono">— no items</span>
        </summary>
        <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-2">
          {section.note ?? "No data for this section in this briefing."}
        </p>
      </details>
    );
  }
  return (
    <section className={`terminal-panel p-6 mb-6 ${printStyles.card}`}>
      <h2 className="text-[14px] font-semibold text-[#181818] dark:text-[#EDF2F7] mb-4">
        {section.title || section.key}
      </h2>
      {section.note != null && (
        <p className="text-[11px] font-mono text-[#706E6B] dark:text-[#A8B4C4] -mt-2 mb-3">
          {section.note}
        </p>
      )}
      <div>
        {section.items.map((item, idx) => (
          <BriefingItemRow key={idx} item={item} sectionKey={section.key} detailed={detailed} />
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
          <div className="h-4 w-40 bg-[#E5E5E5] dark:bg-[#2B3644] rounded mb-4" />
          {[0, 1, 2].map((j) => (
            <div key={j} className="py-2.5 space-y-2">
              <div className="h-3 w-3/4 bg-[#E5E5E5] dark:bg-[#2B3644] rounded" />
              <div className="h-3 w-1/2 bg-[#E5E5E5] dark:bg-[#2B3644] rounded" />
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

  // Item 7: URL state ?tab=briefing&view=analyst|advisor&date=YYYY-MM-DD,
  // restored on reload. Default view: advisor.
  const viewParam = searchParams.get("view");
  const dateParam = searchParams.get("date");
  const initialView: BriefingView =
    viewParam === "analyst" || viewParam === "advisor" ? viewParam : "advisor";
  const initialDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : "";

  const [briefing, setBriefing] = useState<BriefingPayload | null>(null);
  const [briefingDates, setBriefingDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [briefingNotFound, setBriefingNotFound] = useState(false);
  const [view, setView] = useState<BriefingView>(initialView);
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
        // Item 7: honour a valid ?date= param on load; otherwise latest.
        await loadBriefing(initialDate || undefined);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load research data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadBriefing, initialDate]);

  function handleTabChange(nextTab: ResearchTab) {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function syncBriefingUrl(nextView: BriefingView, nextDate?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "briefing");
    params.set("view", nextView);
    if (nextDate) params.set("date", nextDate);
    else params.delete("date");
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handleViewChange(nextView: BriefingView) {
    setView(nextView);
    syncBriefingUrl(nextView, selectedDate || undefined);
  }

  function handleDateChange(nextDate: string) {
    // Item 8: only dates with a stored brief (from /briefing/dates) are
    // requestable; the picker only offers those.
    if (!nextDate || !briefingDates.includes(nextDate)) return;
    syncBriefingUrl(view, nextDate);
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

  // Item 1-frontend: advisor shows exactly the 5 composed sections by key
  // (client_actions, fund_movers, cost_manager_changes, regulatory_news,
  // market_pulse) with per-section item caps (regulatory ≤ 8, pulse ≤ 5).
  const orderedSections = briefing
    ? orderSections(
        briefing.sections,
        view === "advisor" ? ADVISOR_ORDER : ANALYST_ORDER
      )
        .filter((s) => view === "analyst" || ADVISOR_ORDER.includes(s.key))
        .map((s) =>
          view === "advisor"
            ? { ...s, items: s.items.slice(0, ADVISOR_ITEM_CAPS[s.key] ?? ADVISOR_DEFAULT_CAP) }
            : s
        )
    : [];



  if (loading) {
    return <BriefingSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644] ${printStyles.noPrint}`}>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">
              Market Briefings, Research &amp; Fund Screening
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] text-[#706E6B] dark:text-[#A8B4C4]">
              Internal Research
            </span>
          </div>
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
            Daily market briefings, strategy evaluations, analyst commentary, and systematic fund screening
          </p>
        </div>

        {/* Tab Switcher (matches PMS page pattern) */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <button
            onClick={() => handleTabChange("briefing")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "briefing"
                ? "bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
                : ""
            }`}
          >
            Briefing
          </button>
          <button
            onClick={() => handleTabChange("notes")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "notes"
                ? "bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
                : ""
            }`}
          >
            Analyst Notes ({notes.length})
          </button>
          <button
            onClick={() => handleTabChange("screening")}
            className={`terminal-btn text-[12px] py-1 px-3 ${
              tab === "screening"
                ? "bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
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
          {/* Item 13: print-only header with generated_at in IST and the view name */}
          {briefing && (
            <div className={printStyles.printHeader} aria-hidden="true">
              <div className="text-[16px] font-semibold">
                Daily Briefing — {formatBriefDate(briefing.brief_date)}
              </div>
              <div className="text-[11px] font-mono">
                {view === "advisor" ? "Advisor" : "Analyst"} view · Generated{" "}
                {formatISTDateTimeHM(briefing.generated_at)}
              </div>
            </div>
          )}
          {/* Briefing header: title, date, controls */}
          <div className={`flex flex-col gap-3 ${printStyles.noPrint}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                {/* Item 8: header reads "Daily Briefing — {date}" */}
                <h2 className="text-[18px] font-medium text-[#181818] dark:text-[#EDF2F7] tracking-tight">
                  {briefing ? `Daily Briefing — ${formatBriefDate(briefing.brief_date)}` : "Daily Briefing"}
                </h2>
                <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] font-mono mt-0.5">
                  {briefing ? (
                    <>Generated {formatISTDateTimeHM(briefing.generated_at)}</>
                  ) : (
                    "—"
                  )}
                </div>
              </div>

              <div className={`flex flex-wrap items-center gap-2 ${printStyles.noPrint}`}>
                {/* Item 8: archive lists only dates with a stored brief, from /briefing/dates */}
                <label className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] flex items-center gap-1.5">
                  Archive
                  <select
                    value={selectedDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="terminal-input text-[12px] py-1 px-2 font-mono"
                    aria-label="Briefing archive date"
                  >
                    {briefingDates.length === 0 && <option value="">No archive</option>}
                    {briefingDates.map((d) => (
                      <option key={d} value={d}>
                        {formatBriefDate(d)}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Advisor / Analyst toggle */}
                <div
                  className="flex items-center gap-1 p-0.5 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27]"
                  role="group"
                  aria-label="Briefing view"
                >
                  {(["advisor", "analyst"] as BriefingView[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => handleViewChange(v)}
                      aria-label={v === "advisor" ? "Advisor" : "Analyst"}
                      aria-pressed={view === v}
                      className={`text-[12px] py-1 px-3 rounded capitalize ${
                        view === v
                          ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C] font-medium"
                          : "text-[#706E6B] dark:text-[#A8B4C4]"
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
                    className="terminal-btn text-[12px] py-1 px-2.5 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
                  >
                    {rebuilding ? "Rebuilding…" : "Rebuild"}
                  </button>
                )}
              </div>
            </div>

            {rebuildMsg && (
              <div className={`text-[12px] text-[#706E6B] dark:text-[#A8B4C4] ${printStyles.noPrint}`}>
                {rebuildMsg}
              </div>
            )}
          </div>

          {briefingLoading && <BriefingSkeleton />}

          {!briefingLoading && briefingNotFound && (
            <div className="terminal-panel p-8 text-center space-y-3">
              <div className="text-[14px] font-medium text-[#181818] dark:text-[#EDF2F7]">
                No briefing stored for {selectedDate || "this date"}
              </div>
              <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
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
              <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] pt-2 border-t border-[#E5E5E5] dark:border-[#2B3644]">
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
              className="terminal-btn text-[12px] py-1 px-2.5 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
            >
              {showNoteForm ? "Cancel Note" : "+ New Research Note"}
            </button>
          </div>

          {/* Note Creation Form */}
          {showNoteForm && (
            <form onSubmit={handleCreateNote} className="terminal-panel p-3.5 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[#E5E5E5] dark:border-[#2B3644]">
                <span className="text-[12px] font-semibold uppercase tracking-wider text-[#0176D3] dark:text-[#1B96FF]">
                  New Internal Research Note
                </span>
                <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-mono">Staff Memo</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
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
                  <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
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
                <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
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
                <label className="text-[11px] font-medium text-[#706E6B] dark:text-[#A8B4C4] block mb-1">
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
                  className="terminal-btn text-[12px] py-1 px-3 bg-[#0176D3] text-white border-[#0176D3] dark:bg-[#1B96FF] dark:text-[#10151C] dark:border-[#1B96FF] font-medium"
                >
                  {submitting ? "Saving Note…" : "Publish Research Note"}
                </button>
              </div>
            </form>
          )}

          {/* Notes List */}
          <div className="terminal-panel overflow-hidden">
            <div className="p-2.5 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[11px] font-semibold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4]">
              Internal Analyst Research Notes ({notes.length})
            </div>

            {notes.length === 0 ? (
              <div className="p-8 text-center text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                No research notes published yet. Click &quot;+ New Research Note&quot; to log internal analysis.
              </div>
            ) : (
              <div className="divide-y divide-[#E5E5E5] dark:divide-[#2B3644]">
                {notes.map((n) => (
                  <div key={n.id} className="p-3 hover:bg-[#F3F3F3] dark:hover:bg-[#171E27] transition-colors space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">{n.title}</span>
                        <span className="text-[10px] font-mono uppercase bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] text-[#706E6B] dark:text-[#A8B4C4] px-1.5 py-0.2 rounded">
                          {n.target_type}: {n.target_id}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] font-mono">
                        {formatISTDate(n.created_at)}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] leading-relaxed">
                      {n.content}
                    </p>
                    <div className="text-[10px] text-[#706E6B]/80 dark:text-[#A8B4C4]/80 font-mono">
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
        <div className="p-8 text-center text-[#706E6B] dark:text-[#A8B4C4] font-mono text-[13px]">
          Loading research hub…
        </div>
      }
    >
      <ResearchPageContent />
    </Suspense>
  );
}
