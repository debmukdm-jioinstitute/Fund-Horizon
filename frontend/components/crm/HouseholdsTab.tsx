// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createHousehold } from "../../lib/crmApi";
import { HouseholdsList } from "./EntityLists";
import { useCanWrite } from "./useCanWrite";

export default function HouseholdsTab() {
  const router = useRouter();
  const canWrite = useCanWrite();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createHousehold({ name: name.trim(), notes: notes.trim() || undefined });
      router.push(`/backoffice/crm/households/${created.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create the household");
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-navy-950 dark:text-[#EDF2F7]">Households</h2>
          <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">One family, one record. Members are added from the household page.</p>
        </div>
        {canWrite && <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          aria-expanded={showForm}
          className="px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition"
        >
          {showForm ? "Close" : "New household"}
        </button>}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-[1fr_2fr_auto] items-end bg-white dark:bg-[#10151C] p-4 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644]">
          <div>
            <label htmlFor="hh-name" className="block text-xs font-semibold text-navy-700 dark:text-[#EDF2F7] mb-1">Household name</label>
            <input
              id="hh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma family"
              className="w-full px-3 py-2 text-xs rounded-lg border border-navy-200 dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-navy-900 dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label htmlFor="hh-notes" className="block text-xs font-semibold text-navy-700 dark:text-[#EDF2F7] mb-1">Notes (optional)</label>
            <input
              id="hh-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Relationship context, preferences…"
              className="w-full px-3 py-2 text-xs rounded-lg border border-navy-200 dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-navy-900 dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <button
            type="submit" disabled={creating || !name.trim()}
            className="px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg transition"
          >
            {creating ? "Creating…" : "Create household"}
          </button>
          {createError && <p role="alert" className="md:col-span-3 text-xs font-medium text-rose-700 dark:text-rose-300">{createError}</p>}
        </form>
      )}

      <HouseholdsList />
    </div>
  );
}
