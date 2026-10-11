// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React from "react";
import { MeUser } from "./account-api";
import AdminCustomersView from "./AdminCustomersView";
import AdminRmView from "./AdminRmView";

interface AdminCustomersTabProps {
  me: MeUser | null;
  meLoading: boolean;
}

/**
 * "Customers" area of the admin console.
 * - admins: full customer table with role and RM controls
 * - rms: their own assigned customers with plan links
 * - everyone else (signed out or role=customer): access denied, table not leaked
 */
export default function AdminCustomersTab({ me, meLoading }: AdminCustomersTabProps) {
  if (meLoading) {
    return (
      <div className="p-16 text-center space-y-3">
        <div className="inline-block animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full" />
        <p className="text-xs text-navy-600 font-medium">Checking your sign-in...</p>
      </div>
    );
  }

  if (!me || (me.role !== "admin" && me.role !== "rm")) {
    return (
      <div className="p-8 max-w-md mx-auto bg-white rounded-2xl border border-navy-200 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-navy-50 text-navy-600 flex items-center justify-center mx-auto text-xl font-bold">
          !
        </div>
        <div>
          <h2 className="text-base font-bold text-navy-950">Admin access required</h2>
          <p className="text-xs text-navy-600 mt-1">
            {!me
              ? "Sign in with an admin or relationship-manager account to view customers."
              : "This area is only available to admins and relationship managers."}
          </p>
        </div>
      </div>
    );
  }

  return me.role === "admin" ? <AdminCustomersView /> : <AdminRmView me={me} />;
}
