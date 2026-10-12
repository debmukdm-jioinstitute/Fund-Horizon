"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { NumberField } from "@/components/Field";
import { inr } from "@/lib/format";

function parseNum(v: string, fallback = 0): number {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) ? fallback : n;
}

function DecimalField({ id, label, value, onChange, suffix }: {
  id: string; label: string; value: string; onChange: (v: string) => void; suffix?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input
          id={id}
          className="input pr-10"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-describedby={suffix ? `${id}-suffix` : undefined}
        />
        {suffix && (
          <span id={`${id}-suffix`} aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-navy-500">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function IllustrativeNote() {
  return (
    <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700">
      Illustrative result only — a simplified mathematical estimate, not financial guidance.
    </p>
  );
}

export default function PlannerPage({ params }: { params: { id: string } }) {
  const { id } = params;

  // (a) Required SIP
  const [fvTarget, setFvTarget] = useState("10000000");
  const [sipYears, setSipYears] = useState("10");
  const [sipReturn, setSipReturn] = useState("12");

  const requiredSip = useMemo(() => {
    const FV = parseNum(fvTarget);
    const years = parseNum(sipYears);
    const r = parseNum(sipReturn) / 1200;
    const n = Math.round(years * 12);
    if (n <= 0 || FV <= 0) return null;
    if (r === 0) return FV / n;
    const growth = Math.pow(1 + r, n);
    return (FV * r) / ((growth - 1) * (1 + r));
  }, [fvTarget, sipYears, sipReturn]);

  // (b) Future value with step-up
  const [fvSip, setFvSip] = useState("10000");
  const [fvYears, setFvYears] = useState("10");
  const [fvReturn, setFvReturn] = useState("12");
  const [stepUp, setStepUp] = useState("0");

  const futureValue = useMemo(() => {
    const sip0 = parseNum(fvSip);
    const years = parseNum(fvYears);
    const r = parseNum(fvReturn) / 1200;
    const su = parseNum(stepUp) / 100;
    const n = Math.round(years * 12);
    if (n <= 0 || sip0 < 0) return null;
    let total = 0;
    for (let m = 0; m < n; m += 1) {
      const sip = sip0 * Math.pow(1 + su, Math.floor(m / 12));
      total += sip * Math.pow(1 + r, n - 1 - m);
    }
    return total;
  }, [fvSip, fvYears, fvReturn, stepUp]);

  // (c) Inflation-adjusted target
  const [todayCost, setTodayCost] = useState("1000000");
  const [infYears, setInfYears] = useState("20");
  const [inflation, setInflation] = useState("6");

  const inflatedCost = useMemo(() => {
    const cost = parseNum(todayCost);
    const years = parseNum(infYears);
    const i = parseNum(inflation) / 100;
    if (years <= 0 || cost < 0) return null;
    return cost * Math.pow(1 + i, years);
  }, [todayCost, infYears, inflation]);

  return (
    <main className="w-full px-4 py-6">
      <Link href={`/portal/${id}`} className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline">
        &larr; Back to portal
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold text-navy-900">Financial Planner</h1>
      <p className="mt-1 text-sm text-navy-600">
        Three quick calculators for goal planning. Everything here runs in your browser — no data leaves this page —
        and every result is illustrative, not financial guidance.
      </p>

      {/* (a) Required SIP */}
      <section className="card mt-6" aria-labelledby="calc-sip">
        <h2 id="calc-sip" className="font-display text-lg font-semibold text-navy-900">
          How much SIP do I need for a target?
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <NumberField id="sip-fv" label="Target amount (₹)" value={fvTarget} onChange={setFvTarget} money />
          <NumberField id="sip-years" label="Years" value={sipYears} onChange={setSipYears} />
          <DecimalField id="sip-ret" label="Expected annual return" value={sipReturn} onChange={setSipReturn} suffix="% p.a." />
        </div>
        <div className="mt-4 rounded-xl bg-navy-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-navy-500">Illustrative monthly SIP</p>
          <p className="font-display text-2xl font-bold text-navy-900">{requiredSip === null ? "–" : inr(requiredSip)}</p>
        </div>
        <div className="mt-3 space-y-2">
          <IllustrativeNote />
          <p className="text-xs text-navy-500">
            Formula: SIP = FV &times; r / (((1+r)<sup>n</sup> &minus; 1) &times; (1+r)), where r = annual return &divide; 12 and n = years &times; 12.
            When r = 0, SIP = FV / n.
          </p>
        </div>
      </section>

      {/* (b) Future value */}
      <section className="card mt-6" aria-labelledby="calc-fv">
        <h2 id="calc-fv" className="font-display text-lg font-semibold text-navy-900">
          What could my SIP grow into?
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField id="fv-sip" label="Monthly SIP (₹)" value={fvSip} onChange={setFvSip} money />
          <NumberField id="fv-years" label="Years" value={fvYears} onChange={setFvYears} />
          <DecimalField id="fv-ret" label="Expected annual return" value={fvReturn} onChange={setFvReturn} suffix="% p.a." />
          <DecimalField id="fv-stepup" label="Yearly SIP step-up" value={stepUp} onChange={setStepUp} suffix="% p.a." />
        </div>
        <div className="mt-4 rounded-xl bg-navy-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-navy-500">Illustrative future value</p>
          <p className="font-display text-2xl font-bold text-navy-900">{futureValue === null ? "–" : inr(futureValue)}</p>
        </div>
        <div className="mt-3 space-y-2">
          <IllustrativeNote />
          <p className="text-xs text-navy-500">
            Formula: &Sigma; over each month m of SIP &times; (1+step-up)<sup>floor(m/12)</sup> &times; (1+r)<sup>n&minus;1&minus;m</sup>,
            where r = annual return &divide; 12 and n = years &times; 12. The step-up increases your SIP at the start of each year.
          </p>
        </div>
      </section>

      {/* (c) Inflation-adjusted target */}
      <section className="card mt-6" aria-labelledby="calc-inf">
        <h2 id="calc-inf" className="font-display text-lg font-semibold text-navy-900">
          What will a goal cost in the future?
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <NumberField id="inf-cost" label="Cost today (₹)" value={todayCost} onChange={setTodayCost} money />
          <NumberField id="inf-years" label="Years from now" value={infYears} onChange={setInfYears} />
          <DecimalField id="inf-rate" label="Inflation" value={inflation} onChange={setInflation} suffix="% p.a." />
        </div>
        <div className="mt-4 rounded-xl bg-navy-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-navy-500">Illustrative future cost</p>
          <p className="font-display text-2xl font-bold text-navy-900">{inflatedCost === null ? "–" : inr(inflatedCost)}</p>
        </div>
        <div className="mt-3 space-y-2">
          <IllustrativeNote />
          <p className="text-xs text-navy-500">
            Formula: future cost = today&apos;s cost &times; (1 + inflation)<sup>years</sup>.
          </p>
        </div>
      </section>
    </main>
  );
}
