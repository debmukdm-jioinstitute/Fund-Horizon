"use client";

import React, { useEffect, useRef, useState } from "react";
import { EquitySuggestion, searchEquities } from "@/lib/backoffice";

const RECENT_KEY = "fh.equities.recent.v1";
const MIN_CHARS = 2;

const loadRecent = (): EquitySuggestion[] => {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
};

/** Bold the part of text that matches the typed query. */
function Hl({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="rounded bg-[#DCEBFF] px-0 text-inherit">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/**
 * Typeahead for NSE stocks: 2+ letters of a name or ticker fill the list with price, day move, sector and 52-week range.
 * Arrow keys + Enter pick, Esc closes, recent picks show on focus.
 */
export default function EquitySearch({ onPick, onResearch, pickLabel = "Open", isAdded, placeholder = "Search by name or ticker (e.g. Waar, Tata, HDFC)", id }: {
  onPick: (x: EquitySuggestion) => void;
  onResearch?: (x: EquitySuggestion) => void;
  pickLabel?: string;
  isAdded?: (symbol: string) => boolean;
  placeholder?: string;
  id?: string;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<EquitySuggestion[]>([]);
  const [recent, setRecent] = useState<EquitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const term = q.trim();

  useEffect(() => setRecent(loadRecent()), []);
  useEffect(() => {
    if (term.length < MIN_CHARS) { setRes([]); setBusy(false); setFailed(false); return; }
    const ac = new AbortController();
    setBusy(true);
    const t = setTimeout(() => {
      searchEquities(term, ac.signal)
        .then((r) => { setRes(r); setFailed(false); setHi(0); setBusy(false); })
        .catch(() => { if (!ac.signal.aborted) { setFailed(true); setBusy(false); } });
    }, 200);
    return () => { clearTimeout(t); ac.abort(); };
  }, [term]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const list = term.length < MIN_CHARS ? recent : res;
  const pick = (x: EquitySuggestion) => {
    const next = [x, ...recent.filter((r) => r.symbol !== x.symbol)].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next.map(({ symbol, name }) => ({ symbol, name })))); } catch { /* storage full or blocked: recents are optional */ }
    onPick(x);
    setQ(""); setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
    else if (e.key === "Escape") setOpen(false);
  };
  const pct = (v?: number | null) => (v == null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

  return (
    <div ref={box} className="relative">
      <svg aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#81878C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input
        id={id} value={q} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id ?? "eqs"}-list`}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[#D5E3F7] bg-white/80 py-2.5 pl-9 pr-9 text-sm outline-none backdrop-blur focus:border-[#1F7AE0] focus:ring-2 focus:ring-[#1F7AE0]/15"
      />
      {busy && <span aria-label="Searching" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-[#D5E3F7] border-t-[#1F7AE0]" />}
      {open && (
        <ul id={`${id ?? "eqs"}-list`} role="listbox" className="absolute z-30 mt-1.5 max-h-96 w-full overflow-auto rounded-xl border border-[#D5E3F7] bg-white/95 p-1 shadow-[0_18px_40px_-18px_rgba(26,115,232,0.45)] backdrop-blur">
          {term.length < MIN_CHARS && recent.length > 0 && <li className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-[#81878C]">Recent</li>}
          {term.length < MIN_CHARS && recent.length === 0 && <li className="px-3 py-3 text-xs text-[#81878C]">Type {MIN_CHARS}+ letters of a company name or ticker.</li>}
          {term.length >= MIN_CHARS && !busy && failed && <li className="px-3 py-3 text-xs text-[#B42332]">Search is unavailable right now. Try again in a moment.</li>}
          {term.length >= MIN_CHARS && !busy && !failed && res.length === 0 && <li className="px-3 py-3 text-xs text-[#81878C]">No NSE stock matches “{term}”.</li>}
          {list.map((x, i) => {
            const added = isAdded?.(x.symbol);
            const up = (x.change_pct ?? 0) >= 0;
            return (
              <li key={x.symbol} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${i === hi ? "bg-[#EAF2FF]" : ""}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => pick(x)}>
                  <div className="truncate text-sm font-medium text-[#17408B]"><Hl text={x.name} q={term} /></div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#81878C]">
                    <span className="font-mono text-[#535B62]"><Hl text={x.symbol} q={term} /></span>
                    {x.sector && <span className="rounded bg-[#EEF4FD] px-1.5 text-[#4A6FA5]">{x.sector}</span>}
                    {x.low_52w != null && x.high_52w != null && <span>52w {x.low_52w.toFixed(0)}–{x.high_52w.toFixed(0)}</span>}
                  </div>
                </button>
                {x.price != null && (
                  <div className="shrink-0 text-right text-sm">
                    <div className="font-medium">₹{x.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                    <div className={`text-xs ${up ? "text-[#1B8A5A]" : "text-[#E5484D]"}`}>{pct(x.change_pct)}</div>
                  </div>
                )}
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button type="button" disabled={added} onClick={() => pick(x)}
                    className="rounded-lg bg-[#1F7AE0] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#17408B] disabled:bg-[#D5E3F7] disabled:text-[#81878C]">
                    {added ? "Added" : pickLabel}
                  </button>
                  {onResearch && <button type="button" onClick={() => { onResearch(x); setOpen(false); }} className="text-xs text-[#1F7AE0] hover:underline">Research ↗</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
