import React from "react";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  badge?: string;
  icon: (props: { className?: string }) => React.JSX.Element;
  /** Dropdown children: rendered under the parent tab, never as top-level tabs. */
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/backoffice",
    label: "Overview",
    description: "Key market indicators, benchmark index levels, and macro rates",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm9 0a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1V5zM4 14a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1v-5zm9 0a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1h-5a1 1 0 01-1-1v-5z" />
      </svg>
    ),
  },
  {
    href: "/backoffice/pms",
    label: "PMS tracker",
    description: "Portfolio management strategies, APMI performance, and high-water mark",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    ),
  },
  {
    href: "/backoffice/mutual-funds",
    label: "Mutual funds",
    description: "AMFI scheme registry, daily NAV series, AUM, and return quartiles",
    children: [
      {
        href: "/backoffice/mutual-funds",
        label: "Fund Screener",
        description: "Filter mutual funds by returns, risk, expense ratio and FH checklist score",
        icon: (p) => (
          <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        ),
      },
      {
        href: "/backoffice/mutual-funds/research",
        label: "MF Research",
        description: "Quartile, capture, manager and shortlist research workspace",
        icon: (p) => (
          <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        ),
      },
    ],
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    href: "/backoffice/macro",
    label: "Macro & yields",
    description: "RBI policy rates, G-Sec sovereign yield curve, global central bank benchmarks",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
      </svg>
    ),
  },
  {
    href: "/backoffice/micro",
    label: "Fundamentals",
    description: "Corporate earnings, EBITDA margins, net debt-to-equity, and debt look-through",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    href: "/backoffice/derivatives",
    label: "Derivatives & PCR",
    description: "NIFTY/BANKNIFTY open interest, put-call ratio, strikes, and max pain",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: "/backoffice/flows",
    label: "Institutional flows",
    description: "Daily FII and DII net equity and debt transactions in crores",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    href: "/backoffice/research?tab=briefing",
    label: "Briefings",
    description: "Institutional research notes, policy summaries, and market briefings",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: "/backoffice/crm",
    label: "CRM",
    description: "Households, leads, pipelines, tasks and deadlines",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6M3 10a3 3 0 106 0" />
      </svg>
    ),
  },
  {
    href: "/backoffice/operations",
    label: "Operations",
    description: "Automated forms repository, CAMS & Carvy automation, in-house form editor, signatures & downloads",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/backoffice/risk-profiling",
    label: "Risk profiling",
    description: "SEBI/AMFI suitability scoring, risk capacity vs tolerance, and asset allocation",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
  {
    href: "/backoffice/learn",
    label: "Academy",
    description: "FH Academy: L.E.A.R.N. lessons, flashcards, quizzes, streaks and a leaderboard for MF, PMS, SIP and asset-allocation training",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    href: "/backoffice/settings",
    label: "Settings",
    description: "Staff provisioning, RBAC roles, terminal preferences, and watchlists",
    children: [
      {
        href: "/backoffice/settings/staff",
        label: "Staff & permissions",
        description: "Manage your team and their access.",
        icon: (p) => (
          <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6M3 10a3 3 0 106 0" />
          </svg>
        ),
      },
    ],
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

/** Pages a login may open. Empty/absent list = unrestricted. Admins are never restricted. */
export function canAccessPage(pages: string[] | undefined, role: string | undefined, path: string): boolean {
  if (role === "admin" || !pages?.length) return true;
  // The old chats URL is a redirect into CRM, so CRM access is what gates it.
  if (path === "/backoffice/chats" && pages.includes("/backoffice/crm")) return true;
  return pages.some((p) => path === p || (p !== "/backoffice" && path.startsWith(`${p}/`)));
}
