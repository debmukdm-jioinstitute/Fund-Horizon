// TODO(owner-compliance-review): this file contains user-facing copy.
import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import Hero from "@/components/landing/Hero";
import { DashboardPreview, FeatureStrip, GoalCards, RiskAndFunds } from "@/components/landing/Sections";
import { MotionRoot, Reveal } from "@/components/landing/motion";
import { API_URL } from "@/lib/api";

const HOUSES_COUNT = 55;

async function eligibleFunds(): Promise<number | null> {
  try {
    const res = await fetch(`${process.env.API_INTERNAL_URL ?? API_URL}/healthz`, { next: { revalidate: 3600 } });
    const n = res.ok ? Number((await res.json()).eligible_funds) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

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
    desc: "We never collect PAN. Creating an account needs your name, email and mobile number; the plan-link flow needs nothing. CAS statements are parsed strictly in volatile RAM.",
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
    q: "Do I need to share my phone number or email to use Fund Horizon?",
    a: "Only when you create an account — signup asks for your name, email and mobile number. The plan-link flow needs nothing: no PAN, no phone, no email. You receive a unique 36-character plan link. Bookmark or copy it — we cannot recover lost plans.",
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

export default async function Home({ searchParams }: { searchParams?: { retrieve?: string } }) {
  const retrieveError = searchParams?.retrieve === "invalid";
  const funds = await eligibleFunds();

  return (
    <MotionRoot>
    <div className="space-y-16 md:space-y-24">
      <Hero funds={funds} houses={HOUSES_COUNT} />
      <FeatureStrip />
      <GoalCards />
      <RiskAndFunds funds={funds} houses={HOUSES_COUNT} />
      <DashboardPreview />

      {/* Retrieve Plan Section: Frosted Glass Card with 3D Input */}
      <Reveal><section
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
              Paste the plan link or the ID from the results page. A plan made without an account never asks for a phone or email, so this link is the only way back.
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
      </section></Reveal>

      {/* Four Pillars of Financial Planning Rigor */}
      <Reveal><section aria-labelledby="pillars" className="space-y-6">
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
      </section></Reveal>

      {/* How it works: 4 Elevated Glass Cards with 3D numbered badges */}
      <Reveal><section aria-labelledby="how" className="space-y-4">
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
      </section></Reveal>

      {/* Platform Capabilities & Intelligence Hub */}
      <Reveal><section id="explore-tools" aria-labelledby="tools" className="scroll-mt-24 space-y-6">
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

          {/* Tax tools */}
          <Link
            href="/tax"
            className="card-3d group bg-white/80 p-6 backdrop-blur-md transition-all hover:border-teal-500/40"
          >
            <span className="text-2xl">🧾</span>
            <h3 className="mt-3 text-lg font-bold text-navy-950 group-hover:text-teal-700 transition-colors">
              Tax Calculator →
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              Compare the old and new regimes for FY 2026-27 and see which deductions and saving ideas may apply to you.
            </p>
          </Link>

          <Link
            href="/learn"
            className="card-3d group bg-white/80 p-6 backdrop-blur-md transition-all hover:border-teal-500/40"
          >
            <span className="text-2xl">📚</span>
            <h3 className="mt-3 text-lg font-bold text-navy-950 group-hover:text-teal-700 transition-colors">
              Schemes Explained →
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
              PPF, NPS, ELSS, SSY, SCSS, FDs, funds and more: who each suits, lock-in, risk and how it is taxed.
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
      </section></Reveal>

      {/* Frequently Asked Questions */}
      <Reveal><section aria-labelledby="faq" className="space-y-6">
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
      </section></Reveal>

      {/* Bottom CTA Banner */}
      <Reveal><section className="relative overflow-hidden rounded-3xl border border-teal-200/60 bg-gradient-to-r from-teal-50 via-white to-teal-50 p-8 shadow-glass backdrop-blur-xl md:p-12 text-center">
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
      </section></Reveal>
    </div>
    </MotionRoot>
  );
}
