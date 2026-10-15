"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import Link from "next/link";
import Breadcrumb from "@/components/Breadcrumb";
import { useEffect, useState } from "react";
import { getTaxCatalog, getTaxInstrument } from "@/lib/api";
import type { CatalogInstrument } from "@/lib/types";

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-navy-100 py-3 md:grid md:grid-cols-[220px_1fr] md:gap-4">
      <dt className="text-sm font-bold uppercase tracking-wide text-teal-800">{k}</dt>
      <dd className="text-slate-800">{v}</dd>
    </div>
  );
}

export default function InstrumentPage({ params }: { params: { id: string } }) {
  const [item, setItem] = useState<CatalogInstrument | null>(null);
  const [fy, setFy] = useState("");
  const [note, setNote] = useState("");
  const [related, setRelated] = useState<CatalogInstrument[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getTaxInstrument(params.id)
      .then((r) => {
        setItem(r.instrument);
        setFy(r.fy);
        setNote(r.disclosure);
        return getTaxCatalog({ kind: r.instrument.kind });
      })
      .then((c) => setRelated(c.instruments.filter((i) => i.id !== params.id).slice(0, 4)))
      .catch(() => setError("We could not find that option."));
  }, [params.id]);

  if (error) {
    return (
      <div className="card" role="alert">
        <p className="font-semibold">{error}</p>
        <Link href="/learn" className="btn-primary mt-4">See all options</Link>
      </div>
    );
  }
  if (!item) return <p role="status">Loading…</p>;

  return (
    <article className="w-full space-y-6">
      <Breadcrumb items={[{ label: "All options", href: "/learn" }, { label: item.name }]} />
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-950">{item.name}</h1>
        <p className="mt-2 text-lg text-slate-700">{item.summary}</p>
      </header>
      <p className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-900" role="note">{note}</p>

      <dl className="card">
        <Row k="Who it suits" v={item.who_for} />
        <Row k="Lock-in" v={item.lock_in} />
        <Row k="Risk" v={item.risk} />
        <Row k="Access to money" v={item.liquidity} />
        <Row k="Return" v={item.return_note} />
      </dl>

      <section aria-labelledby="tax-h">
        <h2 id="tax-h" className="mb-2 text-xl font-bold">How it is taxed (FY {fy})</h2>
        <p className="mb-2 inline-block rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{item.tax_label}</p>
        <dl className="card">
          <Row k="When you put money in" v={item.tax_in} />
          <Row k="While it grows" v={item.tax_on_growth} />
          <Row k="When you take it out" v={item.tax_on_exit} />
        </dl>
      </section>

      <section aria-labelledby="watch-h">
        <h2 id="watch-h" className="mb-2 text-xl font-bold">Watch out for</h2>
        <ul className="card list-disc space-y-1 pl-9 text-slate-800">{item.watch_outs.map((w) => <li key={w}>{w}</li>)}</ul>
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/plan/new" className="btn-primary">See how it fits my goals</Link>
        <Link href="/tax" className="btn-secondary">Check my tax</Link>
      </section>

      {related.length > 0 && (
        <section aria-labelledby="rel-h">
          <h2 id="rel-h" className="mb-2 text-xl font-bold">Related options</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {related.map((r) => (
              <li key={r.id}><Link href={`/learn/${r.id}`} className="card block font-semibold text-navy-950 hover:border-teal-500/60">{r.name}</Link></li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
