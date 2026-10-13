"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, getPortalDashboard } from "@/lib/api";
import { inr, pct, shortInr } from "@/lib/format";
import type { PortalAlert, PortalDashboard, PortalGoal, PortalNextStep } from "@/lib/types";

/** API sends 0-1 fractions; tolerate 0-100 values defensively. */
function toFrac(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0;
  return v > 1 ? v / 100 : v;
}

function clamp100(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function StatusChip({ status, label }: { status: string; label: string }) {
  const tone =
    status === "funded"
      ? "bg-teal-50 text-teal-800 ring-teal-200"
      : status === "partially_funded"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${tone}`}>
      {label || status}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const w = clamp100(value);
  return (
    <div
      className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200/70"
      role="img"
      aria-label={`Progress ${w.toFixed(0)} percent`}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-500"
        style={{ width: `${Math.max(2, w)}%` }}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-label="Loading dashboard">
      <div className="card animate-pulse">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="mt-3 h-10 w-64 rounded bg-slate-200" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-4 w-32 rounded bg-slate-200" />
            <div className="mt-3 h-24 rounded-xl bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertIcon({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  const glyph = k.includes("warn") || k.includes("risk") ? "⚠️" : k.includes("info") ? "ℹ️" : "🔔";
  return (
    <span aria-hidden className="mt-0.5 text-base">
      {glyph}
    </span>
  );
}

function NextStepCard({ step, planId }: { step: PortalNextStep; planId: string }) {
  const glyph =
    step.kind === "emergency" ? "🧰" : step.kind === "term" ? "🛡️" : step.kind === "health" ? "🏥" : "🎯";
  const cta =
    step.kind === "emergency"
      ? "See planner"
      : step.kind === "term" || step.kind === "health"
        ? "Check cover in planner"
        : "Review goals";
  return (
    <section className="card" aria-label="Your next step">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-2xl">
          {glyph}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-teal-700">Next step</p>
          <h2 className="mt-1 text-lg font-extrabold text-navy-950">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-navy-800">{step.detail}</p>
          <p className="mt-3 rounded-lg bg-navy-50 p-3 text-xs leading-relaxed text-navy-600">
            {step.disclaimer}
          </p>
          <Link
            href={`/portal/${planId}/planner`}
            className="btn-primary mt-4 inline-flex text-sm"
          >
            {cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

function GoalBar({ goal, planId }: { goal: PortalGoal; planId: string }) {
  return (
    <Link
      href={`/portal/${planId}/goals`}
      className="block rounded-xl border border-navy-100 bg-white/70 p-3.5 transition-colors hover:border-teal-300"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-navy-950">{goal.name}</p>
          <p className="text-xs text-navy-500">Target {goal.target_date || "–"} · {inr(goal.target_amount)}</p>
        </div>
        <StatusChip status={goal.status} label={goal.status_label} />
      </div>
      <ProgressBar value={goal.progress_pct} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs">
        <span className="font-semibold text-navy-800">
          SIP {inr(goal.monthly_sip)}/mo · needs {inr(goal.required_sip)}/mo
        </span>
        <span className="font-semibold text-teal-700">
          {goal.success_prob == null ? "Chance –" : `Chance ${pct(toFrac(goal.success_prob), 0)}`}
        </span>
      </div>
    </Link>
  );
}

const BUCKETS = [
  { key: "equity", label: "Equity", tone: "bg-teal-600" },
  { key: "debt", label: "Debt", tone: "bg-navy-600" },
  { key: "gold", label: "Gold", tone: "bg-amber-400" },
  { key: "liquid", label: "Liquid", tone: "bg-sky-400" },
] as const;

export default function PortalDashboardPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
  const [dash, setDash] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFoundPlan, setNotFoundPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      setNotFoundPlan(false);
      try {
        const d = await getPortalDashboard(id);
        if (!cancelled) setDash(d);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFoundPlan(true);
        } else {
          setError(e instanceof Error ? e.message : "Could not load your dashboard.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (loading) return <Skeleton />;

  if (notFoundPlan) {
    return (
      <div className="card mx-auto max-w-md text-center" role="alert">
        <p className="text-4xl" aria-hidden>
          🔍
        </p>
        <h1 className="mt-3 text-xl font-extrabold text-navy-950">We couldn&apos;t find this plan</h1>
        <p className="mt-2 text-sm leading-relaxed text-navy-700">
          This link may be mistyped or the plan may no longer exist. Double-check the link you received,
          or create a new plan on the Fund Horizon home page.
        </p>
        <Link href="/" className="btn-primary mt-5 inline-flex text-sm">
          Go to Fund Horizon home
        </Link>
      </div>
    );
  }

  if (error || !dash) {
    return (
      <div className="card mx-auto max-w-md text-center" role="alert">
        <p className="text-4xl" aria-hidden>
          📡
        </p>
        <h1 className="mt-3 text-xl font-extrabold text-navy-950">Couldn&apos;t load your dashboard</h1>
        <p className="mt-2 text-sm text-navy-700">{error ?? "Something went wrong."}</p>
        <button onClick={() => setAttempt((a) => a + 1)} className="btn-primary mt-5 text-sm">
          Try again
        </button>
      </div>
    );
  }

  const alloc = dash.allocation ?? { equity: 0, debt: 0, gold: 0, liquid: 0 };
  const alerts: PortalAlert[] = dash.alerts ?? [];
  const goals: PortalGoal[] = dash.goals ?? [];

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="card" aria-label="Portfolio summary">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-navy-600">
              {dash.client_name ? `${dash.client_name}'s plan` : "Your plan"}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-navy-950 sm:text-4xl">
              {shortInr(dash.declared_portfolio_value)}
            </h1>
            <p className="mt-1 text-xs text-navy-500">{dash.declared_label}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dash.risk_band && (
              <span className="rounded-full bg-navy-950 px-3 py-1 text-xs font-bold text-white">
                {dash.risk_band}
              </span>
            )}
            {dash.risk_score != null && (
              <span className="rounded-full bg-navy-50 px-3 py-1 text-xs font-bold text-navy-800 ring-1 ring-navy-200">
                Score {dash.risk_score.toFixed(0)}
              </span>
            )}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-navy-50 p-3">
            <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">Invested (declared)</dt>
            <dd className="mt-1 text-base font-extrabold text-navy-950">{shortInr(dash.declared_invested)}</dd>
          </div>
          <div className="rounded-xl bg-navy-50 p-3">
            <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">Liquid (declared)</dt>
            <dd className="mt-1 text-base font-extrabold text-navy-950">{shortInr(dash.declared_liquid)}</dd>
          </div>
          <div className="rounded-xl bg-teal-50 p-3">
            <dt className="text-xs font-bold uppercase tracking-wider text-teal-700">Monthly SIP</dt>
            <dd className="mt-1 text-base font-extrabold text-teal-900">
              {inr(dash.monthly_sip_commitment)}/mo
            </dd>
          </div>
          <div className="rounded-xl bg-navy-50 p-3">
            <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">Active funds</dt>
            <dd className="mt-1 text-base font-extrabold text-navy-950">{dash.active_fund_count}</dd>
          </div>
        </dl>
      </section>

      {/* Allocation buckets */}
      <section className="card" aria-label="Asset allocation">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-navy-950">Planned allocation</h2>
          <Link href={`/portal/${id}/analytics`} className="text-xs font-bold text-teal-700 hover:underline">
            Full analytics →
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {BUCKETS.map((b) => (
            <div key={b.key} className="rounded-xl border border-navy-100 bg-white/70 p-3">
              <p className="text-xs font-bold text-navy-600">{b.label}</p>
              <p className="mt-0.5 text-lg font-extrabold text-navy-950">{pct(toFrac(alloc[b.key]), 0)}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/70">
                <div
                  className={`h-full rounded-full ${b.tone}`}
                  style={{ width: `${clamp100(toFrac(alloc[b.key]) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-navy-500">
          As of {dash.as_of || "–"} · Planned mix for the investment corpus.
        </p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Goals */}
        <section className="card" aria-label="Goals">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-navy-950">Goals</h2>
            <Link href={`/portal/${id}/goals`} className="text-xs font-bold text-teal-700 hover:underline">
              Manage goals →
            </Link>
          </div>
          <div className="mt-3 space-y-3">
            {goals.length === 0 && (
              <p className="text-sm text-navy-600">No goals in this plan yet.</p>
            )}
            {goals.map((g) => (
              <GoalBar key={g.name} goal={g} planId={id!} />
            ))}
          </div>
        </section>

        {/* Next step + alerts */}
        <div className="space-y-5">
          <NextStepCard step={dash.next_step} planId={id!} />
          {alerts.length > 0 && (
            <section className="card" aria-label="Alerts">
              <h2 className="text-base font-extrabold text-navy-950">Worth a look</h2>
              <ul className="mt-3 space-y-2.5">
                {alerts.map((a, i) => (
                  <li key={i} className="flex gap-2.5 rounded-xl bg-amber-50/70 p-3 ring-1 ring-amber-100">
                    <AlertIcon kind={a.kind} />
                    <p className="text-sm leading-relaxed text-navy-800">{a.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
