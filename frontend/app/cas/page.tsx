// TODO(owner-compliance-review): this file contains user-facing copy.
import type { Metadata } from "next";
import Link from "next/link";
import CasUpload from "@/components/CasUpload";

export const metadata: Metadata = {
  title: "CAS Portfolio Analysis · Fund Horizon",
  description:
    "Analyze your mutual fund Consolidated Account Statement (CAS) in memory. Check portfolio XIRR, asset allocation vs targets, and direct vs regular plan distribution. ARN 345439.",
};

export default function CasPage() {
  return (
    <div className="w-full space-y-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-xs text-navy-700">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <span className="font-medium text-navy-900">CAS Analysis</span>
          </li>
        </ol>
      </nav>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-navy-950">Consolidated Account Statement (CAS) Analysis</h1>
        <p className="text-navy-700">
          Upload your NSDL, CDSL, CAMS, or KFintech CAS PDF statement. The document is parsed strictly in volatile memory
          to calculate portfolio XIRR, compare your asset mix against standard target profiles, and inspect plan types.
        </p>
      </div>

      <CasUpload />
    </div>
  );
}
