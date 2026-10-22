"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth } from "@/components/AuthContext";
import { signupCustomer } from "@/lib/api";

const input = "terminal-input w-full text-[13px] py-1.5 px-2.5";
const label = "text-[11px] font-medium text-[#536176] dark:text-[#A8B4C4] block mb-1";
const primary =
  "w-full terminal-btn text-[13px] py-2 px-3 bg-[#006F64] text-white border-[#006F64] dark:bg-[#75E1CE] dark:text-[#10151C] dark:border-[#75E1CE] font-medium";

export default function LandingPage() {
  const { customer, loading, login, refresh } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ name: "", email: "", mobile: "", password: "", consent: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && customer) router.replace(customer.is_staff ? "/backoffice" : "/account/plans");
  }, [customer, loading, router]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: k === "consent" ? e.target.checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    if (mode === "login") {
      const err = await login(f.email.trim(), f.password);
      if (err) setError(err);
    } else {
      try {
        await signupCustomer({ ...f, name: f.name.trim(), email: f.email.trim(), mobile: f.mobile.trim() });
        await refresh();
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : "Could not create the account.");
      }
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-[#F7F9FB] dark:bg-[#10151C] px-4 py-12 flex flex-col items-center">
      <Logo size="md" showSubtitle={false} href="/" />
      <h1 className="text-[22px] font-medium text-[#172033] dark:text-[#EDF2F7] mt-4">Welcome to Fund Horizon</h1>
      <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4] mt-1 mb-8">Choose how you want to sign in</p>

      <div className="w-full max-w-3xl grid gap-5 md:grid-cols-2">
        <section className="terminal-panel p-6 shadow-sm space-y-4" aria-labelledby="cust">
          <h2 id="cust" className="text-[16px] font-medium text-[#172033] dark:text-[#EDF2F7]">Customer</h2>
          <div className="flex gap-2 text-[12px]">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); }}
                className={`terminal-btn px-3 py-1 ${mode === m ? "font-semibold border-[#006F64]" : ""}`}
              >
                {m === "login" ? "Log in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="space-y-3" noValidate>
            {mode === "signup" && (
              <>
                <div>
                  <label htmlFor="c-name" className={label}>Full name</label>
                  <input id="c-name" className={input} value={f.name} onChange={set("name")} autoComplete="name" />
                </div>
                <div>
                  <label htmlFor="c-mobile" className={label}>Mobile (10 digits)</label>
                  <input id="c-mobile" className={input} value={f.mobile} onChange={set("mobile")} autoComplete="tel" inputMode="numeric" />
                </div>
              </>
            )}
            <div>
              <label htmlFor="c-email" className={label}>Email</label>
              <input id="c-email" type="email" className={input} value={f.email} onChange={set("email")} autoComplete="email" />
            </div>
            <div>
              <label htmlFor="c-pw" className={label}>Password</label>
              <input
                id="c-pw"
                type="password"
                className={input}
                value={f.password}
                onChange={set("password")}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            {mode === "signup" && (
              <label className="flex items-start gap-2 text-[11px] text-[#536176] dark:text-[#A8B4C4]">
                <input type="checkbox" checked={f.consent} onChange={set("consent")} className="mt-0.5" />
                I agree to Fund Horizon storing my details to provide this service.
              </label>
            )}
            {error && (
              <div role="alert" className="p-2.5 rounded bg-[#B42332]/5 border border-[#B42332]/30 text-[12px] text-[#B42332] dark:text-[#FF7D86]">
                {error}
              </div>
            )}
            <button type="submit" disabled={busy} className={primary}>
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </section>

        <section className="terminal-panel p-6 shadow-sm space-y-4 flex flex-col" aria-labelledby="adm">
          <h2 id="adm" className="text-[16px] font-medium text-[#172033] dark:text-[#EDF2F7]">Admin</h2>
          <p className="text-[13px] text-[#536176] dark:text-[#A8B4C4] flex-1">
            Staff terminal for advisors, operations and administrators. Accounts are created by an administrator.
          </p>
          <Link href="/login" className={`${primary} text-center`}>Admin login</Link>
        </section>
      </div>
    </div>
  );
}
