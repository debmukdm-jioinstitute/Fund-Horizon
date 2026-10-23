// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import type { Activity, Household, Lead, Opportunity } from "../../lib/crmApi";
import { LEAD_STATUSES } from "../../lib/crmApi";
import { formatRupeesFromPaise, PRODUCT_LINES, STAGES_BY_LINE, stageLabel } from "../../lib/crmProductsApi";
import ListView, { type FilterDef, type ListColumn } from "./ListView";
import OwnerAvatar from "./OwnerAvatar";
import { rupees, tierTone } from "./ui";

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  role: string;
  household_id: string;
  household_name: string;
  rm_id: string | null;
  tax_status?: string;
  dob?: string | null;
}

const IST = "Asia/Kolkata";

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    timeZone: IST, day: "numeric", month: "short", year: "numeric",
    ...(withTime && iso.includes("T") ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

const label = (s: string) => s.replaceAll("_", " ");

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  const tones = {
    neutral: "bg-[#ECEBEA] text-[#181818] dark:bg-[#24303E] dark:text-[#EDF2F7]",
    good: "bg-[#EAF5FE] text-[#0B5D3B] dark:bg-[#10372A] dark:text-[#7FE0B5]",
    bad: "bg-[#FBE7EA] text-[#9B1C2E] dark:bg-[#43181F] dark:text-[#FFA9B5]",
    warn: "bg-[#FFF1D6] text-[#8A5A00] dark:bg-[#40300E] dark:text-[#FFD27A]",
  };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${tones[tone]}`}>{children}</span>;
}

const owner = (id: string | null | undefined) => <OwnerAvatar ownerId={id} />;
const ownerFilter = (key: string): FilterDef => ({ key, label: "Owner", type: "owner" });

/* ---------------- Households ---------------- */
const householdColumns: ListColumn<Household>[] = [
  { id: "name", header: "Household", sortKey: "name", cell: (h) => h.name },
  { id: "rm", header: "Owner", sortKey: "rm_id", cell: (h) => owner(h.rm_id) },
  { id: "aum", header: "AUM", cell: (h) => (h.aum_paise ? rupees(h.aum_paise) : "–") },
  {
    id: "tier", header: "Tier",
    cell: (h) => <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${tierTone[h.tier ?? "standard"]}`}>{h.tier ?? "standard"}</span>,
  },
  {
    id: "direct", header: "Direct plan",
    cell: (h) => (h.has_direct_plan ? <Badge tone="warn">Direct</Badge> : "–"),
  },
  { id: "members", header: "Members", hiddenByDefault: true, cell: (h) => h.member_count },
  { id: "open", header: "Open opps", cell: (h) => h.open_opportunities },
  { id: "created", header: "Created", sortKey: "created_at", cell: (h) => fmtDate(h.created_at) },
];
export const HouseholdsList = ({ reloadKey }: { reloadKey?: number }) => (
  <ListView<Household>
    entity="households" columns={householdColumns} filters={[
      ownerFilter("rm_id"),
      { key: "tier", label: "Tier", type: "select", options: ["platinum", "gold", "silver", "standard"].map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })) },
    ]}
    reloadKey={reloadKey}
    rowHref={(h) => `/backoffice/crm/households/${h.id}`} searchPlaceholder="Search households…"
  />
);

/* ---------------- Contacts ---------------- */
const contactColumns: ListColumn<Contact>[] = [
  { id: "name", header: "Name", sortKey: "name", cell: (c) => c.name },
  { id: "email", header: "Email", sortKey: "email", cell: (c) => c.email ?? "–" },
  { id: "mobile", header: "Mobile", sortKey: "mobile", cell: (c) => c.mobile ?? "–" },
  { id: "role", header: "Relation", sortKey: "relation", cell: (c) => <Badge>{c.role}</Badge> },
  { id: "tax", header: "Tax status", sortKey: "tax_status", cell: (c) => <Badge tone={c.tax_status && c.tax_status !== "resident" ? "warn" : "neutral"}>{(c.tax_status ?? "resident").toUpperCase()}</Badge> },
  { id: "dob", header: "Date of birth", sortKey: "dob", hiddenByDefault: true, cell: (c) => fmtDate(c.dob) },
  {
    id: "household", header: "Household", sortKey: "household_name",
    cell: (c) => (
      <Link href={`/backoffice/crm/households/${c.household_id}`} className="hover:underline">{c.household_name}</Link>
    ),
  },
  { id: "rm", header: "Owner", cell: (c) => owner(c.rm_id) },
];
export const ContactsList = ({ reloadKey }: { reloadKey?: number }) => (
  <ListView<Contact>
    entity="contacts" reloadKey={reloadKey} columns={contactColumns} filters={[{ key: "gaps", label: "Data gaps", type: "toggle" }]} searchPlaceholder="Search name, email, mobile, household…"
    rowHref={(c) => `/backoffice/crm/contacts/${c.id}`}
  />
);

/* ---------------- Leads ---------------- */
const LEAD_SOURCES = ["qr_code", "sip_calculator", "website", "blog", "referral", "plan_link", "crossword", "other"];
const leadTone = (s: string) => (s === "converted" ? "good" : s === "lost" ? "bad" : s === "qualified" ? "warn" : "neutral");
const leadColumns: ListColumn<Lead>[] = [
  { id: "sr_no", header: "Sr No", sortKey: "sr_no", cell: (l) => (l.sr_no != null ? <span className="tabular-nums font-medium">{l.sr_no}</span> : "–") },
  { id: "name", header: "Name", sortKey: "name", link: true, cell: (l) => l.name },
  { id: "email", header: "Email", sortKey: "email", cell: (l) => l.email ?? "–" },
  { id: "mobile", header: "Mobile", sortKey: "mobile", cell: (l) => l.mobile ?? "–" },
  { id: "source", header: "Source", sortKey: "source", cell: (l) => label(l.source) },
  { id: "status", header: "Status", sortKey: "status", cell: (l) => <Badge tone={leadTone(l.status)}>{l.status}</Badge> },
  { id: "owner", header: "Owner", sortKey: "assigned_rm_id", cell: (l) => owner(l.assigned_rm_id) },
  { id: "created", header: "Created", sortKey: "created_at", cell: (l) => fmtDate(l.created_at) },
];
export const LeadsList = ({ reloadKey }: { reloadKey?: number }) => (
  <ListView<Lead>
    entity="leads" columns={leadColumns} reloadKey={reloadKey}
    filters={[
      { key: "status", label: "Status", type: "select", options: LEAD_STATUSES.map((s) => ({ value: s, label: label(s) })) },
      ownerFilter("assigned_rm_id"),
      { key: "source", label: "Source", type: "select", options: LEAD_SOURCES.map((s) => ({ value: s, label: label(s) })) },
      { key: "created", label: "Created", type: "daterange" },
    ]}
    rowHref={(l) => `/backoffice/crm/leads/${l.id}`} searchPlaceholder="Search leads…"
  />
);

/* ---------------- Opportunities ---------------- */
const oppColumns: ListColumn<Opportunity>[] = [
  { id: "title", header: "Opportunity", sortKey: "title", cell: (o) => o.title },
  { id: "line", header: "Product", sortKey: "product_line", cell: (o) => label(o.product_line) },
  {
    id: "stage", header: "Stage", sortKey: "stage",
    cell: (o) => <Badge tone={o.stage === "won" ? "good" : o.stage === "lost" ? "bad" : "neutral"}>{stageLabel(o.stage)}</Badge>,
  },
  {
    id: "amount", header: "Amount", sortKey: "amount",
    cell: (o) => formatRupeesFromPaise(o.stage === "won" ? (o.won_amount ?? o.amount) : o.amount),
  },
  { id: "prob", header: "Prob.", sortKey: "probability", cell: (o) => `${o.probability}%` },
  { id: "household", header: "Household", cell: (o) => o.household_name ?? o.customer_name ?? "–" },
  { id: "owner", header: "Owner", sortKey: "assigned_rm_id", cell: (o) => owner(o.assigned_rm_id) },
  { id: "close", header: "Expected close", sortKey: "expected_close", cell: (o) => fmtDate(o.expected_close) },
  { id: "created", header: "Created", sortKey: "created_at", hiddenByDefault: true, cell: (o) => fmtDate(o.created_at) },
];
const allStages = Array.from(new Set(Object.values(STAGES_BY_LINE).flat())).concat("lost");
export const OpportunitiesList = ({ reloadKey }: { reloadKey?: number }) => (
  <ListView<Opportunity>
    entity="opportunities" columns={oppColumns} reloadKey={reloadKey}
    filters={[
      { key: "product_line", label: "Product", type: "select", options: PRODUCT_LINES.map((p) => ({ value: p.value, label: p.label })) },
      { key: "stage", label: "Stage", type: "select", options: allStages.map((s) => ({ value: s, label: stageLabel(s) })) },
      { key: "open", label: "Open only", type: "toggle" },
      { key: "won_this_month", label: "Won this month", type: "toggle" },
      ownerFilter("assigned_rm_id"),
    ]}
    rowHref={(o) => `/backoffice/crm/opportunities/${o.id}`} searchPlaceholder="Search opportunities…"
  />
);

/* ---------------- Tasks (activities) ---------------- */
const taskColumns: ListColumn<Activity>[] = [
  { id: "subject", header: "Subject", sortKey: "subject", cell: (a) => a.subject },
  { id: "kind", header: "Type", sortKey: "kind", cell: (a) => <Badge>{a.kind}</Badge> },
  { id: "due", header: "Due", sortKey: "due_at", cell: (a) => fmtDate(a.due_at, true) },
  {
    id: "done", header: "Status", sortKey: "done_at",
    cell: (a) => (a.done_at ? <Badge tone="good">Done</Badge> : <Badge tone={a.due_at && a.due_at.slice(0, 10) < new Date(Date.now() + 19800000).toISOString().slice(0, 10) ? "bad" : "neutral"}>Open</Badge>),
  },
  { id: "owner", header: "Owner", sortKey: "assigned_rm_id", cell: (a) => owner(a.assigned_rm_id) },
  { id: "created", header: "Created", sortKey: "created_at", hiddenByDefault: true, cell: (a) => fmtDate(a.created_at) },
];
export const TasksList = ({ reloadKey }: { reloadKey?: number }) => (
  <ListView<Activity>
    entity="activities" columns={taskColumns} reloadKey={reloadKey}
    filters={[
      { key: "done", label: "Status", type: "select", options: [{ value: "false", label: "Open" }, { value: "true", label: "Done" }] },
      { key: "overdue", label: "Overdue only", type: "toggle" },
      ownerFilter("assigned_rm_id"),
    ]}
    searchPlaceholder="Search tasks…"
  />
);

/* ---------------- Cases ---------------- */
