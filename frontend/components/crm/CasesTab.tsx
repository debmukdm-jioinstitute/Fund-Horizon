// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CaseStatus,
  CrmCase,
  createCase,
  getCases,
  patchCase,
} from "../../lib/crmProductsApi";
import { ApiError } from "../../lib/api";
import { caseSchema, fieldErrors } from "../../lib/crmSchemas";

const CATEGORIES = [
  "onboarding",
  "kyc",
  "mandate",
  "transaction",
  "folio",
  "charges",
  "disclosure",
  "platform",
  "data_privacy",
  "other",
];

/** open -> in_progress -> resolved -> closed */
const ADVANCE: Record<CaseStatus, CaseStatus | null> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: "closed",
  escalated_amc: "resolved",
  escalated_scores: "resolved",
  closed: null,
};

/** Escalation chain: in_progress/open -> escalated_amc -> escalated_scores */
const ESCALATE: Record<CaseStatus, CaseStatus | null> = {
  open: "escalated_amc",
  in_progress: "escalated_amc",
  escalated_amc: "escalated_scores",
  resolved: null,
  escalated_scores: null,
  closed: null,
};

function isResolved(status: CaseStatus): boolean {
  return status === "resolved" || status === "closed";
}

function slaBadge(c: CrmCase): { label: string; cls: string } {
  if (isResolved(c.status)) return { label: "Resolved", cls: "bg-gray-100 text-gray-600" };
  if (!c.sla_due_at) return { label: "No SLA set", cls: "bg-[#F3F3F3] text-[#706E6B]" };
  const due = new Date(c.sla_due_at).getTime();
  const now = Date.now();
  if (due < now) return { label: "SLA breached", cls: "bg-rose-100 text-rose-700" };
  if (due - now < 24 * 60 * 60 * 1000) return { label: "SLA due soon", cls: "bg-amber-100 text-amber-600" };
  return { label: "On track", cls: "bg-[#D8E6FE] text-[#0176D3]" };
}

function statusChip(status: CaseStatus): string {
  switch (status) {
    case "open":
      return "bg-amber-100 text-amber-600";
    case "in_progress":
      return "bg-[#ECEBEA] text-[#444444]";
    case "escalated_amc":
    case "escalated_scores":
      return "bg-rose-100 text-rose-700";
    case "resolved":
      return "bg-[#D8E6FE] text-[#0176D3]";
    case "closed":
      return "bg-gray-100 text-gray-600";
  }
}

export default function CasesTab() {
  const [cases, setCases] = useState<CrmCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [category, setCategory] = useState("onboarding");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [slaDueAt, setSlaDueAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCases(await getCases());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load cases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ordered = useMemo(() => {
    const rank = (c: CrmCase) => {
      if (!isResolved(c.status) && c.sla_due_at && new Date(c.sla_due_at).getTime() < Date.now()) return 0;
      if (c.status === "open") return 1;
      if (c.status === "in_progress") return 2;
      if (c.status.startsWith("escalated")) return 3;
      return 4;
    };
    return [...cases].sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
  }, [cases]);

  const updateStatus = async (c: CrmCase, status: CaseStatus) => {
    setBusyId(c.id);
    try {
      const updated = await patchCase(c.id, { status });
      setCases((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update the case.");
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) return;
    const errs = fieldErrors(caseSchema, { subject, category });
    if (errs) {
      setError(Object.values(errs).join(". "));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createCase({
        customer_id: customerId.trim(),
        category,
        subject: subject.trim(),
        body: body.trim() || undefined,
        sla_due_at: slaDueAt ? `${slaDueAt}:00+05:30` : undefined, // entered in IST
      });
      setCases((prev) => [created, ...prev]);
      setCustomerId("");
      setSubject("");
      setBody("");
      setSlaDueAt("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the case.");
    } finally {
      setSaving(false);
    }
  };

  const openCount = cases.filter((c) => !isResolved(c.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#181818]">
          Grievance queue <span className="font-semibold text-[#706E6B]">({openCount} open)</span>
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#181818] text-white hover:bg-[#444444]"
        >
          {showForm ? "Close" : "+ New case"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-100 border border-rose-600/30 text-rose-700 text-xs rounded-xl px-4 py-3">{error}</div>
      )}

      {showForm && (
        <form onSubmit={create} className="bg-white border border-[#E5E5E5] rounded-2xl p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Customer ID</span>
              <input
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="customer id"
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
                required
              />
            </label>
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>SLA due</span>
              <input
                type="datetime-local"
                value={slaDueAt}
                onChange={(e) => setSlaDueAt(e.target.value)}
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
              />
            </label>
          </div>
          <label className="text-xs font-semibold text-[#444444] space-y-1 block">
            <span>Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary of the grievance"
              className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
              required
            />
          </label>
          <label className="text-xs font-semibold text-[#444444] space-y-1 block">
            <span>Details</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#0176D3] text-white hover:bg-[#014486] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Raise case"}
          </button>
        </form>
      )}

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="p-16 text-center">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-[#0176D3] border-t-transparent rounded-full" />
        </div>
      ) : ordered.length === 0 ? (
        <p className="text-xs text-[#706E6B] text-center py-8">No cases in the queue.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {ordered.map((c) => {
            const sla = slaBadge(c);
            const busy = busyId === c.id;
            const advanceTo = ADVANCE[c.status];
            const escalateTo = ESCALATE[c.status];
            return (
              <div key={c.id} className="bg-white border border-[#E5E5E5] rounded-xl p-3 space-y-2 shadow-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${statusChip(c.status)}`}>
                    {c.status.replaceAll("_", " ")}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${sla.cls}`}>{sla.label}</span>
                  <span className="text-xs text-[#706E6B] ml-auto">{c.category}</span>
                </div>
                <p className="text-xs font-semibold text-[#181818] leading-snug">{c.subject}</p>
                {c.customer_name && <p className="text-xs text-[#706E6B]">{c.customer_name}</p>}
                {c.body && <p className="text-xs text-[#706E6B] whitespace-pre-wrap">{c.body}</p>}
                <div className="text-xs text-[#706E6B] space-y-0.5">
                  <p>Raised: {new Date(c.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                  {c.sla_due_at && !isResolved(c.status) && (
                    <p>SLA due: {new Date(c.sla_due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                  )}
                  {c.resolved_at && (
                    <p>Resolved: {new Date(c.resolved_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                  )}
                </div>
                <div className="flex gap-1 pt-1">
                  {advanceTo && (
                    <button
                      disabled={busy}
                      onClick={() => updateStatus(c, advanceTo)}
                      className="text-xs font-semibold px-2 py-1 rounded-lg bg-[#0176D3] text-white hover:bg-[#014486] disabled:opacity-50"
                    >
                      {advanceTo === "closed" ? "Close" : advanceTo === "resolved" ? "Resolve" : "Start work"} →
                    </button>
                  )}
                  {escalateTo && (
                    <button
                      disabled={busy}
                      onClick={() => updateStatus(c, escalateTo)}
                      className="text-xs font-semibold px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 disabled:opacity-50"
                    >
                      Escalate{escalateTo === "escalated_scores" ? " to SCOREs" : ""}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
