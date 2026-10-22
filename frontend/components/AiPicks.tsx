"use client";

import { useEffect, useState } from "react";
import { type AiFund, type AiPicks, type Backtest, backtestPicks, getAiPicks, previewAiPicks, saveAiPicks } from "@/lib/api";

const MAX = 6;
const pc = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);

/** AI picks for a saved plan; the edited split is stored with the plan. */
export default function AiPicksSection({ id }: { id: string }) {
  const [data, setData] = useState<AiPicks | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getAiPicks(id).then(setData).catch(() => setErr("Could not load the AI picks.")); }, [id]);
  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!data) return <p className="text-sm text-navy-700">Preparing fund picks…</p>;
  return <AiPicksView initial={data} onSave={(picks) => saveAiPicks(id, picks)} />;
}

/** AI picks for a risk profile with no saved plan (Risk Profiling Studio). Runs on a button press; edits stay on the page. */
export function AiPicksPreview({ profile, onChange }: { profile: { band: string; equity: number; debt: number; gold: number; liquid: number }; onChange?: (p: { scheme_code: string; weight_pct: number }[] | null) => void }) {
  const [data, setData] = useState<AiPicks | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(profile);
  useEffect(() => { setData(null); setErr(null); onChange?.(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    setBusy(true); setErr(null);
    try { setData(await previewAiPicks(profile)); } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the AI picks."); }
    setBusy(false);
  }
  if (data) {
    const local = async (picks: { scheme_code: string; weight_pct: number }[]): Promise<AiPicks> => {
      const byCode = new Map(data.candidates.map((c) => [c.scheme_code, c]));
      const reasons = new Map(data.picks.map((p) => [p.scheme_code, p.reason]));
      const { backtest } = await backtestPicks(picks);
      return { ...data, edited: true, backtest, picks: picks.map((p) => ({ ...byCode.get(p.scheme_code)!, ...p, reason: reasons.get(p.scheme_code) ?? "" })) };
    };
    return <AiPicksView initial={data} onSave={local} onChange={onChange} />;
  }
  return (
    <div className="space-y-2">
      <button type="button" className="btn-primary" disabled={busy} onClick={run}>{busy ? "Preparing fund picks…" : "Get AI fund picks"}</button>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

function AiPicksView({ initial, onSave, onChange }: { initial: AiPicks; onSave: (picks: { scheme_code: string; weight_pct: number }[]) => Promise<AiPicks>; onChange?: (p: { scheme_code: string; weight_pct: number }[] | null) => void }) {
  const [data, setData] = useState<AiPicks>(initial);
  useEffect(() => { onChange?.(data.picks.map((p) => ({ scheme_code: p.scheme_code, weight_pct: p.weight_pct }))); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ scheme_code: string; w: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  const byCode = new Map<string, AiFund>(data.candidates.map((c) => [c.scheme_code, c]));
  const total = edit ? edit.reduce((s, r) => s + (parseFloat(r.w) || 0), 0) : 0;
  const hasNonPositive = !!edit && edit.some((r) => (parseFloat(r.w) || 0) <= 0);
  const valid = !!edit && edit.length >= 1 && Math.abs(total - 100) <= 0.05 && !hasNonPositive;

  async function save() {
    if (!edit) return;
    setSaving(true); setErr(null);
    try {
      setData(await onSave(edit.map((r) => ({ scheme_code: r.scheme_code, weight_pct: parseFloat(r.w) }))));
      setEdit(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-navy-700">
          {data.ai_generated ? "Chosen by AI" : "Chosen by a fixed rule"} from the FH Marked funds, using your allocation and the current market.
          {data.edited && " You have edited this split."}
        </p>
        {!edit && <button type="button" className="btn-secondary" onClick={() => setEdit(data.picks.map((p) => ({ scheme_code: p.scheme_code, w: String(p.weight_pct) })))}>Edit</button>}
      </div>
      {data.market_note && <p className="text-sm text-navy-700">Market: {data.market_note}</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}

      {!edit ? (
        <ul className="space-y-2">
          {data.picks.map((p) => (
            <li key={p.scheme_code} className="card p-4">
              <div className="flex justify-between gap-3 font-semibold text-navy-900"><span>{p.scheme_name}</span><span>{p.weight_pct}%</span></div>
              <div className="text-xs text-navy-700">{p.category} · 5Y CAGR {pc(p.cagr_5y)} · 3Y Sharpe {p.sharpe_3y?.toFixed(2) ?? "–"}</div>
              <p className="mt-1 text-sm text-navy-700">{p.reason}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card space-y-2 p-4">
          {edit.map((r, i) => (
            <div key={r.scheme_code} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{byCode.get(r.scheme_code)?.scheme_name}</span>
              <input type="number" min={1} max={100} step={0.5} value={r.w} aria-label="Weight percent" className="w-20 rounded border border-navy-200 px-2 py-1"
                onChange={(e) => setEdit(edit.map((x, j) => (j === i ? { ...x, w: e.target.value } : x)))} />
              <span>%</span>
              <button type="button" className="btn-secondary" disabled={edit.length === 1} onClick={() => setEdit(edit.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          {edit.length < MAX && (
            <select value="" aria-label="Add a fund" className="rounded border border-navy-200 px-2 py-1 text-sm"
              onChange={(e) => e.target.value && setEdit([...edit, { scheme_code: e.target.value, w: "0" }])}>
              <option value="">Add a fund from the FH Marked list…</option>
              {data.candidates.filter((c) => !edit.some((r) => r.scheme_code === c.scheme_code)).map((c) => <option key={c.scheme_code} value={c.scheme_code}>{c.scheme_name}</option>)}
            </select>
          )}
          <div className={`text-sm font-semibold ${valid ? "text-green-700" : "text-red-700"}`}>
            {hasNonPositive && Math.abs(total - 100) <= 0.05
              ? "Weights must be greater than 0 and total 100%"
              : `Total ${total.toFixed(1)}% (must be 100%)`}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!valid || saving} onClick={save}>{saving ? "Saving…" : "Save split"}</button>
            <button type="button" className="btn-secondary" onClick={() => { setEdit(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {!edit && data.backtest && <BacktestCard bt={data.backtest} />}
      <p className="text-xs text-navy-700">{data.notice}</p>
    </div>
  );
}

const bp = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

/** Past-data backtest of the split: stats row and a growth-of-100 line. */
function BacktestCard({ bt }: { bt: Backtest }) {
  const vs = bt.growth.map((g) => g.v);
  const lo = Math.min(...vs, 100), hi = Math.max(...vs);
  const pts = bt.growth.map((g, i) => `${(i / Math.max(bt.growth.length - 1, 1)) * 300},${58 - ((g.v - lo) / Math.max(hi - lo, 1)) * 52}`).join(" ");
  const stats: [string, string][] = [["1Y", bp(bt.cagr["1y"])], ["3Y", bp(bt.cagr["3y"])], ["5Y", bp(bt.cagr["5y"])], ["10Y", bp(bt.cagr["10y"])], ["Whole window", bp(bt.cagr.all)],
    ["Volatility", bp(bt.vol)], ["Max drawdown", bp(bt.max_drawdown)], ["Worst 12M", bp(bt.worst_12m)]];
  return (
    <div className="card space-y-2 p-4">
      <div className="font-semibold text-navy-900">Past performance of this split</div>
      <p className="text-xs text-navy-700">Funds held at these weights and rebalanced each period, {bt.start} to {bt.end}, on {bt.basis === "daily" ? "daily NAVs up to the latest available date" : "month-end NAVs from the latest data refresh"}.{bt.joins.length > 0 && ` ${bt.joins.join("; ")}: before that date the other funds are held at rescaled weights.`} Past performance does not indicate future results.</p>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
        {stats.map(([k, v]) => <div key={k}><div className="text-xs text-navy-700">{k}</div><div className="font-semibold text-navy-900">{v}</div></div>)}
      </div>
      <svg viewBox="0 0 300 62" className="w-full" role="img" aria-label="Growth of 100 invested in this split">
        <polyline points={pts} fill="none" stroke="#13A89E" strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between text-xs text-navy-700"><span>{bt.start}</span><span>100 → {bt.growth[bt.growth.length - 1].v.toFixed(0)}</span><span>{bt.end}</span></div>
    </div>
  );
}
