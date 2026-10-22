"use client";

import { useEffect, useState } from "react";
import { type AiFund, type AiPicks, getAiPicks, saveAiPicks } from "@/lib/api";

const MAX = 6;
const pc = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);

/** AI-chosen split across FH Recommended funds for this plan, with an Edit mode to reallocate. */
export default function AiPicksSection({ id }: { id: string }) {
  const [data, setData] = useState<AiPicks | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ scheme_code: string; w: string }[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getAiPicks(id).then(setData).catch(() => setErr("Could not load the AI picks.")); }, [id]);

  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!data) return <p className="text-sm text-navy-700">Preparing fund picks…</p>;

  const byCode = new Map<string, AiFund>(data.candidates.map((c) => [c.scheme_code, c]));
  const total = edit ? edit.reduce((s, r) => s + (parseFloat(r.w) || 0), 0) : 0;
  const valid = !!edit && edit.length >= 1 && Math.abs(total - 100) <= 0.05 && edit.every((r) => (parseFloat(r.w) || 0) > 0);

  async function save() {
    if (!edit) return;
    setSaving(true); setErr(null);
    try {
      setData(await saveAiPicks(id, edit.map((r) => ({ scheme_code: r.scheme_code, weight_pct: parseFloat(r.w) }))));
      setEdit(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-navy-700">
          {data.ai_generated ? "Chosen by AI" : "Chosen by a fixed rule"} from the FH Recommended funds, using your allocation and the current market.
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
              <option value="">Add a fund from the FH Recommended list…</option>
              {data.candidates.filter((c) => !edit.some((r) => r.scheme_code === c.scheme_code)).map((c) => <option key={c.scheme_code} value={c.scheme_code}>{c.scheme_name}</option>)}
            </select>
          )}
          <div className={`text-sm font-semibold ${valid ? "text-green-700" : "text-red-700"}`}>Total {total.toFixed(1)}% (must be 100%)</div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={!valid || saving} onClick={save}>{saving ? "Saving…" : "Save split"}</button>
            <button type="button" className="btn-secondary" onClick={() => { setEdit(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="text-xs text-navy-700">{data.notice}</p>
    </div>
  );
}
