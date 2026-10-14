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
    label: "Learn",
    description: "L.E.A.R.N. distributor training: MF and PMS manuals, slides, scripts, flash cards, quizzes",
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
      <div className="min-h-screen flex items-center justify-center bg-[#FFFFFF] dark:bg-[#10151C] text-[#536176] dark:text-[#A8B4C4]">
        <div className="flex items-center gap-2.5 text-[13px] font-medium">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Verifying terminal authentication credentials…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#FFFFFF] dark:bg-[#10151C] text-[#172033] dark:text-[#EDF2F7]">
      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          role="presentation"
          onClick={() => setMobileDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs md:hidden"
        />
      )}

      {/* Sidebar (210px width) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[210px] md:static flex flex-col bg-[#FFFFFF] dark:bg-[#10151C] border-r border-[#E4E9EF] dark:border-[#2B3644] shrink-0 transition-transform duration-200 ease-in-out ${
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Sidebar Header: Single Logo + Terminal Badge */}
        <div className="h-[52px] px-3.5 border-b border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="sm" showSubtitle={false} href="/backoffice" />
            <span className="text-[10px] font-semibold tracking-wider uppercase text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-1 py-0.5 rounded">
              Terminal
            </span>
          </div>
          <button
            onClick={() => setMobileDrawerOpen(false)}
            aria-label="Close menu"
            className="md:hidden p-1 text-[#536176] hover:text-[#172033] dark:text-[#A8B4C4] dark:hover:text-[#EDF2F7]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Items (11 compact items) */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto" aria-label="Terminal Navigation">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname === item.href.split("?")[0];
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileDrawerOpen(false)}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[13px] transition-colors ${
                  isActive
                    ? "bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] font-medium"
                    : "text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] hover:text-[#172033] dark:hover:text-[#EDF2F7]"
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-[#006F64] dark:text-[#75E1CE]" : "text-[#536176] dark:text-[#A8B4C4]"}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer: Staff Card & Sign Out */}
        <div className="p-2.5 border-t border-[#E4E9EF] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#171E27] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <div className="truncate pr-1">
              <div className="font-medium text-[#172033] dark:text-[#EDF2F7] truncate">{customer.name || customer.email}</div>
              <div className="text-[#536176] dark:text-[#A8B4C4] truncate text-[10px]">{customer.email}</div>
            </div>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] text-[#006F64] dark:text-[#75E1CE] shrink-0 font-medium">
              {customer.role}
            </span>
          </div>

          <button
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="w-full flex items-center justify-center gap-1.5 py-1 px-2 text-[12px] text-[#B42332] dark:text-[#FF7D86] hover:bg-[#FFFFFF] dark:hover:bg-[#10151C] rounded border border-transparent hover:border-[#E4E9EF] dark:hover:border-[#2B3644] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Terminal Shell: Slim Top Bar + Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Slim 52px Top Bar */}
        <header className="h-[52px] border-b border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C] px-4 flex items-center justify-between shrink-0 sticky top-0 z-30 select-none">
          {/* Left: Mobile hamburger & route breadcrumb / search trigger */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation drawer"
              className="md:hidden p-1.5 rounded text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Quick Navigation Search Button */}
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 h-7 px-2.5 rounded bg-[#F7F9FB] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4] text-[12px] hover:border-[#006F64] dark:hover:border-[#75E1CE] transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-[#536176] dark:text-[#A8B4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="hidden sm:inline">Search terminal modules…</span>
              <span className="sm:hidden">Search…</span>
              <kbd className="hidden sm:inline text-[10px] px-1 py-0.2 bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] rounded text-[#536176] dark:text-[#A8B4C4] font-mono">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right: Live IST Clock, Refresh indicator, Theme Toggle */}
          <div className="flex items-center gap-3">
            {istTime && (
              <span className="text-[12px] font-mono text-[#536176] dark:text-[#A8B4C4] tabular-nums hidden sm:inline">
                {istTime}
              </span>
            )}

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme`}
              className="h-7 w-7 rounded flex items-center justify-center text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] transition-colors"
            >
              {theme === "dark" ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          </div>
        </header>

        {/* Main Content View with 20-24px padding */}
        <main className="flex-1 p-5 md:p-6 overflow-y-auto">
          <div className="max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} modules={NAV_ITEMS} />
    </div>
  );
}
