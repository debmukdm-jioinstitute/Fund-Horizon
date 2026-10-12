// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  addHouseholdMember,
  crmRaw,
  fetchHouseholdDetail,
  type Activity,
  type CrmCase,
  type HouseholdDetail,
  type HouseholdMember,
  type Opportunity,
} from "../../lib/crmApi";
import { shortInr, inr } from "../../lib/format";

interface ProductRows {
  policies: { id: string; insurer?: string | null; policy_no?: string | null; premium_amount?: number | null; renewal_date?: string | null; policy_type?: string; status?: string }[];
  fds: { id: string; company?: string | null; amount?: number | null; maturity_date?: string | null; status?: string }[];
  pms: { id: string; provider?: string | null; amount?: number | null; status?: string }[];
  suitability: { risk_band?: string | null; recorded_at?: string; financial_status?: string | null; investment_experience?: string | null; objectives?: string | null } | null;
}

function formatDate(iso: string | null | undefined): string {
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

const ROLE_LABELS: Record<string, string> = {
  primary: "Primary",
  spouse: "Spouse",
  child: "Child",
  dependent: "Dependent",
  other: "Other",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5">
      <h3 className="text-sm font-bold text-navy-950 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function HouseholdView({ householdId }: { householdId: string }) {
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [products, setProducts] = useState<ProductRows | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [role, setRole] = useState("primary");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchHouseholdDetail(householdId);
      setDetail(d);

      // Product & suitability data loaded only when those endpoints respond
      // (W4 endpoints may not be live yet); failures are ignored silently.
      const [policies, fds, pms] = await Promise.all([
        crmRaw<ProductRows["policies"]>(`/policies?household_id=${householdId}`).catch(() => null),
        crmRaw<ProductRows["fds"]>(`/fds?household_id=${householdId}`).catch(() => null),
        crmRaw<ProductRows["pms"]>(`/pms?household_id=${householdId}`).catch(() => null),
      ]);
      let suitability: ProductRows["suitability"] = null;
      const primary = d.members.find((m) => m.role === "primary") ?? d.members[0];
      if (primary) {
        const recs = await crmRaw<ProductRows["suitability"][]>(
          `/suitability?customer_id=${primary.customer_id}`,
        ).catch(() => null);
        suitability = recs?.[0] ?? null;
      }
      if (policies !== null || fds !== null || pms !== null || suitability !== null) {
        setProducts({
          policies: policies ?? [],
          fds: fds ?? [],
          pms: pms ?? [],
          suitability,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the household");
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await addHouseholdMember(householdId, { customer_id: customerId.trim(), role });
      setCustomerId("");
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add the member");
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-xs text-navy-500">Loading household…</div>;
  }
  if (error || !detail) {
    return (
      <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
        {error ?? "Could not load the household."}
      </div>
    );
  }

  const { household, members, opportunities, activities, cases } = detail;

  const memberList = (ms: HouseholdMember[]) =>
    ms.length === 0 ? (
      <p className="text-xs text-navy-400">No members linked yet.</p>
    ) : (
      <div className="divide-y divide-navy-100">
        {ms.map((m) => (
          <div key={m.customer_id} className="py-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-navy-950">{m.name}</div>
              <div className="text-[11px] text-navy-400">
                {[m.email, m.mobile].filter(Boolean).join(" · ") || "No contact details"}
              </div>
            </div>
            <span className="px-2 py-1 rounded-lg bg-navy-50 text-navy-700 text-[11px] font-semibold">
              {ROLE_LABELS[m.role] ?? m.role}
            </span>
          </div>
        ))}
      </div>
    );

  const oppList = (ops: Opportunity[]) =>
    ops.length === 0 ? (
      <p className="text-xs text-navy-400">No opportunities for this household yet.</p>
    ) : (
      <div className="divide-y divide-navy-100">
        {ops.map((o) => (
          <div key={o.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-navy-950">{o.title}</div>
              {o.amount != null && (
                <div className="text-xs font-extrabold text-navy-950">{inr(o.amount / 100)}</div>
              )}
            </div>
            <div className="text-[11px] text-navy-400 mt-0.5">
              {o.product_line.replaceAll("_", " ")} · {o.stage.replaceAll("_", " ")} ·{" "}
              {o.probability}% probability
              {o.expected_close ? ` · closes ${formatDate(o.expected_close)}` : ""}
            </div>
          </div>
        ))}
      </div>
    );

  const timeline = (as: Activity[]) =>
    as.length === 0 ? (
      <p className="text-xs text-navy-400">No activity recorded yet.</p>
    ) : (
      <ol className="relative border-l border-navy-100 ml-1.5 space-y-4">
        {as.map((a) => (
          <li key={a.id} className="pl-4 relative">
            <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500" />
            <div className="text-xs font-bold text-navy-950">
              {a.subject}
              {a.done_at && <span className="ml-2 text-[10px] text-teal-700 font-semibold">Done</span>}
            </div>
            <div className="text-[11px] text-navy-400">
              {a.kind} · {formatDate(a.created_at)}
              {a.due_at && !a.done_at ? ` · due ${formatDate(a.due_at)}` : ""}
            </div>
            {a.body && <div className="text-[11px] text-navy-600 mt-1">{a.body}</div>}
          </li>
        ))}
      </ol>
    );

  const caseList = (cs: CrmCase[]) =>
    cs.length === 0 ? (
      <p className="text-xs text-navy-400">No open cases.</p>
    ) : (
      <div className="divide-y divide-navy-100">
        {cs.map((c) => (
          <div key={c.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-navy-950">{c.subject}</div>
              <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                {c.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="text-[11px] text-navy-400 mt-0.5">
              {c.category} · opened {formatDate(c.created_at)}
              {c.sla_due_at ? ` · SLA by ${formatDate(c.sla_due_at)}` : ""}
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-navy-950">{household.name}</h2>
            <p className="text-[11px] text-navy-400">
              Created {formatDate(household.created_at)} · {members.length} member
              {members.length === 1 ? "" : "s"} · {opportunities.length} opportunit
              {opportunities.length === 1 ? "y" : "ies"}
            </p>
            {household.notes && <p className="text-xs text-navy-600 mt-2">{household.notes}</p>}
          </div>
          <form onSubmit={handleAddMember} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] font-semibold text-navy-700 mb-1">
                Add member (customer ID)
              </label>
              <input
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Customer ID"
                className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 placeholder:text-navy-300 focus:outline-none focus:ring-2 focus:ring-teal-500 w-40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-navy-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {Object.entries(ROLE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={adding || !customerId.trim()}
              className="px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl transition"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </form>
        </div>
        {addError && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
            {addError}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Members">{memberList(members)}</Section>
        <Section title="Opportunities">{oppList(opportunities)}</Section>
      </div>

      {products && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Section title="Insurance policies">
            {products.policies.length === 0 ? (
              <p className="text-xs text-navy-400">No policies linked.</p>
            ) : (
              <div className="divide-y divide-navy-100">
                {products.policies.map((p) => (
                  <div key={p.id} className="py-2">
                    <div className="text-xs font-bold text-navy-950">
                      {p.insurer ?? "Policy"} · {p.policy_type?.replaceAll("_", " ") ?? "–"}
                    </div>
                    <div className="text-[11px] text-navy-400">
                      {p.policy_no ?? "No policy number"} · premium{" "}
                      {p.premium_amount != null ? inr(p.premium_amount / 100) : "–"} · renews{" "}
                      {formatDate(p.renewal_date)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Corporate FDs">
            {products.fds.length === 0 ? (
              <p className="text-xs text-navy-400">No FDs linked.</p>
            ) : (
              <div className="divide-y divide-navy-100">
                {products.fds.map((f) => (
                  <div key={f.id} className="py-2">
                    <div className="text-xs font-bold text-navy-950">
                      {f.company ?? "FD"} · {f.amount != null ? shortInr(f.amount / 100) : "–"}
                    </div>
                    <div className="text-[11px] text-navy-400">
                      matures {formatDate(f.maturity_date)} · {f.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="PMS accounts">
            {products.pms.length === 0 ? (
              <p className="text-xs text-navy-400">No PMS accounts linked.</p>
            ) : (
              <div className="divide-y divide-navy-100">
                {products.pms.map((p) => (
                  <div key={p.id} className="py-2">
                    <div className="text-xs font-bold text-navy-950">
                      {p.provider ?? "PMS"} · {p.amount != null ? shortInr(p.amount / 100) : "–"}
                    </div>
                    <div className="text-[11px] text-navy-400">{p.status}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Activity timeline (latest 20)">{timeline(activities)}</Section>
        <Section title="Open cases">{caseList(cases)}</Section>
      </div>

      {products?.suitability && (
        <Section title="Latest suitability record">
          <div className="text-xs text-navy-800 space-y-1.5">
            {products.suitability.risk_band && (
              <div>
                <span className="font-semibold text-navy-500">Risk band:</span>{" "}
                {products.suitability.risk_band}
              </div>
            )}
            {products.suitability.financial_status && (
              <div>
                <span className="font-semibold text-navy-500">Financial status:</span>{" "}
                {products.suitability.financial_status}
              </div>
            )}
            {products.suitability.investment_experience && (
              <div>
                <span className="font-semibold text-navy-500">Experience:</span>{" "}
                {products.suitability.investment_experience}
              </div>
            )}
            {products.suitability.objectives && (
              <div>
                <span className="font-semibold text-navy-500">Objectives:</span>{" "}
                {products.suitability.objectives}
              </div>
            )}
            <div className="text-[11px] text-navy-400">
              Recorded {formatDate(products.suitability.recorded_at)}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
