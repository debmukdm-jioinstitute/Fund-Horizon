"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CrmHome from "@/components/crm/CrmHome";
import HouseholdsTab from "@/components/crm/HouseholdsTab";
import LeadsTab from "@/components/crm/LeadsTab";
import PipelinesTab from "@/components/crm/PipelinesTab";
import ActivitiesTab from "@/components/crm/ActivitiesTab";
import CasesTab from "@/components/crm/CasesTab";
import ComplianceTab from "@/components/crm/ComplianceTab";
import ImportTab from "@/components/crm/ImportTab";
import { CRM_TABS, resolveTab, tabHref } from "@/components/crm/tabs";

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
      {tab === "leads" && <LeadsTab />}
      {tab === "pipelines" && <PipelinesTab />}
      {tab === "activities" && <ActivitiesTab />}
      {tab === "cases" && <CasesTab />}
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
