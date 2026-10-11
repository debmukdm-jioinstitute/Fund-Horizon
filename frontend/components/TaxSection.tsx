"use client";

// TODO(owner-compliance-review): this file contains user-facing copy.
// TODO(owner-ca-review): wording of tax statements needs a chartered accountant's sign-off.

import Link from "next/link";
import ExplainModal from "@/components/ExplainModal";
import { inr, pct } from "@/lib/format";
import type { Plan, RegimeResult, TaxNudge, TaxSwitches } from "@/lib/types";

const DED_LABELS: Record<string, string> = {
  std: "Standard deduction", hra: "HRA exemption", "80c": "Section 80C", "80ccd1b": "NPS (80CCD(1B))",
  "80ccd2": "Employer NPS (80CCD(2))", "80d": "Health insurance (80D)", "24b": "Home loan interest",
  "80e": "Education loan interest", "80tt": "Senior interest deduction (80TTB)",
};
const EFFORT: Record<string, string> = { low: "Quick", medium: "Some effort", high: "Takes planning" };

function Switch({ label, on, onChange, disabled, help, id }: {
  label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; help?: string; id: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button id={id} type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-teal-600" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        <span className="sr-only">{label}</span>
      </button>
      <label htmlFor={id} className="text-sm">
        <span className="font-semibold text-navy-950">{label}</span>
        {help && <span className="block text-xs text-slate-600">{help}</span>}
      </label>
    </div>
  );
}

export function RegimeColumn({ r, inForce, better }: { r: RegimeResult; inForce: boolean; better: boolean }) {
  const deds = Object.entries(r.deductions).filter(([, v]) => v > 0);
  return (
    <div className={`rounded-xl border p-4 ${inForce ? "border-teal-500 bg-teal-50/60 ring-2 ring-teal-500/20" : "border-navy-100 bg-white"}`}
      aria-label={`${r.regime} regime`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-base font-bold capitalize text-navy-950">{r.regime} regime</h4>
        {better && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-800">Lower tax</span>}
        {inForce && <span className="rounded-full bg-navy-900 px-2 py-0.5 text-xs font-bold text-white">Shown in plan</span>}
      </div>
      <p className="text-2xl font-extrabold text-navy-950">{inr(r.total_tax)}</p>
      <p className="mb-3 text-xs text-slate-600">tax for the year, including cess ({pct(r.effective_rate)} of income)</p>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-slate-600">Taxable income</dt><dd className="font-medium">{inr(r.taxable_income)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-600">Tax on slabs</dt><dd className="font-medium">{inr(r.slab_tax)}</dd></div>
        {r.rebate > 0 && <div className="flex justify-between"><dt className="text-slate-600">Rebate (87A)</dt><dd className="font-medium">-{inr(r.rebate)}</dd></div>}
        {r.surcharge > 0 && <div className="flex justify-between"><dt className="text-slate-600">Surcharge</dt><dd className="font-medium">{inr(r.surcharge)}</dd></div>}
      </dl>
      {deds.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-teal-800">Deductions counted ({inr(r.total_deductions)})</summary>
          <ul className="mt-1 space-y-0.5">
            {deds.map(([k, v]) => <li key={k} className="flex justify-between"><span className="text-slate-600">{DED_LABELS[k] ?? k}</span><span>{inr(v)}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function NudgeCard({ n, applied, onToggle, busy, planId, regimeInForce }: {
  n: TaxNudge; applied: boolean; onToggle: () => void; busy: boolean; planId: string; regimeInForce?: string | null;
}) {
  return (
    <article className="card" aria-label={n.title} data-nudge={n.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-800">Idea {n.rank}</p>
          <h4 className="text-lg font-bold text-navy-950">{n.title}</h4>
        </div>
        <div className="text-right">
          {n.est_saving_year != null ? (
            <>
              <p className="text-xl font-extrabold text-teal-700">up to {inr(n.est_saving_year)}</p>
              <p className="text-xs text-slate-600">{n.timing === "this_year" ? "less tax this year" : "less tax later"}</p>
            </>
          ) : (
            <p className="text-sm font-semibold text-slate-600">Saving depends on your situation</p>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-700">{n.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-navy-50 px-2.5 py-1 font-semibold text-navy-800">{EFFORT[n.effort] ?? n.effort}</span>
        <span className="rounded-full bg-navy-50 px-2.5 py-1 font-semibold text-navy-800">
          {n.regime === "both" ? "Both regimes" : n.regime === "old" ? "Old regime only" : "New regime only"}
        </span>
        {n.lock_in && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">Lock-in: {n.lock_in}</span>}
        {n.section_label && <span className="rounded-full bg-teal-50 px-2.5 py-1 font-semibold text-teal-800">{n.section_label}</span>}
      </div>

      {(n.why.length > 0 || n.steps.length > 0 || n.watch_outs.length > 0) && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-teal-800">How it works and what to check</summary>
          {n.why.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5">{n.why.map((w) => <li key={w}>{w}</li>)}</ul>}
          {n.steps.length > 0 && (
            <>
              <p className="mt-2 font-semibold">Steps</p>
              <ol className="list-decimal space-y-0.5 pl-5">{n.steps.map((w) => <li key={w}>{w}</li>)}</ol>
            </>
          )}
          {n.watch_outs.length > 0 && (
            <>
              <p className="mt-2 font-semibold text-amber-800">Watch out for</p>
              <ul className="list-disc space-y-0.5 pl-5">{n.watch_outs.map((w) => <li key={w}>{w}</li>)}</ul>
            </>
          )}
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {n.switchable && (
          <Switch id={`apply-${n.id}`} on={applied} disabled={busy} onChange={onToggle} label="Apply to my plan"
            help={n.id === "regime" ? "Uses the cheaper regime" : "Counts this deduction in your tax and plan"} />
        )}
        <ExplainModal kind="tax" planId={planId} nudgeId={n.id} buttonLabel="Explain this" />
        {(n.catalog_links ?? []).slice(0, 3).map((c) => (
          <Link key={c.id} href={`/learn/${c.id}`} className="text-sm font-semibold text-teal-800 underline">
            Learn: {c.name}
          </Link>
        ))}
      </div>
      {n.regime !== "both" && regimeInForce && n.regime !== regimeInForce && (
        <p className="mt-2 text-xs text-amber-800">Applies only in the {n.regime} regime.</p>
      )}
    </article>
  );
}

export default function TaxSection({ plan, busy, onSwitch }: {
  plan: Plan; busy: boolean; onSwitch: (p: Partial<TaxSwitches>) => void;
}) {
  const tax = plan.tax;
  const d = plan.disclosures;
  if (!tax || !tax.enabled) {
    return (
      <div className="card">
        <p className="text-sm text-slate-700">
          This plan was built without tax details. Tax can change your regime choice, the deductions you can use and how much
          you need to invest.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href="/plan/new" className="btn-primary">Start a plan with tax details</Link>
          <Link href="/tax" className="btn-secondary">Try the tax calculator</Link>
          <Link href="/learn" className="btn-secondary">Explore savings and tax-saving options</Link>
        </div>
      </div>
    );
  }
  const sw = tax.switches;
  const regimes = tax.regimes;
  const applied = new Set(tax.applied?.applied ?? []);
  const nudges = tax.nudges ?? [];
  const toggleApply = (id: string) => {
    if (id === "regime") {
      const rec = tax.recommended_regime;
      if (!rec) return;
      onSwitch({ regime: tax.regime_in_force === rec ? (rec === "new" ? "old" : "new") : "auto" });
      return;
    }
    const cur = tax.applied?.applied ?? [];
    const next = applied.has(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onSwitch({ apply: next });
  };
  const postDelta = tax.post_tax_goal_delta ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm text-amber-900" role="note">
        {d.tax_rules_note ?? `Tax figures follow FY ${tax.fy} rules for resident individuals and are illustrations.`}
      </div>

      <div className="card space-y-4" aria-busy={busy}>
        <h3 className="text-lg font-bold">Switches</h3>
        <fieldset disabled={busy} className="flex flex-wrap items-center gap-2">
          <legend className="mb-1 text-sm font-semibold">Tax regime</legend>
          {([["auto", `Auto${tax.recommended_regime ? ` (${tax.recommended_regime} costs less)` : ""}`], ["old", "Old"], ["new", "New"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={sw.regime === v} onClick={() => onSwitch({ regime: v })}
              disabled={tax.mode === "bracket_only"}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${sw.regime === v ? "border-navy-900 bg-navy-900 text-white" : "border-navy-700/40 bg-white"}`}>
              {label}
            </button>
          ))}
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <Switch id="sw-post" label="Show after tax" on={sw.tax_view === "post"} disabled={busy}
            onChange={(v) => onSwitch({ tax_view: v ? "post" : "pre" })}
            help="Size every goal's SIP on returns after tax" />
          <Switch id="sw-reinvest" label="Reinvest the tax I save" on={sw.reinvest} disabled={busy || applied.size === 0}
            onChange={(v) => onSwitch({ reinvest: v })} help={applied.size === 0 ? "Apply an idea below first" : "Adds the monthly saving to your SIPs"} />
        </div>
        {sw.tax_view === "post" && d.post_tax_note && <p className="text-xs text-slate-600">{d.post_tax_note}</p>}
      </div>

      {regimes ? (
        <div className="card">
          <h3 className="mb-1 text-lg font-bold">Old regime or new regime</h3>
          <p className="mb-4 text-sm text-slate-600">
            For FY {tax.fy}. Your marginal rate is about <strong>{pct(tax.marginal_rate ?? 0)}</strong> (slab rate with cess)
            {(tax.marginal_rate ?? 0) === 0 ? ": the next rupee is not taxed because of the rebate." : "."}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <RegimeColumn r={regimes.old} inForce={tax.regime_in_force === "old"} better={regimes.better === "old"} />
            <RegimeColumn r={regimes.new} inForce={tax.regime_in_force === "new"} better={regimes.better === "new"} />
          </div>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>The {regimes.better} regime costs about <strong>{inr(regimes.saving)}</strong> less.</li>
            {regimes.better === "new" && regimes.breakeven_extra_deductions ? (
              <li>The old regime would need about {inr(regimes.breakeven_extra_deductions)} more in deductions to match.</li>
            ) : null}
            <li>
              {regimes.old_if_maxed.beats_new
                ? `Using every old-regime limit (80C, NPS, 80D) would make the old regime ${inr(regimes.old_if_maxed.saving_vs_new)} cheaper.`
                : `Even using every old-regime limit (80C, NPS, 80D), the old regime would cost ${inr(-regimes.old_if_maxed.saving_vs_new)} more.`}
            </li>
            {regimes.capital_gains_tax > 0 && <li>Tax on your capital gains this year (same in both regimes): {inr(regimes.capital_gains_tax)}.</li>}
          </ul>
        </div>
      ) : (
        <div className="card text-sm">
          <p>
            Based on your bracket, each extra rupee of income is taxed at about <strong>{pct(tax.marginal_rate ?? 0)}</strong> (with cess).
            Add income details in a new plan to compare the two regimes exactly.
          </p>
        </div>
      )}

      {tax.applied && tax.applied.applied.length > 0 && (
        <div className="rounded-2xl border border-teal-300 bg-teal-50/70 p-4 text-sm" role="status">
          <strong>Applied ideas:</strong> tax falls from {inr(tax.applied.tax_before)} to {inr(tax.applied.tax_after)}, a saving of{" "}
          <strong>{inr(tax.applied.tax_saved_year)}</strong> a year ({inr(tax.applied.tax_saved_month)} a month).
          {sw.reinvest ? " That monthly amount is added to your SIPs." : ""}
        </div>
      )}

      <div>
        <h3 className="mb-1 text-lg font-bold">Saving ideas, ranked by estimated impact</h3>
        <p className="mb-3 text-sm text-slate-600">{d.tax_nudge_note}</p>
        {nudges.length === 0 ? (
          <p className="card text-sm">No ideas stood out with the details you entered. Add more in a new plan, or try the calculator.</p>
        ) : (
          <div className="space-y-4">
            {nudges.map((n) => (
              <NudgeCard key={n.id} n={n} planId={plan.id} busy={busy} regimeInForce={tax.regime_in_force}
                applied={n.id === "regime" ? tax.regime_in_force === tax.recommended_regime : applied.has(n.id)}
                onToggle={() => toggleApply(n.id)} />
            ))}
          </div>
        )}
      </div>

      {sw.tax_view === "post" && postDelta.length > 0 && (
        <div className="card overflow-x-auto">
          <h3 className="mb-2 text-lg font-bold">What after-tax sizing changes</h3>
          <table className="w-full min-w-[480px] text-left">
            <thead><tr><th className="th">Goal</th><th className="th">SIP before tax</th><th className="th">SIP after tax</th><th className="th">Extra needed</th></tr></thead>
            <tbody>
              {postDelta.map((g) => (
                <tr key={g.name} className="border-t border-navy-100">
                  <td className="td font-medium">{g.name}</td><td className="td">{inr(g.required_sip_pre_tax)}</td>
                  <td className="td">{inr(g.required_sip_post_tax)}</td><td className="td font-semibold">{inr(g.extra_sip_needed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-600">
        Rules compiled {tax.as_of} from public sources{tax.verified ? "" : " and not yet reviewed by a chartered accountant"}.{" "}
        <Link href="/learn" className="font-semibold text-teal-800 underline">Explore every scheme and how it is taxed</Link>
        {" · "}
        <Link href="/tax" className="font-semibold text-teal-800 underline">Tax calculator</Link>
      </p>
    </div>
  );
}
