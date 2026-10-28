"use client";

import { useEffect, useRef, useState } from "react";

export interface FundTab { id: string; label: string }

const BAR = 52; // height of this bar

/** Sticky section tabs: click smooth-scrolls to the section, scrolling highlights the section in view. */
/** The bar sticks under the page's own sticky <header> (public GlobalHeader 52px, backoffice shell ~128px); its height is measured live. */
export default function FundTabs({ tabs, barCls = "bg-[var(--terminal-bg)]", activeCls = "border-teal-600 font-semibold text-teal-700 dark:text-[#1B96FF]", idleCls = "border-transparent opacity-70 hover:opacity-100" }: { tabs: FundTab[]; barCls?: string; activeCls?: string; idleCls?: string }) {
  const [top, setTop] = useState(0);
  const OFFSET = top + BAR;
  useEffect(() => {
    const h = document.querySelector("header");
    if (!h) return;
    const measure = () => setTop(Math.round(h.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(h);
    return () => ro.disconnect();
  }, []);
  const [active, setActive] = useState(tabs[0]?.id);
  const lock = useRef(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = tabs.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        if (lock.current) return;
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: `-${OFFSET + 8}px 0px -65% 0px` },
    );
    els.forEach((e) => io.observe(e));
    // The last section can be too short to reach the observer band, so the page bottom means "last tab".
    const onScroll = () => {
      if (!lock.current && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) setActive(tabs[tabs.length - 1].id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, [tabs, OFFSET]);

  useEffect(() => {
    const btn = bar.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!btn || !bar.current) return;
    const { offsetLeft, offsetWidth } = btn;
    bar.current.scrollTo({ left: offsetLeft - (bar.current.clientWidth - offsetWidth) / 2, behavior: "smooth" });
  }, [active]);

  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    lock.current = true; // ignore the observer while the programmatic scroll runs
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - OFFSET, behavior: reduce ? "auto" : "smooth" });
    window.setTimeout(() => { lock.current = false; window.dispatchEvent(new Event("scroll")); }, 700);
  };

  return (
    <nav aria-label="Fund sections" style={{ top }} className={`sticky z-30 -mx-1 px-1 pt-1 shadow-sm ${barCls}`}>
      <div ref={bar} role="tablist" className="no-scrollbar relative flex gap-6 overflow-x-auto whitespace-nowrap sm:gap-9">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-tab={t.id}
            aria-selected={active === t.id}
            onClick={() => go(t.id)}
            className={`shrink-0 border-b-2 py-3 text-sm transition-colors duration-200 ${
              active === t.id ? activeCls : idleCls
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
