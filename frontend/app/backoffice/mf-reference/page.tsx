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
const ACRONYMS: Record<string, string> = {
  url: "URL", tri: "TRI", aum: "AUM", ter: "TER", isin: "ISIN", amc: "AMC", amfi: "AMFI", sebi: "SEBI", ssd: "SSD",
  id: "ID", cio: "CIO", ceo: "CEO", inr: "INR", pct: "%", nav: "NAV", idcw: "IDCW", sid: "SID", fof: "FoF",
};
const label = (c: string) =>
  c.split("_").map((w, i) => ACRONYMS[w] ?? (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
const isUrl = (v: string) => /^https?:\/\//.test(v);
const MONEY = /(aum|crore)/;
const META = new Set(["source_url", "as_of_date", "notes", "record_number", "field_group", "match_method", "verification_level"]);
const link = "text-[#0176D3] dark:text-[#1B96FF] hover:underline text-left";

function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + (x.pathname.length > 1 ? x.pathname.replace(/\/$/, "").slice(0, 28) + (x.pathname.length > 29 ? "…" : "") : "");
  } catch {
    return u;
  }
}

function Val({ k, v }: { k: string; v: string }) {
  const parts = v.split(/ ?[;|] ?/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => isUrl(p))) {
    return <span className="flex flex-col gap-0.5">{parts.map((u) => <a key={u} className={link} href={u} target="_blank" rel="noreferrer" title={u}>{shortUrl(u)}</a>)}</span>;
  }
  if (isUrl(v)) return <a className={link} href={v} target="_blank" rel="noreferrer" title={v}>{shortUrl(v)}</a>;
  if (parts.length > 3 && parts.every((p) => p.length <= 14)) return <Chips items={parts} />; // code lists, e.g. scheme codes
  if (MONEY.test(k) && /^-?\d+(\.\d+)?$/.test(v)) return <span className="tabular-nums">{Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>;
  return <>{v}</>;
}

function Chips({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 12);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((c, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-[#F3F3F3] dark:bg-[#171E27] border border-[#E5E5E5] dark:border-[#2B3644] text-[11px] tabular-nums">{c}</span>)}
      {items.length > 12 && <button type="button" className={`${link} text-[11px]`} onClick={() => setAll(!all)}>{all ? "Show less" : `+${items.length - 12} more`}</button>}
    </span>
  );
}

function Rows({ row }: { row: MfRefRow }) {
  return (
    <div className="divide-y divide-[#EEEEEE] dark:divide-[#222C39]">
      {Object.entries(row).filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[#706E6B] dark:text-[#A8B4C4]">{label(k)}</div>
          <div className="text-[13px] leading-snug break-words mt-0.5"><Val k={k} v={v as string} /></div>
        </div>
      ))}
    </div>
  );
}

/** Facts first; source / notes / timestamps tucked into a collapsible block. */
function KV({ row }: { row: MfRefRow }) {
  const main: MfRefRow = {}, meta: MfRefRow = {};
  Object.entries(row).forEach(([k, v]) => ((META.has(k) ? meta : main)[k] = v));
  const hasMeta = Object.values(meta).some(Boolean);
  return (
    <>
      <Rows row={main} />
      {hasMeta && (
        <details className="mt-1.5 text-[12px]">
          <summary className="cursor-pointer text-[#706E6B] dark:text-[#A8B4C4] select-none py-1">Source &amp; notes</summary>
          <Rows row={meta} />
        </details>
      )}
    </>
  );
}

const Sec = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-5 last:mb-0">
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#0176D3] dark:text-[#1B96FF] pb-1.5 mb-1 border-b border-[#E5E5E5] dark:border-[#2B3644]">{title}</h3>
    {children}
  </section>
);

type Ref = { t: "scheme" | "manager"; id: string };

function Detail({ table, row, onClose }: { table: string; row: MfRefRow; onClose: () => void }) {
  // Navigation stack: clicking a scheme or manager inside the panel drills in; Back pops.
  const [stack, setStack] = useState<Ref[]>([]);
  const [scheme, setScheme] = useState<MfRefSchemeDetail | null>(null);
  const [mgr, setMgr] = useState<MfRefManagerDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (table === "scheme_master" && row.amfi_scheme_code) setStack([{ t: "scheme", id: row.amfi_scheme_code }]);
    else if (table === "fund_manager_master" && row.manager_id) setStack([{ t: "manager", id: row.manager_id }]);
    else setStack([]);
  }, [table, row]);
  const cur = stack[stack.length - 1];
  useEffect(() => {
    setScheme(null); setMgr(null); setErr(null);
    if (!cur) return;
    const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "Failed to load");
    if (cur.t === "scheme") getMfRefScheme(cur.id).then(setScheme).catch(fail);
    else getMfRefManager(cur.id).then(setMgr).catch(fail);
  }, [cur?.t, cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (r: Ref) => setStack((s) => [...s, r]);
  const title = scheme?.scheme.scheme_name || mgr?.manager.full_name || row.scheme_name || row.full_name || row.amc_name || row.benchmark_name_tri || "Record";
  return (
    <aside className="terminal-panel p-4 lg:w-[440px] w-full shrink-0 max-h-[78vh] overflow-y-auto">
      <div className="flex justify-between items-start mb-4 pb-3 gap-3 border-b border-[#E5E5E5] dark:border-[#2B3644]">
        <h2 className="text-[15px] font-medium leading-snug">{title}</h2>
        <span className="flex gap-1.5 shrink-0">
          {stack.length > 1 && <button className="terminal-btn text-[11px] px-2 py-0.5" onClick={() => setStack((s) => s.slice(0, -1))}>Back</button>}
          <button className="terminal-btn text-[11px] px-2 py-0.5" onClick={onClose}>Close</button>
        </span>
      </div>
      {err && <p className="text-[12px] text-[#B42332] dark:text-[#FF7D86]">{err}</p>}
      {scheme ? (
        <>
          <Sec title="Scheme"><KV row={scheme.scheme} /></Sec>
          {scheme.amc && <Sec title="AMC"><KV row={scheme.amc} /></Sec>}
          {scheme.managers.length > 0 && (
            <Sec title="Fund managers">
              {scheme.managers.map((m, i) => (
                <div key={i} className="mb-3 pb-2 border-b border-[#EEEEEE] dark:border-[#222C39] last:border-0">
                  {m.manager_id && m.full_name && <button className={`${link} text-[13px] font-medium mb-1`} onClick={() => go({ t: "manager", id: m.manager_id as string })}>{m.full_name}</button>}
                  <KV row={{ designation: m.designation, role: m.role_as_stated, since: m.start_date_as_stated }} />
                </div>
              ))}
            </Sec>
          )}
          {scheme.benchmarks.map((b, i) => <Sec key={i} title="Benchmark"><KV row={b} /></Sec>)}
          {scheme.category && <Sec title="SEBI category definition"><KV row={scheme.category} /></Sec>}
          {scheme.manager_changes.length > 0 && <Sec title="Manager changes">{scheme.manager_changes.map((c, i) => <KV key={i} row={c} />)}</Sec>}
          {scheme.provenance.length > 0 && <Sec title="Field provenance">{scheme.provenance.map((p, i) => <div key={i} className="mb-3 pb-2 border-b border-[#EEEEEE] dark:border-[#222C39] last:border-0"><KV row={p} /></div>)}</Sec>}
        </>
      ) : mgr ? (
        <>
          <Sec title="Manager"><KV row={mgr.manager} /></Sec>
          <Sec title={`Schemes (${mgr.schemes.length})`}>
            {mgr.schemes.map((s, i) => (
              <button key={i} className={`${link} block w-full text-[13px] py-2 border-b border-[#EEEEEE] dark:border-[#222C39] last:border-0`} onClick={() => go({ t: "scheme", id: s.amfi_scheme_code as string })}>
                {s.scheme_name} <span className="text-[#706E6B] dark:text-[#A8B4C4]">· {s.plan} · {s.amfi_scheme_code}</span>
              </button>
            ))}
          </Sec>
        </>
      ) : cur && !err ? (
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
