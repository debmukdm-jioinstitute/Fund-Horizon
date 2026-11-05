"use client";

import React from "react";
import Breadcrumb from "@/components/Breadcrumb";
import FundPerformance from "@/components/backoffice/FundPerformance";

export default function FundPerformancePage() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Breadcrumb tone="blue" items={[{ label: "Mutual funds", href: "/backoffice/mutual-funds" }, { label: "Fund performance" }]} />
      <FundPerformance />
    </div>
  );
}
