import { getMetaServer } from "@/lib/api";

/** Global compliance footer. Copy comes from the API (config/disclosures.py) so UI and PDF match. */
export default async function Footer() {
  const meta = await getMetaServer();
  return (
    <footer className="border-t border-navy-100 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-navy-700">
        {meta ? (
          <ul className="space-y-1" aria-label="Important disclosures">
            {meta.disclosures.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p role="status">
            Disclosures are temporarily unavailable. Please contact Fund Horizon before relying on any figures shown.
          </p>
        )}
        {meta && <p className="mt-2">Fund data as of {meta.data_asof}.</p>}
      </div>
    </footer>
  );
}
