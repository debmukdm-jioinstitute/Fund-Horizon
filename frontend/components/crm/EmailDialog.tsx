"use client";

import { useEffect, useRef, useState } from "react";
import { fetchHouseholdDetail } from "../../lib/crmApi";
import { CUSTOM, EMAIL_ACCEPT, EMAIL_MAX_BYTES, EMAIL_TEMPLATES, extractEmailFields, isEmail, sendClientEmail, type EmailOutcome } from "../../lib/crmEmail";
import { searchCrm, type SearchResult } from "../../lib/crmListApi";
import { fetchContact } from "../../lib/crmPhase3Api";
import { btnCls, errCls, ghostBtnCls, inputCls, mutedCls } from "./ui";

export interface Recipient { customer_id: string; name: string; email: string | null }
const usable = (r: Recipient) => !!r.email && !r.email.endsWith("@placeholder.invalid");

/** Compose + send an email (optionally with statements attached). Pass `recipients` for a fixed list, or omit to search for clients. */
export default function EmailDialog({ recipients: fixed, filing, onClose, onSent }: { recipients?: Recipient[]; filing?: { id: string; title: string }; onClose: () => void; onSent?: () => void }) {
  const [to, setTo] = useState<Recipient[]>(fixed ?? []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchResult[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [statement, setStatement] = useState(false);
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EmailOutcome | null>(null);
  const first = useRef<HTMLElement | null>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (fixed || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => searchCrm(q.trim()).then((r) => setHits(r.filter((x) => x.type === "contact" || x.type === "household").slice(0, 8))).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, fixed]);

  const addAddress = () => {
    const a = q.trim().toLowerCase();
    setQ(""); setHits([]);
    setTo((cur) => (cur.some((c) => c.customer_id === CUSTOM + a) ? cur : [...cur, { customer_id: CUSTOM + a, name: a, email: a }]));
  };

  const add = async (h: SearchResult) => {
    setQ(""); setHits([]); setError(null);
    try {
      const found: Recipient[] = h.type === "household"
        ? (await fetchHouseholdDetail(h.id)).members.map((m) => ({ customer_id: m.customer_id, name: m.name, email: m.email }))
        : await fetchContact(h.id).then((c) => [{ customer_id: c.customer_id, name: c.name, email: c.email }]);
      setTo((cur) => [...cur, ...found.filter((f) => !cur.some((c) => c.customer_id === f.customer_id))]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load that client"); }
  };

  const pickFiles = (list: FileList | null) => {
    const next = [...files, ...Array.from(list ?? [])];
    if (next.length > 5) return setError("At most 5 attachments.");
    if (next.reduce((n, f) => n + f.size, 0) > EMAIL_MAX_BYTES) return setError("Attachments are over 15 MB in total.");
    setError(null); setFiles(next);
    if (list?.[0]) void autofill(list[0]);
  };

  // Fill only what the user has not typed; the client is added only when search finds exactly one match.
  const autofill = async (f: File) => {
    setReading(true);
    const s = await extractEmailFields(f);
    setReading(false);
    if (!s) return;
    setSubject((cur) => cur || s.subject);
    setMessage((cur) => cur || s.message);
    if (!fixed && s.client_name && !to.length) {
      const m = (await searchCrm(s.client_name).catch(() => [])).filter((x) => x.type === "contact");
      if (m.length === 1) void add(m[0]);
    }
  };

  const sendable = to.filter(usable);
  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await sendClientEmail(sendable.filter((t) => !t.customer_id.startsWith(CUSTOM)).map((t) => t.customer_id), subject.trim(), message.trim(), files, {
        emails: sendable.filter((t) => t.customer_id.startsWith(CUSTOM)).map((t) => t.email as string),
        statement, filingId: filing?.id, sendAt: later && sendAt ? new Date(sendAt).toISOString() : undefined,
      });
      setOutcome(r);
      if (r.sent) onSent?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send"); } finally { setBusy(false); }
  };

  const label = "block text-xs font-semibold mb-1 text-[#181818] dark:text-[#EDF2F7]";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="email-title" className="mt-8 w-full max-w-xl rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#10151C] p-5 shadow-xl">
        <h2 id="email-title" className="text-base font-bold text-[#181818] dark:text-[#EDF2F7]">Email {to.length > 1 ? "clients" : "client"}</h2>

        {outcome ? (
          <div className="mt-3 space-y-2 text-xs" role="status">
            <p className="font-semibold text-[#181818] dark:text-[#EDF2F7]">{outcome.sent} {outcome.scheduled ? "scheduled" : "sent"}{outcome.failed ? `, ${outcome.failed} failed` : ""}. Logged on each client&apos;s timeline.</p>
            {outcome.results.filter((r) => !r.ok).map((r) => <p key={r.customer_id} className={errCls}>{r.name ?? r.customer_id}: {r.error}</p>)}
            <div className="flex justify-end"><button type="button" className={btnCls} onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div>
              <label className={label} htmlFor="em-to">To</label>
              <div className="flex flex-wrap gap-1.5">
                {to.map((r) => (
                  <span key={r.customer_id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${usable(r) ? "border-[#E5E5E5] dark:border-[#2B3644]" : "border-rose-300 text-rose-700 dark:text-rose-300"}`} title={usable(r) ? r.email ?? "" : "No email on file; will be skipped"}>
                    {r.name}{!usable(r) && " (no email)"}
                    {!fixed && <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setTo(to.filter((x) => x !== r))}>×</button>}
                  </span>
                ))}
              </div>
              {!fixed && (
                <div className="relative mt-1.5">
                  <input id="em-to" ref={(el) => { first.current = el; }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a client or household, or type any email address…" className={inputCls} autoComplete="off"
                    onKeyDown={(e) => { if (e.key === "Enter" && isEmail(q)) { e.preventDefault(); addAddress(); } }} />
                  {(hits.length > 0 || isEmail(q)) && (
                    <ul className="absolute z-10 mt-1 w-full rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] shadow-lg">
                      {isEmail(q) && <li><button type="button" onClick={addAddress} className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">Send to <b>{q.trim()}</b> <span className={mutedCls}>any email address</span></button></li>}
                      {hits.map((h) => <li key={`${h.type}-${h.id}`}><button type="button" onClick={() => add(h)} className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]"><b>{h.title}</b> <span className={mutedCls}>{h.type} · {h.subtitle}</span></button></li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={label} htmlFor="em-tpl">Template</label>
              <select id="em-tpl" ref={(el) => { if (fixed) first.current = el; }} className={inputCls} defaultValue="" onChange={(e) => { const t = EMAIL_TEMPLATES.find((x) => x.id === e.target.value); if (t) { setSubject(t.subject); setMessage(t.body); } }}>
                <option value="">Start blank</option>
                {EMAIL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div><label className={label} htmlFor="em-sub">Subject</label><input id="em-sub" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={label} htmlFor="em-msg">Message</label>
              <textarea id="em-msg" rows={8} value={message} maxLength={10000} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
              <p className={`mt-0.5 text-[11px] ${mutedCls}`}>{"{name}"} becomes each client&apos;s first name.</p>
            </div>
            <div>
              <label className={label} htmlFor="em-files">Attachments (statements, PDFs, sheets · up to 5, 15 MB)</label>
              <input id="em-files" type="file" multiple accept={EMAIL_ACCEPT} onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} className="text-xs" />
              {reading && <p role="status" className={`mt-1 text-[11px] ${mutedCls}`}>Reading document…</p>}
              {files.map((f) => <div key={f.name + f.size} className="mt-1 flex items-center gap-2 text-xs">{f.name} <span className={mutedCls}>{(f.size / 1024).toFixed(0)} KB</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button></div>)}
            </div>
            {filing && <p className="text-xs">Attached: filled form “{filing.title}” (PDF)</p>}
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={statement} onChange={(e) => setStatement(e.target.checked)} /> Attach each client&apos;s holdings statement (generated from CRM holdings)</label>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2"><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} /> Send later</label>
              {later && <input type="datetime-local" aria-label="Send at" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className={`${inputCls} w-auto`} />}
              {later && <span className={mutedCls}>up to 30 days ahead</span>}
            </div>
            <p className={`text-[11px] ${mutedCls}`}>Every email includes an unsubscribe link. Clients who opted out are skipped.</p>
            {error && <p role="alert" className={errCls}>{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={ghostBtnCls} onClick={onClose}>Cancel</button>
              <button type="button" className={btnCls} disabled={busy || !sendable.length || !subject.trim() || !message.trim() || (later && !sendAt)} onClick={send}>
                {busy ? "Sending…" : `${later ? "Schedule for" : "Send to"} ${sendable.length}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
