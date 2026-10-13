// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Link from "next/link";
import { Plus_Jakarta_Sans, Outfit } from "next/font/google";
import "./globals.css";
import Footer from "@/components/Footer";
import Logo from "@/components/Logo";
import CustomerLogin from "@/components/CustomerLogin";
import { AuthProvider } from "@/components/AuthContext";
import { siteUrl } from "@/lib/site";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

const display = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const baseUrl = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "Fund Horizon Planner",
  description: "Illustrative financial planning for your goals, from Fund Horizon.",
  openGraph: {
    title: "Fund Horizon Planner",
    description: "Illustrative financial planning for your goals, from Fund Horizon.",
    url: "/",
    siteName: "Fund Horizon",
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fund Horizon Planner",
    description: "Illustrative financial planning for your goals, from Fund Horizon.",
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${display.variable}`}>
      <body className="flex min-h-screen flex-col font-sans relative overflow-x-hidden selection:bg-teal-500 selection:text-white">
        <AuthProvider>
          {/* Ambient 3D Frosted Glow Lights */}
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <div className="floating-orb -top-24 -left-24 h-96 w-96 bg-teal-400/20" />
            <div className="floating-orb top-1/3 -right-28 h-[30rem] w-[30rem] bg-indigo-400/15" />
            <div className="floating-orb -bottom-24 left-1/4 h-96 w-96 bg-teal-300/15" />
          </div>

          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-white focus:p-3 focus:shadow-xl focus:ring-2 focus:ring-teal-500"
          >
            Skip to content
          </a>

          {/* Translucent Frosted Glass Sticky Header */}
          <header className="sticky top-0 z-40 w-full border-b border-slate-200/60 bg-white/80 backdrop-blur-xl shadow-[0_4px_20px_-4px_rgba(11,37,69,0.03)] transition-all">
            <div className="flex w-full flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
              <Logo size="md" showSubtitle />

              <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                <nav aria-label="Main Navigation" className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs sm:text-sm font-semibold text-slate-600">
                  <Link
                    href="/plan/new"
                    className="px-3 py-1.5 rounded-xl hover:text-navy-950 hover:bg-slate-100/70 transition"
                  >
                    Plan
                  </Link>
                  <Link
                    href="/tax"
                    className="px-3 py-1.5 rounded-xl hover:text-navy-950 hover:bg-slate-100/70 transition"
                  >
                    Tax
                  </Link>
                  <Link
                    href="/learn"
                    className="px-3 py-1.5 rounded-xl hover:text-navy-950 hover:bg-slate-100/70 transition"
                  >
                    Learn
                  </Link>
                  <Link
                    href="/funds/compare"
                    className="px-3 py-1.5 rounded-xl hover:text-navy-950 hover:bg-slate-100/70 transition"
                  >
                    Compare
                  </Link>
                  <Link
                    href="/funds/ask"
                    className="px-3 py-1.5 rounded-xl hover:text-navy-950 hover:bg-slate-100/70 transition"
                  >
                    Ask Funds
                  </Link>
                  <Link
                    href="/cas"
                    className="px-3 py-1.5 rounded-xl hover:text-navy-950 hover:bg-slate-100/70 transition"
                  >
                    CAS Analysis
                  </Link>
                  <CustomerLogin />
                  <Link
                    href="/admin"
                    className="ml-1 px-2.5 py-1 rounded-xl text-teal-800 bg-teal-50/80 border border-teal-200/80 hover:bg-teal-100/80 hover:border-teal-300 transition flex items-center gap-1.5 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-500 animate-ping" />
                    <span className="text-xs font-mono font-bold">Admin</span>
                  </Link>
                </nav>
              </div>
            </div>
            <div className="h-[2px] bg-gradient-to-r from-transparent via-teal-500/50 to-transparent" />
          </header>

          <main id="main" className="w-full flex-1 px-4 sm:px-6 lg:px-8 xl:px-12 py-8">
            {children}
          </main>

          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
