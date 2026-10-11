"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import { useState } from "react";
import Link from "next/link";
import { FanChart, Gauge } from "@/components/charts";
import { CATEGORY_LABELS, inr, pct, shortInr } from "@/lib/format";
import type {
  Disclosures, FundPick, GoalPlan, InsuranceBlock, InsuranceSuggestions as InsuranceSuggestionsData,
  Plan, Profile,
} from "@/lib/types";

/** Extra /api/meta keys from WS5. Absent on older payloads. */
export type ExtraDisclosures = Disclosures & {
  tax_per_goal_note?: string;
  success_prob_note?: string;
  scheme_docs_note?: string;
  sized_status_labels?: Partial<Record<GoalPlan["status"], string>>;
  ranking_disclaimer?: string;
};

export function extraDisclosures(raw?: Disclosures): Pick<ExtraDisclosures, "tax_per_goal_note" | "success_prob_note" | "scheme_docs_note" | "sized_status_labels" | "ranking_disclaimer"> {
  const d = (raw ?? {}) as ExtraDisclosures;
  const labels = d.sized_status_labels;
  return {
    tax_per_goal_note: typeof d.tax_per_goal_note === "string" ? d.tax_per_goal_note : undefined,
    success_prob_note: typeof d.success_prob_note === "string" ? d.success_prob_note : undefined,
    scheme_docs_note: typeof d.scheme_docs_note === "string" ? d.scheme_docs_note : undefined,
    ranking_disclaimer: typeof d.ranking_disclaimer === "string" ? d.ranking_disclaimer : undefined,
    sized_status_labels: labels && typeof labels === "object" ? {
      funded: typeof labels.funded === "string" ? labels.funded : undefined,
      partially_funded: typeof labels.partially_funded === "string" ? labels.partially_funded : undefined,
      unfunded: typeof labels.unfunded === "string" ? labels.unfunded : undefined,
    } : undefined,
  };
}

/** Replace older API headings that still use allocation-as-instruction tone. */
export function safeHeading(raw: string | undefined, fallback: string): string {
  if (typeof raw !== "string" || !raw.trim() || /suggest/i.test(raw)) return fallback;
  return raw;
}

const FALLBACK_SIZED_LABELS: Record<GoalPlan["status"], string> = {
  funded: "Sized at assumed return (central path)",
  partially_funded: "Partly sized at assumed return",
  unfunded: "Not sized yet",
};

export const FALLBACK_SUCCESS_NOTE =
  "A goal marked “sized at assumed return” is on the central path only — often near a 50% chance in the simulation. Chance figures use a constant mix (no glide path) and do not model tax. Work emergency fund, then term cover, then health cover, then goals.";

export const FALLBACK_TAX_PER_GOAL =
  "Pre-tax illustration: the SIP, future cost and chance figures for this goal ignore tax. They do not mean the SIP is enough after tax.";

export const FALLBACK_SCHEME_DOCS =
  "Before investing, read the scheme documents (SID and KIM) on the AMC website or via AMFI. This illustration does not show per-scheme riskometer images.";

export const FALLBACK_SHORTLIST_LINE =
  "Ranked by a past-performance composite (return, rolling median, Sharpe and drawdown) — not a consistency-first score, and not a recommendation. Past figures may not continue.";

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

type SequencedStep = { title: string; detail: string; done: boolean };

export type ExtraTotals = Plan["planning"]["totals"] & {
  unused_surplus?: number;
  emergency_reserved?: number;
};

export function extraTotals(planning: Plan["planning"]): ExtraTotals {
  const t = planning.totals as ExtraTotals;
  return {
    ...t,
    unused_surplus: typeof t.unused_surplus === "number" ? t.unused_surplus : undefined,
    emergency_reserved: typeof t.emergency_reserved === "number" ? t.emergency_reserved : undefined,
  };
}

export function unusedSurplus(planning: Plan["planning"]): number {
  const t = extraTotals(planning);
  if (typeof t.unused_surplus === "number" && Number.isFinite(t.unused_surplus)) return t.unused_surplus;
  return (t.monthly_surplus ?? 0) - (t.allocated_sip ?? 0);
}

export function emergencyReserved(planning: Plan["planning"]): number {
  const t = extraTotals(planning);
  if (typeof t.emergency_reserved === "number" && Number.isFinite(t.emergency_reserved)) {
    return t.emergency_reserved;
  }
  const ef = planning.emergency_fund;
  if (ef && ef.gap > 0 && typeof ef.monthly_allocation === "number") return ef.monthly_allocation;
  return 0;
}

export function isShortlistOmitted(plan: Plan): boolean {
  const flag = (plan as Plan & { shortlist_omitted?: boolean }).shortlist_omitted;
  if (typeof flag === "boolean") return flag;
  const surplus = plan.planning.cashflow?.monthly_surplus ?? plan.planning.totals.monthly_surplus;
  return surplus <= 0 || (plan.planning.totals.allocated_sip ?? 0) <= 0;
}

export type TermNeedRange = { low: number; high: number; hlv?: number; ref15?: number; ref20?: number };

export function termNeedRange(ins: Plan["planning"]["insurance"]): TermNeedRange | null {
  const raw = (ins.term as { need_range?: Record<string, number> }).need_range;
  if (raw && typeof raw.low === "number" && typeof raw.high === "number") {
    return {
      low: raw.low,
      high: raw.high,
      hlv: typeof raw.hlv === "number" ? raw.hlv : undefined,
      ref15: typeof raw["15x_income"] === "number" ? raw["15x_income"] : ins.term.reference?.["15x_income"],
      ref20: typeof raw["20x_income"] === "number" ? raw["20x_income"] : ins.term.reference?.["20x_income"],
    };
  }
  return null;
}

/** Emergency fund, then term, then health, then goals — uses WS1 action strings when present. */
export function buildSequencedActions(profile: Profile, planning?: Plan["planning"]): SequencedStep[] {
  const ef = planning?.emergency_fund;
  const ins = planning?.insurance;
  const totals = planning?.totals;
  const backend = profile.priority_actions ?? [];
  const efAction = backend.find((a) => /emergency/i.test(a));
  const termAction = backend.find((a) => /term cover/i.test(a));
  const healthAction = backend.find((a) => /health cover/i.test(a));
  const legacyIns = backend.find((a) => /insurance first/i.test(a));

  const efGap = typeof ef?.gap === "number" ? ef.gap : null;
  const termGap = typeof ins?.term?.gap === "number" ? ins.term.gap : null;
  const healthGap = typeof ins?.health?.gap === "number" ? ins.health.gap : null;
  const reserved = planning ? emergencyReserved(planning) : 0;

  let efDetail: string;
  if (ef && efGap != null) {
    if (efGap <= 0) {
      efDetail = "Target already met.";
    } else if (ef.months_to_close == null) {
      efDetail = `${efAction ?? "Build emergency fund first"}. Gap ${inr(efGap)} (${ef.target_months} months of expenses and EMIs). No monthly surplus to close this yet.`;
    } else {
      efDetail = `${efAction ?? "Build emergency fund first"}. Gap ${inr(efGap)} (${ef.target_months} months). ${reserved > 0 ? `${inr(reserved)} a month is reserved from surplus. ` : ""}Setting aside ${inr(ef.monthly_allocation)} a month would take about ${ef.months_to_close} months.`;
    }
  } else {
    efDetail = efAction ?? "Hold several months of expenses in cash or liquid funds before locking money into goals.";
  }

  let termDetail: string;
  if (ins && termGap != null) {
    termDetail = termGap > 0
      ? `${termAction ?? "Close the term cover gap"}. Gap ${shortInr(termGap)}.`
      : "No calculated term gap on the figures you entered.";
  } else {
    termDetail = termAction ?? legacyIns ?? "Check term cover against your need before putting leftover surplus into goals.";
  }

  let healthDetail: string;
  if (ins && healthGap != null) {
    healthDetail = healthGap > 0
      ? `${healthAction ?? "Close the health cover gap"}. Gap ${shortInr(healthGap)}.`
      : "No calculated health gap on the figures you entered.";
  } else {
    healthDetail = healthAction ?? "Check family health cover against the illustrative target.";
  }

  let goalDetail: string;
  if (totals) {
    goalDetail = `SIP sized ${inr(totals.allocated_sip)} of ${inr(totals.required_sip)} needed for the goals below.`;
  } else {
    goalDetail = "After the cash reserve and cover, put leftover surplus toward goal SIPs.";
  }

  return [
    { title: "Emergency fund", detail: efDetail, done: efGap != null ? efGap <= 0 : !efAction },
    { title: "Term cover", detail: termDetail, done: termGap != null ? termGap <= 0 : !termAction && !legacyIns },
    { title: "Health cover", detail: healthDetail, done: healthGap != null ? healthGap <= 0 : !healthAction },
    { title: "Then goals", detail: goalDetail, done: totals ? totals.shortfall <= 0 && totals.allocated_sip > 0 : false },
  ];
}

export function SequencedActions({ profile, planning }: { profile: Profile; planning?: Plan["planning"] }) {
  const steps = buildSequencedActions(profile, planning);
  return (
    <div className="rounded-xl border border-amber-600 bg-amber-100 p-4" role="note">
      <h3 className="font-bold text-amber-600">What to do first</h3>
      <p className="mt-1 text-sm text-navy-900">Work in this order: emergency fund, then term cover, then health cover, then goals.</p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 text-navy-900">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-navy-900 text-white" : "bg-white text-navy-900"}`} aria-hidden>
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{s.title}{s.done ? " — in place" : ""}</p>
              <p className="text-sm">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ProfileCard({ profile, planning }: { profile: Profile; planning?: Plan["planning"] }) {
  return (
    <div className="space-y-4">
      <SequencedActions profile={profile} planning={planning} />
      <div className="card grid gap-5 md:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="text-sm text-navy-700">Illustrative risk band</p>
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

export function FundTable({ funds, disclosures }: { funds: FundPick[]; disclosures?: Disclosures }) {
  const extra = extraDisclosures(disclosures);
  const compareCodes = funds.map((f) => f.scheme_code).join(",");
  const line = extra.ranking_disclaimer || FALLBACK_SHORTLIST_LINE;
  return (
    <div
      className="card overflow-x-auto p-0"
      tabIndex={0}
      role="region"
      aria-label="Illustrative fund shortlist. Scroll sideways on a small screen to see every column."
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-100 bg-navy-50 p-3">
        <span className="text-xs font-medium text-navy-700">{line}</span>
        {funds.length >= 2 && (
          <Link
            href={`/funds/compare?codes=${compareCodes}`}
            className="rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-teal-800"
          >
            Compare All Shortlisted Schemes →
          </Link>
        )}
      </div>
      <p className="px-3 py-2 text-xs font-medium text-navy-700">
        Swipe sideways to see every column in the shortlist.
      </p>
      <table className="w-full min-w-[820px] text-left">
        <caption className="sr-only">Illustrative fund shortlist ranked by a past-performance composite</caption>
        <thead className="bg-navy-50">
          <tr>
            {["Fund", "Category", "Weight", "3Y CAGR", "5Y CAGR", "3Y volatility", "Max drawdown (3Y)", "Score", "Why it ranked", "Illustrative monthly SIP"].map((h) => (
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

const SUCCESS_GREEN = 0.6;

export function fundingBadge(goal: GoalPlan, labels?: Partial<Record<GoalPlan["status"], string>>): { label: string; tone: string; extra: string } {
  const mc = goal.monte_carlo;
  const p = mc?.success_prob;
  const sip80 = mc?.sip_for_target_success;
  const target = mc?.target_success ?? 0.8;
  const pPct = typeof p === "number" && Number.isFinite(p) ? Math.round(p * 100) : null;
  const extraBits = [
    pPct != null ? `P(success) ${pPct}%` : null,
    typeof sip80 === "number" ? `SIP for ~${Math.round(target * 100)}% ${inr(sip80)}` : null,
  ].filter(Boolean);
  const extra = extraBits.join(" · ");
  const label = labels?.[goal.status] || FALLBACK_SIZED_LABELS[goal.status];

  if (goal.status === "unfunded") {
    return { label, tone: "bg-rose-100 text-rose-700", extra };
  }
  if (goal.status === "partially_funded") {
    return { label, tone: "bg-amber-100 text-amber-600", extra };
  }
  const canGreen = typeof p === "number" && p >= SUCCESS_GREEN;
  return {
    label,
    tone: canGreen ? "bg-teal-100 text-teal-700" : "bg-amber-100 text-amber-600",
    extra,
  };
}

export function GoalCard({ goal: g, disclosures }: { goal: GoalPlan; disclosures?: Disclosures }) {
  const extra = extraDisclosures(disclosures);
  const mc = g.monte_carlo;
  const lv = g.levers;
  const badge = fundingBadge(g, extra.sized_status_labels);
  return (
    <article className="card" aria-label={g.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{g.name}</h3>
          <p className="text-sm text-navy-700">{g.years} years · priority {g.priority} · inflation {pct(g.inflation, 0)} · expected return {pct(g.expected_return)}</p>
        </div>
        <span className={`inline-flex max-w-xs flex-col items-end gap-0.5 rounded-2xl px-3 py-2 text-right text-xs font-semibold ${badge.tone}`}>
          <span>{badge.label}</span>
          {badge.extra && <span className="font-medium">{badge.extra}</span>}
        </span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <Item k="Future cost" v={shortInr(g.future_cost)} />
            <Item k="SIP needed" v={`${inr(g.required_sip)} / month`} />
            <Item k="SIP funded" v={`${inr(g.allocated_sip)} / month`} />
            <Item k={`SIP for ~${((mc?.target_success ?? 0.8) * 100).toFixed(0)}% chance`} v={inr(mc?.sip_for_target_success)} />
          </dl>
          <div className="flex items-center gap-3">
            <Gauge value={mc?.success_prob ?? 0} />
            <p>Chance of reaching the goal with the funded SIP, from simulated paths. P10 / P50 / P90: {shortInr(mc?.p10)} / {shortInr(mc?.p50)} / {shortInr(mc?.p90)}.</p>
          </div>
          <p className="text-xs text-navy-700">
            This chance uses a constant-mix illustration (same allocation every year, rebalanced annually). It is not a glide path and does not model withdrawals after the goal date. A goal sized at the assumed return is often near a 50% chance.
          </p>
          <p className="text-xs text-navy-700">{extra.tax_per_goal_note || FALLBACK_TAX_PER_GOAL}</p>
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
        {mc && mc.p90 > 0
          ? <FanChart fan={mc.fan} target={g.future_cost} />
          : <p className="self-center text-sm text-navy-700">No SIP is funded for this goal yet, so there is no projection to chart.</p>}
      </div>
    </article>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-navy-700">{k}</dt><dd className="text-base font-bold">{v}</dd></div>;
}

export function hasHugeGoal(planning: Plan["planning"]): boolean {
  const HUGE_FUTURE = 1_000_000_000;
  const HUGE_SIP = 10_000_000;
  return planning.goals.some((g) => g.future_cost >= HUGE_FUTURE || g.required_sip >= HUGE_SIP);
}

export function CashflowCard({ planning, first }: { planning: Plan["planning"]; first?: boolean }) {
  const cf = planning.cashflow;
  const surplus = cf?.monthly_surplus ?? planning.totals.monthly_surplus;
  const leftover = unusedSurplus(planning);
  const reserved = emergencyReserved(planning);
  return (
    <div className={`card text-sm ${first && surplus <= 0 ? "border-rose-300" : ""}`}>
      <h3 className="mb-2 text-lg font-bold">Monthly cashflow</h3>
      {cf && (
        <dl className="grid gap-2 sm:grid-cols-3">
          <Item k="Take-home income" v={inr(cf.monthly_income)} />
          <Item k="Expenses and EMIs" v={inr(cf.monthly_outgo)} />
          <Item k="Surplus" v={inr(surplus)} />
        </dl>
      )}
      {surplus <= 0 && (
        <p className="mt-3 rounded-lg bg-rose-100 p-3 font-medium text-rose-700" role="status">
          There is no monthly surplus to put toward goals. The fund shortlist is hidden until cashflow is positive. Start with expenses, EMIs and the emergency reserve — not a buy list.
        </p>
      )}
      {reserved > 0 && (
        <p className="mt-3 rounded-lg bg-navy-50 p-3" role="status">
          Emergency reserve: <strong>{inr(reserved)}</strong> a month is set aside to close the emergency-fund gap before other goals.
        </p>
      )}
      {surplus > 0 && leftover >= 1 && (
        <p className="mt-3 rounded-lg bg-navy-50 p-3" role="status">
          Unused surplus: <strong>{inr(leftover)}</strong> a month is not allocated to a goal SIP
          {reserved > 0 ? " after the emergency reserve" : ""}.
        </p>
      )}
    </div>
  );
}

export function EmergencyCard({ ef, reserved }: { ef: Plan["planning"]["emergency_fund"]; reserved?: number }) {
  return (
    <div className="card text-sm">
      <h3 className="mb-2 text-lg font-bold">Emergency fund</h3>
      <p>Target: <strong>{inr(ef.target)}</strong> ({ef.target_months} months of expenses and EMIs)</p>
      <p>You hold: <strong>{inr(ef.current)}</strong></p>
      <p>Gap: <strong>{inr(ef.gap)}</strong></p>
      {typeof reserved === "number" && reserved > 0 && (
        <p>Reserved from surplus: <strong>{inr(reserved)}</strong> / month</p>
      )}
      <p className="mt-1 text-navy-700">
        {ef.gap === 0 ? "Your emergency fund meets the target."
          : ef.months_to_close === null ? "There is no monthly surplus to build this from yet."
          : `Setting aside ${inr(ef.monthly_allocation)} a month would close the gap in about ${ef.months_to_close} months.`}
      </p>
    </div>
  );
}

export function InsuranceCard({ ins }: { ins: Plan["planning"]["insurance"] }) {
  const range = termNeedRange(ins);
  const needCell = range
    ? `${shortInr(ins.term.need)} (${shortInr(range.low)}–${shortInr(range.high)})`
    : shortInr(ins.term.need);
  return (
    <div className="card text-sm">
      <h3 className="mb-2 text-lg font-bold">Insurance cover</h3>
      <table className="w-full">
        <thead><tr><th className="th">Cover</th><th className="th">Illustrative need</th><th className="th">You have</th><th className="th">Gap</th></tr></thead>
        <tbody>
          <tr className="border-t border-navy-100"><td className="td">Term life</td><td className="td">{needCell}</td><td className="td">{shortInr(ins.term.cover)}</td><td className="td font-semibold">{shortInr(ins.term.gap)}</td></tr>
          <tr className="border-t border-navy-100"><td className="td">Health (family)</td><td className="td">{shortInr(ins.health.target)}</td><td className="td">{shortInr(ins.health.cover)}</td><td className="td font-semibold">{shortInr(ins.health.gap)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-navy-700">
        {range
          ? `Term need is a range, not a single figure: ${shortInr(range.low)} to ${shortInr(range.high)} (HLV ${shortInr(range.hlv ?? ins.term.need)}; 15× ${shortInr(range.ref15 ?? ins.term.reference["15x_income"])}; 20× ${shortInr(range.ref20 ?? ins.term.reference["20x_income"])}).`
          : `Term need is a human-life-value estimate. For reference, 15x income is ${shortInr(ins.term.reference["15x_income"])} and 20x income is ${shortInr(ins.term.reference["20x_income"])}.`}
      </p>
    </div>
  );
}

function MarkedBadge() {
  return (
    <span className="ml-2 inline-block rounded-full bg-teal-700 px-2 py-0.5 align-middle text-xs font-bold text-white">
      Marked pick
    </span>
  );
}

function CoverBlock({ block, title }: { block: InsuranceBlock; title: string }) {
  const pick = block.plans.find((p) => p.marked_pick) ?? block.plans[0];
  return (
    <section aria-label={`${title} illustrative shortlist`} className="border-t border-navy-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-bold">{title} — illustrative shortlist</h4>
        <p className="text-sm text-navy-700">Gap {shortInr(block.gap)} · researched {block.researched_on}</p>
      </div>

      <div className="mt-3 rounded-xl border-2 border-teal-600 bg-teal-50 p-4">
        <p className="font-bold">
          <span className="mr-2 inline-block rounded-full bg-teal-700 px-2 py-0.5 align-middle text-xs font-bold text-white">Marked pick</span>
          {pick.insurer} — {pick.plan}
        </p>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-navy-700">Claim settlement</dt><dd className="font-semibold">{pick.claim_settlement}</dd></div>
          {pick.solvency && <div><dt className="text-navy-700">Solvency ratio</dt><dd className="font-semibold">{pick.solvency}</dd></div>}
          <div><dt className="text-navy-700">Sum insured</dt><dd className="font-semibold">{pick.sum_insured}</dd></div>
        </dl>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {pick.features.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="mt-3 text-sm font-semibold">Why this one is marked</p>
        <ul className="list-disc pl-5 text-sm">
          {block.pick_reason.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>

      <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label={`${title} plan comparison. Scroll sideways on a small screen.`}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-navy-50">
            <tr>
              {["Insurer", "Plan", "Claim settlement", "Solvency", "Sum insured", "Key features"].map((h) => (
                <th key={h} scope="col" className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.plans.map((p) => (
              <tr key={`${p.insurer}-${p.plan}`} className={`border-t border-navy-100 ${p.marked_pick ? "bg-teal-50" : ""}`}>
                <td className="td font-medium">{p.insurer}{p.marked_pick && <MarkedBadge />}</td>
                <td className="td">{p.plan}</td>
                <td className="td">{p.claim_settlement}</td>
                <td className="td">{p.solvency ?? "–"}</td>
                <td className="td">{p.sum_insured}</td>
                <td className="td"><ul className="list-disc pl-4 text-xs">{p.features.map((f) => <li key={f}>{f}</li>)}</ul></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-navy-700">{block.note}</p>
    </section>
  );
}

export function InsuranceSuggestions({ data }: { data: InsuranceSuggestionsData }) {
  if (!data.term && !data.health) return null;
  return (
    <div className="card" aria-label="Cover plans worth researching">
      <h3 className="text-lg font-bold">Cover plans worth researching</h3>
      <p className="mt-1 text-sm text-navy-700">
        For each cover gap above, here is an illustrative shortlist from our October 2026 research,
        with one plan marked for you to compare first. It is a starting point for your own
        research — not a recommendation.
      </p>
      <div className="mt-4 space-y-6">
        {data.term && <CoverBlock block={data.term} title="Term cover" />}
        {data.health && <CoverBlock block={data.health} title="Health cover" />}
      </div>
    </div>
  );
}

function FundCompareCard({ fund: f }: { fund: FundPick }) {
  const alts = f.alternatives ?? [];
  const cols = [f, ...alts];
  const codes = cols.map((c) => c.scheme_code).join(",");
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">
        {CATEGORY_LABELS[f.cat] ?? f.cat} — {f.scheme_name}
        <MarkedBadge />
      </summary>
      <div className="mt-3 overflow-x-auto" tabIndex={0} role="region"
        aria-label={`${CATEGORY_LABELS[f.cat] ?? f.cat} fund comparison. Scroll sideways on a small screen.`}>
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-navy-50">
            <tr>
              {["Fund", "AMC", "3Y CAGR", "5Y CAGR", "3Y volatility", "Max drawdown (3Y)", "3Y Sharpe", "Score"].map((h) => (
                <th key={h} scope="col" className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map((c, i) => (
              <tr key={c.scheme_code} className={`border-t border-navy-100 ${i === 0 ? "bg-teal-50" : ""}`}>
                <td className="td font-medium">{c.scheme_name}{i === 0 && <MarkedBadge />}</td>
                <td className="td">{c.amc}</td>
                <td className="td">{pct(c.metrics.cagr_3y)}</td>
                <td className="td">{pct(c.metrics.cagr_5y)}</td>
                <td className="td">{pct(c.metrics.vol_3y)}</td>
                <td className="td">{pct(c.metrics.max_drawdown_3y)}</td>
                <td className="td">{c.metrics.sharpe_3y == null ? "–" : Number(c.metrics.sharpe_3y).toFixed(2)}</td>
                <td className="td">{Number(c.score).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 rounded-lg bg-navy-50 p-3">
        <p className="text-sm font-semibold">Why this one is marked</p>
        <ul className="list-disc pl-5 text-sm">
          {f.explain.map((e) => <li key={e}>{e}</li>)}
        </ul>
      </div>
      <Link
        href={`/funds/compare?codes=${codes}`}
        className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:underline"
      >
        Open full comparison →
      </Link>
    </details>
  );
}

export function FundComparisons({ funds }: { funds: FundPick[] }) {
  const rows = funds.filter((f) => f.alternatives && f.alternatives.length > 0);
  if (!rows.length) return null;
  return (
    <div className="mt-6">
      <h3 className="mb-1 text-lg font-bold">Fund-by-fund comparison with marked pick</h3>
      <p className="mb-3 text-sm text-navy-700">
        Each shortlisted fund is the top-ranked scheme in its category by the past-performance
        composite. Expand a category to compare it side by side with the next three ranked schemes.
      </p>
      <div className="space-y-3">
        {rows.map((f) => <FundCompareCard key={f.scheme_code} fund={f} />)}
      </div>
    </div>
  );
}

export function PlanLinkCard({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-navy-200 bg-white p-4 text-sm" role="note">
      <div className="max-w-2xl">
        <p className="font-semibold">Save this plan link</p>
        <p className="mt-1 text-navy-700">
          We do not ask for a phone or email, so we cannot send this plan back to you. Bookmark this page or copy the link. If you lose it, the plan is gone.
        </p>
        <p className="mt-2 break-all font-mono text-xs text-navy-900" data-testid="plan-id">{id}</p>
      </div>
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Link copied" : "Copy plan link"}
      </button>
    </div>
  );
}

export function SanityBanner({ planning }: { planning: Plan["planning"] }) {
  if (!hasHugeGoal(planning)) return null;
  return (
    <div className="rounded-xl border border-amber-600 bg-amber-100 p-4" role="status">
      <p className="font-semibold text-amber-600">Very large target</p>
      <p className="mt-1 text-sm text-navy-900">
        At least one goal has a future cost over ₹100 Cr or a needed SIP over ₹1 Cr a month. Treat those figures as a scale check — they will not fit a typical household surplus.
      </p>
    </div>
  );
}
