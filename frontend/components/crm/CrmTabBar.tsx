"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CRM_TABS, tabHref } from "./tabs";

const circle = (cx: number, cy: number) => `M${cx - 4} ${cy}a4 4 0 1 0 8 0a4 4 0 1 0-8 0`;
const ICONS: Record<string, string[]> = {
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  households: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", circle(9, 7), "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  contacts: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", circle(12, 7)],
  leads: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circle(9, 7), "M19 8v6", "M22 11h-6"],
  opportunities: ["M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"],
  activities: ["M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  cases: ["M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"],
  deadlines: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
  book: ["M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"],
  compliance: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M9 12l2 2 4-4"],
  import: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
};

/** CRM section tabs: icon above label, active tab filled. Scrolls sideways on narrow screens. */
export default function CrmTabBar({ tab }: { tab: string }) {
  const nav = useRef<HTMLElement>(null);
  // Only when the tab changes; scrolling on every render fought the user's own scrolling.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [tab]);
  return (
    <nav ref={nav} aria-label="CRM sections" className="overflow-x-auto overscroll-x-contain rounded-lg border border-[#C5DDF7] dark:border-[#1F4A74] border-t-4 border-t-[#0176D3] bg-[#F3F9FE] dark:bg-[#0F2A45]">
      <div className="flex min-w-max justify-between gap-1 p-1.5">
        {CRM_TABS.map(([id, label]) => {
          const on = tab === id;
          return (
            <Link
              key={id}
              href={tabHref(id)}
              aria-current={on ? "page" : undefined}
              data-active={on || undefined}
              className={`flex min-w-[72px] flex-1 flex-col items-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold transition-colors ${
                on
                  ? "bg-[#0176D3] text-white shadow-[0_3px_0_#014486]"
                  : "text-[#014486] dark:text-[#CFE6FC] hover:bg-[#E3F0FB] dark:hover:bg-[#17406A]"
              }`}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                {ICONS[id].map((d) => <path key={d} d={d} />)}
              </svg>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
