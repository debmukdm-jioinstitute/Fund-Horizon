// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Footer from "@/components/Footer";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://web-production-a0cf3.up.railway.app";

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
    <html lang="en-IN">
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-3">
          Skip to content
        </a>
        <header className="bg-navy-900 text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-teal-500" />
              Fund Horizon
            </Link>
            <div className="flex items-center gap-6">
              <nav aria-label="Main Navigation" className="flex items-center gap-4 text-sm font-medium">
                <Link href="/plan/new" className="text-navy-100 hover:text-white">
                  Plan
                </Link>
                <Link href="/funds/compare" className="text-navy-100 hover:text-white">
                  Compare
                </Link>
                <Link href="/funds/ask" className="text-navy-100 hover:text-white">
                  Ask Funds
                </Link>
                <Link href="/cas" className="text-navy-100 hover:text-white">
                  CAS Analysis
                </Link>
                <Link href="/admin" className="text-navy-100 hover:text-white flex items-center gap-1 font-semibold">
                  <span className="text-[11px] bg-teal-800/80 text-teal-300 border border-teal-600/50 px-2 py-0.5 rounded font-mono">Admin</span>
                </Link>
              </nav>

            </div>
          </div>
          <div className="h-1 bg-teal-500" />
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
