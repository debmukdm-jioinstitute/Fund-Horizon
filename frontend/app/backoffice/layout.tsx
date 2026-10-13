"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth } from "@/components/AuthContext";

const NAV_ITEMS = [
  { href: "/backoffice", label: "Overview", icon: "📊" },
  { href: "/backoffice/pms", label: "PMS Tracker", icon: "💼" },
  { href: "/backoffice/mutual-funds", label: "Mutual Funds", icon: "📈" },
  { href: "/backoffice/macro", label: "Macro & Yields", icon: "🌐" },
  { href: "/backoffice/micro", label: "Micro & Fundamentals", icon: "🏢" },
  { href: "/backoffice/derivatives", label: "Derivatives & PCR", icon: "⚡" },
  { href: "/backoffice/flows", label: "FII / DII Flows", icon: "🌊" },
  { href: "/backoffice/impact", label: "Impact Engine", icon: "🎯" },
  { href: "/backoffice/research", label: "Daily Briefing & Notes", icon: "📑" },
  { href: "/backoffice/data-health", label: "Data Health & Sources", icon: "🩺" },
  { href: "/backoffice/settings", label: "Settings & Staff", icon: "⚙️" },
];

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const { customer, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!customer) {
        router.replace("/login");
      } else if (!customer.is_staff) {
        // Customer accounts cannot access the backoffice
        router.replace("/login");
      }
    }
  }, [customer, loading, router]);

  if (loading || !customer || !customer.is_staff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="flex items-center gap-3 text-sand-600 font-medium text-sm">
          <svg className="animate-spin h-5 w-5 text-forest-700" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Verifying backoffice credentials…
        </div>
      </div>
    );
  }

  const roleBadgeMap: Record<string, string> = {
    admin: "bg-purple-50 text-purple-700 border-purple-200",
    analyst: "bg-blue-50 text-blue-700 border-blue-200",
    rm: "bg-emerald-50 text-emerald-700 border-emerald-200",
    operations: "bg-amber-50 text-amber-700 border-amber-200",
    read_only: "bg-sand-100 text-sand-700 border-sand-300",
  };
  const roleBadgeColor = roleBadgeMap[customer.role] || "bg-sand-100 text-sand-700 border-sand-300";

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col md:flex-row text-sand-900 font-sans antialiased">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-sand-200">
        <Logo />
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg text-sand-600 hover:bg-sand-100"
          aria-label="Toggle Navigation"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Sidebar Navigation */}
      <aside
        className={`${
          mobileMenuOpen ? "block" : "hidden"
        } md:flex flex-col w-full md:w-64 bg-white border-r border-sand-200 shrink-0 select-none`}
      >
        <div className="p-5 border-b border-sand-100 hidden md:block">
          <Logo />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wider text-forest-800 uppercase bg-forest-50 px-2 py-0.5 rounded border border-forest-200">
              Internal Backoffice
            </span>
          </div>
        </div>

        {/* User Card */}
        <div className="p-4 border-b border-sand-100 bg-sand-50/60">
          <div className="flex items-center justify-between">
            <div className="truncate pr-2">
              <div className="text-xs font-semibold text-sand-900 truncate">{customer.name}</div>
              <div className="text-xs text-sand-500 truncate">{customer.email}</div>
            </div>
            <span className={`text-xs font-mono uppercase px-2 py-0.5 rounded border font-medium ${roleBadgeColor}`}>
              {customer.role}
            </span>
          </div>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-forest-50 text-forest-900 font-semibold border border-forest-200/60 shadow-xs"
                    : "text-sand-700 hover:bg-sand-100 hover:text-sand-900"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer info & Logout */}
        <div className="p-3 border-t border-sand-100 bg-white">
          <button
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-xl transition-colors border border-transparent hover:border-rose-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
          <div className="mt-2 text-xs text-center text-sand-500 font-mono">
            Zero-Spend Lean Stack • v1.0.0
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          {children}
        </div>
      </main>
    </div>
  );
}
