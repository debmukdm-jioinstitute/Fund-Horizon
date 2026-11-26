"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { canAccessPage } from "@/components/backoffice/navItems";
import { useRecommended } from "@/lib/recommended";

export default function SettingsNav() {
  const pathname = usePathname();
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";
  const canHealth = !customer || canAccessPage(customer.pages, customer.role, "/backoffice/data-health");
  const rec = useRecommended();

  const recCount = `${Object.keys(rec.mfMap).length} MF · ${Object.keys(rec.pmsMap).length} PMS`;

  const navItems = [
    {
      href: "/backoffice/settings/lead",
      label: "Lead generation",
      sub: "",
      show: true,
      icon: "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1z",
    },
    {
      href: "/backoffice/settings/staff",
      label: "Staff & permissions",
      sub: "",
      show: isAdmin,
      icon: "M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-4.13a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6M3 10a3 3 0 106 0",
    },
    {
      href: "/backoffice/settings/ai",
      label: "AI control centre",
      sub: "",
      show: isAdmin,
      icon: "M9.8 3l1.6 4.4L16 9l-4.6 1.6L9.8 15 8.2 10.6 3.6 9l4.6-1.6zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z",
    },
    {
      href: "/backoffice/settings/recommended",
      label: "FH Recommended",
      sub: recCount,
      show: true,
      icon: "M11.48 3.5a.56.56 0 011.04 0l2.13 5.11a.56.56 0 00.48.35l5.52.44c.5.04.7.66.32.99l-4.2 3.6a.56.56 0 00-.18.56l1.28 5.39a.56.56 0 01-.84.61l-4.73-2.89a.56.56 0 00-.58 0l-4.73 2.89a.56.56 0 01-.84-.61l1.28-5.39a.56.56 0 00-.18-.56l-4.2-3.6a.56.56 0 01.32-.99l5.52-.44a.56.56 0 00.48-.35z",
    },
    {
      href: "/backoffice/settings/watchlists",
      label: "Watchlists",
      sub: "",
      show: true,
      icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21z",
    },
    {
      href: "/backoffice/settings/mcp",
      label: "Claude (MCP)",
      sub: "",
      show: true,
      icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
    },
    {
      href: "/backoffice/data-health",
      label: "Data health",
      sub: "",
      show: canHealth,
      icon: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4",
    },
  ];

  return (
    <nav className="w-full sm:w-36 shrink-0 flex flex-row sm:flex-col gap-1 overflow-x-auto pb-2 sm:pb-0">
      {navItems.filter((i) => i.show).map((item) => {
        const isActive = pathname === item.href || (item.href !== "/backoffice/settings" && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`w-full rounded-lg px-2 py-2.5 flex flex-col items-center justify-center gap-1 text-center text-[13px] font-medium transition ${
              isActive
                ? "bg-gradient-to-b from-[#1B96FF] to-[#0176D3] text-white shadow-[0_3px_0_#00A1E0]"
                : "text-[#032D60] dark:text-[#CFE6FC] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F]"
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            <span className="leading-tight">{item.label}</span>
            {item.sub && <span className="text-[10px] font-normal opacity-70">{item.sub}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
