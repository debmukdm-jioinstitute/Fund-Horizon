"use client";

import React, { useEffect, useState } from "react";
import { FactsheetResult, getFactsheets } from "@/lib/backoffice";

/** Official factsheet archive: for a mutual fund it is the AMC's monthly factsheet; for a PMS strategy, its publisher's. */
export default function FactsheetList({ kind, id }: { kind: "mf" | "pms"; id?: string }) {
  const [data, setData] = useState<FactsheetResult | null | undefined>(undefined); // undefined = loading, null = failed

  useEffect(() => {
    setData(undefined);
    if (!id) return;
    let cancelled = false;
    getFactsheets(kind, id)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const muted = "text-[12px] text-[#706E6B] dark:text-[#A8B4C4]";
  return (
    <div className="terminal-panel overflow-hidden">
      <div className="p-3 border-b border-[#E5E5E5] dark:border-[#2B3644] text-[12px] font-medium text-[#181818] dark:text-[#EDF2F7] flex justify-between gap-2">
        <span>Factsheets</span>
        {data?.source && <span className="font-normal text-[#706E6B] dark:text-[#A8B4C4]">{data.source} · official PDFs</span>}
      </div>
      {data === undefined && <div className={`p-3 ${muted}`}>Loading factsheets…</div>}
      {data === null && <div className={`p-3 ${muted}`}>Could not load factsheets.</div>}
      {data && data.items.length === 0 && (
        <div className={`p-3 ${muted}`}>
          {data.source
            ? "Source is connected; no factsheet has been recorded yet."
            : data.noPublic
              ? "This publisher offers no public factsheet download for the strategy; its website shows performance on the page only."
              : "Automatic factsheet pulling is not set up for this publisher yet."}
        </div>
      )}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-[#E5E5E5] dark:divide-[#2B3644] max-h-72 overflow-y-auto">
          {data.items.map((f) => (
            <li key={f.id}>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 p-3 text-[12px] hover:bg-[#F3F3F3] dark:hover:bg-[#171E27] transition"
              >
                <span className="font-medium text-[#0176D3] dark:text-[#1B96FF]">{f.title}</span>
                <span className="font-mono text-[#706E6B] dark:text-[#A8B4C4] shrink-0">{f.period} ↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
