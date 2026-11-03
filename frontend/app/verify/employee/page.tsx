"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  fetchPublicVerification,
  PublicCredentialVerification,
} from "@/lib/hrmsApi";

function VerifyEmployeeContent() {
  const searchParams = useSearchParams();
  const queryCode = searchParams.get("id") || searchParams.get("code") || "";

  const [inputCode, setInputCode] = useState(queryCode);
  const [data, setData] = useState<PublicCredentialVerification | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doVerify = async (codeToVerify: string) => {
    const trimmed = codeToVerify.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPublicVerification(trimmed);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification service unavailable");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (queryCode) {
      doVerify(queryCode);
    }
  }, [queryCode]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 py-10 px-4 sm:px-6">
      <div className="mx-auto max-w-xl">
        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <Link href="/" className="inline-block transition hover:opacity-90">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B2545] text-white font-bold shadow-md">
                FH
              </div>
              <div className="text-left">
                <span className="block text-lg font-bold tracking-tight text-[#0B2545] dark:text-white">
                  FUND HORIZON
                </span>
                <span className="block text-[11px] font-semibold text-[#006F64] dark:text-emerald-400">
                  AMFI REGISTERED DISTRIBUTOR · ARN-345439
                </span>
              </div>
            </div>
          </Link>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
            Official Employee Credential Verification
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Instant tamper-proof verification of Fund Horizon employee identification badges.
          </p>
        </div>

        {/* Verification Search Bar (if code changed or scanned manual) */}
        <div className="mb-6 rounded-2xl bg-white p-3 shadow-sm border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              doVerify(inputCode);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="Enter Employee ID (e.g. FH-001) or Verification Code..."
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-[#006F64] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="submit"
              disabled={loading || !inputCode.trim()}
              className="rounded-xl bg-[#0B2545] hover:bg-[#12335c] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
          </form>
        </div>

        {/* Verification Result Card */}
        {loading && (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:bg-slate-900 dark:border-slate-800">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#006F64] border-t-transparent" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Validating credential with Fund Horizon official registry...
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50/80 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/40">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/60 dark:text-rose-300 font-bold">
              !
            </div>
            <h2 className="text-sm font-bold text-rose-900 dark:text-rose-200">
              Verification Failed
            </h2>
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md dark:bg-slate-900 dark:border-slate-800">
            {/* Status Header */}
            {data.verified && data.status === "valid" ? (
              <div className="bg-emerald-600 px-6 py-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                    ✓
                  </div>
                  <div>
                    <h2 className="text-base font-bold tracking-wide">
                      VERIFIED OFFICIAL CREDENTIAL
                    </h2>
                    <p className="text-xs text-emerald-100">
                      Active employee in good standing with Fund Horizon Private Limited.
                    </p>
                  </div>
                </div>
              </div>
            ) : data.verified ? (
              <div className="bg-amber-500 px-6 py-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                    !
                  </div>
                  <div>
                    <h2 className="text-base font-bold tracking-wide">
                      INACTIVE / EXPIRED RECORD
                    </h2>
                    <p className="text-xs text-amber-100">
                      Record matched in registry, but employment status is currently inactive.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-rose-600 px-6 py-4 text-white">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                    ✕
                  </div>
                  <div>
                    <h2 className="text-base font-bold tracking-wide">
                      UNVERIFIED CREDENTIAL
                    </h2>
                    <p className="text-xs text-rose-100">
                      {data.detail || "No matching credential found in the official registry."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {data.verified && (
              <div className="p-6 space-y-5">
                {/* Employee Primary Identity */}
                <div className="flex items-center gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#0B2545] text-xl font-bold text-white shadow-inner">
                    {(data.employee_name || "FH")
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                      {data.employee_name}
                    </h3>
                    <p className="text-xs font-semibold text-[#006F64] dark:text-emerald-400">
                      {data.designation} · {data.department}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-mono font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                        {data.emp_code}
                      </span>
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Active In Service
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Parameters Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Card Number
                    </span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                      {data.card_number}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Blood Group
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">
                      {data.blood_group || "N/A"}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Issue Date
                    </span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {data.issue_date}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Valid Until
                    </span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {data.valid_until}
                    </span>
                  </div>
                </div>

                {/* Issuing Authority & Verification Stamp */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-850">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-[#006F64]">
                        Issuing Authority
                      </span>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        {data.issuing_organization}
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">
                        {data.registration}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Authorized Signatory: <b>{data.signatory}</b>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                        ✓ Sealed & Signed
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-slate-200/80 pt-2 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Registered Office: {data.office_address}
                  </div>
                </div>

                {/* Audit timestamp */}
                <div className="text-center text-[11px] text-slate-400">
                  Registry verification timestamp:{" "}
                  {data.verified_at ? new Date(data.verified_at).toLocaleString("en-IN") : new Date().toLocaleString("en-IN")}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-slate-400">
          Fund Horizon Private Limited · AMFI Registered ARN-345439
          <br />
          For physical ID card queries or replacements, contact support@fundhorizon.com
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmployeePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#006F64] border-t-transparent" />
        </div>
      }
    >
      <VerifyEmployeeContent />
    </Suspense>
  );
}
