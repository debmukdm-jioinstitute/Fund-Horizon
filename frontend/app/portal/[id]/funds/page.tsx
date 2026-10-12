// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AmcName } from "@/components/BrandLogo";
import { API_URL, compareFunds } from "@/lib/api";
import type { CompareResponse } from "@/lib/types";
import { CATEGORY_LABELS, pct } from "@/lib/format";

const CATEGORIES = Object.keys(CATEGORY_LABELS);
const MAX_COMPARE = 4;

interface RankingItem {
  scheme_code: string;
  scheme_name: string;
  amc: string;
  category: string;
  score: number;
  rank: number;
  metrics?: Record<string, number | null>;
}

interface RankingResponse {
  category: string;
  total_schemes: number;
  rankings: RankingItem[];
  disclaimer: string;
}

function metric(r: RankingItem, key: string): number | null {
  const v = r.metrics?.[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/* ---------------- Explore tab ---------------- */

function ExploreTab({ id, selected, toggleSelect }: {
  id: string;
  selected: string[];
  toggleSelect: (code: string) => void;
}) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/categories/${encodeURIComponent(category)}/ranking`)
      .then((res) => {
        if (!res.ok) throw new Error(`Ranking request failed (${res.status})`);
        return res.json() as Promise<RankingResponse>;
      })
      .then((json) => { if (!cancelled) setData(json); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.rankings ?? [];
    if (!q) return list;
    return list.filter((r) =>
      (r.scheme_name ?? "").toLowerCase().includes(q) ||
      (r.amc ?? "").toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-navy-700">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-950 focus:border-teal-600 focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
              ))}
            </select>
          </label>
          <label className="flex-1">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-navy-700">Search schemes</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Scheme or AMC name"
              className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-950 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-navy-700">
            {data ? `${rows.length} of ${data.total_schemes} schemes` : "Loading ranking…"} · ranked by past-performance composite
          </p>
          <Link
            href={selected.length >= 2 ? `/portal/${id}/funds?tab=compare&codes=${selected.join(",")}` : "#"}
            aria-disabled={selected.length < 2}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${selected.length >= 2 ? "bg-teal-700 hover:bg-teal-800" : "pointer-events-none bg-navy-300"}`}
          >
            Compare selected ({selected.length})
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">{error}</div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <caption className="sr-only">Ranked schemes in {CATEGORY_LABELS[category] ?? category}</caption>
          <thead className="bg-navy-50 text-xs text-navy-700">
            <tr>
              <th scope="col" className="p-3">Compare</th>
              <th scope="col" className="p-3">#</th>
              <th scope="col" className="p-3">Scheme</th>
              <th scope="col" className="p-3">3Y CAGR</th>
              <th scope="col" className="p-3">5Y CAGR</th>
              <th scope="col" className="p-3">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-navy-500">Loading ranking…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-xs text-navy-500">No schemes match.</td></tr>
            ) : rows.map((r) => {
              const checked = selected.includes(r.scheme_code);
              return (
                <tr key={r.scheme_code} className={checked ? "bg-teal-50" : undefined}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(r.scheme_code)}
                      aria-label={`Select ${r.scheme_name} for comparison`}
                      className="h-4 w-4 accent-teal-700"
                    />
                  </td>
                  <td className="p-3 text-xs font-bold text-navy-700">{r.rank ?? "–"}</td>
                  <td className="p-3">
                    <div className="text-xs font-semibold text-navy-950">{r.scheme_name ?? r.scheme_code}</div>
                    <div className="mt-0.5 text-[11px] text-navy-500"><AmcName amc={r.amc ?? ""} /> · {r.scheme_code}</div>
                  </td>
                  <td className="p-3 text-xs text-navy-900">{pct(metric(r, "cagr_3y"))}</td>
                  <td className="p-3 text-xs text-navy-900">{pct(metric(r, "cagr_5y"))}</td>
                  <td className="p-3 text-xs font-semibold text-navy-900">{typeof r.score === "number" ? r.score.toFixed(3) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data?.disclaimer && (
        <p className="rounded-lg bg-navy-50 p-3 text-[11px] text-navy-700">{data.disclaimer}</p>
      )}
    </div>
  );
}

/* ---------------- Compare tab ---------------- */

function CompareTab({ id, codes, setCodes }: {
  id: string;
  codes: string[];
  setCodes: (codes: string[]) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    if (codes.length < 2) { setData(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    compareFunds(codes.slice(0, MAX_COMPARE))
      .then((json) => { if (!cancelled) setData(json); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [codes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const funds = useMemo(() => data?.funds ?? [], [data]);

  // Marked pick: highest 3Y Sharpe ratio in this set (fallback: highest 3Y CAGR).
  const pickCode = useMemo(() => {
    if (!funds.length) return null;
    const withSharpe = funds.filter((f) => typeof f.sharpe_3y === "number");
    const pool = withSharpe.length ? withSharpe : funds.filter((f) => typeof f.cagr_3y === "number");
    if (!pool.length) return null;
    const key = withSharpe.length ? "sharpe_3y" : "cagr_3y";
    return pool.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a)).scheme_code;
  }, [funds]);

  const syncUrl = (next: string[]) => {
    router.push(`/portal/${id}/funds?tab=compare${next.length ? `&codes=${next.join(",")}` : ""}`);
  };

  const addManual = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manual.trim();
    if (!code) return;
    if (codes.includes(code)) { setError("Scheme is already included in this comparison."); return; }
    if (codes.length >= MAX_COMPARE) { setError(`A maximum of ${MAX_COMPARE} schemes can be compared here.`); return; }
    setCodes([...codes, code]);
    syncUrl([...codes, code]);
    setManual("");
    setError(null);
  };

  const remove = (code: string) => {
    const next = codes.filter((c) => c !== code);
    setCodes(next);
    syncUrl(next);
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-navy-950">Compare schemes</h2>
          <p className="text-xs text-navy-700">
            {codes.length === 0
              ? "Enter 2 to 4 scheme codes to compare side-by-side."
              : `Comparing ${codes.length} of max ${MAX_COMPARE} scheme(s).`}
          </p>
        </div>
        <form onSubmit={addManual} className="flex gap-2">
          <input
            type="text"
            value={manual}
            onChange={(e) => { setManual(e.target.value); setError(null); }}
            placeholder="Scheme code (e.g. 120503)"
            className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs text-navy-950 focus:border-teal-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={codes.length >= MAX_COMPARE}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">{error}</div>
      )}

      {codes.length < 2 ? (
        <div className="card" data-testid="compare-empty">
          <h2 className="text-base font-bold text-navy-950">Need two schemes to compare</h2>
          <p className="mt-1 text-sm text-navy-700">
            Add scheme codes above, or pick schemes from the{" "}
            <Link href={`/portal/${id}/funds?tab=explore`} className="font-semibold text-teal-700 hover:underline">
              Explore tab
            </Link>
            .
          </p>
        </div>
      ) : loading ? (
        <div className="card p-6 text-center text-xs text-navy-500">Loading comparison…</div>
      ) : data && funds.length >= 2 ? (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Side-by-side scheme comparison</caption>
              <thead className="bg-navy-50 text-xs text-navy-700">
                <tr>
                  <th scope="col" className="p-3">Metric</th>
                  {funds.map((f) => (
                    <th key={f.scheme_code} scope="col" className="p-3 font-semibold text-navy-950">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="max-w-[160px] truncate" title={f.scheme_name}>{f.scheme_name}</div>
                          <div className="mt-0.5 text-xs font-normal text-navy-500">Code: {f.scheme_code}</div>
                          {f.scheme_code === pickCode && (
                            <span className="mt-1 inline-block rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              Marked pick
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(f.scheme_code)}
                          className="rounded p-1 text-xs text-navy-400 hover:bg-navy-200 hover:text-rose-700"
                          aria-label={`Remove ${f.scheme_name}`}
                        >
                          ✕
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {(
                  [
                    ["Category", (f: (typeof funds)[number]) => (CATEGORY_LABELS[f.category] ?? f.category ?? "–")],
                    ["AMC", (f: (typeof funds)[number]) => (f.amc ?? "–")],
                    ["3Y CAGR", (f: (typeof funds)[number]) => pct(f.cagr_3y)],
                    ["5Y CAGR", (f: (typeof funds)[number]) => pct(f.cagr_5y)],
                    ["3Y Volatility", (f: (typeof funds)[number]) => pct(f.vol_3y)],
                    ["3Y Sharpe", (f: (typeof funds)[number]) => (typeof f.sharpe_3y === "number" ? f.sharpe_3y.toFixed(2) : "–")],
                    ["3Y Max drawdown", (f: (typeof funds)[number]) => pct(f.max_drawdown_3y)],
                  ] as const
                ).map(([label, fmt]) => (
                  <tr key={label}>
                    <td className="p-3 font-medium text-navy-700">{label}</td>
                    {funds.map((f) => (
                      <td key={f.scheme_code} className="p-3 text-xs text-navy-900">{fmt(f)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-navy-500">
            Marked pick = the scheme with the highest 3Y Sharpe ratio in this set (falls back to highest 3Y CAGR when Sharpe is unavailable).
          </p>
          <footer className="card bg-navy-50 text-xs text-navy-700 space-y-2">
            <p className="font-semibold text-navy-900">Important Disclosures</p>
            <p>{data?.disclaimer}</p>
            <p>Mutual fund investments are subject to market risks; read all scheme related documents carefully.</p>
          </footer>
        </>
      ) : (
        <div className="card p-6 text-center text-xs text-navy-500">No comparison data available.</div>
      )}
    </div>
  );
}

/* ---------------- Page ---------------- */

function FundsInner({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "compare" ? "compare" : "explore";
  const [selected, setSelected] = useState<string[]>([]);
  const [codes, setCodes] = useState<string[]>(() =>
    (searchParams.get("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, MAX_COMPARE),
  );

  const toggleSelect = (code: string) => {
    setSelected((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, code],
    );
  };

  return (
    <main className="w-full space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-950">Explore & Compare Funds</h1>
        <Link href={`/plan/${id}`} className="text-xs font-semibold text-teal-700 hover:underline">
          ← Back to plan
        </Link>
      </div>
      <nav className="flex gap-1 rounded-xl bg-navy-50 p-1" aria-label="Funds tabs">
        <Link
          href={`/portal/${id}/funds?tab=explore`}
          scroll={false}
          className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-semibold ${tab === "explore" ? "bg-white text-navy-950 shadow" : "text-navy-600 hover:text-navy-900"}`}
        >
          Explore
        </Link>
        <Link
          href={`/portal/${id}/funds?tab=compare${codes.length ? `&codes=${codes.join(",")}` : ""}`}
          scroll={false}
          className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-semibold ${tab === "compare" ? "bg-white text-navy-950 shadow" : "text-navy-600 hover:text-navy-900"}`}
        >
          Compare{codes.length > 0 ? ` (${codes.length})` : ""}
        </Link>
      </nav>
      {tab === "explore" ? (
        <ExploreTab id={id} selected={selected} toggleSelect={toggleSelect} />
      ) : (
        <CompareTab id={id} codes={codes} setCodes={setCodes} />
      )}
    </main>
  );
}

export default function PortalFundsPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<main className="w-full px-4 py-6"><div className="card p-6 text-center text-xs text-navy-500">Loading…</div></main>}>
      <FundsInner id={params.id} />
    </Suspense>
  );
}
