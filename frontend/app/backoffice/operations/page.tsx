"use client";

import React, { useEffect, useMemo, useState } from "react";
import PdfFormFiller, { type PdfSource } from "@/components/operations/PdfFormFiller";
import { getOfficialForms } from "@/lib/backoffice";
import type { OfficialForm } from "@/lib/officialForms";

const SOURCES = ["CAMS", "KFintech", "Stallion"] as const;
const BADGE: Record<OfficialForm["source"], string> = {
  CAMS: "bg-[#E0F2FE] text-[#0369A1] dark:bg-[#075985]/30 dark:text-[#38BDF8]",
  KFintech: "bg-[#FEF3C7] text-[#B45309] dark:bg-[#78350F]/30 dark:text-[#FBBF24]",
  Stallion: "bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#581C87]/30 dark:text-[#C084FC]",
};
const chip = "px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition";
const on = "border-[#006F64] bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE]";
const off = "border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4] hover:border-[#006F64]";

interface Filing { id: number; title: string; client: string; at: string }

export default function OperationsPage() {
  const [forms, setForms] = useState<OfficialForm[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [source, setSource] = useState<OfficialForm["source"] | "ALL">("ALL");
  const [category, setCategory] = useState("ALL");
  const [query, setQuery] = useState("");
  const [filling, setFilling] = useState<PdfSource | null>(null);
  const [filings, setFilings] = useState<Filing[]>([]);

  useEffect(() => {
    getOfficialForms().then(setForms).catch(() => setLoadError(true));
  }, []);

  const inSource = useMemo(() => forms.filter((f) => source === "ALL" || f.source === source), [forms, source]);
  const categories = useMemo(() => Array.from(new Set(inSource.map((f) => f.category))).sort(), [inSource]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return inSource.filter((f) => {
      if (category !== "ALL" && f.category !== category) return false;
      const hay = `${f.title} ${f.source} ${f.category} ${f.keywords} ${f.source === "KFintech" ? "karvy" : ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [inSource, category, query]);
  const groups = useMemo(() => {
    const g: Record<string, OfficialForm[]> = {};
    shown.forEach((f) => (g[f.category] ??= []).push(f));
    return Object.entries(g);
  }, [shown]);

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033] dark:text-[#EDF2F7]">Operations: Official Forms</h1>
          <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4] mt-1 max-w-3xl">
            The publishers&apos; own CAMS and KFintech (Karvy) forms, fetched live so they are always the current version. Fill &amp; Sign
            types your entries, signature and marks onto the original form and downloads that same PDF. Nothing here is a lookalike.
          </p>
        </div>
        <label className="cursor-pointer px-3 py-1.5 rounded-lg border border-[#006F64] text-[#006F64] dark:text-[#75E1CE] text-[12px] font-bold hover:bg-[#E7F5F2] dark:hover:bg-[#1A3034]">
          Fill &amp; sign your own PDF
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setFilling({ kind: "file", file, title: file.name.replace(/\.pdf$/i, "") });
            }}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", ...SOURCES] as const).map((s) => (
          <button key={s} type="button" onClick={() => { setSource(s); setCategory("ALL"); }} className={`${chip} ${source === s ? on : off}`}>
            {s === "ALL" ? "All" : s === "KFintech" ? "KFintech (Karvy)" : s} · {forms.filter((f) => s === "ALL" || f.source === s).length}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search forms (bank mandate, nomination, FATCA, transmission, karvy…)"
          aria-label="Search forms"
          className="flex-1 min-w-[220px] rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-transparent px-3 py-1.5 text-[12px]"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["ALL", ...categories].map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} className={`px-2.5 py-1 rounded-md border text-[11px] ${category === c ? on : off}`}>
            {c === "ALL" ? "All categories" : c}
          </button>
        ))}
      </div>

      {loadError && <p className="text-[13px] text-[#B42332] dark:text-[#FF7D86]">Could not load the forms catalogue.</p>}
      {!loadError && forms.length > 0 && shown.length === 0 && <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4]">No forms match.</p>}

      {groups.map(([cat, items]) => (
        <section key={cat} className="space-y-1.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">{cat} · {items.length}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map((f) => (
              <div key={f.url} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C]">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${BADGE[f.source]}`}>{f.source}</span>
                <span className="flex-1 min-w-0 truncate text-[12px] text-[#172033] dark:text-[#EDF2F7]" title={f.title}>{f.title}</span>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[11px] font-semibold text-[#006F64] dark:text-[#75E1CE] hover:underline">
                  {f.kind === "PDF" ? "Original" : "Open page"}
                </a>
                {f.kind === "PDF" && (
                  <button type="button" onClick={() => setFilling({ kind: "url", url: f.url, title: f.title })} className="shrink-0 px-2.5 py-1.5 rounded-lg bg-[#006F64] text-white text-[11px] font-bold hover:bg-[#005a52]">
                    Fill &amp; Sign
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {filings.length > 0 && (
        <section className="rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-4 space-y-2">
          <h2 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7]">Downloaded this session</h2>
          <ul className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644] text-[12px] text-[#172033] dark:text-[#EDF2F7]">
            {filings.map((x) => (
              <li key={x.id} className="py-1.5 flex justify-between gap-3">
                <span className="truncate">{x.title}</span>
                <span className="shrink-0 text-[#536176] dark:text-[#A8B4C4]">{x.client} · {x.at}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {filling && (
        <PdfFormFiller
          source={filling}
          onClose={() => setFilling(null)}
          onDownloaded={(title, client) => setFilings((p) => [{ id: Date.now(), title, client, at: new Date().toLocaleTimeString() }, ...p.slice(0, 9)])}
        />
      )}
    </div>
  );
}
