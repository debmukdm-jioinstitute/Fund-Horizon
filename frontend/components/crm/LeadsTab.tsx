// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  convertLead,
  createLead,
  fetchLeads,
  LEAD_STATUSES,
  patchLead,
  type Lead,
} from "../../lib/crmApi";

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

const LEAD_SOURCES = ["sip_calculator", "website", "blog", "referral", "plan_link", "other"] as const;

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
      <div className="text-xs font-bold text-navy-950">{lead.name}</div>
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
          onChange={(e) => onStatusChange(lead, e.target.value)}
          className="text-xs font-semibold px-2 py-1 rounded-lg border border-navy-200 bg-white text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {LEAD_STATUSES.map((s) => (
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
  const [householdName, setHouseholdName] = useState("");
  const [password, setPassword] = useState("");
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertResult, setConvertResult] = useState<{ householdId: string; tempPassword?: string } | null>(null);
  const [convertBusy, setConvertBusy] = useState(false);

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createLead({
        name: name.trim(),
        email: email.trim() || undefined,
        mobile: mobile.trim() || undefined,
        source,
        notes: notes.trim() || undefined,
      });
      setLeads((prev) => [created, ...prev]);
      setName("");
      setEmail("");
      setMobile("");
      setNotes("");
      setSource("other");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create the lead");
    } finally {
      setCreating(false);
    }
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

  const openConvert = (lead: Lead) => {
    setConverting(lead);
    setHouseholdName(`${lead.name.split(" ")[0] ?? lead.name} family`);
    setPassword("");
    setConvertError(null);
    setConvertResult(null);
  };

  const handleConvert = async () => {
    if (!converting) return;
    setConvertBusy(true);
    setConvertError(null);
    try {
      const res = await convertLead(converting.id, {
        household_name: householdName.trim() || undefined,
        password: password || undefined,
      });
      setConvertResult({ householdId: res.household_id, tempPassword: res.temp_password });
      setLeads((prev) =>
        prev.map((l) => (l.id === converting.id ? { ...l, status: "converted" } : l)),
      );
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : "Could not convert the lead");
    } finally {
      setConvertBusy(false);
    }
  };

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
            type="email"
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
            disabled={creating || !name.trim()}
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
        <div className="p-12 text-center text-xs text-navy-500">Loading leads…</div>
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
        <div className="fixed inset-0 z-50 bg-navy-950/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-navy-100 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-navy-950">
              Convert lead: {converting.name}
            </h3>
            {convertResult ? (
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900">
                  <div className="font-bold mb-1">Account and household created.</div>
                  <div className="font-mono text-xs break-all">
                    Household ID: {convertResult.householdId}
                  </div>
                  {convertResult.tempPassword && (
                    <div className="mt-2">
                      <div className="font-semibold">Temporary password (share once):</div>
                      <div className="font-mono font-bold text-sm break-all mt-1 select-all">
                        {convertResult.tempPassword}
                      </div>
                      <div className="text-xs mt-1">
                        The customer should set their own password after the first sign-in.
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setConverting(null)}
                  className="w-full px-3 py-2 text-xs font-bold bg-navy-900 hover:bg-navy-800 text-white rounded-xl transition"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-navy-500">
                  This creates a customer account, a household, and marks the lead as converted.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-navy-700 mb-1">
                    Household name
                  </label>
                  <input
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-navy-700 mb-1">
                    Initial password <span className="font-normal text-navy-600">(optional — a temporary one is generated if left blank)</span>
                  </label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    autoComplete="new-password"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                {convertError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
                    {convertError}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConverting(null)}
                    className="flex-1 px-3 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConvert}
                    disabled={convertBusy}
                    className="flex-1 px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition"
                  >
                    {convertBusy ? "Converting…" : "Convert lead"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
