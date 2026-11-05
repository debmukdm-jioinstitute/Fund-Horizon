"use client";

import React from "react";
import Breadcrumb from "@/components/Breadcrumb";
import CategoryReturns from "@/components/backoffice/CategoryReturns";

export default function CategoryReturnsPage() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Breadcrumb tone="blue" items={[{ label: "Mutual funds", href: "/backoffice/mutual-funds" }, { label: "Category returns" }]} />
      <CategoryReturns />
    </div>
  );
}
