"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getPortalDashboard, patchPortalPlan, getQuestionnaire, ApiError } from "@/lib/api";
import type { PortalDashboard, Questionnaire } from "@/lib/types";

/** Plain-language sentences about equity exposure, keyed loosely to the band name. */
function bandCopy(band: string): string[] {
  const b = band.toLowerCase();
  if (b.includes("conserv")) {
    return [
      "Your plan keeps equity exposure low, with most of the mix in debt and other stable buckets.",
      "That limits swings in value when markets fall, which suits goals where you cannot afford large setbacks.",
      "Long-run growth will be modest, since equity — the main long-term growth driver — is a small share.",
    ];
  }
  if (b.includes("moderate") || b.includes("balanced")) {
    return [
      "Your plan gives equity a meaningful but not dominant share, alongside a sizable debt allocation.",
      "In a market fall you are likely to see moderate swings — cushioned by debt, but not fully shielded.",
      "This stance balances growth and stability, and fits medium-to-long horizons.",
    ];
  }
  if (b.includes("aggress") || b.includes("growth")) {
    return [
      "Your plan carries a high equity allocation, which drives most of its long-run growth potential.",
      "The trade-off is larger drawdowns in market downturns — this stance is meant for long horizons where you can wait out cycles.",
      "Short-term volatility is expected; the plan is built around staying invested through it.",
    ];
  }
  return [
    "Your plan's equity exposure follows the risk band shown above.",
    "A higher equity share means higher long-run growth potential — and deeper short-term falls.",
    "If this feels wrong for your goals, you can re-take the questionnaire below to re-set your band.",
  ];
}

function titleCase(s: string): string {
  return s.replace(/[_\s]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function bandOf(d: PortalDashboard | null): string {
  if (!d) return "";
  const v = (d as { risk_band?: unknown }).risk_band;
  return typeof v === "string" ? v : "";
}

function scoreOf(d: PortalDashboard | null): number | null {
  if (!d) return null;
  const v = (d as { risk_score?: unknown }).risk_score;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export default function RiskPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [dashboard, setDashboard] = useState<PortalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showRetake, setShowRetake] = useState(false);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getPortalDashboard(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your risk profile.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const startRetake = async () => {
    setShowRetake(true);
    setAnswers({});
    setQError(null);
    setQLoading(true);
    try {
      setQuestionnaire(await getQuestionnaire());
    } catch (e) {
      setQError(e instanceof ApiError ? e.message : "Could not load the questionnaire.");
    } finally {
      setQLoading(false);
    }
  };

  const submitRetake = async () => {
    const qs = questionnaire?.questions ?? [];
    if (qs.length === 0) return;
    const unanswered = qs.some((q) => answers[q.id] === undefined);
    if (unanswered) {
      setSaveError("Please answer every question before submitting.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await patchPortalPlan(id, { answers });
      setShowRetake(false);
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not save your answers.");
    } finally {
      setSaving(false);
    }
  };

  const band = bandOf(dashboard);
  const score = scoreOf(dashboard);

  return (
    <main className="w-full px-4 py-6">
      <Link href={`/portal/${id}`} className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline">
        &larr; Back to portal
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold text-navy-900">Risk Profile</h1>

      <section className="card mt-6 text-center" aria-label="Current risk profile">
        {loading ? (
          <div className="animate-pulse space-y-3 py-6">
            <div className="mx-auto h-10 w-48 rounded bg-navy-100" />
            <div className="mx-auto h-4 w-32 rounded bg-navy-100" />
          </div>
        ) : error ? (
          <div className="py-4">
            <p className="text-sm text-rose-600">{error}</p>
            <button type="button" className="btn btn-primary mt-4" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-navy-500">Your risk band</p>
            <p className="mt-1 font-display text-4xl font-bold text-navy-900">{band ? titleCase(band) : "–"}</p>
            {score !== null && <p className="mt-1 text-sm text-navy-600">Risk score: {score.toFixed(1)}</p>}
            <div className="mt-4 space-y-2 text-left text-sm text-navy-700">
              {bandCopy(band).map((s, i) => (
                <p key={i}>{s}</p>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card mt-6" aria-labelledby="retake">
        <h2 id="retake" className="font-display text-lg font-semibold text-navy-900">
          Re-take the risk questionnaire
        </h2>
        <p className="mt-1 text-sm text-navy-600">
          Changed jobs, goals, or comfort with market swings? Answer afresh and your plan&apos;s risk band will update.
        </p>
        {!showRetake ? (
          <button type="button" className="btn btn-primary mt-4" onClick={() => void startRetake()}>
            Re-take questionnaire
          </button>
        ) : (
          <div className="mt-4">
            {qLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-5 w-2/3 rounded bg-navy-100" />
                <div className="h-10 rounded bg-navy-100" />
                <div className="h-10 rounded bg-navy-100" />
              </div>
            ) : qError ? (
              <div>
                <p className="text-sm text-rose-600">{qError}</p>
                <button type="button" className="btn btn-primary mt-3" onClick={() => void startRetake()}>
                  Retry
                </button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitRetake();
                }}
              >
                <ol className="space-y-6">
                  {(questionnaire?.questions ?? []).map((q, qi) => (
                    <li key={q.id}>
                      <fieldset>
                        <legend className="text-sm font-semibold text-navy-900">
                          {qi + 1}. {q.text}
                        </legend>
                        <div className="mt-2 space-y-2">
                          {q.options.map((opt, oi) => (
                            <label
                              key={oi}
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors ${
                                answers[q.id] === oi
                                  ? "border-teal-600 bg-teal-50 text-navy-900"
                                  : "border-navy-100 bg-white text-navy-700 hover:border-navy-300"
                              }`}
                            >
                              <input
                                type="radio"
                                name={`q-${q.id}`}
                                className="mt-1 accent-teal-600"
                                checked={answers[q.id] === oi}
                                onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                              />
                              <span>{opt.text}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </li>
                  ))}
                </ol>
                {saveError && (
                  <p className="mt-4 text-sm text-rose-600" role="alert">
                    {saveError}
                  </p>
                )}
                <div className="mt-6 flex flex-wrap gap-3">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? "Saving…" : "Save answers"}
                  </button>
                  <button
                    type="button"
                    className="btn border border-navy-200 text-navy-700"
                    disabled={saving}
                    onClick={() => setShowRetake(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
