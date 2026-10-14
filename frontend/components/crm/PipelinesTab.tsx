// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Opportunity,
  PRODUCT_LINES,
  ProductLine,
  STAGES_BY_LINE,
  isClosedStage,
  formatRupeesFromPaise,
  stageLabel,
  getOpportunities,
  getPipeline,
  patchOpportunity,
} from "../../lib/crmProductsApi";
import { ApiError } from "../../lib/api";
import { fieldErrors, lostSchema } from "../../lib/crmSchemas";
import Link from "next/link";

function stageIndex(line: ProductLine, stage: string): number {
  return STAGES_BY_LINE[line].indexOf(stage);
}

export default function PipelinesTab() {
  const [line, setLine] = useState<ProductLine>("mutual_fund");
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [losing, setLosing] = useState<Opportunity | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState<string | null>(null);

  const load = useCallback(async (pl: ProductLine) => {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([getOpportunities({ product_line: pl }), getPipeline(pl)]);
      setOpps(list);
      setTotalValue(summary.total_value);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load the pipeline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(line);
  }, [line, load]);

  const columns = useMemo(() => [...STAGES_BY_LINE[line], "lost"], [line]);

  const byStage = useMemo(() => {
    const map: Record<string, Opportunity[]> = {};
    for (const c of columns) map[c] = [];
    for (const o of opps) {
      if (!map[o.stage]) map[o.stage] = [];
      map[o.stage].push(o);
    }
    return map;
  }, [opps, columns]);

  const move = async (opp: Opportunity, newStage: string, extra?: { lost_reason?: string }) => {
    setMovingId(opp.id);
    setError(null);
    try {
      const updated = await patchOpportunity(opp.id, { stage: newStage, ...extra });
      setOpps((prev) => prev.map((o) => (o.id === opp.id ? updated : o)));
      // won/lost leave the open pipeline: refresh its total
      getPipeline(line).then((s) => setTotalValue(s.total_value)).catch(() => undefined);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Stage move failed.");
      return false;
    } finally {
      setMovingId(null);
    }
  };

  const confirmLost = async () => {
    if (!losing) return;
    const errs = fieldErrors(lostSchema, { lost_reason: lostReason });
    if (errs) {
      setLostError(errs.lost_reason);
      return;
    }
    if (await move(losing, "lost", { lost_reason: lostReason.trim() })) {
      setLosing(null);
      setLostReason("");
      setLostError(null);
    }
  };

  const columnValue = (stage: string) =>
    (byStage[stage] ?? []).reduce((s, o) => s + ((stage === "won" ? (o.won_amount ?? o.amount) : o.amount) ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRODUCT_LINES.map((p) => (
          <button
            key={p.value}
            onClick={() => setLine(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              line === p.value
                ? "bg-navy-900 text-white border-navy-900"
                : "bg-white text-navy-700 border-navy-200 hover:border-navy-400"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-navy-600 dark:text-[#A8B4C4]">
        <span>
          <strong className="text-navy-950 dark:text-[#EDF2F7]">{opps.filter((o) => !isClosedStage(o.stage)).length}</strong> open opportunities
        </span>
        <span>
          Pipeline value (open): <strong className="text-navy-950 dark:text-[#EDF2F7]">{formatRupeesFromPaise(totalValue)}</strong>
        </span>
      </div>

      {error && (
        <div className="bg-rose-100 border border-rose-600/30 text-rose-700 text-xs rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="p-16 text-center">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((stage) => {
            const cards = byStage[stage] ?? [];
            const isLost = stage === "lost";
            return (
              <div
                key={stage}
                className={`w-64 shrink-0 rounded-2xl border p-3 space-y-2 ${
                  isLost ? "bg-gray-50 border-gray-200" : "bg-white border-navy-200"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-bold text-navy-950">{stageLabel(stage)}</h3>
                  <span className="text-xs text-navy-500 font-semibold">{cards.length}</span>
                </div>
                <p className="text-xs text-navy-500">{formatRupeesFromPaise(columnValue(stage))}</p>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {cards.map((o) => {
                    const idx = stageIndex(line, o.stage);
                    const closed = isClosedStage(o.stage);
                    const prev = !closed && idx > 0 ? STAGES_BY_LINE[line][idx - 1] : null;
                    const next = !closed && idx >= 0 && idx < STAGES_BY_LINE[line].length - 1 ? STAGES_BY_LINE[line][idx + 1] : null;
                    const busy = movingId === o.id;
                    return (
                      <div key={o.id} className="bg-white border border-navy-100 rounded-xl p-2.5 space-y-1.5 shadow-sm">
                        <Link
                          href={`/backoffice/crm/opportunities/${o.id}`}
                          className="block text-xs font-semibold text-navy-950 leading-snug hover:underline"
                        >
                          {o.title}
                        </Link>
                        {(o.household_name || o.customer_name) && (
                          <p className="text-xs text-navy-500">{o.household_name || o.customer_name}</p>
                        )}
                        <div className="flex items-center justify-between text-xs text-navy-600">
                          <span className="font-bold text-navy-900">
                            {formatRupeesFromPaise(o.stage === "won" ? (o.won_amount ?? o.amount) : o.amount)}
                          </span>
                          <span>{o.probability}% prob</span>
                        </div>
                        {o.stage === "lost" && o.lost_reason && (
                          <p className="text-xs text-navy-500">Reason: {o.lost_reason}</p>
                        )}
                        {o.expected_close && !closed && (
                          <p className="text-xs text-navy-500">Expected close: {o.expected_close}</p>
                        )}
                        <div className="flex gap-1 pt-1">
                          {closed ? (
                            <p className="text-xs text-navy-500">
                              {o.stage === "won" ? "Won" : "Lost"} {o.closed_at ? o.closed_at.slice(0, 10) : ""} · final
                            </p>
                          ) : (
                            <>
                              <button
                                disabled={busy || !prev}
                                onClick={() => prev && move(o, prev)}
                                title={prev ? `Move back to ${stageLabel(prev)}` : "First stage"}
                                className="flex-1 text-xs font-semibold px-2 py-1 rounded-lg bg-navy-50 text-navy-700 hover:bg-navy-100 disabled:opacity-40"
                              >
                                ← Back
                              </button>
                              <button
                                disabled={busy || !next}
                                onClick={() => next && move(o, next)}
                                title={next ? `Move to ${stageLabel(next)}` : "Final stage"}
                                className="flex-1 text-xs font-semibold px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
                              >
                                Forward →
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => {
                                  setLosing(o);
                                  setLostReason("");
                                  setLostError(null);
                                }}
                                title="Mark as lost"
                                className="text-xs font-semibold px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                              >
                                Lost
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {cards.length === 0 && (
                    <p className="text-xs text-navy-600 text-center py-4">No opportunities here yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {losing && (
        <div className="fixed inset-0 z-50 bg-navy-950/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mark opportunity lost">
          <div className="bg-white rounded-2xl border border-navy-100 shadow-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-base font-bold text-navy-950">Mark “{losing.title}” as lost</h3>
            <label className="block text-xs font-semibold text-navy-700" htmlFor="lost-reason">
              Reason (required)
            </label>
            <textarea
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-xs rounded-xl border border-navy-200 bg-white text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {lostError && <p className="text-xs font-medium text-rose-700">{lostError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLosing(null)}
                className="flex-1 px-3 py-2 text-xs font-semibold bg-navy-50 hover:bg-navy-100 text-navy-700 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmLost}
                disabled={movingId === losing.id}
                className="flex-1 px-3 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl transition"
              >
                Mark lost
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
