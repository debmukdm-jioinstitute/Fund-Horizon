"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NumberField, SelectField, TextField } from "@/components/Field";
import { ApiError, createPlan, getMeta, getQuestionnaire } from "@/lib/api";
import {
  Draft, EMPLOYMENT, Errors, GOAL_TYPES, GoalDraft, emptyDraft, emptyGoal, toRequest, validateAbout,
  validateFinances, validateGoals,
} from "@/lib/draft";
import { inr } from "@/lib/format";
import type { Questionnaire } from "@/lib/types";

const STORAGE_KEY = "fh-plan-draft-v1";
// 0 About, 1 Finances, 2 Goals, 3..12 questions, 13 Review
const Q_START = 3;
const QUESTIONS = 10;
const REVIEW = Q_START + QUESTIONS;
const TOTAL = REVIEW + 1;

const SECTION = (s: number) => (s === 0 ? 1 : s === 1 ? 2 : s === 2 ? 3 : s < REVIEW ? 4 : 5);
const SECTION_NAMES = ["About you", "Income and finances", "Goals", "Risk questionnaire", "Review and consent"];

export default function NewPlan() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [quiz, setQuiz] = useState<Questionnaire | null>(null);
  const [consentText, setConsentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { draft: Draft; step: number };
        setDraft({ ...emptyDraft(), ...saved.draft, consent: false });
        setStep(Math.min(saved.step ?? 0, REVIEW));
      }
    } catch {
      /* ignore unreadable draft */
    }
    setHydrated(true);
    getQuestionnaire().then(setQuiz).catch(() => setSubmitError("Could not load the questionnaire. Is the API running?"));
    getMeta().then((m) => setConsentText(m.disclosures.consent_text)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ draft: { ...draft, consent: false }, step }));
    } catch {
      /* storage may be unavailable */
    }
  }, [draft, step, hydrated]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setGoal = (i: number, patch: Partial<GoalDraft>) =>
    setDraft((d) => ({ ...d, goals: d.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  const qIndex = step - Q_START;
  const question = quiz && qIndex >= 0 && qIndex < QUESTIONS ? quiz.questions[qIndex] : null;
  const progress = Math.round(((step + 1) / TOTAL) * 100);

  const validate = (): Errors => {
    if (step === 0) return validateAbout(draft);
    if (step === 1) return validateFinances(draft);
    if (step === 2) return validateGoals(draft);
    if (question && draft.answers[question.id] === undefined) return { answer: "Please choose an option to continue." };
    return {};
  };

  const next = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => Math.min(s + 1, REVIEW));
  };
  const back = () => {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  };

  const answered = useMemo(() => Object.keys(draft.answers).length, [draft.answers]);

  const submit = async () => {
    const e = { ...validateAbout(draft), ...validateFinances(draft), ...validateGoals(draft) };
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
      const plan = await createPlan(toRequest(draft));
      try {
        sessionStorage.removeItem(STORAGE_KEY);
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
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="mb-1 flex justify-between text-sm font-medium">
          <span>Step {SECTION(step)} of 5: {SECTION_NAMES[SECTION(step) - 1]}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-valuenow={progress}
          aria-valuemin={0} aria-valuemax={100} aria-label="Plan progress">
          <div className="h-full bg-teal-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <section className="card" aria-live="polite">
        {step === 0 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="mb-4 text-2xl font-bold">About you</h1>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField id="first_name" label="First name" value={draft.first_name} maxLength={40}
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
            <h1 ref={headingRef} tabIndex={-1} className="mb-1 text-2xl font-bold">Income and finances</h1>
            <p className="mb-4 text-sm text-navy-700">Approximate figures in rupees are fine.</p>
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
            <h1 ref={headingRef} tabIndex={-1} className="mb-1 text-2xl font-bold">Your goals</h1>
            <p className="mb-4 text-sm text-navy-700">Add up to six goals. Priority 1 goals are funded first.</p>
            {errors.goals && <p className="err mb-2" role="alert">{errors.goals}</p>}
            <div className="space-y-5">
              {draft.goals.map((g, i) => (
                <fieldset key={i} className="rounded-lg border border-navy-100 p-4">
                  <legend className="px-1 text-sm font-semibold">Goal {i + 1}</legend>
                  <div className="grid gap-4 md:grid-cols-2">
                    <SelectField id={`g${i}-type`} label="Type" value={g.type}
                      onChange={(v) => {
                        const t = GOAL_TYPES.find((x) => x.value === v)!;
                        const prev = GOAL_TYPES.find((x) => x.value === g.type)!;
                        const age = Number(draft.age) || 0;
                        const ra = Number(draft.retirement_age) || 60;
                        setGoal(i, {
                          type: t.value,
                          name: !g.name || g.name === prev.preset ? t.preset : g.name,
                          years: v === "retirement" && !g.years && ra > age ? String(ra - age) : g.years,
                        });
                      }}
                      options={GOAL_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
                    <TextField id={`g${i}-name`} label="Goal name" value={g.name} maxLength={60}
                      onChange={(v) => setGoal(i, { name: v })} error={errors[`g${i}.name`]} />
                    <NumberField id={`g${i}-target`} money value={g.target} onChange={(v) => setGoal(i, { target: v })}
                      label={g.type === "retirement" ? "Yearly spending in retirement (today's rupees)" : "Cost in today's rupees"}
                      help={g.type === "retirement" ? "Leave 0 to assume 70% of your current expenses" : undefined}
                      error={errors[`g${i}.target`]} />
                    <NumberField id={`g${i}-years`} label="Years to goal" value={g.years}
                      onChange={(v) => setGoal(i, { years: v })} error={errors[`g${i}.years`]} />
                    <SelectField id={`g${i}-priority`} label="Priority" value={g.priority}
                      onChange={(v) => setGoal(i, { priority: v as GoalDraft["priority"] })}
                      options={[{ value: "1", label: "1 – High" }, { value: "2", label: "2 – Medium" }, { value: "3", label: "3 – Low" }]} />
                    <NumberField id={`g${i}-earmarked`} money label="Existing investments set aside for this goal"
                      value={g.earmarked} onChange={(v) => setGoal(i, { earmarked: v })} />
                  </div>
                  {draft.goals.length > 1 && (
                    <button type="button" className="mt-3 text-sm font-medium text-rose-700 underline"
                      onClick={() => set("goals", draft.goals.filter((_, j) => j !== i))}>
                      Remove goal {i + 1}
                    </button>
                  )}
                </fieldset>
              ))}
            </div>
            {draft.goals.length < 6 && (
              <button type="button" className="btn-secondary mt-4"
                onClick={() => set("goals", [...draft.goals, emptyGoal()])}>
                Add another goal
              </button>
            )}
          </>
        )}

        {question && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-navy-700">Question {qIndex + 1} of {QUESTIONS}</legend>
            <h1 ref={headingRef} tabIndex={-1} className="mb-4 text-xl font-bold">{question.text}</h1>
            <div className="space-y-2">
              {question.options.map((o, idx) => {
                const checked = draft.answers[question.id] === idx;
                return (
                  <label key={idx}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? "border-teal-600 bg-teal-50" : "border-navy-100 hover:bg-navy-50"}`}>
                    <input type="radio" name={question.id} className="mt-1 h-4 w-4 accent-teal-600" checked={checked}
                      onChange={() => { set("answers", { ...draft.answers, [question.id]: idx }); setErrors({}); }} />
                    <span>{o.text}</span>
                  </label>
                );
              })}
            </div>
            {errors.answer && <p className="err mt-3" role="alert">{errors.answer}</p>}
          </fieldset>
        )}
        {step >= Q_START && step < REVIEW && !question && <p>Loading questions…</p>}

        {step === REVIEW && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className="mb-4 text-2xl font-bold">Review and consent</h1>
            <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
              <Row k="Name" v={draft.first_name} />
              <Row k="Age" v={draft.age} />
              <Row k="Monthly income" v={inr(Number(draft.monthly_income))} />
              <Row k="Monthly expenses + EMIs" v={inr(Number(draft.monthly_expenses) + Number(draft.monthly_emi))} />
              <Row k="Savings and liquid funds" v={inr(Number(draft.liquid_assets))} />
              <Row k="Investments" v={inr(Number(draft.investments))} />
            </dl>
            <h2 className="mb-1 mt-4 font-semibold">Goals</h2>
            <ul className="list-disc pl-5 text-sm">
              {draft.goals.map((g, i) => (
                <li key={i}>{g.name}: {g.type === "retirement" && !Number(g.target) ? "default retirement spending" : inr(Number(g.target))} in {g.years} years (priority {g.priority})</li>
              ))}
            </ul>
            <p className="mt-2 text-sm">Risk questions answered: {answered} of {QUESTIONS}</p>
            <div className="mt-5 rounded-lg bg-navy-50 p-4">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-teal-600" checked={draft.consent}
                  onChange={(e) => set("consent", e.target.checked)} />
                <span>{consentText || "I consent to my entries being used to generate an illustrative plan."}</span>
              </label>
              {errors.consent && <p className="err" role="alert">{errors.consent}</p>}
            </div>
          </>
        )}

        {submitError && <p className="err mt-4" role="alert">{submitError}</p>}

        <div className="mt-6 flex items-center justify-between">
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
    <div className="flex justify-between border-b border-navy-100 py-1">
      <dt className="text-navy-700">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
