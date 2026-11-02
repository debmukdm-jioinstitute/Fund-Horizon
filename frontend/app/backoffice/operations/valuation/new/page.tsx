"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createHousehold, fetchHouseholdDetail, fetchHouseholds, type Household, type HouseholdMember } from "@/lib/crmApi";
import { createContact } from "@/lib/crmPhase3Api";
import { PROVIDER_LABEL, createBatch, processBatch, setProvider, uploadFiles, type FileRow } from "@/lib/valuationApi";
import { Badge, Notice, btn, btnPrimary, card, input, muted, td, th } from "@/components/valuation/ui";

const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`; };
const lastMonth = () => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 7); };

export default function NewValuation() {
  const router = useRouter();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [hh, setHh] = useState("");
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [client, setClient] = useState("");
  const [month, setMonth] = useState(lastMonth());
  const [vdate, setVdate] = useState(monthEnd(lastMonth()));
  const [files, setFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const NEW = "__new__";
  const [newName, setNewName] = useState("");
  useEffect(() => { fetchHouseholds().then(setHouseholds).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    setMembers([]); setClient(""); setNewName("");
    if (hh && hh !== NEW) fetchHouseholdDetail(hh).then((d) => { setMembers(d.members); if (d.members.length === 1) setClient(d.members[0].customer_id); }).catch((e) => setErr(e.message));
  }, [hh]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  const loadMembers = async (id: string, pick?: string) => { const d = await fetchHouseholdDetail(id); setMembers(d.members); setClient(pick ?? (d.members.length === 1 ? d.members[0].customer_id : "")); };
  // Create from the dropdown itself: household first, then a client (contact) inside it.
  const addHousehold = () => run(async () => {
    const h = await createHousehold({ name: newName.trim() });
    setHouseholds((l) => [...l, h]); setHh(h.id); setNewName("");
  });
  const addClient = () => run(async () => {
    const c = await createContact({ name: newName.trim(), household_id: hh });
    await loadMembers(hh, c.customer_id); setNewName("");
  });

  const upload = () => run(async () => {
    let id = batchId;
    if (!id) { id = (await createBatch({ client_id: client, report_month: month, valuation_date: vdate })).id; setBatchId(id); }
    const res = await uploadFiles(id, files);
    setErrs(res.results.filter((r) => !r.ok).map((r) => `${r.filename}: ${r.error}`));
    setFiles([]);
    const p = await processBatch(id);
    setRows(p.files);
  });

  const correct = (f: FileRow, provider: string) => run(async () => {
    await setProvider(f.id, provider);
    setRows((await processBatch(batchId!)).files);
  });

  const needsPassword = rows.some((r) => r.status === "manual_review" && /password/i.test(`${r.detect_note} ${r.errors.join(" ")}`));
  const [pw, setPw] = useState("");
  const retryWithPassword = () => run(async () => {
    const pws = Object.fromEntries(rows.filter((r) => r.status === "manual_review").map((r) => [r.id, pw]));
    setRows((await processBatch(batchId!, pws)).files);
  });

  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <Link href="/backoffice/operations/valuation" className={`text-[12px] ${muted} hover:underline`}>← Monthly valuation</Link>
      <h1 className="text-xl font-bold">New valuation</h1>
      {err && <Notice tone="bad">{err}</Notice>}

      <div className={`${card} space-y-3 p-4`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold">Household
            <select className={`${input} mt-1`} value={hh} disabled={!!batchId} onChange={(e) => setHh(e.target.value)}>
              <option value="">Select household</option>{households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}<option value={NEW}>+ Create new household…</option>
            </select>
            {hh === NEW && (
              <span className="mt-2 flex gap-2">
                <input className={input} placeholder="New household name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                <button type="button" className={btnPrimary} disabled={busy || !newName.trim()} onClick={addHousehold}>Create</button>
              </span>
            )}
          </label>
          <label className="text-[12px] font-semibold">Client
            <select className={`${input} mt-1`} value={client} disabled={!!batchId || !hh || hh === NEW} onChange={(e) => setClient(e.target.value)}>
              <option value="">Select client</option>{members.map((m) => <option key={m.customer_id} value={m.customer_id}>{m.name}</option>)}<option value={NEW}>+ Create new client…</option>
            </select>
            {client === NEW && (
              <span className="mt-2 flex gap-2">
                <input className={input} placeholder="New client name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
                <button type="button" className={btnPrimary} disabled={busy || !newName.trim()} onClick={addClient}>Create</button>
              </span>
            )}
          </label>
          <label className="text-[12px] font-semibold">Reporting month
            <input type="month" className={`${input} mt-1`} value={month} disabled={!!batchId} onChange={(e) => { setMonth(e.target.value); setVdate(monthEnd(e.target.value)); }} />
          </label>
          <label className="text-[12px] font-semibold">Valuation date
            <input type="date" className={`${input} mt-1`} value={vdate} min={`${month}-01`} max={monthEnd(month)} disabled={!!batchId} onChange={(e) => setVdate(e.target.value)} />
          </label>
        </div>
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#175CD3] px-3.5 py-2 text-[13px] font-semibold text-[#175CD3] dark:text-[#7FB0FF]">
            Choose statements (PDF, XLSX, XLS, CSV)
            <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv" className="hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          </label>
          {files.length > 0 && <ul className={`mt-2 text-[12.5px] ${muted}`}>{files.map((f, i) => <li key={i}>{f.name} · {(f.size / 1024).toFixed(0)} KB</li>)}</ul>}
        </div>
        <button className={btnPrimary} disabled={busy || !client || client === NEW || !files.length} onClick={upload}>{busy ? "Working…" : "Upload and extract"}</button>
        <p className={`text-[12px] ${muted}`}>Statements are stored privately on the server. Scanned PDFs are not read automatically; they are flagged for manual handling.</p>
      </div>

      {errs.map((e) => <Notice key={e} tone="warn">{e}</Notice>)}

      {rows.length > 0 && (
        <div className={`${card} p-4`}>
          <h2 className="mb-2 text-[15px] font-semibold">Detected statements</h2>
          <table className="w-full border-collapse">
            <thead><tr>{["File", "Provider", "Status", "Statement date", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{f.filename}<div className={`text-[11px] ${muted}`}>{f.detect_note}</div></td>
                  <td className={td}>
                    <select className={input} value={f.provider ?? ""} onChange={(e) => correct(f, e.target.value)} disabled={busy} aria-label={`Provider for ${f.filename}`}>
                      <option value="" disabled>Select provider</option>
                      {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <div className={`text-[11px] ${muted}`}>{f.provider_source === "manual" ? "Set manually" : f.provider ? "Auto-detected" : ""}</div>
                  </td>
                  <td className={td}><Badge status={f.status} />{f.errors.map((e) => <div key={e} className="mt-1 text-[11.5px] text-[#B42318] dark:text-[#FF7D86]">{e}</div>)}</td>
                  <td className={td}>{f.statement_date ?? "-"}</td>
                  <td className={td} />
                </tr>
              ))}
            </tbody>
          </table>
          {needsPassword && (
            <div className="mt-3 flex items-end gap-2">
              <label className="text-[12px] font-semibold">PDF password (used once, never stored)
                <input type="password" className={`${input} mt-1`} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
              </label>
              <button className={btn} disabled={!pw || busy} onClick={retryWithPassword}>Retry</button>
            </div>
          )}
          <div className="mt-4"><button className={btnPrimary} onClick={() => router.push(`/backoffice/operations/valuation/${batchId}`)}>Continue to preview and reconciliation</button></div>
        </div>
      )}
    </div>
  );
}
