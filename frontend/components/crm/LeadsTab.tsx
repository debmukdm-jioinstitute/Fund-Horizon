// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createLead, fetchLeads, LEAD_STATUSES, patchLead, type Lead } from "../../lib/crmApi";
import { checkDuplicates, type DuplicateMatch } from "../../lib/crmListApi";
import { fieldErrors, leadSchema } from "../../lib/crmSchemas";
import ConvertLeadDialog from "./ConvertLeadDialog";
import DuplicateDialog from "./DuplicateDialog";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-sky-50 text-sky-800 border-sky-200",
  contacted: "bg-violet-50 text-violet-800 border-violet-200",
  qualified: "bg-teal-50 text-teal-800 border-teal-200",
  converted: "bg-navy-50 text-navy-800 border-navy-200",
  lost: "bg-rose-50 text-rose-700 border-rose-200",
};

const LEAD_SOURCES = ["qr_code", "sip_calculator", "website", "blog", "referral", "plan_link", "crossword", "other"] as const;

function LeadCard({
  lead,
  onConvert,
  onStatusChange,
}: {
  lead: Lead;
  onConvert: (lead: Lead) => void;
  onStatusChange: (lead: Lead, status: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-navy-100 shadow-sm p-3.5 space-y-2">
      <Link href={`/backoffice/crm/leads/${lead.id}`} className="block text-xs font-bold text-navy-950 hover:underline">
        {lead.name}
      </Link>
      <div className="text-xs text-navy-600">
        {[lead.email, lead.mobile].filter(Boolean).join(" · ") || "No contact details"}
      </div>
      <div className="text-xs text-navy-500">
        Source: {lead.source.replaceAll("_", " ")}
      </div>
      {lead.notes && <div className="text-xs text-navy-600">{lead.notes}</div>}
      <div className="flex items-center gap-2 pt-1">
        <select
          value={lead.status}
          disabled={lead.status === "converted"}
          title={lead.status === "converted" ? "Converted leads are final" : undefined}
          onChange={(e) => onStatusChange(lead, e.target.value)}
          className="text-xs font-semibold px-2 py-1 rounded-lg border border-navy-200 bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {LEAD_STATUSES.filter((s) => s !== "converted" || lead.status === "converted").map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {lead.status !== "converted" && lead.status !== "lost" && (
          <button
            type="button"
            onClick={() => onConvert(lead)}
            className="px-2.5 py-1 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition"
          >
            Convert
          </button>
        )}
      </div>
    </div>
  );
}

export default function LeadsTab() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [source, setSource] = useState<string>("other");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [converting, setConverting] = useState<Lead | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<{ matches: DuplicateMatch[]; blocking: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLeads(await fetchLeads());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doCreate = async (allowDuplicates: boolean) => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createLead({
        name: name.trim(),
        email: email.trim() || undefined,
        mobile: mobile.trim() || undefined,
        source,
        notes: notes.trim() || undefined,
        allow_duplicates: allowDuplicates || undefined,
      });
      setLeads((prev) => [created, ...prev]);
      setName("");
      setEmail("");
      setMobile("");
      setNotes("");
      setSource("other");
      setDupes(null);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create the lead");
    } finally {
      setCreating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = fieldErrors(leadSchema, { name, email, mobile });
    setFieldErrs(errs ?? {});
    if (errs) return;
    setCreating(true);
    try {
      const d = await checkDuplicates({ name: name.trim(), email: email.trim() || undefined, mobile: mobile.trim() || undefined });
      if (d.matches.length > 0) {
        setDupes({ matches: d.matches, blocking: d.blocking });
        setCreating(false);
        return;
      }
    } catch {
      /* the server enforces duplicates too; carry on */
    }
    await doCreate(false);
  };

  const handleStatusChange = async (lead: Lead, status: string) => {
    if (status === lead.status) return;
    try {
      const updated = await patchLead(lead.id, { status });
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the lead");
    }
  };

  const openConvert = (lead: Lead) => setConverting(lead);

  const columns = LEAD_STATUSES.map((status) => ({
    status,
    leads: leads.filter((l) => l.status === status),
  }));

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm">
        <h2 className="text-lg font-bold text-navy-950 mb-1">Leads</h2>
        <p className="text-xs text-navy-500 mb-4">
          Every prospect enquiry, grouped by stage. Convert a qualified lead to create their
          customer account and household in one step.
        </p>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name *"
            className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="text"
            inputMode="email"
            className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="Mobile"
            className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={creating}
            className="px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition"
          >
            {creating ? "Adding…" : "Add lead"}
          </button>
        </form>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="mt-3 w-full px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {Object.values(fieldErrs).length > 0 && (
          <ul className="mt-3 text-xs font-medium text-rose-700 list-disc pl-5" role="alert">
            {Object.values(fieldErrs).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {createError && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
            {createError}
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-navy-100/70 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {columns.map(({ status, leads: col }) => (
            <div key={status} className="bg-navy-50/60 rounded-2xl border border-navy-100 p-3 space-y-3">
              <div className="flex items-center justify-between px-1">
                <span
                  className={`px-2 py-1 rounded-lg border text-xs font-bold ${STATUS_STYLES[status]}`}
                >
                  {STATUS_LABELS[status]}
                </span>
                <span className="text-xs font-bold text-navy-500">{col.length}</span>
              </div>
              {col.length === 0 ? (
                <div className="text-xs text-navy-600 text-center py-4">Empty</div>
              ) : (
                col.map((l) => (
                  <LeadCard
                    key={l.id}
                    lead={l}
                    onConvert={openConvert}
                    onStatusChange={handleStatusChange}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {converting && (
        <ConvertLeadDialog
          lead={converting}
          onClose={() => setConverting(null)}
          onConverted={(res) =>
            setLeads((prev) =>
              prev.map((l) => (l.id === converting.id ? { ...l, status: "converted", converted_household_id: res.household_id } : l)),
            )
          }
        />
      )}
      {dupes && (
        <DuplicateDialog
          matches={dupes.matches}
          blocking={dupes.blocking}
          onCancel={() => setDupes(null)}
          onContinue={() => void doCreate(true)}
        />
      )}
    </div>
  );
}
