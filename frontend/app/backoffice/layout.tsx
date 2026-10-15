"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import CommandPalette from "@/components/crm/CommandPalette";
import { useAuth } from "@/components/AuthContext";
import { useTheme } from "@/components/terminal/ThemeContext";

interface NavItem {
  href: string;
  label: string;
  description: string;
  badge?: string;
  icon: (props: { className?: string }) => React.JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/backoffice",
    label: "Overview",
    description: "Key market indicators, benchmark index levels, and macro rates",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
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
    href: "/backoffice/impact",
    label: "Impact engine",
    description: "OLS macro sensitivity models, duration factor stress, and currency beta",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
    href: "/backoffice/data-health",
    label: "Data health",
    description: "RBI, CCIL, AMFI, and NSE upstream feed health and diagnostic latency",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    href: "/backoffice/crm",
    label: "CRM",
    description: "Households, leads, pipelines, tasks, grievances, and compliance",
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6M3 10a3 3 0 106 0" />
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
    description: "FH Academy: L.E.A.R.N. lessons, flashcards, quizzes, streaks and a leaderboard for MF and PMS distributors",
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
    icon: (p) => (
      <svg {...p} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const { customer, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [istTime, setIstTime] = useState("");

  // Maintain Live IST Clock
  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now);
      setIstTime(`${formatted} IST`);
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Global Keyboard Shortcut (cmd+k or /) for Quick Search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && document.activeElement?.tagName !== "INPUT")) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!loading) {
      if (!customer) {
        router.replace("/login");
      } else if (!customer.is_staff) {
        router.replace("/login");
      }
    }
  }, [customer, loading, router]);

  if (loading || !customer || !customer.is_staff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFFFF] dark:bg-[#10151C] text-[#706E6B] dark:text-[#A8B4C4]">
        <div className="flex items-center gap-2.5 text-[13px] font-medium">
          <svg className="animate-spin h-4 w-4 text-[#0176D3] dark:text-[#1B96FF]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Verifying terminal authentication credentials…
        </div>
      </div>
    );
  }

  const isActive = (href: string) => {
    const base = href.split("?")[0];
    return base === "/backoffice" ? pathname === base : pathname === base || pathname.startsWith(`${base}/`);
  };
  const initials = (customer.name || customer.email || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const iconBtn = "h-8 w-8 rounded flex items-center justify-center text-[#706E6B] dark:text-[#A8B4C4] hover:bg-[#F3F3F3] dark:hover:bg-[#171E27] transition-colors";

  return (
    <div className="sf min-h-screen flex flex-col bg-[#F3F3F3] dark:bg-[#10151C] text-[#181818] dark:text-[#EDF2F7]">
      {/* Lightning global header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-[#10151C] border-b border-[#E5E5E5] dark:border-[#2B3644] select-none">
        <div className="h-[52px] px-3 flex items-center gap-3">
          <button type="button" onClick={() => setMobileDrawerOpen(true)} aria-label="Open app launcher" title="App Launcher" className={iconBtn}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              {[5, 12, 19].flatMap((x) => [5, 12, 19].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.8} />))}
            </svg>
          </button>
          <span className="hidden sm:block shrink-0"><Logo size="sm" showSubtitle={false} href="/backoffice" /></span>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mx-auto flex h-8 min-w-0 flex-1 max-w-xl items-center gap-2 rounded border border-[#C9C7C5] dark:border-[#2B3644] bg-[#F3F3F3] dark:bg-[#171E27] px-2.5 text-[13px] text-[#706E6B] dark:text-[#A8B4C4] hover:border-[#0176D3] transition-colors"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="truncate">Search customers, leads, households and modules…</span>
            <kbd className="ml-auto hidden sm:inline text-[10px] px-1 bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] rounded">⌘K</kbd>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            {istTime && <span className="mr-2 hidden lg:inline text-[12px] text-[#706E6B] dark:text-[#A8B4C4] tabular-nums">{istTime}</span>}
            <button type="button" onClick={toggleTheme} aria-label="Toggle theme" title={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme`} className={iconBtn}>
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              )}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setUserMenuOpen((o) => !o)} aria-label="User menu" aria-expanded={userMenuOpen} className="ml-1 h-8 w-8 rounded-full bg-[#0176D3] text-white text-[12px] font-semibold flex items-center justify-center">
                {initials}
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-10 z-50 w-64 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] shadow-lg">
                  <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
                    <div className="text-[13px] font-semibold truncate">{customer.name || customer.email}</div>
                    <div className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] truncate">{customer.email}</div>
                    <span className="mt-1 inline-block rounded bg-[#EAF5FE] dark:bg-[#11304F] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#0176D3] dark:text-[#1B96FF]">{customer.role}</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => { await logout(); router.replace("/login"); }}
                    className="w-full px-3 py-2 text-left text-[13px] text-[#B42332] dark:text-[#FF7D86] hover:bg-[#F3F3F3] dark:hover:bg-[#10151C]"
                  >
                    Log Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Lightning navigation bar: app name + object tabs */}
        <nav aria-label="Terminal Navigation" className="flex items-stretch border-t-[3px] border-t-[#0176D3] border-t border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
          <div className="hidden sm:flex items-center border-r border-[#E5E5E5] dark:border-[#2B3644] px-4 text-[15px] font-semibold whitespace-nowrap">Fund Horizon</div>
          <div className="flex min-w-0 flex-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const on = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  ref={on ? (el) => el?.scrollIntoView({ inline: "center", block: "nearest" }) : undefined}
                  className={`relative flex h-11 shrink-0 items-center px-3.5 text-[13px] whitespace-nowrap hover:bg-[#F3F3F3] dark:hover:bg-[#171E27] ${
                    on ? "font-semibold text-[#0176D3] dark:text-[#1B96FF]" : "text-[#444444] dark:text-[#A8B4C4] hover:text-[#0176D3]"
                  }`}
                >
                  {item.label}
                  {on && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[#0176D3] dark:bg-[#1B96FF]" />}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      {/* App launcher */}
      {mobileDrawerOpen && (
        <div role="dialog" aria-modal="true" aria-label="App Launcher" className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16" onClick={() => setMobileDrawerOpen(false)}>
          <div className="w-full max-w-3xl max-h-[80vh] overflow-y-auto rounded bg-white dark:bg-[#171E27] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-[#2B3644] px-5 py-3">
              <h2 className="text-[16px] font-semibold">App Launcher</h2>
              <button type="button" onClick={() => setMobileDrawerOpen(false)} aria-label="Close" className={iconBtn}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setMobileDrawerOpen(false)} className="flex items-start gap-3 rounded border border-[#E5E5E5] dark:border-[#2B3644] p-3 hover:border-[#0176D3] hover:bg-[#F3F9FE] dark:hover:bg-[#11304F]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#0176D3] text-white"><Icon className="w-5 h-5" /></span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-[#0176D3] dark:text-[#1B96FF]">{item.label}</span>
                      <span className="block text-[12px] text-[#706E6B] dark:text-[#A8B4C4] line-clamp-2">{item.description}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 p-3 sm:p-4 md:p-5">
        <div className="max-w-[1600px] mx-auto">{children}</div>
      </main>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} modules={NAV_ITEMS} />
    </div>
  );
}
