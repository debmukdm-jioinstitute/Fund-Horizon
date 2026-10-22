"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Logo from "@/components/Logo";
import { useAuth } from "@/components/AuthContext";

const TABS = [
  { href: "/account/plans", label: "My plans" },
  { href: "/account/crm", label: "My CRM" },
  { href: "/account/messages", label: "Messages" },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { customer, loading, logout } = useAuth();
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !customer) router.replace("/login");
  }, [loading, customer, router]);

  if (loading || !customer) {
    return (
      <div className="min-h-screen bg-[#F7F9FB] dark:bg-[#10151C] flex items-center justify-center text-[13px] text-[#536176] dark:text-[#A8B4C4]">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F9FB] dark:bg-[#10151C]">
      <header className="border-b border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E27]">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <Logo size="sm" showSubtitle={false} href="/" />
          <nav className="flex items-center gap-1 text-[13px]" aria-label="Account">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={`px-3 py-1.5 rounded ${path === t.href ? "font-semibold bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]" : "text-[#536176] dark:text-[#A8B4C4]"}`}
              >
                {t.label}
              </Link>
            ))}
            <button type="button" onClick={async () => { await logout(); router.replace("/"); }} className="terminal-btn px-3 py-1 ml-2">
              Log out
            </button>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
