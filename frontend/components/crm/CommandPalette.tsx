// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { searchCrm, type SearchResult } from "../../lib/crmListApi";

export interface PaletteModule {
  href: string;
  label: string;
  description: string;
}

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  household: "Households",
  contact: "Contacts",
  lead: "Leads",
  opportunity: "Opportunities",
  case: "Grievances",
};

const GROUP_ORDER: SearchResult["type"][] = ["household", "contact", "lead", "opportunity", "case"];

/** ⌘K: jump to a terminal module, or search CRM households, contacts, leads, opportunities and cases
 *  (including by mobile number and PAN last 4). CRM results are only requested for staff sessions. */
export default function CommandPalette({ open, onClose, modules }: { open: boolean; onClose: () => void; modules: PaletteModule[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const t = setTimeout(() => {
      searchCrm(q)
        .then((r) => alive && (setResults(r), setFailed(false)))
        .catch(() => alive && (setResults([]), setFailed(true)))
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, open]);

  const matchingModules = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modules.filter((m) => !q || m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
  }, [modules, query]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search the terminal and CRM"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/40"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-[#10151C] border border-[#E5E5E5] dark:border-[#2B3644] rounded-lg shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} label="Search" loop>
          <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] flex items-center gap-2">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search households, contacts, leads, mobile, PAN last 4… or jump to a module"
              className="w-full text-[13px] bg-transparent text-[#181818] dark:text-[#EDF2F7] placeholder-[#706E6B] dark:placeholder-[#A8B4C4] focus:outline-none"
            />
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] px-1.5 py-0.5 rounded border border-[#E5E5E5] dark:border-[#2B3644]"
            >
              ESC
            </button>
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1">
            {GROUP_ORDER.map((type) => {
              const items = results.filter((r) => r.type === type);
              if (!items.length) return null;
              return (
                <Command.Group
                  key={type}
                  heading={TYPE_LABEL[type]}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[#706E6B] dark:[&_[cmdk-group-heading]]:text-[#A8B4C4]"
                >
                  {items.map((r) => (
                    <Command.Item
                      key={`${r.type}:${r.id}`}
                      value={`${r.type}:${r.id}`}
                      onSelect={() => go(r.href)}
                      className="flex items-center justify-between gap-3 p-2.5 rounded cursor-pointer text-[#181818] dark:text-[#EDF2F7] data-[selected=true]:bg-[#F0F4F8] dark:data-[selected=true]:bg-[#1D2733]"
                    >
                      <span className="text-[13px] font-medium truncate">{r.title}</span>
                      <span className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4] truncate">{r.subtitle}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
            {searching && <div className="px-3 py-2 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">Searching…</div>}
            {failed && !searching && query.trim().length >= 2 && (
              <div className="px-3 py-2 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">CRM search is unavailable for this account.</div>
            )}
            {matchingModules.length > 0 && (
              <Command.Group
                heading="Terminal modules"
                className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[#706E6B] dark:[&_[cmdk-group-heading]]:text-[#A8B4C4]"
              >
                {matchingModules.map((m) => (
                  <Command.Item
                    key={m.href}
                    value={`module:${m.href}`}
                    onSelect={() => go(m.href)}
                    className="flex items-center justify-between gap-3 p-2.5 rounded cursor-pointer text-[#181818] dark:text-[#EDF2F7] data-[selected=true]:bg-[#F0F4F8] dark:data-[selected=true]:bg-[#1D2733]"
                  >
                    <span>
                      <span className="block text-[13px] font-medium">{m.label}</span>
                      <span className="block text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{m.description}</span>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {!searching && results.length === 0 && matchingModules.length === 0 && (
              <Command.Empty className="p-4 text-center text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
                No modules or CRM records match &quot;{query}&quot;
              </Command.Empty>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
