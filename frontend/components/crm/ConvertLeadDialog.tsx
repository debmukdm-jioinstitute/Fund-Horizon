// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { convertLead, fetchHouseholds, type ConvertResult, type Household, type Lead } from "../../lib/crmApi";

const field =
  "w-full px-3 py-2 text-xs rounded-xl border border-navy-200 dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-navy-900 dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-teal-500";

export default function ConvertLeadDialog({
  lead, onClose, onConverted,
}: {
  lead: Lead; onClose: () => void; onConverted: (res: ConvertResult) => void;
}) {
  const [householdName, setHouseholdName] = useState(`${lead.name.split(" ")[0] ?? lead.name} family`);
  const [existingHousehold, setExistingHousehold] = useState("");
  const [households, setHouseholds] = useState<Household[]>([]);
  const [invite, setInvite] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);

  useEffect(() => {
    fetchHouseholds().then(setHouseholds).catch(() => setHouseholds([]));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await convertLead(lead.id, {
        household_id: existingHousehold || undefined,
        household_name: existingHousehold ? undefined : householdName.trim() || undefined,
        invite_to_portal: invite,
        password: invite ? password || undefined : undefined,
      });
      setResult(res);
      onConverted(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not convert the lead");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Convert lead ${lead.name}`}>
      <div className="bg-white dark:bg-[#10151C] rounded-2xl border border-navy-100 dark:border-[#2B3644] shadow-xl w-full max-w-md p-6 space-y-4 text-navy-950 dark:text-[#EDF2F7]">
        <h3 className="text-base font-bold">Convert lead: {lead.name}</h3>
        {result ? (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-teal-50 dark:bg-[#0F2A27] border border-teal-200 dark:border-[#1F5C54] text-xs text-teal-900 dark:text-[#CFE6FC]">
              <div className="font-bold mb-1">{existingHousehold ? "Added to the household." : "Customer and household created."}</div>
              <Link className="underline font-semibold" href={`/backoffice/crm/households/${result.household_id}`}>Open household</Link>
              {result.temp_password ? (
                <div className="mt-2">
                  <div className="font-semibold">Temporary password (share once):</div>
                  <div className="font-mono font-bold text-sm break-all mt-1 select-all">{result.temp_password}</div>
                  <div className="text-xs mt-1">The customer should set their own password after the first sign-in.</div>
                </div>
              ) : (
                <div className="mt-2">{result.invited ? "Portal login created with the password you set." : "No portal login was created."}</div>
              )}
            </div>
            <button type="button" onClick={onClose} className="w-full px-3 py-2 text-xs font-bold bg-navy-900 dark:bg-[#0176D3] hover:bg-navy-800 text-white rounded-xl transition">Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">
              This creates the customer record and a household (or adds them to an existing one) and marks the lead as converted.
              Conversion cannot be undone. Only an email or a mobile number is needed.
            </p>
            <div>
              <label className="block text-xs font-semibold mb-1" htmlFor="convert-household">
                Add to existing household <span className="font-normal opacity-70">(optional)</span>
              </label>
              <select id="convert-household" value={existingHousehold} onChange={(e) => setExistingHousehold(e.target.value)} className={field}>
                <option value="">Create a new household</option>
                {households.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            {!existingHousehold && (
              <div>
                <label className="block text-xs font-semibold mb-1" htmlFor="convert-hh-name">Household name</label>
                <input id="convert-hh-name" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} className={field} />
              </div>
            )}
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-semibold">Invite to portal</span>
                <span className="block opacity-70">Creates a login for the client. Leave unticked to keep them as a record only.</span>
              </span>
            </label>
            {invite && (
              <div>
                <label className="block text-xs font-semibold mb-1" htmlFor="convert-pw">
                  Initial password <span className="font-normal opacity-70">(optional — a temporary one is generated if left blank)</span>
                </label>
                <input id="convert-pw" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" className={field} />
              </div>
            )}
            {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-xs font-medium text-rose-700 dark:text-rose-300">{error}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 px-3 py-2 text-xs font-semibold bg-navy-50 dark:bg-[#24303E] hover:bg-navy-100 rounded-xl transition">Cancel</button>
              <button type="button" onClick={submit} disabled={busy} className="flex-1 px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition">
                {busy ? "Converting…" : "Convert lead"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
