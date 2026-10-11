"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.
// TODO(owner-ca-review): confirm the tax questions and help text with a chartered accountant.

import type { Ref } from "react";
import { NumberField, SelectField } from "@/components/Field";
import { BRACKETS, type Errors, type TaxDraft } from "@/lib/draft";
import type { TaxMode } from "@/lib/types";

type Patch = (p: Partial<TaxDraft>) => void;

function CheckField({ id, label, checked, onChange, help }: {
  id: string; label: string; checked: boolean; onChange: (v: boolean) => void; help?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-navy-950">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 rounded accent-teal-600" checked={checked}
        onChange={(e) => onChange(e.target.checked)} />
      <span><span className="font-medium">{label}</span>{help && <span className="block text-xs text-slate-600">{help}</span>}</span>
    </label>
  );
}

const MODES: { value: TaxMode; title: string; body: string }[] = [
  { value: "detailed", title: "Work it out for me", body: "Enter your yearly income. We compare the old and new regimes and find deductions you may be missing." },
  { value: "bracket_only", title: "I know my tax bracket", body: "Pick your highest slab rate. We estimate savings from that alone." },
  { value: "skip", title: "Skip tax for now", body: "The plan will not include tax features. You can add them by starting a new plan." },
];

export function TaxBasicsStep({ tax, patch, errors, monthlyIncome, scopeNote, headingRef }: {
  tax: TaxDraft; patch: Patch; errors: Errors; monthlyIncome: string; scopeNote?: string; headingRef: Ref<HTMLHeadingElement>;
}) {
  const guess = monthlyIncome ? Math.round((Number(monthlyIncome) * 12) / 0.85 / 1000) * 1000 : null;
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-2xl font-bold tracking-tight text-navy-950">Your tax picture</h1>
      <p className="mb-5 text-sm text-slate-600">
        Tax changes how much you keep and how much you must invest. These answers are optional and stay on your plan only.
        {scopeNote ? ` ${scopeNote}` : ""}
      </p>
      <fieldset className="mb-6">
        <legend className="label">How should we handle tax?</legend>
        <div className="space-y-2.5">
          {MODES.map((m) => (
            <label key={m.value}
              className={`flex cursor-pointer items-start gap-3.5 rounded-xl border p-3.5 transition-all ${tax.mode === m.value ? "border-teal-500 bg-teal-50/80 ring-2 ring-teal-500/20" : "border-slate-200/80 bg-white/50 hover:bg-white"}`}>
              <input type="radio" name="tax-mode" className="mt-1 h-4 w-4 accent-teal-600" checked={tax.mode === m.value}
                onChange={() => patch({ mode: m.value })} />
              <span><span className="block font-semibold text-navy-950">{m.title}</span><span className="text-sm text-slate-600">{m.body}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      {tax.mode !== "skip" && (
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField id="regime_current" label="Tax regime you use now" value={tax.regime_current}
            onChange={(v) => patch({ regime_current: v as TaxDraft["regime_current"] })}
            options={[{ value: "unsure", label: "Not sure" }, { value: "new", label: "New regime (default)" }, { value: "old", label: "Old regime" }]}
            help="Your payslip or employer's tax declaration shows this." />
          {tax.mode === "bracket_only" ? (
            <SelectField id="bracket_pct" label="Highest slab rate you pay" value={tax.bracket_pct}
              onChange={(v) => patch({ bracket_pct: v })} error={errors.bracket_pct}
              options={[{ value: "", label: "Choose…" }, ...BRACKETS.map((b) => ({ value: String(b), label: `${b}%` }))]}
              help="Before 4% cess. 30% applies above 24 lakh (new regime) or 10 lakh (old regime)." />
          ) : (
            <>
              <NumberField id="gross_income" money label="Yearly income before tax" value={tax.gross_income}
                onChange={(v) => patch({ gross_income: v })} error={errors.gross_income}
                help="Salary, business or pension, before deductions" />
              <NumberField id="other_income" money label="Other yearly income" value={tax.other_income}
                onChange={(v) => patch({ other_income: v })} help="Rent, dividends, anything else taxable. Leave blank if none." />
              {guess ? (
                <button type="button" className="btn-secondary self-start text-sm md:col-span-2"
                  onClick={() => patch({ gross_income: String(guess) })}>
                  Estimate from my take-home (about {guess.toLocaleString("en-IN")} a year)
                </button>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}

export function TaxDetailsStep({ tax, patch, errors, salaried, headingRef }: {
  tax: TaxDraft; patch: Patch; errors: Errors; salaried: boolean; headingRef: Ref<HTMLHeadingElement>;
}) {
  const detailed = tax.mode === "detailed";
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-2xl font-bold tracking-tight text-navy-950">Deductions, gains and preferences</h1>
      <p className="mb-5 text-sm text-slate-600">
        Fill what you know; leave the rest blank. The more you add, the more exact the tax comparison and the saving ideas.
        Rupee amounts are not kept in this browser if you refresh.
      </p>

      {detailed && salaried && (
        <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Salary details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <NumberField id="basic_annual" money label="Basic salary (yearly, with DA)" value={tax.basic_annual}
              onChange={(v) => patch({ basic_annual: v })} help="Blank assumes 40% of your income" />
            <NumberField id="employer_nps_pct" label="Employer NPS (% of basic)" value={tax.employer_nps_pct}
              onChange={(v) => patch({ employer_nps_pct: v })} error={errors.employer_nps_pct} help="0 if none; up to 14 is deductible" />
            <NumberField id="hra_received" money label="HRA received (yearly)" value={tax.hra_received}
              onChange={(v) => patch({ hra_received: v })} />
            <NumberField id="rent_paid_monthly" money label="Rent you pay (monthly)" value={tax.rent_paid_monthly}
              onChange={(v) => patch({ rent_paid_monthly: v })} />
            <CheckField id="metro" label="I live in Delhi, Mumbai, Kolkata or Chennai" checked={tax.metro} onChange={(v) => patch({ metro: v })} />
            <div className="space-y-2">
              <CheckField id="employer_offers_nps" label="My employer offers corporate NPS" checked={tax.employer_offers_nps}
                onChange={(v) => patch({ employer_offers_nps: v })} />
              <CheckField id="employer_offers_vpf" label="My employer offers Voluntary PF" checked={tax.employer_offers_vpf}
                onChange={(v) => patch({ employer_offers_vpf: v })} />
            </div>
          </div>
        </section>
      )}

      <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Deductions you already use this year</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <NumberField id="ded_80c" money label="Section 80C used so far" value={tax.ded_80c} onChange={(v) => patch({ ded_80c: v })}
            help="EPF, PPF, ELSS, life insurance, children's tuition, home loan principal. Limit 1.5 lakh." />
          <NumberField id="nps_self" money label="Your own NPS contribution" value={tax.nps_self} onChange={(v) => patch({ nps_self: v })}
            help="Extra 50,000 deduction (old regime)" />
          {detailed && (
            <>
              <NumberField id="health_self" money label="Health premium: you and family" value={tax.health_self}
                onChange={(v) => patch({ health_self: v })} />
              <NumberField id="health_parents" money label="Health premium: your parents" value={tax.health_parents}
                onChange={(v) => patch({ health_parents: v })} />
              <CheckField id="parents_senior" label="A parent is 60 or older" checked={tax.parents_senior}
                onChange={(v) => patch({ parents_senior: v })} />
              <div />
              <NumberField id="home_loan_interest" money label="Home loan interest (yearly)" value={tax.home_loan_interest}
                onChange={(v) => patch({ home_loan_interest: v })} help="Self-occupied home; 2 lakh limit in the old regime" />
              <NumberField id="edu_loan_interest" money label="Education loan interest (yearly)" value={tax.edu_loan_interest}
                onChange={(v) => patch({ edu_loan_interest: v })} />
            </>
          )}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Interest and investment gains</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {detailed && (
            <NumberField id="fd_interest" money label="FD and savings interest (yearly)" value={tax.fd_interest}
              onChange={(v) => patch({ fd_interest: v })} help="Taxed as income at your slab rate" />
          )}
          <NumberField id="realised_stcg" money label="Equity gains you sold within 12 months" value={tax.realised_stcg}
            onChange={(v) => patch({ realised_stcg: v })} help="This financial year so far" />
          <NumberField id="realised_ltcg" money label="Equity gains you sold after 12 months" value={tax.realised_ltcg}
            onChange={(v) => patch({ realised_ltcg: v })} help="This financial year so far" />
          <NumberField id="unrealised_gain" money label="Gain you could still sell after 12 months" value={tax.unrealised_gain}
            onChange={(v) => patch({ unrealised_gain: v })} help="Unsold equity gains in units held over a year" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white/70 p-5">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Preferences</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField id="lock_in" label="How long can money stay locked?" value={tax.lock_in}
            onChange={(v) => patch({ lock_in: v as TaxDraft["lock_in"] })}
            options={[{ value: "none", label: "I need access any time" }, { value: "3y", label: "Up to 3 years" },
              { value: "5y", label: "Up to 5 years" }, { value: "15y", label: "15 years or more" }]}
            help="Some tax-saving options lock money for years" />
          <SelectField id="spouse_band" label="Your spouse's income" value={tax.spouse_band}
            onChange={(v) => patch({ spouse_band: v as TaxDraft["spouse_band"] })}
            options={[{ value: "unknown", label: "Not applicable or prefer not to say" }, { value: "none", label: "No income" },
              { value: "lower", label: "Lower than mine" }, { value: "similar", label: "Similar to mine" }, { value: "higher", label: "Higher than mine" }]} />
          <div className="md:col-span-2">
            <CheckField id="govt_pref" label="I prefer government-backed options" checked={tax.govt_pref}
              onChange={(v) => patch({ govt_pref: v })} help="PPF, SSY, NSC, SCSS and similar" />
          </div>
        </div>
      </section>
    </>
  );
}
