"use client";

import React, { useEffect, useState } from "react";
import { getMfQuartileAnnual, getMfQuartileRanking, getMfScreener, MfQuartileData } from "@/lib/backoffice";
import { EQUITY_ADVISORKHOJ, nameKey } from "./MfQuartileRankings";

// `cat` is a screener category key ("flexi_cap") or SEBI category text ("... Flexi Cap Fund"); only Advisorkhoj's 12 equity categories are covered.
const labelFor = (cat?: string) => {
  if (!cat) return undefined;
  if (EQUITY_ADVISORKHOJ[cat]) return EQUITY_ADVISORKHOJ[cat];
  const t = cat.toLowerCase();
  return Object.values(EQUITY_ADVISORKHOJ).find((l) => t.includes(l.replace("Equity: ", "").toLowerCase()));
};

// Screener category key for the computed peer group: a key passes through, an
// Advisorkhoj label maps back to its key, anything else is used as-is and the
// screener simply returns no peers for it (honest unavailable, never a guess).
const keyFor = (cat?: string) => {
  if (!cat) return undefined;
  if (EQUITY_ADVISORKHOJ[cat]) return cat;
  const entry = Object.entries(EQUITY_ADVISORKHOJ).find(([, l]) => l === cat);
  if (entry) return entry[0];
  return /\s/.test(cat) ? labelFor(cat) ? Object.entries(EQUITY_ADVISORKHOJ).find(([, l]) => l === labelFor(cat))?.[0] : undefined : cat;
};

const short = (v: string) => v.replace(/ Quartile$/, "").replace("Upper Middle", "Upper Mid").replace("Lower Middle", "Lower Mid");
// Advisorkhoj quartile words -> number. Anything unrecognised is missing, never guessed.
const quartileNum = (v?: string | null) => {
  if (!v) return null;
  if (/top/i.test(v)) return 1;
  if (/upper/i.test(v)) return 2;
  if (/lower/i.test(v)) return 3;
  if (/bottom/i.test(v)) return 4;
  return null;
};

const PERIODS = [
  { key: "1y", label: "1Y" },
  { key: "2y", label: "2Y" },
  { key: "3y", label: "3Y" },
  { key: "5y", label: "5Y" },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];
type CardValue = { q: number | null; source: "advisorkhoj" | "computed" | null };
type Loaded = { cards: Record<PeriodKey, CardValue>; years: [string, string][]; peerCat: string; peerPlan: string };

const cache = new Map<string, Promise<Loaded | null>>();

async function load(label: string | undefined, catKey: string | undefined, name: string, peerPlan: string): Promise<Loaded | null> {
  const find = (d: MfQuartileData) => d.rows.findIndex((r) => nameKey(r[0]) === nameKey(name));
  const cards: Record<PeriodKey, CardValue> = { "1y": { q: null, source: null }, "2y": { q: null, source: null }, "3y": { q: null, source: null }, "5y": { q: null, source: null } };
  let years: [string, string][] = [];

  // Advisorkhoj trailing quartiles (Regular plan; the provider supports 1y/2y/3y/5y).
  // A failed or empty table for one period only blanks that period, never the whole card.
  if (label) {
    try {
      const [annual, ...trail] = await Promise.all([
        getMfQuartileAnnual({ category: label, plan: "Regular" }).then((r) => r.data).catch(() => null),
        ...PERIODS.map((p) => getMfQuartileRanking({ category: label, period: p.key, plan: "Regular" }).then((r) => r.data).catch(() => null)),
      ]);
      if (annual) {
        const ai = find(annual);
        if (ai >= 0) years = annual.columns.flatMap((c, j) => (/^\d{4}/.test(c) && annual.rows[ai][j] ? [[c, annual.rows[ai][j]] as [string, string]] : [])).slice(-5);
      }
      trail.forEach((d, k) => {
        if (!d) return;
        const i = find(d);
        const c = d.columns.findIndex((x) => /current quarter quartile/i.test(x));
        if (i >= 0 && c >= 0) {
          const q = quartileNum(d.rows[i][c]);
          if (q) cards[PERIODS[k].key] = { q, source: "advisorkhoj" };
        }
      });
    } catch {
      // Advisorkhoj down entirely: computed fallback below still runs.
    }
  }

  // Computed fallback: the screener's own backend-computed quartile_* fields for
  // this fund, ranked within its category + plan peer group (min 8 peers, ties
  // averaged — see backend/app/backoffice/mf_screener.py). Only fills periods
  // Advisorkhoj left blank; a null field stays unavailable, never fabricated.
  if (catKey) {
    try {
      const rows: { name: string; [k: string]: string | number | boolean | null | undefined }[] = [];
      let total = 0;
      for (let page = 0; page < 5; page++) {
        const res = await getMfScreener({ category: [catKey], plan: [peerPlan], sort: "name", order: "asc", ranges: {}, limit: 200, offset: page * 200 });
        total = res.total;
        rows.push(...(res.data as typeof rows));
        if (rows.length >= total) break;
      }
      const mine = rows.find((r) => nameKey(r.name) === nameKey(name));
      if (mine) {
        (PERIODS as readonly { key: PeriodKey; label: string }[]).forEach((p) => {
          if (cards[p.key].q) return;
          const v = mine[`quartile_${p.key}`];
          if (typeof v === "number" && v >= 1 && v <= 4) cards[p.key] = { q: v, source: "computed" };
        });
      }
    } catch {
      // Screener down: Advisorkhoj values above still stand.
    }
  }

  const anyCard = PERIODS.some((p) => cards[p.key].q);
  if (!anyCard && years.length === 0) return null;
  return { cards, years, peerCat: label?.replace("Equity: ", "") ?? catKey ?? "category", peerPlan };
}

const BAND: Record<number, string> = { 1: "Top 25%", 2: "25–50% band", 3: "50–75% band", 4: "Bottom 25%" };
const LEGEND = [
  ["Q1", "Top 25%"],
  ["Q2", "25–50%"],
  ["Q3", "50–75%"],
  ["Q4", "Bottom 25%"],
] as const;

function ChartIcon() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EAF3FF] dark:bg-[#1E3247]" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="14" width="4" height="7" rx="1" fill="#0176D3" />
        <rect x="10" y="10" width="4" height="11" rx="1" fill="#0176D3" opacity="0.75" />
        <rect x="17" y="3" width="4" height="18" rx="1" fill="#0176D3" opacity="0.5" />
      </svg>
    </span>
  );
}

/** Per-fund quartile card: Advisorkhoj trailing quartiles, computed peer quartiles where Advisorkhoj has none. */
export default function FundQuartile({ name, cat, plan }: { name: string; cat?: string; plan?: string }) {
  const label = labelFor(cat);
  const catKey = keyFor(cat);
  const peerPlan = /direct/i.test(plan ?? "") ? "Direct" : "Regular";
  const [d, setD] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    setD(undefined);
    if (!label && !catKey) return;
    const k = `${label ?? ""}|${catKey ?? ""}|${peerPlan}|${nameKey(name)}`;
    if (!cache.has(k)) cache.set(k, load(label, catKey, name, peerPlan).catch(() => null));
    let off = false;
    cache.get(k)!.then((v) => !off && setD(v));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, catKey, peerPlan, name]);

  const note = "text-[12px] text-[#706E6B] dark:text-[#A8B4C4]";
  const cardShell = "rounded-[20px] border border-[#DCE6F5] dark:border-[#2B3644] bg-white dark:bg-[#1B2637] shadow-sm p-4 sm:p-5 space-y-4";
  const header = (
    <div className="flex items-start gap-3">
      <ChartIcon />
      <div>
        <div className="text-[20px] leading-tight font-semibold text-[#181818] dark:text-[#EDF2F7]">Quartile rankings</div>
        <div className="text-[13px] text-[#706E6B] dark:text-[#A8B4C4]">Computed within category and plan peers</div>
      </div>
    </div>
  );

  if (!label && !catKey) {
    return (
      <div className={cardShell}>
        {header}
        <div className={note}>Quartile rankings are published for equity categories only.</div>
      </div>
    );
  }
  if (d === undefined) {
    return (
      <div className={cardShell}>
        {header}
        <div className={note}>Loading…</div>
      </div>
    );
  }
  if (d === null) {
    return (
      <div className={cardShell}>
        {header}
        <div className={note}>Not ranked by Advisorkhoj or the screener&apos;s peers (new fund, Direct-only or unmatched name).</div>
      </div>
    );
  }

  const computedCount = PERIODS.filter((p) => d.cards[p.key].source === "computed").length;
  const valuedCount = PERIODS.filter((p) => d.cards[p.key].q).length;
  const anyAk = PERIODS.some((p) => d.cards[p.key].source === "advisorkhoj");
  const sourceLeft = !anyAk
    ? `Source: computed quartiles — the screener's ${d.peerCat} and ${d.peerPlan} peers.`
    : computedCount > 0
      ? `Source: Advisorkhoj, category and Regular plan. Computed quartiles use the screener's ${d.peerCat} and ${d.peerPlan} peers.`
      : "Source: Advisorkhoj, category and Regular plan.";
  const sourceRight = anyAk
    ? "Advisorkhoj may not rank new funds, Direct-only plans or unmatched names."
    : "Computed quartiles need at least 8 peers with a return for the period.";

  return (
    <div className={cardShell}>
      {header}
      {computedCount === 4 && (
        <div className="rounded-lg border border-[#D3E3F8] dark:border-[#2B4A6B] bg-[#EAF3FF] dark:bg-[#1E3247] px-3 py-2 text-[13px] text-[#1F3A5F] dark:text-[#C9D9EE]" role="note">
          <span aria-hidden="true">ⓘ&nbsp;</span>Advisorkhoj ranking unavailable; computed quartiles shown below.
        </div>
      )}
      {computedCount > 0 && computedCount < 4 && (
        <div className="rounded-lg border border-[#D3E3F8] dark:border-[#2B4A6B] bg-[#EAF3FF] dark:bg-[#1E3247] px-3 py-2 text-[13px] text-[#1F3A5F] dark:text-[#C9D9EE]" role="note">
          <span aria-hidden="true">ⓘ&nbsp;</span>Advisorkhoj ranking unavailable for some periods; those cards use computed quartiles.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PERIODS.map((p) => {
          const v = d.cards[p.key];
          return (
            <div key={p.key} className="rounded-xl border border-[#E5E7EB] dark:border-[#2B3644] bg-white dark:bg-[#202936] p-3 text-center">
              <div className="text-left text-[13px] font-medium text-[#5B6472] dark:text-[#A8B4C4]">{p.label}</div>
              {v.q ? (
                <>
                  <div className="py-1 text-[20px] font-bold text-[#181818] dark:text-[#EDF2F7]">Quartile {v.q}</div>
                  <div className="flex justify-center gap-1.5" role="img" aria-label={`Quartile ${v.q} of 4`}>
                    {[1, 2, 3, 4].map((n) => (
                      <span
                        key={n}
                        aria-hidden="true"
                        className={`rounded-md px-2.5 py-1 text-[13px] font-semibold ${n === v.q ? "bg-[#0176D3] text-white dark:bg-[#1B96FF] dark:text-[#10151C]" : "bg-[#EEF1F5] text-[#5B6472] dark:bg-[#2B3644] dark:text-[#A8B4C4]"}`}
                      >
                        Q{n}
                      </span>
                    ))}
                  </div>
                  <div className="pt-2 text-[13px] text-[#5B6472] dark:text-[#A8B4C4]">{BAND[v.q]}</div>
                  {v.source === "computed" && <div className="text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Computed from peers</div>}
                </>
              ) : (
                <>
                  <div className="py-1 text-[16px] font-semibold text-[#706E6B] dark:text-[#A8B4C4]">Unavailable</div>
                  <div className="py-1 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">No ranking available</div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {LEGEND.map(([q, text]) => (
          <span key={q} className="flex items-center gap-2 text-[13px] text-[#5B6472] dark:text-[#A8B4C4]">
            <span aria-hidden="true" className="inline-block h-5 w-5 rounded bg-[#EEF1F5] dark:bg-[#2B3644] border border-[#E5E7EB] dark:border-[#2B3644]" />
            {q}: {text}
          </span>
        ))}
      </div>
      {d.years.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer font-medium text-[#181818] dark:text-[#EDF2F7]">Calendar years</summary>
          <div className="flex flex-wrap gap-3 pt-2">
            {d.years.map(([y, v]) => (
              <span key={y} className="text-[#706E6B] dark:text-[#A8B4C4]">
                {y}: <span className="font-medium text-[#181818] dark:text-[#EDF2F7]">{short(v)}</span>
              </span>
            ))}
          </div>
          <div className={note}>Calendar-year quartiles: Advisorkhoj.</div>
        </details>
      )}
      <div className="flex flex-wrap justify-between gap-2 border-t border-[#E5E7EB] dark:border-[#2B3644] pt-3 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
        <span>{sourceLeft}</span>
        <span>{sourceRight}</span>
      </div>
      {valuedCount === 0 && <div className={note}>No trailing-period ranking available; calendar years above are the only ranking on file.</div>}
    </div>
  );
}
