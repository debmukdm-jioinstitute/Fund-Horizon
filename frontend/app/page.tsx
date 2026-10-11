// TODO(owner-compliance-review): this file contains user-facing copy.
import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";

const STEPS = [
  { t: "About you", d: "Age, income, expenses and what you already have." },
  { t: "Your goals", d: "Retirement, education, a home. Up to six goals with priorities." },
  { t: "Comfort with risk", d: "Ten short questions, on three screens, on how you react to ups and downs." },
  { t: "Your plan", d: "An illustrative allocation and shortlist, SIP amounts and a PDF. Bookmark the link — we cannot email it back." },
];

const PILLARS = [
  {
    icon: "🧮",
    title: "Deterministic Engine",
    desc: "10,000 Monte Carlo simulated paths and historical crisis stress testing. Zero black-box bias.",
  },
  {
    icon: "🔒",
    title: "Zero Data Retention",
    desc: "No phone number, email, or PAN requested. CAS statements are parsed strictly in volatile RAM.",
  },
  {
    icon: "🎯",
    title: "Cashflow First",
    desc: "Emergency fund first, then term life and health cover, then goal SIPs. Clear financial priorities.",
  },
  {
    icon: "💡",
    title: "AI Explanation",
    desc: "Plain-language insights explaining volatility, step-up levers, and diversification.",
  },
];

const FAQS = [
  {
    q: "Why do you not ask for my phone number or email?",
    a: "We believe financial planning should be private and free of marketing calls. You receive a unique 36-character plan link. Bookmark or copy it — we cannot recover lost plans.",
  },
  {
    q: "What does an AMFI mutual fund distributor do?",
    a: "Fund Horizon distributes regular mutual fund schemes. We provide illustrative computational tools, not personalized recommendations.",
  },
  {
    q: "How does the Monte Carlo simulation calculate success chance?",
    a: "We simulate 10,000 forward market paths using historical category returns and volatility, computing how many paths successfully reach your future target.",
  },
  {
    q: "Is my CAS portfolio statement secure?",
    a: "Yes. Your statement and PDF password are processed strictly in volatile memory to calculate portfolio XIRR and asset allocation. Nothing is written to database or disk.",
  },
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
    <div className="space-y-16 md:space-y-24">
      {/* Hero Section: 3D Frosted Glass Container with Radial Lighting & Live Mockup */}
      <section className="relative overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 px-6 py-12 text-white shadow-2xl shadow-navy-950/20 md:px-12 md:py-16 lg:py-20">
        {/* Ambient 3D glow circles inside hero */}
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-indigo-500/15 blur-3xl" />

        <div className="relative z-10 grid gap-12 lg:grid-cols-12 lg:items-center">
          {/* Left Column: Headline and CTAs */}
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-950/70 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-teal-300 backdrop-blur-md">
              <Logo size="sm" variant="dark" showText={false} href="/" />
              <span>Fund Horizon Planner</span>
            </div>

            <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl md:text-5xl lg:text-5xl">
              See how much to invest each month for the goals that matter.
            </h1>

            <p className="mt-5 text-base leading-relaxed text-slate-200 md:text-lg">
              Answer a few questions in about five minutes. You get an illustrative allocation matched to your capacity and
              comfort with risk, a past-performance fund shortlist, a stress test on past data, and a goal-by-goal SIP plan.
            </p>

            <p className="mt-3 text-xs leading-relaxed text-slate-300">
              Fund Horizon is an AMFI-registered mutual fund distributor (execution-only). This planner is an illustration, not a personalised recommendation.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3 sm:gap-4">
              <Link
                href="/plan/new"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-teal-400 to-teal-500 px-7 py-3.5 text-sm font-extrabold text-navy-950 shadow-3d-btn-accent transition-all hover:scale-105 active:scale-95"
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

            <div className="mt-6 flex items-center gap-2.5 text-xs text-slate-300">
              <span className="flex h-2 w-2 rounded-full bg-teal-400 shadow-glow-teal" />
              <span>
                No PAN, phone or email needed. Only your first name and age. Takes about five minutes.
                Keep the plan link — if you lose it, we cannot recover it.
              </span>
            </div>
          </div>

          {/* Right Column: 3D Floating Glass Simulation Preview Mockup */}
          <div className="lg:col-span-5">
            <div className="relative mx-auto max-w-sm rounded-2xl border border-white/20 bg-white/10 p-5 shadow-2xl backdrop-blur-xl animate-float transition-all hover:border-teal-400/40">
              {/* Badge */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-teal-500/20 text-teal-400 text-xs">
                    ✦
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-teal-300">
                    Simulation Preview
                  </span>
                </div>
                <span className="rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-bold text-teal-300 border border-teal-500/30">
                  88% Confidence
                </span>
              </div>

              {/* Goal Mockup Details */}
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs text-slate-300 font-medium">Goal 1 · Target Horizon</p>
                  <p className="text-xl font-black text-white">Retirement Corpus (24 Yrs)</p>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-xl bg-navy-950/60 p-3 border border-white/5">
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Future Target</p>
                    <p className="text-sm font-extrabold text-white">₹4.20 Crore</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-teal-400 uppercase font-semibold">Funded SIP</p>
                    <p className="text-sm font-extrabold text-teal-300">₹24,500 / mo</p>
                  </div>
                </div>

                {/* Mini Asset Allocation Bar */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-[11px] text-slate-300 font-medium">
                    <span>Illustrative Asset Mix</span>
                    <span className="text-teal-300 font-bold">Growth Band</span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-navy-900">
                    <div style={{ width: "65%" }} className="bg-teal-400" title="Equity: 65%" />
                    <div style={{ width: "25%" }} className="bg-indigo-400" title="Debt: 25%" />
                    <div style={{ width: "10%" }} className="bg-amber-400" title="Gold: 10%" />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>Equity 65%</span>
                    <span>Debt 25%</span>
                    <span>Gold 10%</span>
                  </div>
                </div>

                {/* Monte Carlo Simulated Paths note */}
                <div className="rounded-xl bg-teal-500/10 border border-teal-500/20 p-2.5 text-[11px] text-teal-200">
                  <span className="font-bold">10,000 Paths Replayed:</span> Central projection indicates milestone readiness on assumed planning returns.
                </div>
              </div>
            </div>
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

      {/* Four Pillars of Financial Planning Rigor */}
      <section aria-labelledby="pillars" className="space-y-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700">Engineering Excellence</span>
          <h2 id="pillars" className="mt-1 text-2xl font-black tracking-tight text-navy-950 sm:text-3xl">
            Built for mathematical clarity, not marketing.
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Every SIP calculation and risk band is derived from peer-reviewed financial mathematics and official AMFI historical metrics.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div key={p.title} className="card-3d bg-white/80 p-6 backdrop-blur-md">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 border border-teal-200/60 text-xl shadow-sm">
                {p.icon}
              </span>
              <h3 className="mt-4 text-base font-bold text-navy-950">{p.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works: 4 Elevated Glass Cards with 3D numbered badges */}
      <section aria-labelledby="how" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-teal-700">Step-by-Step Experience</span>
            <h2 id="how" className="mt-1 text-2xl font-black tracking-tight text-navy-950">
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

      {/* Platform Capabilities & Intelligence Hub */}
      <section aria-labelledby="tools" className="space-y-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700">Integrated Toolkit</span>
          <h2 id="tools" className="mt-1 text-2xl font-black tracking-tight text-navy-950 sm:text-3xl">
            Explore mutual fund analytics tools.
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Deep diagnostics across 3,600+ regular plans, historical rolling returns, and instant statement parsing.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Tool 1 */}
          <Link
            href="/funds/compare"
            className="card-3d group bg-white/80 p-6 backdrop-blur-md transition-all hover:border-teal-500/40"
          >
            <span className="text-2xl">⚖️</span>
            <h3 className="mt-3 text-lg font-bold text-navy-950 group-hover:text-teal-700 transition-colors">
              Scheme Comparator →
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Compare 2 to 8 mutual fund schemes side-by-side with 3Y/5Y CAGR, volatility, Sharpe ratio, and correlation matrices.
            </p>
          </Link>

          {/* Tool 2 */}
          <Link
            href="/cas"
            className="card-3d group bg-white/80 p-6 backdrop-blur-md transition-all hover:border-teal-500/40"
          >
            <span className="text-2xl">📑</span>
            <h3 className="mt-3 text-lg font-bold text-navy-950 group-hover:text-teal-700 transition-colors">
              CAS Portfolio Diagnosis →
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Upload your CAMS, KFintech, NSDL, or CDSL statement to compute portfolio XIRR and asset allocation strictly in memory.
            </p>
          </Link>

          {/* Tool 3 */}
          <Link
            href="/funds/ask"
            className="card-3d group bg-white/80 p-6 backdrop-blur-md transition-all hover:border-teal-500/40"
          >
            <span className="text-2xl">🔍</span>
            <h3 className="mt-3 text-lg font-bold text-navy-950 group-hover:text-teal-700 transition-colors">
              Scheme Knowledge Base →
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Query historical data across 3,600+ schemes with source-backed citations powered by vector RAG.
            </p>
          </Link>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section aria-labelledby="faq" className="space-y-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-teal-700">Transparency</span>
          <h2 id="faq" className="mt-1 text-2xl font-black tracking-tight text-navy-950 sm:text-3xl">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {FAQS.map((item) => (
            <div key={item.q} className="rounded-2xl border border-slate-200/80 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
              <h3 className="text-sm font-bold text-navy-950">{item.q}</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="relative overflow-hidden rounded-3xl border border-teal-200/60 bg-gradient-to-r from-teal-50 via-white to-teal-50 p-8 shadow-glass backdrop-blur-xl md:p-12 text-center">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="mx-auto flex justify-center">
            <Logo size="lg" showSubtitle={false} href="/" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-navy-950 sm:text-3xl">
            Plan your financial milestones with confidence.
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Takes five minutes. Zero sign-up. 100% deterministic illustrations for retirement, children&apos;s education, and home goals.
          </p>
          <div className="pt-2">
            <Link
              href="/plan/new"
              className="btn-accent px-8 py-3.5 text-base shadow-3d-btn-accent inline-flex items-center gap-2"
            >
              Start your plan now →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
