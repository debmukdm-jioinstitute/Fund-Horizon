"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getTaxCatalog } from "@/lib/api";
import type { CatalogInstrument, CatalogResponse } from "@/lib/types";

const BENEFIT: Record<string, string> = {
  old: "Deduction (old regime)", both: "Deduction (both regimes)", new: "Deduction (new regime)", none: "No deduction",
};

export default function LearnPage() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [benefitOnly, setBenefitOnly] = useState(false);
  const [maxLock, setMaxLock] = useState<"" | "short" | "long">("");

  useEffect(() => {
    getTaxCatalog().then(setData).catch(() => setError("Could not load the catalog. Is the API running?"));
  }, []);

  const items = useMemo<CatalogInstrument[]>(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.instruments.filter((i) => {
      if (kind && i.kind !== kind) return false;
      if (benefitOnly && i.regime_benefit === "none") return false;
      if (maxLock === "short" && i.min_horizon_years > 3) return false;
      if (maxLock === "long" && i.min_horizon_years < 8) return false;
      return !needle || `${i.name} ${i.summary} ${i.who_for}`.toLowerCase().includes(needle);
    });
  }, [data, q, kind, benefitOnly, maxLock]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-950">Savings and tax-saving options, explained</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          What each option is, who it suits, how long money stays locked, and how it is taxed in FY {data?.fy ?? "2026-27"}. Plain
          English, no product pitch.
        </p>
      </header>

      {data?.disclosure && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-900" role="note">{data.disclosure}</p>
      )}

      <div className="card grid gap-4 md:grid-cols-4">
        <div className="md:col-span-2">
          <label htmlFor="q" className="label">Search</label>
          <input id="q" className="input" value={q} placeholder="PPF, lock-in, senior, gold…" onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor="kind" className="label">Type</label>
          <select id="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(data?.kinds ?? {}).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lock" className="label">Money needed in</label>
          <select id="lock" className="input" value={maxLock} onChange={(e) => setMaxLock(e.target.value as typeof maxLock)}>
            <option value="">Any time</option>
            <option value="short">Within about 3 years</option>
            <option value="long">8 years or more</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium md:col-span-4">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={benefitOnly} onChange={(e) => setBenefitOnly(e.target.checked)} />
          Only show options that give a tax deduction
        </label>
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      {!data && !error && <p role="status">Loading…</p>}
      {data && <p className="text-sm text-slate-600" aria-live="polite">{items.length} of {data.instruments.length} options</p>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <Link key={i.id} href={`/learn/${i.id}`} className="card block transition hover:border-teal-500/60 hover:shadow-md" data-instrument={i.id}>
            <p className="text-xs font-bold uppercase tracking-wider text-teal-800">{data?.kinds[i.kind] ?? i.kind}</p>
            <h2 className="mt-1 text-lg font-bold text-navy-950">{i.name}</h2>
            <p className="mt-2 text-sm text-slate-700">{i.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-navy-50 px-2.5 py-1 font-semibold text-navy-800">Risk: {i.risk.split(" (")[0]}</span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">{i.lock_in.split(",")[0].split(";")[0]}</span>
              <span className="rounded-full bg-teal-50 px-2.5 py-1 font-semibold text-teal-800">{BENEFIT[i.regime_benefit]}</span>
            </div>
          </Link>
        ))}
      </div>
      {data && items.length === 0 && <p className="card text-sm">Nothing matches. Clear a filter to see more.</p>}
    </div>
  );
}
