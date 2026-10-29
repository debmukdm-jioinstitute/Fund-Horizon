"use client";

import React, { useState } from "react";
import { createMfWatchlist, listMfWatchlists, setMfWatchlistFund, type MfWatchlist } from "@/lib/backoffice";

/** "☆ Watchlist" popover: tick the lists a fund belongs to, or start a new one. Lists load on open so they are always current. */
export default function AddToWatchlist({ code, onChange, className = "terminal-btn text-[11px] py-0.5 px-2" }: {
  code: string; onChange?: () => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<MfWatchlist[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => listMfWatchlists().then(setLists).catch((e) => setMsg(e instanceof Error ? e.message : "Could not load watchlists."));
  const run = async (fn: () => Promise<unknown>) => {
    try { setMsg(""); await fn(); await load(); onChange?.(); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not update the watchlist."); }
  };

  return (
    <span className="relative inline-block text-left">
      <button type="button" className={className} aria-expanded={open}
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}>☆ Watchlist</button>
      {open && (
        <div role="dialog" aria-label="Add to watchlist" className="terminal-panel absolute right-0 z-30 mt-1 w-60 p-2 space-y-1.5 text-[12px] shadow-lg">
          {lists.length === 0 && <div className="text-[#706E6B] dark:text-[#A8B4C4]">No watchlists yet. Create one below.</div>}
          {lists.map((w) => (
            <label key={w.id} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={w.codes.includes(code)}
                onChange={(e) => run(() => setMfWatchlistFund(w.id, code, e.target.checked))} />
              <span className="truncate">{w.name}</span>
              <span className="ml-auto text-[#706E6B] dark:text-[#A8B4C4] tabular-nums">{w.codes.length}</span>
            </label>
          ))}
          <form className="flex gap-1" onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (n) run(async () => { const w = await createMfWatchlist(n); await setMfWatchlistFund(w.id, code, true); setName(""); });
          }}>
            <input aria-label="New watchlist name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
              placeholder="New watchlist…" className="terminal-input text-[12px] py-0.5 px-2 min-w-0 flex-1" />
            <button type="submit" className="terminal-btn-accent text-[12px] py-0.5 px-2">Add</button>
          </form>
          {msg && <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">{msg}</div>}
        </div>
      )}
    </span>
  );
}
