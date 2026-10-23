"use client";

import React, { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import CrmHome from "@/components/crm/CrmHome";
import HouseholdsTab from "@/components/crm/HouseholdsTab";
import LeadsTab from "@/components/crm/LeadsTab";
import PipelinesTab from "@/components/crm/PipelinesTab";
import ActivitiesTab from "@/components/crm/ActivitiesTab";
import ImportTab from "@/components/crm/ImportTab";
import DeadlinesTab from "@/components/crm/DeadlinesTab";
import { ContactsList, LeadsList, OpportunitiesList, TasksList } from "@/components/crm/EntityLists";
import NewContactForm from "@/components/crm/NewContactForm";
import NewOpportunityForm from "@/components/crm/NewOpportunityForm";
import { useCanWrite } from "@/components/crm/useCanWrite";
import CrmTabBar from "@/components/crm/CrmTabBar";
import { resolveTab } from "@/components/crm/tabs";

/** Tabs that offer a table (Salesforce-style list view) next to the original board/agenda/create screen. */
function TableOrBoard({ table, board, boardLabel, defaultView, newLabel }: { table: React.ReactNode; board: React.ReactNode; boardLabel: string; defaultView: "table" | "board"; newLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get("view") as "table" | "board" | null) ?? defaultView;
  const go = (v: "table" | "board") => {
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    next.delete("new");
    router.push(`${pathname}?${next}`);
  };
  // "+ New …" opens the board view with its create form already showing (?new=1)
  const goNew = () => {
    const next = new URLSearchParams(params.toString());
    next.set("view", "board");
    next.set("new", "1");
    router.push(`${pathname}?${next}`);
  };
  const btn = (v: "table" | "board", text: string) => (
    <button
      type="button"
      onClick={() => go(v)}
      aria-pressed={view === v}
      className={`px-3 py-1.5 text-xs font-medium border first:rounded-l-lg last:rounded-r-lg ${
        view === v
          ? "bg-[#0176D3] text-white border-[#0176D3]"
          : "bg-white dark:bg-[#171E27] text-[#706E6B] dark:text-[#A8B4C4] border-[#E5E5E5] dark:border-[#2B3644]"
      }`}
    >
      {text}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex" role="group" aria-label="Display">
          {btn("table", "Table")}
          {btn("board", boardLabel)}
        </div>
        {newLabel && (
          <button type="button" onClick={goNew} aria-label={newLabel} title={newLabel}
            className="inline-flex items-center gap-1 rounded-lg bg-[#0176D3] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#014486] focus:outline-none focus:ring-2 focus:ring-[#0176D3]">
            <span aria-hidden className="text-base leading-none">+</span> {newLabel}
          </button>
        )}
      </div>
      {view === "board" ? board : table}
    </div>
  );
}

function ContactsTab() {
  const canWrite = useCanWrite();
  const [version, setVersion] = React.useState(0);
  return (
    <div className="space-y-4">
      {canWrite && <NewContactForm onCreated={() => setVersion((v) => v + 1)} />}
      <ContactsList reloadKey={version} />
    </div>
  );
}

function OpportunitiesTab() {
  const canWrite = useCanWrite();
  const [version, setVersion] = React.useState(0);
  return (
    <div className="space-y-4">
      {canWrite && <NewOpportunityForm onCreated={() => setVersion((v) => v + 1)} />}
      <TableOrBoard
        key={version} defaultView="board" boardLabel="Board"
        table={<OpportunitiesList reloadKey={version} />} board={<PipelinesTab />}
      />
    </div>
  );
}

function CrmTabs() {
  const tab = resolveTab(useSearchParams().get("tab")); // the tab lives in the URL: back, forward and refresh work
  return (
    <div className="space-y-4">
      <CrmTabBar tab={tab} />
      {tab === "home" && <CrmHome />}
      {tab === "households" && <HouseholdsTab />}
      {tab === "contacts" && <ContactsTab />}
      {tab === "leads" && <TableOrBoard defaultView="table" boardLabel="Board & new lead" newLabel="New lead" table={<LeadsList />} board={<LeadsTab />} />}
      {tab === "opportunities" && <OpportunitiesTab />}
      {tab === "activities" && <TableOrBoard defaultView="table" boardLabel="Agenda & new task" newLabel="New task" table={<TasksList />} board={<ActivitiesTab />} />}
      {tab === "deadlines" && <DeadlinesTab />}
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
