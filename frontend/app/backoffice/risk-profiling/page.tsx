"use client";

import { AiPicksPreview } from "@/components/AiPicks";
import React, { useEffect, useMemo, useState } from "react";
import { API_URL, getMe, resolveApiUrl } from "@/lib/api";
import {
  BANDS,
  ClientCapacityInputs,
  computeClientProfileLocally,
  FactorScore,
  BLANK_CLIENT,
  PROFILING_PRESETS,
  QUESTIONNAIRE_QUESTIONS,
  RiskProfileResult,
} from "@/lib/profiling";

export default function RiskProfilingPage() {
  const [activeTab, setActiveTab] = useState<"studio" | "methodology">("studio");

  // Client inputs
  const [client, setClient] = useState<ClientCapacityInputs>(BLANK_CLIENT);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  // PDF report state
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [fundPicks, setFundPicks] = useState<{ scheme_code: string; weight_pct: number }[] | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // CRM save state
  const [targetCustomerId, setTargetCustomerId] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const DRAFT_KEY = "fundhorizon_risk_profiling_draft";

  // Restore draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.client) setClient(parsed.client);
        if (parsed.answers) setAnswers(parsed.answers);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Autosave draft on changes
  useEffect(() => {
    try {
      const isDirty = client.firstName || client.age > 0 || client.monthlyIncome > 0 || Object.keys(answers).length > 0;
      if (isDirty) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ client, answers }));
      }
    } catch {
      /* ignore */
    }
  }, [client, answers]);

  const resetForm = () => {
    setClient(BLANK_CLIENT);
    setAnswers({});
    setSaveStatus(null);
    setPdfError(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  // Client-facing link; ?ref attributes the new lead/account to the staff member who shares it.
  const [clientLink, setClientLink] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    getMe()
      .then((m) => m?.id)
      .catch(() => undefined)
      .then((id) => setClientLink(`${window.location.origin}/risk-profile${id ? `?ref=${encodeURIComponent(id)}` : ""}`));
  }, []);

  // Live calculated profile
  const profile: RiskProfileResult = useMemo(() => {
    return computeClientProfileLocally(client, answers);
  }, [client, answers]);

  const nameValid = client.firstName.trim().length >= 3 && client.firstName.trim().length <= 100;
  const ageValid = client.age >= 18 && client.age <= 100;
  const empValid = Boolean(client.employmentType);
  const incomeValid = client.monthlyIncome > 0;
  const depValid = client.dependents >= 0 && client.dependents <= 15;
  const questionnaireAnsweredCount = QUESTIONNAIRE_QUESTIONS.filter((q) => answers[q.id] !== undefined).length;
  const questionnaireComplete = questionnaireAnsweredCount === QUESTIONNAIRE_QUESTIONS.length;

  const completedInputs = (nameValid ? 1 : 0) + (ageValid ? 1 : 0) + (empValid ? 1 : 0) + (incomeValid ? 1 : 0) + questionnaireAnsweredCount;
  const remainingInputs = 14 - completedInputs;
  const ready = nameValid && ageValid && empValid && incomeValid && depValid && questionnaireComplete;

  const loadPreset = (presetIndex: number) => {
    const p = PROFILING_PRESETS[presetIndex];
    if (!p) return;
    setClient({ ...p.client });
    setAnswers({ ...p.answers });
    setSaveStatus(null);
  };

  const handleAnswerChange = (qId: string, optIdx: number) => {
    setAnswers((prev) => ({ ...prev, [qId]: optIdx }));
    setSaveStatus(null);
  };

  const handleSaveToCrm = async () => {
    if (!ready) {
      setSaveStatus("Please complete the required client details and all 10 questions first.");
      return;
    }
    if (!targetCustomerId.trim()) {
      setSaveStatus("Please enter a valid Customer ID or Household reference.");
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const assessmentSummary = `Capacity: ${profile.capacity.score}/100, Tolerance: ${profile.tolerance}/100, Final Score: ${profile.final_score}/100. Target Allocation: ${profile.allocation.equity}% Equity, ${profile.allocation.debt}% Debt, ${profile.allocation.gold}% Gold, ${profile.allocation.liquid}% Liquid.`;
      const objectivesText = QUESTIONNAIRE_QUESTIONS[1].options[answers["q2"] ?? 0]?.text || "Balanced growth";
      const res = await fetch("/api/crm/suitability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: targetCustomerId.trim(),
          risk_band: profile.band,
          financial_status: `Monthly Income: ₹${client.monthlyIncome.toLocaleString("en-IN")}, NW Multiple: ${(
            (client.liquidAssets + client.investments - client.liabilities) /
            (12 * Math.max(1, client.monthlyIncome))
          ).toFixed(1)}x`,
          investment_experience: QUESTIONNAIRE_QUESTIONS[0].options[answers["q1"] ?? 0]?.text || "Mutual funds",
          objectives: `${objectivesText} | ${assessmentSummary}`,
          assessment: assessmentSummary,
        }),
      });
      if (res.ok) {
        setSaveStatus(`✅ Recorded suitability to CRM for ${targetCustomerId.trim()} (${profile.band}).`);
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveStatus(`❌ Failed to record to CRM (${res.status}): ${err.detail || "Server rejected request."}`);
      }
    } catch {
      setSaveStatus("❌ Network error: Could not record suitability to CRM.");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    setPdfError(null);
    try {
      const payload = {
        first_name: client.firstName || "Client",
        age: client.age,
        employment_type: client.employmentType,
        dependents: client.dependents,
        monthly_income: client.monthlyIncome,
        monthly_expenses: client.monthlyExpenses,
        monthly_emi: client.monthlyEmi,
        liquid_assets: client.liquidAssets,
        investments: client.investments,
        liabilities: client.liabilities,
        term_cover: client.termCover,
        health_cover: client.healthCover,
        retirement_age: client.retirementAge,
        answers,
        ...(fundPicks ? { fund_picks: fundPicks } : {}),
      };

      const targetUrl = resolveApiUrl(`${API_URL}/api/backoffice/risk-profiling/report.pdf`);
      const res = await fetch(targetUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errDetail = `Server returned ${res.status}`;
        try {
          const j = await res.json();
          if (j.detail) errDetail = j.detail;
        } catch {
          /* fallback */
        }
        throw new Error(errDetail);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const clientSlug = (client.firstName || "client").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "client";
      const dateStr = new Date().toISOString().split("T")[0];
      link.download = `risk_profiling_report_${clientSlug}_${dateStr}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate PDF report.";
      setPdfError(msg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#C5DDF7] bg-[#EAF5FE] p-3 text-xs dark:border-[#1F4A74] dark:bg-[#0F2A45]/40">
        <span className="font-semibold text-[#014486] dark:text-[#1B96FF]">Client link</span>
        <input readOnly value={clientLink} aria-label="Client risk profiling link" onFocus={(e) => e.currentTarget.select()} className="min-w-[240px] flex-1 rounded border border-[#C5DDF7] bg-white px-2 py-1 dark:border-[#1F4A74] dark:bg-navy-900" />
        <button
          type="button"
          disabled={!clientLink}
          onClick={() => navigator.clipboard.writeText(clientLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          className="rounded bg-[#0176D3] px-3 py-1 font-semibold text-white disabled:opacity-50"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <span className="w-full text-[11px] text-[#706E6B] dark:text-navy-400">
          Send to your client. On submit they get the PDF, a portal account is created, and the lead, account and suitability record land in the CRM.
        </span>
      </div>

      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ECEBEA] pb-4 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[#181818] dark:text-white">
              Risk Profiling & Suitability Studio
            </h1>
            <span className="rounded-full bg-[#EAF5FE] px-2.5 py-0.5 text-xs font-semibold text-[#014486] ring-1 ring-[#0176D3]/20 dark:bg-[#0F2A45]/40 dark:text-[#1B96FF]">
              SEBI Compliant
            </span>
          </div>
          <p className="mt-1 text-xs text-[#706E6B] dark:text-navy-400">
            Deterministic risk capacity (8 financial factors) vs emotional risk tolerance (10 questions) · Min-score rule · Strategic asset allocation
          </p>
        </div>

        {/* Actions & View Tabs */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloadingPdf || !ready}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0176D3] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#032D60] disabled:opacity-50"
            title="Download official 2-page A4 SEBI Suitability Assessment PDF"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {downloadingPdf ? "Generating PDF..." : "Download PDF Report"}
          </button>

          <div className="flex rounded-lg border border-[#E5E5E5] bg-[#F3F3F3] p-1 dark:border-navy-700 dark:bg-navy-900">
            <button
              type="button"
              onClick={() => setActiveTab("studio")}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "studio"
                  ? "bg-white text-[#181818] shadow-sm dark:bg-navy-800 dark:text-white"
                  : "text-[#706E6B] hover:text-[#181818] dark:text-navy-400 dark:hover:text-white"
              }`}
            >
              Interactive Studio
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("methodology")}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "methodology"
                  ? "bg-white text-[#181818] shadow-sm dark:bg-navy-800 dark:text-white"
                  : "text-[#706E6B] hover:text-[#181818] dark:text-navy-400 dark:hover:text-white"
              }`}
            >
              Regulatory Methodology
            </button>
          </div>
        </div>
      </div>

      {activeTab === "studio" ? (
        <div className="space-y-6">
          {/* Presets Bar */}
          <div className="card space-y-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#706E6B] dark:text-navy-400">
                Quick Load Client Profiles:
              </span>
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-[#B42332] dark:text-[#FF7D86] hover:underline"
              >
                Reset Form
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PROFILING_PRESETS.map((preset, idx) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => loadPreset(idx)}
                  className="flex items-start gap-2.5 rounded-lg border border-[#ECEBEA] bg-white p-2.5 text-left text-xs transition-all hover:border-[#0176D3] hover:bg-[#EAF5FE]/20 hover:shadow-sm dark:border-navy-800 dark:bg-navy-900/60 dark:hover:border-[#0176D3]/40"
                >
                  <span className="text-xl" aria-hidden>{preset.icon}</span>
                  <div>
                    <span className="font-semibold text-[#181818] dark:text-white">{preset.name}</span>
                    <p className="line-clamp-1 text-[11px] text-[#706E6B] dark:text-navy-400">{preset.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Inputs Column (7 cols) */}
            <div className="space-y-6 lg:col-span-7">
              {/* Part 1: Financial Capacity */}
              <section className="card space-y-4">
                <div className="flex items-center justify-between border-b border-[#ECEBEA] pb-2.5 dark:border-navy-800">
                  <div>
                    <h2 className="text-base font-bold text-[#181818] dark:text-white">
                      1. Financial Risk Capacity (Ability to Take Risk)
                    </h2>
                    <p className="text-xs text-[#706E6B] dark:text-navy-400">
                      Objective quantitative ability to bear loss based on cashflow, obligations, and liquidity.
                    </p>
                  </div>
                  <span className="rounded bg-[#ECEBEA] px-2 py-0.5 text-xs font-semibold text-[#444444] dark:bg-navy-800 dark:text-navy-200">
                    Score: {profile.capacity.score} / 100
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">
                      Client / Household Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={client.firstName}
                      placeholder="e.g. Vikram Sharma"
                      onChange={(e) => {
                        setClient({ ...client, firstName: e.target.value });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                    {!client.firstName.trim() ? (
                      <p className="mt-1 text-[11px] text-[#706E6B] dark:text-navy-400">Required for official SEBI dossier (min 3 characters).</p>
                    ) : client.firstName.trim().length < 3 ? (
                      <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">Name must be at least 3 characters.</p>
                    ) : null}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Age (years) *</label>
                    <input
                      type="number"
                      min={18}
                      max={100}
                      value={client.age || ""} placeholder="e.g. 35"
                      onChange={(e) => {
                        setClient({ ...client, age: Number(e.target.value) || 0 });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                    {client.age > 0 && (client.age < 18 || client.age > 100) && (
                      <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">Age must be between 18 and 100.</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Employment Type *</label>
                    <select
                      value={client.employmentType}
                      onChange={(e) => {
                        setClient({ ...client, employmentType: e.target.value as ClientCapacityInputs["employmentType"] });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    >
                      <option value="" disabled>Select employment type…</option>
                      <option value="govt_psu">Govt / PSU (Highest stability)</option>
                      <option value="salaried_private">Salaried Private (High stability)</option>
                      <option value="business_professional">Business / Professional (Moderate)</option>
                      <option value="freelance_variable">Freelance / Variable (Variable)</option>
                      <option value="retired_none">Retired / None</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Financial Dependents</label>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={client.dependents !== undefined && client.dependents !== 0 ? client.dependents : client.dependents === 0 ? "0" : ""}
                      placeholder="0"
                      onChange={(e) => {
                        setClient({ ...client, dependents: e.target.value === "" ? 0 : Number(e.target.value) });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                    {(client.dependents < 0 || client.dependents > 15) && (
                      <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">Dependents must be between 0 and 15.</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Monthly Income (₹) *</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.monthlyIncome || ""} placeholder="0"
                      onChange={(e) => {
                        setClient({ ...client, monthlyIncome: Number(e.target.value) || 0 });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Monthly Expenses (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.monthlyExpenses || ""} placeholder="0"
                      onChange={(e) => {
                        setClient({ ...client, monthlyExpenses: Number(e.target.value) || 0 });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Monthly Loan EMIs (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.monthlyEmi || ""} placeholder="0"
                      onChange={(e) => {
                        setClient({ ...client, monthlyEmi: Number(e.target.value) || 0 });
                        setSaveStatus(null);
                      }}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Liquid Emergency Fund (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.liquidAssets || ""} placeholder="0"
                      onChange={(e) => setClient({ ...client, liquidAssets: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Existing Investments (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.investments || ""} placeholder="0"
                      onChange={(e) => setClient({ ...client, investments: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Outstanding Debt / Loans (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.liabilities || ""} placeholder="0"
                      onChange={(e) => setClient({ ...client, liabilities: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Term Life Insurance (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.termCover || ""} placeholder="0"
                      onChange={(e) => setClient({ ...client, termCover: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[#444444] dark:text-navy-300">Health Cover (₹)</label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={client.healthCover || ""} placeholder="0"
                      onChange={(e) => setClient({ ...client, healthCover: Number(e.target.value) || 0 })}
                      className="mt-1 w-full rounded border border-[#E5E5E5] px-2.5 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                  </div>
                </div>

                {/* Factors Breakdown */}
                <div className="mt-3 rounded-lg border border-[#ECEBEA] bg-[#F3F3F3]/70 p-3 text-xs dark:border-navy-800 dark:bg-navy-900/40">
                  <div className="mb-2 font-semibold text-[#444444] dark:text-navy-200">
                    Capacity Sub-Factors (Weighted Contribution to {profile.capacity.score}/100):
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                    {profile.capacity.factors.map((f: FactorScore) => (
                      <div key={f.factor} className="rounded border border-[#ECEBEA] bg-white p-2 dark:border-navy-800 dark:bg-navy-900">
                        <div className="flex justify-between text-[#706E6B]">
                          <span>{f.factor}</span>
                          <span className="font-semibold text-[#181818] dark:text-white">{f.score}/100</span>
                        </div>
                        <div className="mt-1 text-[11px] text-[#706E6B] dark:text-navy-400">
                          Weight: {(f.weight * 100).toFixed(0)}% · Contrib: <span className="font-semibold text-[#0176D3] dark:text-[#1B96FF]">+{f.contribution}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Part 2: Emotional Risk Tolerance Questionnaire */}
              <section className="card space-y-4">
                <div className="flex items-center justify-between border-b border-[#ECEBEA] pb-2.5 dark:border-navy-800">
                  <div>
                    <h2 className="text-base font-bold text-[#181818] dark:text-white">
                      2. Risk Tolerance Questionnaire (Willingness to Take Risk)
                    </h2>
                    <p className="text-xs text-[#706E6B] dark:text-navy-400">
                      Standard SEBI / AMFI 10-question behavioral suitability assessment.
                    </p>
                  </div>
                  <span className="rounded bg-[#EAF5FE] px-2 py-0.5 text-xs font-semibold text-[#014486] dark:bg-[#0F2A45]/40 dark:text-[#57A9F5]">
                    Score: {profile.tolerance} / 100
                  </span>
                </div>

                <div className="space-y-4">
                  {QUESTIONNAIRE_QUESTIONS.map((q, qIndex) => {
                    const currentAnswer = answers[q.id];
                    return (
                      <div
                        key={q.id}
                        className="rounded-lg border border-[#ECEBEA] bg-white p-3.5 transition-all dark:border-navy-800 dark:bg-navy-900"
                      >
                        <div className="flex items-center justify-between text-xs font-semibold text-[#181818] dark:text-white">
                          <span>
                            Q{qIndex + 1}. {q.text}
                          </span>
                        </div>
                        <div className="mt-2.5 grid gap-2">
                          {q.options.map((opt, optIndex) => {
                            const isSelected = currentAnswer === optIndex;
                            return (
                              <label
                                key={opt.text}
                                className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-xs transition-all ${
                                  isSelected
                                    ? "border-[#0176D3] bg-[#EAF5FE]/60 font-semibold text-[#032D60] dark:border-[#0176D3] dark:bg-[#0F2A45]/30 dark:text-[#C5DDF7]"
                                    : "border-[#ECEBEA] bg-white text-[#444444] hover:border-[#E5E5E5] hover:bg-[#F3F3F3]/50 dark:border-navy-800 dark:bg-navy-900 dark:text-navy-300 dark:hover:bg-navy-800/40"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name={q.id}
                                    checked={isSelected}
                                    onChange={() => handleAnswerChange(q.id, optIndex)}
                                    className="text-[#0176D3] focus:ring-[#0176D3]"
                                  />
                                  <span>{opt.text}</span>
                                </div>
                                <span className="font-mono text-[11px] text-[#939393]">
                                  {opt.score} pt{opt.score > 1 ? "s" : ""}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Right Output & Allocation Column (5 cols) */}
            <div className="space-y-6 lg:col-span-5">
              {!ready && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  <span className="font-bold">Assessment incomplete</span> — {remainingInputs} of 14 inputs remaining. Enter required client details and answer all 10 questions to compute suitability.
                </div>
              )}
              {/* Composite Score Card */}
              <div className="card space-y-4 border-t-4 border-t-[#0176D3] bg-white dark:bg-navy-900">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#706E6B] dark:text-navy-400">
                      Assigned Risk Category
                    </span>
                    <h3 className="mt-1 text-2xl font-extrabold text-[#181818] dark:text-white">
                      {ready ? profile.band : "—"}
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${
                      !ready
                        ? "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300"
                        : profile.band.includes("Aggressive")
                        ? "bg-rose-50 text-rose-800 ring-rose-300 dark:bg-rose-950/40 dark:text-rose-300"
                        : profile.band.includes("Moderate")
                        ? "bg-[#EAF5FE] text-[#014486] ring-[#57A9F5] dark:bg-[#0F2A45]/40 dark:text-[#57A9F5]"
                        : "bg-blue-50 text-blue-800 ring-blue-300 dark:bg-blue-950/40 dark:text-blue-300"
                    }`}
                  >
                    Band: {ready ? profile.band : "Incomplete"}
                  </span>
                </div>

                <div className="rounded-lg bg-[#F3F3F3] p-3.5 text-center dark:bg-navy-800/50">
                  <div className="text-xs text-[#706E6B] dark:text-navy-400">Composite Suitability Score</div>
                  <div className="mt-1 text-4xl font-extrabold text-[#0176D3] dark:text-[#1B96FF]">
                    {ready ? profile.final_score : "—"}
                    <span className="text-base font-normal text-[#706E6B]"> / 100</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#706E6B] dark:text-navy-400">
                    {ready ? (
                      <>Calculated as <strong>min(Capacity, Tolerance)</strong> per regulatory conservatism standards.</>
                    ) : (
                      <>Complete all inputs and 10 questions to compute suitability score.</>
                    )}
                  </p>
                </div>

                {/* Score Comparison Bars */}
                <div className="space-y-3 pt-1">
                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-[#444444] dark:text-navy-300">Financial Risk Capacity:</span>
                      <span className="font-bold text-[#181818] dark:text-white">
                        {ready && profile.capacity.score > 0 ? `${profile.capacity.score} / 100` : "— / 100"}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#ECEBEA] dark:bg-navy-800">
                      <div
                        className="h-full bg-[#444444] transition-all dark:bg-navy-300"
                        style={{ width: `${ready ? Math.min(100, profile.capacity.score) : 0}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-[#444444] dark:text-navy-300">Emotional Risk Tolerance:</span>
                      <span className="font-bold text-[#0176D3] dark:text-[#1B96FF]">
                        {ready && profile.tolerance > 0 ? `${profile.tolerance} / 100` : "— / 100"}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[#ECEBEA] dark:bg-navy-800">
                      <div
                        className="h-full bg-[#0176D3] transition-all dark:bg-[#0176D3]"
                        style={{ width: `${ready ? Math.min(100, profile.tolerance) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Mismatch Alert */}
                {ready && profile.mismatch_note && (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                    <span className="font-bold">⚠️ Regulatory Risk Mismatch:</span> {profile.mismatch_note}
                  </div>
                )}
              </div>

              {/* Recommended Asset Allocation Card */}
              <div className="card space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#181818] dark:text-white">
                    Target Strategic Asset Allocation
                  </h4>
                  <span className="text-xs text-[#706E6B]">SEBI/AMFI Band Model</span>
                </div>

                {/* Stacked Allocation Bar */}
                <div className="h-4 w-full overflow-hidden rounded-full flex bg-[#ECEBEA] dark:bg-navy-800">
                  <div
                    style={{ width: `${ready ? profile.allocation.equity : 0}%` }}
                    className="bg-[#0176D3] transition-all"
                    title={`Equity: ${ready ? profile.allocation.equity : 0}%`}
                  />
                  <div
                    style={{ width: `${ready ? profile.allocation.debt : 0}%` }}
                    className="bg-blue-600 transition-all"
                    title={`Debt: ${ready ? profile.allocation.debt : 0}%`}
                  />
                  <div
                    style={{ width: `${ready ? profile.allocation.gold : 0}%` }}
                    className="bg-amber-500 transition-all"
                    title={`Gold: ${ready ? profile.allocation.gold : 0}%`}
                  />
                  <div
                    style={{ width: `${ready ? profile.allocation.liquid : 0}%` }}
                    className="bg-slate-400 transition-all"
                    title={`Liquid: ${ready ? profile.allocation.liquid : 0}%`}
                  />
                </div>

                {/* Allocation Badges */}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded border border-[#C5DDF7] bg-[#EAF5FE] p-2 text-center dark:border-teal-900 dark:bg-[#0F2A45]/30">
                    <span className="text-[#0176D3] dark:text-[#1B96FF] font-medium">Equity</span>
                    <div className="text-base font-extrabold text-[#032D60] dark:text-white">{ready ? `${profile.allocation.equity}%` : "—%"}</div>
                  </div>
                  <div className="rounded border border-blue-200 bg-blue-50 p-2 text-center dark:border-blue-900 dark:bg-blue-950/30">
                    <span className="text-blue-700 dark:text-blue-400 font-medium">Debt</span>
                    <div className="text-base font-extrabold text-blue-950 dark:text-white">{ready ? `${profile.allocation.debt}%` : "—%"}</div>
                  </div>
                  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-center dark:border-amber-900 dark:bg-amber-950/30">
                    <span className="text-amber-700 dark:text-amber-400 font-medium">Gold</span>
                    <div className="text-base font-extrabold text-amber-950 dark:text-white">{ready ? `${profile.allocation.gold}%` : "—%"}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-800 dark:bg-slate-900/50">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Liquid</span>
                    <div className="text-base font-extrabold text-slate-900 dark:text-white">{ready ? `${profile.allocation.liquid}%` : "—%"}</div>
                  </div>
                </div>

                {/* Implementation Guidance */}
                <div className="rounded bg-[#F3F3F3]/70 p-3 text-xs text-[#444444] dark:bg-navy-900/60 dark:text-navy-300 space-y-1">
                  <div className="font-semibold text-[#181818] dark:text-white">Scheme Class Implementation:</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-[#706E6B] dark:text-navy-400">
                    <li><strong>Equity sleeve ({profile.allocation.equity}%):</strong> Large Cap, Flexi Cap, Mid Cap diversified mutual funds.</li>
                    <li><strong>Debt sleeve ({profile.allocation.debt}%):</strong> Corporate Bond, Banking & PSU, and Short Duration funds.</li>
                    <li><strong>Gold & Liquid ({profile.allocation.gold + profile.allocation.liquid}%):</strong> Gold ETFs / Sovereign Gold, Overnight & Liquid schemes.</li>
                  </ul>
                </div>
              </div>

              {/* AI fund picks from the FH Marked list */}
              <div className="card space-y-3">
                <h4 className="text-sm font-bold text-[#181818] dark:text-white">AI fund picks from the FH Marked list</h4>
                {ready ? (
                  <AiPicksPreview profile={{ band: profile.band, ...profile.allocation }} onChange={setFundPicks} />
                ) : (
                  <p className="text-xs text-[#706E6B]">Complete the client details and all 10 questions to get fund picks.</p>
                )}
              </div>

              {/* Priority Financial Hygiene Actions */}
              {ready && profile.priority_actions.length > 0 && (
                <div className="card space-y-2.5 border-l-4 border-l-amber-500 bg-amber-50/40 dark:bg-amber-950/20">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                    Mandatory Advisory Gaps:
                  </h4>
                  <ul className="space-y-1 text-xs text-amber-950 dark:text-amber-200">
                    {profile.priority_actions.map((act) => (
                      <li key={act} className="flex items-center gap-1.5">
                        <span aria-hidden>⚠️</span>
                        <span>{act}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Official SEBI Suitability Assessment PDF Download */}
              <div className="card space-y-3 border-[#C5DDF7] bg-gradient-to-br from-[#EAF5FE]/70 via-white to-emerald-50/40 dark:border-[#014486]/40 dark:from-[#0F2A45]/20 dark:via-navy-900/60 dark:to-emerald-950/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-[#0176D3] text-[10px] font-black text-white shadow-xs">
                      PDF
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-[#181818] dark:text-white">
                        Client Suitability Dossier
                      </h4>
                      <p className="text-[10px] text-[#706E6B] dark:text-navy-400">
                        Official 2-page A4 assessment report
                      </p>
                    </div>
                  </div>
                  <span className="rounded bg-[#D8E6FE] px-2 py-0.5 text-[10px] font-semibold text-[#014486] dark:bg-teal-900/60 dark:text-[#57A9F5]">
                    ARN-345439
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[#706E6B] dark:text-navy-400">
                  Includes deterministic capacity scorecard, 10-question behavioral breakdown, strategic asset allocation donut chart, SEBI suitability declaration, and RIA/client sign-off blocks.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf || !ready}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-[#0176D3] py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#032D60] disabled:opacity-50"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {downloadingPdf ? "Generating Official PDF Report..." : "Download Official PDF Report"}
                </button>
                {pdfError && (
                  <div className="rounded bg-rose-50 p-2 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                    ⚠️ {pdfError}
                  </div>
                )}
              </div>

              {/* CRM Household Suitability Sync */}
              <div className="card space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-[#181818] dark:text-white">
                    Record to CRM Household
                  </h4>
                  <span className="text-[11px] text-[#706E6B]">Audit Compliance</span>
                </div>
                <p className="text-xs text-[#706E6B] dark:text-navy-400">
                  Store this suitability assessment directly under the customer record in the CRM module.
                </p>

                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Customer / Household ID (e.g., CUST_001)"
                    value={targetCustomerId}
                    onChange={(e) => setTargetCustomerId(e.target.value)}
                    className="w-full rounded border border-[#E5E5E5] px-3 py-1.5 text-xs font-medium focus:border-[#0176D3] focus:outline-none dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveToCrm}
                    disabled={saving || !ready}
                    className="w-full rounded-md bg-[#0176D3] py-2 text-xs font-semibold text-white transition-colors hover:bg-[#032D60] disabled:opacity-50"
                  >
                    {saving ? "Saving to CRM..." : "Record Suitability in CRM →"}
                  </button>
                  {saveStatus && (
                    <div className="rounded p-2 text-xs font-medium bg-[#F3F3F3] text-[#181818] dark:bg-navy-800 dark:text-white">
                      {saveStatus}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Regulatory Methodology Tab */
        <div className="space-y-6">
          <div className="card space-y-4">
            <h2 className="text-lg font-bold text-[#181818] dark:text-white">
              Regulatory Suitability & Risk Engine Architecture
            </h2>
            <p className="text-xs text-[#444444] dark:text-navy-300 leading-relaxed">
              Fund Horizon implements the SEBI Master Circular for Mutual Fund Distributors and RIAs, enforcing deterministic suitability scoring before allocating client capital.
            </p>

            {/* Capacity Scoring Factors Table */}
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[#181818] dark:text-white">1. Capacity Scoring Factors (Weights = 100%)</h3>
              <div className="overflow-x-auto rounded-lg border border-[#ECEBEA] bg-white dark:border-navy-800 dark:bg-navy-900">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-[#ECEBEA] bg-[#F3F3F3] font-semibold text-[#444444] dark:border-navy-800 dark:bg-navy-800/60 dark:text-navy-200">
                    <tr>
                      <th className="px-3 py-2">Factor</th>
                      <th className="px-3 py-2">Weight</th>
                      <th className="px-3 py-2">Evaluation Rule</th>
                      <th className="px-3 py-2">Scale (10-100)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F3F3] dark:divide-navy-800">
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Age</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">20%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">Years until traditional retirement horizon</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">≤30 (100) to &gt;60 (20)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Income Stability</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">15%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">Employment predictability and continuity</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">Govt/PSU (100) to Retired (25)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Savings Rate</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">15%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">(Income - Expenses - EMIs) / Income</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">≥40% (100) to &lt;0% (10)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Emergency Fund</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">15%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">Liquid assets divided by monthly outgo</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">≥12 mos (100) to &lt;1 mo (10)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Net Worth Multiple</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">10%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">Net Assets divided by annual gross income</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">≥5x (100) to &lt;0x (10)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Debt Burden</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">10%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">Monthly EMI divided by monthly income</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">&lt;10% (100) to ≥50% (10)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Dependents</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">10%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">Count of financially dependent individuals</td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">0 (100) to 4+ (25)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#181818] dark:text-white">Insurance Adequacy</td>
                      <td className="px-3 py-2 font-semibold text-[#0176D3] dark:text-[#1B96FF]">5%</td>
                      <td className="px-3 py-2 text-[#706E6B] dark:text-navy-400">
                        Two explicit sub-scores averaged: (1) Term adequacy = Term cover ÷ Annual income (≥15×: 100, 10–&lt;15×: 80, 7–&lt;10×: 60, 5–&lt;7×: 40, &lt;5×: 20); (2) Health cover (≥₹25L: 100, ₹10L–&lt;₹25L: 60, &lt;₹10L: 20).
                      </td>
                      <td className="px-3 py-2 text-[#444444] dark:text-navy-300">Average of Term &amp; Health (20 to 100)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Risk Bands Matrix Table */}
            <div className="space-y-2 pt-2">
              <h3 className="text-sm font-bold text-[#181818] dark:text-white">2. Risk Bands & Allocation Matrix</h3>
              <div className="overflow-x-auto rounded-lg border border-[#ECEBEA] bg-white dark:border-navy-800 dark:bg-navy-900">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-[#ECEBEA] bg-[#F3F3F3] font-semibold text-[#444444] dark:border-navy-800 dark:bg-navy-800/60 dark:text-navy-200">
                    <tr>
                      <th className="px-3 py-2">Band Name</th>
                      <th className="px-3 py-2">Score Range</th>
                      <th className="px-3 py-2">Equity %</th>
                      <th className="px-3 py-2">Debt %</th>
                      <th className="px-3 py-2">Gold %</th>
                      <th className="px-3 py-2">Liquid %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F3F3] dark:divide-navy-800">
                    {BANDS.map((b) => (
                      <tr key={b.name} className="hover:bg-[#F3F3F3]/50 dark:hover:bg-navy-800/40">
                        <td className="px-3 py-2 font-semibold text-[#181818] dark:text-white">{b.name}</td>
                        <td className="px-3 py-2 font-mono text-[#706E6B] dark:text-navy-400">[{b.min}, {b.max === 100 ? `${b.max}]` : `${b.max})`}]</td>
                        <td className="px-3 py-2 font-bold text-[#0176D3] dark:text-[#1B96FF]">{b.equity}%</td>
                        <td className="px-3 py-2 font-bold text-blue-700 dark:text-blue-400">{b.debt}%</td>
                        <td className="px-3 py-2 text-amber-700 dark:text-amber-400">{b.gold}%</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{b.liquid}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Risk Mismatch & Conservatism Rule */}
            <div className="space-y-2 pt-2">
              <h3 className="text-sm font-bold text-[#181818] dark:text-white">3. Regulatory Conservatism & Mismatch Threshold</h3>
              <p className="text-xs text-[#444444] dark:text-navy-300 leading-relaxed">
                Whenever Emotional Risk Tolerance exceeds Financial Risk Capacity by <strong>20 points or more</strong> (or when emergency funds cover fewer than 3 months of outgo), the composite score and strategic asset allocation are capped at the capacity ceiling. This regulatory barrier prevents behavioral over-confidence from jeopardizing client capital adequacy.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
