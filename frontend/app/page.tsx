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
      {/* Hero Section: 3D Frosted Glass Container with Radial Lighting */}
      <section className="relative overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 px-7 py-14 text-white shadow-2xl shadow-navy-950/20 md:px-14 md:py-20">
        {/* Ambient 3D glow circles inside hero */}
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />

        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-950/60 px-3.5 py-1 text-xs font-bold uppercase tracking-widest text-teal-400 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
            Fund Horizon Planner
          </div>

          <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-5xl lg:text-6xl">
            See how much to invest each month for the goals that matter.
          </h1>

          <p className="mt-5 text-base leading-relaxed text-slate-200 md:text-lg">
            Answer a few questions in about five minutes. You get an illustrative allocation matched to your capacity and
            comfort with risk, a past-performance fund shortlist, a stress test on past data, and a goal-by-goal SIP plan.
          </p>

          <p className="mt-3 text-xs leading-relaxed text-slate-300">
            Fund Horizon is an AMFI-registered mutual fund distributor (execution-only). This planner is an illustration, not a personalised recommendation.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/plan/new"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-teal-400 to-teal-500 px-6 py-3.5 text-sm font-extrabold text-navy-950 shadow-lg shadow-teal-500/25 transition-all hover:scale-105 hover:shadow-teal-500/40 active:scale-95"
            >
              Start your plan →
            </Link>
            <Link
              href="/cas"
              className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-sm font-bold text-white backdrop-blur-md transition-all hover:bg-white/20 hover:border-white/30"
            >
              Analyze CAS statement
            </Link>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-slate-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal-400" />
            <span>
              No PAN, phone or email needed. Only your first name and age. Takes about five minutes.
              Keep the plan link — if you lose it, we cannot recover it.
            </span>
          </div>
        </div>
      </section>

      {/* Retrieve Plan Section: Frosted Glass Card with 3D Input */}
      <section
        aria-labelledby="retrieve"
        className="glass-card max-w-2xl p-7 transition-all hover:border-teal-500/30"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-900 text-teal-400 shadow-md">
            🔑
          </div>
          <div>
            <h2 id="retrieve" className="text-xl font-extrabold text-navy-950">
              Already have a plan?
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Paste the plan link or the ID from the results page. We never ask for a phone or email, so this is the only way back.
            </p>
          </div>
        </div>

        <form action={openSavedPlan} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="plan_id">
            Plan link or ID
          </label>
          <input
            id="plan_id"
            name="plan_id"
            className="input flex-1 bg-white/90 focus:bg-white text-sm"
            placeholder="Plan link or ID (e.g. 8af0fac6-a8f4-456a...)"
            autoComplete="off"
            spellCheck={false}
            required
          />
          <button type="submit" className="btn-primary sm:px-6">
            Open plan
          </button>
        </form>

        {retrieveError && (
          <p className="err mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200" role="alert">
            That did not look like a plan link. Paste the full address or the 36-character ID.
          </p>
        )}
      </section>

      {/* How it works: 4 Elevated Glass Cards with 3D numbered badges */}
      <section aria-labelledby="how" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 id="how" className="text-2xl font-black tracking-tight text-navy-950">
              How it works
            </h2>
            <p className="text-xs text-slate-600 font-medium">Four simple steps to your goal illustration</p>
          </div>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s.t}
              className="glass-card group p-6 hover:shadow-xl hover:border-teal-500/40 transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-teal-500 to-teal-400 font-extrabold text-navy-950 shadow-md shadow-teal-500/20 group-hover:scale-110 transition-transform">
                  {i + 1}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                  STEP 0{i + 1}
                </span>
              </div>
              <h3 className="mt-4 font-bold text-navy-950 text-base group-hover:text-teal-700 transition-colors">
                {s.t}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                {s.d}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
