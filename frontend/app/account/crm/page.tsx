"use client";

import React, { useEffect, useState } from "react";
import { getMyCrm, type MyCrm } from "@/lib/api";
import { useAuth } from "@/components/AuthContext";

const inr = (paise?: number | null) =>
  typeof paise === "number" && !isNaN(paise)
    ? `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
    : "₹0";

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="terminal-panel p-4 space-y-2">
      <h2 className="text-[14px] font-medium text-[#172033] dark:text-[#EDF2F7]">{title}</h2>
      {empty ? <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4]">Nothing here yet.</p> : children}
    </section>
  );
}

export default function MyCrmPage() {
  const { customer, loading: authLoading } = useAuth();
  const [d, setD] = useState<MyCrm | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !customer) return;
    getMyCrm()
      .then((res) => setD(res ?? { households: [], holdings: [], sips: [], cases: [] }))
      .catch(() => setErr("Could not load your records."));
  }, [authLoading, customer]);

  if (authLoading || (!customer && !err)) {
    return <main className="max-w-4xl mx-auto px-4 py-6 text-[13px]">Loading…</main>;
  }

  if (err) return <main className="max-w-4xl mx-auto px-4 py-6 text-[13px] text-[#B42332]">{err}</main>;
  if (!d) return <main className="max-w-4xl mx-auto px-4 py-6 text-[13px]">Loading…</main>;

  const households = Array.isArray(d?.households) ? d.households : [];
  const holdings = Array.isArray(d?.holdings) ? d.holdings : [];
  const sips = Array.isArray(d?.sips) ? d.sips : [];
  const cases = Array.isArray(d?.cases) ? d.cases : [];

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7]">My records</h1>
      <Section title="Household and relationship manager" empty={households.length === 0}>
        {households.map((h) => (
          <p key={h.id} className="text-[13px]">{h.name}{h.rm_name ? ` · Relationship manager: ${h.rm_name}` : ""}</p>
        ))}
      </Section>
      <Section title="Holdings" empty={holdings.length === 0}>
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[#536176]"><th>Scheme</th><th>Folio</th><th>Units</th><th>Cost</th></tr></thead>
          <tbody>{holdings.map((h, i) => (
            <tr key={i}><td>{h.scheme_name}</td><td>{h.folio}</td><td>{h.units}</td><td>{inr(h.cost_paise)}</td></tr>
          ))}</tbody>
        </table>
      </Section>
      <Section title="SIPs" empty={sips.length === 0}>
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[#536176]"><th>Scheme</th><th>Type</th><th>Amount</th><th>Day</th><th>Status</th></tr></thead>
          <tbody>{sips.map((s, i) => (
            <tr key={i}><td>{s.scheme_name}</td><td>{s.type}</td><td>{inr(s.amount_paise)}</td><td>{s.day}</td><td>{s.status}</td></tr>
          ))}</tbody>
        </table>
      </Section>
      <Section title="Service requests" empty={cases.length === 0}>
        <ul className="text-[13px] space-y-1">{cases.map((c, i) => <li key={i}>{c.subject} · {c.status}</li>)}</ul>
      </Section>
    </main>
  );
}
