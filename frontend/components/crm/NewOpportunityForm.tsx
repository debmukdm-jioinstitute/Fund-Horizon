// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import { createHousehold, createOpportunity, fetchHouseholdDetail, fetchHouseholds, type Household } from "../../lib/crmApi";
import { PRODUCT_LINES } from "../../lib/crmProductsApi";
import { checkSuitability, RISKOMETER_LABELS, type SuitabilityCheck } from "../../lib/crmPhase3Api";
import { btnCls, cardCls, errCls, headCls, inputCls, toPaise } from "./ui";
import { useAuth } from "@/components/AuthContext";

const NEW_HOUSEHOLD = "__new__";

/** Create an opportunity. For mutual funds and PMS the client's risk limit is checked live: one step over warns,
 *  two or more blocks (an admin can proceed with a documented reason). */
export default function NewOpportunityForm({ householdId, onCreated }: { householdId?: string; onCreated: () => void }) {
  const { customer } = useAuth();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [f, setF] = useState({ household_id: householdId ?? "", product_line: "mutual_fund", title: "", amount: "", scheme_code: "", riskometer: "", expected_close: "", override: "" });
  const [clientId, setClientId] = useState<string | null>(null);
  const [check, setCheck] = useState<SuitabilityCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [newHousehold, setNewHousehold] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!householdId) fetchHouseholds().then(setHouseholds).catch(() => setHouseholds([]));
  }, [householdId]);

  // the client we assess is the household's primary customer (or its first member)
  useEffect(() => {
    if (!f.household_id || f.household_id === NEW_HOUSEHOLD) return setClientId(null);
    let alive = true;
    fetchHouseholdDetail(f.household_id)
      .then((d) => alive && setClientId(d.household.primary_customer_id ?? (d.members.find((m) => m.role === "primary") ?? d.members[0])?.customer_id ?? null))
      .catch(() => alive && setClientId(null));
    return () => { alive = false; };
  }, [f.household_id]);

  const relevant = f.product_line === "mutual_fund" || f.product_line === "pms";
  useEffect(() => {
    if (!relevant || !clientId) return setCheck(null);
    const rk = f.riskometer ? Number(f.riskometer) : undefined;
    if (!rk && !f.scheme_code.trim() && f.product_line !== "pms") return setCheck(null);
    let alive = true;
    const t = setTimeout(() => {
      checkSuitability({ customer_id: clientId, riskometer: rk, scheme_code: !rk && f.scheme_code.trim() ? f.scheme_code.trim() : undefined })
        .then((c) => alive && setCheck(c)).catch(() => alive && setCheck(null));
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [relevant, clientId, f.riskometer, f.scheme_code, f.product_line]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setError("Title is required.");
    const creating = f.household_id === NEW_HOUSEHOLD;
    if (creating && newHousehold.trim().length < 2) return setError("Enter a name for the new household.");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let householdIdToUse = f.household_id;
      if (creating) {
        const h = await createHousehold({ name: newHousehold.trim() });
        householdIdToUse = h.id;
        setHouseholds((hs) => [...hs, h]); // keep it selectable if the opportunity step fails
        setF((cur) => ({ ...cur, household_id: h.id }));
        setNewHousehold("");
      }
      const created = await createOpportunity({
        household_id: householdIdToUse || undefined, product_line: f.product_line, title: f.title.trim(),
        amount: toPaise(f.amount) ?? undefined, expected_close: f.expected_close || undefined,
        scheme_code: f.scheme_code.trim() || undefined, riskometer: f.riskometer ? Number(f.riskometer) : undefined,
        suitability_override_reason: f.override.trim() || undefined,
      } as Parameters<typeof createOpportunity>[0]);
      const warnings = (created as { warnings?: string[] }).warnings;
      setNotice(warnings?.length ? `Created. Suitability warning: ${warnings.join(" ")}` : "Opportunity created.");
      setF({ ...f, title: "", amount: "", scheme_code: "", riskometer: "", override: "" });
      setCheck(null);
      setOpen(false); // collapse so the confirmation (and any suitability warning) is visible
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the opportunity");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="space-y-2">
        <button type="button" className={btnCls} onClick={() => setOpen(true)}>New opportunity</button>
        {notice && <p role="status" className="text-xs font-medium text-[#0176D3] dark:text-[#1B96FF]">{notice}</p>}
      </div>
    );
  }
  const tone = check?.level === "block" ? "border-rose-300 bg-rose-50 text-rose-800 dark:bg-[#43181F] dark:border-[#7A2A36] dark:text-[#FFA9B5]" : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-[#40300E] dark:border-[#6B5216] dark:text-[#FFD27A]";
  return (
    <form onSubmit={submit} className={`${cardCls} grid gap-2 md:grid-cols-3 text-xs`} aria-label="New opportunity">
      <h2 className={`${headCls} md:col-span-3`}>New opportunity</h2>
      {!householdId && (
        <label>Household
          <select value={f.household_id} onChange={set("household_id")} className={inputCls}><option value="">None</option>{households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}<option value={NEW_HOUSEHOLD}>+ Create new household…</option></select>
        </label>
      )}
      {!householdId && f.household_id === NEW_HOUSEHOLD && (
        <label>New household name
          <input value={newHousehold} onChange={(e) => setNewHousehold(e.target.value)} className={inputCls} placeholder="e.g. Sharma family" autoFocus />
        </label>
      )}
      <label>Product<select value={f.product_line} onChange={set("product_line")} className={inputCls}>{PRODUCT_LINES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
      <label>Title<input value={f.title} onChange={set("title")} className={inputCls} /></label>
      <label>Amount (₹)<input inputMode="decimal" value={f.amount} onChange={set("amount")} className={inputCls} /></label>
      <label>Expected close<input type="date" value={f.expected_close} onChange={set("expected_close")} className={inputCls} /></label>
      {relevant && (
        <>
          <label>AMFI scheme code (optional)<input value={f.scheme_code} onChange={set("scheme_code")} className={inputCls} /></label>
          <label>Riskometer<select value={f.riskometer} onChange={set("riskometer")} className={inputCls}><option value="">From the scheme&apos;s category</option>{Object.entries(RISKOMETER_LABELS).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}</select></label>
        </>
      )}
      {check && check.level !== "ok" && check.message && (
        <p role="alert" className={`md:col-span-3 rounded border px-3 py-2 font-medium ${tone}`}>
          {check.level === "block" ? "Blocked: " : "Warning: "}{check.message}
          {check.level === "block" && customer?.role !== "admin" && " Only an admin can proceed, with a documented reason."}
        </p>
      )}
      {check?.level === "block" && customer?.role === "admin" && (
        <label className="md:col-span-3">Override reason (documented on the record)
          <input value={f.override} onChange={set("override")} className={inputCls} placeholder="e.g. Client signed the risk-acceptance form" />
        </label>
      )}
      {error && <p role="alert" className={`md:col-span-3 ${errCls}`}>{error}</p>}
      <div className="md:col-span-3 flex justify-end gap-2">
        <button type="button" className="text-xs underline" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className={btnCls} disabled={busy || (check?.level === "block" && customer?.role === "admin" && !f.override.trim())}>{busy ? "Creating…" : "Create"}</button>
      </div>
    </form>
  );
}
