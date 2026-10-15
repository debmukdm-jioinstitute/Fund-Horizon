"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { searchCrm, type SearchResult } from "../../lib/crmListApi";

const GROUPS: [SearchResult["type"], string][] = [
  ["household", "Households"], ["contact", "Contacts"], ["lead", "Leads"], ["opportunity", "Opportunities"], ["case", "Grievances"],
];

/** Universal CRM search: id, name, household, mobile, email, PAN last 4, lead notes/tokens. Enter opens the top hit. */
export default function CrmSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) return setResults([]);
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      searchCrm(term)
        .then((r) => alive && (setResults(r), setFailed(false)))
        .catch(() => alive && (setResults([]), setFailed(true)))
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [term]);

  return (
    <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <Command shouldFilter={false} label="Search CRM" loop>
        <Command.Input
          value={q}
          onValueChange={(v) => { setQ(v); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="Search any customer ID, name, household, mobile, email, PAN last 4, lead…"
          aria-label="Search CRM"
          className="w-full rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] px-4 py-3 text-sm text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]"
        />
        {open && term.length >= 2 && (
          <Command.List className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-1 shadow-lg">
            {GROUPS.map(([type, heading]) => {
              const items = results.filter((r) => r.type === type);
              return items.length > 0 && (
                <Command.Group key={type} heading={heading} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[#536176]">
                  {items.map((r) => (
                    <Command.Item
                      key={`${r.type}:${r.id}`} value={`${r.type}:${r.id}`} onSelect={() => router.push(r.href)}
                      className="flex items-center justify-between gap-3 rounded p-2.5 cursor-pointer text-[#172033] dark:text-[#EDF2F7] data-[selected=true]:bg-[#F0F4F8] dark:data-[selected=true]:bg-[#1D2733]"
                    >
                      <span className="truncate text-[13px] font-medium">{r.title}</span>
                      <span className="truncate text-[11px] text-[#536176] dark:text-[#A8B4C4]">{r.subtitle}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
            {busy && <div className="px-3 py-2 text-xs text-[#536176]">Searching…</div>}
            {failed && !busy && <div className="px-3 py-2 text-xs text-[#536176]">Search failed. Try again.</div>}
            {!busy && !failed && results.length === 0 && <div className="px-3 py-3 text-xs text-[#536176]">No records match “{term}”.</div>}
          </Command.List>
        )}
      </Command>
    </div>
  );
}
