"use client";

import React, { useEffect, useState } from "react";
import { getFhMethodology, type FhExplain, type FhFilter, type FhMethodology, type MfScreenerRow } from "@/lib/backoffice";
import { useRecommended } from "@/lib/recommended";
import { formatISTDate } from "@/lib/terminal-format";

const f = (v: number | null | undefined, d = 1) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "n/a");
const sign = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? `+${v.toFixed(1)}` : f(v));
const STATUS: Record<string, string> = {
  auto: "Automatically recommended (score-driven)",
  manual_include: "Manually included",
  manual_exclude: "Manually excluded",
  blocked: "Score qualifies but a rule blocks automatic inclusion",
  none: "Not recommended",
};
const BADGE: Record<FhFilter["status"], string> = {
  ok: "",
  insufficient: "bg-[#FFF4D6] text-[#7A5600] dark:bg-[#3A2E0A] dark:text-[#FBBF24]",
  unconfigured: "bg-[#FDE7E9] text-[#9B1C2E] dark:bg-[#3A1519] dark:text-[#FFA9B5]",
};

function FilterRow({ fl }: { fl: FhFilter }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-2 py-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-baseline justify-between gap-2 text-left cursor-pointer">
        <span>
          {fl.label}
          {fl.status !== "ok" && <span className={`ml-1.5 rounded px-1 text-[10px] uppercase ${BADGE[fl.status]}`}>{fl.status === "unconfigured" ? "provisional" : "insufficient data"}</span>}
        </span>
        <span className="tabular-nums font-medium whitespace-nowrap">
          {f(fl.points)} / {fl.weight}
          <span className="ml-1 text-[11px] font-normal text-[#706E6B] dark:text-[#A8B4C4]">raw {f((fl.raw ?? NaN) * 100, 0)}% · data {f((fl.coverage ?? NaN) * 100, 0)}%</span>
        </span>
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
          {fl.components.map((c) => (
            <li key={c.label} className="flex justify-between gap-2">
              <span>
                {c.label}
                {c.threshold != null && ` (must exceed ${c.threshold})`}
                {c.note ? ` · ${c.note}` : ""}
              </span>
              <span className="tabular-nums whitespace-nowrap">
                {c.value == null ? "not available" : f(c.value, 2)}
                {c.pass != null && <span className={c.pass ? " text-[#2E844A]" : " text-[#B42332]"}>{c.pass ? " ✓" : " ✗"}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function FhScorePanel({ fh, row }: { fh: FhExplain; row: MfScreenerRow }) {
  const rec = useRecommended();
  const [meth, setMeth] = useState<FhMethodology | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getFhMethodology().then(setMeth).catch(() => setMeth(null)); }, []);
  const recommended = rec.isMfRecommended(row.code);
  const status = String(row.fh_status ?? "none");
  const toggle = async () => { setBusy(true); try { await rec.toggleMf(row.code, row.name); } finally { setBusy(false); } };
  return (
    <div className="space-y-3">
      <section>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[22px] font-semibold tabular-nums">{f(fh.score)}</span>
          <span>/ 100</span>
          <span>{fh.rating ? `${fh.rating}/5 rating` : "Not rated"}</span>
          {fh.signal && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-bold ${
                fh.signal === "Buy"
                  ? "bg-[#ECFDF3] text-[#027A48] dark:bg-[#0C2B28] dark:text-[#75E1CE] border border-[#A6F4C5] dark:border-[#124B3F]"
                  : fh.signal === "Hold"
                  ? "bg-[#FFFAEB] text-[#B54708] dark:bg-[#2D2006] dark:text-[#FDB022] border border-[#FEDF89] dark:border-[#4E370B]"
                  : fh.signal === "Sell"
                  ? "bg-[#FEF3F2] text-[#B42318] dark:bg-[#331114] dark:text-[#FDA29B] border border-[#FECDCA] dark:border-[#7A271A]"
                  : "bg-[#F2F4F7] text-[#475467] dark:bg-[#1D2939] dark:text-[#98A2B3] border border-[#D0D5DD] dark:border-[#344054]"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {fh.signal}
            </span>
          )}
          <span className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">data coverage {f((fh.coverage ?? NaN) * 100, 0)}%</span>
        </div>
        {fh.signal_reasons && fh.signal_reasons.length > 0 && (
          <div className="mt-2 rounded-lg bg-[#F8FAFC] dark:bg-[#111A24] border border-[#E5E5E5] dark:border-[#2B3644] p-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#706E6B] dark:text-[#A8B4C4] mb-1">
              Screening Evidence
            </div>
            <ul className="space-y-1 text-[12.5px] text-[#344054] dark:text-[#D0D5DD]">
              {fh.signal_reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-[#0176D3] dark:text-[#1B96FF]">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[12px]">{STATUS[status] ?? STATUS.none}.</p>
        <button type="button" disabled={busy} onClick={toggle} className="terminal-btn mt-1.5 text-[12px] py-1 px-2.5">
          {recommended ? "Exclude from FH Recommended" : "Add to FH Recommended"}
        </button>
        <p className="mt-1 text-[11px] text-[#706E6B] dark:text-[#A8B4C4]">Manual choices are saved and are never undone by automatic refreshes.</p>
      </section>

      <section>
        <h3 className="font-semibold">Filters (raw score × weight = points)</h3>
        <ul className="mt-1 divide-y divide-[#E5E5E5] dark:divide-[#2B3644] border border-[#E5E5E5] dark:border-[#2B3644] rounded">
          {fh.filters.map((fl) => <FilterRow key={fl.key} fl={fl} />)}
        </ul>
        <p className="mt-1 text-[12px]">
          Base {f(fh.base)} · penalties {sign(fh.penalty_total)} · consistency adjustment {sign(fh.adjustment.total)} (bonus {sign(fh.adjustment.bonus)}, weak filters {sign(fh.adjustment.malus)}) → <strong>{f(fh.score)}</strong> (bounded 0 to 100).
        </p>
        {fh.penalties.some((p) => p.points) && (
          <p className="text-[12px] text-[#706E6B] dark:text-[#A8B4C4]">
            Penalties: {fh.penalties.filter((p) => p.points).map((p) => `${p.key} ${sign(p.points)}`).join(", ")}.
          </p>
        )}
      </section>

      {fh.flags.length > 0 && (
        <section>
          <h3 className="font-semibold">Flags</h3>
          <ul className="list-disc pl-4 space-y-0.5">{fh.flags.map((x) => <li key={x.code}>{x.text}</li>)}</ul>
        </section>
      )}
      {fh.blockers.length > 0 && (
        <section>
          <h3 className="font-semibold">Why it is not automatically recommended</h3>
          <ul className="list-disc pl-4 space-y-0.5">{fh.blockers.map((x) => <li key={x.code}>{x.text}</li>)}</ul>
        </section>
      )}

      <details className="text-[12px]">
        <summary className="cursor-pointer font-semibold text-[13px]">Methodology, data sources and freshness</summary>
        <div className="mt-1 space-y-1.5">
          {meth && (
            <>
              <p>Weights: {Object.entries(meth.weights).map(([k, v]) => `${meth.filters[k] ?? k} ${v}`).join(" · ")}. Auto-recommend at {meth.config.recommend.threshold}+ with {Math.round(meth.config.recommend.min_coverage * 100)}%+ data.</p>
              <ul className="list-disc pl-4">
                {meth.sources.map((s) => <li key={s.name}>{s.name}: {s.source}. Last updated {s.as_of ? formatISTDate(s.as_of) : "not recorded"}.</li>)}
              </ul>
              <p>Refresh: {meth.refresh.cadence}. Next run: {meth.refresh.next_run_ist}.</p>
            </>
          )}
          <p className="font-semibold">Provisional definitions awaiting confirmation</p>
          <ul className="list-disc pl-4">{fh.provisional.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </details>
    </div>
  );
}
