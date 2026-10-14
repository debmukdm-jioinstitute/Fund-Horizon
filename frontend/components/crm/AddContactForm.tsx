// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import { createContact, RELATIONS, TAX_STATUSES, type ContactDetail } from "../../lib/crmPhase3Api";
import { emailSchema, fieldErrors, mobileSchema } from "../../lib/crmSchemas";
import { z } from "zod";
import { btnCls, errCls, ghostBtnCls, inputCls } from "./ui";

const schema = z.object({ name: z.string().trim().min(1, "Name is required"), email: emailSchema, mobile: mobileSchema });

/** Add a family member without giving them a login. Minors need a guardian; NRIs need a country. */
export default function AddContactForm({
  householdId, guardians, onCreated,
}: {
  householdId: string;
  /** Adult contacts already in the household (for a minor's guardian). */
  guardians: { id: string; name: string }[];
  onCreated: (c: ContactDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", mobile: "", relation: "spouse", dob: "", guardian: "", tax_status: "resident", country: "", nominee_name: "", nominee_pct: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const minor = !!f.dob && (Date.now() - new Date(f.dob).getTime()) / 31557600000 < 18;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = fieldErrors(schema, { name: f.name, email: f.email, mobile: f.mobile });
    if (errs) return setError(Object.values(errs).join(". "));
    setBusy(true);
    setError(null);
    try {
      const c = await createContact({
        household_id: householdId, name: f.name.trim(), email: f.email.trim() || undefined, mobile: f.mobile.trim() || undefined,
        relation: f.relation, dob: f.dob || undefined, guardian_contact_id: minor ? f.guardian || undefined : undefined,
        tax_status: f.tax_status, country: f.country.trim() || undefined,
        nominee_name: f.nominee_name.trim() || undefined, nominee_pct: f.nominee_pct ? Number(f.nominee_pct) : undefined,
      } as Parameters<typeof createContact>[0]);
      onCreated(c);
      setOpen(false);
      setF({ ...f, name: "", email: "", mobile: "", dob: "", guardian: "", nominee_name: "", nominee_pct: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the contact");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <button type="button" className={ghostBtnCls} onClick={() => setOpen(true)}>Add contact</button>;
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-2 text-xs rounded border border-[#E4E9EF] dark:border-[#2B3644] p-3" aria-label="Add contact">
      <label>Name<input value={f.name} onChange={set("name")} className={inputCls} /></label>
      <label>Relation<select value={f.relation} onChange={set("relation")} className={inputCls}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
      <label>Email (optional)<input value={f.email} onChange={set("email")} className={inputCls} /></label>
      <label>Mobile (optional; +91 or +country code)<input value={f.mobile} onChange={set("mobile")} className={inputCls} /></label>
      <label>Date of birth<input type="date" value={f.dob} onChange={set("dob")} className={inputCls} /></label>
      {minor ? (
        <label>Guardian (required for a minor)
          <select value={f.guardian} onChange={set("guardian")} className={inputCls}><option value="">Choose…</option>{guardians.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        </label>
      ) : <span />}
      <label>Tax status<select value={f.tax_status} onChange={set("tax_status")} className={inputCls}>{TAX_STATUSES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}</select></label>
      {f.tax_status !== "resident" ? <label>Country of residence<input value={f.country} onChange={set("country")} className={inputCls} /></label> : <span />}
      <label>Nominee<input value={f.nominee_name} onChange={set("nominee_name")} className={inputCls} /></label>
      <label>Nominee share %<input type="number" min={1} max={100} value={f.nominee_pct} onChange={set("nominee_pct")} className={inputCls} /></label>
      {error && <p role="alert" className={`col-span-2 ${errCls}`}>{error}</p>}
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" className={ghostBtnCls} onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className={btnCls} disabled={busy}>{busy ? "Adding…" : "Add contact"}</button>
      </div>
    </form>
  );
}
