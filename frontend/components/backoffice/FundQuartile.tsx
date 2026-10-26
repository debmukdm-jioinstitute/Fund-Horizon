"use client";

import React, { useEffect, useState } from "react";
import { getMfQuartileAnnual, getMfQuartileRanking, MfQuartileData } from "@/lib/backoffice";
import { EQUITY_ADVISORKHOJ, nameKey } from "./MfQuartileRankings";

const TONE = (v: string) => (/top/i.test(v) ? "text-[#2E844A]" : /upper/i.test(v) ? "text-[#B5780A]" : /lower/i.test(v) ? "text-[#8B1A1A]" : /bottom/i.test(v) ? "text-[#B42332]" : "");
const short = (v: string) => v.replace(/ Quartile$/, "").replace("Upper Middle", "Upper Mid").replace("Lower Middle", "Lower Mid");
const PERIODS = ["1y", "3y", "5y"] as const;

// `cat` is a screener category key ("flexi_cap") or SEBI category text ("... Flexi Cap Fund"); only Advisorkhoj's 12 equity categories are covered.
const labelFor = (cat?: string) => {
  if (!cat) return undefined;
  if (EQUITY_ADVISORKHOJ[cat]) return EQUITY_ADVISORKHOJ[cat];
  const t = cat.toLowerCase();
  return Object.values(EQUITY_ADVISORKHOJ).find((l) => t.includes(l.replace("Equity: ", "").toLowerCase()));
};

const cache = new Map<string, Promise<{ trailing: Record<string, string>; years: [string, string][] } | null>>();

async function load(label: string, name: string) {
  const find = (d: MfQuartileData) => d.rows.findIndex((r) => nameKey(r[0]) === nameKey(name));
  const [annual, ...trail] = await Promise.all([
    getMfQuartileAnnual({ category: label, plan: "Regular" }).then((r) => r.data),
    ...PERIODS.map((period) => getMfQuartileRanking({ category: label, period, plan: "Regular" }).then((r) => r.data)),
  ]);
  const ai = find(annual);
  const trailing: Record<string, string> = {};
  trail.forEach((d, k) => {
    const i = find(d);
    const c = d.columns.findIndex((x) => /current quarter quartile/i.test(x));
    if (i >= 0 && c >= 0 && d.rows[i][c]) trailing[PERIODS[k].toUpperCase()] = d.rows[i][c];
  });
  const years: [string, string][] =
    ai < 0 ? [] : annual.columns.flatMap((c, j) => (/^\d{4}/.test(c) && annual.rows[ai][j] ? [[c, annual.rows[ai][j]] as [string, string]] : [])).slice(-5);
  return Object.keys(trailing).length || years.length ? { trailing, years } : null;
}

/** Advisorkhoj quartile ranks (trailing 1/3/5Y and last 5 calendar years) for one fund. */
export default function FundQuartile({ name, cat }: { name: string; cat?: string }) {
  const label = labelFor(cat);
  const [d, setD] = useState<Awaited<ReturnType<typeof load>> | undefined>(undefined);

  useEffect(() => {
    setD(undefined);
    if (!label) return;
    const k = `${label}|${nameKey(name)}`;
    if (!cache.has(k)) cache.set(k, load(label, name).catch(() => null));
    let off = false;
    cache.get(k)!.then((v) => !off && setD(v));
    return () => {
      off = true;
    };
  }, [label, name]);

  const note = "text-[12px] text-[#706E6B] dark:text-[#A8B4C4]";
  if (!label) return <div className={note}>Quartile rankings are published for equity categories only.</div>;
  if (d === undefined) return <div className={note}>Loading…</div>;
  if (d === null) return <div className={note}>Not ranked by Advisorkhoj (new fund, Direct-only or unmatched name).</div>;
  const chip = (k: string, v: string) => (
    <div key={k} className="text-center min-w-[64px]">
      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">{k}</div>
      <div className={`text-[12px] font-medium dark:brightness-125 ${TONE(v)}`}>{short(v)}</div>
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {Object.entries(d.trailing).map(([k, v]) => chip(`${k} (current qtr)`, v))}
      </div>
      {d.years.length > 0 && <div className="flex flex-wrap gap-3">{d.years.map(([k, v]) => chip(k, v))}</div>}
      <div className="text-[10px] text-[#706E6B] dark:text-[#A8B4C4]">Quartile within {label?.replace("Equity: ", "")}, Regular plan. Source: Advisorkhoj.</div>
    </div>
  );
}
