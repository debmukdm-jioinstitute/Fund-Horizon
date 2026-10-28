"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth } from "@/components/AuthContext";
import { useTheme } from "./ThemeContext";

export default function GlobalHeader() {
  const pathname = usePathname();
  const { customer, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Do not render on backoffice pages (which have their own dedicated sidebar shell) or login/signup
  if (pathname.startsWith("/backoffice") || pathname.startsWith("/account") || pathname === "/login" || pathname === "/" || pathname === "/signup") {
    return null;
  }

  return (
    <header className="h-[52px] border-b border-[#E4E9EF] dark:border-[#2B3644] bg-[#FFFFFF] dark:bg-[#10151C] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-40 select-none">
      <div className="flex items-center gap-6">
        <Link href={customer?.is_staff ? "/backoffice" : "/"} className="flex items-center gap-2">
          <Logo size="sm" showSubtitle={false} href="" />
          <span className="text-[11px] font-semibold tracking-wider uppercase text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-1.5 py-0.5 rounded">
            Terminal
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 text-[13px] font-medium text-[#536176] dark:text-[#A8B4C4]">
          <Link
            href="/backoffice"
            className="px-2.5 py-1 rounded hover:text-[#172033] dark:hover:text-[#EDF2F7] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition-colors"
          >
            Terminal Overview
          </Link>
          <Link
            href="/tax"
            className="px-2.5 py-1 rounded hover:text-[#172033] dark:hover:text-[#EDF2F7] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition-colors"
          >
            Tax Simulator
          </Link>
          <Link
            href="/cas"
            className="px-2.5 py-1 rounded hover:text-[#172033] dark:hover:text-[#EDF2F7] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition-colors"
          >
            CAS Analysis
          </Link>
          <Link
            href="/learn"
            className="px-2.5 py-1 rounded hover:text-[#172033] dark:hover:text-[#EDF2F7] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] transition-colors"
          >
            Scheme Master
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="h-8 w-8 rounded flex items-center justify-center text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F7F9FB] dark:hover:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] transition-colors"
        >
          {theme === "dark" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

        {customer ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[#172033] dark:text-[#EDF2F7]">
              {customer.email}
            </span>
            <button
              onClick={() => logout()}
              className="text-[12px] text-[#B42332] dark:text-[#FF7D86] hover:underline px-1.5 py-0.5"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-[12px] font-medium text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-2.5 py-1 rounded"
          >
            Staff Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
