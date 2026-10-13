// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CustomerRecord,
  MeUser,
  RmCustomerPlan,
  fetchRmCustomerPlans,
  fetchRmCustomers,
} from "./account-api";

function formatDate(iso?: string): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "–";
  }
}

export default function AdminRmView({ me }: { me: MeUser }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [plansByCustomer, setPlansByCustomer] = useState<Record<string, RmCustomerPlan[]>>({});
  const [plansLoadingId, setPlansLoadingId] = useState<string | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCustomers(await fetchRmCustomers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your customers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCustomer = async (customer: CustomerRecord) => {
    if (expandedId === customer.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(customer.id);
    setPlansError(null);
    if (plansByCustomer[customer.id]) return;
    setPlansLoadingId(customer.id);
    try {
      const plans = await fetchRmCustomerPlans(customer.id);
      setPlansByCustomer((prev) => ({ ...prev, [customer.id]: plans }));
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : "Could not load plans");
    } finally {
      setPlansLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-navy-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-navy-950">My customers</h2>
          <p className="text-xs text-navy-500">
            Signed in as {me.name}. These are the accounts assigned to you — expand a row to
            see their plans.
          </p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition self-start md:self-auto"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-navy-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-navy-500">Loading your customers...</div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-xs text-navy-500">
            No customers are assigned to you yet. An admin can assign accounts from the
            customer list.
          </div>
        ) : (
          <ul className="divide-y divide-navy-100">
            {customers.map((c) => {
              const expanded = expandedId === c.id;
              const plans = plansByCustomer[c.id];
              return (
                <li key={c.id}>
                  <button
                    onClick={() => toggleCustomer(c)}
                    className="w-full text-left px-5 py-4 hover:bg-teal-50/20 transition flex items-center justify-between gap-4"
                    aria-expanded={expanded}
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-navy-950 text-sm truncate">{c.name}</div>
                      <div className="text-xs text-navy-500 truncate">
                        {c.email} · {c.mobile}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="bg-navy-50 text-navy-700 px-2 py-0.5 rounded text-xs font-medium">
                        {c.plan_count} {c.plan_count === 1 ? "plan" : "plans"}
                      </span>
                      <span
                        className={`text-navy-600 text-xs transition-transform ${expanded ? "rotate-180" : ""}`}
                        aria-hidden
                      >
                        ▾
                      </span>
                    </div>
                  </button>

                  {expanded && (
                    <div className="px-5 pb-5 pt-1 bg-navy-50/40">
                      {plansLoadingId === c.id ? (
                        <p className="text-xs text-navy-500 py-3">Loading plans...</p>
                      ) : plansError ? (
                        <p className="text-xs font-medium text-rose-600 py-3">{plansError}</p>
                      ) : !plans || plans.length === 0 ? (
                        <p className="text-xs text-navy-500 py-3">
                          This customer has no plans yet.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {plans.map((p) => (
                            <li
                              key={p.id}
                              className="flex items-center justify-between gap-3 bg-white border border-navy-100 rounded-xl px-4 py-3"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-navy-950 truncate">
                                  {typeof p.client_name === "string" && p.client_name
                                    ? p.client_name
                                    : "Plan"}
                                </div>
                                <div className="text-xs text-navy-500 font-mono">
                                  {p.id.slice(0, 8)}... · {formatDate(p.created_at)}
                                </div>
                              </div>
                              <Link
                                href={`/portal/${p.id}`}
                                target="_blank"
                                className="px-3 py-1.5 text-xs font-semibold bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-lg transition shrink-0"
                              >
                                Open portal
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
