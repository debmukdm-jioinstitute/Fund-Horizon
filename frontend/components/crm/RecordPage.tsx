// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  fetchCase,
  fetchLead,
  fetchOpportunity,
  type CrmCase,
  type Lead,
  type Opportunity,
} from "../../lib/crmApi";
import { formatRupeesFromPaise, stageLabel } from "../../lib/crmProductsApi";
import HouseholdView from "./HouseholdView";
import { tabHref } from "./tabs";

type Kind = "households" | "leads" | "opportunities" | "cases";

const KIND_LABEL: Record<Kind, { singular: string; tab: string }> = {
  households: { singular: "Household", tab: "households" },
  leads: { singular: "Lead", tab: "leads" },
  opportunities: { singular: "Opportunity", tab: "pipelines" },
  cases: { singular: "Grievance", tab: "cases" },
};

const when = (iso: string | null | undefined): string => {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

type Row = [label: string, value: React.ReactNode];

function Details({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5 max-w-2xl">
      <h2 className="text-lg font-bold text-navy-950 mb-3">{title}</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold text-navy-600">{label}</dt>
            <dd className="text-navy-900 break-words">{value || "–"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function leadRows(l: Lead): { title: string; rows: Row[] } {
  return {
    title: l.name,
    rows: [
      ["Status", l.status],
      ["Email", l.email],
      ["Mobile", l.mobile],
      ["Source", l.source.replaceAll("_", " ")],
      ["Notes", l.notes],
      ["Created", when(l.created_at)],
      [
        "Converted",
        l.converted_at ? (
          <>
            {when(l.converted_at)}
            {l.converted_household_id && (
              <>
                {" · "}
                <Link className="underline text-teal-700" href={`/backoffice/crm/households/${l.converted_household_id}`}>
                  Open household
                </Link>
              </>
            )}
          </>
        ) : null,
      ],
    ],
  };
}

function oppRows(o: Opportunity): { title: string; rows: Row[] } {
  return {
    title: o.title,
    rows: [
      ["Product line", o.product_line.replaceAll("_", " ")],
      ["Stage", stageLabel(o.stage)],
      ["Amount", formatRupeesFromPaise(o.amount)],
      ["Probability", `${o.probability}%`],
      ["Expected close", o.expected_close],
      ["Household", o.household_id ? <Link className="underline text-teal-700" href={`/backoffice/crm/households/${o.household_id}`}>{o.household_name ?? "Open household"}</Link> : o.customer_name],
      ["Won amount", o.stage === "won" ? formatRupeesFromPaise(o.won_amount ?? o.amount) : null],
      ["Lost reason", o.stage === "lost" ? o.lost_reason : null],
      ["Closed", when(o.closed_at)],
      ["Notes", o.notes],
      ["Created", when(o.created_at)],
      ["Updated", when(o.updated_at)],
    ],
  };
}

function caseRows(c: CrmCase): { title: string; rows: Row[] } {
  return {
    title: c.subject,
    rows: [
      ["Status", c.status.replaceAll("_", " ")],
      ["Category", c.category.replaceAll("_", " ")],
      ["Customer", c.customer_name],
      ["Details", c.body],
      ["SLA due", when(c.sla_due_at)],
      ["Opened", when(c.created_at)],
      ["Resolved", when(c.resolved_at)],
    ],
  };
}

export default function RecordPage({ kind, id }: { kind: Kind; id: string }) {
  const [data, setData] = useState<{ title: string; rows: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const markMissing = useCallback(() => setMissing(true), []); // stable: HouseholdView reloads when it changes

  useEffect(() => {
    if (kind === "households") return;
    let alive = true;
    const run = async () => {
      try {
        if (kind === "leads") setData(leadRows(await fetchLead(id)));
        else if (kind === "opportunities") setData(oppRows(await fetchOpportunity(id)));
        else setData(caseRows(await fetchCase(id)));
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof Error ? e.message : "Could not load this record");
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [kind, id]);

  if (missing) notFound(); // the generic 404 page, not the plan one

  const { singular, tab } = KIND_LABEL[kind];
  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-navy-600">
        <Link href="/backoffice/crm" className="hover:underline">CRM</Link>
        {" / "}
        <Link href={tabHref(tab)} className="hover:underline">{singular}s</Link>
        {" / "}
        <span className="text-navy-900">{singular}</span>
      </nav>
      {kind === "households" ? (
        <HouseholdView householdId={id} onNotFound={markMissing} />
      ) : error ? (
        <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">{error}</div>
      ) : data ? (
        <Details title={data.title} rows={data.rows} />
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading" className="max-w-2xl space-y-2">
          <div className="h-6 w-1/2 rounded bg-navy-100 animate-pulse" />
          <div className="h-4 w-full rounded bg-navy-100 animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-navy-100 animate-pulse" />
        </div>
      )}
    </div>
  );
}
