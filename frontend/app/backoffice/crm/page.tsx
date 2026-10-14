"use client";

import React, { useState } from "react";
import CrmHome from "@/components/crm/CrmHome";
import HouseholdsTab from "@/components/crm/HouseholdsTab";
import LeadsTab from "@/components/crm/LeadsTab";
import PipelinesTab from "@/components/crm/PipelinesTab";
import ActivitiesTab from "@/components/crm/ActivitiesTab";
import CasesTab from "@/components/crm/CasesTab";
import ComplianceTab from "@/components/crm/ComplianceTab";
import ImportTab from "@/components/crm/ImportTab";

const TABS = [
  ["crm-home", "Home"],
  ["households", "Households"],
  ["leads", "Leads"],
  ["pipelines", "Pipelines"],
  ["activities", "Tasks"],
  ["cases", "Grievances"],
  ["compliance", "Compliance"],
  ["import", "Import"],
] as const;

export default function CrmPage() {
  const [tab, setTab] = useState<string>("crm-home");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-[13px] -mb-px border-b-2 ${
              tab === id
                ? "border-[#006F64] text-[#006F64] dark:border-[#75E1CE] dark:text-[#75E1CE] font-medium"
                : "border-transparent text-[#536176] dark:text-[#A8B4C4]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "crm-home" && <CrmHome onNavigate={setTab} />}
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
