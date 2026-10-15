"use client";

import React, { useEffect, useState } from "react";
import {
  getMfRefManager,
  getMfRefScheme,
  getMfRefSummary,
  getMfRefTable,
  mfRefCsvUrl,
  MfRefManagerDetail,
  MfRefPage,
  MfRefRow,
  MfRefSchemeDetail,
  MfRefSummary,
} from "@/lib/backoffice";

const TABS: [string, string][] = [
  ["scheme_master", "Schemes"],
  ["amc_master", "AMCs"],
  ["fund_manager_master", "Fund managers"],
  ["benchmark_master", "Benchmarks"],
  ["category_definitions", "SEBI categories"],
  ["sebi_registry", "SEBI registry"],
  ["coverage_by_amc", "Coverage"],
  ["gaps", "Gaps"],
  ["manager_history_changes", "Manager changes"],
  ["excluded_products", "Excluded"],
  ["sources", "Sources"],
  ["data_dictionary", "Dictionary"],
];
const LIMIT = 50;
const label = (c: string) => c.replace(/_/g, " ");
const isUrl = (v: string) => /^https?:\/\//.test(v);

function KV({ row }: { row: MfRefRow }) {
  return (
    <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1 text-[12px]">
      {Object.entries(row).filter(([, v]) => v).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-[#706E6B] dark:text-[#A8B4C4] capitalize">{label(k)}</dt>
          <dd className="break-words">
            {isUrl(v as string) ? <a className="text-[#0176D3] dark:text-[#1B96FF] underline" href={(v as string).split(" | ")[0]} target="_blank" rel="noreferrer">{v}</a> : v}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-4">
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#0176D3] dark:text-[#1B96FF] mb-1.5">{title}</h3>
    {children}
  </section>
);

function Detail({ table, row, onClose }: { table: string; row: MfRefRow; onClose: () => void }) {
  const [scheme, setScheme] = useState<MfRefSchemeDetail | null>(null);
  const [mgr, setMgr] = useState<MfRefManagerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setScheme(null); setMgr(null); setErr(null);
    const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "Failed to load");
    if (table === "scheme_master" && row.amfi_scheme_code) getMfRefScheme(row.amfi_scheme_code).then(setScheme).catch(fail);
    if (table === "fund_manager_master" && row.manager_id) getMfRefManager(row.manager_id).then(setMgr).catch(fail);
  }, [table, row]);
  return (
    <aside className="terminal-panel p-3 lg:w-[420px] shrink-0 max-h-[75vh] overflow-y-auto">
      <div className="flex justify-between items-start mb-3">
        <h2 className="text-[14px] font-medium">{row.scheme_name || row.full_name || row.amc_name || row.benchmark_name_tri || "Record"}</h2>
        <button className="terminal-btn text-[11px] px-2 py-0.5" onClick={onClose}>Close</button>
      </div>
      {err && <p className="text-[12px] text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
      {scheme ? (
        <>
          <Sec title="Scheme"><KV row={scheme.scheme} /></Sec>
          {scheme.amc && <Sec title="AMC"><KV row={scheme.amc} /></Sec>}
          {scheme.managers.length > 0 && (
            <Sec title="Fund managers">
              {scheme.managers.map((m, i) => <div key={i} className="mb-2"><KV row={{ full_name: m.full_name, designation: m.designation, role: m.role_as_stated, since: m.start_date_as_stated }} /></div>)}
            </Sec>
          )}
          {scheme.benchmarks.map((b, i) => <Sec key={i} title="Benchmark"><KV row={b} /></Sec>)}
          {scheme.category && <Sec title="SEBI category definition"><KV row={scheme.category} /></Sec>}
          {scheme.manager_changes.length > 0 && <Sec title="Manager changes">{scheme.manager_changes.map((c, i) => <KV key={i} row={c} />)}</Sec>}
          {scheme.provenance.length > 0 && <Sec title="Field provenance">{scheme.provenance.map((p, i) => <div key={i} className="mb-2"><KV row={p} /></div>)}</Sec>}
        </>
      ) : mgr ? (
        <>
          <Sec title="Manager"><KV row={mgr.manager} /></Sec>
          <Sec title={`Schemes (${mgr.schemes.length})`}>
            {mgr.schemes.map((s, i) => <div key={i} className="text-[12px] py-0.5 border-b border-[#E5E5E5] dark:border-[#2B3644]">{s.scheme_name} <span className="text-[#706E6B] dark:text-[#A8B4C4]">· {s.plan} · {s.amfi_scheme_code}</span></div>)}
          </Sec>
        </>
      ) : (table === "scheme_master" || table === "fund_manager_master") && !err ? (
        <p className="text-[12px]">Loading…</p>
      ) : (
        <KV row={row} />
      )}
    </aside>
  );
}

export default function MfReferencePage() {
  const [sum, setSum] = useState<MfRefSummary | null>(null);
  const [table, setTable] = useState("scheme_master");
  const [q, setQ] = useState("");
  const [amc, setAmc] = useState("");
  const [cat, setCat] = useState("");
  const [plan, setPlan] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ col: string; order: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState<MfRefPage | null>(null);
  const [sel, setSel] = useState<MfRefRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getMfRefSummary().then(setSum).catch((e) => setErr(e.message)); }, []);

  const isScheme = table === "scheme_master";
  const params = {
    q, sort: sort?.col, order: sort?.order, limit: LIMIT, offset,
    amc_id: isScheme || table === "fund_manager_master" ? amc : "",
    sebi_category: isScheme ? cat : "", plan: isScheme ? plan : "",
  };
  const key = JSON.stringify([table, params]);
  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => {
      getMfRefTable(table, params, ac.signal).then((p) => { setPage(p); setErr(null); })
        .catch((e) => { if (e.name !== "AbortError") setErr(e.message); });
    }, 200);
    return () => { clearTimeout(t); ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pick = (t: string) => { setTable(t); setQ(""); setOffset(0); setSort(null); setSel(null); setPage(null); };
  const input = "terminal-input text-[12px] py-1 px-2";
  const cols = (page?.columns ?? []).filter((c) => !["source_url", "notes", "as_of_date", "description"].includes(c) || table === "gaps" || table === "data_dictionary").slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="pb-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <h1 className="text-[20px] font-medium tracking-tight">MF reference data</h1>
        <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4] mt-0.5">
          AMFI / SEBI static snapshot (15 Oct 2026). Blank means unverified, never estimated. Scheme AUM repeats across plans: do not sum.
        </p>
      </div>
      {sum && !sum.loaded && <p className="text-[13px]">Reference tables not loaded. Run <code>python -m app.backoffice.mf_reference</code>.</p>}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([t, l]) => (
          <button key={t} onClick={() => pick(t)} className={`terminal-btn text-[12px] py-1 px-2.5 ${table === t ? "ring-1 ring-[#0176D3]" : ""}`}>
            {l}{sum?.tables[t] !== undefined ? ` (${sum.tables[t].toLocaleString("en-IN")})` : ""}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input className={`${input} w-64`} placeholder="Search name, ISIN, code…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        {(isScheme || table === "fund_manager_master") && (
          <select className={input} value={amc} onChange={(e) => { setAmc(e.target.value); setOffset(0); }}>
            <option value="">All AMCs</option>
            {sum?.amcs?.map((a) => <option key={a.amc_id} value={a.amc_id}>{a.amc_name}</option>)}
          </select>
        )}
        {isScheme && (
          <>
            <select className={input} value={cat} onChange={(e) => { setCat(e.target.value); setOffset(0); }}>
              <option value="">All categories</option>
              {sum?.categories?.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className={input} value={plan} onChange={(e) => { setPlan(e.target.value); setOffset(0); }}>
              <option value="">All plans</option>
              {sum?.plans?.map((c) => <option key={c}>{c}</option>)}
            </select>
          </>
        )}
        <a className="terminal-btn text-[12px] py-1 px-2.5 ml-auto" href={mfRefCsvUrl(table, { q, sort: sort?.col, order: sort?.order, amc_id: params.amc_id, sebi_category: params.sebi_category, plan: params.plan })}>Export CSV</a>
      </div>
      {err && <p className="text-[12px] text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
      <div className="flex flex-col lg:flex-row gap-3 items-start">
        <div className="terminal-panel flex-1 min-w-0 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c} className="text-left whitespace-nowrap cursor-pointer capitalize p-1.5"
                    onClick={() => { setSort({ col: c, order: sort?.col === c && sort.order === "asc" ? "desc" : "asc" }); setOffset(0); }}>
                    {label(c)}{sort?.col === c ? (sort.order === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page?.rows.map((r, i) => (
                <tr key={i} className="cursor-pointer hover:bg-[#F3F3F3] dark:hover:bg-[#171E27]" onClick={() => setSel(r)}>
                  {cols.map((c) => <td key={c} className="p-1.5 max-w-[260px] truncate" title={r[c] ?? ""}>{r[c] ?? "—"}</td>)}
                </tr>
              ))}
              {page && page.rows.length === 0 && <tr><td className="p-3" colSpan={cols.length || 1}>No rows.</td></tr>}
            </tbody>
          </table>
          <div className="flex items-center justify-between p-2 text-[12px]">
            <span>{page ? `${Math.min(offset + 1, page.total)}–${Math.min(offset + LIMIT, page.total)} of ${page.total.toLocaleString("en-IN")}` : "Loading…"}</span>
            <span className="flex gap-1.5">
              <button className="terminal-btn px-2 py-0.5" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Prev</button>
              <button className="terminal-btn px-2 py-0.5" disabled={!page || offset + LIMIT >= page.total} onClick={() => setOffset(offset + LIMIT)}>Next</button>
            </span>
          </div>
        </div>
        {sel && <Detail table={table} row={sel} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}
