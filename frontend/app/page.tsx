// TODO(owner-compliance-review): this file contains user-facing copy.
import Link from "next/link";
import { redirect } from "next/navigation";

const STEPS = [
  { t: "About you", d: "Age, income, expenses and what you already have." },
  { t: "Your goals", d: "Retirement, education, a home. Up to six goals with priorities." },
  { t: "Comfort with risk", d: "Ten short questions, on three screens, on how you react to ups and downs." },
  { t: "Your plan", d: "An illustrative allocation and shortlist, SIP amounts and a PDF. Bookmark the link — we cannot email it back." },
];

function normalizePlanId(raw: string): string | null {
  const trimmed = raw.trim();
  const fromUrl = trimmed.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (fromUrl) return fromUrl[0].toLowerCase();
  return null;
}

async function openSavedPlan(formData: FormData) {
  "use server";
  const id = normalizePlanId(String(formData.get("plan_id") ?? ""));
  if (!id) {
    redirect("/?retrieve=invalid");
  }
  redirect(`/plan/${id}`);
}

export default function Home({ searchParams }: { searchParams?: { retrieve?: string } }) {
  const retrieveError = searchParams?.retrieve === "invalid";
  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-navy-900 px-6 py-12 text-white md:px-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-teal-500">Fund Horizon Planner</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight md:text-5xl">
          See how much to invest each month for the goals that matter.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-navy-100">
          Answer a few questions in about five minutes. You get an illustrative allocation matched to your capacity and
          comfort with risk, a past-performance fund shortlist, a stress test on past data, and a goal-by-goal SIP plan.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-navy-100">
          Fund Horizon is an AMFI-registered mutual fund distributor (execution-only). This planner is an illustration, not a personalised recommendation.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/plan/new" className="btn bg-teal-500 text-navy-950 hover:bg-teal-100">
            Start your plan
          </Link>
          <Link href="/cas" className="btn border border-teal-400 bg-transparent text-white hover:bg-navy-800">
            Analyze CAS statement
          </Link>
        </div>
        <p className="mt-4 text-sm text-navy-100">
          No PAN, phone or email needed. Only your first name and age. Takes about five minutes.
          Keep the plan link — if you lose it, we cannot recover it.
        </p>
      </section>

      <section aria-labelledby="retrieve" className="card max-w-2xl">
        <h2 id="retrieve" className="text-xl font-bold">Already have a plan?</h2>
        <p className="mt-1 text-sm text-navy-700">
          Paste the plan link or the ID from the results page. We never ask for a phone or email, so this is the only way back.
        </p>
        <form action={openSavedPlan} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="plan_id">Plan link or ID</label>
          <input id="plan_id" name="plan_id" className="input flex-1" placeholder="Plan link or ID"
            autoComplete="off" spellCheck={false} required />
          <button type="submit" className="btn-primary">Open plan</button>
        </form>
        {retrieveError && (
          <p className="err mt-3" role="alert">That did not look like a plan link. Paste the full address or the 36-character ID.</p>
        )}
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
    </div>
  );
}
