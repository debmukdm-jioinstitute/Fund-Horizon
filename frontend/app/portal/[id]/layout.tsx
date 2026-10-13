"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";

type NavItem = {
  label: string;
  href: (id: string) => string;
  kind: "overview" | "funds" | "compare" | "prefix";
};

type NavSection = { title: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: (id) => `/portal/${id}`, kind: "overview" },
      { label: "My Goals", href: (id) => `/portal/${id}/goals`, kind: "prefix" },
      { label: "Financial Planner", href: (id) => `/portal/${id}/planner`, kind: "prefix" },
    ],
  },
  {
    title: "Invest",
    items: [
      { label: "Explore Funds", href: (id) => `/portal/${id}/funds`, kind: "funds" },
      { label: "My Portfolio", href: (id) => `/portal/${id}/portfolio`, kind: "prefix" },
      { label: "Compare Funds", href: (id) => `/portal/${id}/funds?tab=compare`, kind: "compare" },
    ],
  },
  {
    title: "Understand",
    items: [
      { label: "Portfolio Analytics", href: (id) => `/portal/${id}/analytics`, kind: "prefix" },
      { label: "Risk Profile", href: (id) => `/portal/${id}/risk`, kind: "prefix" },
    ],
  },
  {
    title: "Documents",
    items: [{ label: "Reports", href: (id) => `/portal/${id}/reports`, kind: "prefix" }],
  },
];

const ITEM_ICONS: Record<string, string> = {
  Dashboard: "◈",
  "My Goals": "◎",
  "Financial Planner": "◩",
  "Explore Funds": "🔎",
  "My Portfolio": "💼",
  "Compare Funds": "⚖️",
  "Portfolio Analytics": "📊",
  "Risk Profile": "🛡️",
  Reports: "📄",
};

function isActive(item: NavItem, id: string, pathname: string, tab: string | null): boolean {
  const href = item.href(id).split("?")[0];
  if (item.kind === "overview") return pathname === `/portal/${id}` || pathname === `/portal/${id}/`;
  if (item.kind === "funds") return pathname === href && tab !== "compare";
  if (item.kind === "compare") return pathname === href && tab === "compare";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const params = useParams();
  const pathname = usePathname();
  const search = useSearchParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
  const tab = search?.get("tab") ?? null;
  if (!id) return null;
  return (
    <nav aria-label="Portal" className="space-y-6">
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <p className="mb-2 px-3 text-xs font-bold uppercase tracking-widest text-navy-500">{s.title}</p>
          <ul className="space-y-1">
            {s.items.map((item) => {
              const href = item.href(id);
              const active = isActive(item, id, pathname, tab);
              return (
                <li key={item.label}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-teal-700 text-white shadow-sm"
                        : "text-navy-800 hover:bg-navy-50 hover:text-navy-950"
                    }`}
                  >
                    <span aria-hidden className="w-5 text-center text-base">
                      {ITEM_ICONS[item.label] ?? "•"}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 px-3">
        <Link href={id ? `/portal/${id}` : "/"} className="block">
          <p className="text-lg font-extrabold tracking-tight text-navy-950">Fund Horizon</p>
          <p className="text-xs font-medium text-navy-500">Customer portal</p>
        </Link>
      </div>
      <Suspense fallback={<div className="px-3 text-sm text-navy-600">Loading menu…</div>}>
        <Nav onNavigate={onNavigate} />
      </Suspense>
      <div className="mt-auto px-3 pt-6">
        <p className="rounded-xl bg-navy-50 p-3 text-xs leading-relaxed text-navy-600">
          Illustrations only — read scheme documents (SID/KIM) before investing.
        </p>
      </div>
    </div>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-navy-100 bg-white/80 p-4 backdrop-blur lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Portal menu">
          <button
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-navy-950/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between px-3">
              <p className="text-base font-extrabold text-navy-950">Menu</p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg border border-navy-200 px-3 py-1.5 text-sm font-semibold text-navy-800"
              >
                ✕
              </button>
            </div>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-navy-100 bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-lg border border-navy-200 px-3 py-1.5 text-sm font-semibold text-navy-800"
          >
            ☰ Menu
          </button>
          <p className="text-sm font-extrabold text-navy-950">Fund Horizon · Customer portal</p>
        </header>
        <main className="w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-12">{children}</main>
      </div>
    </div>
  );
}
