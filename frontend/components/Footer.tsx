// TODO(owner-compliance-review): this file contains user-facing copy.
import { getMetaServer } from "@/lib/api";

/** Global compliance footer. Copy comes from the API (config/disclosures.py) so UI and PDF match. */
export default async function Footer() {
  const meta = await getMetaServer();
  return (
    <footer className="mt-auto border-t border-slate-200/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-200/60">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-navy-950 flex items-center justify-center text-teal-400 text-xs font-black">
              FH
            </div>
            <span className="text-sm font-extrabold tracking-tight text-navy-950">Fund Horizon</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 font-medium">
              AMFI Registered Distributor
            </span>
          </div>
          {meta && (
            <p className="text-xs text-slate-500 font-medium">
              Fund data as of <span className="font-semibold text-slate-700">{meta.data_asof}</span>
            </p>
          )}
        </div>

        <div className="pt-6 text-xs leading-relaxed text-slate-600">
          {meta ? (
            <ul className="space-y-1.5" aria-label="Important disclosures">
              {meta.disclosures.lines.map((l) => (
                <li key={l} className="flex items-start gap-2">
                  <span className="text-teal-600 font-bold select-none">•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status" className="text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200">
              Disclosures are temporarily unavailable. Please contact Fund Horizon before relying on any figures shown.
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
