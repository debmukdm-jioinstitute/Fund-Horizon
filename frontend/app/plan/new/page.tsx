"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NumberField, SelectField, TextField } from "@/components/Field";
import { ApiError, createPlan, getMeta, getQuestionnaire } from "@/lib/api";
import { TaxBasicsStep, TaxDetailsStep } from "@/components/TaxSteps";
import {
  DRAFT_STORAGE_KEY, DRAFT_STORAGE_LEGACY_KEY, Draft, EMPLOYMENT, Errors, GOAL_TYPES, GoalDraft, TaxDraft,
  draftHasHugeTarget, emptyDraft, emptyGoal, employmentLabel, readStoredWizard, retirementHorizonYears,
  syncRetirementYears, toRequest, validateAbout, validateFinances, validateGoals, validateTax, writeStoredWizard,
} from "@/lib/draft";
import { inr } from "@/lib/format";
import type { Questionnaire } from "@/lib/types";

// 0 About, 1 Finances, 2 Goals, 3 Tax basics, 4 Tax details, 5–7 grouped risk questions, 8 Review
const TAX_BASICS = 3;
const TAX_DETAILS = 4;
const Q_START = 5;
const Q_PAGES = 3;
const QUESTIONS = 10;
const REVIEW = Q_START + Q_PAGES;
const TOTAL = REVIEW + 1;
const Q_GROUPS = [4, 3, 3];

const SECTION = (s: number) => (s <= 2 ? s + 1 : s <= TAX_DETAILS ? 4 : s < REVIEW ? 5 : 6);
const SECTION_NAMES = ["About you", "Income and finances", "Goals", "Tax", "Comfort with risk", "Review and consent"];

function groupBounds(page: number): { start: number; end: number } {
  let start = 0;
  for (let i = 0; i < page; i++) start += Q_GROUPS[i];
  return { start, end: start + Q_GROUPS[page] };
}

export default function NewPlan() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [quiz, setQuiz] = useState<Questionnaire | null>(null);
  const [consentText, setConsentText] = useState("");
  const [scopeNote, setScopeNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY) ?? sessionStorage.getItem(DRAFT_STORAGE_LEGACY_KEY);
      const saved = readStoredWizard(raw);
      if (saved) {
        setDraft(saved.draft);
        setStep(Math.min(saved.step, REVIEW));
      }
      sessionStorage.removeItem(DRAFT_STORAGE_LEGACY_KEY);
    } catch {
      /* ignore unreadable draft */
    }
    setHydrated(true);
    getQuestionnaire().then(setQuiz).catch(() => setSubmitError("Could not load the questionnaire. Is the API running?"));
    getMeta().then((m) => { setConsentText(m.disclosures.consent_text); setScopeNote(m.disclosures.tax_scope_note ?? ""); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, writeStoredWizard(draft, step));
    } catch {
      /* storage may be unavailable */
    }
  }, [draft, step, hydrated]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => syncRetirementYears({ ...d, [k]: v }));
  const setGoal = (i: number, patch: Partial<GoalDraft>) =>
    setDraft((d) => syncRetirementYears({ ...d, goals: d.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  const patchTax = (p: Partial<TaxDraft>) => setDraft((d) => ({ ...d, tax: { ...d.tax, ...p } }));
  const salaried = ["govt_psu", "salaried_private", "retired_none"].includes(draft.employment_type);
  const qPage = step - Q_START;
  const qBounds = qPage >= 0 && qPage < Q_PAGES ? groupBounds(qPage) : null;
  const qSlice = quiz && qBounds ? quiz.questions.slice(qBounds.start, qBounds.end) : [];
  const progress = Math.round(((step + 1) / TOTAL) * 100);
  const lockedRetirementYears = retirementHorizonYears(Number(draft.age) || 0, Number(draft.retirement_age) || 0);
  const hugeTarget = draftHasHugeTarget(draft);

  const validate = (): Errors => {
    if (step === 0) return validateAbout(draft);
    if (step === 1) return validateFinances(draft);
    if (step === 2) return validateGoals(draft);
    if (step === TAX_BASICS || step === TAX_DETAILS) return validateTax(draft);
    if (qPage >= 0 && qPage < Q_PAGES) {
      if (!quiz) return { answer: "Questions are still loading. Please wait a moment." };
      const { start, end } = groupBounds(qPage);
      const missing = quiz.questions.slice(start, end).some((q) => draft.answers[q.id] === undefined);
      if (missing) return { answer: "Please answer every question on this page." };
    }
    return {};
  };

  const next = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length === 0) {
      setStep((s) => (s === TAX_BASICS && draft.tax.mode === "skip" ? Q_START : Math.min(s + 1, REVIEW)));
    }
  };
  const back = () => {
    setErrors({});
    setStep((s) => (s === Q_START && draft.tax.mode === "skip" ? TAX_BASICS : Math.max(s - 1, 0)));
  };

  const answered = useMemo(() => Object.keys(draft.answers).length, [draft.answers]);

  const submit = async () => {
    const e = { ...validateAbout(draft), ...validateFinances(draft), ...validateGoals(draft), ...validateTax(draft) };
    if (Object.keys(e).length) {
      setErrors(e);
      setSubmitError("Some answers need attention. Please go back and fix them.");
      return;
    }
    if (answered < QUESTIONS) {
      setSubmitError("Please answer all ten risk questions.");
      return;
    }
    if (!draft.consent) {
      setErrors({ consent: "Please tick the consent box to continue." });
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const plan = await createPlan(toRequest({ ...draft, consent: true }));
      try {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
        sessionStorage.removeItem(DRAFT_STORAGE_LEGACY_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/plan/${plan.id}`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Progress Header */}
      <div className="mb-6 rounded-2xl border border-white/80 bg-white/60 p-4 shadow-glass backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-navy-800">
          <span className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-xs text-white">
              {SECTION(step)}
            </span>
            <span>Step {SECTION(step)} of 5: {SECTION_NAMES[SECTION(step) - 1]}</span>
          </span>
          <span className="font-mono text-teal-700">{progress}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/70 p-0.5 shadow-inner" role="progressbar" aria-valuenow={progress}
          aria-valuemin={0} aria-valuemax={100} aria-label="Plan progress">
          <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-400 shadow-glow-teal transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <section className="glass-card p-6 md:p-8" aria-live="polite">
        {step === 0 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-2xl font-bold tracking-tight text-navy-950">About you</h1>
            <p className="mb-5 text-sm text-slate-600">
              Years on a retirement goal are locked to planned retirement age minus your age, so the SIP horizon and term-cover horizon match.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField id="first_name" label="First name" value={draft.first_name} maxLength={40}
                autoComplete="given-name"
                onChange={(v) => set("first_name", v)} error={errors.first_name}
                help="Only used to personalise your report." />
              <NumberField id="age" label="Age" value={draft.age} onChange={(v) => set("age", v)} error={errors.age} />
              <SelectField id="employment" label="Source of income" value={draft.employment_type}
                onChange={(v) => set("employment_type", v as Draft["employment_type"])} options={EMPLOYMENT} />
              <NumberField id="dependents" label="People who depend on your income" value={draft.dependents}
                onChange={(v) => set("dependents", v)} error={errors.dependents} />
              <NumberField id="retirement_age" label="Planned retirement age" value={draft.retirement_age}
                onChange={(v) => set("retirement_age", v)} error={errors.retirement_age} />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-2xl font-bold tracking-tight text-navy-950">Income and finances</h1>
            <p className="mb-5 text-sm text-slate-600">Approximate figures in rupees are fine. These amounts are not saved in this browser if you refresh.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <NumberField id="monthly_income" label="Monthly take-home income" money value={draft.monthly_income}
                onChange={(v) => set("monthly_income", v)} error={errors.monthly_income} />
              <NumberField id="monthly_expenses" label="Monthly household expenses" money value={draft.monthly_expenses}
                onChange={(v) => set("monthly_expenses", v)} error={errors.monthly_expenses} help="Excluding EMIs" />
              <NumberField id="monthly_emi" label="Monthly EMIs" money value={draft.monthly_emi}
                onChange={(v) => set("monthly_emi", v)} error={errors.monthly_emi} />
              <NumberField id="liquid_assets" label="Savings and liquid funds" money value={draft.liquid_assets}
                onChange={(v) => set("liquid_assets", v)} error={errors.liquid_assets}
                help="Bank balance, liquid funds, FDs under 1 year" />
              <NumberField id="investments" label="Investments" money value={draft.investments}
                onChange={(v) => set("investments", v)} help="Mutual funds, stocks, bonds, gold, PPF/EPF" />
              <NumberField id="liabilities" label="Outstanding loans" money value={draft.liabilities}
                onChange={(v) => set("liabilities", v)} />
              <NumberField id="term_cover" label="Term life cover" money value={draft.term_cover}
                onChange={(v) => set("term_cover", v)} help="0 if none" />
              <NumberField id="health_cover" label="Family health cover" money value={draft.health_cover}
                onChange={(v) => set("health_cover", v)} help="Family floater sum insured; 0 if none" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="mb-2 text-2xl font-bold tracking-tight text-navy-950">Your goals</h1>
            <p className="mb-5 text-sm text-slate-600">Add up to six goals. Priority 1 goals are funded first.</p>
            {errors.goals && <p className="err mb-3" role="alert">{errors.goals}</p>}
            {hugeTarget && (
              <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-sm text-amber-900 shadow-sm backdrop-blur-sm" role="status">
                One or more targets is over ₹100 Cr. Please check the figure — very large targets produce SIPs that no household surplus can fund.
              </p>
            )}
            <div className="space-y-5">
              {draft.goals.map((g, i) => {
                const retirementLocked = g.type === "retirement" && lockedRetirementYears != null;
                const yearsValue = retirementLocked ? String(lockedRetirementYears) : g.years;
                return (
                  <fieldset key={i} className="card-3d bg-white/70 p-5 backdrop-blur-sm transition-all hover:border-teal-500/30">
                    <legend className="rounded-full bg-teal-50 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-teal-800 border border-teal-200/50">Goal {i + 1}</legend>
                    <div className="grid gap-4 md:grid-cols-2 mt-2">
                      <SelectField id={`g${i}-type`} label="Type" value={g.type}
                        onChange={(v) => {
                          const t = GOAL_TYPES.find((x) => x.value === v)!;
                          const prev = GOAL_TYPES.find((x) => x.value === g.type)!;
                          const y = v === "retirement" ? lockedRetirementYears : null;
                          setGoal(i, {
                            type: t.value,
                            name: !g.name || g.name === prev.preset ? t.preset : g.name,
                            years: y != null ? String(y) : g.years,
                          });
                        }}
                        options={GOAL_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
                      <TextField id={`g${i}-name`} label="Goal name" value={g.name} maxLength={60}
                        onChange={(v) => setGoal(i, { name: v })} error={errors[`g${i}.name`]} />
                      <NumberField id={`g${i}-target`} money value={g.target} onChange={(v) => setGoal(i, { target: v })}
                        label={g.type === "retirement" ? "Yearly spending in retirement (today's rupees)" : "Cost in today's rupees"}
                        help={g.type === "retirement" ? "Leave 0 to assume 70% of your current expenses" : undefined}
                        error={errors[`g${i}.target`]} />
                      <NumberField id={`g${i}-years`} label="Years to goal" value={yearsValue}
                        disabled={retirementLocked}
                        onChange={(v) => setGoal(i, { years: v })} error={errors[`g${i}.years`]}
                        help={retirementLocked
                          ? `Locked to planned retirement age (${draft.retirement_age}) minus your age (${draft.age}).`
                          : g.type === "retirement"
                            ? "Retirement years should equal planned retirement age minus your age. Raise the retirement age or change the goal type."
                            : undefined} />
                      <SelectField id={`g${i}-priority`} label="Priority" value={g.priority}
                        onChange={(v) => setGoal(i, { priority: v as GoalDraft["priority"] })}
                        options={[{ value: "1", label: "1 – High" }, { value: "2", label: "2 – Medium" }, { value: "3", label: "3 – Low" }]} />
                      <NumberField id={`g${i}-earmarked`} money label="Existing investments set aside for this goal"
                        value={g.earmarked} onChange={(v) => setGoal(i, { earmarked: v })} />
                    </div>
                    {g.type === "retirement" && lockedRetirementYears == null && (
                      <p className="mt-3 text-sm text-amber-700" role="status">
                        Years to retirement cannot be locked because planned retirement age minus age is not between 1 and 40.
                      </p>
                    )}
                    {draft.goals.length > 1 && (
                      <button type="button" className="mt-3 text-sm font-semibold text-rose-600 hover:text-rose-700 underline"
                        onClick={() => set("goals", draft.goals.filter((_, j) => j !== i))}>
                        Remove goal {i + 1}
                      </button>
                    )}
                  </fieldset>
                );
              })}
            </div>
            {draft.goals.length < 6 && (
              <button type="button" className="btn-secondary mt-5"
                onClick={() => set("goals", [...draft.goals, emptyGoal()])}>
                + Add another goal
              </button>
            )}
          </>
        )}

        {step === TAX_BASICS && (
          <TaxBasicsStep tax={draft.tax} patch={patchTax} errors={errors} monthlyIncome={draft.monthly_income}
            scopeNote={scopeNote} headingRef={headingRef} />
        )}

        {step === TAX_DETAILS && (
          <TaxDetailsStep tax={draft.tax} patch={patchTax} errors={errors} salaried={salaried} headingRef={headingRef} />
        )}

        {qPage >= 0 && qPage < Q_PAGES && (
          <fieldset>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-800 border border-teal-200/50">
              Questions {groupBounds(qPage).start + 1}–{groupBounds(qPage).end} of {QUESTIONS}
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="mb-5 text-2xl font-bold tracking-tight text-navy-950">Comfort with risk</h1>
            {qSlice.length === 0 && <p className="text-slate-500">Loading questions…</p>}
            <div className="space-y-6">
              {qSlice.map((question, qi) => {
                const absolute = groupBounds(qPage).start + qi;
                return (
                  <fieldset key={question.id} className="card-3d bg-white/70 p-5 backdrop-blur-sm">
                    <legend className="font-semibold text-navy-950 text-base">Question {absolute + 1}. {question.text}</legend>
                    <div className="mt-3 space-y-2.5">
                      {question.options.map((o, idx) => {
                        const checked = draft.answers[question.id] === idx;
                        return (
                          <label key={idx}
                            className={`flex cursor-pointer items-start gap-3.5 rounded-xl border p-3.5 transition-all duration-200 ${checked ? "border-teal-500 bg-teal-50/80 shadow-glow-teal ring-2 ring-teal-500/20 text-navy-950 font-medium" : "border-slate-200/80 bg-white/50 hover:bg-white hover:border-slate-300 text-slate-700"}`}>
                            <input type="radio" name={question.id} className="mt-1 h-4 w-4 accent-teal-600" checked={checked}
                              onChange={() => { set("answers", { ...draft.answers, [question.id]: idx }); setErrors({}); }} />
                            <span className="text-sm leading-relaxed">{o.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            {errors.answer && <p className="err mt-3" role="alert">{errors.answer}</p>}
          </fieldset>
        )}

        {step === REVIEW && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="mb-5 text-2xl font-bold tracking-tight text-navy-950">Review and consent</h1>
            
            <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">About you</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <Row k="Name" v={draft.first_name} />
                <Row k="Age" v={draft.age} />
                <Row k="Source of income" v={employmentLabel(draft.employment_type)} />
                <Row k="Dependents" v={draft.dependents} />
                <Row k="Planned retirement age" v={draft.retirement_age} />
              </dl>
            </div>

            <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Income and finances</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <Row k="Monthly income" v={inr(Number(draft.monthly_income))} />
                <Row k="Monthly household expenses" v={inr(Number(draft.monthly_expenses))} />
                <Row k="Monthly EMIs" v={inr(Number(draft.monthly_emi))} />
                <Row k="Savings and liquid funds" v={inr(Number(draft.liquid_assets))} />
                <Row k="Investments" v={inr(Number(draft.investments))} />
                <Row k="Outstanding loans" v={inr(Number(draft.liabilities))} />
                <Row k="Term life cover" v={inr(Number(draft.term_cover))} />
                <Row k="Family health cover" v={inr(Number(draft.health_cover))} />
              </dl>
            </div>

            <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Goals</h2>
              <ul className="list-disc pl-5 text-sm space-y-1 text-slate-700">
                {draft.goals.map((g, i) => {
                  const y = g.type === "retirement" && lockedRetirementYears != null ? lockedRetirementYears : g.years;
                  return (
                    <li key={i}><span className="font-semibold text-navy-950">{g.name}:</span> {g.type === "retirement" && !Number(g.target) ? "default retirement spending" : inr(Number(g.target))} in {y} years (priority {g.priority})</li>
                  );
                })}
              </ul>
              {hugeTarget && (
                <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-900" role="status">
                  One or more targets is over ₹100 Cr. The plan will still run, but treat the SIP as a scale check.
                </p>
              )}
            </div>

            <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-teal-800">Tax</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <Row k="Tax handling" v={draft.tax.mode === "detailed" ? "Work it out for me" : draft.tax.mode === "bracket_only" ? "I know my bracket" : "Skipped"} />
                {draft.tax.mode !== "skip" && <Row k="Regime used now" v={draft.tax.regime_current === "unsure" ? "Not sure" : draft.tax.regime_current === "new" ? "New regime" : "Old regime"} />}
                {draft.tax.mode === "detailed" && <Row k="Yearly income before tax" v={inr(Number(draft.tax.gross_income))} />}
                {draft.tax.mode === "bracket_only" && <Row k="Highest slab rate" v={`${draft.tax.bracket_pct}%`} />}
                {draft.tax.mode !== "skip" && <Row k="80C used so far" v={inr(Number(draft.tax.ded_80c))} />}
              </dl>
            </div>

            <div className="mb-6 rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-teal-800">Risk answers</h2>
              <p className="text-xs text-slate-500 mb-3">Answered {answered} of {QUESTIONS}.</p>
              <dl className="space-y-2 text-sm">
                {(quiz?.questions ?? []).map((q, i) => (
                  <Row key={q.id} k={`Q${i + 1}. ${q.text}`} v={q.options[draft.answers[q.id]]?.text ?? "Not answered"} />
                ))}
              </dl>
            </div>

            <div className="mt-5 rounded-2xl border border-teal-200/70 bg-teal-50/60 p-5 backdrop-blur-sm shadow-glass">
              <label className="flex items-start gap-3.5 text-sm font-medium text-navy-950 cursor-pointer">
                <input type="checkbox" className="mt-1 h-5 w-5 rounded accent-teal-600" checked={draft.consent}
                  onChange={(e) => set("consent", e.target.checked)} />
                <span className="leading-relaxed">{consentText || "I consent to my entries being used to generate an illustrative plan."}</span>
              </label>
              {errors.consent && <p className="err mt-2" role="alert">{errors.consent}</p>}
            </div>
          </>
        )}

        {submitError && <p className="err mt-4" role="alert">{submitError}</p>}

        <div className="mt-8 flex items-center justify-between pt-4 border-t border-slate-200/60">
          <button type="button" className="btn-secondary" onClick={back} disabled={step === 0}>Back</button>
          {step < REVIEW ? (
            <button type="button" className="btn-primary" onClick={next}>Continue</button>
          ) : (
            <button type="button" className="btn-accent" onClick={submit} disabled={submitting}>
              {submitting ? "Building your plan…" : "Show my plan"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-navy-100 py-1">
      <dt className="text-navy-700">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
