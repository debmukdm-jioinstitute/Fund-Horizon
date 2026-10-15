"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AmcLogo } from "@/components/BrandLogo";
import { fetchSearchScopes, universalSearch, type SearchHit, type SearchScope } from "@/lib/universalSearch";

export interface SearchModule { href: string; label: string; description: string }

const MODULES_SCOPE: SearchScope = { key: "modules", label: "Modules" };
const ALL: SearchScope = { key: "all", label: "All" };

/** One search across funds, managers, PMS, AMCs, CRM records, news/notes and modules. Enter opens the top hit. */
export default function UniversalSearch({
  modules, onDone, autoFocus = false, heading = true,
}: { modules: SearchModule[]; onDone?: () => void; autoFocus?: boolean; heading?: boolean }) {
  const router = useRouter();
  const [scopes, setScopes] = useState<SearchScope[]>([ALL, MODULES_SCOPE]);
  const [scope, setScope] = useState("all");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  // Close on a click outside. (Closing on input blur raced with clicks: the list unmounted ~150ms after mouse-down,
  // so a slower click never reached the result.)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  useEffect(() => {
    fetchSearchScopes().then((s) => setScopes([ALL, ...s, MODULES_SCOPE])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (term.length < 2 || scope === "modules") {
      setHits([]);
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      universalSearch(term, scope)
        .then((r) => alive && (setHits(r), setFailed(false)))
        .catch(() => alive && (setHits([]), setFailed(true)))
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [term, scope]);

  const mods = useMemo(() => {
    if (scope !== "all" && scope !== "modules") return [];
    const s = term.toLowerCase();
    return modules.filter((m) => !s || m.label.toLowerCase().includes(s) || m.description.toLowerCase().includes(s)).slice(0, scope === "all" ? 4 : 20);
  }, [modules, scope, term]);

  const go = (href: string, external?: boolean) => {
    setOpen(false);
    onDone?.();
    if (external) window.open(href, "_blank", "noopener,noreferrer");
    else router.push(href);
  };
  const groups = scopes.filter((s) => s.key !== "all" && s.key !== "modules").map((s) => ({ scope: s, items: hits.filter((h) => h.scope === s.key) })).filter((g) => g.items.length);
  const empty = term.length >= 2 && !busy && !failed && hits.length === 0 && mods.length === 0;
  const scopeLabel = scopes.find((s) => s.key === scope)?.label ?? "All";

  return (
    <div className="space-y-2.5">
      {heading && <h2 className="text-[20px] font-bold text-[#032D60] dark:text-[#EDF2F7]">One search. Your entire workspace.</h2>}
      <div ref={box} className="relative">
        <Command shouldFilter={false} label="Universal search" loop>
          <div className="flex items-stretch overflow-hidden rounded-lg border-2 border-[#0176D3] bg-white dark:bg-[#111722] shadow-[0_0_0_4px_rgba(1,118,211,0.12)]">
            <svg className="ml-3 h-5 w-5 shrink-0 self-center text-[#0176D3]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <label className="sr-only" htmlFor="universal-scope">Search scope</label>
            <select
              id="universal-scope" value={scope} onChange={(e) => { setScope(e.target.value); input.current?.focus(); }}
              className="ml-2 w-[88px] shrink-0 border-r border-[#E5E5E5] dark:border-[#2B3644] bg-transparent px-2 text-[14px] text-[#181818] dark:text-[#EDF2F7] focus:outline-none sm:w-[120px]"
            >
              {scopes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <Command.Input
              ref={input} value={q} autoFocus={autoFocus} aria-label="Search the workspace"
              onValueChange={(v) => { setQ(v); setOpen(true); }} onFocus={() => setOpen(true)}
              onKeyDown={(e) => e.key === "Escape" && (setOpen(false), onDone?.())}
              placeholder={`Search ${scope === "all" ? "funds, managers, customers" : scopeLabel.toLowerCase()}, and more…`}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[14px] text-[#181818] dark:text-[#EDF2F7] placeholder:text-[#706E6B] focus:outline-none"
            />
            <kbd className="my-auto mr-2 hidden shrink-0 rounded border border-[#E5E5E5] dark:border-[#2B3644] px-2 py-1 text-[11px] text-[#706E6B] lg:block">Ctrl / ⌘ K</kbd>
            <button type="button" onClick={() => { setOpen(true); input.current?.focus(); }} className="m-1.5 shrink-0 rounded-md bg-[#0176D3] px-4 text-[14px] font-semibold text-white hover:bg-[#014486] sm:px-6">Search</button>
          </div>

          {open && term.length >= 2 && (
            <Command.List onMouseDown={(e) => e.preventDefault()} className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[60vh] overflow-y-auto rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-1 shadow-xl">
              {groups.map(({ scope: s, items }) => (
                <Command.Group key={s.key} heading={s.label} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[#706E6B]">
                  {items.map((h) => (
                    <Command.Item
                      key={`${h.scope}:${h.type}:${h.id}`} value={`${h.scope}:${h.type}:${h.id}`} onSelect={() => go(h.href, h.external)}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded p-2.5 text-[#181818] dark:text-[#EDF2F7] data-[selected=true]:bg-[#EAF5FE] dark:data-[selected=true]:bg-[#11304F]"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {h.amc && <AmcLogo amc={h.amc} className="h-7 min-w-7" />}
                        <span className="truncate text-[13px] font-medium">{h.title}</span>
                      </span>
                      <span className="hidden truncate text-[11px] text-[#706E6B] dark:text-[#A8B4C4] sm:block">{h.subtitle}{h.external ? " ↗" : ""}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {mods.length > 0 && (
                <Command.Group heading="Modules" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[#706E6B]">
                  {mods.map((m) => (
                    <Command.Item key={m.href} value={`module:${m.href}`} onSelect={() => go(m.href)} className="flex cursor-pointer flex-col rounded p-2.5 text-[#181818] dark:text-[#EDF2F7] data-[selected=true]:bg-[#EAF5FE] dark:data-[selected=true]:bg-[#11304F]">
                      <span className="text-[13px] font-medium">{m.label}</span>
                      <span className="truncate text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{m.description}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {busy && <div className="px-3 py-2 text-xs text-[#706E6B]">Searching…</div>}
              {failed && !busy && <div className="px-3 py-2 text-xs text-[#706E6B]">Search is unavailable right now. Try again.</div>}
              {empty && <div className="px-3 py-3 text-xs text-[#706E6B]">No results for “{term}”.</div>}
            </Command.List>
          )}
        </Command>
      </div>

      <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">{scopes.filter((s) => s.key !== "all").map((s) => s.label).join(" · ")}</p>
      <div className="flex flex-wrap gap-2">
        {scopes.map((s) => (
          <button
            key={s.key} type="button" onClick={() => { setScope(s.key); input.current?.focus(); }} aria-pressed={scope === s.key}
            className={`rounded-md border px-3.5 py-1.5 text-[13px] ${scope === s.key ? "border-[#0176D3] bg-[#EAF5FE] font-semibold text-[#0176D3] dark:bg-[#11304F] dark:text-[#1B96FF]" : "border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-[#181818] dark:text-[#EDF2F7] hover:border-[#0176D3]"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
