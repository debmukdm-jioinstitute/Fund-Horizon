"use client";

import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Logo from "@/components/Logo";
import { API_URL, resolveApiUrl } from "@/lib/api";
import { QUESTIONNAIRE_QUESTIONS } from "@/lib/profiling";

const EMPLOYMENT = [
  ["govt_psu", "Govt / PSU"],
  ["salaried_private", "Salaried (Private)"],
  ["business_professional", "Business / Professional"],
  ["freelance_variable", "Freelance / Variable income"],
  ["retired_none", "Retired / None"],
];
const MONEY: [string, string][] = [
  ["monthly_income", "Monthly income (₹)"],
  ["monthly_expenses", "Monthly expenses (₹)"],
  ["monthly_emi", "Monthly loan EMIs (₹)"],
  ["liquid_assets", "Cash & bank savings (₹)"],
  ["investments", "Investments (₹)"],
  ["liabilities", "Total loans outstanding (₹)"],
  ["term_cover", "Term life cover (₹)"],
  ["health_cover", "Health cover (₹)"],
];
const input = "mt-1 w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#0D1219] px-3 py-2 text-sm";

export default function ClientRiskProfilePage() {
  return (
    <Suspense fallback={null}>
      <Form />
    </Suspense>
  );
}

function Form() {
  const ref = useSearchParams().get("ref") ?? undefined;
  const [f, setF] = useState<Record<string, string>>({ retirement_age: "60", dependents: "0" });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (QUESTIONNAIRE_QUESTIONS.some((q) => answers[q.id] === undefined)) return setError("Please answer all 10 questions.");
    if (!consent) return setError("Please accept the consent to continue.");
    const n = (k: string) => Number(f[k] || 0);
    setBusy(true);
    try {
      const res = await fetch(resolveApiUrl(`${API_URL}/api/crm/public/risk-profile`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name?.trim(), email: f.email?.trim(), phone: f.phone?.trim(), password: f.password, consent, ref,
          age: n("age"), employment_type: f.employment_type, dependents: n("dependents"), retirement_age: n("retirement_age"),
          ...Object.fromEntries(MONEY.map(([k]) => [k, n(k)])), answers,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const d = j.detail;
        throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join("; ") : "Could not submit. Please try again.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `risk-profile-${(f.name || "client").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const field = (k: string, label: string, type = "text", extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-xs font-medium">
      {label}
      <input required type={type} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={input} {...extra} />
    </label>
  );

  return (
    <div className="min-h-screen bg-[#F7F9FB] dark:bg-[#0D1219] text-[#172033] dark:text-[#EDF2F7] py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <Logo size="lg" showSubtitle href="/" />
          <h1 className="text-2xl font-semibold">Your Risk Profile</h1>
          <p className="text-sm text-[#536176] dark:text-[#A8B4C4]">
            Answer a few questions about your finances and comfort with risk. Your PDF report downloads when you finish, and a Fund Horizon account is created for you.
          </p>
        </div>
        {done ? (
          <div className="bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl p-8 text-center space-y-3">
            <h2 className="text-xl font-semibold">Thank you, {f.name}!</h2>
            <p className="text-sm text-[#536176] dark:text-[#A8B4C4]">
              Your report has been downloaded. Your account is ready, and you can sign in with {f.email}. Your advisor will be in touch.
            </p>
            <a href="/login" className="inline-block rounded-lg bg-[#0176D3] px-4 py-2 text-sm font-semibold text-white">Sign in</a>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl p-6 space-y-6">
            <section className="grid sm:grid-cols-2 gap-4">
              <h2 className="sm:col-span-2 text-sm font-semibold">About you</h2>
              {field("name", "Full name", "text", { minLength: 2 })}
              {field("email", "Email", "email")}
              {field("phone", "Mobile number", "tel", { minLength: 10 })}
              {field("password", "Create a password (min 8 characters)", "password", { minLength: 8 })}
              {field("age", "Age", "number", { min: 18, max: 80 })}
              <label className="block text-xs font-medium">
                Employment
                <select required value={f.employment_type ?? ""} onChange={(e) => set("employment_type", e.target.value)} className={input}>
                  <option value="" disabled>Select…</option>
                  {EMPLOYMENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              {field("dependents", "Dependents", "number", { min: 0, max: 15 })}
              {field("retirement_age", "Planned retirement age", "number", { min: 40, max: 80 })}
            </section>
            <section className="grid sm:grid-cols-2 gap-4">
              <h2 className="sm:col-span-2 text-sm font-semibold">Your finances</h2>
              {MONEY.map(([k, l]) => field(k, l, "number", { min: 0 }))}
            </section>
            <section className="space-y-4">
              <h2 className="text-sm font-semibold">Your comfort with risk</h2>
              {QUESTIONNAIRE_QUESTIONS.map((q, i) => (
                <fieldset key={q.id} className="space-y-1.5">
                  <legend className="text-xs font-medium">Q{i + 1}. {q.text}</legend>
                  {q.options.map((o, oi) => (
                    <label key={oi} className="flex items-center gap-2 text-xs">
                      <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => setAnswers((p) => ({ ...p, [q.id]: oi }))} />
                      {o.text}
                    </label>
                  ))}
                </fieldset>
              ))}
            </section>
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              I agree that Fund Horizon may store my details to assess my risk profile, create my account and contact me about suitable investments.
            </label>
            {error && <div className="rounded-lg border border-[#B42332]/30 bg-[#B42332]/5 p-3 text-xs text-[#B42332]">{error}</div>}
            <button disabled={busy} className="w-full rounded-lg bg-[#0176D3] py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Preparing your report…" : "Submit & download PDF"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
