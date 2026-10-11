// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
    if (!loading && customer) router.replace("/account/plans");
  }, [customer, loading, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    const err = await login(email.trim(), password);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    router.push("/account/plans");
  }

  async function handlePlanLink(e: React.FormEvent) {
    e.preventDefault();
    const m = UUID_RE.exec(planLink.trim());
    if (!m) {
      setPlanError("That doesn't look like a plan link. Paste the full link or the 36-character ID from your results page.");
      return;
    }
    setPlanLoading(true);
    setPlanError(null);
    try {
      await getPlan(m[0]);
      router.push(`/portal/${m[0]}`);
    } catch {
      setPlanError("We couldn't find a plan with that link. Check it and try again — plan links expire after 30 days.");
    } finally {
      setPlanLoading(false);
    }
  }

  if (loading || customer) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-navy-600">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-navy-950">Log in</h1>
        <p className="mt-1 text-sm text-navy-600">Welcome back — sign in to see your plans.</p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4" noValidate>
          <TextField
            id="email"
            label="Email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            error={undefined}
          />
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="input"
            />
          </div>
          {error && (
            <p role="alert" className="err text-sm">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <div className="mt-4 border-t border-navy-100 pt-4 text-center text-sm text-navy-700">
          New to Fund Horizon?{" "}
          <Link href="/signup" className="font-semibold text-teal-700 hover:text-teal-800">
            Create an account
          </Link>
        </div>

        <div className="mt-6 border-t border-navy-100 pt-6">
          <h2 className="text-sm font-bold text-navy-950">Have a plan link instead?</h2>
          <p className="mt-1 text-sm text-navy-600">
            No account needed — paste your plan link to open your dashboard directly.
          </p>
          <form onSubmit={handlePlanLink} className="mt-3 space-y-2">
            <input
              type="text"
              value={planLink}
              onChange={(e) => setPlanLink(e.target.value)}
              placeholder="https://fundhorizon.up.railway.app/plan/…"
              autoComplete="off"
              spellCheck={false}
              className="input w-full"
            />
            {planError && (
              <p role="alert" className="text-sm text-red-700">
                {planError}
              </p>
            )}
            <button
              type="submit"
              disabled={planLoading || planLink.trim().length === 0}
              className="w-full rounded-xl border border-navy-200 px-4 py-2 text-sm font-semibold text-navy-900 transition hover:bg-navy-50 disabled:opacity-50"
            >
              {planLoading ? "Finding your plan…" : "Open my dashboard"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
