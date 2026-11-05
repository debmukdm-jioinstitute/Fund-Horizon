"use client";

import React from "react";
import Breadcrumb from "@/components/Breadcrumb";
import FundTools from "@/components/backoffice/FundTools";

export default function FundToolsPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Breadcrumb tone="blue" items={[{ label: "Mutual funds", href: "/backoffice/mutual-funds" }, { label: "Fund tools" }]} />
      <FundTools />
    </div>
  );
}
