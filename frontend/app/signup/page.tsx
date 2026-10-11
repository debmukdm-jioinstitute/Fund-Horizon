// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import { TextField } from "@/components/Field";
import { signupCustomer, ApiError } from "@/lib/api";

const CONSENT_TEXT =
  "I consent to Fund Horizon storing my name, email and mobile number to manage my account and plans. I can request deletion at any time.";

function validateName(v: string): string | undefined {
  if (!v.trim()) return "Please enter your name.";
  return undefined;
}

function validateEmail(v: string): string | undefined {
  if (!v.trim()) return "Please enter your email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "That doesn't look like a valid email address.";
  return undefined;
}

function validateMobile(v: string): string | undefined {
  const digits = v.replace(/\D/g, "");
  if (!digits) return "Please enter your mobile number.";
  if (!/^[6-9]\d{9}$/.test(digits))
    return "Enter a valid 10-digit Indian mobile number (starting with 6–9).";
  return undefined;
}

function validatePassword(v: string): string | undefined {
  if (!v) return "Please choose a password.";
  if (v.length < 8) return "Password must be at least 8 characters.";
  return undefined;
}

function passwordStrength(v: string): { label: string; pct: number } | null {
  if (!v) return null;
  let score = 0;
  if (v.length >= 8) score++;
  if (v.length >= 12) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v)) score++;
  if (/[^a-zA-Z0-9]/.test(v)) score++;
  const labels = ["Weak", "Weak", "Okay", "Strong", "Strong", "Very strong"];
  return { label: labels[score] ?? "Weak", pct: Math.min(100, (score / 5) * 100) };
}

export default function SignupPage() {
  const { customer, loading } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && customer) router.replace("/account/plans");
  }, [customer, loading, router]);

  const errors = {
    name: touched.name ? validateName(name) : undefined,
    email: touched.email ? validateEmail(email) : undefined,
    mobile: touched.mobile ? validateMobile(mobile) : undefined,
    password: touched.password ? validatePassword(password) : undefined,
    consent: touched.consent && !consent ? "Please accept the consent so we can create your account." : undefined,
  };

  const strength = passwordStrength(password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, mobile: true, password: true, consent: true });
    setFormError(null);

    const n = validateName(name) ?? validateEmail(email) ?? validateMobile(mobile) ?? validatePassword(password);
    if (n) return;
    if (!consent) return;

    setSubmitting(true);
    try {
      await signupCustomer({
        name: name.trim(),
        email: email.trim(),
        mobile: mobile.replace(/\D/g, ""),
        password,
        consent: true,
      });
      router.push("/account/plans");
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 422
        ? e.message
        : "We couldn't create your account. Please try again.";
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || customer) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-navy-600">
        <p>Loading…</p>
      </div>
    );
  }

  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-navy-950">Create your account</h1>
        <p className="mt-1 text-sm text-navy-600">
          Your account keeps your plans in one place — no more digging for links.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <TextField
            id="name"
            label="Full name"
            value={name}
            onChange={(v) => { setName(v); touch("name"); }}
            placeholder="Your name"
            autoComplete="name"
            error={errors.name}
          />
          <TextField
            id="email"
            label="Email"
            value={email}
            onChange={(v) => { setEmail(v); touch("email"); }}
            placeholder="you@example.com"
            autoComplete="email"
            error={errors.email}
          />
          <TextField
            id="mobile"
            label="Mobile number"
            value={mobile}
            onChange={(v) => { setMobile(v.replace(/[^\d+]/g, "")); touch("mobile"); }}
            placeholder="98765 43210"
            autoComplete="tel"
            help="10-digit Indian mobile number. Used for account recovery."
            error={errors.mobile}
          />
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); touch("password"); }}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "password-err" : strength ? "password-strength" : undefined}
              className="input"
            />
            {strength && !errors.password && (
              <div id="password-strength" className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-navy-100">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-all"
                    style={{ width: `${strength.pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs font-medium text-navy-600">
                  Password strength: {strength.label}. Use 12+ characters with upper/lowercase, numbers and symbols.
                </p>
              </div>
            )}
            {errors.password && (
              <p id="password-err" role="alert" className="err">{errors.password}</p>
            )}
          </div>

          <div>
            <label htmlFor="consent" className="flex cursor-pointer items-start gap-3 rounded-xl border border-navy-100 bg-navy-50/50 p-3">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => { setConsent(e.target.checked); touch("consent"); }}
                aria-invalid={!!errors.consent}
                className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
              />
              <span className="text-xs leading-relaxed text-navy-800">{CONSENT_TEXT}</span>
            </label>
            {errors.consent && (
              <p role="alert" className="err">{errors.consent}</p>
            )}
          </div>

          {formError && (
            <p role="alert" className="err text-sm">{formError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-50"
          >
            {submitting ? "Creating your account…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-navy-700">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-teal-700 hover:text-teal-800">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
