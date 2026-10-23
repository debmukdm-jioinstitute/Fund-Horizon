// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ActivityKind,
  createActivity,
  getActivities,
  patchActivity,
} from "../../lib/crmProductsApi";
import { fieldErrors, pastDueWarning, taskSchema } from "../../lib/crmSchemas";
import { ApiError } from "../../lib/api";
import { useOwners } from "./OwnerAvatar";
import { bulkDeleteRecords } from "../../lib/crmListApi";
import DeleteConfirmDialog from "./DeleteConfirmDialog";

const KINDS: ActivityKind[] = ["call", "meeting", "note", "followup", "email", "whatsapp", "review"];

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

function kindChip(kind: ActivityKind) {
  const tones: Record<ActivityKind, string> = {
    call: "bg-[#D8E6FE] text-[#0176D3]",
    meeting: "bg-[#ECEBEA] text-[#444444]",
    note: "bg-gray-100 text-gray-700",
    followup: "bg-amber-100 text-amber-600",
    email: "bg-[#F3F3F3] text-[#444444]",
    review: "bg-rose-100 text-rose-700",
    whatsapp: "bg-[#EAF5FE] text-[#014486]",
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase ${tones[kind]}`}>{kind}</span>
  );
}

function ActivityCard({ a, busy, onDone, onReopen, onDelete }: {
  a: Activity;
  busy: boolean;
  onDone: (a: Activity) => void;
  onReopen: (a: Activity) => void;
  onDelete?: (a: Activity) => void;
}) {
  const done = !!a.done_at;
  return (
    <div className={`bg-white border rounded-xl p-3 space-y-1.5 shadow-sm ${done ? "border-gray-200 opacity-70" : "border-[#E5E5E5]"}`}>
      <div className="flex items-center justify-between gap-2">
        {kindChip(a.kind)}
        {a.due_at && !done && (
          <span className="text-xs text-[#706E6B]">
            Due {new Date(a.due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
        {done && <span className="text-xs text-[#0176D3] font-bold">Done</span>}
      </div>
      <p className={`text-xs font-semibold text-[#181818] ${done ? "line-through" : ""}`}>{a.subject}</p>
      {a.body && <p className="text-xs text-[#706E6B] whitespace-pre-wrap">{a.body}</p>}
      <div className="pt-1 flex items-center justify-between gap-2">
        {done ? (
          <button
            disabled={busy}
            onClick={() => onReopen(a)}
            className="text-xs font-semibold px-2 py-1 rounded-lg bg-[#F3F3F3] text-[#444444] hover:bg-[#ECEBEA] disabled:opacity-50"
          >
            Reopen
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => onDone(a)}
            className="text-xs font-semibold px-2 py-1 rounded-lg bg-[#0176D3] text-white hover:bg-[#014486] disabled:opacity-50"
          >
            Mark done
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(a)}
            className="text-xs font-semibold px-2 py-1 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function ActivitiesTab() {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingActivity, setDeletingActivity] = useState<Activity | null>(null);
  const [showForm, setShowForm] = useState(useSearchParams().get("new") === "1"); // "+ New task" in the table view lands here with the form open
  const [saving, setSaving] = useState(false);

  const [kind, setKind] = useState<ActivityKind>("followup");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [householdId, setHouseholdId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignee, setAssignee] = useState("");
  const owners = useOwners();
  const [subjectError, setSubjectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getActivities());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load activities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const now = new Date();
    const sod = startOfDay(now);
    const eod = endOfDay(now);
    const overdue: Activity[] = [];
    const today: Activity[] = [];
    const upcoming: Activity[] = [];
    const undated: Activity[] = [];
    const done: Activity[] = [];
    for (const a of items) {
      if (a.done_at) {
        done.push(a);
        continue;
      }
      if (!a.due_at) {
        undated.push(a);
        continue;
      }
      const due = new Date(a.due_at);
      if (due < sod) overdue.push(a);
      else if (due <= eod) today.push(a);
      else upcoming.push(a);
    }
    const byDue = (x: Activity, y: Activity) =>
      new Date(x.due_at ?? x.created_at).getTime() - new Date(y.due_at ?? y.created_at).getTime();
    overdue.sort(byDue);
    today.sort(byDue);
    upcoming.sort(byDue);
    undated.sort((x, y) => x.created_at.localeCompare(y.created_at));
    done.sort((x, y) => (y.done_at ?? "").localeCompare(x.done_at ?? ""));
    return { overdue, today, upcoming, undated, done };
  }, [items]);

  const markDone = async (a: Activity) => {
    setBusyId(a.id);
    try {
      const updated = await patchActivity(a.id, { done_at: new Date().toISOString() });
      setItems((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not mark the task done.");
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (a: Activity) => {
    setBusyId(a.id);
    try {
      const updated = await patchActivity(a.id, { done_at: null });
      setItems((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reopen the task.");
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = fieldErrors(taskSchema, { subject });
    setSubjectError(errs?.subject ?? null);
    if (errs) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createActivity({
        kind,
        subject: subject.trim(),
        body: body.trim() || undefined,
        household_id: householdId.trim() || undefined,
        customer_id: customerId.trim() || undefined,
        opportunity_id: opportunityId.trim() || undefined,
        due_at: dueAt ? `${dueAt}:00+05:30` : undefined, // entered in IST
        assigned_rm_id: assignee.trim() || undefined,
      });
      setItems((prev) => [created, ...prev]);
      setSubject("");
      setBody("");
      setHouseholdId("");
      setCustomerId("");
      setOpportunityId("");
      setDueAt("");
      setAssignee("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the task.");
    } finally {
      setSaving(false);
    }
  };

  const sections: { title: string; items: Activity[]; empty: string; tone: string }[] = [
    { title: "Overdue", items: groups.overdue, empty: "Nothing overdue. Nice work.", tone: "text-rose-700" },
    { title: "Due today", items: groups.today, empty: "Nothing due today.", tone: "text-amber-600" },
    { title: "Upcoming", items: groups.upcoming, empty: "Nothing scheduled ahead.", tone: "text-[#444444]" },
    { title: "No due date", items: groups.undated, empty: "No undated tasks.", tone: "text-[#444444]" },
    { title: "Completed", items: groups.done, empty: "No completed tasks yet.", tone: "text-[#0176D3]" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#181818]">RM agenda</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#181818] text-white hover:bg-[#444444]"
        >
          {showForm ? "Close" : "+ New task"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-100 border border-rose-600/30 text-rose-700 text-xs rounded-xl px-4 py-3">{error}</div>
      )}

      {showForm && (
        <form onSubmit={create} className="bg-white border border-[#E5E5E5] rounded-2xl p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ActivityKind)}
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Due on</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
              />
              {pastDueWarning(dueAt) && (
                <span className="block text-xs font-medium text-amber-700">{pastDueWarning(dueAt)}</span>
              )}
            </label>
          </div>
          <label className="text-xs font-semibold text-[#444444] space-y-1 block">
            <span>Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Call to confirm SIP debit date"
              className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
              required
            />
            {subjectError && <span className="block text-xs font-medium text-rose-700">{subjectError}</span>}
          </label>
          <label className="text-xs font-semibold text-[#444444] space-y-1 block">
            <span>Notes</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Household ID</span>
              <input value={householdId} onChange={(e) => setHouseholdId(e.target.value)} placeholder="optional"
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal" />
            </label>
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Customer ID</span>
              <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="optional"
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal" />
            </label>
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Opportunity ID</span>
              <input value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)} placeholder="optional"
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal" />
            </label>
            <label className="text-xs font-semibold text-[#444444] space-y-1">
              <span>Assign to</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
                className="w-full border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-xs font-normal">
                <option value="">Unassigned</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#0176D3] text-white hover:bg-[#014486] disabled:opacity-50"
          >
            {saving ? "Saving..." : "Create task"}
          </button>
        </form>
      )}

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="p-16 text-center">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-[#0176D3] border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <h3 className={`text-xs font-bold ${s.tone}`}>
                {s.title} <span className="font-semibold text-[#706E6B]">({s.items.length})</span>
              </h3>
              {s.items.length === 0 ? (
                <p className="text-xs text-[#706E6B]">{s.empty}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {s.items.map((a) => (
                    <ActivityCard key={a.id} a={a} busy={busyId === a.id} onDone={markDone} onReopen={reopen} onDelete={setDeletingActivity} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {deletingActivity && (
        <DeleteConfirmDialog
          title={`Delete task "${deletingActivity.subject}"?`}
          description="This permanently removes the task from the CRM."
          onConfirm={async (code) => {
            await bulkDeleteRecords("activities", [deletingActivity.id], code);
            setItems((prev) => prev.filter((x) => x.id !== deletingActivity.id));
          }}
          onClose={() => setDeletingActivity(null)}
        />
      )}
    </div>
  );
}
