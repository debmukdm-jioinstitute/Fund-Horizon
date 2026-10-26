"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { signupCustomer } from "@/lib/api";

interface AuthPortalProps {
  initialTab?: "customer" | "admin";
  initialOpenSignup?: boolean;
}

export default function AuthPortal({
  initialTab = "customer",
  initialOpenSignup = false,
}: AuthPortalProps) {
  const router = useRouter();
  const { customer, loading: authLoading, login } = useAuth();

  const [activeTab, setActiveTab] = useState<"customer" | "admin">(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modals
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitted, setForgotSubmitted] = useState(false);

  const [showSignupModal, setShowSignupModal] = useState(initialOpenSignup);
  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupMobile, setSignupMobile] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConsent, setSignupConsent] = useState(true);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSubmitting, setSignupSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && customer) {
      if (customer.is_staff) {
        router.replace("/backoffice");
      } else {
        router.replace("/account/plans");
      }
    }
  }, [customer, authLoading, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(
        activeTab === "customer"
          ? "Please enter your email address."
          : "Please enter your staff email address."
      );
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setSubmitting(true);
    const err = await login(trimmedEmail, password);
    setSubmitting(false);

    if (err) {
      setError(err);
      return;
    }

    if (activeTab === "admin") {
      router.push("/backoffice");
    } else {
      router.push("/account/plans");
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setSignupError(null);

    if (!signupName.trim()) {
      setSignupError("Please enter your full name.");
      return;
    }
    if (!signupEmail.trim() || !signupEmail.includes("@")) {
      setSignupError("Please enter a valid email address.");
      return;
    }
    const cleanMobile = signupMobile.replace(/\D/g, "");
    if (cleanMobile.length < 10) {
      setSignupError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (signupPassword.length < 8) {
      setSignupError("Password must be at least 8 characters long.");
      return;
    }
    if (!signupConsent) {
      setSignupError("Consent to terms and risk disclosure is required.");
      return;
    }

    setSignupSubmitting(true);
    try {
      await signupCustomer({
        name: signupName.trim(),
        email: signupEmail.trim().toLowerCase(),
        mobile: cleanMobile.slice(-10),
        password: signupPassword,
        consent: signupConsent,
      });

      const err = await login(signupEmail.trim().toLowerCase(), signupPassword);
      setSignupSubmitting(false);
      if (err) {
        setSignupError(err);
        return;
      }
      setShowSignupModal(false);
      router.push("/account/plans");
    } catch (err: unknown) {
      setSignupSubmitting(false);
      setSignupError(
        err instanceof Error ? err.message : "Account creation failed. Please try again."
      );
    }
  }


  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#FFFFFF] dark:bg-[#10151C] text-[#101828] dark:text-[#EDF2F7]">
      {/* ================= LEFT BRAND / HERO PANE ================= */}
      <section
        aria-label="Fund Horizon Brand Overview"
        className="w-full lg:w-[48%] xl:w-[46%] min-h-[480px] lg:min-h-screen relative flex flex-col justify-between p-6 sm:p-10 lg:p-14 overflow-hidden select-none bg-[#05241B]"
      >
        {/* Background Artwork: Rolling emerald hills, golden contour curves & glowing sunrise */}
        <div
          className="absolute inset-0 bg-cover bg-bottom opacity-90 transition-transform duration-700 hover:scale-105 pointer-events-none"
          style={{
            backgroundImage: "url('/images/auth-hero-art.jpg')",
          }}
        />
        {/* Subtle Vignette & Dark Overlay for optimal text contrast */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#05241B]/90 via-[#05241B]/40 to-[#041F17]/85 pointer-events-none" />

        {/* Top: Brand Logo */}
        <header className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-3 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo-emblem-clean.png"
              alt="Fund Horizon Emblem"
              className="h-10 sm:h-12 w-auto object-contain transition-transform duration-200 group-hover:scale-105"
            />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="text-white font-bold tracking-tight text-xl sm:text-2xl">
                  FUND
                </span>
                <span className="text-[#72C542] font-bold tracking-tight text-xl sm:text-2xl">
                  HORIZON
                </span>
              </div>
              <span className="text-white/80 text-[11px] sm:text-xs tracking-wide font-normal mt-0.5">
                Your Future Our Focus
              </span>
            </div>
          </Link>
        </header>

        {/* Mid-Hero Typography */}
        <div className="relative z-10 my-auto py-10 max-w-lg">
          <h1 className="text-3xl sm:text-4xl lg:text-[46px] font-bold tracking-tight text-white leading-[1.18]">
            Plan with clarity.
            <br />
            Grow with <span className="text-[#F3B33D]">confidence.</span>
          </h1>
          <p className="text-white/75 text-base sm:text-lg mt-3 font-normal">
            Your future, in focus.
          </p>
          <div className="w-12 h-1 bg-[#F3B33D] mt-3 rounded-full" />
        </div>

        {/* Bottom Trust Badge */}
        <footer className="relative z-10 flex items-center gap-3 pt-6 mt-auto">
          <div className="flex-shrink-0 w-8 h-8 rounded-full border border-[#D5A036] flex items-center justify-center text-[#D5A036] bg-[#05241B]/60">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 15v2m-6 4l6-3 6 3V5a2 2 0 00-2-2H8a2 2 0 00-2 2v16z"
              />
            </svg>
          </div>
          <p className="text-[12px] sm:text-[13px] text-white/80 leading-snug">
            Your data is secure with industry-standard encryption and trusted infrastructure.
          </p>
        </footer>
      </section>

      {/* ================= RIGHT FORM / PORTAL PANE ================= */}
      <main className="w-full lg:w-[52%] xl:w-[54%] min-h-screen bg-[#FFFFFF] dark:bg-[#10151C] flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 py-12 relative">
        {/* Top Right "Staff access ↗" Link */}
        <div className="absolute top-6 right-6 sm:top-8 sm:right-10 flex items-center gap-3 z-20">
          <button
            type="button"
            onClick={() => {
              setActiveTab("admin");
              setError(null);
            }}
            className="text-xs sm:text-sm font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline flex items-center gap-1 transition-colors"
          >
            Staff access ↗
          </button>
        </div>

        <div className="max-w-md w-full mx-auto relative">
          {/* Subtle Annotations / Callouts (Visible on Desktop >= 1280px) */}
          {/* 1. "Start with your account" */}
          <div className="hidden xl:flex absolute -left-36 top-14 items-center gap-1 pointer-events-none select-none z-10">
            <span className="bg-[#E4ECE5] text-[#1E3B2E] border border-[#CCD8CF] text-[11px] font-medium px-2.5 py-1 rounded-full shadow-sm">
              Start with your account
            </span>
            <svg className="w-12 h-10 text-[#006F64] overflow-visible" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeDasharray="3 3" d="M2,4 Q24,6 38,32" />
              <polyline points="33,32 38,33 39,26" />
            </svg>
          </div>

          {/* 2. "For the Fund Horizon team" */}
          <div className="hidden xl:flex absolute -right-36 top-8 items-center gap-1 pointer-events-none select-none z-10">
            <svg className="w-12 h-10 text-[#006F64] overflow-visible" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeDasharray="3 3" d="M40,2 Q20,12 6,34" />
              <polyline points="5,27 6,34 13,34" />
            </svg>
            <span className="bg-[#F6EFE2] text-[#7A531A] border border-[#ECD8BA] text-[11px] font-medium px-2.5 py-1 rounded-full shadow-sm">
              For the Fund Horizon team
            </span>
          </div>

          {/* 3. "Your registered email" */}
          <div className="hidden xl:flex absolute -left-36 top-[236px] items-center gap-1 pointer-events-none select-none z-10">
            <span className="bg-[#E4ECE5] text-[#1E3B2E] border border-[#CCD8CF] text-[11px] font-medium px-2.5 py-1 rounded-full shadow-sm">
              Your registered email
            </span>
            <svg className="w-10 h-8 text-[#006F64] overflow-visible" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeDasharray="3 3" d="M2,8 Q18,6 30,22" />
              <polyline points="25,22 30,22 30,16" />
            </svg>
          </div>

          {/* 4. "New here? Begin here" */}
          <div className="hidden xl:flex absolute -left-36 bottom-2 items-center gap-1 pointer-events-none select-none z-10">
            <span className="bg-[#E4ECE5] text-[#1E3B2E] border border-[#CCD8CF] text-[11px] font-medium px-2.5 py-1 rounded-full shadow-sm">
              New here? Begin here
            </span>
            <svg className="w-10 h-8 text-[#006F64] overflow-visible" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeDasharray="3 3" d="M2,4 Q18,6 28,24" />
              <polyline points="23,24 28,24 28,18" />
            </svg>
          </div>

          {/* Portal Sub-heading Badge */}
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase text-[#006F64] dark:text-[#75E1CE] mb-2">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            SECURE CLIENT PORTAL
          </div>

          {/* Main Title */}
          <h2 className="text-2xl sm:text-3xl font-bold text-[#101828] dark:text-[#EDF2F7] tracking-tight">
            Welcome to Fund Horizon
          </h2>
          <p className="text-sm text-[#667085] dark:text-[#A8B4C4] mt-1">
            Choose how you want to sign in
          </p>

          {/* Switcher Tabs: Customer vs Admin */}
          <div className="mt-6">
            <div className="grid grid-cols-2 p-1 bg-[#EEF2F6] dark:bg-[#17202C] rounded-xl border border-[#E4E9EF] dark:border-[#2B3644]">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("customer");
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === "customer"
                    ? "bg-[#064E3B] text-white shadow-sm"
                    : "text-[#475467] dark:text-[#A8B4C4] hover:text-[#101828] dark:hover:text-white"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                Customer
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab("admin");
                  setError(null);
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                  activeTab === "admin"
                    ? "bg-[#064E3B] text-white shadow-sm"
                    : "text-[#475467] dark:text-[#A8B4C4] hover:text-[#101828] dark:hover:text-white"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                Admin
              </button>
            </div>

            {/* Helper captions beneath the tabs */}
            <div className="grid grid-cols-2 gap-4 mt-2 px-1">
              <p
                className={`text-[11px] leading-tight transition-colors ${
                  activeTab === "customer"
                    ? "text-[#344054] dark:text-[#EDF2F7] font-medium"
                    : "text-[#98A2B3] dark:text-[#64748B]"
                }`}
              >
                Access your investments and manage your account.
              </p>
              <p
                className={`text-[11px] leading-tight transition-colors ${
                  activeTab === "admin"
                    ? "text-[#344054] dark:text-[#EDF2F7] font-medium"
                    : "text-[#98A2B3] dark:text-[#64748B]"
                }`}
              >
                Staff terminal for advisors, operations and administrators.
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="mt-6 space-y-4" noValidate>
            {/* Email Field */}
            <div>
              <label
                htmlFor="portal-email"
                className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1.5"
              >
                Email
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-[#98A2B3] pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </span>
                <input
                  id="portal-email"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    activeTab === "customer"
                      ? "Enter your email address"
                      : "Enter your staff email"
                  }
                  autoComplete="username"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#17202C] text-[#101828] dark:text-[#EDF2F7] placeholder-[#98A2B3] text-sm focus:outline-none focus:ring-2 focus:ring-[#006F64] focus:border-transparent transition-all shadow-sm"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="portal-password"
                className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1.5"
              >
                Password
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-[#98A2B3] pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </span>
                <input
                  id="portal-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#17202C] text-[#101828] dark:text-[#EDF2F7] placeholder-[#98A2B3] text-sm focus:outline-none focus:ring-2 focus:ring-[#006F64] focus:border-transparent transition-all shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 text-[#98A2B3] hover:text-[#475467] transition-colors p-1"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                      />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                  )}
                </button>
              </div>

              {/* Forgot password link */}
              <div className="flex justify-end mt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(true);
                    setForgotSubmitted(false);
                  }}
                  className="text-xs font-medium text-[#006F64] dark:text-[#75E1CE] hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-[#B42332]/5 border border-[#B42332]/20 text-xs text-[#B42332] dark:text-[#FF7D86] flex items-center gap-2"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                {error}
              </div>
            )}

            {/* Primary Action Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-[#064E3B] hover:bg-[#085a44] text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-70 cursor-pointer"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Authenticating…</span>
                </>
              ) : (
                <>
                  <span>{activeTab === "admin" ? "Log in as Staff" : "Log in"}</span>
                  <span className="text-base leading-none">→</span>
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#E4E9EF] dark:border-[#2B3644]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white dark:bg-[#10151C] px-3 text-[#667085] dark:text-[#A8B4C4]">
                New to Fund Horizon?
              </span>
            </div>
          </div>

          {/* Secondary Action: Create Account */}
          <button
            type="button"
            onClick={() => {
              setShowSignupModal(true);
              setSignupError(null);
            }}
            className="w-full py-2.5 px-4 rounded-xl border border-[#064E3B] text-[#064E3B] dark:text-[#75E1CE] dark:border-[#75E1CE] hover:bg-[#064E3B]/5 dark:hover:bg-[#75E1CE]/10 font-semibold text-sm transition-all text-center cursor-pointer shadow-sm"
          >
            Create account
          </button>

        </div>
      </main>

      {/* ================= FORGOT PASSWORD MODAL ================= */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-[#17202C] rounded-2xl max-w-md w-full p-6 shadow-xl border border-[#E4E9EF] dark:border-[#2B3644] relative">
            <button
              type="button"
              onClick={() => setShowForgotModal(false)}
              className="absolute top-4 right-4 text-[#98A2B3] hover:text-[#344054] dark:hover:text-white"
            >
              ✕
            </button>

            <h3 className="text-lg font-bold text-[#101828] dark:text-[#EDF2F7]">
              Reset password
            </h3>
            <p className="text-xs text-[#667085] dark:text-[#A8B4C4] mt-1">
              Enter your registered email address and we will assist you with access recovery.
            </p>

            {forgotSubmitted ? (
              <div className="mt-4 p-3 rounded-xl bg-[#006F64]/10 text-xs text-[#006F64] dark:text-[#75E1CE] leading-relaxed">
                If an account exists for {forgotEmail}, recovery guidance has been triggered. For security, staff terminal access must be reset via your compliance officer.
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (forgotEmail.trim()) {
                    setForgotSubmitted(true);
                  }
                }}
                className="mt-4 space-y-3"
              >
                <div>
                  <label
                    htmlFor="forgot-email"
                    className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1"
                  >
                    Registered Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="you@fundhorizon.com"
                    className="w-full px-3 py-2 rounded-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#10151C] text-sm text-[#101828] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="flex-1 py-2 px-3 rounded-xl border border-[#D0D5DD] text-xs font-semibold text-[#344054] dark:text-[#EDF2F7]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 px-3 rounded-xl bg-[#064E3B] text-white text-xs font-semibold"
                  >
                    Send instructions
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ================= CREATE ACCOUNT MODAL ================= */}
      {showSignupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-[#17202C] rounded-2xl max-w-md w-full p-6 sm:p-7 shadow-xl border border-[#E4E9EF] dark:border-[#2B3644] relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowSignupModal(false)}
              className="absolute top-4 right-4 text-[#98A2B3] hover:text-[#344054] dark:hover:text-white"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold tracking-wider uppercase text-[#006F64] dark:text-[#75E1CE] bg-[#E7F5F2] dark:bg-[#1A3034] px-2 py-0.5 rounded">
                NEW CLIENT ONBOARDING
              </span>
            </div>

            <h3 className="text-xl font-bold text-[#101828] dark:text-[#EDF2F7]">
              Create your account
            </h3>
            <p className="text-xs text-[#667085] dark:text-[#A8B4C4] mt-1">
              Access mutual fund portfolios, goal planning, and tax reports.
            </p>

            <form onSubmit={handleSignup} className="mt-5 space-y-3.5" noValidate>
              <div>
                <label
                  htmlFor="su-name"
                  className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1"
                >
                  Full Name
                </label>
                <input
                  id="su-name"
                  type="text"
                  required
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full px-3 py-2 rounded-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#10151C] text-sm text-[#101828] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]"
                />
              </div>

              <div>
                <label
                  htmlFor="su-email"
                  className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1"
                >
                  Email Address
                </label>
                <input
                  id="su-email"
                  type="email"
                  required
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="ramesh@example.com"
                  className="w-full px-3 py-2 rounded-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#10151C] text-sm text-[#101828] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]"
                />
              </div>

              <div>
                <label
                  htmlFor="su-mobile"
                  className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1"
                >
                  Indian Mobile Number
                </label>
                <div className="flex items-center">
                  <span className="px-3 py-2 rounded-l-xl border border-r-0 border-[#D0D5DD] dark:border-[#2B3644] bg-[#F7F9FB] dark:bg-[#10151C] text-xs font-medium text-[#475467] dark:text-[#A8B4C4]">
                    +91
                  </span>
                  <input
                    id="su-mobile"
                    type="tel"
                    required
                    maxLength={10}
                    value={signupMobile}
                    onChange={(e) => setSignupMobile(e.target.value)}
                    placeholder="9876543210"
                    className="w-full px-3 py-2 rounded-r-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#10151C] text-sm text-[#101828] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="su-pw"
                  className="text-xs font-semibold text-[#344054] dark:text-[#EDF2F7] block mb-1"
                >
                  Password (min. 8 characters)
                </label>
                <input
                  id="su-pw"
                  type="password"
                  required
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-[#D0D5DD] dark:border-[#2B3644] bg-white dark:bg-[#10151C] text-sm text-[#101828] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64]"
                />
              </div>

              <div className="flex items-start gap-2 pt-1">
                <input
                  id="su-consent"
                  type="checkbox"
                  checked={signupConsent}
                  onChange={(e) => setSignupConsent(e.target.checked)}
                  className="mt-0.5 rounded text-[#006F64] focus:ring-[#006F64]"
                />
                <label
                  htmlFor="su-consent"
                  className="text-[11px] text-[#667085] dark:text-[#A8B4C4] leading-snug cursor-pointer"
                >
                  I agree to create an account with Fund Horizon (ARN 345439) and acknowledge
                  that mutual fund investments are subject to market risks.
                </label>
              </div>

              {signupError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-xl bg-[#B42332]/5 border border-[#B42332]/20 text-xs text-[#B42332] dark:text-[#FF7D86]"
                >
                  {signupError}
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={signupSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#064E3B] hover:bg-[#085a44] text-white font-semibold text-sm transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {signupSubmitting ? "Creating Account…" : "Register & Open Portal →"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
