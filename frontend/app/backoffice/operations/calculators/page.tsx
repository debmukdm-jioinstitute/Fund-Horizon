"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CALCULATORS, CATEGORIES, calculate, type Calculator, type Metric, type Result } from "@/lib/calculators";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const soft = "bg-[#F8FAFB] dark:bg-[#1B2432]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const teal = "text-[#006F64] dark:text-[#75E1CE]";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-3 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#006F64] hover:text-[#006F64]";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#00554D]";

const inr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const words = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return "";
};
const show = (m: Metric) => m.text ?? (m.kind === "inr" ? inr(m.value) : m.kind === "pct" ? `${m.value.toFixed(2)}%` : `${Math.round(m.value * 10) / 10} years`);
const defaults = (c: Calculator) => Object.fromEntries(c.fields.map((f) => [f.key, f.def === undefined ? "" : String(f.def)]));

export default function CalculatorsPage() {
  const [id, setId] = useState(CALCULATORS[0].id);
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (CALCULATORS.some((c) => c.id === h)) setId(h);
  }, []);
  const calc = CALCULATORS.find((c) => c.id === id) ?? CALCULATORS[0];
  const pick = (next: string) => { setId(next); window.history.replaceState(null, "", `#${next}`); };

  return (
    <div className="space-y-5 pb-12">
      <div className={`${card} px-5 py-4`}>
        <Link href="/backoffice/operations" className={`text-[12.5px] font-semibold ${teal} hover:underline`}>← Operations</Link>
        <h1 className={`mt-1 text-2xl font-bold tracking-tight ${ink}`}>Calculators</h1>
        <p className={`mt-1 max-w-2xl text-[14px] ${muted}`}>Planning tools for client conversations. Results are estimates from the assumptions you enter, not guaranteed returns or advice.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <nav aria-label="Calculators" className={`${card} p-2 lg:self-start`}>
          {CATEGORIES.map((cat) => (
            <div key={cat} className="mb-1">
              <div className={`px-2.5 pb-1 pt-2 text-[11.5px] font-bold uppercase tracking-wider ${muted}`}>{cat}</div>
              <div className="flex flex-wrap gap-1 lg:block">
                {CALCULATORS.filter((c) => c.category === cat).map((c) => (
                  <button key={c.id} type="button" onClick={() => pick(c.id)} aria-current={c.id === id}
                    className={`block rounded-lg px-2.5 py-1.5 text-left text-[13.5px] font-semibold lg:w-full ${c.id === id ? `bg-[#E6F2F0] dark:bg-[#0C2B28] ${teal}` : `${ink} hover:bg-[#F8FAFB] dark:hover:bg-[#1B2432]`}`}>
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <CalcPanel key={calc.id} calc={calc} />
      </div>
    </div>
  );
}

function CalcPanel({ calc }: { calc: Calculator }) {
  const [vals, setVals] = useState<Record<string, string>>(() => defaults(calc));
  const [result, setResult] = useState<Result | null>(null);
  const parsed = useMemo(() => Object.fromEntries(calc.fields.map((f) => [f.key, vals[f.key].trim() === "" ? undefined : Number(vals[f.key])])), [calc, vals]);

  const run = (e: React.FormEvent) => { e.preventDefault(); setResult(calculate(calc, parsed)); };
  const reset = () => { setVals(defaults(calc)); setResult(null); };

  return (
    <section className="space-y-4" aria-labelledby="calc-title">
      <form onSubmit={run} noValidate className={`${card} p-5`}>
        <h2 id="calc-title" className={`text-lg font-bold ${ink}`}>{calc.title}</h2>
        <p className={`mb-4 text-[13.5px] ${muted}`}>{calc.blurb}</p>
        <div className="grid gap-3.5 sm:grid-cols-2">
          {calc.fields.map((f) => (
            <label key={f.key} className="block">
              <span className={`mb-1 block text-[12.5px] font-semibold ${ink}`}>{f.label}{f.optional && <span className={`font-normal ${muted}`}> (optional)</span>}</span>
              <span className="flex overflow-hidden rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] focus-within:border-[#006F64]">
                {f.unit === "₹" && <span className={`px-2.5 py-2 text-[14px] ${soft} ${muted}`}>₹</span>}
                <input type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step ?? "any"} value={vals[f.key]}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                  className={`min-w-0 flex-1 bg-transparent px-2.5 py-2 text-[14px] tabular-nums outline-none ${ink}`} />
                {f.unit !== "₹" && <span className={`px-2.5 py-2 text-[13px] ${soft} ${muted}`}>{f.unit}</span>}
              </span>
              {f.hint && <span className={`mt-0.5 block text-[11.5px] ${muted}`}>{f.hint}</span>}
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button type="submit" className={btnPrimary}>Calculate</button>
          <button type="button" className={btn} onClick={reset}>Reset</button>
        </div>
      </form>

      <div aria-live="polite">
        {result && !result.ok && (
          <div role="alert" className="rounded-[10px] border border-[#F4C7C3] bg-[#FEF3F2] dark:border-[#5C2B2B] dark:bg-[#2A1517] p-4 text-[13.5px] text-[#B42318] dark:text-[#FF7D86]">
            <ul className="list-disc space-y-0.5 pl-5">{result.errors.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {result?.ok && <Results calc={calc} r={result} />}
      </div>
    </section>
  );
}

function Results({ calc, r }: { calc: Calculator; r: Extract<Result, { ok: true }> }) {
  const [hero, ...rest] = r.metrics;
  return (
    <div className="space-y-4">
      <div className={`${card} p-5`}>
        <div className={`text-[12px] font-bold uppercase tracking-wider ${muted}`}>{hero.label}</div>
        <div className={`mt-1 text-3xl font-bold tabular-nums ${teal}`}>{show(hero)}</div>
        {hero.kind === "inr" && words(hero.value) && <div className={`text-[13px] ${muted}`}>{words(hero.value)}</div>}
        <dl className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((m) => (
            <div key={m.label} className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] ${soft} px-3 py-2`}>
              <dt className={`text-[12px] ${muted}`}>{m.label}</dt>
              <dd className={`text-[15px] font-semibold tabular-nums ${ink}`}>{show(m)}{m.kind === "inr" && words(m.value) && <span className={`ml-1.5 text-[12px] font-normal ${muted}`}>{words(m.value)}</span>}</dd>
            </div>
          ))}
        </dl>
        {r.notes?.map((n) => <p key={n} className={`mt-3 text-[13px] ${ink}`}>ⓘ {n}</p>)}
      </div>
      {r.table && (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[420px] text-left text-[13px]">
            <thead><tr className={soft}>{r.table.cols.map((c) => <th key={c} className={`px-3 py-2 font-semibold ${muted}`}>{c}</th>)}</tr></thead>
            <tbody>
              {r.table.rows.map((row, i) => (
                <tr key={i} className="border-t border-[#E4E9EF] dark:border-[#2B3644]">
                  {row.map((c, j) => <td key={j} className={`px-3 py-1.5 tabular-nums ${ink}`}>{typeof c === "number" && r.table?.money?.includes(j) ? inr(c) : c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className={`${card} px-4 py-3`}>
        <summary className={`cursor-pointer text-[13.5px] font-semibold ${ink}`}>How {calc.title} was calculated</summary>
        <ol className={`mt-2 list-decimal space-y-1 pl-5 text-[13px] ${muted}`}>{r.steps.map((s) => <li key={s}>{s}</li>)}</ol>
      </details>
    </div>
  );
}
