"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import CalcCharts, { CountUp } from "@/components/operations/CalcCharts";
import { ClientPicker, loadSaved, saveCalc, type Client, type Saved } from "@/components/operations/CalcClient";
import { download, pdfBlob, renderCard, renderReport, toBlob } from "@/lib/calcExport";
import { vizFor } from "@/lib/calcViz";
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
  const [client, setClient] = useState<Client | null>(null);
  const [loaded, setLoaded] = useState<{ vals: Record<string, string>; n: number } | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [stamp, setStamp] = useState(0); // bumps after a save so the history reloads
  useEffect(() => {
    if (!client) { setSaved([]); return; }
    loadSaved(client).then(setSaved).catch(() => setSaved([]));
  }, [client, stamp]);
  const calc = CALCULATORS.find((c) => c.id === id) ?? CALCULATORS[0];
  const pick = (next: string) => { setId(next); window.history.replaceState(null, "", `#${next}`); };

  return (
    <div className="space-y-5 pb-12">
      <div className={`${card} px-5 py-4`}>
        <Link href="/backoffice/operations" className={`text-[12.5px] font-semibold ${teal} hover:underline`}>← Operations</Link>
        <h1 className={`mt-1 text-2xl font-bold tracking-tight ${ink}`}>Calculators</h1>
        <p className={`mt-1 max-w-2xl text-[14px] ${muted}`}>Planning tools for client conversations. Results are estimates from the assumptions you enter, not guaranteed returns or advice.</p>
      </div>
      <ClientPicker client={client} onChange={setClient} />
      {client && saved.length > 0 && (
        <div className={`${card} px-5 py-3`}>
          <div className={`mb-1.5 text-[12px] font-bold uppercase tracking-wider ${muted}`}>Saved for {client.name}</div>
          <ul className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <li key={s.id}><button type="button" className={btn} onClick={() => { setId(s.calc); setLoaded({ vals: s.vals, n: Date.now() }); window.history.replaceState(null, "", `#${s.calc}`); }}>
                {CALCULATORS.find((c) => c.id === s.calc)?.title ?? s.calc} · {new Date(s.at).toLocaleDateString("en-IN")}</button></li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
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
        <CalcPanel key={`${calc.id}-${loaded?.n ?? 0}`} calc={calc} client={client} initial={loaded?.vals} onSaved={() => setStamp((x) => x + 1)} />
      </div>
    </div>
  );
}

function CalcPanel({ calc, client, initial, onSaved }: { calc: Calculator; client: Client | null; initial?: Record<string, string>; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...defaults(calc), ...initial }));
  const [result, setResult] = useState<Result | null>(null);
  // Snapshot of the inputs that produced the current result. The result,
  // charts, saved copy and PDF/image export all read from this snapshot,
  // never from the live form — so editing a field after Calculate cannot
  // silently mix new inputs with old results in an export.
  const [snap, setSnap] = useState<{ vals: Record<string, string>; parsed: Record<string, number | undefined> } | null>(null);
  const parsed = useMemo(() => Object.fromEntries(calc.fields.map((f) => [f.key, vals[f.key].trim() === "" ? undefined : Number(vals[f.key])])), [calc, vals]);

  const run = (e: React.FormEvent) => { e.preventDefault(); setResult(calculate(calc, parsed)); setSnap({ vals: { ...vals }, parsed: { ...parsed } }); };
  const reset = () => { setVals(defaults(calc)); setResult(null); setSnap(null); };

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="calc-title">
      <form onSubmit={run} noValidate className={`${card} p-5`}>
        <h2 id="calc-title" className={`text-lg font-bold ${ink}`}>{calc.title}</h2>
        <p className={`mb-4 text-[13.5px] ${muted}`}>{calc.blurb}</p>
        {calc.presets && (
          <div className="mb-4 grid gap-2 sm:grid-cols-3" role="group" aria-label="Fee plan presets">
            {calc.presets.map((p) => {
              const on = Object.entries(p.vals).every(([k, x]) => Number(vals[k]) === x);
              return (
                <button key={p.label} type="button" aria-pressed={on} onClick={() => setVals({ ...vals, ...Object.fromEntries(Object.entries(p.vals).map(([k, x]) => [k, String(x)])) })}
                  className={`rounded-xl border px-3 py-2.5 text-left ${on ? "border-[#1A73E8] bg-[#E3EEFF] dark:bg-[#11304F]" : "border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]"}`}>
                  <span className={`block text-[13px] font-semibold ${ink}`}>{p.label}</span>
                  <span className={`block text-[12px] ${muted}`}>{p.hint}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="grid gap-3.5 sm:grid-cols-2">
          {calc.fields.filter((f) => !/^r\d+$/.test(f.key) || calc.id !== "pms-fees" || Number(f.key.slice(1)) <= Number(vals.years || 0)).map((f) => (
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
        {result?.ok && snap && <Results calc={calc} r={result} vals={snap.vals} parsed={snap.parsed} client={client} onSaved={onSaved} />}
      </div>
    </section>
  );
}

function Results({ calc, r, vals, parsed, client, onSaved }: { calc: Calculator; r: Extract<Result, { ok: true }>; vals: Record<string, string>; parsed: Record<string, number | undefined>; client: Client | null; onSaved: () => void }) {
  const [hero, ...rest] = r.metrics;
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const values = useMemo(() => Object.fromEntries(calc.fields.map((f) => [f.key, parsed[f.key] ?? 0])), [calc, parsed]);
  const viz = useMemo(() => vizFor(calc.id, values, r), [calc, values, r]);
  const summary = `${calc.title}: ${r.metrics.slice(0, 3).map((m) => `${m.label} ${show(m)}`).join("; ")}`;

  // Export inputs are the effective values that produced this result
  // (blank optional fields count as 0, as in the calculation), for every
  // field — not just the non-empty form strings. Rupee values keep paise
  // instead of being rounded away, so the PDF matches the screen exactly.
  const inrExact = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
  const data = {
    title: calc.title, client: client?.name, viz, notes: r.notes, steps: r.steps, table: r.table,
    inputs: calc.fields.map((f) => {
      const v = parsed[f.key] ?? 0;
      return [f.label, f.unit === "₹" ? inrExact(v) : f.unit === "age" ? `${v}` : `${v} ${f.unit}`] as [string, string];
    }),
    metrics: r.metrics.map((m) => ({ label: m.label, text: show(m), words: m.kind === "inr" ? (words(m.value) || undefined) : undefined })),
  };
  const card$ = () => renderCard(data);
  const report$ = () => renderReport(data);
  const file = `fund-horizon-${calc.id}${client ? `-${client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}`;
  const act = (fn: () => Promise<string | void>) => async () => {
    setBusy(true); setNote(null);
    try { setNote((await fn()) ?? null); } catch (e) { setNote(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  };
  const pdf = act(async () => { download(await pdfBlob(await report$()), `${file}.pdf`); });
  const png = act(async () => { download(await toBlob(await card$(), "image/png"), `${file}.png`); });
  const share = act(async () => {
    const f = new File([await toBlob(await card$(), "image/png")], `${file}.png`, { type: "image/png" });
    if (!navigator.canShare?.({ files: [f] })) return "Sharing is not supported here. Use Image or PDF and send the file.";
    await navigator.share({ files: [f], title: calc.title });
  });
  const save = act(async () => {
    if (!client) return "Pick or create a customer first.";
    await saveCalc(client, calc.title, calc.id, vals, summary); onSaved();
    return `Saved to ${client.name}.`;
  });

  return (
    <motion.div className="space-y-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className={`${card} p-5`}>
        <div className={`text-[12px] font-bold uppercase tracking-wider ${muted}`}>{hero.label}</div>
        <div className={`mt-1 text-3xl font-bold tabular-nums ${teal}`}>{hero.text || hero.kind === "text" ? show(hero) : <CountUp value={hero.value} fmt={(n) => show({ ...hero, value: n })} />}</div>
        {hero.kind === "inr" && words(hero.value) && <div className={`text-[13px] ${muted}`}>{words(hero.value)}</div>}
        <dl className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((m) => (
            <div key={m.label} className={`rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] ${soft} px-3 py-2`}>
              <dt className={`text-[12px] ${muted}`}>{m.label}</dt>
              <dd className={`text-[15px] font-semibold tabular-nums ${ink}`}>{m.text || m.kind === "text" ? show(m) : <CountUp value={m.value} fmt={(n) => show({ ...m, value: n })} />}{m.kind === "inr" && words(m.value) && <span className={`ml-1.5 text-[12px] font-normal ${muted}`}>{words(m.value)}</span>}</dd>
            </div>
          ))}
        </dl>
        {r.notes?.map((n) => <p key={n} className={`mt-3 text-[13px] ${ink}`}>ⓘ {n}</p>)}
      </div>
      <CalcCharts viz={viz} />
      <div className={`${card} flex flex-wrap items-center gap-2 px-4 py-3`}>
        <button type="button" className={btnPrimary} disabled={busy} onClick={pdf}>Download PDF</button>
        <button type="button" className={btn} disabled={busy} onClick={png}>Download image</button>
        <button type="button" className={btn} disabled={busy} onClick={share}>Share</button>
        <button type="button" className={btn} disabled={busy || !client} title={client ? undefined : "Pick a customer first"} onClick={save}>Save to {client ? client.name : "customer"}</button>
        {note && <span role="status" className={`text-[12.5px] ${muted}`}>{note}</span>}
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
    </motion.div>
  );
}
