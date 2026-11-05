"use client";

import React from "react";
import Breadcrumb from "@/components/Breadcrumb";
import InvestmentProposal from "@/components/backoffice/InvestmentProposal";

export default function InvestmentProposalPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Breadcrumb tone="blue" items={[{ label: "Mutual funds", href: "/backoffice/mutual-funds" }, { label: "Investment proposal" }]} />
      <InvestmentProposal />
    </div>
  );
}
