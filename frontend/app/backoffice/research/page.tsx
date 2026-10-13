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
import { StatusBadge } from "@/components/backoffice/StatusBadge";

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

  if (loading) {
    return (
      <div className="p-8 text-center text-sand-500 font-mono text-xs flex items-center justify-center gap-2">
        <svg className="animate-spin h-4 w-4 text-forest-700" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading research briefing & notes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700">
        <div className="font-semibold mb-1">Failed to load research data</div>
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sand-200">
        <div>
          <h1 className="text-xl font-semibold text-sand-950 tracking-tight">Research Notes & Daily Briefing</h1>
          <p className="text-xs text-sand-600 mt-0.5">
            Deterministic market briefing (zero LLM calls) • Internal analyst memos & instrument watch commentary
          </p>
        </div>
        <button
          onClick={() => setShowNoteForm(!showNoteForm)}
          className="px-3.5 py-1.5 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 transition-colors shadow-xs"
        >
          {showNoteForm ? "Cancel Memo" : "+ New Research Note"}
        </button>
      </div>

      {/* Note Creation Modal / Inline Drawer */}
      {showNoteForm && (
        <form onSubmit={handleCreateNote} className="p-5 bg-white rounded-2xl border border-sand-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-sand-100">
            <h2 className="text-xs font-semibold text-sand-900 uppercase tracking-wider">New Research Note</h2>
            <span className="text-[10px] text-sand-500 font-mono">Staff Internal</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Target Instrument Type</label>
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 bg-white focus:outline-none focus:ring-2 focus:ring-forest-600"
              >
                <option value="strategy">PMS Strategy</option>
                <option value="scheme">Mutual Fund Scheme</option>
                <option value="issuer">Micro Issuer / Stock</option>
                <option value="macro">Macro Indicator</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-sand-700 block mb-1">Identifier (e.g. 119551 or NIFTY)</label>
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="Code or Symbol"
                className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-sand-700 block mb-1">Memo Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Q2 Portfolio Rebalancing Commentary"
              className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              required
            />
          </div>

          <div>
            <label className="text-xs font-medium text-sand-700 block mb-1">Content & Rationale</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="Detail observations, macro context, fee analysis, or risks…"
              className="w-full px-3 py-2 text-xs rounded-xl border border-sand-300 focus:outline-none focus:ring-2 focus:ring-forest-600 font-sans"
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowNoteForm(false)}
              className="px-3 py-1.5 text-xs text-sand-600 hover:text-sand-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-forest-700 text-white rounded-xl text-xs font-semibold hover:bg-forest-800 disabled:opacity-50"
            >
              {submitting ? "Saving Note…" : "Publish Research Note"}
            </button>
          </div>
        </form>
      )}

      {/* Deterministic Daily Briefing Card */}
      {briefing && briefing.data && (
        <div className="p-6 bg-white rounded-2xl border border-sand-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-sand-100">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-sand-900">{briefing.data.title}</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-50 text-emerald-800 rounded border border-emerald-200">
                  Zero Paid LLM
                </span>
              </div>
              <div className="text-[11px] text-sand-500 mt-0.5 font-mono">
                {briefing.data.method_version} • Generated {briefing.data.as_of}
              </div>
            </div>
            <StatusBadge
              availability="ready"
              freshness="current"
              frequency="daily"
              units="Multi-Asset Observational Brief"
            />
          </div>

          <ul className="space-y-3">
            {briefing.data.bullets.map((b, idx) => (
              <li key={idx} className="text-xs text-sand-800 flex items-start gap-3">
                <span className="text-forest-700 font-bold mt-0.5 text-sm">•</span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>

          <div className="text-[11px] text-sand-500 pt-3 border-t border-sand-100 italic">
            {briefing.data.disclaimer}
          </div>
        </div>
      )}

      {/* Research Notes Feed */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-sand-900">Analyst Research Notes & Memos ({notes.length})</h2>
        {notes.length === 0 ? (
          <div className="p-8 text-center text-xs text-sand-500 bg-white rounded-2xl border border-sand-200">
            No research notes published yet. Click &quot;+ New Research Note&quot; to log internal analysis.
          </div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="p-5 bg-white rounded-2xl border border-sand-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-sand-900">{n.title}</span>
                  <span className="text-[10px] font-mono uppercase bg-sand-100 text-sand-700 px-1.5 py-0.5 rounded">
                    {n.target_type}: {n.target_id}
                  </span>
                </div>
                <span className="text-[11px] text-sand-500 font-mono">{n.created_at?.slice(0, 10)}</span>
              </div>
              <p className="text-xs text-sand-700 leading-relaxed font-sans">{n.content}</p>
              <div className="text-[10px] text-sand-400 font-mono">Author: {n.author_name || "Staff Analyst"}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
