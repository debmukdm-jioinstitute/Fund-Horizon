// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";

/** Header auth entry point.
 * Logged out → a "Log in" link-button to /login (plan-link access lives on the login page).
 * Logged in  → the customer's first name with a small menu: My plans + Log out. */
export default function CustomerLogin({ className = "" }: { className?: string }) {
  const { customer, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (loading) {
    return (
      <span className={`ml-1 inline-flex items-center gap-1.5 ${className}`} aria-hidden>
        <span className="h-7 w-12 rounded-xl bg-navy-900/10 animate-pulse" />
        <span className="h-7 w-14 rounded-xl bg-navy-900/10 animate-pulse" />
      </span>
    );
  }

  if (!customer) {
    return (
      <div className={`ml-1 flex items-center gap-1 sm:gap-1.5 ${className}`}>
        <Link
          href="/login"
          className="px-2.5 sm:px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:text-navy-950 hover:bg-slate-100/70 transition"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-xl bg-navy-900 px-3 sm:px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const firstName = customer.name.trim().split(/\s+/)[0] || "Account";

  async function handleLogout() {
    setMenuOpen(false);
    await logout();
    router.push("/");
    router.refresh();
  }

  return (
    <div ref={menuRef} className={`relative ml-1 ${className}`}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex items-center gap-1.5 rounded-xl bg-navy-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800"
      >
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-[11px] font-bold text-navy-950">
          {firstName.charAt(0).toUpperCase()}
        </span>
        {firstName}
        <svg className={`h-3.5 w-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-navy-100 bg-white py-1 shadow-xl"
        >
          <Link
            href="/account/plans"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm font-medium text-navy-900 hover:bg-navy-50"
          >
            My plans
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="block w-full px-4 py-2 text-left text-sm font-medium text-navy-900 hover:bg-navy-50"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
