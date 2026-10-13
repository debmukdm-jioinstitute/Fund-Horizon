"use client";

import React, { useEffect, useState } from "react";
import {
  getDeterministicBriefing,
  getResearchNotes,
  createResearchNote,
  DeterministicBriefingData,
  BackofficeEnvelope,
  ResearchNoteItem,
} from "@/lib/backoffice";
import { formatISTDate } from "@/lib/terminal-format";

export default function ResearchPage() {
  const [briefing, setBriefing] = useState<BackofficeEnvelope<DeterministicBriefingData> | null>(null);
  const [notes, setNotes] = useState<ResearchNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New research note form state
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [targetType, setTargetType] = useState("strategy");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [briefingRes, notesRes] = await Promise.all([
          getDeterministicBriefing(),
          getResearchNotes(),
        ]);
        setBriefing(briefingRes);
        setNotes(notesRes || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load research briefing & notes");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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

  function handleDownloadBriefing() {
    if (!briefing?.data) return;
    const textContent = `${briefing.data.title}\nDate: ${briefing.data.as_of}\n\n` +
      briefing.data.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n\n") +
      `\n\nDisclaimer: ${briefing.data.disclaimer}`;
    const element = document.createElement("a");
    const file = new Blob([textContent], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `market_briefing_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }

  if (loading && !briefing) {
    return (
      <div className="p-8 text-center text-[#536176] dark:text-[#A8B4C4] font-mono text-[13px] flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading research briefings &amp; notes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="terminal-panel p-4 border border-[#B42332]/30 bg-[#B42332]/5 text-[#B42332] dark:text-[#FF7D86] text-[13px]">
        <div className="font-medium mb-1">Failed to load research data</div>
        <div>{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-medium text-[#172033] dark:text-[#EDF2F7] tracking-tight">
              Market Briefings &amp; Analyst Research Notes
            </h1>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4]">
              Internal Research
            </span>
          </div>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Daily market briefings, strategy evaluations, and internal analyst commentary
          </p>
        </div>

        <div className="flex items-center gap-2">
          {briefing?.data && (
            <button
              onClick={handleDownloadBriefing}
              className="terminal-btn text-[12px] py-1 px-2.5 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Briefing
            </button>
          )}
          <button
            onClick={() => setShowNoteForm(!showNoteForm)}
            className="terminal-btn text-[12px] py-1 px-2.5 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
          >
            {showNoteForm ? "Cancel Note" : "+ New Research Note"}
          </button>
        </div>
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
                <option value="strategy">PMS Strategy</option>
                <option value="scheme">Mutual Fund Scheme</option>
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

      {/* Daily Market Briefing */}
      {briefing && briefing.data && (
        <div className="terminal-panel p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-2 border-b border-[#E4E9EF] dark:border-[#2B3644]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] px-1.5 py-0.5 rounded font-medium">
                Briefing
              </span>
              <h2 className="text-[14px] font-medium text-[#172033] dark:text-[#EDF2F7]">
                {briefing.data.title}
              </h2>
            </div>
            <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4] font-mono">
              Published: {formatISTDate(briefing.data.as_of)}
            </span>
          </div>

          <ul className="space-y-2 text-[13px] text-[#172033] dark:text-[#EDF2F7]">
            {briefing.data.bullets.map((b, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-[#006F64] dark:text-[#75E1CE] font-bold select-none">•</span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>

          <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4] pt-2 border-t border-[#E4E9EF] dark:border-[#2B3644]">
            {briefing.data.disclaimer}
          </div>
        </div>
      )}

      {/* Analyst Research Notes Flat Table / List */}
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
  );
}
