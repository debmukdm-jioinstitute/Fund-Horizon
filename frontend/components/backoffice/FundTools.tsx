"use client";

import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/apiGet";
import FundSearch from "@/components/backoffice/FundSearch";
import { FundPicker, Result } from "@/components/backoffice/FundPerformance";

interface Field { key: string; label: string; type: "category" | "plan" | "fund" | "funds" | "date" | "number" | "select" | "multi" | "amc"; options?: string[]; default?: string | number | string[]; max?: number; optional?: boolean }
interface Tool { id: string; group: string; title: string; blurb: string; fields: Field[] }
interface Spec { tools: Tool[]; meta: { categories: string[]; amcs: string[] }; benchmarks: string[] }
interface Pick { code: string; name: string }
type Cell = string | number | null;
interface Table { title: string; columns: { key: string; label: string; group: string | null; kind: string | null }[]; rows: Record<string, Cell>[]; note: string; as_of: string }
type Val = string | number | string[] | Pick[] | Pick | null;

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const field = "rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A] px-2.5 py-1.5 text-[13.5px]";
const btnPrimary = "inline-flex items-center gap-1.5 rounded-lg bg-[#006F64] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-40";
const hint = "text-[12px] text-[#667085] dark:text-[#9AA3B2]";
const lbl = "text-[12px] font-semibold";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const resolveDate = (d: unknown): string => {
  const t = new Date();
  if (typeof d === "string" && /^-\d+y$/.test(d)) t.setFullYear(t.getFullYear() - Number(d.slice(1, -1)));
  return iso(t);
};
const initial = (f: Field, spec: Spec): Val => {
  switch (f.type) {
    case "date": return resolveDate(f.default);
    case "number": return String(f.default ?? "");
    case "select": return String(f.default ?? f.options?.[0] ?? "");
    case "multi": return (f.default as string[]) ?? [];
    case "category": return spec.meta.categories.includes("Equity: Large Cap") ? "Equity: Large Cap" : spec.meta.categories[0] ?? "";
    case "plan": return "Regular";
    case "amc": return "";
    case "funds": return [] as Pick[];
    case "fund": return null;
  }
};

export default function FundTools() {
  const [spec, setSpec] = useState<Spec | null>(null);
  const [group, setGroup] = useState("");
  const [toolId, setToolId] = useState("");
  const [vals, setVals] = useState<Record<string, Val>>({});
  const [table, setTable] = useState<Table | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<Spec>("/api/backoffice/mutual-funds/tools/spec").then((s) => {
      setSpec(s);
      const want = new URLSearchParams(window.location.search).get("tool");
      const t = s.tools.find((x) => x.id === want) ?? s.tools[0];
      setGroup(t.group); setToolId(t.id);
      setVals(Object.fromEntries(t.fields.map((f) => [f.key, initial(f, s)])));
    }).catch((e) => setErr(e instanceof Error ? e.message : "Could not load the tools."));
  }, []);

  const groups = useMemo(() => Array.from(new Set(spec?.tools.map((t) => t.group) ?? [])), [spec]);
  const tool = spec?.tools.find((t) => t.id === toolId);
  const choose = (id: string) => {
    const t = spec?.tools.find((x) => x.id === id);
    if (!spec || !t) return;
    setToolId(id); setGroup(t.group); setTable(null); setErr("");
    setVals(Object.fromEntries(t.fields.map((f) => [f.key, initial(f, spec)])));
    window.history.replaceState(null, "", `?tool=${id}`);
  };
  const set = (k: string, v: Val) => setVals((x) => ({ ...x, [k]: v }));

  const submit = () => {
    if (!tool) return;
    const p = new URLSearchParams();
    for (const f of tool.fields) {
      const v = vals[f.key];
      if (f.type === "fund") { if (!v) { setErr(`${f.label}: please select a fund.`); return; } p.set(f.key, (v as Pick).code); }
      else if (f.type === "funds") { const l = v as Pick[]; if (!l.length && !f.optional) { setErr(`${f.label}: please select at least one fund.`); return; } if (l.length) p.set(f.key, l.map((x) => x.code).join(",")); }
      else if (f.type === "multi") { const l = v as string[]; if (!l.length) { setErr(`${f.label}: select at least one.`); return; } p.set(f.key, l.join("|")); }
      else if (f.type === "amc") { if (v) p.set(f.key, String(v)); }
      else { if (v === "" || v == null) { setErr(`${f.label}: please enter a value.`); return; } p.set(f.key, String(v)); }
    }
    setErr(""); setLoading(true);
    apiGet<Table>(`/api/backoffice/mutual-funds/tools/run/${tool.id}?${p}`).then(setTable).catch((e) => { setTable(null); setErr(e instanceof Error ? e.message : "Something went wrong."); }).finally(() => setLoading(false));
  };

  const control = (f: Field) => {
    const v = vals[f.key];
    const wide = f.type === "funds" || f.type === "fund" || f.type === "multi";
    const cls = wide ? "sm:col-span-2 lg:col-span-3" : "";
    switch (f.type) {
      case "category": return <label key={f.key} className={`${lbl} ${cls}`}>{f.label}<select className={`${field} mt-1 w-full`} value={String(v)} onChange={(e) => set(f.key, e.target.value)}>{spec?.meta.categories.map((c) => <option key={c}>{c}</option>)}</select></label>;
      case "plan": return <label key={f.key} className={lbl}>{f.label}<select className={`${field} mt-1 w-full`} value={String(v)} onChange={(e) => set(f.key, e.target.value)}><option>Regular</option><option>Direct</option></select></label>;
      case "amc": return <label key={f.key} className={lbl}>{f.label}<select className={`${field} mt-1 w-full`} value={String(v)} onChange={(e) => set(f.key, e.target.value)}><option value="">All fund houses</option>{spec?.meta.amcs.filter((a) => !a.includes("Largest")).map((a) => <option key={a}>{a}</option>)}</select></label>;
      case "select": return <label key={f.key} className={lbl}>{f.label}<select className={`${field} mt-1 w-full`} value={String(v)} onChange={(e) => set(f.key, e.target.value)}>{f.options?.map((o) => <option key={o}>{o}</option>)}</select></label>;
      case "date": return <label key={f.key} className={lbl}>{f.label}<input type="date" className={`${field} mt-1 w-full`} max={iso(new Date())} value={String(v)} onChange={(e) => set(f.key, e.target.value)} /></label>;
      case "number": return <label key={f.key} className={lbl}>{f.label}<input className={`${field} mt-1 w-full`} inputMode="decimal" value={String(v)} onChange={(e) => set(f.key, e.target.value.replace(/[^\d.]/g, ""))} /></label>;
      case "multi": return <fieldset key={f.key} className={cls}><legend className={lbl}>{f.label}</legend><div className="mt-1 flex flex-wrap gap-2">
        {f.options?.map((o) => { const on = (v as string[]).includes(o); return <label key={o} className={`cursor-pointer rounded-lg border px-3 py-1 text-[12.5px] font-semibold ${on ? "border-[#006F64] bg-[#E6F2F0] text-[#006F64] dark:bg-[#0C2B28] dark:text-[#75E1CE]" : "border-[#E4E9EF] dark:border-[#2B3644]"}`}>
          <input type="checkbox" className="sr-only" checked={on} onChange={() => set(f.key, on ? (v as string[]).filter((x) => x !== o) : [...(v as string[]), o])} />{o}</label>; })}</div></fieldset>;
      case "funds": return <div key={f.key} className={cls}><div className={lbl}>{f.label} <span className={hint}>(up to {f.max ?? 5})</span></div><div className="mt-1"><FundPicker picks={v as Pick[]} setPicks={(p) => set(f.key, p)} max={f.max ?? 5} /></div></div>;
      case "fund": return <div key={f.key} className={cls}><div className={lbl}>{f.label}</div><div className="mt-1 space-y-2">
        {v ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#E6F2F0] px-2.5 py-1 text-[12.5px] font-semibold text-[#006F64] dark:bg-[#0C2B28] dark:text-[#75E1CE]">{(v as Pick).name}<button type="button" aria-label={`Remove ${(v as Pick).name}`} onClick={() => set(f.key, null)}>×</button></span>
          : <FundSearch id={`tool-${f.key}`} placeholder="Type a fund name or scheme code" onPick={(h) => set(f.key, { code: h.code, name: h.name })} />}</div></div>;
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-4 p-5`}>
        <div>
          <h2 className="text-lg font-bold">Fund tools</h2>
          <p className="mt-1 text-[13.5px] text-[#667085] dark:text-[#9AA3B2]">SIP, STP and SWP simulators, rolling returns, portfolio and drawdown tools, benchmark returns and rankings.</p>
        </div>
        <div role="tablist" aria-label="Tool groups" className="flex flex-wrap gap-2">
          {groups.map((g) => <button key={g} role="tab" type="button" aria-selected={group === g} onClick={() => choose(spec!.tools.find((t) => t.group === g)!.id)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${group === g ? "bg-[#183883] text-white" : "border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#183883]"}`}>{g}</button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {spec?.tools.filter((t) => t.group === group).map((t) => <button key={t.id} type="button" aria-pressed={toolId === t.id} onClick={() => choose(t.id)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${toolId === t.id ? "bg-[#006F64] text-white" : "border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64]"}`}>{t.title}</button>)}
        </div>
        {tool && (
          <>
            <p className={hint}>{tool.blurb}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tool.fields.map(control)}</div>
            <div className="flex items-center gap-2"><button type="button" className={btnPrimary} onClick={submit} disabled={loading}>{loading ? "Loading…" : "Submit"}</button></div>
          </>
        )}
        {err && <p role="alert" className="rounded-lg bg-[#FDECEC] px-3 py-2 text-[13px] font-medium text-[#B42318] dark:bg-[#3A1C1C] dark:text-[#FDA29B]">{err}</p>}
      </div>
      {table && <Result key={`${toolId}-${table.rows.length}-${table.columns.length}-${table.as_of}`} t={table} />}
    </div>
  );
}
