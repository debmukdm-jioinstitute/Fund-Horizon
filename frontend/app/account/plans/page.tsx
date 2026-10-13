// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { getMyPlans, ApiError } from "@/lib/api";
import type { MyPlan } from "@/lib/types";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function MyPlansPage() {
  const { customer, loading: authLoading } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<MyPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !customer) {
      router.replace("/login");
    }
  }, [authLoading, customer, router]);

  useEffect(() => {
    if (authLoading || !customer) return;
    (async () => {
      try {
        const res = await getMyPlans();
        setPlans(res?.plans ?? []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "We couldn't load your plans. Please try again.");
        setPlans([]);
      }
    })();
  }, [authLoading, customer]);

  if (authLoading || !customer) {
    return (
      <div className="w-full py-16 text-center text-navy-600">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="w-full py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-950">My plans</h1>
          <p className="mt-1 text-sm text-navy-600">
            Every plan you have created, in one place.
          </p>
        </div>
        <Link
          href="/plan/new"
          className="rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
        >
          + New plan
        </Link>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}

      {plans === null ? (
        <div className="card space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-navy-50" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="card text-center">
          <p className="text-lg font-bold text-navy-950">You don&apos;t have any plans yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-navy-600">
            Answer a few questions and we will build an illustrative plan around your goals.
          </p>
          <Link
            href="/plan/new"
            className="mt-4 inline-block rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Create your first plan
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {plans.map((plan) => (
            <li key={plan.id}>
              <Link
                href={`/portal/${plan.id}`}
                className="card flex items-center justify-between gap-4 !p-4 transition hover:border-teal-300 hover:shadow-lg"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-navy-950">
                    Plan · {formatDate(plan.created_at)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-navy-600">
                    {plan.goal_count !== undefined && (
                      <span>{plan.goal_count} {plan.goal_count === 1 ? "goal" : "goals"}</span>
                    )}
                    {plan.risk_band && <span>Risk profile: {plan.risk_band}</span>}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-teal-700">
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
