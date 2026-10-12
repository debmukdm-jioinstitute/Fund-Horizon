// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Opportunity,
  PRODUCT_LINES,
  ProductLine,
  STAGES_BY_LINE,
  formatRupeesFromPaise,
  stageLabel,
  getOpportunities,
  getPipeline,
  patchOpportunity,
} from "../../lib/crmProductsApi";
import { ApiError } from "../../lib/api";

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

  const move = async (opp: Opportunity, newStage: string) => {
    setMovingId(opp.id);
    try {
      const updated = await patchOpportunity(opp.id, { stage: newStage });
      setOpps((prev) => prev.map((o) => (o.id === opp.id ? updated : o)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Stage move failed.");
    } finally {
      setMovingId(null);
    }
  };

  const columnValue = (stage: string) =>
    (byStage[stage] ?? []).reduce((s, o) => s + (o.amount ?? 0), 0);

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

      <div className="flex items-center gap-4 text-xs text-navy-600">
        <span>
          <strong className="text-navy-950">{opps.filter((o) => o.stage !== "lost").length}</strong> open opportunities
        </span>
        <span>
          Pipeline value (open): <strong className="text-navy-950">{formatRupeesFromPaise(totalValue)}</strong>
        </span>
      </div>

      {error && (
        <div className="bg-rose-100 border border-rose-600/30 text-rose-700 text-xs rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="p-16 text-center">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full" />
          <p className="text-xs text-navy-600 font-medium mt-3">Loading pipeline...</p>
        </div>
      ) : (
        <div className="grid gap-3 auto-cols-fr grid-flow-col overflow-x-auto pb-2">
          {columns.map((stage) => {
            const cards = byStage[stage] ?? [];
            const isLost = stage === "lost";
            return (
              <div
                key={stage}
                className={`min-w-60 w-64 rounded-2xl border p-3 space-y-2 ${
                  isLost ? "bg-gray-50 border-gray-200" : "bg-white border-navy-200"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-bold text-navy-950">{stageLabel(stage)}</h3>
                  <span className="text-[10px] text-navy-500 font-semibold">{cards.length}</span>
                </div>
                {!isLost && (
                  <p className="text-[10px] text-navy-500">{formatRupeesFromPaise(columnValue(stage))}</p>
                )}
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {cards.map((o) => {
                    const idx = stageIndex(line, o.stage);
                    const prev = idx > 0 ? STAGES_BY_LINE[line][idx - 1] : null;
                    const next = idx >= 0 && idx < STAGES_BY_LINE[line].length - 1 ? STAGES_BY_LINE[line][idx + 1] : null;
                    const busy = movingId === o.id;
                    return (
                      <div key={o.id} className="bg-white border border-navy-100 rounded-xl p-2.5 space-y-1.5 shadow-sm">
                        <p className="text-xs font-semibold text-navy-950 leading-snug">{o.title}</p>
                        {(o.household_name || o.customer_name) && (
                          <p className="text-[10px] text-navy-500">{o.household_name || o.customer_name}</p>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-navy-600">
                          <span className="font-bold text-navy-900">{formatRupeesFromPaise(o.amount)}</span>
                          <span>{o.probability}% prob</span>
                        </div>
                        {o.expected_close && (
                          <p className="text-[10px] text-navy-500">Expected close: {o.expected_close}</p>
                        )}
                        <div className="flex gap-1 pt-1">
                          {isLost ? (
                            <button
                              disabled={busy}
                              onClick={() => move(o, STAGES_BY_LINE[line][0])}
                              className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-navy-100 text-navy-800 hover:bg-navy-200 disabled:opacity-50"
                            >
                              Reopen
                            </button>
                          ) : (
                            <>
                              <button
                                disabled={busy || !prev}
                                onClick={() => prev && move(o, prev)}
                                title={prev ? `Move back to ${stageLabel(prev)}` : "First stage"}
                                className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-navy-50 text-navy-700 hover:bg-navy-100 disabled:opacity-40"
                              >
                                ← Back
                              </button>
                              <button
                                disabled={busy || !next}
                                onClick={() => next && move(o, next)}
                                title={next ? `Move to ${stageLabel(next)}` : "Final stage"}
                                className="flex-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
                              >
                                Forward →
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => move(o, "lost")}
                                title="Mark as lost"
                                className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40"
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
                    <p className="text-[10px] text-navy-400 text-center py-4">No opportunities here yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
