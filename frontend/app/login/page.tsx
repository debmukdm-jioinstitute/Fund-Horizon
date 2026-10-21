"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth } from "@/components/AuthContext";
import { useTheme } from "@/components/terminal/ThemeContext";
import { getPlan } from "@/lib/api";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export default function LoginPage() {
  const { customer, loading, login, guestLogin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [planLink, setPlanLink] = useState("");
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  useEffect(() => {
    if (!loading && customer) {
      if (customer.is_staff) {
        router.replace("/backoffice");
      } else {
        router.replace("/account/plans");
      }
    }
  }, [customer, loading, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your staff email and password.");
      return;
    }
    setSubmitting(true);
    const err = await login(email.trim(), password);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    router.push("/backoffice");
  }

  async function handleGuest() {
    setError(null);
    setSubmitting(true);
    const err = await guestLogin();
    setSubmitting(false);
    if (err) setError(err);
    else router.push("/backoffice");
  }

  async function handlePlanLink(e: React.FormEvent) {
    e.preventDefault();
    const m = UUID_RE.exec(planLink.trim());
    if (!m) {
      setPlanError("That doesn't look like a valid plan ID or link.");
      return;
    }
    setPlanLoading(true);
    setPlanError(null);
    try {
      await getPlan(m[0]);
      router.push(`/portal/${m[0]}`);
    } catch {
      setPlanError("Plan not found or expired.");
    } finally {
      setPlanLoading(false);
    }
  }

  if (loading || customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFFFF] dark:bg-[#10151C] text-[#536176] dark:text-[#A8B4C4]">
        <div className="flex items-center gap-2.5 text-[13px] font-medium">
          <svg className="animate-spin h-4 w-4 text-[#006F64] dark:text-[#75E1CE]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading session…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F9FB] dark:bg-[#10151C] px-4 py-12 relative select-none">
      {/* Top Right Theme Toggle */}
      <div className="absolute top-4 right-4">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="h-8 w-8 rounded flex items-center justify-center text-[#536176] dark:text-[#A8B4C4] hover:bg-[#FFFFFF] dark:hover:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] transition-colors"
        >
          {theme === "dark" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>

      <div className="w-full max-w-sm terminal-panel p-6 shadow-sm space-y-5">
        <div className="flex flex-col items-center text-center">
          <Logo size="md" showSubtitle={false} href="/" />
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-1.5 py-0.5 rounded">
              Terminal Access
            </span>
          </div>
          <h1 className="text-[18px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-2">
            Staff Authentication
          </h1>
          <p className="text-[12px] text-[#536176] dark:text-[#A8B4C4] mt-0.5">
            Internal financial data terminal & operations
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-3.5" noValidate>
          <div>
            <label htmlFor="email" className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
              Staff Email
            </label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@fundhorizon.com"
              autoComplete="username"
              className="terminal-input w-full text-[13px] py-1.5 px-2.5"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••••••"
              className="terminal-input w-full text-[13px] py-1.5 px-2.5"
            />
          </div>

          {error && (
            <div role="alert" className="p-2.5 rounded bg-[#B42332]/5 border border-[#B42332]/30 text-[12px] text-[#B42332] dark:text-[#FF7D86]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full terminal-btn text-[13px] py-2 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium"
          >
            {submitting ? "Authenticating…" : "Sign In to Terminal"}
          </button>
          <button
            type="button"
            onClick={handleGuest}
            disabled={submitting}
            className="w-full terminal-btn text-[13px] py-2 px-3"
          >
            Continue as Guest (read-only)
          </button>
        </form>

        <div className="pt-4 border-t border-[#E4E9EF] dark:border-[#2B3644] space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">
            Historical Plan Lookup
          </div>
          <form onSubmit={handlePlanLink} className="space-y-2">
            <input
              type="text"
              value={planLink}
              onChange={(e) => setPlanLink(e.target.value)}
              placeholder="Plan UUID (00000000-0000-…)"
              autoComplete="off"
              spellCheck={false}
              className="terminal-input w-full text-[11px] py-1 px-2 font-mono"
            />
            {planError && (
              <p role="alert" className="text-[11px] text-[#B42332] dark:text-[#FF7D86]">
                {planError}
              </p>
            )}
            <button
              type="submit"
              disabled={planLoading || planLink.trim().length === 0}
              className="w-full terminal-btn text-[11px] py-1 px-2"
            >
              {planLoading ? "Searching…" : "Open Plan Record"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
