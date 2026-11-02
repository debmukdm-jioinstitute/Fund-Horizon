"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MARKET_SECTIONS, homeHref, parentHref, sectionIndex } from "./marketDeskNav";

const btn =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded border border-[#C9C7C5] bg-white px-2.5 text-[12px] font-semibold text-[#181818] hover:border-[#0176D3] hover:text-[#0176D3] dark:border-[#2B3644] dark:bg-[#171E27] dark:text-[#EDF2F7] dark:hover:border-[#1B96FF] dark:hover:text-[#1B96FF]";
const btnOff = `${btn} pointer-events-none opacity-40`;

function IconBack() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function IconPrev() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

function IconNext() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function NavBtn({ href, label, icon }: { href: string | null; label: string; icon: React.ReactNode }) {
  if (!href) {
    return (
      <span className={btnOff} aria-disabled="true">
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={btn} aria-label={label}>
      {icon}
      {label}
    </Link>
  );
}

function IconExcel() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

function CornerButtons({
  path,
  onOverview,
  onExcel,
  excelBusy,
}: {
  path: string;
  onOverview: boolean;
  onExcel?: () => void;
  excelBusy?: boolean;
}) {
  const pathname = usePathname() || "";
  const back = parentHref(path, onOverview);
  const home = homeHref(path, onOverview);
  const here = pathname.replace(/\/+$/, "") || pathname;
  const homeIsHere = here === home.replace(/\/+$/, "");
  const idx = sectionIndex(path);
  const prev = idx > 0 ? MARKET_SECTIONS[idx - 1] : null;
  const next = idx >= 0 && idx < MARKET_SECTIONS.length - 1 ? MARKET_SECTIONS[idx + 1] : null;
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <NavBtn href={back} label="Back" icon={<IconBack />} />
        <NavBtn href={homeIsHere ? null : home} label="Home" icon={<IconHome />} />
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <NavBtn href={prev ? prev.href : null} label={prev ? prev.label : "Previous"} icon={<IconPrev />} />
        <NavBtn href={next ? next.href : null} label={next ? next.label : "Next"} icon={<IconNext />} />
        {onExcel ? (
          <button type="button" onClick={onExcel} disabled={excelBusy} className={`${btn} disabled:opacity-40`} aria-label="Download Excel">
            <IconExcel />
            {excelBusy ? "Preparing…" : "Download Excel"}
          </button>
        ) : null}
      </div>
    </>
  );
}

export default function MarketDeskNav({
  path = "",
  placement,
  onExcel,
  excelBusy,
}: {
  path?: string;
  placement: "top" | "footer";
  onExcel?: () => void;
  excelBusy?: boolean;
}) {
  const pathname = usePathname() || "";
  const onOverview = pathname === "/backoffice" || pathname === "/backoffice/";
  const idx = sectionIndex(onOverview ? "" : path);
  const current = idx >= 0 ? MARKET_SECTIONS[idx] : null;

  if (placement === "top") {
    return (
      <nav aria-label="Market page" className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E5E5] bg-[#F3F9FE] px-2.5 py-2 dark:border-[#2B3644] dark:bg-[#0F2A45]">
        <CornerButtons path={path} onOverview={onOverview} onExcel={onExcel} excelBusy={excelBusy} />
      </nav>
    );
  }

  return (
    <nav aria-label="Market sections" className="border-t border-[#E5E5E5] bg-[#F3F9FE] px-2.5 py-2 dark:border-[#2B3644] dark:bg-[#0F2A45]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <CornerButtons path={path} onOverview={onOverview} onExcel={onExcel} excelBusy={excelBusy} />
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {MARKET_SECTIONS.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              aria-current={current && s.href === current.href ? "page" : undefined}
              className={`text-[12px] font-semibold hover:underline ${
                current && s.href === current.href ? "text-[#0176D3] dark:text-[#1B96FF]" : "text-[#706E6B] dark:text-[#A8B4C4]"
              }`}
            >
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
