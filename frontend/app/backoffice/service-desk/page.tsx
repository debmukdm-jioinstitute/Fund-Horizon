"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHouseholds } from "@/lib/crmApi";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { CATEGORIES, STATUSES, createQuery, dmy, listQueries, reportTracker, setQueryStatus, type Category, type ReportTracker, type ServiceQuery, type Status } from "@/lib/serviceDesk";

const card = "rounded-[10px] border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#171E2A]";
const muted = "text-[#667085] dark:text-[#9AA6B8]";
const ink = "text-[#172033] dark:text-[#EDF1F6]";
const input = "w-full rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] bg-white dark:bg-[#0F1621] px-3 py-2.5 text-[14px] text-[#172033] dark:text-[#EDF1F6]";
const btn = "inline-flex min-h-[40px] items-center justify-center rounded-lg border border-[#E4E9EF] dark:border-[#2B3644] px-3 py-1.5 text-[12.5px] font-semibold text-[#172033] dark:text-[#EDF1F6] hover:border-[#006F64]";
const primary = "inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[#006F64] px-5 py-2 text-[14px] font-semibold text-white hover:bg-[#00554D] disabled:opacity-50";
const LINKS = [
  ["PMS tracker", "/backoffice/pms"], ["Recommended mutual funds", "/backoffice/mutual-funds?rec=1"], ["Recommended PMS", "/backoffice/pms?approach=fh-recommended"],
  ["Mutual fund overlap", "/backoffice/mutual-funds/tools"], ["Investment proposal", "/backoffice/mutual-funds/proposal"],
  ["Monthly report", "/backoffice/operations#report"], ["Portfolio review", "/backoffice/operations#review"], ["Sent emails", "/backoffice/operations/emails"],
] as const;

// Browser speech recognition (Chrome, Edge, Safari). Absent elsewhere: typing keeps working.
type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: (e: { error?: string }) => void; start: () => void; stop: () => void };
const speechCtor = (): (new () => Rec) | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export default function ServiceDeskPage() {
  const [rows, setRows] = useState<ServiceQuery[]>([]);
  const [tracker, setTracker] = useState<ReportTracker | null>(null);
  const [clients, setClients] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [other, setOther] = useState("");
  const [details, setDetails] = useState("");
  const [viaVoice, setViaVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Status>("incoming");
  const rec = useRef<Rec | null>(null);

  const load = useCallback(() => {
    listQueries(DEFAULT_PAGE_SIZE).then((r) => { setRows(r.rows); setError(null); }).catch((e) => setError(e.message));
    reportTracker().then(setTracker).catch(() => setTracker(null));
  }, []);
  useEffect(() => { load(); setCanSpeak(!!speechCtor()); fetchHouseholds().then((h) => setClients(h.map((x) => x.name))).catch(() => undefined); }, [load]);
  useEffect(() => () => rec.current?.stop(), []);

  const dictate = () => {
    if (listening) return rec.current?.stop();
    const R = speechCtor();
    if (!R) return;
    const r = new R();
    r.lang = "en-IN"; r.interimResults = false; r.continuous = true;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim(); if (t) { setDetails((d) => `${d}${d ? " " : ""}${t}`); setViaVoice(true); } };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone blocked. Allow it from the lock icon in the address bar, then try again. You can type instead."
        : e.error === "audio-capture" ? "No microphone found. You can type instead."
        : "Voice dictation needs an internet connection. You can type instead.");
    };
    rec.current = r; setListening(true); r.start();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) return setError("Choose what kind of service this is.");
    setBusy(true);
    try {
      await createQuery({ client_name: name, category, other_text: other, details, source: viaVoice ? "voice" : "typed" });
      setName(""); setCategory(""); setOther(""); setDetails(""); setViaVoice(false); setView("incoming"); setError(null); load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); } finally { setBusy(false); }
  };
  const move = (id: string, s: Status) => setQueryStatus(id, s).then(load).catch((e) => setError(e.message));
  const shown = rows.filter((r) => r.status === view);
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  const catLabel = (r: ServiceQuery) => (r.category === "other" ? `Other: ${r.other_text}` : CATEGORIES.find((c) => c.id === r.category)?.label);

  return (
    <div className="space-y-4 pb-12">
      <div className={`${card} px-4 py-4 sm:px-5`}>
        <h1 className={`text-2xl font-bold tracking-tight ${ink}`}>Service desk</h1>
      </div>
      {error && <p role="alert" className="text-[13px] text-[#B42318] dark:text-[#FF7D86]">{error}</p>}

      <form onSubmit={submit} className={`${card} space-y-3 px-4 py-4 sm:px-5`} aria-label="New service query">
        <h2 className={`text-[15px] font-bold ${ink}`}>New service query</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`block text-[12.5px] font-semibold ${muted}`}>Client name
            <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} list="sd-clients" required maxLength={120} autoComplete="off" />
            <datalist id="sd-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className={`block text-[12.5px] font-semibold ${muted}`}>Type of service
            <select className={`${input} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as Category)} required>
              <option value="" disabled>Select…</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        </div>
        {category === "other" && (
          <label className={`block text-[12.5px] font-semibold ${muted}`}>Describe the service
            <input className={`${input} mt-1`} value={other} onChange={(e) => setOther(e.target.value)} required maxLength={200} />
          </label>
        )}
        <label className={`block text-[12.5px] font-semibold ${muted}`}>Details (speak or type)
          <textarea className={`${input} mt-1 min-h-[96px]`} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} />
        </label>
        <div className="flex flex-wrap gap-2">
          {canSpeak && <button type="button" onClick={dictate} aria-pressed={listening} className={btn}>{listening ? "Stop dictation" : "Dictate with voice"}</button>}
          <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : "Save query"}</button>
        </div>
      </form>

      <div className={`${card} px-4 py-4 sm:px-5`}>
        <div role="tablist" className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button key={s.id} role="tab" aria-selected={view === s.id} onClick={() => setView(s.id)}
              className={`${btn} ${view === s.id ? "!border-[#006F64] !text-[#006F64] dark:!text-[#75E1CE]" : ""}`}>{s.label} ({count(s.id)})</button>
          ))}
        </div>
        <ul className="mt-3 divide-y divide-[#E4E9EF] dark:divide-[#2B3644]">
          {shown.length === 0 && <li className={`py-6 text-center text-[13.5px] ${muted}`}>Nothing here.</li>}
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className={`text-[14px] font-semibold ${ink}`}>{r.client_name} <span className={`font-normal ${muted}`}>· {catLabel(r)}</span></p>
                {r.details && <p className={`mt-0.5 break-words text-[13px] ${muted}`}>{r.details}</p>}
                <p className={`mt-0.5 text-[11.5px] ${muted}`}>Logged {dmy(r.created_at)}{r.source === "voice" ? " by voice" : ""}{r.completed_at ? ` · Completed ${dmy(r.completed_at)}` : ""}</p>
              </div>
              <div className="flex gap-2">
                {r.status === "incoming" && <button className={btn} onClick={() => move(r.id, "in_progress")}>Start</button>}
                {r.status !== "completed" && <button className={btn} onClick={() => move(r.id, "completed")}>Mark completed</button>}
                {r.status === "completed" && <button className={btn} onClick={() => move(r.id, "incoming")}>Reopen</button>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${card} px-4 py-4 sm:px-5`}>
        <h2 className={`text-[15px] font-bold ${ink}`}>Monthly portfolio review reports</h2>
        {tracker ? (
          <div className="mt-2 space-y-2 text-[13.5px]">
            <p className={ink}>{tracker.report_month} reports: finalize by <b>{dmy(tracker.finalize_by)}</b>, send by <b>{dmy(tracker.send_by)}</b> (hard limit {dmy(tracker.hard_deadline)}, {tracker.days_left >= 0 ? `${tracker.days_left} days left` : "overdue"}).</p>
            <p className={muted}>Generated: {tracker.generated} · Emailed: {tracker.emailed} · Not yet emailed: {tracker.unsent.length}</p>
            {tracker.unsent.length > 0 && <p className="text-[#9A6700] dark:text-[#F5C451]">Not yet emailed: {tracker.unsent.map((u) => u.name).join(", ")}</p>}
          </div>
        ) : <p className={`mt-2 text-[13.5px] ${muted}`}>Tracker unavailable right now.</p>}
        <Link href="/backoffice/operations#report" className={`${btn} mt-3`}>Open monthly report</Link>
      </div>

      <div className={`${card} px-4 py-4 sm:px-5`}>
        <h2 className={`text-[15px] font-bold ${ink}`}>Tools</h2>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LINKS.map(([l, h]) => <Link key={h} href={h} className={btn}>{l}</Link>)}
        </div>
      </div>
    </div>
  );
}
