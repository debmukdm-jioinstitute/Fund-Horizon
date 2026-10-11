"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPortalDashboard, getPlan, ApiError } from "@/lib/api";
import type { PortalDashboard, Plan, FundPick } from "@/lib/types";
import { inr, pct, CATEGORY_LABELS, ASSET_CLASS_LABELS } from "@/lib/format";
import { Donut } from "@/components/charts";

const BUCKETS = ["equity", "debt", "gold", "liquid"] as const;

type FundRow = FundPick & {
  allocated_sip?: number | null;
  weight?: number | null;
  why_ranked?: string[] | null;
};

/** Pull the 4-bucket allocation out of the dashboard, tolerating several shapes. */
function extractBuckets(d: PortalDashboard | null): Record<string, number> {
  if (!d) return {};
  const root = d as unknown as Record<string, unknown>;
  const alloc = root.allocation as Record<string, unknown> | undefined;
  const candidates: unknown[] = [];
  if (alloc && typeof alloc === "object") {
    if (alloc.by_asset_class && typeof alloc.by_asset_class === "object") candidates.push(alloc.by_asset_class);
    candidates.push(alloc);
  }
  if (root.by_asset_class && typeof root.by_asset_class === "object") candidates.push(root.by_asset_class);
  for (const c of candidates) {
    const rec = c as Record<string, unknown>;
    const vals = Object.entries(rec).filter(([, v]) => typeof v === "number");
    if (vals.length > 0) {
      const out: Record<string, number> = {};
      for (const [k, v] of vals) out[k] = v as number;
      return out;
    }
  }
  return {};
}

/** Fractions (0-1) for pct(). Converts percent-scale values (>1) and normalizes the sum. */
function toFrac(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v > 1 ? v / 100 : v;
}

function normalizeBuckets(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const b of BUCKETS) {
    const f = toFrac(raw[b]);
    out[b] = f ?? 0;
    sum += out[b];
  }
  if (sum > 0 && Math.abs(sum - 1) > 0.001) {
    for (const b of BUCKETS) out[b] = out[b] / sum;
  }
  return out;
}

function monthlySip(f: FundRow): number | null {
  const v = f.suggested_monthly_sip ?? f.allocated_sip ?? null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function whyBullets(f: FundRow): string[] {
  const raw = f.explain ?? f.why_ranked ?? [];
  return Array.isArray(raw) ? raw.filter((s) => typeof s === "string" && s.trim().length > 0) : [];
}

export default function PortfolioPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [dashboard, setDashboard] = useState<PortalDashboard | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, p] = await Promise.all([getPortalDashboard(id), getPlan(id)]);
      setDashboard(d);
      setPlan(p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your portfolio.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const buckets = useMemo(() => normalizeBuckets(extractBuckets(dashboard)), [dashboard]);
  const donutData = useMemo(() => {
    const d: Record<string, number> = {};
    for (const b of BUCKETS) d[b] = Number((buckets[b] * 100).toFixed(1));
    return d;
  }, [buckets]);

  const funds: FundRow[] = useMemo(() => {
    const list = ((plan?.funds ?? []) as FundRow[]).slice();
    list.sort((a, b) => (toFrac(b.weight_pct ?? b.weight) ?? 0) - (toFrac(a.weight_pct ?? a.weight) ?? 0));
    return list;
  }, [plan]);

  const totalMonthly = useMemo(
    () => funds.reduce((s, f) => s + (monthlySip(f) ?? 0), 0),
    [funds],
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link href={`/portal/${id}`} className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline">
        &larr; Back to portal
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold text-navy-900">My Portfolio</h1>
      <p className="mt-1 text-sm text-navy-600">
        The fund mix built for your plan — the same allocation your goals are planned against.
      </p>

      {loading ? (
        <div className="card mt-6 animate-pulse space-y-3">
          <div className="h-6 w-40 rounded bg-navy-100" />
          <div className="h-40 rounded bg-navy-100" />
          <div className="h-6 w-full rounded bg-navy-100" />
        </div>
      ) : error ? (
        <div className="card mt-6 text-center">
          <p className="text-sm text-rose-600">{error}</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <section className="card mt-6" aria-label="Asset allocation">
            <h2 className="font-display text-lg font-semibold text-navy-900">Allocation by asset class</h2>
            <div className="mt-4">
              <Donut data={donutData} labels={ASSET_CLASS_LABELS} />
            </div>
            {funds.length > 0 && (
              <p className="mt-3 text-sm text-navy-600">
                Total monthly investment across funds:{" "}
                <strong className="text-navy-900">{inr(totalMonthly)}</strong>
              </p>
            )}
          </section>

          <section className="mt-6" aria-label="Funds">
            <h2 className="font-display text-lg font-semibold text-navy-900">Your funds</h2>
            {funds.length === 0 ? (
              <div className="card mt-3">
                <p className="text-sm text-navy-600">No funds in this plan yet.</p>
              </div>
            ) : (
              <ul className="mt-3 space-y-4">
                {funds.map((f, i) => {
                  const sip = monthlySip(f);
                  const w = toFrac(f.weight_pct ?? f.weight);
                  const bullets = whyBullets(f);
                  const catSlug = f.cat || f.category || "";
                  const catLabel = CATEGORY_LABELS[catSlug] ?? f.category ?? catSlug ?? "–";
                  return (
                    <li key={f.scheme_code || `${f.scheme_name}-${i}`} className="card">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-display text-base font-semibold text-navy-900">{f.scheme_name}</h3>
                        {w !== null && (
                          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700">
                            {pct(w)}
                          </span>
                        )}
                      </div>
                      <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-navy-500">Category</dt>
                          <dd className="text-navy-800">{catLabel}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-navy-500">AMC</dt>
                          <dd className="text-navy-800">{f.amc || "–"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-navy-500">Monthly SIP</dt>
                          <dd className="font-medium text-navy-800">{sip === null ? "–" : inr(sip)}</dd>
                        </div>
                      </dl>
                      {bullets.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
                            Why it fits your plan
                          </p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-navy-700">
                            {bullets.map((b, j) => (
                              <li key={j}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
