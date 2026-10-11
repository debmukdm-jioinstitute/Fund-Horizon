// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getPlan } from "@/lib/api";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Customer log-in for the plan-link portal (no accounts — the plan link is the key).
 * Paste a plan link or ID → validated against the API → opened in the portal. */
export default function CustomerLogin({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function close() {
    setOpen(false);
    setError(null);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const m = UUID_RE.exec(value.trim());
    if (!m) {
      setError("That doesn't look like a plan link. Paste the full link or the 36-character ID from your results page.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await getPlan(m[0]);
      close();
      router.push(`/portal/${m[0]}`);
    } catch {
      setError("We couldn't find a plan with that link. Check it and try again — plan links expire after 30 days.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`ml-1 rounded-xl bg-navy-900 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-800 ${className}`}
      >
        Log in
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-4 backdrop-blur-sm"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Log in to your portal"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-navy-100 pb-3">
              <h3 className="text-lg font-bold text-navy-950">Log in to your portal</h3>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded p-1.5 text-navy-400 hover:bg-navy-50 hover:text-navy-700"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <p className="text-sm text-navy-700">
                Paste your plan link or the 36-character ID from your results page to open your dashboard.
              </p>
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="https://fundhorizon.up.railway.app/plan/…"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl border border-navy-200 px-3 py-2 text-sm text-navy-950 placeholder:text-navy-300 focus:border-teal-500 focus:outline-none"
              />
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading || value.trim().length === 0}
                className="w-full rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
              >
                {loading ? "Finding your plan…" : "Open my dashboard"}
              </button>
            </form>

            <div className="mt-4 border-t border-navy-100 pt-4 text-center text-sm text-navy-700">
              New to Fund Horizon?{" "}
              <Link href="/plan/new" className="font-semibold text-teal-700 hover:text-teal-800" onClick={close}>
                Create your free plan
              </Link>
            </div>
            <p className="mt-2 text-center text-xs text-navy-500">
              No password needed — your plan link is your key. We never ask for your phone or email.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
