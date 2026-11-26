"use client";

import React from "react";
import AiControlCentre from "@/components/backoffice/AiControlCentre";
import { useAuth } from "@/components/AuthContext";

export default function AiSettingsPage() {
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="terminal-panel p-6 text-center text-xs text-slate-500">
        AI Control Centre is accessible to administrators only.
      </div>
    );
  }

  return <AiControlCentre />;
}
