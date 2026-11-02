"use client";

import React, { useMemo, useState } from "react";
import UniversalSearch from "@/components/backoffice/UniversalSearch";
import { NAV_ITEMS } from "@/components/backoffice/navItems";
import { useTheme } from "@/components/terminal/ThemeContext";

const TIPSHEET = "https://tipsheet.markets/";

export default function BackofficeOverviewPage() {
  const { theme } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const src = useMemo(
    () => `${TIPSHEET}?theme=${theme === "dark" ? "dark" : "light"}`,
    [theme],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#C5DDF7] dark:border-[#1F4A74] bg-[#F3F9FE] dark:bg-[#0F2A45] p-4">
        <UniversalSearch modules={NAV_ITEMS} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
        <span>
          Live from{" "}
          <a href={TIPSHEET} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0176D3] dark:text-[#1B96FF] hover:underline">
            tipsheet.markets
          </a>
          {" "}· same dashboard, click any figure to open it there
        </span>
        <a href={src} target="_blank" rel="noopener noreferrer" className="hover:underline">
          Open in new tab →
        </a>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#151515]">
        {!loaded && (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">
            <svg className="h-4 w-4 animate-spin text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading tipsheet…
          </div>
        )}
        <iframe
          key={src}
          title="tipsheet.markets"
          src={src}
          onLoad={() => setLoaded(true)}
          className={`w-full border-0 ${loaded ? "h-[calc(100vh-12rem)]" : "h-0"}`}
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
