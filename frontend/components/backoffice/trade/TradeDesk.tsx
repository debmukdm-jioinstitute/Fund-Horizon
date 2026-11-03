"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  getTradeDesk,
  patchTradeConfig,
  tradeApprove,
  tradeEntry,
  tradeFill,
  tradePlan,
  tradeReset,
  tradeRisk,
  tradeScanDaily,
  tradeScanOrb,
  tradeSize,
  tradeTickets,
  tradeTimeMachine,
  TradeDeskData,
  TradeHit,
  TradeTicket,
} from "@/lib/backoffice";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

type Tab = "scanner" | "entry" | "plan" | "timemachine" | "risk" | "tickets" | "portfolio";

const TABS: { id: Tab; label: string }[] = [
  { id: "scanner", label: "Scanner" },
  { id: "entry", label: "Entry" },
  { id: "plan", label: "Exit plan" },
  { id: "timemachine", label: "Time machine" },
  { id: "risk", label: "Budget & risk" },
  { id: "tickets", label: "Tickets" },
  { id: "portfolio", label: "Paper book" },
];

function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

function num(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(n);
}

export default function TradeDesk() {
  const [desk, setDesk] = useState<TradeDeskData | null>(null);
  const [tab, setTab] = useState<Tab>("scanner");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("RELIANCE");
  const [orbAt, setOrbAt] = useState("10:15");
  const [yesText, setYesText] = useState("yes");
  const [tickets, setTickets] = useState<TradeTicket[]>([]);
  const [budget, setBudget] = useState("500000");
  const [maxLoss, setMaxLoss] = useState("5000");
  const [rowsShown, setRowsShown] = useState(DEFAULT_PAGE_SIZE);

  const refresh = useCallback(async () => {
    const d = await getTradeDesk();
    setDesk(d);
    if (d.config?.budget != null) setBudget(String(d.config.budget));
    if (d.config?.max_loss_per_trade_inr != null) setMaxLoss(String(d.config.max_loss_per_trade_inr));
    try {
      const t = await tradeTickets();
      setTickets(t.tickets || []);
    } catch {
      setTickets([]);
    }
  }, []);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (e: unknown) {
        if (!stale) setError(e instanceof Error ? e.message : "Failed to load Trade desk");
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [refresh]);

  async function run(fn: () => Promise<unknown>) {
    try {
      setBusy(true);
      setError(null);
      await fn();
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const hits: TradeHit[] = (desk?.watchlist?.hits as TradeHit[]) || [];
  const shown = hits.slice(0, rowsShown);
  const plan = desk?.plan;
  const entry = desk?.entry;
  const tm = desk?.timemachine;
  const risk = desk?.risk;
  const orders = desk?.orders;
  const session = desk?.session;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[#032D60] dark:text-white">Trade</h1>
          <p className="mt-0.5 text-sm text-[#44546A] dark:text-[#AEAEB2]">
            NSE cash day desk — scanner through paper tickets. Asia/Kolkata session 09:15–15:30.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded border border-[#0176D3]/40 px-2 py-1 text-[#0176D3] dark:text-[#1B96FF]">
            {session?.market || "NSE"} · {session?.currency || "INR"} · paper
          </span>
          <span className="text-[#706E6B] dark:text-[#AEAEB2]">
            Open {session?.open || "09:15"} · Close {session?.close || "15:30"} IST
          </span>
          <button
            type="button"
            className="terminal-btn"
            disabled={busy}
            onClick={() => run(() => tradeReset())}
          >
            Reset desk
          </button>
        </div>
      </div>

      {desk?.disclaimer && (
        <p className="text-xs text-[#706E6B] dark:text-[#8E8E93]">{desk.disclaimer}</p>
      )}

      {error && (
        <div className="rounded border border-[#BA0517]/40 bg-[#FEF1EE] px-3 py-2 text-sm text-[#BA0517] dark:bg-[#2A1215] dark:text-[#FE8F7D]">
          {error}
        </div>
      )}

      <div className="terminal-panel space-y-3 p-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-[#706E6B]">Budget ₹</span>
            <input
              className="w-28 rounded border border-[#C9C9C9] bg-white px-2 py-1 dark:border-[#3E3E3E] dark:bg-[#1C1C1E]"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[#706E6B]">Max loss / trade ₹</span>
            <input
              className="w-24 rounded border border-[#C9C9C9] bg-white px-2 py-1 dark:border-[#3E3E3E] dark:bg-[#1C1C1E]"
              value={maxLoss}
              onChange={(e) => setMaxLoss(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="terminal-btn"
            disabled={busy}
            onClick={() =>
              run(() =>
                patchTradeConfig({
                  budget: Number(budget),
                  max_loss_per_trade_inr: Number(maxLoss),
                  paper: true,
                }),
              )
            }
          >
            Save rules
          </button>
          <label className="flex items-center gap-2">
            <span className="text-[#706E6B]">Symbol</span>
            <input
              className="w-32 rounded border border-[#C9C9C9] bg-white px-2 py-1 uppercase dark:border-[#3E3E3E] dark:bg-[#1C1C1E]"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-[#E5E5E5] dark:border-[#3E3E3E]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm ${
                tab === t.id
                  ? "border-b-2 border-[#0176D3] font-medium text-[#0176D3] dark:border-[#1B96FF] dark:text-[#1B96FF]"
                  : "text-[#44546A] dark:text-[#AEAEB2]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-[#706E6B]">Loading Trade desk…</p>
        ) : (
          <>
            {tab === "scanner" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="terminal-btn"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        tradeScanDaily({
                          symbols: [symbol],
                          universe: "demo",
                          min_volume: 0,
                          min_price: 1,
                        }),
                      )
                    }
                  >
                    Daily scan ({symbol})
                  </button>
                  <label className="flex items-center gap-1 text-sm">
                    ORB at
                    <input
                      className="w-16 rounded border border-[#C9C9C9] bg-white px-1 py-0.5 dark:border-[#3E3E3E] dark:bg-[#1C1C1E]"
                      value={orbAt}
                      onChange={(e) => setOrbAt(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="terminal-btn"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        tradeScanOrb({
                          symbols: [symbol],
                          at: orbAt,
                          now: `2026-10-19 ${orbAt}`,
                          min_price: 1,
                        }),
                      )
                    }
                  >
                    ORB scan
                  </button>
                  <span className="text-xs text-[#706E6B] self-center">
                    Inject bars via API for offline scans; live Yahoo needs FH_TRADE_LIVE=1.
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span>Rows</span>
                  <select
                    className="rounded border border-[#C9C9C9] bg-white px-2 py-1 dark:border-[#3E3E3E] dark:bg-[#1C1C1E]"
                    value={rowsShown}
                    onChange={(e) => setRowsShown(Number(e.target.value))}
                  >
                    {[25, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="text-[#706E6B]">
                    {hits.length} hit{hits.length === 1 ? "" : "s"}
                    {desk?.watchlist?.mode ? ` · ${desk.watchlist.mode}` : ""}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-[#706E6B]">
                      <tr>
                        <th className="py-1 pr-3">Symbol</th>
                        <th className="py-1 pr-3">Setups</th>
                        <th className="py-1 pr-3 tabular-nums">Price</th>
                        <th className="py-1 pr-3">ORB</th>
                        <th className="py-1 pr-3 tabular-nums">RSI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-3 text-[#706E6B]">
                            No hits yet. Inject NSE bars, then run a daily or ORB scan.
                          </td>
                        </tr>
                      ) : (
                        shown.map((h) => (
                          <tr
                            key={`${h.symbol}-${h.setups.join(",")}-${h.at || ""}`}
                            className="border-t border-[#F3F3F3] dark:border-[#2C2C2E] cursor-pointer hover:bg-[#F3F3F3]/60 dark:hover:bg-[#2C2C2E]/40"
                            onClick={() => setSymbol(h.symbol)}
                          >
                            <td className="py-1.5 pr-3 font-medium">{h.symbol}</td>
                            <td className="py-1.5 pr-3">{h.setups.join(", ")}</td>
                            <td className="py-1.5 pr-3 tabular-nums">{num(h.price)}</td>
                            <td className="py-1.5 pr-3 text-xs">
                              {h.or_high != null
                                ? `${num(h.or_low)}–${num(h.or_high)}${h.pct_over != null ? ` (+${num(h.pct_over)}%)` : ""}${h.at ? ` @ ${h.at}` : ""}`
                                : "—"}
                            </td>
                            <td className="py-1.5 pr-3 tabular-nums">{h.rsi != null ? num(h.rsi, 1) : "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {desk?.watchlist?.note && (
                  <p className="text-xs text-[#706E6B]">{desk.watchlist.note}</p>
                )}
              </div>
            )}

            {tab === "entry" && (
              <div className="space-y-3">
                <button
                  type="button"
                  className="terminal-btn"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      tradeEntry({
                        symbol,
                        setup: "orb",
                        now: "2026-10-19 10:15",
                      }),
                    )
                  }
                >
                  Check ORB entry · {symbol}
                </button>
                {entry ? (
                  <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                    <div>
                      <dt className="text-[#706E6B]">Status</dt>
                      <dd className="font-medium">{String(entry.status)}</dd>
                    </div>
                    <div>
                      <dt className="text-[#706E6B]">Price</dt>
                      <dd className="tabular-nums">{entry.price != null ? num(Number(entry.price)) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[#706E6B]">Level</dt>
                      <dd className="tabular-nums">{entry.level != null ? num(Number(entry.level)) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[#706E6B]">Time</dt>
                      <dd>{String(entry.time || "—")}</dd>
                    </div>
                    <div className="col-span-2 md:col-span-4">
                      <dt className="text-[#706E6B]">Reason</dt>
                      <dd>{String(entry.reason || "")}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-[#706E6B]">No entry check yet.</p>
                )}
              </div>
            )}

            {tab === "plan" && (
              <div className="space-y-3">
                <button
                  type="button"
                  className="terminal-btn"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      tradePlan({
                        symbol,
                        stop: "or-mid",
                        target: "1R",
                      }),
                    )
                  }
                >
                  Build exit plan (or-mid / 1R)
                </button>
                {plan ? (
                  <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                    {(
                      [
                        ["Symbol", String(plan.symbol ?? "—")],
                        ["Entry", plan.entry != null ? inr(Number(plan.entry)) : "—"],
                        ["Stop", plan.stop != null ? inr(Number(plan.stop)) : "—"],
                        ["Target", plan.target != null ? inr(Number(plan.target)) : "—"],
                        ["Risk / share", plan.risk_per_share != null ? inr(Number(plan.risk_per_share)) : "—"],
                        ["R:R", plan.reward_risk != null ? num(Number(plan.reward_risk)) : "—"],
                        ["Flat by", String(plan.flat_by ?? "—")],
                        ["Stop rule", String(plan.stop_label || plan.stop_rule || "—")],
                      ] as [string, string][]
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[#706E6B]">{k}</dt>
                        <dd className="font-medium tabular-nums">{v}</dd>
                      </div>
                    ))}
                    {plan.note ? (
                      <p className="col-span-full text-xs text-[#706E6B]">{String(plan.note)}</p>
                    ) : null}
                  </dl>
                ) : (
                  <p className="text-sm text-[#706E6B]">Trigger an entry (or pass prices) before planning.</p>
                )}
              </div>
            )}

            {tab === "timemachine" && (
              <div className="space-y-3">
                <button
                  type="button"
                  className="terminal-btn"
                  disabled={busy}
                  onClick={() => run(() => tradeTimeMachine({ replays: 2000, seed: 19 }))}
                >
                  Replay 2,000 paths
                </button>
                {tm ? (
                  <div className="space-y-2 text-sm">
                    <p className="text-base font-medium text-[#032D60] dark:text-white">{tm.verdict}</p>
                    {(tm.verdict_notes || []).map((n) => (
                      <p key={n} className="text-xs text-[#706E6B]">
                        {n}
                      </p>
                    ))}
                    {tm.mc && (
                      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        {[
                          ["P(target)", tm.mc.p_target],
                          ["P(stop)", tm.mc.p_stop],
                          ["P(neither)", tm.mc.p_neither],
                          ["Avg R", tm.mc.avg_R],
                        ].map(([k, v]) => (
                          <div key={String(k)}>
                            <dt className="text-[#706E6B]">{k}</dt>
                            <dd className="tabular-nums font-medium">
                              {typeof v === "number" && String(k).startsWith("P")
                                ? `${(v * 100).toFixed(1)}%`
                                : num(v as number, 3)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[#706E6B]">
                    Needs a plan plus 60 trading days of 5-minute bars (inject bars_60d).
                  </p>
                )}
              </div>
            )}

            {tab === "risk" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="terminal-btn" disabled={busy} onClick={() => run(() => tradeSize())}>
                    Size bracket
                  </button>
                  <button
                    type="button"
                    className="terminal-btn"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        tradeRisk(
                          plan?.date
                            ? `${String(plan.date)} ${String(plan.entry_time || "10:15").replace(/(AM|PM)/i, "").trim() || "10:15"}`
                            : undefined,
                        ),
                      )
                    }
                  >
                    Risk check
                  </button>
                </div>
                {orders?.sizing && (
                  <p className="text-sm">
                    Size: <span className="font-medium tabular-nums">{String(orders.sizing.qty ?? 0)}</span> shares · bound by{" "}
                    {String(orders.sizing.bound_by || "—")}
                    {orders.sizing.refusal ? (
                      <span className="block text-[#BA0517]">{String(orders.sizing.refusal)}</span>
                    ) : null}
                  </p>
                )}
                {risk ? (
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-[#087744]">{risk.pass ?? 0} PASS</span>
                      {" · "}
                      <span className="text-[#BA0517]">{risk.block ?? 0} BLOCK</span>
                    </p>
                    <ul className="space-y-1">
                      {(risk.results || []).map((r) => (
                        <li key={r.fingerprint} className="rounded border border-[#E5E5E5] px-2 py-1 dark:border-[#3E3E3E]">
                          <span className={r.verdict === "PASS" ? "text-[#087744]" : "text-[#BA0517]"}>
                            {r.verdict}
                          </span>{" "}
                          {r.plain || r.symbol}
                          {r.reasons?.length ? (
                            <span className="block text-xs text-[#706E6B]">{r.reasons.join("; ")}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-[#706E6B]">Size an order, then run risk.</p>
                )}
              </div>
            )}

            {tab === "tickets" && (
              <div className="space-y-3">
                {tickets.length === 0 ? (
                  <p className="text-sm text-[#706E6B]">No tickets. Size + risk PASS first.</p>
                ) : (
                  tickets.map((t) => (
                    <div key={t.fingerprint} className="rounded border border-[#E5E5E5] p-3 dark:border-[#3E3E3E]">
                      <p className="text-sm font-medium">{t.plain}</p>
                      <p className="mt-1 text-xs text-[#706E6B]">{t.status}</p>
                      {t.ready && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            className="w-48 rounded border border-[#C9C9C9] bg-white px-2 py-1 text-sm dark:border-[#3E3E3E] dark:bg-[#1C1C1E]"
                            value={yesText}
                            onChange={(e) => setYesText(e.target.value)}
                            placeholder='type "yes"'
                          />
                          <button
                            type="button"
                            className="terminal-btn"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                const a = await tradeApprove(t.index, yesText);
                                if (!a.ok) throw new Error(a.reason || "not approved");
                                const fillPx = Number(t.order.plan?.entry || t.order.limit_price || 0);
                                const f = await tradeFill(t.index, fillPx || undefined);
                                if (!f.ok) throw new Error(f.reason || "fill failed");
                              })
                            }
                          >
                            Approve & paper-fill
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "portfolio" && (
              <div className="space-y-3 text-sm">
                <p>
                  Cash: <span className="font-medium tabular-nums">{inr(desk?.portfolio?.cash)}</span>
                </p>
                <table className="min-w-full text-left">
                  <thead className="text-[#706E6B]">
                    <tr>
                      <th className="py-1 pr-3">Symbol</th>
                      <th className="py-1 pr-3 tabular-nums">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(desk?.portfolio?.positions || {}).length === 0 ? (
                      <tr>
                        <td colSpan={2} className="py-2 text-[#706E6B]">
                          Flat — no open paper positions.
                        </td>
                      </tr>
                    ) : (
                      Object.entries(desk?.portfolio?.positions || {}).map(([s, q]) => (
                        <tr key={s} className="border-t border-[#F3F3F3] dark:border-[#2C2C2E]">
                          <td className="py-1.5 pr-3">{s}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{num(q, 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <p className="text-xs text-[#706E6B]">
                  Broker log: {(desk?.broker?.orders || []).length} event
                  {(desk?.broker?.orders || []).length === 1 ? "" : "s"} today-ish (paper).
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
