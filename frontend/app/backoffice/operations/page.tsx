"use client";

import React, { useState, useMemo } from "react";
import {
  OPERATIONS_FORMS,
  FORM_CATEGORIES,
  OperationFormTemplate,
  FormRepository,
  FormCategory,
} from "@/lib/operationsForms";
import { OFFICIAL_FORMS } from "@/lib/officialForms";
import FormEditorModal from "@/components/operations/FormEditorModal";

interface DownloadActivity {
  id: string;
  formTitle: string;
  clientName: string;
  timestamp: string;
}

export default function OperationsPage() {
  const [selectedRepo, setSelectedRepo] = useState<FormRepository | "ALL">("ALL");
  const [selectedCategory, setSelectedCategory] = useState<FormCategory | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeForm, setActiveForm] = useState<OperationFormTemplate | null>(null);
  const [recentDownloads, setRecentDownloads] = useState<DownloadActivity[]>([
    {
      id: "act-1",
      formTitle: "Change in Bank Mandate & Multiple Bank Accounts Registration",
      clientName: "Rajesh Kumar",
      timestamp: "Today, 11:42 AM IST",
    },
    {
      id: "act-2",
      formTitle: "Stallion Asset Core PMS Account Opening Kit",
      clientName: "Vikram Mehta",
      timestamp: "Today, 10:15 AM IST",
    },
  ]);

  // Filter forms based on repository, category, and search query
  const filteredForms = useMemo(() => {
    return OPERATIONS_FORMS.filter((form) => {
      // Repository filter (CAMS, Carvy, Stallion, or ALL)
      if (selectedRepo !== "ALL" && form.repository !== selectedRepo) {
        return false;
      }
      // Category filter (new_client, mutual_fund, pms_stallion, old_client, or ALL)
      if (selectedCategory !== "ALL" && form.category !== selectedCategory) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = form.title.toLowerCase().includes(q);
        const matchesCode = form.formCode.toLowerCase().includes(q);
        const matchesDesc = form.description.toLowerCase().includes(q);
        const matchesRepo = form.repository.toLowerCase().includes(q);
        if (!matchesTitle && !matchesCode && !matchesDesc && !matchesRepo) {
          return false;
        }
      }
      return true;
    });
  }, [selectedRepo, selectedCategory, searchQuery]);

  // Counts for repository badges
  const officialForms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return OFFICIAL_FORMS.filter(
      (f) => (selectedRepo === "ALL" || f.repository === selectedRepo) && (!q || `${f.title} ${f.repository}`.toLowerCase().includes(q)),
    );
  }, [selectedRepo, searchQuery]);

  const camsCount = useMemo(() => OPERATIONS_FORMS.filter((f) => f.repository === "CAMS").length, []);
  const carvyCount = useMemo(() => OPERATIONS_FORMS.filter((f) => f.repository === "Carvy").length, []);
  const stallionCount = useMemo(() => OPERATIONS_FORMS.filter((f) => f.repository === "Stallion").length, []);

  const handleDownloadCompleted = (formTitle: string, clientName: string) => {
    const newAct: DownloadActivity = {
      id: `act-${Date.now()}`,
      formTitle,
      clientName,
      timestamp: "Just now",
    };
    setRecentDownloads((prev) => [newAct, ...prev.slice(0, 9)]);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Title & Status Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E4E9EF] dark:border-[#2B3644]">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033] dark:text-[#EDF2F7]">
              Operations & Automated Forms Repository
            </h1>
            <span className="text-[11px] font-semibold uppercase bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] px-2 py-0.5 rounded border border-[#006F64]/30">
              Live & Automated
            </span>
          </div>
          <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4] mt-1">
            Complete institutional repository for CAMS, Carvy (KFintech), and Stallion Asset PMS forms with in-house form editor, client signatures, and direct PDF downloads.
          </p>
        </div>

        {/* Live AMFI / RTA Telemetry Status Badges */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644]">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">CAMS API:</span>
            <span className="text-[#536176] dark:text-[#A8B4C4]">Connected</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644]">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">Carvy (KFin):</span>
            <span className="text-[#536176] dark:text-[#A8B4C4]">Connected</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644]">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">Stallion PMS:</span>
            <span className="text-[#536176] dark:text-[#A8B4C4]">Active</span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] font-mono font-semibold">
            ARN-345439
          </div>
        </div>
      </div>

      {/* Primary Repository Switcher: CAMS and Carvy Buttons (User Explicit Requirement) */}
      <div className="bg-[#FFFFFF] dark:bg-[#10151C] p-4 rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
            Select Repository
          </span>
          <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
            Showing {filteredForms.length} of {OPERATIONS_FORMS.length} automated forms
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* CAMS Button */}
          <button
            type="button"
            onClick={() => setSelectedRepo(selectedRepo === "CAMS" ? "ALL" : "CAMS")}
            className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
              selectedRepo === "CAMS"
                ? "bg-[#E0F2FE]/60 dark:bg-[#075985]/30 border-[#0284C7] dark:border-[#38BDF8] ring-2 ring-[#0284C7]/20 shadow-sm"
                : "bg-[#F8FAFC] dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#0284C7]/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#0369A1] dark:text-[#38BDF8]">
                CAMS
              </span>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FFFFFF] dark:bg-[#10151C] text-[#0369A1] dark:text-[#38BDF8] border border-[#0284C7]/20">
                {camsCount} Forms
              </span>
            </div>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-1">
              Computer Age Management Services (HDFC, ICICI, SBI, Birla, Kotak)
            </p>
          </button>

          {/* Carvy (KFintech) Button */}
          <button
            type="button"
            onClick={() => setSelectedRepo(selectedRepo === "Carvy" ? "ALL" : "Carvy")}
            className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
              selectedRepo === "Carvy"
                ? "bg-[#FEF3C7]/60 dark:bg-[#78350F]/30 border-[#D97706] dark:border-[#FBBF24] ring-2 ring-[#D97706]/20 shadow-sm"
                : "bg-[#F8FAFC] dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#D97706]/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#B45309] dark:text-[#FBBF24]">
                Carvy (KFintech)
              </span>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FFFFFF] dark:bg-[#10151C] text-[#B45309] dark:text-[#FBBF24] border border-[#D97706]/20">
                {carvyCount} Forms
              </span>
            </div>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-1">
              KFin Technologies / Carvy (Nippon, UTI, Axis, Mirae, Motilal)
            </p>
          </button>

          {/* Stallion PMS Button */}
          <button
            type="button"
            onClick={() => setSelectedRepo(selectedRepo === "Stallion" ? "ALL" : "Stallion")}
            className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
              selectedRepo === "Stallion"
                ? "bg-[#F3E8FF]/60 dark:bg-[#581C87]/30 border-[#9333EA] dark:border-[#C084FC] ring-2 ring-[#9333EA]/20 shadow-sm"
                : "bg-[#F8FAFC] dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#9333EA]/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#6B21A8] dark:text-[#C084FC]">
                PMS (Stallion)
              </span>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FFFFFF] dark:bg-[#10151C] text-[#6B21A8] dark:text-[#C084FC] border border-[#9333EA]/20">
                {stallionCount} Forms
              </span>
            </div>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-1">
              Stallion Asset Core & Multi-Cap PMS Onboarding, PMA & Custody Kits
            </p>
          </button>

          {/* All Repositories Button */}
          <button
            type="button"
            onClick={() => setSelectedRepo("ALL")}
            className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
              selectedRepo === "ALL"
                ? "bg-[#E7F5F2] dark:bg-[#1A3034] border-[#006F64] dark:border-[#75E1CE] ring-2 ring-[#006F64]/20 shadow-sm"
                : "bg-[#F8FAFC] dark:bg-[#171E27] border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64]/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold text-[#006F64] dark:text-[#75E1CE]">
                All Repositories
              </span>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#FFFFFF] dark:bg-[#10151C] text-[#006F64] dark:text-[#75E1CE] border border-[#006F64]/20">
                {OPERATIONS_FORMS.length} Total
              </span>
            </div>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-1">
              Consolidated view of all RTA mutual fund and PMS documents
            </p>
          </button>
        </div>
      </div>

      {/* Subsections & Dropdown Filters */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-[#FFFFFF] dark:bg-[#10151C] p-3 rounded-xl border border-[#E4E9EF] dark:border-[#2B3644]">
        {/* Subsection Selector Dropdown & Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-[#536176] dark:text-[#A8B4C4] mr-1 hidden sm:inline">
            Category:
          </span>

          <button
            type="button"
            onClick={() => setSelectedCategory("ALL")}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition ${
              selectedCategory === "ALL"
                ? "bg-[#172033] dark:bg-[#EDF2F7] text-white dark:text-[#172033]"
                : "text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F1F5F9] dark:hover:bg-[#1A232E]"
            }`}
          >
            All Subsections
          </button>

          {FORM_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition flex items-center gap-1.5 ${
                selectedCategory === cat.id
                  ? "bg-[#006F64] text-white"
                  : "text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F1F5F9] dark:hover:bg-[#1A232E]"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        {/* Live Search Input */}
        <div className="relative min-w-[240px]">
          <input
            type="text"
            placeholder="Search forms (e.g. Bank, NRI, Stallion, Tax, SIP)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-[12px] bg-[#F8FAFC] dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-lg text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:border-[#006F64]"
          />
          <svg
            className="w-4 h-4 text-[#536176] dark:text-[#A8B4C4] absolute left-2.5 top-2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 text-[#536176] hover:text-[#172033] dark:text-[#A8B4C4] text-[10px]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Quick Jump Keyword Pills */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-[#536176] dark:text-[#A8B4C4] font-medium mr-1">Quick Select:</span>
        {[
          { label: "Bank Change", query: "Bank" },
          { label: "Tax Status", query: "Tax" },
          { label: "NRI Declaration", query: "NRI" },
          { label: "Marital Status", query: "Marital" },
          { label: "Email ID Change", query: "Email" },
          { label: "Phone Change", query: "Phone" },
          { label: "Redemption Mandate", query: "Redemption" },
          { label: "Account Opening", query: "Opening" },
          { label: "Stallion PMS", query: "Stallion" },
          { label: "SIP / Mandate", query: "SIP" },
        ].map((pill) => (
          <button
            key={pill.label}
            type="button"
            onClick={() => {
              setSearchQuery(pill.query);
              setSelectedRepo("ALL");
              setSelectedCategory("ALL");
            }}
            className="px-2.5 py-1 rounded-md bg-[#FFFFFF] dark:bg-[#10151C] border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4] hover:text-[#006F64] dark:hover:text-[#75E1CE] hover:border-[#006F64] transition text-[11px]"
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Forms Grid */}
      {filteredForms.length === 0 ? (
        <div className="p-12 text-center bg-[#FFFFFF] dark:bg-[#10151C] rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] space-y-2">
          <p className="text-[14px] font-semibold text-[#172033] dark:text-[#EDF2F7]">
            No operations forms match your active filters.
          </p>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4]">
            Try clearing the search query or selecting &quot;All Repositories&quot;.
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedRepo("ALL");
              setSelectedCategory("ALL");
              setSearchQuery("");
            }}
            className="mt-2 px-3 py-1.5 rounded-lg bg-[#E7F5F2] text-[#006F64] font-semibold text-[12px]"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredForms.map((form) => (
            <div
              key={form.id}
              className="bg-[#FFFFFF] dark:bg-[#10151C] rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] p-4.5 flex flex-col justify-between hover:border-[#006F64] dark:hover:border-[#75E1CE] transition-all shadow-xs group"
            >
              <div className="space-y-2.5">
                {/* Card Top Row: Badges */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      form.repository === "CAMS"
                        ? "bg-[#E0F2FE] text-[#0369A1] dark:bg-[#075985]/30 dark:text-[#38BDF8]"
                        : form.repository === "Carvy"
                        ? "bg-[#FEF3C7] text-[#B45309] dark:bg-[#78350F]/30 dark:text-[#FBBF24]"
                        : "bg-[#F3E8FF] text-[#6B21A8] dark:bg-[#581C87]/30 dark:text-[#C084FC]"
                    }`}
                  >
                    {form.repository}
                  </span>

                  <span className="text-[10px] font-mono text-[#536176] dark:text-[#A8B4C4] bg-[#F1F5F9] dark:bg-[#1A232E] px-1.5 py-0.5 rounded border border-[#E4E9EF] dark:border-[#2B3644]">
                    {form.formCode}
                  </span>
                </div>

                {/* Title */}
                <div>
                  <h3 className="text-[14px] font-bold text-[#172033] dark:text-[#EDF2F7] group-hover:text-[#006F64] dark:group-hover:text-[#75E1CE] transition-colors line-clamp-2">
                    {form.title}
                  </h3>
                  <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4] mt-1 line-clamp-2">
                    {form.description}
                  </p>
                </div>
              </div>

              {/* Card Footer: Metadata & Select Button */}
              <div className="pt-3.5 mt-3 border-t border-[#E4E9EF] dark:border-[#2B3644] flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-[#006F64] dark:text-[#75E1CE] font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span>Automated · In-House</span>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveForm(form)}
                  className="px-3 py-1.5 text-[12px] font-bold rounded-lg bg-[#006F64] text-white hover:bg-[#005a52] transition flex items-center gap-1.5 shadow-xs"
                >
                  <span>Select & Fill</span>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Official forms: straight from the CAMS / KFintech / Stallion sites */}
      {officialForms.length > 0 && (
        <div className="bg-[#FFFFFF] dark:bg-[#10151C] rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] p-4 space-y-3">
          <div>
            <h3 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7]">Official Forms (download)</h3>
            <p className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
              Blank forms published by the RTA or PMS, always the current version. Follows the repository and search filters above.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {officialForms.map((f) => (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] hover:border-[#006F64] dark:hover:border-[#75E1CE] text-[12px] text-[#172033] dark:text-[#EDF2F7] transition"
              >
                <span className="truncate" title={f.title}>{f.title}</span>
                <span className="shrink-0 text-[10px] font-bold uppercase text-[#006F64] dark:text-[#75E1CE]">
                  {f.kind === "PDF" ? "Download PDF" : "Open page"}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity & Download History */}
      {recentDownloads.length > 0 && (
        <div className="bg-[#FFFFFF] dark:bg-[#10151C] rounded-2xl border border-[#E4E9EF] dark:border-[#2B3644] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-[#172033] dark:text-[#EDF2F7]">
              Recent Filings & Generated Documents
            </h3>
            <span className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
              {recentDownloads.length} Records in current session
            </span>
          </div>

          <div className="divide-y divide-[#E4E9EF] dark:divide-[#2B3644] text-[12px]">
            {recentDownloads.map((item) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 truncate">
                  <div className="h-7 w-7 rounded-lg bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="truncate">
                    <div className="font-semibold text-[#172033] dark:text-[#EDF2F7] truncate">
                      {item.formTitle}
                    </div>
                    <div className="text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                      Client: <span className="font-medium text-[#172033] dark:text-[#EDF2F7]">{item.clientName}</span> · {item.timestamp}
                    </div>
                  </div>
                </div>

                <span className="text-[11px] font-semibold text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-2 py-0.5 rounded shrink-0">
                  Client-Ready PDF
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive In-House Form Editor Modal */}
      {activeForm && (
        <FormEditorModal
          form={activeForm}
          onClose={() => setActiveForm(null)}
          onDownloadCompleted={handleDownloadCompleted}
        />
      )}
    </div>
  );
}
