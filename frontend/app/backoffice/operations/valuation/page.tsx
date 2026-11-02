"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type Batch, type HistoryRow, PROVIDER_LABEL, getHistory, listBatches, reportDownloadUrl } from "@/lib/valuationApi";
import { Badge, Notice, Tabs, btnPrimary, btn, card, dateFmt, input, money, monthFmt, muted, td, th } from "@/components/valuation/ui";

export default function ValuationDashboard() {
  const [tab, setTab] = useState<"batches" | "history">("batches");
  const [rows, setRows] = useState<Batch[] | null>(null);
  const [month, setMonth] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [hist, setHist] = useState<HistoryRow[] | null>(null);

  const load = useCallback(() => listBatches({ month: month || undefined }).then((r) => { setRows(r); setErr(null); }).catch((e) => setErr(e.message)), [month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setHist(null);
    if (clientId) getHistory(clientId).then(setHist).catch((e) => setErr(e.message));
  }, [clientId]);

  const clients = useMemo(() => {
    const m = new Map<string, string>();
    (rows ?? []).forEach((b) => m.set(b.client_id, b.client_name ?? b.client_id));
    return Array.from(m.entries());
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/backoffice/operations" className={`text-[12px] ${muted} hover:underline`}>← Operations</Link>
          <h1 className="text-xl font-bold">Monthly valuation</h1>
          <p className={`text-[13px] ${muted}`}>Consolidate FundsIndia, ProAffluence and Stallion statements into one reconciled client report.</p>
        </div>
        <Link href="/backoffice/operations/valuation/new" className={btnPrimary}>New valuation</Link>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <Tabs tabs={[{ id: "batches", label: "Valuations" }, { id: "history", label: "Historical reports" }]} value={tab} onChange={setTab} />

      {tab === "batches" && (
        <div className={`${card} p-4`}>
          <label className="mb-3 block max-w-[200px] text-[12px] font-semibold">Reporting month
            <input type="month" className={`${input} mt-1`} value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead><tr>{["Client", "Month", "Providers received", "Batch", "Reconciliation", "Report", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows === null && <tr><td className={td} colSpan={7}>Loading…</td></tr>}
                {rows?.length === 0 && <tr><td className={td} colSpan={7}>No valuations yet.</td></tr>}
                {rows?.map((b) => (
                  <tr key={b.id}>
                    <td className={td}>{b.client_name ?? b.client_id}</td>
                    <td className={td}>{monthFmt(b.report_month)}{b.revision_no > 1 && <span className={`ml-1 text-[11px] ${muted}`}>rev {b.revision_no}</span>}</td>
                    <td className={td}>{b.providers?.length ? b.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(", ") : <span className={muted}>None yet</span>}</td>
                    <td className={td}><Badge status={b.status} /></td>
                    <td className={td}><Badge status={b.reconciliation_status ?? "not_run"} label={b.reconciliation_status === "blocked" ? `${b.blocking_checks} blocking` : undefined} /></td>
                    <td className={td}>{b.report_status === "not_generated" ? <span className={muted}>Not generated</span> : b.report_status}</td>
                    <td className={`${td} text-right`}><Link className={btn} href={`/backoffice/operations/valuation/${b.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className={`${card} p-4`}>
          <label className="mb-3 block max-w-[320px] text-[12px] font-semibold">Client
            <select className={`${input} mt-1`} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client</option>
              {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          {clientId && hist === null && <p className={muted}>Loading…</p>}
          {hist?.length === 0 && <p className={muted}>No approved valuations for this client yet.</p>}
          {!!hist?.length && (
            <table className="w-full border-collapse">
              <thead><tr>{["Month", "Revision", "Valuation date", "Total value", "Report versions"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {hist.map((h) => (
                  <tr key={h.snapshot_id}>
                    <td className={td}>{monthFmt(h.report_month)}</td>
                    <td className={td}>{h.revision_no}{!h.is_latest_revision && <span className={`ml-1 text-[11px] ${muted}`}>superseded</span>}</td>
                    <td className={td}>{dateFmt(h.valuation_date)}</td>
                    <td className={`${td} tabular-nums`}>{money(h.total_value)}</td>
                    <td className={td}>
                      {h.reports.length === 0 ? <span className={muted}>None</span> : h.reports.map((r) => (
                        <a key={r.id} className="mr-3 text-[#175CD3] hover:underline dark:text-[#7FB0FF]" href={reportDownloadUrl(r.id)}>v{r.version_no}</a>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
