"use client";

import React from "react";
import Link from "next/link";
import UniversalSearch from "@/components/backoffice/UniversalSearch";
import MarketDesk from "@/components/backoffice/MarketDesk";
import { NAV_ITEMS } from "@/components/backoffice/navItems";

export default function BackofficeOverviewPage() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#C5DDF7] dark:border-[#1F4A74] bg-[#F3F9FE] dark:bg-[#0F2A45] p-4">
        <UniversalSearch modules={NAV_ITEMS} />
      </div>
      <div className="flex justify-end text-[12px]">
        <Link href="/backoffice/markets" target="_blank" rel="noopener noreferrer" className="text-[#0176D3] hover:underline dark:text-[#1B96FF]">
          Open in new tab →
        </Link>
      </div>
      <MarketDesk />
    </div>
  );
}
