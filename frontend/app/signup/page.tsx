"use client";

import Link from "next/link";
import Logo from "@/components/Logo";

export default function SignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-sand-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl border border-sand-200 shadow-sm p-8 text-center">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 mb-4">
          Internal Backoffice Deployment
        </div>
        <h1 className="text-xl font-semibold text-sand-900 mb-2">Public Onboarding Closed</h1>
        <p className="text-sm text-sand-600 mb-6 leading-relaxed">
          Fund Horizon operates strictly as an internal research and operations platform.
          Self-service public account registration is disabled. Staff accounts are provisioned directly by system administrators.
        </p>
        <Link
          href="/login"
          className="inline-flex w-full justify-center items-center py-2.5 px-4 rounded-xl text-sm font-medium text-white bg-forest-700 hover:bg-forest-800 transition-colors shadow-sm"
        >
          Proceed to Staff Sign In
        </Link>
      </div>
    </div>
  );
}
