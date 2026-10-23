// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { bulkDeleteRecords } from "../../lib/crmListApi";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import { crmRaw } from "../../lib/crmApi";
import { fetchPage } from "../../lib/crmListApi";
import { FATCA_CRS, fetchContact, patchContact, RELATIONS, TAX_STATUSES, type ContactDetail } from "../../lib/crmPhase3Api";
import { fmtDate } from "./EntityLists";
import HoldingsCard from "./HouseholdAum";
import InlineField from "./InlineField";
import { Layout, Skeleton, card, useRecord } from "./RecordShell";
import SuitabilityPanel from "./SuitabilityPanel";
import ContactSips from "./ContactSips";
import EmailDialog from "./EmailDialog";
import { btnCls, errCls, inputCls } from "./ui";
import { useCanWrite } from "./useCanWrite";

const GAP_LABEL: Record<string, string> = {
  nominee: "No nominee", kyc: "KYC incomplete", kyc_expired: "KYC expired", fatca_crs: "FATCA/CRS not collected",
};
const label = (s: string) => s.replaceAll("_", " ");

/** Tax residency edits together: moving someone to NRI needs the country in the same save. */
function TaxResidency({ c, onSaved }: { c: ContactDetail; onSaved: (c: ContactDetail) => void }) {
  const canWrite = useCanWrite();
  const [f, setF] = useState({ tax_status: c.tax_status, country: c.country ?? "", nre_bank: c.nre_bank ?? "", nro_bank: c.nro_bank ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offshore = f.tax_status !== "resident";
  const dirty = f.tax_status !== c.tax_status || f.country !== (c.country ?? "") || f.nre_bank !== (c.nre_bank ?? "") || f.nro_bank !== (c.nro_bank ?? "");
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await patchContact(c.id, {
        tax_status: f.tax_status, country: offshore ? f.country.trim() || null : null,
        nre_bank: offshore ? f.nre_bank.trim() || null : null, nro_bank: offshore ? f.nro_bank.trim() || null : null,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-[9rem_1fr] items-center gap-2">
        <label htmlFor="tax-status" className="font-semibold text-[#706E6B] dark:text-[#A8B4C4]">Tax status</label>
        <select id="tax-status" disabled={!canWrite} value={f.tax_status} onChange={(e) => setF({ ...f, tax_status: e.target.value })} className={inputCls}>
          {TAX_STATUSES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        {offshore && (
          <>
            <label htmlFor="tax-country" className="font-semibold text-[#706E6B] dark:text-[#A8B4C4]">Country</label>
            <input id="tax-country" disabled={!canWrite} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} className={inputCls} />
            <label htmlFor="tax-nre" className="font-semibold text-[#706E6B] dark:text-[#A8B4C4]">NRE bank</label>
            <input id="tax-nre" disabled={!canWrite} value={f.nre_bank} onChange={(e) => setF({ ...f, nre_bank: e.target.value })} className={inputCls} />
            <label htmlFor="tax-nro" className="font-semibold text-[#706E6B] dark:text-[#A8B4C4]">NRO bank</label>
            <input id="tax-nro" disabled={!canWrite} value={f.nro_bank} onChange={(e) => setF({ ...f, nro_bank: e.target.value })} className={inputCls} />
          </>
        )}
      </div>
      {error && <p role="alert" className={errCls}>{error}</p>}
      {canWrite && dirty && <div className="flex justify-end"><button type="button" className={btnCls} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save tax residency"}</button></div>}
    </div>
  );
}

/** "Do not email" — staff record a client's request; sends then skip them. Clients can also opt out from any email's link. */
function EmailOptOut({ customerId }: { customerId: string }) {
  const canWrite = useCanWrite();
  const [out, setOut] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { crmRaw<{ opted_out: boolean }>(`/customers/${customerId}/email-optout`).then((r) => setOut(r.opted_out)).catch(() => setOut(null)); }, [customerId]);
  if (out === null) return null;
  const toggle = async (v: boolean) => {
    setError(null);
    try { setOut((await crmRaw<{ opted_out: boolean }>(`/customers/${customerId}/email-optout`, { method: "PUT", body: JSON.stringify({ opted_out: v }) })).opted_out); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
  };
  return (
    <div className="text-xs">
      <label className="flex items-center gap-2 font-semibold text-[#181818] dark:text-[#EDF2F7]">
        <input type="checkbox" disabled={!canWrite} checked={out} onChange={(e) => toggle(e.target.checked)} /> Do not email this client
      </label>
      {error && <p role="alert" className={errCls}>{error}</p>}
    </div>
  );
}

export default function ContactRecord({ id }: { id: string }) {
  const { data: c, setData, error } = useRecord(() => fetchContact(id), [id]);
  const canWrite = useCanWrite();
  const router = useRouter();
  const [emailing, setEmailing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adults, setAdults] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!c) return;
    fetchPage<{ id: string; name: string; dob: string | null }>("contacts", { limit: 200, offset: 0, filters: { household_id: c.household_id } })
      .then((r) => setAdults(r.rows.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.name }))))
      .catch(() => setAdults([]));
  }, [c]);
  if (error) return <p role="alert" className={errCls}>{error}</p>;
  if (!c) return <Skeleton />;

  const save = async (patch: Record<string, unknown>) => setData(await patchContact(c.id, patch));
  const text = (k: keyof ContactDetail, required = false) => async (v: string) => save({ [k]: v.trim() || (required ? undefined : null) });

  return (
    <>
    <Layout
      kind="contacts" title={c.name}
      actions={canWrite ? (
        <div className="flex gap-2">
          <button type="button" className={btnCls} onClick={() => setEmailing(true)}>Email</button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="px-3 py-1.5 text-xs font-bold rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30">Delete</button>
        </div>
      ) : undefined}
      chips={
        <>
          <span className="rounded bg-[#ECEBEA] dark:bg-[#24303E] px-2 py-0.5 font-semibold capitalize">{label(c.relation)}</span>
          <span className="rounded bg-[#ECEBEA] dark:bg-[#24303E] px-2 py-0.5 font-semibold uppercase">{c.tax_status}</span>
          {c.is_minor && <span className="rounded bg-[#FFF1D6] dark:bg-[#40300E] text-[#8A5A00] dark:text-[#FFD27A] px-2 py-0.5 font-semibold">Minor</span>}
          {c.gaps.map((g) => (
            <span key={g} className="rounded bg-[#FBE7EA] dark:bg-[#43181F] text-[#9B1C2E] dark:text-[#FFA9B5] px-2 py-0.5 font-semibold">{GAP_LABEL[g] ?? g}</span>
          ))}
        </>
      }
      left={
        <>
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#181818] dark:text-[#EDF2F7]">Details</h2>
            <InlineField label="Name" value={c.name} validate={(v) => (v.trim() ? null : "Name is required")} onSave={text("name", true)} />
            <InlineField label="Email" value={c.email?.endsWith("@placeholder.invalid") ? "" : c.email} onSave={text("email")} />
            <InlineField label="Mobile" value={c.mobile?.startsWith("0000") ? "" : c.mobile} onSave={text("mobile")} />
            <InlineField label="Relation" value={c.relation} type="select" options={RELATIONS.map((r) => ({ value: r, label: label(r) }))} onSave={(v) => save({ relation: v })} />
            <InlineField label="Date of birth" value={c.dob} type="date" display={c.dob ? `${fmtDate(c.dob)}${c.age != null ? ` · ${c.age} yrs` : ""}` : undefined} onSave={(v) => save({ dob: v || null })} />
            {(c.is_minor || c.guardian_contact_id) && (
              <InlineField
                label="Guardian" value={c.guardian_contact_id ?? ""} type="select"
                display={adults.find((a) => a.value === c.guardian_contact_id)?.label ?? (c.guardian_contact_id ? "Set" : undefined)}
                options={[{ value: "", label: "None" }, ...adults]} onSave={(v) => save({ guardian_contact_id: v || null })}
              />
            )}
            <EmailOptOut customerId={c.customer_id} />
            <InlineField label="Household" value="" readOnly display={<Link className="underline text-[#0176D3] dark:text-[#1B96FF]" href={`/backoffice/crm/households/${c.household_id}`}>{c.household_name}</Link>} />
          </div>
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#181818] dark:text-[#EDF2F7]">Tax residency</h2>
            <TaxResidency key={`${c.tax_status}-${c.country}-${c.nre_bank}-${c.nro_bank}`} c={c} onSaved={setData} />
          </div>
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#181818] dark:text-[#EDF2F7]">KYC &amp; compliance</h2>
            <InlineField label="PAN" value="" readOnly display={c.kyc?.pan_last4 ? `••••••${c.kyc.pan_last4}` : "Not on file"} />
            <InlineField label="KRA status" value="" readOnly display={c.kyc ? label(c.kyc.kra_status) : "Not on file"} />
            <InlineField label="FATCA / CRS" value={c.fatca_crs} type="select" display={label(c.fatca_crs)} options={FATCA_CRS.map((x) => ({ value: x, label: label(x) }))} onSave={(v) => save({ fatca_crs: v })} />
            <InlineField label="KYC expiry" value={c.kyc_expiry} type="date" display={fmtDate(c.kyc_expiry)} onSave={(v) => save({ kyc_expiry: v || null })} />
          </div>
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#181818] dark:text-[#EDF2F7]">Nominee</h2>
            <InlineField label="Nominee name" value={c.nominee_name} onSave={text("nominee_name")} />
            <InlineField label="Relationship" value={c.nominee_relation} onSave={text("nominee_relation")} />
            <InlineField
              label="Share %" value={c.nominee_pct == null ? "" : String(c.nominee_pct)} type="number"
              validate={(v) => (v === "" || (Number(v) >= 1 && Number(v) <= 100) ? null : "Enter 1 to 100")}
              onSave={(v) => save({ nominee_pct: v === "" ? null : Math.round(Number(v)) })}
            />
          </div>
        </>
      }
      right={
        <div className="space-y-4">
          <SuitabilityPanel customerId={c.customer_id} />
          <HoldingsCard contactId={c.id} title="Holdings" />
          <ContactSips contactId={c.id} customerId={c.customer_id} />
        </div>
      }
    />
    {emailing && <EmailDialog recipients={[{ customer_id: c.customer_id, name: c.name, email: c.email }]} onClose={() => setEmailing(false)} />}
      {confirmDelete && (
        <DeleteConfirmDialog
          title={`Delete contact "${c.name}"?`}
          description="This permanently removes the contact."
          onConfirm={async (code) => {
            await bulkDeleteRecords("contacts", [c.id], code);
            router.push("/backoffice/crm?tab=contacts");
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
