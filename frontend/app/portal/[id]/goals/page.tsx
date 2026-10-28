"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, getPortalDashboard, patchPortalPlan } from "@/lib/api";
import { inr, pct } from "@/lib/format";
import type { PortalDashboard, PortalGoal } from "@/lib/types";

/** API sends 0-1 fractions; tolerate 0-100 values defensively. */
function toFrac(v: number | null | undefined): number {
  if (v == null || Number.isNaN(v)) return 0;
  return v > 1 ? v / 100 : v;
}

function clamp100(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function goalField(g: Record<string, unknown>, key: string): number | null {
  const v = g[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type EditState = { target: string; years: string } | null;

export default function PortalGoalsPage() {
  const params = useParams();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id as string | undefined);
  const [dash, setDash] = useState<PortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFoundPlan, setNotFoundPlan] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<EditState>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        if (e instanceof ApiError && e.status === 404) setNotFoundPlan(true);
        else setError(e instanceof Error ? e.message : "Could not load your goals.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const startEdit = (idx: number, goal: PortalGoal) => {
    const input = dash?.goal_inputs[idx] ?? {};
    const curTarget = goalField(input, "target_amount_today") ?? goal.target_amount;
    const curYears = goalField(input, "years_to_goal");
    setEditingIdx(idx);
    setEditing({ target: String(curTarget), years: curYears == null ? "" : String(curYears) });
    setFieldError(null);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditing(null);
    setFieldError(null);
  };

  const saveEdit = async () => {
    if (editingIdx == null || !editing || !dash || !id) return;
    const target = Number(editing.target);
    const years = Number(editing.years);
    if (!Number.isFinite(target) || target <= 0) {
      setFieldError("Target amount must be more than ₹0.");
      return;
    }
    if (!Number.isInteger(years) || years < 1 || years > 60) {
      setFieldError("Years to goal must be a whole number between 1 and 60.");
      return;
    }
    // Rebuild the FULL goals array from goal_inputs, overriding only the changed fields.
    const goals = dash.goal_inputs.map((g, j) =>
      j === editingIdx ? { ...g, target_amount_today: target, years_to_goal: years } : { ...g },
    );
    setSaving(true);
    setFieldError(null);
    try {
      await patchPortalPlan(id, { goals });
      setDash(await getPortalDashboard(id));
      cancelEdit();
    } catch (e) {
      setFieldError(e instanceof Error ? e.message : "Could not save this goal. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-label="Loading goals">
        {[0, 1].map((i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-5 w-48 rounded bg-slate-200" />
            <div className="mt-3 h-3 rounded-full bg-slate-100" />
            <div className="mt-3 h-16 rounded-xl bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  if (notFoundPlan) {
    return (
      <div className="card mx-auto max-w-md text-center" role="alert">
        <h1 className="text-xl font-extrabold text-navy-950">We couldn&apos;t find this plan</h1>
        <p className="mt-2 text-sm text-navy-700">
          This link may be mistyped or the plan may no longer exist.
        </p>
        <Link href="/" className="btn-primary mt-5 inline-block text-sm">Go to the home page</Link>
      </div>
    );
  }

  if (error || !dash) {
    return (
      <div className="card mx-auto max-w-md text-center" role="alert">
        <h1 className="text-xl font-extrabold text-navy-950">Couldn&apos;t load your goals</h1>
        <p className="mt-2 text-sm text-navy-700">{error ?? "Something went wrong."}</p>
        <button onClick={() => setAttempt((a) => a + 1)} className="btn-primary mt-5 text-sm">
          Try again
        </button>
        <Link href={`/portal/${id}`} className="mt-3 block text-sm font-medium text-teal-700 hover:underline">&larr; Back to portal</Link>
      </div>
    );
  }

  const goals: PortalGoal[] = dash.goals ?? [];

  return (
    <div className="space-y-4">
      <Link href={`/portal/${id}`} className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline">
        &larr; Back to portal
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-950">My Goals</h1>
        <p className="mt-1 text-sm text-navy-600">
          Adjust a goal&apos;s target or horizon and the plan rebuilds around it. Figures are illustrative —
          chance and SIP numbers use a constant mix and ignore tax.
        </p>
      </div>

      {goals.length === 0 && (
        <div className="card">
          <p className="text-sm text-navy-700">This plan has no goals yet.</p>
        </div>
      )}

      {goals.map((g, idx) => {
        const isEditing = editingIdx === idx;
        return (
          <article key={`${g.name}-${idx}`} className="card" aria-label={g.name}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold text-navy-950">{g.name}</h2>
                <p className="text-xs text-navy-500">
                  {g.type} · target {g.target_date || "–"}
                </p>
              </div>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${
                  g.status === "funded"
                    ? "bg-teal-50 text-teal-800 ring-teal-200"
                    : g.status === "partially_funded"
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-slate-100 text-slate-700 ring-slate-200"
                }`}
              >
                {g.status_label || g.status}
              </span>
            </div>

            <div
              className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200/70"
              role="img"
              aria-label={`${g.name} progress ${clamp100(g.progress_pct).toFixed(0)} percent`}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400"
                style={{ width: `${Math.max(2, clamp100(g.progress_pct))}%` }}
              />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">Target</dt>
                <dd className="mt-0.5 font-extrabold text-navy-950">{inr(g.target_amount)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">
                  SIP now / needed
                </dt>
                <dd className="mt-0.5 font-extrabold text-navy-950">
                  {inr(g.monthly_sip)} <span className="font-semibold text-navy-500">/ {inr(g.required_sip)}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">Chance</dt>
                <dd className="mt-0.5 font-extrabold text-teal-800">
                  {g.success_prob == null ? "–" : pct(toFrac(g.success_prob), 0)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-navy-500">Progress</dt>
                <dd className="mt-0.5 font-extrabold text-navy-950">{clamp100(g.progress_pct).toFixed(0)}%</dd>
              </div>
            </dl>

            {!isEditing ? (
              <button
                onClick={() => startEdit(idx, g)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-3.5 py-2 text-xs font-bold text-navy-900 shadow-sm transition-colors hover:bg-navy-50"
              >
                ✏️ Edit target &amp; horizon
              </button>
            ) : (
              <form
                className="mt-4 rounded-xl border border-teal-200 bg-teal-50/50 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveEdit();
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-navy-700">
                      Target amount today (₹)
                    </span>
                    <input
                      type="number"
                      min={1}
                      inputMode="decimal"
                      value={editing?.target ?? ""}
                      onChange={(e) => setEditing((s) => (s ? { ...s, target: e.target.value } : s))}
                      className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-950"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-navy-700">
                      Years to goal (1–60)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      inputMode="numeric"
                      value={editing?.years ?? ""}
                      onChange={(e) => setEditing((s) => (s ? { ...s, years: e.target.value } : s))}
                      className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-950"
                      required
                    />
                  </label>
                </div>
                {fieldError && (
                  <p className="mt-3 rounded-lg bg-rose-100 p-2.5 text-sm font-medium text-rose-700" role="alert">
                    {fieldError}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-50">
                    {saving ? "Saving…" : "Save & rebuild plan"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-xl border border-navy-200 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800 hover:bg-navy-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </article>
        );
      })}
    </div>
  );
}
