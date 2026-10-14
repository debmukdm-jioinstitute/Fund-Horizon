// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createHousehold,
  fetchHouseholds,
  type Household,
} from "../../lib/crmApi";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "–";
  }
}

export default function HouseholdsTab() {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHouseholds(await fetchHouseholds());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load households");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return households;
    return households.filter((h) => h.name.toLowerCase().includes(q));
  }, [households, query]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createHousehold({ name: name.trim(), notes: notes.trim() || undefined });
      setHouseholds((prev) => [created, ...prev]);
      setName("");
      setNotes("");
      router.push(`/backoffice/crm/households/${created.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create the household");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-navy-100 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-navy-950">Households</h2>
              <p className="text-xs text-navy-500">
                {households.length} household{households.length === 1 ? "" : "s"} under management.
              </p>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500 w-full md:w-56"
            />
          </div>

          {error && (
            <div className="p-4 mb-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          {loading ? (
            <div role="status" aria-busy="true" aria-label="Loading" className="space-y-3 p-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-navy-100/70 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-xs text-navy-500">
              {query ? "No households match your search." : "No households yet. Create one to get started."}
            </div>
          ) : (
            <div className="divide-y divide-navy-100">
              {filtered.map((h) => (
                <Link
                  key={h.id}
                  href={`/backoffice/crm/households/${h.id}`}
                  className="w-full text-left px-2 py-3.5 hover:bg-teal-50/30 rounded-xl transition flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-bold text-navy-950">{h.name}</div>
                    <div className="text-xs text-navy-600">
                      Created {formatDate(h.created_at)}
                      {h.notes ? ` · ${h.notes.slice(0, 60)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-1 rounded-lg bg-navy-50 text-navy-700 text-xs font-semibold">
                      {h.member_count} member{h.member_count === 1 ? "" : "s"}
                    </span>
                    {h.open_opportunities > 0 && (
                      <span className="px-2 py-1 rounded-lg bg-teal-50 text-teal-800 text-xs font-semibold">
                        {h.open_opportunities} open
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm h-fit">
          <h3 className="text-sm font-bold text-navy-950 mb-1">New household</h3>
          <p className="text-xs text-navy-600 mb-4">
            One family, one record — members are added from the household view.
          </p>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">
                Household name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sharma family"
                className="w-full px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-navy-700 mb-1">
                Notes <span className="font-normal text-navy-600">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Relationship context, preferences…"
                className="w-full px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            {createError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                {createError}
              </div>
            )}
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="w-full px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition"
            >
              {creating ? "Creating…" : "Create household"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
