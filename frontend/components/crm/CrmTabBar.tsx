"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthContext";
import { fetchNewCounts } from "../../lib/crmApi";
import { CRM_TABS, tabHref } from "./tabs";

const circle = (cx: number, cy: number) => `M${cx - 4} ${cy}a4 4 0 1 0 8 0a4 4 0 1 0-8 0`;
const ICONS: Record<string, string[]> = {
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  households: ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", circle(9, 7), "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  contacts: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", circle(12, 7)],
  chats: ["M8 10h8", "M8 14h5", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  leads: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circle(9, 7), "M19 8v6", "M22 11h-6"],
  opportunities: ["M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z", "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"],
  activities: ["M9 11l3 3L22 4", "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"],
  deadlines: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
  import: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
};


const COUNTED = ["households", "contacts", "leads", "opportunities", "activities"];

/** Admin only. Per-browser "last opened" time for each tab; the badge counts records created since then. */
function useNewCounts(tab: string): Record<string, number> {
  const { customer } = useAuth();
  const admin = customer?.role === "admin";
  const key = `crm_seen_v1:${customer?.id ?? ""}`;
  const [counts, setCounts] = useState<Record<string, number>>({});

  const read = useCallback((): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
  }, [key]);

  const refresh = useCallback(() => {
    if (!admin) return;
    const seen = read();
    const now = new Date().toISOString();
    let dirty = false;
    for (const t of COUNTED) if (!seen[t]) { seen[t] = now; dirty = true; } // first visit: start counting from now
    if (dirty) try { localStorage.setItem(key, JSON.stringify(seen)); } catch { /* private mode: counts just restart */ }
    fetchNewCounts(Object.fromEntries(COUNTED.map((t) => [t, seen[t]]))).then(setCounts).catch(() => undefined);
  }, [admin, key, read]);

  // opening a tab marks it as seen
  useEffect(() => {
    if (!admin || !COUNTED.includes(tab)) return;
    try { localStorage.setItem(key, JSON.stringify({ ...read(), [tab]: new Date().toISOString() })); } catch { /* ignore */ }
    setCounts((c) => ({ ...c, [tab]: 0 }));
  }, [admin, tab, key, read]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh, tab]);

  return counts;
}

/** CRM section tabs: icon above label, active tab filled. Scrolls sideways on narrow screens. */
export default function CrmTabBar({ tab }: { tab: string }) {
  const nav = useRef<HTMLElement>(null);
  const newCounts = useNewCounts(tab);
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
              className={`relative flex min-w-[72px] flex-1 flex-col items-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold transition-colors ${
                on
                  ? "bg-[#0176D3] text-white shadow-[0_3px_0_#014486]"
                  : "text-[#014486] dark:text-[#CFE6FC] hover:bg-[#E3F0FB] dark:hover:bg-[#17406A]"
              }`}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                {ICONS[id].map((d) => <path key={d} d={d} />)}
              </svg>
              {label}
              {!on && newCounts[id] > 0 && (
                <span
                  aria-label={`${newCounts[id]} new`} title={`${newCounts[id]} new since you last opened ${label}`}
                  className="absolute right-2 top-1 min-w-[20px] rounded-full bg-[#0176D3] px-1.5 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-[#F3F9FE] dark:bg-[#1B96FF] dark:text-[#0B1B2E] dark:ring-[#0F2A45]"
                >
                  {newCounts[id] > 99 ? "99+" : newCounts[id]}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
