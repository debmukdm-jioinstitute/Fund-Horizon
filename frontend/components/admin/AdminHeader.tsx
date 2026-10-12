// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export type AdminTab = "overview" | "plans" | "cas" | "funds" | "config" | "operations" | "customers" | "crm-home" | "households" | "leads" | "pipelines" | "activities" | "cases" | "compliance" | "import";

interface AdminHeaderProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  databaseProvider?: string;
  isDbConnected?: boolean;
}

export default function AdminHeader({
  activeTab,
  onTabChange,
  databaseProvider = "SQLite",
  isDbConnected = true,
}: AdminHeaderProps) {
  const tabs: Array<{ id: AdminTab; label: string; icon: string }> = [


    { id: "overview", label: "Executive Overview", icon: "📊" },
    { id: "plans", label: "Client Plans", icon: "📋" },
    { id: "cas", label: "CAS Statements", icon: "📑" },
    { id: "funds", label: "Fund Catalog", icon: "📈" },
    { id: "config", label: "Assumptions & Rules", icon: "⚙️" },
    { id: "operations", label: "Operations & Sync", icon: "🛠️" },
    { id: "customers", label: "Customers", icon: "👥" },
    { id: "crm-home", label: "CRM Home", icon: "🏠" },
    { id: "households", label: "Households", icon: "🏡" },
    { id: "leads", label: "Leads", icon: "🎯" },
    { id: "pipelines", label: "Pipelines", icon: "📊" },
    { id: "activities", label: "Tasks", icon: "✅" },
    { id: "cases", label: "Grievances", icon: "🎫" },
    { id: "compliance", label: "Compliance", icon: "🛡️" },
    { id: "import", label: "Import", icon: "📥" },
  ];

  return (
    <div className="bg-navy-950/90 backdrop-blur-xl text-white border-b border-navy-850/80 shadow-md sticky top-0 z-30">
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-12">
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4">
          <div className="flex items-center gap-3">
            <Logo size="md" variant="dark" showText={false} href="/admin" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">Control Center</h1>
                <span className="rounded-full bg-teal-900/60 border border-teal-700/60 px-2.5 py-0.5 text-[11px] font-semibold text-teal-300">
                  ARN 345439
                </span>
              </div>
              <p className="text-xs text-navy-300">Administrative management and analytics console</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* DB status pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-navy-900/90 border border-navy-800 text-xs text-navy-200 backdrop-blur-sm">
              <span className={`inline-block h-2 w-2 rounded-full ${isDbConnected ? "bg-teal-400 animate-pulse shadow-glow-teal" : "bg-rose-400"}`} />
              <span className="font-semibold text-white">{databaseProvider}</span>
              <span className="text-navy-400">({isDbConnected ? "Active" : "Offline"})</span>
            </div>

            <Link
              href="/"
              className="px-3.5 py-1.5 rounded-xl bg-navy-850 hover:bg-navy-800 text-xs text-navy-100 hover:text-white font-semibold transition inline-flex items-center gap-1.5 border border-navy-700 shadow-sm"
            >
              <span>Client Portal</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto space-x-1.5 border-t border-navy-900/80 pt-2 pb-2 scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition whitespace-nowrap ${
                  isActive
                    ? "bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-3d-btn-accent"
                    : "text-navy-300 hover:bg-navy-900/80 hover:text-white"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
