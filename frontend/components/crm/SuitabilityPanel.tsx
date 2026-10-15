// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  assessSuitability, fetchQuestionnaire, fetchSuitabilityStatus, RISKOMETER_LABELS,
  type Assessment, type Questionnaire,
} from "../../lib/crmPhase3Api";
import { fmtDate } from "./EntityLists";
import { btnCls, cardCls, errCls, ghostBtnCls, headCls, mutedCls } from "./ui";
import { useCanWrite } from "./useCanWrite";

/** The client's risk band, the highest riskometer it allows, and the review date; runs the questionnaire. */
export default function SuitabilityPanel({ customerId }: { customerId: string }) {
  const canWrite = useCanWrite();
  const [a, setA] = useState<Assessment | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => fetchSuitabilityStatus(customerId).then((r) => setA(r.assessment)).catch((e) => { setA(null); setError(e instanceof Error ? e.message : "Could not load"); }),
    [customerId],
  );
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setError(null);
    try {
      setQ(await fetchQuestionnaire());
      setAnswers({});
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the questionnaire");
    }
  };

  const submit = async () => {
    if (!q || q.questions.some((x) => answers[x.id] === undefined)) return setError("Answer every question.");
    setBusy(true);
    setError(null);
    try {
      await assessSuitability(customerId, answers);
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the assessment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cardCls} aria-label="Risk profile">
      <div className="flex items-center justify-between gap-2">
        <h2 className={headCls}>Risk profile</h2>
        {canWrite && <button type="button" className={a ? ghostBtnCls : btnCls} onClick={start}>{a ? "Re-assess" : "Run questionnaire"}</button>}
      </div>
      {a === undefined ? (
        <p className={`text-xs mt-2 ${mutedCls}`}>Loading risk profile…</p>
      ) : a ? (
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
          <dt className={mutedCls}>Risk band</dt><dd className="font-semibold">{a.risk_band}</dd>
          <dt className={mutedCls}>Can be sold up to</dt>
          <dd>{a.max_riskometer ? `${RISKOMETER_LABELS[a.max_riskometer]} (${a.max_riskometer}/6)` : "—"}</dd>
          <dt className={mutedCls}>Review due</dt>
          <dd className={a.valid ? "" : "text-rose-700 dark:text-rose-300 font-semibold"}>{fmtDate(a.review_due)}{a.valid ? "" : " — overdue"}</dd>
        </dl>
      ) : (
        <p className={`text-xs mt-2 ${mutedCls}`}>No risk assessment on file. Products above “Low” will show a warning until one is completed.</p>
      )}
      {error && !open && <p role="alert" className={`${errCls} mt-2`}>{error}</p>}

      {open && q && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-label="Risk questionnaire">
          <div className="bg-white dark:bg-[#10151C] rounded-xl border border-[#E5E5E5] dark:border-[#2B3644] shadow-xl w-full max-w-2xl p-6 space-y-4 my-8">
            <h3 className="text-base font-bold text-[#181818] dark:text-[#EDF2F7]">Risk questionnaire</h3>
            {q.questions.map((question, i) => (
              <fieldset key={question.id} className="space-y-1.5">
                <legend className="text-xs font-semibold text-[#181818] dark:text-[#EDF2F7]">{i + 1}. {question.text}</legend>
                {question.options.map((o, idx) => (
                  <label key={idx} className="flex items-start gap-2 text-xs text-[#181818] dark:text-[#EDF2F7]">
                    <input type="radio" name={question.id} checked={answers[question.id] === idx} onChange={() => setAnswers((x) => ({ ...x, [question.id]: idx }))} className="mt-0.5" />
                    {o.text}
                  </label>
                ))}
              </fieldset>
            ))}
            {error && <p role="alert" className={errCls}>{error}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className={ghostBtnCls} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className={btnCls} disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save assessment"}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
