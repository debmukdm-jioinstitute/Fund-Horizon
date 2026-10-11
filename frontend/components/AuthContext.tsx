// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe, loginCustomer, logoutCustomer } from "@/lib/api";
import type { Customer } from "@/lib/types";

interface AuthState {
  customer: Customer | null;
  loading: boolean;
  /** Returns an error message string on failure, null on success. */
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  customer: null,
  loading: true,
  login: async () => "not initialised",
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setCustomer(me);
    } catch {
      setCustomer(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const res = await loginCustomer({ email, password });
      setCustomer(res.customer);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Login failed. Please try again.";
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutCustomer();
    } catch {
      /* session may already be gone — clear local state anyway */
    }
    setCustomer(null);
  }, []);

  const value = useMemo(() => ({ customer, loading, login, logout, refresh }), [customer, loading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
