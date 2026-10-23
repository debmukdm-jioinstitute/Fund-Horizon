"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { createContact, RELATIONS } from "../../lib/crmPhase3Api";
import { fetchPage } from "../../lib/crmListApi";
import { emailSchema, fieldErrors, mobileSchema } from "../../lib/crmSchemas";
import { btnCls, errCls, ghostBtnCls, inputCls } from "./ui";

const schema = z.object({ name: z.string().trim().min(1, "Name is required"), email: emailSchema, mobile: mobileSchema });

/** "+ New contact": a contact always belongs to a household, so pick one. */
export default function NewContactForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [households, setHouseholds] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ household_id: "", name: "", email: "", mobile: "", relation: "self" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!open || households.length) return;
    fetchPage<{ id: string; name: string }>("households", { limit: 500, offset: 0, sort: "name" })
      .then((r) => setHouseholds(r.rows))
      .catch(() => setError("Could not load households"));
  }, [open, households.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.household_id) return setError("Pick a household");
    const errs = fieldErrors(schema, { name: f.name, email: f.email, mobile: f.mobile });
    if (errs) return setError(Object.values(errs).join(". "));
    setBusy(true);
    setError(null);
    try {
      await createContact({ household_id: f.household_id, name: f.name.trim(), email: f.email.trim() || undefined, mobile: f.mobile.trim() || undefined, relation: f.relation } as Parameters<typeof createContact>[0]);
      setF({ ...f, name: "", email: "", mobile: "" });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the contact");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-lg bg-[#0176D3] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#014486] focus:outline-none focus:ring-2 focus:ring-[#0176D3]">
          <span aria-hidden className="text-base leading-none">{open ? "×" : "+"}</span> {open ? "Close" : "New contact"}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} aria-label="New contact" className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-3">
          <label>Household<select value={f.household_id} onChange={set("household_id")} className={inputCls}><option value="">Select…</option>{households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
          <label>Relation<select value={f.relation} onChange={set("relation")} className={inputCls}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
          <label>Name<input value={f.name} onChange={set("name")} className={inputCls} /></label>
          <label>Mobile (optional)<input value={f.mobile} onChange={set("mobile")} className={inputCls} /></label>
          <label>Email (optional)<input value={f.email} onChange={set("email")} className={inputCls} /></label>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={busy} className={btnCls}>{busy ? "Adding…" : "Add contact"}</button>
            <button type="button" className={ghostBtnCls} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {error && <p role="alert" className={`md:col-span-2 ${errCls}`}>{error}</p>}
        </form>
      )}
    </div>
  );
}
