// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { fetchPage } from "../../lib/crmListApi";
import {
  fetchCase, fetchHouseholdDetail, fetchLead, fetchOpportunity, patchCase, patchHousehold, patchLead, patchOpportunity,
  type CrmCase, type HouseholdDetail, type Lead, type Opportunity,
} from "../../lib/crmApi";
import { formatRupeesFromPaise, STAGES_BY_LINE, type ProductLine } from "../../lib/crmProductsApi";
import { emailSchema, fieldErrors, lostSchema, mobileSchema } from "../../lib/crmSchemas";
import { fmtDate } from "./EntityLists";
import ConvertLeadDialog from "./ConvertLeadDialog";
import HouseholdView from "./HouseholdView";
import InlineField from "./InlineField";
import OwnerAvatar from "./OwnerAvatar";
import { Layout, OwnerField, Skeleton, btn, card, useRecord, type Kind } from "./RecordShell";
import PathBar from "./PathBar";
import RelatedLists from "./RelatedLists";
import Timeline, { type TimelineTarget } from "./Timeline";
import ContactRecord from "./ContactRecord";
import HoldingsCard from "./HouseholdAum";
import AddContactForm from "./AddContactForm";
import NewOpportunityForm from "./NewOpportunityForm";
import { useCanWrite } from "./useCanWrite";


/* ------------------------------ Lead ------------------------------ */
const LEAD_PATH = ["new", "contacted", "qualified", "converted", "lost"];

function LeadRecord({ id }: { id: string }) {
  const { data: lead, setData, error } = useRecord(() => fetchLead(id), [id]);
  const [converting, setConverting] = useState(false);
  const [bump, setBump] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);
  if (error) return <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>;
  if (!lead) return <Skeleton />;

  const save = async (patch: Parameters<typeof patchLead>[1]) => {
    setData(await patchLead(lead.id, patch));
    setBump((b) => b + 1);
  };
  const converted = lead.status === "converted";

  return (
    <>
      <Layout
        kind="leads" title={lead.name}
        chips={<span className="rounded bg-[#EEF2F6] dark:bg-[#24303E] px-2 py-0.5 font-semibold capitalize">{lead.status}</span>}
        owner={<OwnerAvatar ownerId={lead.assigned_rm_id} />}
        actions={!converted && lead.status !== "lost" && <button type="button" className={btn} onClick={() => setConverting(true)}>Convert</button>}
        path={
          <>
            <PathBar
              stages={LEAD_PATH} current={lead.status} closed={converted}
              onSelect={(s) => {
                setPathError(null);
                if (s === "converted") setConverting(true);
                else save({ status: s }).catch((e) => setPathError(e instanceof Error ? e.message : "Could not update"));
              }}
            />
            {pathError && <p role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-300">{pathError}</p>}
          </>
        }
        left={
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#172033] dark:text-[#EDF2F7]">Details</h2>
            <InlineField label="Name" value={lead.name} readOnly={converted} validate={(v) => (v.trim() ? null : "Name is required")} onSave={(v) => save({ name: v.trim() })} />
            <InlineField
              label="Email" value={lead.email} readOnly={converted}
              validate={(v) => fieldErrors(emailSchemaObj, { email: v })?.email ?? null}
              onSave={(v) => save({ email: v.trim() || null })}
            />
            <InlineField
              label="Mobile" value={lead.mobile} readOnly={converted}
              validate={(v) => fieldErrors(mobileSchemaObj, { mobile: v })?.mobile ?? null}
              onSave={(v) => save({ mobile: v.trim() || null })}
            />
            <InlineField label="Source" value={lead.source.replaceAll("_", " ")} readOnly />
            <OwnerField value={lead.assigned_rm_id} onSave={(rm) => save({ assigned_rm_id: rm })} />
            <InlineField label="Notes" value={lead.notes} type="textarea" onSave={(v) => save({ notes: v })} />
            <InlineField label="Created" value={fmtDate(lead.created_at, true)} readOnly />
            {lead.converted_at && (
              <InlineField
                label="Converted" value="" readOnly
                display={<>{fmtDate(lead.converted_at, true)}{lead.converted_household_id && <> · <Link className="underline text-[#006F64] dark:text-[#75E1CE]" href={`/backoffice/crm/households/${lead.converted_household_id}`}>Open household</Link></>}</>}
              />
            )}
          </div>
        }
        right={<Timeline target={{ entity: "lead", id: lead.id }} refreshKey={bump} />}
      />
      {converting && (
        <ConvertLeadDialog
          lead={lead}
          onClose={() => setConverting(false)}
          onConverted={(res) => {
            setData({ ...lead, status: "converted", converted_household_id: res.household_id, converted_at: new Date().toISOString() });
            setBump((b) => b + 1);
          }}
        />
      )}
    </>
  );
}

const emailSchemaObj = z.object({ email: emailSchema });
const mobileSchemaObj = z.object({ mobile: mobileSchema });

/* --------------------------- Opportunity --------------------------- */
function OppRecord({ id }: { id: string }) {
  const { data: opp, setData, error } = useRecord(() => fetchOpportunity(id), [id]);
  const [bump, setBump] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  if (error) return <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>;
  if (!opp) return <Skeleton />;

  const line = opp.product_line as ProductLine;
  const stages = [...(STAGES_BY_LINE[line] ?? []), "lost"];
  const closed = opp.stage === "won" || opp.stage === "lost";
  const save = async (patch: Parameters<typeof patchOpportunity>[1]) => {
    const updated = await patchOpportunity(opp.id, patch);
    setData({ ...opp, ...updated });
    setBump((b) => b + 1);
  };
  const moveTo = async (stage: string) => {
    setPathError(null);
    if (stage === "lost") {
      setLosing(true);
      return;
    }
    try {
      await save({ stage });
    } catch (e) {
      setPathError(e instanceof Error ? e.message : "Could not move the stage");
    }
  };
  const confirmLost = async () => {
    const errs = fieldErrors(lostSchema, { lost_reason: reason });
    if (errs) return setReasonError(errs.lost_reason);
    try {
      await save({ stage: "lost", lost_reason: reason.trim() });
      setLosing(false);
    } catch (e) {
      setReasonError(e instanceof Error ? e.message : "Could not mark lost");
    }
  };
  const rupees = (paise: number | null | undefined) => (paise == null ? "" : String(paise / 100));

  return (
    <>
      <Layout
        kind="opportunities" title={opp.title}
        chips={<span className="rounded bg-[#EEF2F6] dark:bg-[#24303E] px-2 py-0.5 font-semibold">{opp.product_line.replaceAll("_", " ")} · {formatRupeesFromPaise(opp.stage === "won" ? (opp.won_amount ?? opp.amount) : opp.amount)}</span>}
        owner={<OwnerAvatar ownerId={opp.assigned_rm_id} />}
        path={
          <>
            <PathBar stages={stages} current={opp.stage} closed={closed} onSelect={moveTo} />
            {pathError && <p role="alert" className="text-xs font-medium text-rose-700 dark:text-rose-300">{pathError}</p>}
          </>
        }
        left={
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#172033] dark:text-[#EDF2F7]">Details</h2>
            <InlineField label="Title" value={opp.title} validate={(v) => (v.trim() ? null : "Title is required")} onSave={(v) => save({ title: v.trim() })} />
            <InlineField
              label="Amount (₹)" value={rupees(opp.amount)} type="number" display={formatRupeesFromPaise(opp.amount)}
              validate={(v) => (v === "" || Number(v) >= 0 ? null : "Amount cannot be negative")}
              onSave={(v) => save({ amount: Math.round(Number(v) * 100) })}
            />
            <InlineField
              label="Probability %" value={String(opp.probability)} type="number" readOnly={closed}
              validate={(v) => (Number(v) >= 0 && Number(v) <= 100 ? null : "Enter 0 to 100")}
              onSave={(v) => save({ probability: Math.round(Number(v)) })}
            />
            <InlineField label="Expected close" value={opp.expected_close} type="date" display={fmtDate(opp.expected_close)} onSave={(v) => save({ expected_close: v || undefined })} />
            <InlineField
              label="Household" value="" readOnly
              display={opp.household_id ? <Link className="underline text-[#006F64] dark:text-[#75E1CE]" href={`/backoffice/crm/households/${opp.household_id}`}>{opp.household_name ?? "Open household"}</Link> : (opp.customer_name ?? "–")}
            />
            <OwnerField value={opp.assigned_rm_id} onSave={(rm) => save({ assigned_rm_id: rm })} />
            {opp.stage === "won" && <InlineField label="Won amount" value="" readOnly display={formatRupeesFromPaise(opp.won_amount ?? opp.amount)} />}
            {opp.stage === "lost" && <InlineField label="Lost reason" value={opp.lost_reason} readOnly />}
            {opp.closed_at && <InlineField label="Closed" value={fmtDate(opp.closed_at, true)} readOnly />}
            <InlineField label="Notes" value={opp.notes} type="textarea" onSave={(v) => save({ notes: v })} />
            <InlineField label="Created" value={fmtDate(opp.created_at, true)} readOnly />
          </div>
        }
        right={<Timeline target={{ entity: "opportunity", id: opp.id, householdId: opp.household_id } as TimelineTarget} refreshKey={bump} />}
      />
      {losing && (
        <div className="fixed inset-0 z-50 bg-navy-950/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mark opportunity lost">
          <div className="bg-white dark:bg-[#10151C] rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] shadow-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-base font-bold text-[#172033] dark:text-[#EDF2F7]">Mark “{opp.title}” as lost</h3>
            <label className="block text-xs font-semibold text-[#172033] dark:text-[#EDF2F7]" htmlFor="rec-lost-reason">Reason (required)</label>
            <textarea id="rec-lost-reason" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full px-3 py-2 text-xs rounded-xl border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#172033] dark:text-[#EDF2F7]" />
            {reasonError && <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{reasonError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setLosing(false)} className="flex-1 px-3 py-2 text-xs font-semibold bg-[#EEF2F6] dark:bg-[#24303E] rounded-xl">Cancel</button>
              <button type="button" onClick={confirmLost} className="flex-1 px-3 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl">Mark lost</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------- Case ------------------------------- */
const CASE_STATUS = ["open", "in_progress", "resolved", "escalated_amc", "escalated_scores", "closed"];

function CaseRecord({ id }: { id: string }) {
  const { data: c, setData, error } = useRecord(() => fetchCase(id), [id]);
  const [bump, setBump] = useState(0);
  if (error) return <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>;
  if (!c) return <Skeleton />;
  const save = async (patch: Parameters<typeof patchCase>[1]) => {
    const updated = await patchCase(c.id, patch);
    setData({ ...c, ...updated });
    setBump((b) => b + 1);
  };
  const breaching = !!c.sla_due_at && c.sla_due_at.slice(0, 10) < new Date(Date.now() + 19800000).toISOString().slice(0, 10) && !["resolved", "closed"].includes(c.status);
  return (
    <Layout
      kind="cases" title={c.subject}
      chips={
        <>
          <span className="rounded bg-[#EEF2F6] dark:bg-[#24303E] px-2 py-0.5 font-semibold capitalize">{c.status.replaceAll("_", " ")}</span>
          {breaching && <span className="rounded bg-[#FBE7EA] dark:bg-[#43181F] text-[#9B1C2E] dark:text-[#FFA9B5] px-2 py-0.5 font-semibold">SLA breached</span>}
        </>
      }
      path={<PathBar stages={CASE_STATUS} current={c.status} onSelect={(s) => void save({ status: s }).catch(() => undefined)} />}
      left={
        <div className={card}>
          <h2 className="text-sm font-bold mb-2 text-[#172033] dark:text-[#EDF2F7]">Details</h2>
          <InlineField label="Status" value={c.status} type="select" display={c.status.replaceAll("_", " ")} options={CASE_STATUS.map((s) => ({ value: s, label: s.replaceAll("_", " ") }))} onSave={(v) => save({ status: v })} />
          <InlineField label="Category" value={c.category.replaceAll("_", " ")} readOnly />
          <InlineField label="Customer" value={c.customer_name} readOnly />
          <InlineField label="SLA due" value={c.sla_due_at?.slice(0, 10)} type="date" display={fmtDate(c.sla_due_at)} onSave={(v) => save({ sla_due_at: v || undefined })} />
          <InlineField label="Details" value={c.body} type="textarea" onSave={(v) => save({ body: v })} />
          <InlineField label="Opened" value={fmtDate(c.created_at, true)} readOnly />
          <InlineField label="Resolved" value={fmtDate(c.resolved_at, true)} readOnly />
        </div>
      }
      right={<Timeline target={{ entity: "case", id: c.id }} refreshKey={bump} />}
    />
  );
}

/* ----------------------------- Household ----------------------------- */
function HouseholdPeople({ data, onChanged }: { data: HouseholdDetail; onChanged: () => void }) {
  const canWrite = useCanWrite();
  const [version, setVersion] = useState(0);
  const [people, setPeople] = useState<{ id: string; name: string; relation: string; tax_status: string; gaps?: string[] }[] | null>(null);
  useEffect(() => {
    fetchPage<{ id: string; name: string; relation: string; tax_status: string; dob: string | null }>("contacts", { limit: 200, offset: 0, filters: { household_id: data.household.id } })
      .then((r) => setPeople(r.rows))
      .catch(() => setPeople([]));
  }, [data.household.id, version]);
  return (
    <div className={card} aria-label="Contacts">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-[#172033] dark:text-[#EDF2F7]">Contacts</h2>
        {canWrite && <NewOpportunityForm householdId={data.household.id} onCreated={onChanged} />}
      </div>
      {people === null ? <p className="text-xs text-[#536176] dark:text-[#A8B4C4]">Loading contacts…</p> : (
        <ul className="space-y-1 text-xs mb-3">
          {people.map((p) => (
            <li key={p.id} className="flex justify-between gap-2">
              <Link className="font-semibold underline text-[#006F64] dark:text-[#75E1CE]" href={`/backoffice/crm/contacts/${p.id}`}>{p.name}</Link>
              <span className="text-[#536176] dark:text-[#A8B4C4] capitalize">{p.relation} · {p.tax_status.toUpperCase()}</span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <AddContactForm
          householdId={data.household.id}
          guardians={(people ?? []).map((p) => ({ id: p.id, name: p.name }))}
          onCreated={() => { setVersion((v) => v + 1); onChanged(); }}
        />
      )}
    </div>
  );
}

function HouseholdRecord({ id }: { id: string }) {
  const { data, setData, error } = useRecord<HouseholdDetail>(() => fetchHouseholdDetail(id), [id]);
  const [bump, setBump] = useState(0);
  const onNotFound = useCallback(() => undefined, []);
  if (error) return <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>;
  if (!data) return <Skeleton />;
  const h = data.household;
  const save = async (patch: Parameters<typeof patchHousehold>[1]) => {
    const updated = await patchHousehold(h.id, patch);
    setData({ ...data, household: { ...h, ...updated } });
    setBump((b) => b + 1);
  };
  return (
    <Layout
      kind="households" title={h.name}
      chips={<span className="rounded bg-[#EEF2F6] dark:bg-[#24303E] px-2 py-0.5 font-semibold">{data.members.length} member{data.members.length === 1 ? "" : "s"} · {data.opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost").length} open</span>}
      owner={<OwnerAvatar ownerId={h.rm_id} />}
      left={
        <>
          <div className={card}>
            <h2 className="text-sm font-bold mb-2 text-[#172033] dark:text-[#EDF2F7]">Details</h2>
            <InlineField label="Name" value={h.name} validate={(v) => (v.trim() ? null : "Name is required")} onSave={(v) => save({ name: v.trim() })} />
            <OwnerField value={h.rm_id} onSave={(rm) => save({ rm_id: rm })} />
            <InlineField label="Notes" value={h.notes} type="textarea" onSave={(v) => save({ notes: v })} />
            <InlineField label="Created" value={fmtDate(h.created_at, true)} readOnly />
          </div>
          <HoldingsCard householdId={h.id} />
          <HouseholdPeople data={data} onChanged={() => setBump((b) => b + 1)} />
          <HouseholdView householdId={h.id} onNotFound={onNotFound} showTitle={false} />
          <RelatedLists members={data.members} />
        </>
      }
      right={<Timeline target={{ entity: "household", id: h.id }} refreshKey={bump} />}
    />
  );
}

export default function RecordPage({ kind, id }: { kind: Kind; id: string }) {
  if (kind === "households") return <HouseholdRecord id={id} />;
  if (kind === "contacts") return <ContactRecord id={id} />;
  if (kind === "leads") return <LeadRecord id={id} />;
  if (kind === "opportunities") return <OppRecord id={id} />;
  return <CaseRecord id={id} />;
}

export type { Lead, Opportunity, CrmCase };
