"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.
import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRef } from "react";
import { CountUp } from "./motion";

const EASE = [0.2, 0, 0, 1] as const;

function Mountains() {
  return (
    <svg viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EAF4FB" />
          <stop offset="1" stopColor="#F8FBFD" />
        </linearGradient>
        <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#BFE3EE" stopOpacity=".9" />
          <stop offset="1" stopColor="#E8F5F7" stopOpacity=".4" />
        </linearGradient>
      </defs>
      <rect width="1440" height="520" fill="url(#sky)" />
      <path d="M0 330 L170 190 L260 260 L380 120 L520 270 L640 200 L800 300 L940 170 L1080 280 L1210 210 L1440 330 V520 H0Z" fill="#C9DDEA" opacity=".55" />
      <path d="M0 380 L140 280 L250 340 L410 220 L560 350 L700 290 L860 370 L1010 250 L1150 350 L1290 290 L1440 380 V520 H0Z" fill="#A9C8D9" opacity=".6" />
      <path d="M0 430 L120 370 L280 420 L430 350 L600 430 L760 380 L930 440 L1100 370 L1280 430 L1440 390 V520 H0Z" fill="#7FB2A8" opacity=".5" />
      <rect y="440" width="1440" height="80" fill="url(#lake)" />
    </svg>
  );
}

function SampleChart() {
  const pts = "M0 92 C28 88 40 70 62 74 C86 78 94 52 120 56 C146 60 152 36 178 30 C198 26 206 14 230 8";
  return (
    <svg viewBox="0 0 240 110" className="h-28 w-full" aria-hidden>
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16A34A" stopOpacity=".28" />
          <stop offset="1" stopColor="#16A34A" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={`${pts} V110 H0Z`} fill="url(#area)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.8 }} />
      <motion.path
        d={pts}
        fill="none"
        stroke="#16A34A"
        strokeWidth="3"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.7, duration: 1.6, ease: EASE }}
      />
      <motion.circle cx="230" cy="8" r="5" fill="#16A34A" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 2.2, type: "spring", stiffness: 300 }} />
    </svg>
  );
}

function Tile({ label, value, tone, delay }: { label: string; value: string; tone: string; delay: number }) {
  return (
    <motion.div
      className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/80 px-3.5 py-3 shadow-sm"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.6, ease: EASE }}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold ${tone}`} aria-hidden>
        ₹
      </span>
      <div>
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <p className="text-sm font-extrabold text-navy-950">{value}</p>
      </div>
    </motion.div>
  );
}

export default function Hero({ funds, houses }: { funds: number | null; houses: number }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const cardY = useTransform(scrollYProgress, [0, 1], ["0%", "-8%"]);
  const words = ["Smarter", "Investing", "for", "a"];

  return (
    <section ref={ref} className="relative isolate overflow-hidden rounded-3xl border border-white/70 shadow-glass-lg">
      <motion.div aria-hidden style={{ y: bgY }} className="absolute inset-0 -z-10 scale-110">
        <Mountains />
      </motion.div>
      <div aria-hidden className="absolute -right-20 -top-20 -z-10 h-80 w-80 rounded-full bg-emerald-300/25 blur-3xl" />

      <div className="grid gap-10 px-6 py-12 md:px-12 md:py-16 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6">
          <h1 className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-navy-950 sm:text-5xl lg:text-6xl">
            {words.map((w, i) => (
              <motion.span
                key={w + i}
                className="mr-3 inline-block"
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.7, ease: EASE }}
              >
                {w}
              </motion.span>
            ))}
            <motion.span
              className="inline-block bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.7, ease: EASE }}
            >
              Brighter Tomorrow
            </motion.span>
          </h1>

          <motion.p
            className="mt-5 max-w-xl text-base leading-relaxed text-slate-700 md:text-lg"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.7, ease: EASE }}
          >
            Goal-based planning with the clarity you need to build a stronger financial future. Answer a few questions and get an
            illustrative allocation, a past-performance fund shortlist, a stress test and a goal-by-goal SIP plan.
          </motion.p>

          <motion.p
            className="mt-3 max-w-xl text-xs leading-relaxed text-slate-600"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.7 }}
          >
            Fund Horizon is an AMFI-registered mutual fund distributor (execution-only). This planner is an illustration, not a personalised recommendation.
          </motion.p>

          <motion.div
            className="mt-7 flex flex-wrap items-center gap-3"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.7, ease: EASE }}
          >
            <Link
              href="/plan/new"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-7 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-600/30 transition hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0"
            >
              Start your plan
              <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
            </Link>
            <a
              href="#explore-tools"
              className="inline-flex items-center rounded-xl border border-slate-300/80 bg-white/80 px-6 py-3.5 text-sm font-bold text-navy-900 backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              Explore tools
            </a>
          </motion.div>

          <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4">
            {[
              { v: funds ?? 1700, s: funds ? "" : "+", l: "Regular plans covered" },
              { v: houses, s: "", l: "Fund houses" },
              { v: 10000, s: "", l: "Simulated paths per goal" },
            ].map((x, i) => (
              <motion.div key={x.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 + i * 0.1, duration: 0.6, ease: EASE }}>
                <dt className="sr-only">{x.l}</dt>
                <dd className="text-2xl font-extrabold text-navy-950">
                  <CountUp to={x.v} suffix={x.s} />
                </dd>
                <p className="text-[11px] font-medium text-slate-600">{x.l}</p>
              </motion.div>
            ))}
          </dl>
        </div>

        <motion.div style={{ y: cardY }} className="lg:col-span-6">
          <motion.div
            className="relative mx-auto max-w-lg"
            initial={{ opacity: 0, y: 40, rotate: -1 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: 0.4, duration: 0.9, ease: EASE }}
          >
            <div className="animate-float rounded-3xl border border-white/80 bg-white/70 p-5 shadow-2xl shadow-navy-900/10 backdrop-blur-xl">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-medium text-slate-500">Sample portfolio value</p>
                  <p className="text-3xl font-extrabold text-navy-950">
                    <CountUp to={2475430} prefix="₹" duration={2} />
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">▲ sample 12.4%</span>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-5">
                <div className="sm:col-span-3">
                  <SampleChart />
                  <div className="mt-1 flex gap-1 text-[10px] font-semibold text-slate-500" aria-hidden>
                    {["1M", "6M", "1Y", "3Y", "All"].map((t) => (
                      <span key={t} className={`rounded-md px-2 py-0.5 ${t === "1Y" ? "bg-emerald-600 text-white" : ""}`}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Tile label="Mutual funds" value="₹18,40,200" tone="bg-emerald-100 text-emerald-700" delay={1} />
                  <Tile label="SIPs" value="₹4,20,000" tone="bg-indigo-100 text-indigo-700" delay={1.15} />
                  <Tile label="Goals" value="₹2,15,230" tone="bg-amber-100 text-amber-700" delay={1.3} />
                </div>
              </div>
              <p className="mt-3 text-[10px] text-slate-500">Illustration with sample numbers. Not your data and not a forecast.</p>
            </div>
            <motion.span
              aria-hidden
              className="absolute -right-3 -top-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-lg text-white shadow-lg"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 1.6, type: "spring", stiffness: 260, damping: 14 }}
            >
              ↗
            </motion.span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
