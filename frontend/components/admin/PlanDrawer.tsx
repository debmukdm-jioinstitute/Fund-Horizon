// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import Link from "next/link";
import { inr, pct, shortInr } from "@/lib/format";
import { reportUrl } from "@/lib/api";

interface GoalRecord {
  name: string;
  years?: number;
  target_amount?: number;
  future_cost?: number;
  monthly_sip?: number;
}

import { AdminPlanSummary } from "@/lib/admin-api";

interface PlanDrawerProps {
  plan: AdminPlanSummary | Record<string, unknown> | null;
  onClose: () => void;
}


export default function PlanDrawer({ plan, onClose }: PlanDrawerProps) {
  if (!plan) return null;

  const req = (plan.request as Record<string, unknown>) || {};
  const res = (plan.result as Record<string, unknown>) || {};
  const client = (req.client as Record<string, unknown>) || {};
  const goals = (res.goals as GoalRecord[]) || [];
  const profile = (res.profile as Record<string, unknown>) || {};
  const allocation = (res.allocation as Record<string, unknown>) || {};
  const sip = (res.sip as Record<string, unknown>) || {};
  const mc = (res.monte_carlo as Record<string, unknown>) || {};
  const emergencyFund = (res.emergency_fund as Record<string, unknown>) || {};

  const totalCorpus = goals.reduce((acc, g) => acc + (g.future_cost || 0), 0);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="bg-navy-950 px-6 py-5 text-white flex items-center justify-between border-b border-navy-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-teal-400 bg-teal-950/80 px-2 py-0.5 rounded border border-teal-800">
                  Plan Inspection
                </span>
                <span className="text-xs text-navy-600">ID: {String(plan.id || "").slice(0, 8)}...</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white mt-1">
                {String(client.first_name || "")} {String(client.last_name || "")}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-navy-300 hover:text-white p-2 rounded-lg hover:bg-navy-800 transition"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Action Ribbon */}
          <div className="bg-navy-900/40 px-6 py-3 border-b border-navy-100 flex items-center justify-between">
            <span className="text-xs text-navy-600 font-medium">
              Created: {plan.created_at ? new Date(String(plan.created_at)).toLocaleString("en-IN") : "–"}
            </span>
            <div className="flex items-center gap-2">
              <Link
                href={`/plan/${String(plan.id)}`}
                target="_blank"
                className="text-xs bg-navy-800 hover:bg-navy-900 text-white font-medium px-3 py-1.5 rounded transition inline-flex items-center gap-1"
              >
                Open Dashboard
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </Link>
              <a
                href={reportUrl(String(plan.id))}
                target="_blank"
                rel="noreferrer"
                className="text-xs bg-teal-600 hover:bg-teal-700 text-white font-medium px-3 py-1.5 rounded transition inline-flex items-center gap-1"
              >
                PDF Report
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.5L19 7.5V19a2 2 0 01-2 2z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Client & Risk Band Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-navy-100 bg-navy-50/50">
                <span className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Client Profile</span>
                <p className="text-lg font-bold text-navy-950 mt-1">Age {String(client.age || "–")}</p>
                <p className="text-xs text-navy-600 mt-0.5">
                  Monthly Income: {client.income_monthly ? inr(Number(client.income_monthly)) : "–"}
                </p>
                <p className="text-xs text-navy-600">
                  Emergency Fund: {emergencyFund.target ? inr(Number(emergencyFund.target)) : "–"}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-navy-100 bg-teal-50/40">
                <span className="text-xs font-semibold text-teal-700 uppercase tracking-wide">Risk Assessment</span>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg font-bold text-navy-900">{String(profile.band || "–")}</span>
                  <span className="text-xs bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-semibold">
                    Score: {String(profile.score ?? "–")}
                  </span>
                </div>
                <p className="text-xs text-navy-600 mt-1">
                  Equity: {allocation.equity_pct ? pct(Number(allocation.equity_pct) / 100) : "–"} | Debt: {allocation.debt_pct ? pct(Number(allocation.debt_pct) / 100) : "–"}
                </p>
              </div>
            </div>

            {/* Target SIP & Corpus KPIs */}
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-navy-900 text-white">
              <div>
                <span className="text-xs text-navy-300">Total Monthly SIP</span>
                <p className="text-lg font-bold text-teal-400 mt-0.5">
                  {sip.total_monthly_sip ? inr(Number(sip.total_monthly_sip)) : "–"}
                </p>
              </div>
              <div>
                <span className="text-xs text-navy-300">Target Corpus</span>
                <p className="text-lg font-bold text-white mt-0.5">
                  {shortInr(totalCorpus)}
                </p>
              </div>
              <div>
                <span className="text-xs text-navy-300">Simulation Success</span>
                <p className="text-lg font-bold text-teal-300 mt-0.5">
                  {mc.success_rate !== undefined ? pct(Number(mc.success_rate)) : "–"}
                </p>
              </div>
            </div>

            {/* Goals List */}
            <div>
              <h3 className="text-sm font-bold text-navy-900 mb-3 flex items-center justify-between">
                <span>Client Goals ({goals.length})</span>
                <span className="text-xs text-navy-500 font-normal">Indexed for inflation</span>
              </h3>
              <div className="space-y-2">
                {goals.map((g, i) => (
                  <div key={i} className="p-3.5 rounded-lg border border-navy-100 bg-white hover:border-navy-300 transition">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-navy-950">{g.name}</span>
                      <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">
                        SIP {inr(g.monthly_sip)}/mo
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-navy-600 mt-1">
                      <span>Horizon: {g.years} yrs</span>
                      <span>Target Today: {shortInr(g.target_amount)}</span>
                      <span>Future Cost: {shortInr(g.future_cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Raw JSON Accordion */}
            <details className="p-3.5 rounded-lg border border-navy-100 bg-navy-50/40 text-xs text-navy-700">
              <summary className="font-semibold text-navy-900 cursor-pointer">View Raw Calculation Payload</summary>
              <pre className="mt-3 p-3 bg-navy-950 text-navy-100 rounded overflow-x-auto text-xs leading-relaxed">
                {JSON.stringify(plan, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
