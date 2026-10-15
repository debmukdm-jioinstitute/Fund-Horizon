// TODO(owner-compliance-review): this file contains user-facing copy.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
import OwnerAvatar from "./OwnerAvatar";

/** Mirrors the server's transition map (the server stays authoritative). */
function moveError(line: ProductLine, from: string, to: string): string | null {
  const stages = STAGES_BY_LINE[line];
  if (from === to) return null;
  if (isClosedStage(from)) return `A ${from} opportunity is final and cannot move.`;
  if (to === "won" && from !== stages[stages.length - 2]) {
    return `Only an opportunity in “${stageLabel(stages[stages.length - 2])}” can be marked won.`;
  }
  return null;
}

const amountOf = (o: Opportunity) => (o.stage === "won" ? (o.won_amount ?? o.amount) : o.amount) ?? 0;

function OppCard({
  o, line, busy, onMove, onLose, overlay = false,
}: {
  o: Opportunity; line: ProductLine; busy: boolean; overlay?: boolean;
  onMove: (o: Opportunity, stage: string) => void; onLose: (o: Opportunity) => void;
}) {
  const closed = isClosedStage(o.stage);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: o.id, disabled: closed || overlay, data: { opp: o } });
  const stages = STAGES_BY_LINE[line];
  const idx = stages.indexOf(o.stage);
  const prev = !closed && idx > 0 ? stages[idx - 1] : null;
  const next = !closed && idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`bg-white dark:bg-[#171E27] border border-navy-100 dark:border-[#2B3644] rounded-xl p-2.5 space-y-1.5 shadow-sm ${
        isDragging ? "opacity-40" : ""
      } ${overlay ? "shadow-lg ring-2 ring-teal-500" : ""}`}
    >
      <div className="flex items-start gap-1.5">
        {!closed && !overlay && (
          <button
            type="button"
            aria-label={`Drag ${o.title}`}
            className="mt-0.5 cursor-grab touch-none select-none text-navy-400 hover:text-navy-700 dark:text-[#A8B4C4]"
            {...listeners}
            {...attributes}
          >
            ⋮⋮
          </button>
        )}
        <Link
          href={`/backoffice/crm/opportunities/${o.id}`}
          className="block text-xs font-semibold text-navy-950 dark:text-[#EDF2F7] leading-snug hover:underline"
        >
          {o.title}
        </Link>
      </div>
      {(o.household_name || o.customer_name) && (
        <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">{o.household_name || o.customer_name}</p>
      )}
      <div className="flex items-center justify-between text-xs text-navy-600 dark:text-[#A8B4C4]">
        <span className="font-bold text-navy-900 dark:text-[#EDF2F7]">{formatRupeesFromPaise(o.stage === "won" ? (o.won_amount ?? o.amount) : o.amount)}</span>
        <span>{o.probability}% prob</span>
      </div>
      <div className="text-xs text-navy-600 dark:text-[#A8B4C4]"><OwnerAvatar ownerId={o.assigned_rm_id} /></div>
      {o.stage === "lost" && o.lost_reason && <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">Reason: {o.lost_reason}</p>}
      {o.expected_close && !closed && <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">Expected close: {o.expected_close}</p>}
      {!overlay && (
        <div className="flex gap-1 pt-1">
          {closed ? (
            <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">
              {o.stage === "won" ? "Won" : "Lost"} {o.closed_at ? o.closed_at.slice(0, 10) : ""} · final
            </p>
          ) : (
            <>
              <button
                disabled={busy || !prev}
                onClick={() => prev && onMove(o, prev)}
                title={prev ? `Move back to ${stageLabel(prev)}` : "First stage"}
                className="flex-1 text-xs font-semibold px-2 py-1 rounded-lg bg-navy-50 dark:bg-[#24303E] text-navy-700 dark:text-[#EDF2F7] hover:bg-navy-100 disabled:opacity-40"
              >
                ← Back
              </button>
              <button
                disabled={busy || !next}
                onClick={() => next && onMove(o, next)}
                title={next ? `Move to ${stageLabel(next)}` : "Final stage"}
                className="flex-1 text-xs font-semibold px-2 py-1 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
              >
                Forward →
              </button>
              <button
                disabled={busy}
                onClick={() => onLose(o)}
                title="Mark as lost"
                className="text-xs font-semibold px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#24303E] text-gray-600 dark:text-[#EDF2F7] hover:bg-gray-200 disabled:opacity-40"
              >
                Lost
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Column({ stage, cards, dragging, line, children }: { stage: string; cards: Opportunity[]; dragging: Opportunity | null; line: ProductLine; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const invalid = dragging ? moveError(line, dragging.stage, stage) : null;
  const isLost = stage === "lost";
  const total = cards.reduce((s, o) => s + amountOf(o), 0);
  return (
    <div
      ref={setNodeRef}
      className={`w-64 shrink-0 rounded-2xl border p-3 space-y-2 transition-colors ${
        isOver ? (invalid || (dragging && isClosedStage(dragging.stage)) ? "border-rose-500 bg-rose-50/60 dark:bg-rose-950/30" : "border-teal-500 bg-teal-50/60 dark:bg-[#0F2A27]")
          : isLost ? "bg-gray-50 dark:bg-[#10151C] border-gray-200 dark:border-[#2B3644]" : "bg-white dark:bg-[#10151C] border-navy-200 dark:border-[#2B3644]"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-bold text-navy-950 dark:text-[#EDF2F7]">{stageLabel(stage)}</h3>
        <span className="text-xs text-navy-500 dark:text-[#A8B4C4] font-semibold">{cards.length}</span>
      </div>
      <p className="text-xs text-navy-500 dark:text-[#A8B4C4]">{formatRupeesFromPaise(total)}</p>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {children}
        {cards.length === 0 && <p className="text-xs text-navy-600 dark:text-[#A8B4C4] text-center py-4">No opportunities here yet.</p>}
      </div>
    </div>
  );
}

export default function PipelinesTab() {
  const [line, setLine] = useState<ProductLine>("mutual_fund");
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Opportunity | null>(null);
  const [losing, setLosing] = useState<Opportunity | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [lostError, setLostError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

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
    for (const o of opps) (map[o.stage] ??= []).push(o);
    return map;
  }, [opps, columns]);

  /** Optimistic move; reverts if the server refuses it. */
  const move = async (opp: Opportunity, newStage: string, extra?: { lost_reason?: string }): Promise<boolean> => {
    const blocked = moveError(line, opp.stage, newStage);
    if (blocked) {
      setError(blocked);
      return false;
    }
    setMovingId(opp.id);
    setError(null);
    const before = opps;
    if (!extra) setOpps((prev) => prev.map((o) => (o.id === opp.id ? { ...o, stage: newStage } : o)));
    try {
      const updated = await patchOpportunity(opp.id, { stage: newStage, ...extra });
      setOpps((prev) => prev.map((o) => (o.id === opp.id ? { ...o, ...updated } : o)));
      getPipeline(line).then((s) => setTotalValue(s.total_value)).catch(() => undefined);
      return true;
    } catch (e) {
      setOpps(before);
      setError(e instanceof ApiError ? e.message : "Stage move failed.");
      return false;
    } finally {
      setMovingId(null);
    }
  };

  const startLoss = (o: Opportunity) => {
    setLosing(o);
    setLostReason("");
    setLostError(null);
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

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.opp as Opportunity) ?? null);

  const onDragEnd = (e: DragEndEvent) => {
    const opp = e.active.data.current?.opp as Opportunity | undefined;
    setDragging(null);
    const target = e.over?.id ? String(e.over.id) : null;
    if (!opp || !target || target === opp.stage) return;
    if (target === "lost") {
      const blocked = moveError(line, opp.stage, target);
      if (blocked) setError(blocked);
      else startLoss(opp); // dropping on Lost always asks for a reason first
      return;
    }
    void move(opp, target);
  };

  const openCount = opps.filter((o) => !isClosedStage(o.stage)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRODUCT_LINES.map((p) => (
          <button
            key={p.value}
            onClick={() => setLine(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              line === p.value
                ? "bg-navy-900 text-white border-navy-900 dark:bg-[#0176D3] dark:border-[#0176D3]"
                : "bg-white dark:bg-[#171E27] text-navy-700 dark:text-[#EDF2F7] border-navy-200 dark:border-[#2B3644] hover:border-navy-400"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-navy-600 dark:text-[#A8B4C4]">
        <span>
          <strong className="text-navy-950 dark:text-[#EDF2F7]">{openCount}</strong> open opportunities
        </span>
        <span>
          Pipeline value (open): <strong className="text-navy-950 dark:text-[#EDF2F7]">{formatRupeesFromPaise(totalValue)}</strong>
        </span>
        <span className="hidden md:inline">Drag a card to another stage, or use the buttons.</span>
      </div>

      {error && (
        <div role="alert" className="bg-rose-100 dark:bg-rose-950/40 border border-rose-600/30 text-rose-700 dark:text-rose-300 text-xs rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading" className="p-16 text-center">
          <div className="inline-block animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((stage) => (
              <Column key={stage} stage={stage} cards={byStage[stage] ?? []} dragging={dragging} line={line}>
                {(byStage[stage] ?? []).map((o) => (
                  <OppCard key={o.id} o={o} line={line} busy={movingId === o.id} onMove={(opp, s) => void move(opp, s)} onLose={startLoss} />
                ))}
              </Column>
            ))}
          </div>
          <DragOverlay>{dragging ? <OppCard o={dragging} line={line} busy={false} overlay onMove={() => undefined} onLose={() => undefined} /> : null}</DragOverlay>
        </DndContext>
      )}

      {losing && (
        <div className="fixed inset-0 z-50 bg-navy-950/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mark opportunity lost">
          <div className="bg-white dark:bg-[#10151C] rounded-2xl border border-navy-100 dark:border-[#2B3644] shadow-xl w-full max-w-md p-6 space-y-3">
            <h3 className="text-base font-bold text-navy-950 dark:text-[#EDF2F7]">Mark “{losing.title}” as lost</h3>
            <label className="block text-xs font-semibold text-navy-700 dark:text-[#EDF2F7]" htmlFor="lost-reason">
              Reason (required)
            </label>
            <textarea
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
              autoFocus
              className="w-full px-3 py-2 text-xs rounded-xl border border-navy-200 dark:border-[#2B3644] bg-white dark:bg-[#171E27] text-navy-900 dark:text-[#EDF2F7] focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {lostError && <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{lostError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setLosing(null)} className="flex-1 px-3 py-2 text-xs font-semibold bg-navy-50 dark:bg-[#24303E] hover:bg-navy-100 text-navy-700 dark:text-[#EDF2F7] rounded-xl transition">
                Cancel
              </button>
              <button type="button" onClick={confirmLost} disabled={movingId === losing.id} className="flex-1 px-3 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl transition">
                Mark lost
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
