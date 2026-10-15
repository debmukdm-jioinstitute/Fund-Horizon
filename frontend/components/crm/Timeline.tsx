// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import { createActivity, patchActivity } from "../../lib/crmApi";
import { useCanWrite } from "./useCanWrite";
import { fetchTimeline, type TimelineItem } from "../../lib/crmListApi";
import { fieldErrors, pastDueWarning, taskSchema } from "../../lib/crmSchemas";

export type TimelineTarget =
  | { entity: "household"; id: string }
  | { entity: "lead"; id: string }
  | { entity: "opportunity"; id: string; householdId?: string | null }
  | { entity: "case"; id: string };

const COMPOSER = [
  { id: "call", label: "Log call", kind: "call" },
  { id: "email", label: "Email", kind: "email" },
  { id: "whatsapp", label: "WhatsApp", kind: "whatsapp" },
  { id: "note", label: "Note", kind: "note" },
  { id: "task", label: "Task", kind: "followup" },
] as const;

const KIND_TONE: Record<string, string> = {
  call: "bg-[#D8E6FE] text-[#014486] dark:bg-[#12385C] dark:text-[#CFE6FC]",
  email: "bg-[#DCE8FB] text-[#17407F] dark:bg-[#1B2E4B] dark:text-[#BBD2F7]",
  whatsapp: "bg-[#D8F2DC] text-[#1B5E20] dark:bg-[#183A1C] dark:text-[#B5E8BA]",
  note: "bg-[#ECEBEA] text-[#181818] dark:bg-[#24303E] dark:text-[#EDF2F7]",
  followup: "bg-[#FFF1D6] text-[#8A5A00] dark:bg-[#40300E] dark:text-[#FFD27A]",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function linkFor(t: TimelineTarget) {
  if (t.entity === "household") return { household_id: t.id };
  if (t.entity === "lead") return { lead_id: t.id };
  if (t.entity === "opportunity") return { opportunity_id: t.id, household_id: t.householdId ?? undefined };
  return { case_id: t.id };
}

export default function Timeline({ target, refreshKey = 0 }: { target: TimelineTarget; refreshKey?: number }) {
  const canWrite = useCanWrite();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<(typeof COMPOSER)[number]["id"]>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchTimeline(target.entity, target.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the timeline");
    } finally {
      setLoading(false);
    }
  }, [target.entity, target.id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = fieldErrors(taskSchema, { subject });
    setFormError(errs?.subject ?? null);
    if (errs) return;
    const kind = COMPOSER.find((c) => c.id === mode)!.kind;
    setSaving(true);
    setWarning(null);
    try {
      const created = await createActivity({
        kind,
        subject: subject.trim(),
        body: body.trim() || undefined,
        due_at: mode === "task" && due ? `${due}:00+05:30` : undefined, // entered in IST
        ...linkFor(target),
      });
      setSubject("");
      setBody("");
      setDue("");
      if (created.warnings?.length) setWarning(created.warnings.join(" "));
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const markDone = async (id: string) => {
    try {
      await patchActivity(id, { done_at: new Date().toISOString() });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the task");
    }
  };

  const dueWarn = mode === "task" ? pastDueWarning(due) : null;

  return (
    <section aria-label="Activity" className="rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-4 space-y-4">
      {canWrite && <form onSubmit={submit} className="space-y-2">
        <div role="tablist" aria-label="Log an activity" className="flex flex-wrap gap-1">
          {COMPOSER.map((c) => (
            <button
              key={c.id} type="button" role="tab" aria-selected={mode === c.id} onClick={() => setMode(c.id)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                mode === c.id ? "bg-[#0176D3] text-white" : "bg-[#ECEBEA] dark:bg-[#24303E] text-[#706E6B] dark:text-[#A8B4C4]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject"
          placeholder={mode === "task" ? "Task subject" : mode === "note" ? "Note title" : `${COMPOSER.find((c) => c.id === mode)!.label} — what happened?`}
          className="w-full px-3 py-2 text-xs rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#181818] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#0176D3]"
        />
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)} rows={2} aria-label="Details" placeholder="Details (optional)"
          className="w-full px-3 py-2 text-xs rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#181818] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#0176D3]"
        />
        <div className="flex flex-wrap items-center gap-2">
          {mode === "task" && (
            <label className="text-xs text-[#706E6B] dark:text-[#A8B4C4] inline-flex items-center gap-2">
              Due (IST)
              <input
                type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)}
                className="px-2 py-1 text-xs rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#181818] dark:text-[#EDF2F7]"
              />
            </label>
          )}
          <button type="submit" disabled={saving} className="ml-auto px-3 py-1.5 text-xs font-bold rounded bg-[#0176D3] text-white disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {dueWarn && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{dueWarn}</p>}
        {warning && <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-300">Saved. {warning}</p>}
        {formError && <p role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-300">{formError}</p>}
      </form>}

      {error && <p role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-300">{error}</p>}
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded bg-[#E5E5E5]/70 dark:bg-[#2B3644]/70 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-[#706E6B] dark:text-[#A8B4C4]">No activity yet. Log a call, note or task above.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((i) => (
            <li key={`${i.type}-${i.id}`} className="flex gap-3 text-xs">
              <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${i.type === "audit" ? "bg-[#ECEBEA] text-[#706E6B] dark:bg-[#24303E] dark:text-[#A8B4C4]" : i.type === "case" ? "bg-[#FBE7EA] text-[#9B1C2E] dark:bg-[#43181F] dark:text-[#FFA9B5]" : (KIND_TONE[i.kind] ?? KIND_TONE.note)}`}>
                {i.type === "audit" ? "change" : i.type === "case" ? "grievance" : i.kind}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[#181818] dark:text-[#EDF2F7] break-words">{i.title}</p>
                {i.detail && <p className="text-[#706E6B] dark:text-[#A8B4C4] break-words whitespace-pre-wrap">{i.detail}</p>}
                <p className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">
                  {when(i.at)}{i.actor_name ? ` · ${i.actor_name}` : ""}
                  {i.type === "activity" && i.due_at && !i.done_at ? ` · due ${when(i.due_at)}` : ""}
                  {i.done_at ? " · done" : ""}
                </p>
                {canWrite && i.type === "activity" && i.kind === "followup" && !i.done_at && (
                  <button type="button" onClick={() => markDone(i.id)} className="mt-1 text-[11px] font-semibold underline text-[#0176D3] dark:text-[#1B96FF]">
                    Mark done
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
