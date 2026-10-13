// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPortalAnalytics, getPortalHealth } from "@/lib/api";
import type { PortalAnalytics, PortalHealth } from "@/lib/types";
import { CATEGORY_LABELS, inr, pct } from "@/lib/format";

/** Accept 0-1 fractions or 0-100 scores; return 0-100 or null. */
function to100(v: unknown): number | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return v <= 1 ? v * 100 : v;
}

/** Accept 0-1 fractions or 0-100 values for bar widths; clamp to 0-100. */
function clamp100(v: unknown): number {
  const n = to100(v);
  if (n === null) return 0;
  return Math.min(100, Math.max(0, n));
}

const DIMENSIONS: { key: string; label: string }[] = [
  { key: "goal_readiness", label: "Goal readiness" },
  { key: "risk_alignment", label: "Risk alignment" },
  { key: "diversification", label: "Diversification" },
  { key: "sip_adequacy", label: "SIP adequacy" },
  { key: "emergency_readiness", label: "Emergency readiness" },
];

function barColor(v: number): string {
  if (v >= 70) return "bg-teal-600";
  if (v >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

function ScoreBar({ label, value, illustrative }: { label: string; value: number | null; illustrative?: boolean }) {
  const v = value === null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium text-navy-900">{label}</span>
        <span className="text-sm font-bold text-navy-950">{value === null ? "–" : `${Math.round(v)}`}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-navy-100" role="img" aria-label={`${label}: ${value === null ? "not available" : Math.round(v) + " of 100"}`}>
        <div className={`h-full rounded-full ${barColor(v)}`} style={{ width: `${v}%` }} />
      </div>
      {illustrative && <p className="mt-0.5 text-xs italic text-navy-500">Illustrative</p>}
    </div>
  );
}

export default function PortalAnalyticsPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [health, setHealth] = useState<PortalHealth | null>(null);
  const [analytics, setAnalytics] = useState<PortalAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getPortalHealth(id), getPortalAnalytics(id)])
      .then(([h, a]) => {
        if (cancelled) return;
        setHealth(h ?? null);
        setAnalytics(a ?? null);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const scores = (health?.scores ?? {}) as Record<string, number>;
  const overall = to100(scores.overall);
  const improvements = (health?.improvements ?? []) as { title: string; detail: string; disclaimer: string }[];
  const categoryMix = (analytics?.category_mix ?? []) as { category: string; pct: number; sip?: number | null }[];
  const amcMix = (analytics?.amc_mix ?? []) as { amc: string; pct: number }[];
  const fundCount = analytics?.fund_count ?? null;
  const riskBand = analytics?.risk_band ?? null;
  const topCategoryPct = analytics?.top_category_pct;

  return (
    <main className="w-full space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-navy-950">Analytics & Financial Health</h1>
        <Link href={`/plan/${id}`} className="text-xs font-semibold text-teal-700 hover:underline">
          ← Back to plan
        </Link>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800" role="alert">{error}</div>
      )}

      {loading ? (
        <div className="card p-6 text-center text-xs text-navy-500">Loading analytics…</div>
      ) : (
        <>
          {/* Overall score hero */}
          <section className="card bg-navy-950 text-center" aria-label="Overall financial health score">
            <p className="text-xs font-bold uppercase tracking-wider text-navy-300">Overall health score</p>
            <p className="mt-2 text-5xl font-extrabold text-white">{overall === null ? "–" : Math.round(overall)}</p>
            <p className="mt-1 text-xs text-navy-300">out of 100 · illustrative</p>
            {(fundCount !== null || riskBand !== null) && (
              <p className="mt-2 text-xs text-navy-200">
                {fundCount !== null && <span className="mr-3">{fundCount} funds in plan</span>}
                {riskBand !== null && <span>Risk band: {riskBand}</span>}
              </p>
            )}
          </section>

          {/* Five dimension scores */}
          <section className="card space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-navy-950">Dimension scores</h2>
              <span className="text-xs italic text-navy-500">Illustrative</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {DIMENSIONS.map((d) => (
                <ScoreBar key={d.key} label={d.label} value={to100(scores[d.key])} illustrative />
              ))}
            </div>
          </section>

          {/* Financial health improvements */}
          <section className="card space-y-3">
            <h2 className="text-base font-bold text-navy-950">Financial health</h2>
            {improvements.length === 0 ? (
              <p className="text-xs text-navy-500">No improvement notes available for this plan.</p>
            ) : (
              <ul className="space-y-3">
                {improvements.slice(0, 3).map((imp, i) => (
                  <li key={i} className="rounded-lg bg-navy-50 p-3">
                    <p className="text-sm font-semibold text-navy-950">{imp.title ?? `Improvement ${i + 1}`}</p>
                    {imp.detail && <p className="mt-1 text-xs text-navy-700">{imp.detail}</p>}
                    {imp.disclaimer && <p className="mt-1 text-xs italic text-navy-500">{imp.disclaimer}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Category mix */}
          <section className="card space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-bold text-navy-950">Category mix</h2>
              {topCategoryPct !== undefined && topCategoryPct !== null && (
                <span className="text-xs text-navy-600">Top category: {pct(typeof topCategoryPct === "number" && topCategoryPct > 1 ? topCategoryPct / 100 : topCategoryPct)}</span>
              )}
            </div>
            {categoryMix.length === 0 ? (
              <p className="text-xs text-navy-500">No category mix available.</p>
            ) : (
              <div className="space-y-3">
                {categoryMix.map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-sm font-medium text-navy-900">
                        {CATEGORY_LABELS[c.category] ?? c.category}
                      </span>
                      <span className="text-xs text-navy-700">
                        {pct(c.pct)}{c.sip !== undefined && c.sip !== null && typeof c.sip === "number" ? ` · SIP ${inr(c.sip)}/mo` : ""}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-navy-100">
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${clamp100(c.pct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* AMC mix */}
          <section className="card space-y-3">
            <h2 className="text-base font-bold text-navy-950">AMC mix</h2>
            {amcMix.length === 0 ? (
              <p className="text-xs text-navy-500">No AMC mix available.</p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {amcMix.map((a) => (
                  <li key={a.amc} className="flex items-baseline justify-between py-2">
                    <span className="text-sm text-navy-900">{a.amc}</span>
                    <span className="text-sm font-bold text-navy-950">{pct(a.pct)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
