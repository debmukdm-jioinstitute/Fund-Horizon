"use client";

import { useEffect, useRef, useState } from "react";
import { fetchHouseholdDetail } from "../../lib/crmApi";
import { CUSTOM, EMAIL_ACCEPT, EMAIL_MAX_BYTES, EMAIL_TEMPLATES, extractEmailFields, isEmail, sendClientEmail, type EmailOutcome } from "../../lib/crmEmail";
import { searchCrm, type SearchResult } from "../../lib/crmListApi";
import { fetchContact } from "../../lib/crmPhase3Api";
import { btnCls, errCls, ghostBtnCls, mutedCls } from "./ui";

export interface Recipient { customer_id: string; name: string; email: string | null }
const usable = (r: Recipient) => !!r.email && !r.email.endsWith("@placeholder.invalid");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textToHtml = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

/** Compose + send an email (optionally with statements attached). Pass `recipients` for a fixed list, or omit to search for clients.
 *  This is the "New message" window opened from the backoffice header email icon (and every other compose entry point). */
export default function EmailDialog({ recipients: fixed, filing, onClose, onSent }: { recipients?: Recipient[]; filing?: { id: string; title: string }; onClose: () => void; onSent?: () => void }) {
  const [to, setTo] = useState<Recipient[]>(fixed ?? []);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchResult[]>([]);
  const [subject, setSubject] = useState("");
  const [plain, setPlain] = useState("");
  const [templateId, setTemplateId] = useState("blank");
  const [files, setFiles] = useState<File[]>([]);
  const [statement, setStatement] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EmailOutcome | null>(null);
  const [minimised, setMinimised] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [colour, setColour] = useState("#181818");

  const editorRef = useRef<HTMLDivElement | null>(null);
  const toInputRef = useRef<HTMLInputElement | null>(null);
  const templateBtnRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const fixedRef = useRef(fixed);

  const dirty = !!subject || !!plain || files.length > 0 || statement || !!sendAt ||
    (fixed ? to.map((r) => r.customer_id).join(",") !== fixed.map((r) => r.customer_id).join(",") : to.length > 0);

  const closeWithCheck = () => {
    if (outcome || !dirty) { onClose(); return; }
    if (window.confirm("Discard this draft?")) onClose();
  };

  useEffect(() => { if (fixedRef.current) templateBtnRef.current?.focus(); else toInputRef.current?.focus(); }, []); // once: onClose is a new function each render
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeWithCheck(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (fixed || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => searchCrm(q.trim()).then((r) => setHits(r.filter((x) => x.type === "contact" || x.type === "household").slice(0, 8))).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, fixed]);

  const syncPlain = () => setPlain(editorRef.current?.innerText ?? "");
  const setEditorText = (text: string) => {
    if (editorRef.current) editorRef.current.innerHTML = textToHtml(text);
    setPlain(text);
  };
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      try { sel.removeAllRanges(); sel.addRange(savedRangeRef.current.cloneRange()); return true; } catch { return false; }
    }
    return false;
  };
  const focusEditorEnd = () => {
    const ed = editorRef.current; if (!ed) return;
    ed.focus();
    const sel = window.getSelection(); if (!sel) return;
    sel.selectAllChildren(ed); sel.collapseToEnd();
  };
  const insertFirstName = () => {
    const ed = editorRef.current; if (!ed) return;
    ed.focus();
    if (!restoreRange()) focusEditorEnd();
    document.execCommand("insertText", false, "{name}");
    syncPlain();
  };
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    syncPlain();
  };
  const wrapSpan = (style: string) => {
    const ed = editorRef.current; if (!ed) return;
    ed.focus(); restoreRange();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.setAttribute("style", style);
    try { range.surroundContents(span); } catch { span.appendChild(range.extractContents()); range.insertNode(span); }
    sel.removeAllRanges(); syncPlain();
  };
  const insertLink = () => {
    const url = window.prompt("Link address (must start with http:// or https://)");
    if (url === null) return;
    if (!/^https?:\/\//i.test(url.trim())) { setError("Links must start with http:// or https://."); return; }
    setError(null);
    editorRef.current?.focus(); restoreRange();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${escapeHtml(url.trim())}">${escapeHtml(url.trim())}</a>`);
    else document.execCommand("createLink", false, url.trim());
    syncPlain();
  };
  const insertImage = () => {
    const url = window.prompt("Image address (must start with https://)");
    if (url === null) return;
    if (!/^https:\/\//i.test(url.trim())) { setError("Images must use an https:// address."); return; }
    setError(null);
    editorRef.current?.focus(); restoreRange();
    document.execCommand("insertImage", false, url.trim());
    syncPlain();
  };

  const addAddress = () => {
    const a = q.trim().replace(/,$/, "").toLowerCase();
    if (!isEmail(a)) return;
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
    if (!plain) setEditorText(s.message);
    if (!fixed && s.client_name && !to.length) {
      const m = (await searchCrm(s.client_name).catch(() => [])).filter((x) => x.type === "contact");
      if (m.length === 1) void add(m[0]);
    }
  };

  const chooseTemplate = (id: string) => {
    setTemplateOpen(false);
    if (id === "blank") { setTemplateId("blank"); setSubject(""); setEditorText(""); return; }
    const t = EMAIL_TEMPLATES.find((x) => x.id === id);
    if (t) { setTemplateId(id); setSubject(t.subject); setEditorText(t.body); }
  };

  const sendable = to.filter(usable);
  const send = async () => {
    const ed = editorRef.current;
    const text = (ed?.innerText ?? plain).trim();
    const html = ed?.innerHTML ?? "";
    if (text.length > 10000) return setError("Message is over 10,000 characters.");
    if (html.length > 50000) return setError("Formatted message is over 50,000 characters.");
    setBusy(true); setError(null);
    try {
      const r = await sendClientEmail(sendable.filter((t) => !t.customer_id.startsWith(CUSTOM)).map((t) => t.customer_id), subject.trim(), text, files, {
        emails: sendable.filter((t) => t.customer_id.startsWith(CUSTOM)).map((t) => t.email as string),
        statement, filingId: filing?.id, sendAt: showSchedule && sendAt ? new Date(sendAt).toISOString() : undefined,
        messageHtml: html.trim() ? html : undefined,
      });
      setOutcome(r);
      if (r.sent) onSent?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send"); } finally { setBusy(false); }
  };

  const toolBtn = "flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-semibold text-[#181818] dark:text-[#EDF2F7] hover:bg-[#EAF1F8] dark:hover:bg-[#1D2733]";
  const toolSelect = "h-7 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-1 text-xs text-[#181818] dark:text-[#EDF2F7]";

  if (minimised) {
    return (
      <button type="button" onClick={() => setMinimised(false)} className="fixed bottom-4 right-4 z-50 rounded-full bg-[#EAF1F8] dark:bg-[#171E27] px-4 py-2 text-sm font-semibold text-[#181818] dark:text-[#EDF2F7] shadow-xl ring-1 ring-[#C9D6E8] dark:ring-[#2B3644]">
        New message
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#DCE6F1] dark:bg-black/60 p-2 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && closeWithCheck()}>
      <div role="dialog" aria-modal="true" aria-labelledby="email-title" className={`mx-auto w-full ${maximised ? "max-w-[1100px]" : "max-w-[880px]"} rounded-2xl bg-white dark:bg-[#10151C] shadow-xl ring-1 ring-[#C9D6E8] dark:ring-[#2B3644]`}>
        <div className="flex items-start justify-between rounded-t-2xl bg-[#EAF1F8] dark:bg-[#171E27] px-5 py-3">
          <div>
            <h2 id="email-title" className="text-lg font-bold text-[#181818] dark:text-[#EDF2F7]">New message</h2>
            <p className={`text-xs ${mutedCls}`}>Fund Horizon</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Minimise" title="Minimise" onClick={() => setMinimised(true)} className={toolBtn}>—</button>
            <button type="button" aria-label={maximised ? "Restore size" : "Expand"} title={maximised ? "Restore size" : "Expand"} onClick={() => setMaximised((v) => !v)} className={toolBtn}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 3H3v5M21 8V3h-5M3 16v5h5M16 21h5v-5" /></svg>
            </button>
            <button type="button" aria-label="Close" title="Close" onClick={closeWithCheck} className={toolBtn}>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {outcome ? (
          <div className="space-y-2 px-5 py-4 text-xs" role="status">
            <p className="font-semibold text-[#181818] dark:text-[#EDF2F7]">{outcome.sent} {outcome.scheduled ? "scheduled" : "sent"}{outcome.failed ? `, ${outcome.failed} failed` : ""}. Logged on each client&apos;s timeline.</p>
            {outcome.results.filter((r) => !r.ok).map((r) => <p key={r.customer_id} className={errCls}>{r.name ?? r.customer_id}: {r.error}</p>)}
            <div className="flex justify-end"><button type="button" className={btnCls} onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <div className="px-5 pb-4 pt-1">
            <div className="flex items-start gap-2 border-b border-[#E5E5E5] dark:border-[#2B3644] py-2.5">
              <span className="w-8 shrink-0 pt-1 text-sm text-[#181818] dark:text-[#EDF2F7]">To</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  {to.map((r) => (
                    <span key={r.customer_id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${usable(r) ? "border-[#E5E5E5] dark:border-[#2B3644]" : "border-rose-300 text-rose-700 dark:text-rose-300"}`} title={usable(r) ? r.email ?? "" : "No email on file; will be skipped"}>
                      {r.name}{!usable(r) && " (no email)"}
                      {!fixed && <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setTo(to.filter((x) => x !== r))}>×</button>}
                    </span>
                  ))}
                </div>
                {!fixed && (
                  <div className="relative mt-1">
                    <input id="em-to" ref={toInputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients, households or enter email" className="w-full min-w-0 bg-transparent text-sm text-[#181818] dark:text-[#EDF2F7] outline-none placeholder:text-[#706E6B]" autoComplete="off"
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && isEmail(q.trim().replace(/,$/, ""))) { e.preventDefault(); addAddress(); } }} />
                    {(hits.length > 0 || isEmail(q.trim().replace(/,$/, ""))) && (
                      <ul className="absolute left-0 right-0 z-30 mt-1 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] shadow-lg">
                        {isEmail(q.trim().replace(/,$/, "")) && <li><button type="button" onClick={addAddress} className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">Send to <b>{q.trim().replace(/,$/, "")}</b> <span className={mutedCls}>any email address</span></button></li>}
                        {hits.map((h) => <li key={`${h.type}-${h.id}`}><button type="button" onClick={() => add(h)} className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]"><b>{h.title}</b> <span className={mutedCls}>{h.type} · {h.subtitle}</span></button></li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <span className={`shrink-0 pt-1 text-xs ${mutedCls}`}>{to.length} recipients</span>
            </div>
            <p className={`py-1.5 text-xs ${mutedCls}`}>Each client receives a separate email.</p>

            <div className="border-b border-[#E5E5E5] dark:border-[#2B3644]">
              <input aria-label="Subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full bg-transparent py-2.5 text-sm text-[#181818] dark:text-[#EDF2F7] outline-none placeholder:text-[#706E6B]" />
            </div>

            <div className="flex flex-wrap items-center gap-2 py-3">
              <div className="relative">
                <button type="button" ref={templateBtnRef} onClick={() => setTemplateOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={templateOpen} className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-3 py-1.5 text-xs text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Template: {templateId === "blank" ? "Start blank" : EMAIL_TEMPLATES.find((t) => t.id === templateId)?.label ?? "Start blank"}
                  <span aria-hidden>▾</span>
                </button>
                {templateOpen && (
                  <ul role="listbox" className="absolute left-0 z-30 mt-1 w-56 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] shadow-lg">
                    <li><button type="button" onClick={() => chooseTemplate("blank")} className="w-full px-3 py-2 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">Start blank</button></li>
                    {EMAIL_TEMPLATES.map((t) => <li key={t.id}><button type="button" onClick={() => chooseTemplate(t.id)} className="w-full px-3 py-2 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">{t.label}</button></li>)}
                  </ul>
                )}
              </div>
              <button type="button" onClick={insertFirstName} className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-3 py-1.5 text-xs text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">
                <span aria-hidden>{"{ }"}</span> Insert first name
              </button>
            </div>

            <div className="relative">
              <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-label="Message" spellCheck
                className="min-h-[240px] w-full break-words px-1 py-2 text-sm text-[#181818] dark:text-[#EDF2F7] outline-none sm:min-h-[300px]"
                onInput={syncPlain} onMouseUp={saveRange} onKeyUp={saveRange} onSelect={saveRange} />
              {!plain && <span className={`pointer-events-none absolute left-1 top-2 text-sm ${mutedCls}`}>Write your message...</span>}
            </div>
            <p className={`text-[11px] ${mutedCls}`}>{"{name}"} becomes each client&apos;s first name.</p>

            <div className="mt-2 flex flex-wrap items-center gap-1 rounded-lg border border-[#E5E5E5] dark:border-[#2B3644] px-2 py-1.5">
              <select aria-label="Font" className={toolSelect} defaultValue="sans" onChange={(e) => wrapSpan(`font-family: ${e.target.value}`)}>
                <option value="Arial, Helvetica, sans-serif">Sans Serif</option>
                <option value="Georgia, serif">Serif</option>
                <option value="ui-monospace, monospace">Monospace</option>
              </select>
              <select aria-label="Font size" className={toolSelect} defaultValue="14px" onChange={(e) => wrapSpan(`font-size: ${e.target.value}`)}>
                <option value="12px">Small</option>
                <option value="14px">Normal</option>
                <option value="18px">Large</option>
                <option value="24px">Huge</option>
              </select>
              <button type="button" aria-label="Bold" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} className={`${toolBtn} font-bold`}>B</button>
              <button type="button" aria-label="Italic" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} className={`${toolBtn} italic`}>I</button>
              <button type="button" aria-label="Underline" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} className={`${toolBtn} underline`}>U</button>
              <label className={`${toolBtn} cursor-pointer`} title="Text colour">
                <span className="underline decoration-2">A</span>
                <input type="color" aria-label="Text colour" value={colour} onChange={(e) => { setColour(e.target.value); wrapSpan(`color: ${e.target.value}`); }} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" />
              </label>
              <select aria-label="Alignment" className={toolSelect} defaultValue="left" onChange={(e) => { restoreRange(); exec({ left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[e.target.value] ?? "justifyLeft"); }}>
                <option value="left">Align left</option>
                <option value="center">Align centre</option>
                <option value="right">Align right</option>
                <option value="justify">Justify</option>
              </select>
              <button type="button" aria-label="Bullet list" title="Bullet list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} className={toolBtn}>• ―</button>
              <button type="button" aria-label="Numbered list" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} className={toolBtn}>1. ―</button>
              <button type="button" aria-label="Add link" title="Add link" onMouseDown={(e) => e.preventDefault()} onClick={insertLink} className={toolBtn}>🔗</button>
              <button type="button" aria-label="Clear formatting" title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")} className={toolBtn}>Tₓ</button>
            </div>

            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg bg-[#EAF1F8] dark:bg-[#11304F] px-3 py-2.5">
              <input type="checkbox" checked={statement} onChange={(e) => setStatement(e.target.checked)} className="mt-0.5" />
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span>
                <span className="block text-xs font-medium text-[#181818] dark:text-[#EDF2F7]">Attach each client&apos;s holdings statement</span>
                <span className={`block text-[11px] ${mutedCls}`}>Generated separately from CRM holdings.</span>
              </span>
            </label>
            <p className={`mt-2 text-xs ${mutedCls}`}>Attachments: up to 5 files · 15 MB limit</p>
            {filing && <p className="mt-1 text-xs">Attached: filled form “{filing.title}” (PDF)</p>}
            {reading && <p role="status" className={`mt-1 text-[11px] ${mutedCls}`}>Reading document…</p>}
            {files.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <span key={f.name + f.size} className="inline-flex items-center gap-1 rounded-full border border-[#E5E5E5] dark:border-[#2B3644] px-2 py-0.5 text-xs">
                    {f.name} <span className={mutedCls}>{fmtSize(f.size)}</span>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>
                  </span>
                ))}
              </div>
            )}

            {showSchedule && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-[#E5E5E5] dark:border-[#2B3644] p-3 text-xs">
                <label className="flex items-center gap-2">Send at
                  <input type="datetime-local" aria-label="Send at" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className="rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] px-2 py-1 text-xs text-[#181818] dark:text-[#EDF2F7]" />
                </label>
                <span className={mutedCls}>Between 1 minute and 30 days ahead.</span>
              </div>
            )}

            {error && <p role="alert" className={`${errCls} mt-2`}>{error}</p>}

            <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[#E5E5E5] dark:border-[#2B3644] pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <div>
                  <div className="relative flex">
                    <button type="button" className={`${btnCls} rounded-r-none px-4 py-2 text-sm`} disabled={busy || !sendable.length || !subject.trim() || !plain.trim() || (showSchedule && !sendAt)} onClick={send}>
                      {busy ? "Sending…" : showSchedule && sendAt ? "Schedule send" : "Send"}
                    </button>
                    <button type="button" aria-label="Send options" aria-expanded={sendMenuOpen} onClick={() => setSendMenuOpen((v) => !v)} className={`${btnCls} rounded-l-none border-l border-white/30 px-2 py-2 text-sm`}>
                      <span aria-hidden>▾</span>
                    </button>
                    {sendMenuOpen && (
                      <div className="absolute bottom-full left-0 z-30 mb-1 w-40 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] shadow-lg">
                        <button type="button" onClick={() => { setSendMenuOpen(false); setShowSchedule(true); }} className="block w-full px-3 py-2 text-left text-xs text-[#181818] dark:text-[#EDF2F7] hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">Schedule send</button>
                      </div>
                    )}
                  </div>
                  {to.length === 0 && <p className={`mt-1 text-[11px] ${mutedCls}`}>Add a recipient to send</p>}
                </div>
                <button type="button" onClick={() => setShowSchedule((v) => !v)} className={ghostBtnCls} title="Schedule send">
                  <span className="inline-flex items-center gap-1.5">🕐 Schedule send</span>
                </button>
                <input ref={fileInputRef} type="file" multiple accept={EMAIL_ACCEPT} className="hidden" onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
                <button type="button" aria-label="Attach files" title="Attach files" onClick={() => fileInputRef.current?.click()} className={toolBtn}>📎</button>
                <button type="button" aria-label="Add link" title="Add link" onClick={insertLink} className={toolBtn}>🔗</button>
                <button type="button" aria-label="Insert image" title="Insert image" onClick={insertImage} className={toolBtn}>🖼️</button>
                <div className="relative">
                  <button type="button" aria-label="More actions" title="More actions" onClick={() => setMoreMenuOpen((v) => !v)} className={toolBtn}>⋮</button>
                  {moreMenuOpen && (
                    <div className="absolute bottom-full right-0 z-30 mb-1 w-56 rounded border border-[#E5E5E5] dark:border-[#2B3644] bg-white dark:bg-[#171E27] shadow-lg">
                      <button type="button" onClick={() => { setMoreMenuOpen(false); insertFirstName(); }} className="block w-full px-3 py-2 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">Insert first name</button>
                      <button type="button" onClick={() => { setMoreMenuOpen(false); setStatement((v) => !v); }} className="block w-full px-3 py-2 text-left text-xs hover:bg-[#F0F4F8] dark:hover:bg-[#1D2733]">{statement ? "✓ " : ""}Attach holdings statement</button>
                    </div>
                  )}
                </div>
              </div>
              <button type="button" onClick={closeWithCheck} className={ghostBtnCls} title="Discard draft">
                <span className="inline-flex items-center gap-1.5">🗑 Discard</span>
              </button>
            </div>
            <p className={`mt-2 text-[11px] ${mutedCls}`}>ⓘ Unsubscribe link included. Opted-out clients are skipped.</p>
          </div>
        )}
      </div>
    </div>
  );
}
