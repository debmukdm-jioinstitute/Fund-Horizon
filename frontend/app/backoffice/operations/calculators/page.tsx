"use client";

import React from "react";
import Link from "next/link";
import { CALCULATORS, CATEGORIES } from "@/lib/calculators";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const teal = "text-[#006F64] dark:text-[#75E1CE]";

export default function CalculatorsLanding() {
  return (
    <div className="space-y-5 pb-12">
      <div className={`${card} px-5 py-4`}>
        <Link href="/backoffice/operations" className={`text-[12.5px] font-semibold ${teal} hover:underline`}>← Operations</Link>
        <h1 className={`mt-1 text-2xl font-bold tracking-tight ${ink}`}>Calculators</h1>
        <p className={`mt-1 max-w-2xl text-[14px] ${muted}`}>{CALCULATORS.length} planning tools for client conversations. Pick one to open it in a new tab. Results are estimates from the assumptions you enter, not guaranteed returns or advice.</p>
      </div>
      {CATEGORIES.map((cat) => {
        const list = CALCULATORS.filter((c) => c.category === cat);
        return list.length === 0 ? null : (
          <section key={cat} aria-label={cat}>
            <h2 className={`mb-2 text-[12px] font-bold uppercase tracking-wider ${muted}`}>{cat}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((c) => (
                <li key={c.id}>
                  <a href={`/backoffice/operations/calculators/${c.id}`} target="_blank" rel="noopener noreferrer"
                    className={`${card} block h-full px-4 py-3 hover:border-[#006F64] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#006F64]`}>
                    <div className={`text-[14.5px] font-bold ${ink}`}>{c.title} <span aria-hidden className={teal}>↗</span><span className="sr-only"> (opens in a new tab)</span></div>
                    <div className={`mt-0.5 text-[12.5px] ${muted}`}>{c.blurb}</div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
