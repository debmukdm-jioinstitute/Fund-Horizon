"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthContext";
import {
  type Check, type FileRow, type HistoryRow, type Payload, type Preview, type Recon, PROVIDER_LABEL,
  approveBatch, attestFlows, createBatch, generateReport, getConsolidated, getHistory, getPreview, getRecon, removeFile,
  reportDownloadUrl, resolveCheck, setProvider, uploadFiles, validateBatch, processBatch,
} from "@/lib/valuationApi";
import { Badge, Notice, Stat, Tabs, btn, btnPrimary, card, dateFmt, input, money, monthFmt, muted, num, pct, td, th } from "@/components/valuation/ui";

type Tab = "statements" | "reconciliation" | "portfolio" | "report";
const ASSET: Record<string, string> = { mutual_fund: "Mutual funds", equity: "Equity", debt: "Debt", cash: "Cash", other: "Unclassified" };
const TOTAL_LABELS: [string, string][] = [["total_value", "Provider total value"], ["table_total_value", "Printed holdings total"], ["cash_balance", "Cash balance"], ["total_invested", "Invested (reported)"], ["opening_value", "Opening value"]];

export default function BatchWorkspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { customer } = useAuth();
  const isAdmin = customer?.role === "admin";
  const [tab, setTab] = useState<Tab>("statements");
  const [pv, setPv] = useState<Preview | null>(null);
  const [rec, setRec] = useState<Recon | null>(null);
  const [port, setPort] = useState<Payload | null>(null);
  const [hist, setHist] = useState<HistoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const batch = pv?.batch;
  const editable = !!batch && ["draft", "processed", "reconciled"].includes(batch.status);

  const refresh = useCallback(async () => {
    const p = await getPreview(id);
    setPv(p);
    getRecon(id).then(setRec).catch(() => setRec(null));
    if (p.batch.status === "approved") getHistory(p.batch.client_id).then((h) => setHist(h.find((x) => x.batch_id === id) ?? null));
    if (["reconciled", "approved"].includes(p.batch.status)) getConsolidated(id).then(setPort).catch(() => setPort(null)); else setPort(null);
  }, [id]);
  useEffect(() => { refresh().catch((e) => setErr(e.message)); }, [refresh]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); await refresh(); if (ok) setMsg(ok); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (!pv || !batch) return <p className={muted}>{err ?? "Loading…"}</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/backoffice/operations/valuation" className={`text-[12px] ${muted} hover:underline`}>← Monthly valuation</Link>
        <h1 className="text-xl font-bold">{monthFmt(batch.report_month)} valuation <Badge status={batch.status} /></h1>
        <p className={`text-[13px] ${muted}`}>Valuation date {dateFmt(batch.valuation_date)} · revision {batch.revision_no}</p>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {msg && <Notice tone="good">{msg}</Notice>}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "statements", label: "Statements" }, { id: "reconciliation", label: "Reconciliation" }, { id: "portfolio", label: "Consolidated portfolio" }, { id: "report", label: "Report" }]} />

      {tab === "statements" && (
        <div className="space-y-3">
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${btn} cursor-pointer`}>Add statements
                <input type="file" multiple accept=".pdf,.xlsx,.xls,.csv" className="hidden" disabled={busy}
                  onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) act(async () => { const r = await uploadFiles(id, f); const bad = r.results.filter((x) => !x.ok); if (bad.length) setErr(bad.map((b) => `${b.filename}: ${b.error}`).join(" · ")); await processBatch(id); }); }} />
              </label>
              <button className={btn} disabled={busy} onClick={() => act(() => processBatch(id), "Statements re-extracted. Run validation again.")}>Re-extract all</button>
              <button className={btnPrimary} disabled={busy || batch.status === "draft"} onClick={() => { act(() => validateBatch(id)).then(() => setTab("reconciliation")); }}>Run validation</button>
            </div>
          )}
          {pv.files.length === 0 && <p className={muted}>No statements uploaded yet.</p>}
          {pv.files.map((f) => <FilePanel key={f.id} f={f} editable={editable} busy={busy}
            onProvider={(p) => act(async () => { await setProvider(f.id, p); await processBatch(id); })}
            onRemove={() => act(() => removeFile(f.id))} />)}
        </div>
      )}

      {tab === "reconciliation" && (
        <Reconciliation rec={rec} files={pv.files} editable={editable} isAdmin={isAdmin} busy={busy}
          onRun={() => act(() => validateBatch(id))}
          onResolve={(c, action, reason) => act(() => resolveCheck(c.id, action, reason))}
          onAttest={(accId, reason) => act(() => attestFlows(accId, reason), "Cash-flow history confirmed. Run validation again.")} />
      )}

      {tab === "portfolio" && (port ? <Portfolio p={port} /> : <Notice tone="info">Run validation to see the consolidated portfolio.</Notice>)}

      {tab === "report" && (
        <div className={`${card} space-y-3 p-4`}>
          {batch.status !== "approved" ? (
            <>
              <p className="text-[13px]">Approving saves an immutable snapshot of the figures in the Consolidated portfolio tab and generates the first PDF.</p>
              {!rec?.summary.can_approve && <Notice tone="warn">Approval is blocked until validation has been run after the latest change and every material discrepancy is resolved.</Notice>}
              <button className={btnPrimary} disabled={busy || !rec?.summary.can_approve} onClick={() => act(() => approveBatch(id, true), "Approved. Report generated.")}>Approve and generate PDF</button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {hist && <button className={btnPrimary} disabled={busy} onClick={() => act(() => generateReport(hist.snapshot_id), "New report version generated.")}>Generate new version</button>}
                <button className={btn} disabled={busy} onClick={() => act(async () => { const b = await createBatch({ client_id: batch.client_id, report_month: batch.report_month, valuation_date: batch.valuation_date, revises_batch_id: id }); router.push(`/backoffice/operations/valuation/${b.id}`); })}>Create revision</button>
              </div>
              <p className={`text-[12px] ${muted}`}>A revision keeps this approved snapshot and every report version unchanged.</p>
              <table className="w-full border-collapse">
                <thead><tr>{["Version", "Generated", "Size", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{hist?.reports.map((r) => (
                  <tr key={r.id}><td className={td}>v{r.version_no}</td><td className={td}>{dateFmt(r.created_at)}</td><td className={td}>{(r.size_bytes / 1024).toFixed(0)} KB</td>
                    <td className={`${td} text-right`}><a className={btn} href={reportDownloadUrl(r.id)}>Download PDF</a></td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilePanel({ f, editable, busy, onProvider, onRemove }: { f: FileRow; editable: boolean; busy: boolean; onProvider: (p: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold">{f.filename}</div>
          <div className={`text-[11.5px] ${muted}`}>SHA-256 {f.sha256.slice(0, 12)} · statement date {dateFmt(f.statement_date)} · {f.detect_note}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge status={f.status} />
          {editable && (
            <select className={`${input} !w-auto`} value={f.provider ?? ""} onChange={(e) => onProvider(e.target.value)} disabled={busy} aria-label={`Provider for ${f.filename}`}>
              <option value="" disabled>Select provider</option>
              {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          {editable && <button className={btn} disabled={busy} onClick={onRemove}>Remove</button>}
        </div>
      </div>
      {f.provider && !f.adapter_verified && <div className="mt-2"><Notice tone="warn">{f.provider_label} extraction has only been tested on synthetic samples. Check every figure against the source statement.</Notice></div>}
      {f.errors.map((e) => <div key={e} className="mt-2"><Notice tone="bad">{e}</Notice></div>)}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {TOTAL_LABELS.filter(([k]) => f.totals[k] != null).map(([k, l]) => <Stat key={k} label={l} value={money(f.totals[k])} />)}
        <Stat label="Extracted holdings value" value={money(f.holdings.reduce((s, h) => s + (h.market_value ?? 0), 0))} note={`${f.holdings.length} holdings · ${f.cashflows.length} cash flows`} />
      </div>
      {f.warnings.filter((w) => !w.includes("synthetic")).length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[12px] text-[#9A6700] dark:text-[#F5C451]">{f.warnings.filter((w) => !w.includes("synthetic")).slice(0, 8).map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {f.holdings.length > 0 && (
        <>
          <button className={`${btn} mt-3`} onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} extracted records</button>
          {open && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead><tr>{["Security", "ISIN", "Account", "Qty", "Avg cost", "Invested", "Price", "Market value", "Source"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{f.holdings.map((h) => {
                  const acct = f.accounts.find((a) => a.id === h.account_id)?.account_no;
                  return (
                    <tr key={h.id}>
                      <td className={td}>{h.security_name}{h.validation_status !== "ok" && <span className="ml-1"><Badge status={h.validation_status} /></span>}</td>
                      <td className={td}>{h.isin ?? "-"}</td><td className={td}>{acct ?? "-"}</td>
                      {[h.quantity, h.avg_cost, h.invested_amount, h.price, h.market_value].map((v, i) => <td key={i} className={`${td} text-right tabular-nums`}>{num(v)}</td>)}
                      <td className={td}>{h.source_page} · row {h.source_row}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Reconciliation({ rec, files, editable, isAdmin, busy, onRun, onResolve, onAttest }: {
  rec: Recon | null; files: FileRow[]; editable: boolean; isAdmin: boolean; busy: boolean; onRun: () => void;
  onResolve: (c: Check, a: "resolved" | "overridden", reason: string) => void; onAttest: (accountId: string, reason: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [attest, setAttest] = useState("");
  if (!rec || !rec.run_no) return <div className="space-y-3"><Notice tone="info">Validation has not been run.</Notice>{editable && <button className={btnPrimary} disabled={busy} onClick={onRun}>Run validation</button>}</div>;
  const failed = rec.checks.filter((c) => c.status === "failed" && c.severity !== "info");
  const done = rec.checks.filter((c) => c.status === "resolved" || c.status === "overridden");
  const passed = rec.checks.filter((c) => c.status === "passed");
  const infoFailed = rec.checks.filter((c) => c.status === "failed" && c.severity === "info");
  const accounts = files.flatMap((f) => f.accounts);
  const row = (c: Check, actions: boolean) => (
    <tr key={c.id}>
      <td className={td}><Badge status={c.severity === "error" && c.status === "failed" ? "error" : c.status === "failed" ? "warning" : c.status} /></td>
      <td className={td}><div className="font-semibold">{c.check_code.replace(/_/g, " ")}</div><div className={`text-[11px] ${muted}`}>{c.subject_label}</div></td>
      <td className={td}>{c.message}{c.resolution_reason && <div className={`text-[11.5px] ${muted}`}>Reason: {c.resolution_reason}</div>}</td>
      <td className={`${td} text-right tabular-nums`}>{c.expected != null ? money(c.expected) : "-"}</td>
      <td className={`${td} text-right tabular-nums`}>{c.actual != null ? money(c.actual) : "-"}</td>
      <td className={`${td} text-right tabular-nums`}>{c.difference != null ? money(c.difference) : "-"}</td>
      {actions && editable && (
        <td className={td} style={{ minWidth: 220 }}>
          {c.severity === "error" && !c.overridable ? <span className={`text-[11.5px] ${muted}`}>Remove or replace the file</span>
            : c.severity === "error" && !isAdmin ? <span className={`text-[11.5px] ${muted}`}>Administrator override required</span>
            : (<>
              <input className={input} placeholder="Reason (min 10 characters)" value={reasons[c.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [c.id]: e.target.value })} aria-label="Resolution reason" />
              <button className={`${btn} mt-1`} disabled={busy || (reasons[c.id] ?? "").trim().length < 10} onClick={() => onResolve(c, c.severity === "error" ? "overridden" : "resolved", reasons[c.id])}>{c.severity === "error" ? "Override" : "Mark resolved"}</button>
            </>)}
        </td>
      )}
    </tr>
  );
  const head = (actions: boolean) => <thead><tr>{["", "Check", "Detail", "Expected", "Extracted", "Difference", ...(actions && editable ? ["Resolution"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-6">
        <Stat label="Passed" value={String(rec.summary.passed)} /><Stat label="Blocking" value={String(rec.summary.failed_errors)} />
        <Stat label="Warnings" value={String(rec.summary.warnings)} /><Stat label="Resolved" value={String(rec.summary.resolved)} />
        {editable && <button className={btn} disabled={busy} onClick={onRun}>Re-run validation</button>}
      </div>
      <div className={`${card} overflow-x-auto p-4`}>
        <h2 className="mb-2 text-[14px] font-semibold">Needs attention</h2>
        {failed.length === 0 ? <p className={muted}>Nothing outstanding.</p> : <table className="w-full min-w-[900px] border-collapse">{head(true)}<tbody>{failed.map((c) => row(c, true))}</tbody></table>}
      </div>
      {done.length > 0 && <div className={`${card} overflow-x-auto p-4`}><h2 className="mb-2 text-[14px] font-semibold">Resolved or overridden</h2><table className="w-full min-w-[900px] border-collapse">{head(false)}<tbody>{done.map((c) => row(c, false))}</tbody></table></div>}
      {editable && infoFailed.some((c) => c.check_code === "flows_incomplete") && (
        <div className={`${card} space-y-2 p-4`}>
          <h2 className="text-[14px] font-semibold">Cash-flow history</h2>
          <p className={`text-[12.5px] ${muted}`}>Since-inception XIRR needs complete cash flows. Statements do not state this, so an administrator must confirm it per account, with a reason.</p>
          {isAdmin ? (
            <>
              <input className={input} placeholder="Reason (min 10 characters)" value={attest} onChange={(e) => setAttest(e.target.value)} aria-label="Attestation reason" />
              <div className="flex flex-wrap gap-2">{accounts.filter((a) => !a.flows_complete).map((a) => (
                <button key={a.id} className={btn} disabled={busy || attest.trim().length < 10} onClick={() => onAttest(a.id, attest)}>Confirm {PROVIDER_LABEL[a.provider] ?? a.provider} {a.account_no ?? ""}</button>
              ))}</div>
            </>
          ) : <p className={`text-[12px] ${muted}`}>Administrator only.</p>}
        </div>
      )}
      <details className={`${card} p-4`}><summary className="cursor-pointer text-[14px] font-semibold">Passed checks ({passed.length})</summary>
        <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[900px] border-collapse">{head(false)}<tbody>{passed.map((c) => row(c, false))}</tbody></table></div></details>
    </div>
  );
}

function Portfolio({ p }: { p: Payload }) {
  const t = p.totals;
  return (
    <div className="space-y-4">
      <div className={`${card} grid gap-4 p-4 sm:grid-cols-4`}>
        <Stat label="Current value" value={money(t.total_value)} />
        <Stat label="Invested" value={money(t.invested)} />
        <Stat label="Gain / loss" value={money(t.gain)} note={t.absolute_return_pct != null ? pct(t.absolute_return_pct) : undefined} />
        <Stat label="Valuation dates" value={p.valuation_dates.map((d) => dateFmt(d)).join(", ")} />
      </div>
      {Object.entries(p.unavailable).map(([k, v]) => <Notice key={k} tone="info"><b>{k.replace(/_/g, " ")}</b> is not shown: {v}</Notice>)}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <h2 className="mb-2 text-[14px] font-semibold">Asset allocation</h2>
          {p.allocation.map((a) => (
            <div key={a.asset_type} className="mb-2">
              <div className="flex justify-between text-[12.5px]"><span>{ASSET[a.asset_type] ?? a.asset_type}</span><span className="tabular-nums">{money(a.value)} · {pct(a.pct)}</span></div>
              <div className="h-1.5 rounded bg-[#EEF1F5] dark:bg-[#232D3B]"><div className="h-1.5 rounded bg-[#175CD3]" style={{ width: `${Math.max(0, Math.min(100, a.pct))}%` }} /></div>
            </div>
          ))}
        </div>
        <div className={`${card} p-4`}>
          <h2 className="mb-2 text-[14px] font-semibold">Provider-wise contribution</h2>
          <table className="w-full border-collapse"><thead><tr>{["Provider", "Value", "Share", "Gain / loss"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{p.provider_contribution.map((c) => <tr key={c.provider}><td className={td}>{PROVIDER_LABEL[c.provider] ?? c.provider}<div className={`text-[11px] ${muted}`}>{c.valuation_dates.map((d) => dateFmt(d)).join(", ")}</div></td>
              <td className={`${td} text-right tabular-nums`}>{money(c.value)}</td><td className={`${td} text-right`}>{pct(c.pct)}</td><td className={`${td} text-right tabular-nums`}>{money(c.gain)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className={`${card} p-4`}>
        <h2 className="mb-2 text-[14px] font-semibold">Performance</h2>
        <table className="w-full border-collapse"><tbody>
          {([["XIRR (since inception)", p.performance.consolidated.xirr], ["Modified Dietz (month)", p.performance.consolidated.modified_dietz], ["CAGR", p.performance.consolidated.cagr]] as const).map(([l, m]) => (
            <tr key={l}><td className={td}>{l}</td><td className={`${td} tabular-nums`}>{m.value != null ? pct(m.value) : "Not available"}</td><td className={`${td} ${muted}`}>{m.value != null ? m.method : m.reason}</td></tr>))}
        </tbody></table>
        {p.month_on_month && <p className="mt-3 text-[12.5px]">Versus {monthFmt(p.month_on_month.previous_month)}: <b>{money(p.month_on_month.change)}</b> ({pct(p.month_on_month.change_pct)}), of which net external flows {money(p.month_on_month.net_external_flows)}.</p>}
      </div>
      <div className={`${card} overflow-x-auto p-4`}>
        <h2 className="mb-1 text-[14px] font-semibold">Holdings</h2>
        <p className={`mb-2 text-[11.5px] ${muted}`}>Listed per account. The same security in two accounts is never merged.</p>
        <table className="w-full min-w-[820px] border-collapse"><thead><tr>{["Security", "Provider / account", "Qty", "Invested", "Market value", "Weight", "Source"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{p.holdings.map((h, i) => <tr key={i}><td className={td}>{h.security_name}<div className={`text-[11px] ${muted}`}>{h.isin ?? ""}</div></td><td className={td}>{PROVIDER_LABEL[h.provider] ?? h.provider} · {h.account_no ?? "-"}</td>
            <td className={`${td} text-right tabular-nums`}>{num(h.quantity)}</td><td className={`${td} text-right tabular-nums`}>{num(h.invested_amount)}</td><td className={`${td} text-right tabular-nums`}>{num(h.market_value)}</td>
            <td className={`${td} text-right`}>{pct(h.weight_pct)}</td><td className={td}>{h.source_page} · {h.source_row}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
