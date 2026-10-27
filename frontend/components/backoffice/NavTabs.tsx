"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STORAGE_KEY = "fh-backoffice-nav-order";

export interface NavTab {
  href: string;
  label: string;
  icon?: (p: { className?: string }) => React.JSX.Element;
  /** Dropdown children: never draggable out of the group; drag-reorder applies to the parent only. */
  children?: NavTab[];
}

/** Parent tab with a dropdown. Parent label click goes to the parent route; the chevron opens the dropdown. */
function DropdownTab({ tab, on, isActive, pathname }: { tab: NavTab; on: boolean; isActive: (href: string) => boolean; pathname: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const Icon = tab.icon;
  const base = "relative flex min-w-[76px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold whitespace-nowrap transition-colors";
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open ]);
  const moveFocus = (dir: 1 | -1) => {
    const links = Array.from(root.current?.querySelectorAll<HTMLElement>("a[data-child]") ?? []);
    const idx = links.indexOf(document.activeElement as HTMLElement);
    const next = links[(idx + dir + links.length) % links.length];
    next?.focus();
  };
  return (
    <div ref={root} className="relative shrink-0" onKeyDown={(e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else moveFocus(1); }
      if (e.key === "ArrowUp") { e.preventDefault(); if (open) moveFocus(-1); }
    }}>
      <div className={`flex items-stretch rounded-lg ${on ? "bg-gradient-to-b from-[#1B96FF] to-[#0176D3] text-white shadow-[0_3px_0_#00A1E0]" : "text-[#032D60] dark:text-[#CFE6FC] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F]"}`}>
        <Link href={tab.href} aria-current={on ? "page" : undefined} data-active={on || undefined} className={`${base} pr-1`}>
          {Icon && <Icon className="h-6 w-6" />}
          {tab.label}
        </Link>
        <button
          type="button" aria-haspopup="true" aria-expanded={open} aria-label={`Show ${tab.label} pages`}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
          className="px-1.5 rounded-r-lg hover:bg-black/10 dark:hover:bg-white/10"
        >
          <span aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
      </div>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] p-1 shadow-xl">
          {(tab.children ?? []).map((c) => {
            const active = isActive(c.href);
            return (
              <Link
                key={c.href} href={c.href} data-child role="menuitem" aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`block rounded px-3 py-2 text-[13px] font-medium ${active ? "bg-[#0176D3] text-white" : "text-[#181818] dark:text-[#EDF2F7] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F]"}`}
              >
                {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function readOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function SortableTab({ tab, on, editing }: { tab: NavTab; on: boolean; editing: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.href, disabled: !editing });
  const Icon = tab.icon;
  const base = "relative flex min-w-[76px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold whitespace-nowrap transition-colors";
  const style = { transform: CSS.Transform.toString(transform), transition, touchAction: editing ? "none" : undefined } as const;
  const body = (
    <>
      {Icon && <Icon className="h-6 w-6" />}
      {tab.label}
    </>
  );
  if (editing) {
    return (
      <div
        ref={setNodeRef} style={style} {...attributes} {...listeners}
        className={`${base} cursor-grab select-none border border-dashed border-[#0176D3] bg-[#EAF5FE] dark:bg-[#11304F] text-[#0176D3] dark:text-[#1B96FF] ${isDragging ? "z-10 shadow-lg" : ""}`}
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      ref={setNodeRef} style={style} href={tab.href} aria-current={on ? "page" : undefined} data-active={on || undefined}
      className={`${base} ${on ? "bg-gradient-to-b from-[#1B96FF] to-[#0176D3] text-white shadow-[0_3px_0_#00A1E0]" : "text-[#032D60] dark:text-[#CFE6FC] hover:bg-[#EAF5FE] dark:hover:bg-[#11304F]"}`}
    >
      {body}
    </Link>
  );
}

/** Lightning-style object tabs. The pencil at the end switches to edit mode, where tabs can be dragged into the
 *  order you want; the order is remembered in this browser. */
export default function NavTabs({ items, pathname, isActive }: { items: NavTab[]; pathname: string; isActive: (href: string) => boolean }) {
  const [saved, setSaved] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSaved(readOrder());
  }, []);

  const ordered = useMemo(() => {
    const byHref = new Map(items.map((i) => [i.href, i]));
    const known = saved.filter((h) => byHref.has(h)).map((h) => byHref.get(h)!);
    return [...known, ...items.filter((i) => !saved.includes(i.href))]; // tabs added later land at the end
  }, [items, saved]);

  // Bring the active tab into view only when the route changes. Doing this on every render (the clock re-renders
  // the header each second) kept snapping the bar back after the user scrolled it.
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const persist = (hrefs: string[]) => {
    setSaved(hrefs);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(hrefs)); } catch { /* private mode: order lasts for this visit */ }
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const hrefs = ordered.map((t) => t.href);
    persist(arrayMove(hrefs, hrefs.indexOf(String(active.id)), hrefs.indexOf(String(over.id))));
  };
  const btn = "flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-[12px] font-semibold hover:bg-[#EAF5FE] dark:hover:bg-[#11304F]";

  return (
    <>
      <div ref={scroller} className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ordered.map((t) => t.href)} strategy={horizontalListSortingStrategy}>
            {ordered.map((t) => (t.children?.length && !editing
              ? <DropdownTab key={t.href} tab={t} on={isActive(t.href) || t.children.some((c) => isActive(c.href))} isActive={isActive} pathname={pathname} />
              : <SortableTab key={t.href} tab={t} on={isActive(t.href)} editing={editing} />))}
          </SortableContext>
        </DndContext>
      </div>
      {editing && (
        <button type="button" onClick={() => persist([])} className={`${btn} text-[#706E6B] dark:text-[#A8B4C4]`}>
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M5.6 15A8 8 0 0018.4 9M18.4 9L20 10M5.6 15L4 14" /></svg>
          Reset
        </button>
      )}
      <button
        type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing}
        aria-label={editing ? "Done reordering tabs" : "Reorder tabs"} title={editing ? "Done" : "Reorder tabs"}
        className={`${btn} ${editing ? "bg-[#0176D3] text-white hover:bg-[#014486] dark:hover:bg-[#014486]" : "text-[#032D60] dark:text-[#CFE6FC]"}`}
      >
        {editing ? (
          <>
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            Done
          </>
        ) : (
          <>
          <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 14v4.5a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18.75V7.5a2.25 2.25 0 012.25-2.25H10" /></svg>
          Edit
          </>
        )}
      </button>
    </>
  );
}
