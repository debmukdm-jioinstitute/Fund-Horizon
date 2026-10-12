// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import { fetchDashboard, PRODUCT_LINES, type CrmDashboard } from "../../lib/crmApi";
import { shortInr } from "../../lib/format";

interface CrmHomeProps {
  /** Called with the tab key to jump to a CRM tab (coordinator wires tabs). */
  onNavigate?: (tab: string) => void;
}

const PRODUCT_LINE_LABELS: Record<string, string> = {
  mutual_fund: "Mutual funds",
  life_insurance: "Life insurance",
  general_insurance: "General insurance",
  corporate_fd: "Corporate FDs",
  pms: "PMS",
};

function KpiCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5 text-left hover:border-teal-300 hover:shadow transition w-full"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-navy-500">{label}</div>
      <div className="text-2xl font-extrabold text-navy-950 mt-1.5">{value}</div>
      {hint && <div className="text-[11px] text-navy-400 mt-1">{hint}</div>}
    </button>
  );
}

export default function CrmHome({ onNavigate }: CrmHomeProps) {
  const [data, setData] = useState<CrmDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the dashboard"))
      .finally(() => setLoading(false));
  }, []);

  const go = (tab: string) => () => onNavigate?.(tab);

  if (loading) {
    return <div className="p-12 text-center text-xs text-navy-500">Loading the CRM overview…</div>;
  }

  if (error || !data) {
    return (
      <div className="p-5 rounded-2xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
        {error ?? "Could not load the dashboard."}
      </div>
    );
  }

  const pipelineTotal = PRODUCT_LINES.reduce(
    (sum, line) => sum + (data.pipeline_value_by_line[line] ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-navy-950">CRM overview</h2>
        <p className="text-xs text-navy-500">
          A live snapshot of households, leads, pipeline and work due. Pick a card to open the
          matching section.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Households"
          value={String(data.households_count)}
          hint="Families under management"
          onClick={go("households")}
        />
        <KpiCard
          label="Active leads"
          value={String(data.active_leads_count)}
          hint="New, contacted or qualified"
          onClick={go("leads")}
        />
        <KpiCard
          label="Open cases"
          value={String(data.open_cases_count)}
          hint="Need attention"
          onClick={go("cases")}
        />
        <KpiCard
          label="Tasks due"
          value={String(data.tasks_due_count)}
          hint="Due within 7 days"
          onClick={go("activities")}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-navy-950">Pipeline value</h3>
            <div className="text-lg font-extrabold text-navy-950">
              {shortInr(pipelineTotal / 100)}
            </div>
          </div>
          <p className="text-[11px] text-navy-400 mb-3">
            Open opportunities, grouped by product line (excludes lost).
          </p>
          <div className="space-y-2">
            {PRODUCT_LINES.map((line) => {
              const v = data.pipeline_value_by_line[line] ?? 0;
              const pct = pipelineTotal > 0 ? Math.round((v / pipelineTotal) * 100) : 0;
              return (
                <button
                  key={line}
                  type="button"
                  onClick={go("pipeline")}
                  className="w-full text-left hover:bg-teal-50/40 rounded-xl px-2 py-1.5 transition"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-navy-800">
                      {PRODUCT_LINE_LABELS[line]}
                    </span>
                    <span className="font-bold text-navy-950">{shortInr(v / 100)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-navy-100 mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-navy-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-navy-950">Deadlines coming up</h3>
          <p className="text-[11px] text-navy-400 mb-3">
            Proactive reminders generated from stored policies and FDs.
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={go("renewals")}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-amber-50/60 border border-amber-100 hover:bg-amber-50 transition text-left"
            >
              <div>
                <div className="text-xs font-bold text-navy-950">Policy renewals</div>
                <div className="text-[11px] text-navy-500">Due in the next 30 days</div>
              </div>
              <div className="text-xl font-extrabold text-amber-700">{data.renewals_due_30d}</div>
            </button>
            <button
              type="button"
              onClick={go("maturities")}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-sky-50/60 border border-sky-100 hover:bg-sky-50 transition text-left"
            >
              <div>
                <div className="text-xs font-bold text-navy-950">FD maturities</div>
                <div className="text-[11px] text-navy-500">Maturing in the next 60 days</div>
              </div>
              <div className="text-xl font-extrabold text-sky-700">{data.fd_maturities_60d}</div>
            </button>
          </div>
          <div className="mt-4 pt-3 border-t border-navy-100">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-navy-500 mb-2">
              Shortcuts
            </h4>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "import", label: "Import clients" },
                { key: "compliance", label: "Compliance" },
                { key: "pipelines", label: "Pipelines" },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={go(s.key)}
                  className="px-3 py-1.5 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
