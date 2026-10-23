// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useState, useEffect } from "react";
import AdminHeader, { AdminTab } from "@/components/admin/AdminHeader";
import AdminDashboardTab from "@/components/admin/AdminDashboardTab";
import AdminPlansTab from "@/components/admin/AdminPlansTab";
import AdminCasTab from "@/components/admin/AdminCasTab";
import AdminFundsTab from "@/components/admin/AdminFundsTab";
import AdminConfigTab from "@/components/admin/AdminConfigTab";
import AdminOperationsTab from "@/components/admin/AdminOperationsTab";
import PlanDrawer from "@/components/admin/PlanDrawer";
import AdminCustomersTab from "@/components/admin/AdminCustomersTab";
import CrmHome from "@/components/crm/CrmHome";
import HouseholdsTab from "@/components/crm/HouseholdsTab";
import LeadsTab from "@/components/crm/LeadsTab";
import PipelinesTab from "@/components/crm/PipelinesTab";
import ActivitiesTab from "@/components/crm/ActivitiesTab";
import ImportTab from "@/components/crm/ImportTab";
import { MeUser, fetchMe } from "@/components/admin/account-api";
import { AdminStats, AdminPlanSummary, fetchAdminStats, saveAdminKey } from "@/lib/admin-api";

const CRM_TABS: AdminTab[] = ["crm-home", "households", "leads", "pipelines", "activities", "import"];
function isCrmTab(tab: AdminTab): boolean {
  return CRM_TABS.includes(tab);
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectedPlan, setInspectedPlan] = useState<AdminPlanSummary | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [me, setMe] = useState<MeUser | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setMeLoading(false));
  }, []);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminStats();
      setStats(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect to administrative API");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <div className="min-h-screen bg-navy-50/40 flex flex-col -mx-4 sm:-mx-6 lg:-mx-8 xl:-mx-12 -my-8">
      {/* Top Header */}
      <AdminHeader
        activeTab={activeTab}
        onTabChange={setActiveTab}
        databaseProvider={stats?.database?.provider || "SQLite"}
        isDbConnected={stats?.database?.connected ?? true}
      />

      {/* Main Content Area */}
      <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 xl:px-12 py-8">
        {activeTab === "customers" ? (
          // Cookie-authed section: works for signed-in admins/RMs even without the legacy admin key
          <AdminCustomersTab me={me} meLoading={meLoading} />
        ) : isCrmTab(activeTab) ? (
          // CRM sections: cookie-authed via /api/auth/me session, no legacy admin key needed
          <>
            {activeTab === "crm-home" && <CrmHome />}
            {activeTab === "households" && <HouseholdsTab />}
            {activeTab === "leads" && <LeadsTab />}
            {activeTab === "pipelines" && <PipelinesTab />}
            {activeTab === "activities" && <ActivitiesTab />}
            {activeTab === "import" && <ImportTab />}
          </>
        ) : loading && !stats ? (
          <div className="p-16 text-center space-y-3">
            <div className="inline-block animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full" />
            <p className="text-xs text-navy-600 font-medium">Loading control center diagnostics...</p>
          </div>
        ) : error && !stats && error.includes("(403)") ? (
          <form
            className="p-8 max-w-md mx-auto bg-white rounded-2xl border border-navy-200 space-y-4 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              saveAdminKey(keyInput.trim());
              setKeyInput("");
              loadStats();
            }}
          >
            <h2 className="text-base font-bold text-navy-950">Admin key required</h2>
            <p className="text-xs text-navy-600">
              This area holds customer plans, so it is locked. Enter the admin key to continue. It is kept only for this browser tab.
            </p>
            <div>
              <label htmlFor="admin-key" className="label">Admin key</label>
              <input id="admin-key" type="password" autoComplete="off" className="input" value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)} />
            </div>
            <button type="submit" disabled={!keyInput.trim()}
              className="px-4 py-2 bg-navy-900 hover:bg-navy-800 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition">
              Unlock
            </button>
          </form>
        ) : error && !stats ? (
          <div className="p-8 max-w-md mx-auto bg-white rounded-2xl border border-rose-200 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto text-xl font-bold">
              !
            </div>
            <div>
              <h2 className="text-base font-bold text-navy-950">Administrative Connection Error</h2>
              <p className="text-xs text-navy-600 mt-1">{error}</p>
            </div>
            <button
              onClick={loadStats}
              className="px-4 py-2 bg-navy-900 hover:bg-navy-800 text-white text-xs font-semibold rounded-xl transition"
            >
              Retry Connection
            </button>
          </div>
        ) : (
          stats && (
            <>
              {activeTab === "overview" && (
                <AdminDashboardTab
                  stats={stats}
                  onTabChange={setActiveTab}
                  onInspectPlan={setInspectedPlan}
                />
              )}

              {activeTab === "plans" && (
                <AdminPlansTab onInspectPlan={setInspectedPlan} />
              )}

              {activeTab === "cas" && <AdminCasTab />}

              {activeTab === "funds" && <AdminFundsTab />}

              {activeTab === "config" && <AdminConfigTab />}

              {activeTab === "operations" && <AdminOperationsTab />}
            </>
          )
        )}
      </div>

      {/* Slide-over Plan Drawer */}
      {inspectedPlan && (
        <PlanDrawer plan={inspectedPlan} onClose={() => setInspectedPlan(null)} />
      )}
    </div>
  );
}
