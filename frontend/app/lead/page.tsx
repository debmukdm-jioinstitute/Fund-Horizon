"use client";

import React, { useState } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { resolveApiUrl, API_URL } from "@/lib/api";

const INTEREST_OPTIONS = [
  "Mutual Funds (SIP & Lumpsum)",
  "Portfolio Management Services (PMS)",
  "Comprehensive Wealth Advisory",
  "Fixed Income & Corporate FDs",
  "Retirement & Tax Planning",
  "General Portfolio Review",
];

export default function PublicLeadCapturePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [interest, setInterest] = useState(INTEREST_OPTIONS[0]);
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [srNo, setSrNo] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanPhone = phone.trim().replace(/[^\d+]/g, "");
    const cleanEmail = email.trim();

    if (!cleanName) {
      setError("Please enter your full name.");
      return;
    }
    if (cleanPhone.length < 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const url = resolveApiUrl(`${API_URL}/api/crm/public/lead`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
          interest,
          notes: notes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        let msg = "Could not submit inquiry. Please try again.";
        try {
          const data = await res.json();
          if (data.detail) msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
        } catch {
          /* fallback */
        }
        throw new Error(msg);
      }

      const data = await res.json().catch(() => ({}));
      setSrNo(typeof data.sr_no === "number" ? data.sr_no : null);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setName("");
    setPhone("");
    setEmail("");
    setInterest(INTEREST_OPTIONS[0]);
    setNotes("");
    setSubmitted(false);
    setSrNo(null);
    setError(null);
  }

  return (
    <div className="min-h-screen bg-[#F7F9FB] dark:bg-[#0D1219] text-[#172033] dark:text-[#EDF2F7] flex flex-col justify-between py-10 px-4 sm:px-6">
      <div className="max-w-lg w-full mx-auto space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <Logo size="lg" showSubtitle={true} href="/" />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#E7F5F2] dark:bg-[#1A3034] text-[#006F64] dark:text-[#75E1CE] border border-[#C2E9E0] dark:border-[#224845]">
            <span className="w-2 h-2 rounded-full bg-[#006F64] dark:bg-[#75E1CE] animate-pulse" />
            Client Intake & Wealth Advisory
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#172033] dark:text-[#EDF2F7]">
            Connect with Fund Horizon
          </h1>
          <p className="text-xs sm:text-sm text-[#536176] dark:text-[#A8B4C4] max-w-md">
            Please share your contact details. A dedicated wealth manager will evaluate your investment objectives and connect with tailored recommendations.
          </p>
        </div>

        {/* Form Container */}
        <div className="bg-white dark:bg-[#171E27] border border-[#E4E9EF] dark:border-[#2B3644] rounded-2xl p-6 sm:p-8 shadow-sm">
          {submitted ? (
            <div className="text-center space-y-5 py-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-[#E1F3EC] dark:bg-[#10372A] text-[#006F64] dark:text-[#7FE0B5] flex items-center justify-center">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-[#172033] dark:text-[#EDF2F7]">
                  Thank You, {name}!
                </h2>
                <p className="text-xs sm:text-sm text-[#536176] dark:text-[#A8B4C4] leading-relaxed">
                  Your information has been securely received by the Fund Horizon advisory desk.
                  A senior wealth manager will reach out to you on{" "}
                  <span className="font-semibold text-[#172033] dark:text-[#EDF2F7]">{phone}</span> shortly.
                </p>
              </div>

              {srNo !== null && (
                <div className="p-4 rounded-xl border-2 border-dashed border-[#006F64] dark:border-[#7FE0B5] bg-[#E1F3EC] dark:bg-[#10372A]">
                  <div className="text-[11px] uppercase tracking-wider text-[#536176] dark:text-[#A8B4C4]">Your Sr No</div>
                  <div className="text-4xl font-semibold tabular-nums text-[#006F64] dark:text-[#7FE0B5] mt-1">{srNo}</div>
                  <p className="text-xs text-[#172033] dark:text-[#EDF2F7] mt-2 font-medium">
                    Please take a screenshot of this Sr No and show it to our team.
                  </p>
                </div>
              )}

              <div className="p-4 rounded-xl bg-[#F7F9FB] dark:bg-[#111722] border border-[#E4E9EF] dark:border-[#2B3644] text-left text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">Registered Email:</span>
                  <span className="font-medium">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">Investment Focus:</span>
                  <span className="font-medium">{interest}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#536176] dark:text-[#A8B4C4]">Status:</span>
                  <span className="text-[#006F64] dark:text-[#7FE0B5] font-semibold">Assigned to Advisor</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2.5 text-xs font-medium rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] text-[#536176] dark:text-[#A8B4C4] hover:bg-[#F7F9FB] dark:hover:bg-[#1E2734] transition"
                >
                  Submit Another Response
                </button>
                <Link
                  href="/"
                  className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-[#006F64] hover:bg-[#00574E] text-white transition text-center"
                >
                  Explore Fund Horizon
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && (
                <div className="p-3 text-xs rounded-lg bg-[#FBE7EA] dark:bg-[#43181F] text-[#9B1C2E] dark:text-[#FFA9B5] border border-[#F5C2C7] dark:border-[#671A24]">
                  {error}
                </div>
              )}

              {/* Name */}
              <div>
                <label htmlFor="lead-name" className="block text-xs font-medium text-[#536176] dark:text-[#A8B4C4] mb-1.5">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="lead-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64] transition"
                />
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="lead-phone" className="block text-xs font-medium text-[#536176] dark:text-[#A8B4C4] mb-1.5">
                    Phone Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="lead-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 98201 12345"
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64] transition"
                  />
                </div>

                <div>
                  <label htmlFor="lead-email" className="block text-xs font-medium text-[#536176] dark:text-[#A8B4C4] mb-1.5">
                    Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="lead-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. rahul@example.com"
                    className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64] transition"
                  />
                </div>
              </div>

              {/* Investment Focus */}
              <div>
                <label htmlFor="lead-interest" className="block text-xs font-medium text-[#536176] dark:text-[#A8B4C4] mb-1.5">
                  Primary Investment Focus
                </label>
                <select
                  id="lead-interest"
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  className="w-full text-xs sm:text-sm px-3.5 py-2.5 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64] transition"
                >
                  {INTEREST_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="lead-notes" className="block text-xs font-medium text-[#536176] dark:text-[#A8B4C4] mb-1.5">
                  Specific Requirements / Questions <span className="text-[#8796A8] text-[11px] font-normal">(Optional)</span>
                </label>
                <textarea
                  id="lead-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Planning a lumpsum allocation or SIP portfolio across multicap funds..."
                  className="w-full text-xs sm:text-sm px-3.5 py-2 rounded-lg border border-[#D5DDE5] dark:border-[#2B3644] bg-white dark:bg-[#111722] text-[#172033] dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-[#006F64] transition resize-none"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-xs sm:text-sm bg-[#006F64] hover:bg-[#00574E] text-white shadow-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Submitting Your Details…</span>
                  </>
                ) : (
                  <span>Submit & Connect with Wealth Advisor →</span>
                )}
              </button>

              <p className="text-center text-[11px] text-[#8796A8] dark:text-[#6A788A] pt-1">
                Fund Horizon strictly maintains investor confidentiality in compliance with SEBI and AMFI guidelines.
              </p>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-[11px] text-[#8796A8] dark:text-[#6A788A]">
          Fund Horizon Wealth Management Pvt. Ltd. · AMFI Registered Mutual Fund Distributor
        </div>
      </div>
    </div>
  );
}
