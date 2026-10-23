"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import NavTabs from "@/components/backoffice/NavTabs";
import { NAV_ITEMS } from "@/components/backoffice/navItems";
import CommandPalette from "@/components/crm/CommandPalette";
import EmailDialog from "@/components/crm/EmailDialog";
import { useAuth } from "@/components/AuthContext";
import { useTheme } from "@/components/terminal/ThemeContext";

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const { customer, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
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
            {customer.role !== "compliance" && (
              <button type="button" onClick={() => setEmailOpen(true)} aria-label="Email a client" title="Email a client" className={iconBtn}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" /></svg>
              </button>
            )}
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
        <nav aria-label="Terminal Navigation" className="flex items-stretch gap-1 border-t-[3px] border-t-[#0176D3] border-b border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-1.5 shadow-[0_4px_12px_-6px_rgba(1,68,134,0.25)]">
          <Link href="/" aria-label="Fund Horizon home" title="Fund Horizon home" className="my-auto mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0176D3] text-white shadow-md hover:bg-[#014486]">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></svg>
          </Link>
          <span aria-hidden className="my-2 w-px shrink-0 bg-[#E5E5E5] dark:bg-[#2B3644]" />
          <NavTabs items={NAV_ITEMS} pathname={pathname} isActive={isActive} />
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
      {emailOpen && <EmailDialog onClose={() => setEmailOpen(false)} />}
    </div>
  );
}
