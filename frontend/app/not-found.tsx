// TODO(owner-compliance-review): this file contains user-facing copy.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <div className="card space-y-4">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-navy-100 text-lg font-bold text-navy-900">
          404
        </span>
        <h1 className="text-2xl font-bold">Plan not found</h1>
        <p className="text-navy-700">
          We could not find the requested plan or page. A plan may have expired, or the link may be incomplete.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link href="/" className="btn-secondary">
            Go to the home page
          </Link>
          <Link href="/learn" className="btn-secondary">
            Explore schemes
          </Link>
          <Link href="/plan/new" className="btn-primary">
            Start a new plan
          </Link>
        </div>
      </div>
    </div>
  );
}
