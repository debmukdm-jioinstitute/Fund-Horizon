"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  EmergencyCard, FundTable, GoalCard, InsuranceCard, ProfileCard, SectionTitle,
} from "@/components/Results";
import { Donut, StressChart } from "@/components/charts";
import { ApiError, getPlan, reportUrl } from "@/lib/api";
import { CATEGORY_LABELS, inr, pct } from "@/lib/format";
import type { Plan } from "@/lib/types";

export default function PlanPage({ params }: { params: { id: string } }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPlan(params.id).then(setPlan).catch((e) => setError(e instanceof ApiError && e.status === 404
      ? "We could not find this plan. It may have been removed." : "Could not load the plan. Is the API running?"));
  }, [params.id]);

  const setStepUp = useCallback(async (s: number) => {
    setBusy(true);
    try {
      setPlan(await getPlan(params.id, s));
    } catch {
      setError("Could not recalculate. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [params.id]);

  if (error) {
    return (
      <div className="card" role="alert">
        <p className="font-semibold">{error}</p>
        <Link href="/plan/new" className="btn-primary mt-4">Start a new plan</Link>
      </div>
    );
  }
  if (!plan) return <p role="status">Loading your plan…</p>;

  const { profile, allocation, planning, stress_test: st, disclosures } = plan;
  const perGoal = allocation.per_goal;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Your illustrative plan</h1>
          <p className="text-navy-700">Fund data as of {plan.data_asof}. Figures use the assumptions shown below.</p>
        </div>
        <a href={reportUrl(plan.id)} className="btn-accent" download>Download PDF report</a>
      </header>

      <section aria-labelledby="profile"><SectionTitle id="profile">Risk profile</SectionTitle>
        <ProfileCard profile={profile} />
      </section>

      <section aria-labelledby="allocation">
        <SectionTitle id="allocation">{disclosures.allocation_heading}</SectionTitle>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card">
            <p className="mb-3 text-sm text-navy-700">
              Band: <strong>{allocation.band}</strong>. Shorter goals hold less equity, so the overall mix is a goal-weighted average.
            </p>
            <Donut data={allocation.by_category} />
          </div>
          <div className="card overflow-x-auto">
            <h3 className="mb-2 font-semibold">Allocation by goal</h3>
            <table className="w-full text-left">
              <thead><tr><th className="th">Goal</th><th className="th">Years</th><th className="th">Equity</th><th className="th">Debt</th><th className="th">Gold</th><th className="th">Liquid</th></tr></thead>
              <tbody>
                {perGoal.map((g) => (
                  <tr key={g.name} className="border-t border-navy-100">
                    <td className="td font-medium">{g.name}</td><td className="td">{g.years}</td>
                    {(["equity", "debt", "gold", "liquid"] as const).map((k) => (
                      <td key={k} className="td">{g.by_asset_class[k].toFixed(0)}%</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm text-navy-700">
              Overall: equity {allocation.by_asset_class.equity.toFixed(1)}%, debt {allocation.by_asset_class.debt.toFixed(1)}%,
              gold {allocation.by_asset_class.gold.toFixed(1)}%, liquid {allocation.by_asset_class.liquid.toFixed(1)}%.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="funds">
        <SectionTitle id="funds">{disclosures.shortlist_heading}</SectionTitle>
        <FundTable funds={plan.funds} />
        <p className="mt-2 text-sm text-navy-700">
          Regular plans only. Direct plans with lower expense ratios are available. Funds are keyed by scheme code; check the scheme documents before investing.
        </p>
      </section>

      <section aria-labelledby="stress">
        <SectionTitle id="stress">Stress test on past data</SectionTitle>
        <div className="card">
          <p className="mb-2 text-sm text-navy-700">Illustrative ₹10 lakh invested in the suggested mix, replayed on past NAVs.</p>
          <StressChart path={st.path} />
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <Stat k="Feb–Mar 2020 fall" v={pct(st.crash_2020_drawdown)} />
            <Stat k="Worst peak-to-trough" v={pct(st.worst_peak_to_trough)} />
            <Stat k="Worst rolling 12 months" v={pct(st.worst_rolling_12m)} />
          </dl>
          <p className="mt-2 text-xs text-navy-700">{st.note}{st.any_substituted ? " Funds with short history use their category median for earlier periods." : ""}</p>
        </div>
      </section>

      <section aria-labelledby="goals">
        <SectionTitle id="goals">Goal-by-goal plan</SectionTitle>
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <p>Monthly surplus <strong>{inr(planning.totals.monthly_surplus)}</strong> · SIP needed for all goals <strong>{inr(planning.totals.required_sip)}</strong> · SIP funded <strong>{inr(planning.totals.allocated_sip)}</strong></p>
          </div>
          <fieldset className="flex items-center gap-2" disabled={busy}>
            <legend className="sr-only">Yearly SIP step-up</legend>
            <span className="text-sm font-medium" aria-hidden>Yearly SIP step-up</span>
            {[0, 0.05, 0.1].map((s) => (
              <button key={s} type="button" aria-pressed={planning.step_up === s} onClick={() => setStepUp(s)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${planning.step_up === s ? "border-navy-900 bg-navy-900 text-white" : "border-navy-700/40 bg-white"}`}>
                {s === 0 ? "None" : `${s * 100}%`}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="space-y-5" aria-busy={busy}>
          {planning.goals.map((g) => <GoalCard key={g.name} goal={g} />)}
        </div>
        <ul className="card mt-5 list-disc space-y-1 pl-9 text-sm">
          <li className="-ml-4 list-none font-semibold">Rebalancing rules</li>
          {planning.rebalancing.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      <section aria-labelledby="safety">
        <SectionTitle id="safety">Emergency fund and insurance</SectionTitle>
        <div className="grid gap-5 md:grid-cols-2">
          <EmergencyCard ef={planning.emergency_fund} />
          <InsuranceCard ins={planning.insurance} />
        </div>
        <p className="mt-3 text-sm text-navy-700">{disclosures.tax_info}</p>
      </section>

      <p className="text-xs text-navy-700">
        Category names: {Object.values(CATEGORY_LABELS).join(", ")}. This plan is an illustration based on the details you entered.
      </p>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-navy-50 p-3">
      <dt className="text-navy-700">{k}</dt>
      <dd className="text-xl font-bold">{v}</dd>
    </div>
  );
}
