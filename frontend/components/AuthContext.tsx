// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, getMe, loginCustomer, loginGuest, logoutCustomer } from "@/lib/api";
import type { Customer } from "@/lib/types";

interface AuthState {
  customer: Customer | null;
  loading: boolean;
  /** Returns an error message string on failure, null on success. */
  login: (email: string, password: string) => Promise<string | null>;
  guestLogin: () => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  customer: null,
  loading: true,
  login: async () => "not initialised",
  guestLogin: async () => "not initialised",
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Only a 401/403 means the session is gone. A 502 or network error (deploy, cold start) must not log staff out.
    // Keep retrying for about a minute so a deploy never bounces someone to the login page.
    for (let attempt = 0; attempt < 14; attempt++) {
      try {
        setCustomer(await getMe());
        return;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          setCustomer(null);
          return;
        }
        if (attempt < 13) await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 5000)));
      }
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

  const guestLogin = useCallback(async (): Promise<string | null> => {
    try {
      setCustomer((await loginGuest()).customer);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Guest access is unavailable.";
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

  const value = useMemo(() => ({ customer, loading, login, guestLogin, logout, refresh }), [customer, loading, login, guestLogin, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
