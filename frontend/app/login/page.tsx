"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth } from "@/components/AuthContext";
import { TextField } from "@/components/Field";
import { getPlan } from "@/lib/api";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export default function LoginPage() {
  const { customer, loading, login } = useAuth();
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
      <div className="min-h-screen flex items-center justify-center bg-sand-50">
        <div className="flex items-center gap-3 text-sand-600 font-medium text-sm">
          <svg className="animate-spin h-5 w-5 text-forest-700" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading session…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sand-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-sand-200 shadow-sm p-8">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <div className="text-center mb-6">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-forest-50 text-forest-800 border border-forest-200">
            Internal Backoffice Access
          </span>
          <h1 className="text-2xl font-semibold text-sand-950 mt-3">Staff Sign In</h1>
          <p className="text-xs text-sand-600 mt-1">Research, PMS tracking & operations backoffice</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4" noValidate>
          <TextField
            id="email"
            label="Staff Email"
            value={email}
            onChange={setEmail}
            placeholder="analyst@fundhorizon.com"
            autoComplete="email"
            error={undefined}
          />
          <div>
            <label htmlFor="password" className="label text-xs font-medium text-sand-700 block mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-sand-300 px-3.5 py-2 text-sm text-sand-900 focus:outline-none focus:ring-2 focus:ring-forest-600 focus:border-transparent"
              placeholder="••••••••••••"
            />
          </div>
          {error && (
            <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-forest-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest-800 disabled:opacity-50 shadow-sm"
          >
            {submitting ? "Signing In…" : "Sign In to Backoffice"}
          </button>
        </form>

        <div className="mt-8 border-t border-sand-200 pt-6">
          <h2 className="text-xs font-semibold text-sand-800 uppercase tracking-wider">Historical Plan Lookup</h2>
          <p className="mt-1 text-xs text-sand-500">
            Have a client plan UUID? Enter the ID to inspect the legacy plan record.
          </p>
          <form onSubmit={handlePlanLink} className="mt-3 space-y-2">
            <input
              type="text"
              value={planLink}
              onChange={(e) => setPlanLink(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-sand-300 px-3 py-1.5 text-xs text-sand-900 focus:outline-none focus:ring-2 focus:ring-forest-600"
            />
            {planError && (
              <p role="alert" className="text-xs text-red-700">
                {planError}
              </p>
            )}
            <button
              type="submit"
              disabled={planLoading || planLink.trim().length === 0}
              className="w-full rounded-xl border border-sand-300 bg-sand-50 px-3 py-1.5 text-xs font-medium text-sand-700 transition hover:bg-sand-100 disabled:opacity-50"
            >
              {planLoading ? "Searching…" : "Open Plan"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
