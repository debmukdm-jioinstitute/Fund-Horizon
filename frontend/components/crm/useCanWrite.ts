"use client";

import { useAuth } from "@/components/AuthContext";

/** Compliance accounts are read-only everywhere in the CRM (the API refuses their writes as well). */
export function useCanWrite(): boolean {
  const { customer } = useAuth();
  return customer?.role !== "compliance";
}
