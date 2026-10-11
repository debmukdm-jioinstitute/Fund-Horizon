"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.
import { motion } from "framer-motion";
import Link from "next/link";
import { CountUp, Reveal, Stagger, StaggerItem } from "./motion";

const EASE = [0.2, 0, 0, 1] as const;

/* ---------- Feature strip ---------- */
const FEATURES = [
  { t: "Personalised planning", d: "Built around your goals and cash flow.", c: "bg-emerald-100 text-emerald-700", i: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0" },
  { t: "Transparent method", d: "Every number comes from a stated formula.", c: "bg-sky-100 text-sky-700", i: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zm-3 9l2 2 4-4" },
  { t: "Goal-based investing", d: "Separate SIPs for each goal and horizon.", c: "bg-teal-100 text-teal-700", i: "M12 21a9 9 0 100-18 9 9 0 000 18zm0-5a4 4 0 100-8 4 4 0 000 8z" },
  { t: "Private by design", d: "No PAN, phone or email needed.", c: "bg-indigo-100 text-indigo-700", i: "M7 11V8a5 5 0 0110 0v3m-12 0h14v10H5V11z" },
];

export function FeatureStrip() {
  return (
    <Stagger className="grid gap-3 rounded-3xl border border-white/70 bg-white/80 p-4 shadow-glass backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map((f) => (
        <StaggerItem key={f.t} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-slate-50">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${f.c}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={f.i} />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold text-navy-950">{f.t}</p>
            <p className="text-xs text-slate-600">{f.d}</p>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/* ---------- Goal cards ---------- */
const GOALS = [
  { photo: "home", t: "Buy a Home", d: "Build your down payment with a clear plan.", from: "from-sky-100", to: "to-sky-50", icon: "M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9z", c: "text-sky-700 bg-sky-200/70" },
  { photo: "education", t: "Child's Education", d: "Give them the opportunities you want to.", from: "from-violet-100", to: "to-violet-50", icon: "M12 3L2 8l10 5 10-5-10-5zm-6 8v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5", c: "text-violet-700 bg-violet-200/70" },
  { photo: "retirement", t: "Retirement", d: "A relaxed and worry-free tomorrow.", from: "from-emerald-100", to: "to-emerald-50", icon: "M12 2a5 5 0 015 5c0 3-2 4-2 7h-6c0-3-2-4-2-7a5 5 0 015-5zm-3 16h6m-5 3h4", c: "text-emerald-700 bg-emerald-200/70" },
  { photo: "vacation", t: "Dream Vacation", d: "Explore the world on your terms.", from: "from-amber-100", to: "to-amber-50", icon: "M2 16l20-8-6 14-4-6-6 2-4-2zm8-2l8-6", c: "text-amber-700 bg-amber-200/70" },
];

export function GoalCards() {
  return (
    <section aria-labelledby="goals" className="space-y-5">
      <Reveal>
        <h2 id="goals" className="font-display text-3xl font-extrabold tracking-tight text-navy-950">
          Plan for <span className="text-emerald-600">What Matters Most</span>
        </h2>
        <p className="mt-1 text-sm text-slate-600">Turn your goals into achievable monthly amounts with a structured, personalised illustration.</p>
      </Reveal>
      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GOALS.map((g) => (
          <StaggerItem key={g.t}>
            <Link
              href="/plan/new"
              className={`group relative block h-full min-h-[10.5rem] overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br ${g.from} ${g.to} p-5 shadow-sm transition duration-300 hover:-translate-y-1.5 hover:shadow-xl`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/photos/${g.photo}.webp`}
                alt=""
                loading="lazy"
                className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 object-cover transition-transform duration-700 [mask-image:linear-gradient(to_right,transparent,black_50%)] group-hover:scale-110"
              />
              <span className={`relative flex h-11 w-11 items-center justify-center rounded-2xl ${g.c} transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={g.icon} />
                </svg>
              </span>
              <h3 className="relative mt-4 text-lg font-extrabold text-navy-950">{g.t}</h3>
              <p className="relative mt-1 max-w-[9rem] text-xs leading-relaxed text-slate-700">{g.d}</p>
              <span aria-hidden className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sm text-navy-900 shadow transition group-hover:translate-x-1 group-hover:bg-emerald-600 group-hover:text-white">→</span>
              
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

/* ---------- Risk gauge + fund universe ---------- */
const HOUSES = [
  "hdfc.svg", "icici-prudential-amc.svg", "sbi.svg", "nippon-india.png", "kotak.png", "axis.png", "aditya-birla-sun-life.png", "uti.webp",
  "mirae-asset.png", "dsp.png", "tata.svg", "franklin-templeton.png", "invesco.png", "hsbc.png", "lic.png", "sundaram.svg", "canara-robeco.png", "union.png",
];

function Gauge() {
  const R = 78;
  const C = Math.PI * R;
  return (
    <div className="relative mx-auto w-full max-w-[16rem]">
      <svg viewBox="0 0 200 110" className="w-full" aria-hidden>
        <path d="M22 100 A78 78 0 0 1 178 100" fill="none" stroke="#E2E8F0" strokeWidth="18" strokeLinecap="round" />
        <motion.path
          d="M22 100 A78 78 0 0 1 178 100"
          fill="none"
          stroke="url(#g)"
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          whileInView={{ strokeDashoffset: C * 0.38 }}
          viewport={{ once: true }}
          transition={{ duration: 1.6, ease: EASE }}
        />
        <defs>
          <linearGradient id="g" x1="0" x2="1">
            <stop offset="0" stopColor="#22C55E" />
            <stop offset="1" stopColor="#0EA5E9" />
          </linearGradient>
        </defs>
        <motion.g
          style={{ originX: "100px", originY: "100px" }}
          initial={{ rotate: -90 }}
          whileInView={{ rotate: 12 }}
          viewport={{ once: true }}
          transition={{ duration: 1.6, ease: [0.34, 1.4, 0.64, 1] }}
        >
          <line x1="100" y1="100" x2="100" y2="34" stroke="#0B2545" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="100" cy="100" r="7" fill="#0B2545" />
        </motion.g>
      </svg>
      <div className="-mt-1 text-center">
        <p className="text-lg font-extrabold text-navy-950">Your band</p>
        <p className="text-xs text-slate-600">Capacity and comfort combine into one risk band.</p>
      </div>
    </div>
  );
}

export function RiskAndFunds({ funds, houses }: { funds: number | null; houses: number }) {
  const row = [...HOUSES, ...HOUSES];
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Reveal className="rounded-3xl border border-white/80 bg-white/80 p-6 shadow-glass backdrop-blur-xl lg:col-span-2">
        <h2 className="font-display text-2xl font-extrabold text-navy-950">Know Your Risk Profile</h2>
        <p className="mt-1 text-xs text-slate-600">We take the lower of what you can afford and what you are comfortable with.</p>
        <div className="mt-5">
          <Gauge />
        </div>
        <Link href="/plan/new" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-900 transition hover:border-emerald-400 hover:text-emerald-700">
          Take the risk questions <span aria-hidden>→</span>
        </Link>
      </Reveal>

      <Reveal delay={0.1} className="overflow-hidden rounded-3xl border border-white/80 bg-white/80 p-6 shadow-glass backdrop-blur-xl lg:col-span-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold text-navy-950">Discover the Right Funds</h2>
            <p className="mt-1 text-xs text-slate-600">
              Regular plans from {houses} fund houses, screened on past data for a shortlist that fits each goal. Past performance may or may not be sustained.
            </p>
          </div>
          <Link href="/funds/compare" className="shrink-0 text-xs font-bold text-emerald-700 hover:underline">Compare funds →</Link>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-3xl font-extrabold text-emerald-700"><CountUp to={funds ?? 1700} suffix={funds ? "" : "+"} /></p>
            <p className="text-xs font-medium text-emerald-900/80">Regular plans in the screen</p>
          </div>
          <div className="rounded-2xl bg-sky-50 p-4">
            <p className="text-3xl font-extrabold text-sky-700"><CountUp to={houses} /></p>
            <p className="text-xs font-medium text-sky-900/80">Fund houses covered</p>
          </div>
        </div>

        <div className="relative mt-5" aria-label="Some of the fund houses covered">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-white to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-white to-transparent" />
          <div className="marquee animate-marquee flex w-max items-center gap-4">
            {row.map((h, i) => (
              <div key={h + i} className="flex h-14 w-28 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-white px-3 shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brands/${h}`} alt="" className="max-h-9 w-auto max-w-full object-contain" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
        <p className="mt-3 text-[10px] text-slate-500">Company names and logos belong to their owners.</p>
      </Reveal>
    </div>
  );
}

/* ---------- Dashboard preview ---------- */
function Ring({ pct, label, sub, color, delay }: { pct: number; label: string; sub: string; color: string; delay: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="text-center">
      <svg viewBox="0 0 64 64" className="mx-auto h-16 w-16 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" stroke="#E2E8F0" strokeWidth="6" />
        <motion.circle
          cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={C}
          initial={{ strokeDashoffset: C }} whileInView={{ strokeDashoffset: C * (1 - pct / 100) }} viewport={{ once: true }}
          transition={{ duration: 1.3, delay, ease: EASE }}
        />
      </svg>
      <p className="-mt-11 mb-6 text-sm font-extrabold text-navy-950"><CountUp to={pct} suffix="%" duration={1.3} /></p>
      <p className="text-[11px] font-bold text-navy-900">{label}</p>
      <p className="text-[10px] text-slate-500">{sub}</p>
    </div>
  );
}

const MIX = [
  { l: "Equity", v: 62, c: "#2563EB" },
  { l: "Debt", v: 18, c: "#16A34A" },
  { l: "Hybrid", v: 12, c: "#F59E0B" },
  { l: "Liquid", v: 8, c: "#94A3B8" },
];

function Donut() {
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90" aria-hidden>
      {MIX.map((m, i) => {
        const len = (m.v / 100) * C;
        const off = -acc;
        acc += len;
        return (
          <motion.circle
            key={m.l} cx="50" cy="50" r={R} fill="none" stroke={m.c} strokeWidth="14"
            strokeDasharray={`${len - 1.5} ${C}`} strokeDashoffset={off}
            initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.15 * i, ease: EASE }}
          />
        );
      })}
    </svg>
  );
}

export function DashboardPreview() {
  return (
    <section aria-labelledby="dash" className="space-y-5">
      <Reveal>
        <h2 id="dash" className="font-display text-3xl font-extrabold tracking-tight text-navy-950">Your Complete Financial Plan</h2>
        <p className="mt-1 text-sm text-slate-600">See each goal, the monthly SIP and the asset mix in one place. The figures below are a sample illustration.</p>
      </Reveal>
      <Stagger className="grid gap-4 lg:grid-cols-3">
        <StaggerItem className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-glass">
          <p className="text-sm font-extrabold text-navy-950">Goal progress</p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Ring pct={68} label="Home" sub="₹48L / 70L" color="#16A34A" delay={0} />
            <Ring pct={45} label="Education" sub="₹9L / 20L" color="#2563EB" delay={0.1} />
            <Ring pct={32} label="Retire" sub="₹32L / 1Cr" color="#7C3AED" delay={0.2} />
            <Ring pct={75} label="Trip" sub="₹6L / 8L" color="#F59E0B" delay={0.3} />
          </div>
        </StaggerItem>
        <StaggerItem className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-glass">
          <p className="text-sm font-extrabold text-navy-950">Monthly SIP summary</p>
          <p className="mt-3 text-3xl font-extrabold text-navy-950"><CountUp to={25000} prefix="₹" /></p>
          <p className="text-xs text-slate-500">Total SIP amount, sample</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-xl font-extrabold text-emerald-700"><CountUp to={5} /></p><p className="text-slate-600">Active SIPs</p></div>
            <div className="rounded-2xl bg-indigo-50 p-3"><p className="text-xl font-extrabold text-indigo-700">₹12.4L</p><p className="text-slate-600">Total invested</p></div>
          </div>
        </StaggerItem>
        <StaggerItem className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-glass">
          <p className="text-sm font-extrabold text-navy-950">Portfolio allocation</p>
          <div className="mt-3 flex items-center gap-4">
            <Donut />
            <ul className="space-y-1.5 text-xs">
              {MIX.map((m) => (
                <li key={m.l} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.c }} aria-hidden />
                  <span className="w-12 text-slate-600">{m.l}</span>
                  <span className="font-bold text-navy-950">{m.v}%</span>
                </li>
              ))}
            </ul>
          </div>
        </StaggerItem>
      </Stagger>
    </section>
  );
}
