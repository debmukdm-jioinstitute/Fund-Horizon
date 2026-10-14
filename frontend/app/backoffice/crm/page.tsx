"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CrmHome from "@/components/crm/CrmHome";
import HouseholdsTab from "@/components/crm/HouseholdsTab";
import LeadsTab from "@/components/crm/LeadsTab";
import PipelinesTab from "@/components/crm/PipelinesTab";
import ActivitiesTab from "@/components/crm/ActivitiesTab";
import CasesTab from "@/components/crm/CasesTab";
import ComplianceTab from "@/components/crm/ComplianceTab";
import ImportTab from "@/components/crm/ImportTab";
import { CasesList, ContactsList, LeadsList, OpportunitiesList, TasksList } from "@/components/crm/EntityLists";
import { CRM_TABS, resolveTab, tabHref } from "@/components/crm/tabs";

/** Tabs that offer a table (Salesforce-style list view) next to the original board/agenda/create screen. */
function TableOrBoard({ table, board, boardLabel, defaultView }: { table: React.ReactNode; board: React.ReactNode; boardLabel: string; defaultView: "table" | "board" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get("view") as "table" | "board" | null) ?? defaultView;
  const go = (v: "table" | "board") => {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    router.push(`${pathname}?${next}`);
  };
  const btn = (v: "table" | "board", text: string) => (
    <button
      type="button"
      onClick={() => go(v)}
      aria-pressed={view === v}
      className={`px-3 py-1.5 text-xs font-medium border first:rounded-l-lg last:rounded-r-lg ${
        view === v
          ? "bg-[#006F64] text-white border-[#006F64]"
          : "bg-white dark:bg-[#171E27] text-[#536176] dark:text-[#A8B4C4] border-[#E4E9EF] dark:border-[#2B3644]"
      }`}
    >
      {text}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="inline-flex" role="group" aria-label="Display">
        {btn("table", "Table")}
        {btn("board", boardLabel)}
      </div>
      {view === "board" ? board : table}
    </div>
  );
}

function CrmTabs() {
  const router = useRouter();
  const tab = resolveTab(useSearchParams().get("tab")); // the tab lives in the URL: back, forward and refresh work
  return (
    <div className="space-y-4">
      <nav aria-label="CRM sections" className="flex flex-wrap gap-1 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        {CRM_TABS.map(([id, label]) => (
          <Link
            key={id}
            href={tabHref(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`px-3 py-1.5 text-[13px] -mb-px border-b-2 ${
              tab === id
                ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE] font-medium"
                : "border-transparent text-[#536176] dark:text-[#A8B4C4]"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "home" && <CrmHome onNavigate={(id) => router.push(tabHref(id))} />}
      {tab === "households" && <HouseholdsTab />}
      {tab === "contacts" && <ContactsList />}
      {tab === "leads" && <TableOrBoard defaultView="table" boardLabel="Board & new lead" table={<LeadsList />} board={<LeadsTab />} />}
      {tab === "opportunities" && <TableOrBoard defaultView="board" boardLabel="Board" table={<OpportunitiesList />} board={<PipelinesTab />} />}
      {tab === "activities" && <TableOrBoard defaultView="table" boardLabel="Agenda & new task" table={<TasksList />} board={<ActivitiesTab />} />}
      {tab === "cases" && <TableOrBoard defaultView="table" boardLabel="Queue & new grievance" table={<CasesList />} board={<CasesTab />} />}
      {tab === "compliance" && <ComplianceTab />}
      {tab === "import" && <ImportTab />}
    </div>
  );
}

export default function CrmPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="h-24" />}>
      <CrmTabs />
    </Suspense>
  );
}
