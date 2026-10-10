"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import Link from "next/link";
import { FanChart, Gauge } from "@/components/charts";
import { CATEGORY_LABELS, STATUS_LABELS, inr, pct, shortInr } from "@/lib/format";
import type { FundPick, GoalPlan, Plan, Profile } from "@/lib/types";

export function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="mb-3 text-xl font-bold">{children}</h2>;
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="font-semibold">{value.toFixed(0)} / 100</span></div>
      <div className="mt-1 h-3 rounded-full bg-navy-100" role="img" aria-label={`${label} ${value.toFixed(0)} out of 100`}>
        <div className={`h-3 rounded-full ${tone}`} style={{ width: `${Math.max(2, value)}%` }} />
      </div>
    </div>
  );
}

export function ProfileCard({ profile }: { profile: Profile }) {
  return (
    <div className="space-y-4">
      {profile.priority_actions.length > 0 && (
        <div className="rounded-xl border border-amber-600 bg-amber-100 p-4" role="note">
          <h3 className="font-bold text-amber-600">Priority actions</h3>
          <ul className="mt-1 list-disc pl-5 text-navy-900">
            {profile.priority_actions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      <div className="card grid gap-5 md:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="text-sm text-navy-700">Suggested band</p>
          <p className="text-3xl font-bold text-teal-700">{profile.band}</p>
          <p className="mt-1 text-sm text-navy-700">Final score {profile.final_score.toFixed(0)} / 100, the lower of capacity and comfort.</p>
        </div>
        <div className="space-y-3">
          <Bar label="Capacity to take risk" value={profile.capacity.score} tone="bg-navy-900" />
          <Bar label="Comfort with risk" value={profile.tolerance} tone="bg-teal-600" />
          {profile.notes.map((n) => <p key={n} className="text-sm text-navy-700">{n}</p>)}
        </div>
      </div>
    </div>
  );
}

export function FundTable({ funds }: { funds: FundPick[] }) {
  const compareCodes = funds.map((f) => f.scheme_code).join(",");
  return (
    <div className="card overflow-x-auto p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-navy-50 border-b border-navy-100">
        <span className="text-xs font-medium text-navy-700">
          Ranked shortlist based on historical consistency and downside protection.
        </span>
        {funds.length >= 2 && (
          <Link
            href={`/funds/compare?codes=${compareCodes}`}
            className="rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800 transition-colors"
          >
            Compare All Shortlisted Schemes →
          </Link>
        )}
      </div>
      <table className="w-full min-w-[820px] text-left">
        <caption className="sr-only">Illustrative fund shortlist ranked by a past-performance composite</caption>
        <thead className="bg-navy-50">
          <tr>
            {["Fund", "Category", "Weight", "3Y CAGR", "5Y CAGR", "3Y volatility", "Max drawdown (3Y)", "Score", "Why it ranked", "Monthly SIP"].map((h) => (
              <th key={h} scope="col" className="th">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {funds.map((f) => (
            <tr key={f.scheme_code} className="border-t border-navy-100">
              <td className="td">
                <span className="font-medium">{f.scheme_name}</span>
                <br />
                <span className="text-xs text-navy-700">Code {f.scheme_code}</span>
                <div className="mt-1">
                  <Link
                    href={`/funds/${f.scheme_code}`}
                    className="text-xs font-semibold text-teal-700 hover:underline"
                  >
                    Deep Analytics →
                  </Link>
                </div>
              </td>
              <td className="td">{CATEGORY_LABELS[f.cat] ?? f.cat}</td>
              <td className="td">{f.weight_pct.toFixed(1)}%</td>
              <td className="td">{pct(f.metrics.cagr_3y)}</td>
              <td className="td">{pct(f.metrics.cagr_5y)}</td>
              <td className="td">{pct(f.metrics.vol_3y)}</td>
              <td className="td">{pct(f.metrics.max_drawdown_3y)}</td>
              <td className="td">{f.score.toFixed(2)}</td>
              <td className="td"><ul className="list-disc pl-4 text-xs">{f.explain.map((e) => <li key={e}>{e}</li>)}
                {f.merged_from.length > 0 && <li>Includes {f.merged_from.map((m) => `${m.weight_pct.toFixed(1)}% from ${CATEGORY_LABELS[m.cat] ?? m.cat}`).join(", ")}</li>}</ul></td>
              <td className="td">{inr(f.suggested_monthly_sip)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  funded: "bg-teal-100 text-teal-700", partially_funded: "bg-amber-100 text-amber-600", unfunded: "bg-rose-100 text-rose-700",
};

export function GoalCard({ goal: g }: { goal: GoalPlan }) {
  const mc = g.monte_carlo;
  const lv = g.levers;
  return (
    <article className="card" aria-label={g.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{g.name}</h3>
          <p className="text-sm text-navy-700">{g.years} years · priority {g.priority} · inflation {pct(g.inflation, 0)} · expected return {pct(g.expected_return)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_TONE[g.status]}`}>{STATUS_LABELS[g.status]}</span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <Item k="Future cost" v={shortInr(g.future_cost)} />
            <Item k="SIP needed" v={`${inr(g.required_sip)} / month`} />
            <Item k="SIP funded" v={`${inr(g.allocated_sip)} / month`} />
            <Item k={`SIP for ~${(mc.target_success * 100).toFixed(0)}% chance`} v={inr(mc.sip_for_target_success)} />
          </dl>
          <div className="flex items-center gap-3">
            <Gauge value={mc.success_prob} />
            <p>Chance of reaching the goal with the funded SIP, from simulated paths. P10 / P50 / P90: {shortInr(mc.p10)} / {shortInr(mc.p50)} / {shortInr(mc.p90)}.</p>
          </div>
          {lv && (
            <div className="rounded-lg bg-navy-50 p-3">
              <p className="font-semibold">Ways to close the gap</p>
              <ul className="list-disc pl-5">
                {lv.extend_horizon && <li>Extend by {lv.extend_horizon.extra_years} year(s): SIP {inr(lv.extend_horizon.required_sip)}</li>}
                {lv.step_up.map((s) => <li key={s.step_up}>{pct(s.step_up, 0)} yearly step-up: first-year SIP {inr(s.first_year_sip)}{s.fits_budget ? " (fits)" : ""}</li>)}
                {lv.lower_target && <li>Lower the target to {inr(lv.lower_target.target_today)} in today&apos;s rupees</li>}
              </ul>
            </div>
          )}
        </div>
        {mc.p90 > 0
          ? <FanChart fan={mc.fan} target={g.future_cost} />
          : <p className="self-center text-sm text-navy-700">No SIP is funded for this goal yet, so there is no projection to chart.</p>}
      </div>
    </article>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-navy-700">{k}</dt><dd className="text-base font-bold">{v}</dd></div>;
}

export function EmergencyCard({ ef }: { ef: Plan["planning"]["emergency_fund"] }) {
  return (
    <div className="card text-sm">
      <h3 className="mb-2 text-lg font-bold">Emergency fund</h3>
      <p>Target: <strong>{inr(ef.target)}</strong> ({ef.target_months} months of expenses and EMIs)</p>
      <p>You hold: <strong>{inr(ef.current)}</strong></p>
      <p>Gap: <strong>{inr(ef.gap)}</strong></p>
      <p className="mt-1 text-navy-700">
        {ef.gap === 0 ? "Your emergency fund meets the target."
          : ef.months_to_close === null ? "There is no monthly surplus to build this from yet."
          : `Setting aside ${inr(ef.monthly_allocation)} a month would close the gap in about ${ef.months_to_close} months.`}
      </p>
    </div>
  );
}

export function InsuranceCard({ ins }: { ins: Plan["planning"]["insurance"] }) {
  return (
    <div className="card text-sm">
      <h3 className="mb-2 text-lg font-bold">Insurance cover</h3>
      <table className="w-full">
        <thead><tr><th className="th">Cover</th><th className="th">Illustrative need</th><th className="th">You have</th><th className="th">Gap</th></tr></thead>
        <tbody>
          <tr className="border-t border-navy-100"><td className="td">Term life</td><td className="td">{shortInr(ins.term.need)}</td><td className="td">{shortInr(ins.term.cover)}</td><td className="td font-semibold">{shortInr(ins.term.gap)}</td></tr>
          <tr className="border-t border-navy-100"><td className="td">Health (family)</td><td className="td">{shortInr(ins.health.target)}</td><td className="td">{shortInr(ins.health.cover)}</td><td className="td font-semibold">{shortInr(ins.health.gap)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-navy-700">
        Term need is a human-life-value estimate. For reference, 15x income is {shortInr(ins.term.reference["15x_income"])} and 20x income is {shortInr(ins.term.reference["20x_income"])}.
      </p>
    </div>
  );
}
