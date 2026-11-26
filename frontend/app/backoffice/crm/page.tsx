"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ContactsList, LeadsList, OpportunitiesList, TasksList } from "@/components/crm/EntityLists";
import NewContactForm from "@/components/crm/NewContactForm";
import NewOpportunityForm from "@/components/crm/NewOpportunityForm";
import { useCanWrite } from "@/components/crm/useCanWrite";
import CrmTabBar from "@/components/crm/CrmTabBar";
import { resolveTab } from "@/components/crm/tabs";

function TabLoading() {
  return (
    <div className="flex h-36 items-center justify-center text-xs text-[#706E6B] dark:text-[#A8B4C4]">
      <svg className="mr-2 h-4 w-4 animate-spin text-[#0176D3]" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      Loading CRM section…
    </div>
  );
}

const CrmHome = dynamic(() => import("@/components/crm/CrmHome"), { ssr: false, loading: () => <TabLoading /> });
const HouseholdsTab = dynamic(() => import("@/components/crm/HouseholdsTab"), { ssr: false, loading: () => <TabLoading /> });
const LeadsTab = dynamic(() => import("@/components/crm/LeadsTab"), { ssr: false, loading: () => <TabLoading /> });
const PipelinesTab = dynamic(() => import("@/components/crm/PipelinesTab"), { ssr: false, loading: () => <TabLoading /> });
const ActivitiesTab = dynamic(() => import("@/components/crm/ActivitiesTab"), { ssr: false, loading: () => <TabLoading /> });
const DeadlinesTab = dynamic(() => import("@/components/crm/DeadlinesTab"), { ssr: false, loading: () => <TabLoading /> });
const ChatsTab = dynamic(() => import("@/components/crm/ChatsTab"), { ssr: false, loading: () => <TabLoading /> });

class TabErrorBoundary extends React.Component<
  { children: React.ReactNode; tabName: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; tabName: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("CRM Tab Render Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-xs text-rose-800 space-y-3 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <div className="font-bold text-sm">Failed to render {this.props.tabName}</div>
          <div className="font-mono break-words">{this.state.error?.message || "Unexpected rendering error"}</div>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-lg bg-rose-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 transition"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <TabErrorBoundary key={tab} tabName={tab}>
        {tab === "home" && <CrmHome />}
        {tab === "households" && <HouseholdsTab />}
        {tab === "contacts" && <ContactsTab />}
        {tab === "chats" && <ChatsTab />}
        {tab === "leads" && <TableOrBoard defaultView="table" boardLabel="Board & new lead" newLabel="New lead" table={<LeadsList />} board={<LeadsTab />} />}
        {tab === "opportunities" && <OpportunitiesTab />}
        {tab === "activities" && <TableOrBoard defaultView="table" boardLabel="Agenda & new task" newLabel="New task" table={<TasksList />} board={<ActivitiesTab />} />}
        {tab === "deadlines" && <DeadlinesTab />}
      </TabErrorBoundary>
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
