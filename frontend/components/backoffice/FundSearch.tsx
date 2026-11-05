"use client";

import React, { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/apiGet";

export interface FundHit { code: string; name: string; cat: string; amc: string; plan: string; aum: number | null; ter: number | null; r1: number | null; r3: number | null; score: number | null }
interface Row { code: string; name: string; cat_label?: string; amc?: string; plan?: string; aum_cr?: number | null; ter?: number | null; ret_1y?: number | null; cagr_3y?: number | null; fh_score?: number | null }

const hint = "text-[11.5px] text-[#667085] dark:text-[#9AA3B2]";
const pct = (v: number | null) => (v == null ? "-" : `${v.toFixed(2)}%`);
const tone = (v: number | null) => (v == null ? "" : v < 0 ? "text-[#B42318] dark:text-[#FDA29B]" : "text-[#067647] dark:text-[#75E1A0]");
const aumText = (v: number | null) => (v == null ? "-" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);

/** Type-ahead over the mutual fund screener: each suggestion shows category, fund house, plan, AUM, TER, 1Y and 3Y return and FH score. */
export default function FundSearch({ onPick, plan, placeholder, exclude = [], id = "fund-search" }: { onPick: (h: FundHit) => void; plan?: string; placeholder?: string; exclude?: string[]; id?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FundHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBusy(false); return; }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      const p = new URLSearchParams({ search: term, limit: "10", sort: "fh_score", order: "desc" });
      if (plan) p.set("plan", plan);
      apiGet<{ data: Row[] }>(`/api/backoffice/mutual-funds/screener?${p}`)
        .then((d) => { if (n === seq.current) { setHits(d.data.map((r) => ({ code: r.code, name: r.name, cat: r.cat_label ?? "", amc: r.amc ?? "", plan: r.plan ?? "", aum: r.aum_cr ?? null, ter: r.ter ?? null, r1: r.ret_1y ?? null, r3: r.cagr_3y ?? null, score: r.fh_score ?? null }))); setActive(0); } })
        .catch(() => { if (n === seq.current) setHits([]); })
        .finally(() => { if (n === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, plan]);

  const pick = (h: FundHit) => { setQ(""); setHits([]); setOpen(false); onPick(h); };
  return (
    <div className="relative">
      <input className="w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-[13.5px]" role="combobox" aria-expanded={open} aria-controls={id} autoComplete="off" value={q}
        placeholder={placeholder ?? "Type a fund name or scheme code"} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && hits[active]) { e.preventDefault(); pick(hits[active]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && q.trim().length >= 2 && (
        <ul id={id} role="listbox" className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] shadow-lg">
          {hits.map((h, i) => (
            <li key={h.code} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(h); }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-[#E8F3F1] dark:bg-[#1B2F2C]" : ""} ${exclude.includes(h.code) ? "opacity-50" : ""}`}>
              <div className="text-[13px] font-semibold">{h.name} <span className="font-normal text-[#667085] dark:text-[#9AA3B2]">· {h.code}{exclude.includes(h.code) ? " · already added" : ""}</span></div>
              <div className={hint}>{h.cat} · {h.amc} · {h.plan}</div>
              <div className={`${hint} flex flex-wrap gap-x-3`}>
                <span>AUM {aumText(h.aum)}</span><span>TER {h.ter == null ? "-" : `${h.ter.toFixed(2)}%`}</span>
                <span>1Y <b className={tone(h.r1)}>{pct(h.r1)}</b></span><span>3Y <b className={tone(h.r3)}>{pct(h.r3)}</b></span>
                <span>FH score <b>{h.score == null ? "-" : h.score.toFixed(0)}</b></span>
              </div>
            </li>
          ))}
          {!hits.length && <li className={`px-3 py-2 ${hint}`}>{busy ? "Searching…" : "No fund found. Check the spelling or try the scheme code."}</li>}
        </ul>
      )}
    </div>
  );
}
