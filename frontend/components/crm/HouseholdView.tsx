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
import { ApiError } from "../../lib/api";

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
    <div className="bg-white rounded-2xl border border-[#ECEBEA] shadow-sm p-5">
      <h3 className="text-sm font-bold text-[#181818] mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function HouseholdView({
  householdId,
  onNotFound,
  showTitle = true,
}: {
  householdId: string;
  onNotFound?: () => void;
  /** The record page shows the name, notes and counts in its own header. */
  showTitle?: boolean;
}) {
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
      if (e instanceof ApiError && e.status === 404 && onNotFound) onNotFound();
      setError(e instanceof Error ? e.message : "Could not load the household");
    } finally {
      setLoading(false);
    }
  }, [householdId, onNotFound]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddMember = async (e: React.FormEvent | null, override = false) => {
    e?.preventDefault();
    if (!customerId.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      await addHouseholdMember(householdId, { customer_id: customerId.trim(), role, override: override || undefined });
      setCustomerId("");
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add the member");
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading" className="space-y-2 p-5">
        <div className="h-6 w-1/3 rounded bg-[#ECEBEA] dark:bg-[#2B3644] animate-pulse" />
        <div className="h-4 w-2/3 rounded bg-[#ECEBEA] dark:bg-[#2B3644] animate-pulse" />
      </div>
    );
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
      <p className="text-xs text-[#706E6B]">No members linked yet.</p>
    ) : (
      <div className="divide-y divide-[#ECEBEA]">
        {ms.map((m) => (
          <div key={m.customer_id} className="py-2.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-[#181818]">{m.name}</div>
              <div className="text-xs text-[#706E6B]">
                {[m.email, m.mobile].filter(Boolean).join(" · ") || "No contact details"}
              </div>
            </div>
            <span className="px-2 py-1 rounded-lg bg-[#F3F3F3] text-[#444444] text-xs font-semibold">
              {ROLE_LABELS[m.role] ?? m.role}
            </span>
          </div>
        ))}
      </div>
    );

  const oppList = (ops: Opportunity[]) =>
    ops.length === 0 ? (
      <p className="text-xs text-[#706E6B]">No opportunities for this household yet.</p>
    ) : (
      <div className="divide-y divide-[#ECEBEA]">
        {ops.map((o) => (
          <div key={o.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-[#181818]">{o.title}</div>
              {o.amount != null && (
                <div className="text-xs font-extrabold text-[#181818]">{inr(o.amount / 100)}</div>
              )}
            </div>
            <div className="text-xs text-[#706E6B] mt-0.5">
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
      <p className="text-xs text-[#706E6B]">No activity recorded yet.</p>
    ) : (
      <ol className="relative border-l border-[#ECEBEA] ml-1.5 space-y-4">
        {as.map((a) => (
          <li key={a.id} className="pl-4 relative">
            <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-[#0176D3]" />
            <div className="text-xs font-bold text-[#181818]">
              {a.subject}
              {a.done_at && <span className="ml-2 text-xs text-[#0176D3] font-semibold">Done</span>}
            </div>
            <div className="text-xs text-[#706E6B]">
              {a.kind} · {formatDate(a.created_at)}
              {a.due_at && !a.done_at ? ` · due ${formatDate(a.due_at)}` : ""}
            </div>
            {a.body && <div className="text-xs text-[#706E6B] mt-1">{a.body}</div>}
          </li>
        ))}
      </ol>
    );

  const caseList = (cs: CrmCase[]) =>
    cs.length === 0 ? (
      <p className="text-xs text-[#706E6B]">No open cases.</p>
    ) : (
      <div className="divide-y divide-[#ECEBEA]">
        {cs.map((c) => (
          <div key={c.id} className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-bold text-[#181818]">{c.subject}</div>
              <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                {c.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="text-xs text-[#706E6B] mt-0.5">
              {c.category} · opened {formatDate(c.created_at)}
              {c.sla_due_at ? ` · SLA by ${formatDate(c.sla_due_at)}` : ""}
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#ECEBEA] shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          {showTitle ? (
          <div>
            <h2 className="text-lg font-bold text-[#181818]">{household.name}</h2>
            <p className="text-xs text-[#706E6B]">
              Created {formatDate(household.created_at)} · {members.length} member
              {members.length === 1 ? "" : "s"} · {opportunities.length} opportunit
              {opportunities.length === 1 ? "y" : "ies"}
            </p>
            {household.notes && <p className="text-xs text-[#706E6B] mt-2">{household.notes}</p>}
          </div>
          ) : (
            <h3 className="text-sm font-bold text-[#181818]">Members</h3>
          )}
          <form onSubmit={(e) => handleAddMember(e)} className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs font-semibold text-[#444444] mb-1">
                Add member (customer ID)
              </label>
              <input
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="Customer ID"
                className="px-3 py-2 text-xs rounded-xl border border-[#E5E5E5] bg-white text-[#181818] placeholder:text-[#706E6B] focus:outline-none focus:ring-2 focus:ring-[#0176D3] w-40"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#444444] mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl border border-[#E5E5E5] bg-white text-[#181818] focus:outline-none focus:ring-2 focus:ring-[#0176D3]"
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
              className="px-3 py-2 text-xs font-bold bg-[#0176D3] hover:bg-[#014486] disabled:opacity-50 text-white rounded-xl transition"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </form>
        </div>
        {addError && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
            {addError}
            {addError.includes("override=true") && (
              <button
                type="button"
                disabled={adding}
                onClick={() => handleAddMember(null, true)}
                className="ml-2 underline font-bold disabled:opacity-50"
              >
                Add anyway
              </button>
            )}
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
              <p className="text-xs text-[#706E6B]">No policies linked.</p>
            ) : (
              <div className="divide-y divide-[#ECEBEA]">
                {products.policies.map((p) => (
                  <div key={p.id} className="py-2">
                    <div className="text-xs font-bold text-[#181818]">
                      {p.insurer ?? "Policy"} · {p.policy_type?.replaceAll("_", " ") ?? "–"}
                    </div>
                    <div className="text-xs text-[#706E6B]">
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
              <p className="text-xs text-[#706E6B]">No FDs linked.</p>
            ) : (
              <div className="divide-y divide-[#ECEBEA]">
                {products.fds.map((f) => (
                  <div key={f.id} className="py-2">
                    <div className="text-xs font-bold text-[#181818]">
                      {f.company ?? "FD"} · {f.amount != null ? shortInr(f.amount / 100) : "–"}
                    </div>
                    <div className="text-xs text-[#706E6B]">
                      matures {formatDate(f.maturity_date)} · {f.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="PMS accounts">
            {products.pms.length === 0 ? (
              <p className="text-xs text-[#706E6B]">No PMS accounts linked.</p>
            ) : (
              <div className="divide-y divide-[#ECEBEA]">
                {products.pms.map((p) => (
                  <div key={p.id} className="py-2">
                    <div className="text-xs font-bold text-[#181818]">
                      {p.provider ?? "PMS"} · {p.amount != null ? shortInr(p.amount / 100) : "–"}
                    </div>
                    <div className="text-xs text-[#706E6B]">{p.status}</div>
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
          <div className="text-xs text-[#444444] space-y-1.5">
            {products.suitability.risk_band && (
              <div>
                <span className="font-semibold text-[#706E6B]">Risk band:</span>{" "}
                {products.suitability.risk_band}
              </div>
            )}
            {products.suitability.financial_status && (
              <div>
                <span className="font-semibold text-[#706E6B]">Financial status:</span>{" "}
                {products.suitability.financial_status}
              </div>
            )}
            {products.suitability.investment_experience && (
              <div>
                <span className="font-semibold text-[#706E6B]">Experience:</span>{" "}
                {products.suitability.investment_experience}
              </div>
            )}
            {products.suitability.objectives && (
              <div>
                <span className="font-semibold text-[#706E6B]">Objectives:</span>{" "}
                {products.suitability.objectives}
              </div>
            )}
            <div className="text-xs text-[#706E6B]">
              Recorded {formatDate(products.suitability.recorded_at)}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
