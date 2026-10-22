"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";

export default function GlobalFooter() {
  const pathname = usePathname();

  if (pathname.startsWith("/backoffice") || pathname === "/login" || pathname === "/" || pathname === "/signup") {
    return null;
  }

  return (
    <footer className="mt-auto border-t border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C] text-[#536176] dark:text-[#A8B4C4] text-[12px]">
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#E4E9EF] dark:border-[#2B3644]">
          <div className="flex items-center gap-3">
            <Logo size="sm" showSubtitle={false} href="/" />
            <span className="text-[11px] px-2 py-0.5 rounded bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] font-medium">
              AMFI Registered Distributor
            </span>
          </div>
          <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
            Fund Horizon Data Terminal • Internal & Compliance Disclosures
          </p>
        </div>

        <div className="pt-4 text-[11px] leading-relaxed">
          <p>
            Mutual fund investments are subject to market risks, read all scheme related documents carefully. Past performance is not indicative of future returns.
          </p>
          <p className="mt-1 text-[#536176]/80 dark:text-[#A8B4C4]/80">
            Internal terminal view strictly for authorized distribution operations. Not for public redistribution.
          </p>
        </div>
      </div>
    </footer>
  );
}
