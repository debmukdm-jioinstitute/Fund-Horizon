"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";

export default function GlobalFooter() {
  const pathname = usePathname();

  const kb = (
    <nav aria-label="Knowledge base" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-medium">
      <Link href="/knowledge" className="hover:underline text-[#006F64] dark:text-[#75E1CE]">Knowledge base</Link>
      <Link href="/knowledge/mcp-setup" className="hover:underline">Connect to Claude (MCP)</Link>
      <Link href="/knowledge/data-guide" className="hover:underline">Reading the data</Link>
    </nav>
  );

  // Work screens keep a one-line footer so the knowledge base is always one click away without taking height.
  if (pathname.startsWith("/backoffice") || pathname.startsWith("/account") || pathname === "/login" || pathname === "/" || pathname === "/signup") {
    return (
      <footer className="mt-auto border-t border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C] text-[#536176] dark:text-[#A8B4C4]">
        <div className="flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          {kb}
          <span className="text-[11px]">© Fund Horizon · AMFI Registered Distributor</span>
        </div>
      </footer>
    );
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

        <div className="py-3 border-b border-[#E4E9EF] dark:border-[#2B3644]">{kb}</div>

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
