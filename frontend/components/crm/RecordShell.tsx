// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import Breadcrumb from "@/components/Breadcrumb";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthContext";
import { ApiError } from "../../lib/api";
import InlineField from "./InlineField";
import OwnerAvatar, { useOwners } from "./OwnerAvatar";
import { tabHref } from "./tabs";

export type Kind = "households" | "contacts" | "leads" | "opportunities";

const KIND_LABEL: Record<Kind, { singular: string; plural: string; tab: string }> = {
  households: { singular: "Household", plural: "Households", tab: "households" },
  contacts: { singular: "Contact", plural: "Contacts", tab: "contacts" },
  leads: { singular: "Lead", plural: "Leads", tab: "leads" },
  opportunities: { singular: "Opportunity", plural: "Opportunities", tab: "opportunities" },
};

export const card = "rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-4";
export const muted = "text-[#706E6B] dark:text-[#A8B4C4]";
export const btn = "px-3 py-1.5 text-xs font-bold rounded bg-[#0176D3] text-white hover:opacity-90 disabled:opacity-50";

export function Layout({ kind, title, chips, owner, actions, path, left, right }: {
  kind: Kind; title: string; chips?: React.ReactNode; owner?: React.ReactNode; actions?: React.ReactNode;
  path?: React.ReactNode; left: React.ReactNode; right: React.ReactNode;
}) {
  const { singular, plural, tab } = KIND_LABEL[kind];
  return (
    <div className="space-y-4">
      <Breadcrumb tone="blue" items={[{ label: "CRM", href: "/backoffice/crm" }, { label: plural, href: tabHref(tab) }, { label: singular }]} />
      <header className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${muted}`}>{singular}</p>
            <h1 className="text-xl font-bold text-[#181818] dark:text-[#EDF2F7] break-words">{title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">{chips}{owner && <span className={muted}>Owner: <span className="text-[#181818] dark:text-[#EDF2F7]">{owner}</span></span>}</div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {path}
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4 min-w-0">{left}</div>
        <div className="min-w-0">{right}</div>
      </div>
    </div>
  );
}

export function Skeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="max-w-2xl space-y-2">
      <div className="h-6 w-1/2 rounded bg-[#E5E5E5]/70 dark:bg-[#2B3644]/70 animate-pulse" />
      <div className="h-4 w-full rounded bg-[#E5E5E5]/70 dark:bg-[#2B3644]/70 animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-[#E5E5E5]/70 dark:bg-[#2B3644]/70 animate-pulse" />
    </div>
  );
}

/** Owner picker: admins can change it inline; RMs see it read-only (the API enforces the same rule). */
export function OwnerField({ value, onSave }: { value: string | null | undefined; onSave: (id: string | null) => Promise<void> }) {
  const { customer } = useAuth();
  const owners = useOwners();
  return (
    <InlineField
      label="Owner" value={value ?? ""} type="select" readOnly={customer?.role !== "admin"}
      display={<OwnerAvatar ownerId={value} />}
      options={[{ value: "", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.name }))]}
      onSave={(v) => onSave(v || null)}
    />
  );
}

/** Loads a record and maps a 404 to the generic not-found page. */
export function useRecord<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    load()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(e instanceof Error ? e.message : "Could not load this record");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  if (missing) notFound();
  return { data, setData, error, reload: () => setVersion((v) => v + 1) };
}

