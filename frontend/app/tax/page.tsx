"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.
// TODO(owner-ca-review): confirm calculator wording with a chartered accountant.

import Link from "next/link";
import { useState } from "react";
import { NumberField, SelectField } from "@/components/Field";
import { RegimeColumn } from "@/components/TaxSection";
import { ApiError, calcTax } from "@/lib/api";
import { inr, pct } from "@/lib/format";
import type { TaxCalcResult, TaxProfileInput } from "@/lib/types";

const FIELDS: [keyof TaxProfileInput, string, string?][] = [
  ["ded_80c_used", "Section 80C used so far", "EPF, PPF, ELSS, life insurance, tuition"],
  ["nps_self_annual", "Your own NPS contribution"],
  ["health_premium_self", "Health premium: you and family"],
  ["health_premium_parents", "Health premium: parents"],
  ["home_loan_interest", "Home loan interest (self-occupied)"],
  ["fd_interest_annual", "FD and savings interest"],
  ["hra_received", "HRA received (yearly)"],
  ["rent_paid_monthly", "Rent paid (monthly)"],
];

export default function TaxCalculator() {
  const [age, setAge] = useState("35");
  const [job, setJob] = useState("salaried_private");
  const [gross, setGross] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [result, setResult] = useState<TaxCalcResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (gross === "" || Number(age) < 18) {
      setError("Enter your age and your yearly income before tax.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const n = (k: string) => Number(vals[k] || 0);
      const tax: TaxProfileInput = {
        mode: "detailed", regime_current: "unsure", gross_income_annual: Number(gross),
        ded_80c_used: n("ded_80c_used"), nps_self_annual: n("nps_self_annual"),
        health_premium_self: n("health_premium_self"), health_premium_parents: n("health_premium_parents"),
        home_loan_interest: n("home_loan_interest"), fd_interest_annual: n("fd_interest_annual"),
        hra_received: n("hra_received"), rent_paid_monthly: n("rent_paid_monthly"), metro: true,
      };
      setResult(await calcTax({ age: Number(age), employment_type: job, tax }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not calculate. Is the API running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-950">Tax calculator</h1>
        <p className="mt-1 text-slate-600">Compare the old and new regimes for FY 2026-27 and see saving ideas. Nothing is saved.</p>
      </header>

      <div className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField id="age" label="Age" value={age} onChange={setAge} />
          <SelectField id="job" label="Source of income" value={job} onChange={setJob}
            options={[{ value: "salaried_private", label: "Salaried, private" }, { value: "govt_psu", label: "Government / PSU" },
              { value: "business_professional", label: "Business or professional" }, { value: "freelance_variable", label: "Freelance" },
              { value: "retired_none", label: "Retired (pension)" }]} />
          <NumberField id="gross" money label="Yearly income before tax" value={gross} onChange={setGross} />
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-teal-800">Deductions and other details (optional)</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {FIELDS.map(([k, label, help]) => (
              <NumberField key={k} id={`f-${k}`} money label={label} help={help} value={vals[k] ?? ""}
                onChange={(v) => setVals((s) => ({ ...s, [k]: v }))} />
            ))}
          </div>
        </details>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="button" className="btn-accent" onClick={run} disabled={busy}>{busy ? "Calculating…" : "Compare regimes"}</button>
      </div>

      {result && result.regimes && (
        <div className="space-y-5" aria-live="polite">
          <p className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-900" role="note">{result.disclosure}</p>
          <div className="card">
            <h2 className="text-xl font-bold">
              The {result.regimes.better} regime costs about {inr(result.regimes.saving)} less
            </h2>
            <p className="mb-4 text-sm text-slate-600">Your marginal rate is about {pct(result.marginal_rate ?? 0)} (slab rate with cess).</p>
            <div className="grid gap-4 md:grid-cols-2">
              <RegimeColumn r={result.regimes.old} inForce={result.regime_in_force === "old"} better={result.regimes.better === "old"} />
              <RegimeColumn r={result.regimes.new} inForce={result.regime_in_force === "new"} better={result.regimes.better === "new"} />
            </div>
          </div>

          {(result.nudges ?? []).length > 0 && (
            <div>
              <h2 className="mb-2 text-xl font-bold">Saving ideas</h2>
              <ul className="space-y-3">
                {(result.nudges ?? []).map((n) => (
                  <li key={n.id} className="card">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-bold text-navy-950">{n.title}</h3>
                      {n.est_saving_year != null && <span className="font-extrabold text-teal-700">up to {inr(n.est_saving_year)}</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{n.summary}</p>
                    {(n.catalog_links ?? []).length > 0 && (
                      <p className="mt-2 text-sm">
                        {(n.catalog_links ?? []).slice(0, 3).map((c) => (
                          <Link key={c.id} href={`/learn/${c.id}`} className="mr-3 font-semibold text-teal-800 underline">Learn: {c.name}</Link>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card overflow-x-auto">
            <h2 className="mb-1 text-xl font-bold">What tax does to returns</h2>
            <p className="mb-2 text-sm text-slate-600">Planning return before tax and after tax at your rate, by how long you hold.</p>
            <table className="w-full min-w-[480px] text-left">
              <thead><tr><th className="th">Held for</th><th className="th">Equity</th><th className="th">Debt</th><th className="th">Gold</th><th className="th">Liquid</th></tr></thead>
              <tbody>
                <tr className="border-t border-navy-100 bg-navy-50/50">
                  <td className="td font-medium">Before tax</td>
                  {(["equity", "debt", "gold", "liquid"] as const).map((k) => <td key={k} className="td">{pct(result.pre_tax_returns[k])}</td>)}
                </tr>
                {result.after_tax_returns.map((r) => (
                  <tr key={r.years} className="border-t border-navy-100">
                    <td className="td font-medium">After tax, {r.years} yr</td>
                    {(["equity", "debt", "gold", "liquid"] as const).map((k) => <td key={k} className="td">{pct(r[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            Want this inside a full plan with goals and SIPs? <Link href="/plan/new" className="font-semibold text-teal-800 underline">Start a plan</Link>
            {" · "}<Link href="/learn" className="font-semibold text-teal-800 underline">Explore every option</Link>
          </p>
        </div>
      )}
    </div>
  );
}
