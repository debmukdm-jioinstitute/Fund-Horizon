"use client";

import React, { useEffect } from "react";

export interface LaunchItem { key: string; title: string; text: string; href: string; icon: string }

/** Home-page grid of sections. Each opens in its own browser tab with the table full screen. */
export default function SectionLauncher({ items, title = "Open a view" }: { items: LaunchItem[]; title?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-[15px] font-medium text-[#1B2B45] dark:text-[#EDF2F7]">{title}</h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((i) => (
          <li key={i.key}>
            <a href={i.href} target="_blank" rel="noopener noreferrer"
              className="group block h-full rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_18px_50px_-20px_rgba(26,115,232,0.32),inset_0_1px_0_rgba(255,255,255,0.95)] transition-transform hover:-translate-y-1 dark:border-white/10 dark:bg-[#12233A]/60">
              <span className="text-[26px]" aria-hidden>{i.icon}</span>
              <span className="mt-3 block text-[16px] font-medium text-[#1B2B45] dark:text-[#EDF2F7]">{i.title}</span>
              <span className="mt-1 block text-[13px] leading-6 text-[#5B6B85] dark:text-[#A8B4C4]">{i.text}</span>
              <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-[#1A73E8] dark:text-[#8AB8FF]">Open in a new tab <span aria-hidden className="transition-transform group-hover:translate-x-0.5">↗</span></span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Full-screen view: hides the backoffice header and menu while `on` (see `.fh-full` in globals.css). */
export function useFullScreen(on: boolean) {
  useEffect(() => {
    if (!on) return;
    document.body.classList.add("fh-full");
    return () => document.body.classList.remove("fh-full");
  }, [on]);
}
