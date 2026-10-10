// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Fund Horizon Planner",
  description: "Illustrative financial planning for your goals, from Fund Horizon.",
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
            <span className="text-sm text-navy-100">Planner</span>
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
