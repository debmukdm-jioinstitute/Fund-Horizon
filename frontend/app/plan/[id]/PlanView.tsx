"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.

import { useCallback, useState } from "react";
import {
  CashflowCard, EmergencyCard, FALLBACK_SCHEME_DOCS, FALLBACK_SUCCESS_NOTE, FundTable, GoalCard,
  InsuranceCard, PlanLinkCard, ProfileCard, SanityBanner, SectionTitle, extraDisclosures, safeHeading,
  unusedSurplus,
} from "@/components/Results";
import { Donut, StressChart } from "@/components/charts";
import { getPlan, reportUrl } from "@/lib/api";
import { CATEGORY_LABELS, inr, pct } from "@/lib/format";
import type { Plan } from "@/lib/types";

export default function PlanView({ initialPlan, id }: { initialPlan: Plan; id: string }) {
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setStepUp = useCallback(async (s: number) => {
    setBusy(true);
    try {
      setPlan(await getPlan(id, s));
    } catch {
      setError("Could not recalculate. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [id]);

  const { profile, allocation, planning, stress_test: st, disclosures } = plan;
  const perGoal = allocation.per_goal;
  const surplus = planning.cashflow?.monthly_surplus ?? planning.totals.monthly_surplus;
  const leftover = unusedSurplus(planning);
  const hideBuyList = surplus <= 0;
  const extra = extraDisclosures(disclosures);
  const allocationTitle = safeHeading(disclosures.allocation_heading, "Illustrative allocation");
  const shortlistTitle = safeHeading(
    disclosures.shortlist_heading,
    "Illustrative shortlist (ranked by past-performance composite; not a recommendation)",
  );

  return (
    <div className="space-y-10">
      {error && (
        <div className="card" role="alert">
          <p className="font-semibold text-rose-700">{error}</p>
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Your illustrative plan</h1>
          <p className="text-navy-700">Fund data as of {plan.data_asof}. SIPs are sized at assumed planning returns, not as a forecast.</p>
        </div>
        <a href={reportUrl(plan.id)} className="btn-accent" download>Download PDF report</a>
      </header>

      <div className="rounded-xl border border-navy-200 bg-navy-50 p-4 text-sm" role="note">
        <p>{extra.success_prob_note || FALLBACK_SUCCESS_NOTE}</p>
      </div>

      <SanityBanner planning={planning} />

      <PlanLinkCard id={id} />

      {hideBuyList && (
        <section aria-labelledby="cashflow">
          <SectionTitle id="cashflow">Cashflow first</SectionTitle>
          <CashflowCard planning={planning} first />
        </section>
      )}

      <section aria-labelledby="profile"><SectionTitle id="profile">Risk profile</SectionTitle>
        <ProfileCard profile={profile} planning={planning} />
      </section>

      {!hideBuyList && (
        <section aria-labelledby="cashflow">
          <SectionTitle id="cashflow">Monthly cashflow</SectionTitle>
          <CashflowCard planning={planning} />
        </section>
      )}

      {!hideBuyList && (
        <section aria-labelledby="allocation">
          <SectionTitle id="allocation">{allocationTitle}</SectionTitle>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card">
              <p className="mb-3 text-sm text-navy-700">
                Band: <strong>{allocation.band}</strong>. Shorter goals hold less equity, so the overall mix is a goal-weighted average. This is an illustration, not a buy list.
              </p>
              <Donut data={allocation.by_category} />
            </div>
            <div className="card overflow-x-auto">
              <h3 className="mb-2 font-semibold">Allocation by goal</h3>
              <p className="mb-2 text-xs text-navy-700">Swipe sideways to see every column.</p>
              <table className="w-full min-w-[520px] text-left">
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
      )}

      {!hideBuyList && (
        <section aria-labelledby="funds">
          <SectionTitle id="funds">{shortlistTitle}</SectionTitle>
          <FundTable funds={plan.funds} disclosures={disclosures} />
          <p className="mt-2 text-sm text-navy-700">
            Regular plans only. Direct plans with lower expense ratios are available. Funds are keyed by scheme code.
          </p>
          <p className="mt-1 text-sm text-navy-700">{extra.scheme_docs_note || FALLBACK_SCHEME_DOCS}</p>
        </section>
      )}

      {!hideBuyList && (
        <section aria-labelledby="stress">
          <SectionTitle id="stress">Stress test on past data</SectionTitle>
          <div className="card">
            <p className="mb-2 text-sm text-navy-700">Illustrative ₹10 lakh invested in this mix, replayed on past NAVs.</p>
            <StressChart path={st.path} />
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <Stat k="Feb–Mar 2020 fall" v={pct(st.crash_2020_drawdown)} />
              <Stat k="Worst peak-to-trough" v={pct(st.worst_peak_to_trough)} />
              <Stat k="Worst rolling 12 months" v={pct(st.worst_rolling_12m)} />
            </dl>
            <p className="mt-2 text-xs text-navy-700">{st.note}{st.any_substituted ? " Funds with short history use their category median for earlier periods." : ""}</p>
          </div>
        </section>
      )}

      <section aria-labelledby="goals">
        <SectionTitle id="goals">Goal-by-goal plan</SectionTitle>
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <p>Monthly surplus <strong>{inr(planning.totals.monthly_surplus)}</strong> · SIP needed for all goals <strong>{inr(planning.totals.required_sip)}</strong> · SIP funded <strong>{inr(planning.totals.allocated_sip)}</strong>
              {leftover >= 1 ? <> · unused surplus <strong>{inr(leftover)}</strong></> : null}
            </p>
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
          {planning.goals.map((g) => <GoalCard key={g.name} goal={g} disclosures={disclosures} />)}
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
