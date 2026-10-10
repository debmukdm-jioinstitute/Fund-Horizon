// TODO(owner-compliance-review): this file contains user-facing copy.
import Link from "next/link";
import { getMetaServer } from "@/lib/api";

const STEPS = [
  { t: "About you", d: "Age, income, expenses and what you already have." },
  { t: "Your goals", d: "Retirement, education, a home. Up to six goals with priorities." },
  { t: "Comfort with risk", d: "Ten short questions on how you react to ups and downs." },
  { t: "Your plan", d: "A suggested allocation, an illustrative shortlist, SIP amounts and a PDF." },
];

export default async function Home() {
  const meta = await getMetaServer();
  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-navy-900 px-6 py-12 text-white md:px-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal-500">Fund Horizon Planner</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight md:text-5xl">
          See how much to invest each month for the goals that matter.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-navy-100">
          Answer a few questions in about five minutes. You get a suggested allocation matched to your capacity and
          comfort with risk, an illustrative fund shortlist, a stress test on past data, and a goal-by-goal SIP plan.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/plan/new" className="btn bg-teal-500 text-navy-950 hover:bg-teal-100">
            Start your plan
          </Link>
        </div>
        <p className="mt-4 text-sm text-navy-100">
          No PAN, phone or email needed. Only your first name and age. Takes about five minutes.
        </p>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="text-2xl font-bold">How it works</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="card">
              <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 font-bold text-teal-700">
                {i + 1}
              </span>
              <h3 className="font-semibold">{s.t}</h3>
              <p className="mt-1 text-sm text-navy-700">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="note">
        <h2 id="note" className="text-lg font-bold">Please note</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-700">
          {meta ? meta.disclosures.lines.map((l) => <li key={l}>{l}</li>) : <li>Disclosures are temporarily unavailable.</li>}
          {meta && <li>{meta.disclosures.tax_info}</li>}
        </ul>
      </section>
    </div>
  );
}
