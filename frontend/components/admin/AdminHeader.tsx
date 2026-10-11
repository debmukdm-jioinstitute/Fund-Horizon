// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import Link from "next/link";

export type AdminTab = "overview" | "plans" | "cas" | "funds" | "config" | "operations";

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
  ];

  return (
    <div className="bg-navy-950 text-white border-b border-navy-800 shadow-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400 font-bold text-lg">
              FH
            </span>
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
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-navy-900 border border-navy-800 text-xs text-navy-200">
              <span className={`inline-block h-2 w-2 rounded-full ${isDbConnected ? "bg-teal-400 animate-pulse" : "bg-rose-400"}`} />
              <span className="font-semibold text-white">{databaseProvider}</span>
              <span className="text-navy-400">({isDbConnected ? "Active" : "Offline"})</span>
            </div>

            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg bg-navy-800 hover:bg-navy-700 text-xs text-navy-100 hover:text-white font-medium transition inline-flex items-center gap-1.5 border border-navy-700"
            >
              <span>Client Portal</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto space-x-1 border-t border-navy-900/80 pt-2 pb-1 scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition whitespace-nowrap ${
                  isActive
                    ? "bg-teal-600 text-white shadow-sm"
                    : "text-navy-300 hover:bg-navy-900 hover:text-white"
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
