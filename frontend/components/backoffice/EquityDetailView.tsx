"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  EquityBasket,
  EquityChartData,
  EquityScripDetail,
  getEquityChart,
  getEquityDetail,
} from "@/lib/backoffice";
import { formatNumber } from "@/lib/terminal-format";

interface Props {
  symbol: string;
  onClose: () => void;
  baskets: EquityBasket[];
  activeBasketId?: string;
  onAddStockToBasket?: (basketId: string, symbol: string) => void;
}

const RANGES = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "5Y", value: "5y" },
  { label: "ALL", value: "max" },
];

const inr = (v?: number | null, decimals = 2) =>
  v === undefined || v === null ? "—" : formatNumber(v, decimals, { prefix: "₹" });

const pct = (v?: number | null) =>
  v === undefined || v === null ? "—" : `${v >= 0 ? "+" : ""}${formatNumber(v, 2)}%`;

const tone = (v?: number | null) =>
  v === undefined || v === null ? "text-[#81878C]" : v >= 0 ? "text-[#1EA672]" : "text-[#E5484D]";

function RangeBar({ low, high, current, label }: { low?: number | null; high?: number | null; current?: number | null; label: string }) {
  if (low == null || high == null || current == null || high <= low) {
    return (
      <div className="rounded border border-[#E8EBED] bg-white p-3">
        <div className="text-xs text-[#81878C]">{label}</div>
        <div className="mt-1 text-sm font-medium">{inr(current)}</div>
      </div>
    );
  }
  const pctPos = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100));
  return (
    <div className="rounded border border-[#E8EBED] bg-white p-3">
      <div className="flex items-center justify-between text-xs text-[#81878C]">
        <span>{label}</span>
        <span className="font-medium text-[#2F363F]">{inr(current)}</span>
      </div>
      <div className="relative mt-2.5 h-1.5 w-full rounded-full bg-[#E8EBED]">
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#1F7AE0] shadow"
          style={{ left: `${pctPos}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[#81878C]">
        <span>L: {inr(low)}</span>
        <span>H: {inr(high)}</span>
      </div>
    </div>
  );
}

function MiniSvgChart({ data, range }: { data: EquityChartData; range: string }) {
  const gradientId = useId();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const candles = data.candles;

  const validCandles = useMemo(() => candles.filter((c) => c.close != null && c.close > 0), [candles]);

  if (!validCandles.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-dashed border-[#D5D9DD] text-sm text-[#81878C]">
        Historical price chart unavailable for {data.symbol}
      </div>
    );
  }

  const closes = validCandles.map((c) => c.close);
  const minVal = Math.min(...closes);
  const maxVal = Math.max(...closes);
  const rangeVal = maxVal - minVal || 1;
  const paddingY = rangeVal * 0.08;
  const chartMin = minVal - paddingY;
  const chartMax = maxVal + paddingY;
  const chartRange = chartMax - chartMin;

  const w = 800;
  const h = 260;

  const points = validCandles.map((c, i) => {
    const x = (i / (validCandles.length - 1 || 1)) * w;
    const y = h - ((c.close - chartMin) / chartRange) * h;
    return { x, y, c };
  });

  const pathD = points.reduce((acc, p, i) => (i === 0 ? `M ${p.x.toFixed(1)},${p.y.toFixed(1)}` : `${acc} L ${p.x.toFixed(1)},${p.y.toFixed(1)}`), "");
  const areaD = `${pathD} L ${w},${h} L 0,${h} Z`;

  const isPos = data.period_change >= 0;
  const strokeColor = isPos ? "#1EA672" : "#E5484D";
  const fillColor = isPos ? "#1EA672" : "#E5484D";

  const activePoint = hoverIdx !== null && points[hoverIdx] ? points[hoverIdx] : points[points.length - 1];
  const activeCandle = activePoint.c;
  const firstCandle = validCandles[0];
  const activeDiff = activeCandle.close - firstCandle.close;
  const activeDiffPct = firstCandle.close > 0 ? (activeDiff / firstCandle.close) * 100 : 0;

  const formatDate = (epochSec: number) => {
    const d = new Date(epochSec * 1000);
    if (range === "1d" || range === "5d") {
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      });
    }
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  };

  return (
    <div className="relative">
      {/* Interactive HUD */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-semibold tracking-tight text-[#2F363F]">{inr(activeCandle.close)}</span>
          <span className={`text-sm font-medium ${tone(activeDiff)}`}>
            {activeDiff >= 0 ? "+" : ""}{formatNumber(activeDiff, 2)} ({pct(activeDiffPct)})
          </span>
          <span className="text-xs text-[#81878C]">over {range.toUpperCase()}</span>
        </div>
        <div className="text-xs text-[#81878C]">
          <span>{formatDate(activeCandle.time)}</span>
          {activeCandle.volume > 0 && <span className="ml-2 font-medium text-[#535B62]">Vol: {formatNumber(activeCandle.volume, 0)}</span>}
        </div>
      </div>

      <div
        className="relative h-64 w-full touch-none select-none overflow-hidden rounded bg-[#FAFBFC] cursor-crosshair border border-[#E8EBED]"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
          const idx = Math.round((px / rect.width) * (points.length - 1));
          setHoverIdx(idx);
        }}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={fillColor} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line x1="0" y1={h * 0.25} x2={w} y2={h * 0.25} stroke="#E8EBED" strokeDasharray="3 3" />
          <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} stroke="#E8EBED" strokeDasharray="3 3" />
          <line x1="0" y1={h * 0.75} x2={w} y2={h * 0.75} stroke="#E8EBED" strokeDasharray="3 3" />

          {/* Area and Line */}
          <path d={areaD} fill={`url(#${gradientId})`} />
          <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Hover indicator */}
          {activePoint && (
            <>
              <line x1={activePoint.x} y1="0" x2={activePoint.x} y2={h} stroke="#81878C" strokeWidth="1" strokeDasharray="2 2" />
              <circle cx={activePoint.x} cy={activePoint.y} r="4.5" fill={strokeColor} stroke="#FFFFFF" strokeWidth="2" />
            </>
          )}
        </svg>

        {/* Labels on y axis */}
        <div className="pointer-events-none absolute bottom-1 right-2 text-[10px] text-[#81878C]">L: {inr(minVal)}</div>
        <div className="pointer-events-none absolute right-2 top-1 text-[10px] text-[#81878C]">H: {inr(maxVal)}</div>
      </div>
    </div>
  );
}

export default function EquityDetailView({
  symbol,
  onClose,
  baskets,
  activeBasketId,
  onAddStockToBasket,
}: Props) {
  const [detail, setDetail] = useState<EquityScripDetail | null>(null);
  const [chartData, setChartData] = useState<EquityChartData | null>(null);
  const [range, setRange] = useState("1y");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "financials" | "ownership" | "profile">("overview");
  const [expandSummary, setExpandSummary] = useState(false);
  const [targetBasketId, setTargetBasketId] = useState(activeBasketId || (baskets[0]?.id ?? ""));
  const [addMsg, setAddMsg] = useState<string | null>(null);

  // Fetch company details
  const loadDetail = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setErr(null);
    try {
      const d = await getEquityDetail(symbol, signal);
      setDetail(d);
    } catch (e) {
      if (!signal?.aborted) setErr(e instanceof Error ? e.message : "Scrip detail fetch failed");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [symbol]);

  // Fetch chart data on symbol or range change
  const loadChart = useCallback(async (r: string, signal?: AbortSignal) => {
    setChartLoading(true);
    try {
      const cd = await getEquityChart(symbol, r, signal);
      setChartData(cd);
    } catch {
      // chart fail silent fallback
    } finally {
      if (!signal?.aborted) setChartLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    const ac = new AbortController();
    loadDetail(ac.signal);
    return () => ac.abort();
  }, [loadDetail]);

  useEffect(() => {
    const ac = new AbortController();
    loadChart(range, ac.signal);
    return () => ac.abort();
  }, [loadChart, range]);

  const activeBasket = baskets.find((b) => b.id === (activeBasketId || targetBasketId));
  const isAlreadyInBasket = activeBasket?.symbols.includes(symbol);
  const holding = activeBasket?.holdings[symbol];

  const handleAdd = () => {
    if (!targetBasketId || !onAddStockToBasket) return;
    onAddStockToBasket(targetBasketId, symbol);
    setAddMsg(`Added ${symbol} to "${baskets.find((b) => b.id === targetBasketId)?.name ?? "basket"}"`);
    setTimeout(() => setAddMsg(null), 3000);
  };

  const ext = detail?.external_links;

  return (
    <div className="space-y-6">
      {/* Top navigation & action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8EBED] pb-4">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1F7AE0] hover:underline"
        >
          <span>←</span> Back to Baskets
        </button>

        <div className="flex flex-wrap items-center gap-3">
          {baskets.length > 0 && onAddStockToBasket && (
            <div className="flex items-center gap-2">
              <select
                value={targetBasketId}
                onChange={(e) => setTargetBasketId(e.target.value)}
                className="rounded border border-[#D5D9DD] bg-white px-3 py-1.5 text-sm text-[#2F363F] outline-none focus:border-[#1F7AE0]"
              >
                {baskets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.symbols.length} stocks)
                  </option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                className="rounded bg-[#17408B] px-3.5 py-1.5 text-sm font-medium text-white hover:bg-[#12336f]"
              >
                {isAlreadyInBasket ? "In basket ✓" : "+ Add to basket"}
              </button>
            </div>
          )}
          <button
            onClick={() => {
              loadDetail();
              loadChart(range);
            }}
            className="rounded border border-[#D5D9DD] bg-white px-3 py-1.5 text-sm text-[#535B62] hover:bg-[#F2F7FD]"
            title="Refresh prices"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {addMsg && (
        <div className="rounded border border-[#1EA672] bg-[#E8F8F1] px-4 py-2.5 text-sm font-medium text-[#0E6240]">
          {addMsg}
        </div>
      )}

      {err && (
        <div className="rounded border border-[#FAD8D8] bg-[#FDF2F2] p-4 text-sm text-[#E5484D]">
          {err}
        </div>
      )}

      {loading && !detail ? (
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 rounded bg-[#E8EBED]" />
          <div className="h-4 w-96 rounded bg-[#E8EBED]" />
          <div className="h-64 rounded bg-[#E8EBED]" />
        </div>
      ) : detail ? (
        <div className="space-y-6">
          {/* Scrip Header */}
          <div className="rounded border border-[#E8EBED] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-[#2F363F]">{detail.name}</h2>
                  <span className="rounded bg-[#F2F7FD] px-2.5 py-0.5 text-xs font-medium text-[#1F7AE0]">
                    NSE: {detail.symbol}
                  </span>
                  {detail.profile.sector && (
                    <span className="rounded border border-[#E8EBED] px-2 py-0.5 text-xs text-[#81878C]">
                      {detail.profile.sector}
                    </span>
                  )}
                  {detail.profile.industry && (
                    <span className="rounded border border-[#E8EBED] px-2 py-0.5 text-xs text-[#81878C]">
                      {detail.profile.industry}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-baseline gap-3">
                  <span className="text-3xl font-semibold tracking-tight text-[#2F363F]">
                    {inr(detail.price)}
                  </span>
                  <span className={`text-base font-medium ${tone(detail.change)}`}>
                    {detail.change != null ? (detail.change >= 0 ? "+" : "") + formatNumber(detail.change, 2) : ""}
                    {" "}
                    ({pct(detail.change_pct)})
                  </span>
                  {detail.prev_close != null && (
                    <span className="text-xs text-[#81878C]">Prev close: {inr(detail.prev_close)}</span>
                  )}
                </div>
              </div>

              {/* In-basket badge if holding exists */}
              {holding && holding.qty != null && (
                <div className="rounded border border-[#1F7AE0]/30 bg-[#F2F7FD] p-3 text-right text-xs">
                  <div className="font-medium text-[#1F7AE0]">Holding in this basket</div>
                  <div className="mt-1 text-sm font-semibold text-[#2F363F]">
                    {holding.qty} shares @ {inr(holding.buy_price)}
                  </div>
                  {detail.price != null && (
                    <div className="mt-0.5 text-[#535B62]">
                      Value: {inr(holding.qty * detail.price)} · P&amp;L:{" "}
                      <span className={tone(holding.buy_price ? holding.qty * (detail.price - holding.buy_price) : 0)}>
                        {inr(holding.buy_price ? holding.qty * (detail.price - holding.buy_price) : 0)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Range comparison bars */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <RangeBar
                label="Day's Range"
                low={detail.day_low}
                high={detail.day_high}
                current={detail.price}
              />
              <RangeBar
                label="52-Week Range"
                low={detail.low_52w}
                high={detail.high_52w}
                current={detail.price}
              />
            </div>

            {/* External research tools strip */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E8EBED] pt-3 text-xs">
              <span className="font-medium text-[#81878C]">Research links:</span>
              {ext?.screener && (
                <a
                  href={ext.screener}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-[#E8EBED] bg-[#FAFBFC] px-2.5 py-1 text-[#1F7AE0] hover:bg-[#F2F7FD]"
                >
                  Screener.in ↗
                </a>
              )}
              {ext?.tradingview && (
                <a
                  href={ext.tradingview}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-[#E8EBED] bg-[#FAFBFC] px-2.5 py-1 text-[#1F7AE0] hover:bg-[#F2F7FD]"
                >
                  TradingView ↗
                </a>
              )}
              {ext?.nse && (
                <a
                  href={ext.nse}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-[#E8EBED] bg-[#FAFBFC] px-2.5 py-1 text-[#1F7AE0] hover:bg-[#F2F7FD]"
                >
                  NSE India ↗
                </a>
              )}
              {ext?.google && (
                <a
                  href={ext.google}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-[#E8EBED] bg-[#FAFBFC] px-2.5 py-1 text-[#1F7AE0] hover:bg-[#F2F7FD]"
                >
                  Google Finance ↗
                </a>
              )}
              {ext?.yahoo && (
                <a
                  href={ext.yahoo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-[#E8EBED] bg-[#FAFBFC] px-2.5 py-1 text-[#1F7AE0] hover:bg-[#F2F7FD]"
                >
                  Yahoo Finance ↗
                </a>
              )}
            </div>
          </div>

          {/* Price Chart Section */}
          <div className="rounded border border-[#E8EBED] bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#E8EBED] pb-3">
              <h3 className="text-base font-semibold text-[#2F363F]">Historical Price &amp; Performance</h3>
              <div className="flex items-center gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRange(r.value)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      range === r.value
                        ? "bg-[#1F7AE0] text-white"
                        : "text-[#535B62] hover:bg-[#F2F7FD] hover:text-[#1F7AE0]"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {chartLoading ? (
              <div className="flex h-64 items-center justify-center text-sm text-[#81878C]">Loading chart…</div>
            ) : chartData ? (
              <MiniSvgChart data={chartData} range={range} />
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-[#81878C]">Chart unavailable</div>
            )}
          </div>

          {/* Research Sub-tabs */}
          <div className="flex items-center gap-6 border-b border-[#E8EBED] text-sm">
            {(
              [
                { id: "overview", label: "Key Metrics & Valuation" },
                { id: "financials", label: "Financials & Trends" },
                { id: "ownership", label: "Shareholding & Consensus" },
                { id: "profile", label: "About & Leadership" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 pb-3 font-medium transition-colors ${
                  tab === t.id
                    ? "border-[#1F7AE0] text-[#1F7AE0]"
                    : "border-transparent text-[#535B62] hover:text-[#2F363F]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab 1: Overview & Valuation */}
          {tab === "overview" && (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Valuation Ratios */}
              <div className="rounded border border-[#E8EBED] bg-white p-5">
                <h4 className="text-sm font-semibold text-[#2F363F]">Valuation &amp; Multiples</h4>
                <dl className="mt-4 divide-y divide-[#E8EBED] text-sm">
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Market Capitalization</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.market_cap_fmt || inr(detail.market_cap)}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">P/E Ratio (Trailing TTM)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.pe_trailing != null ? formatNumber(detail.pe_trailing, 2) : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Forward P/E</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.pe_forward != null ? formatNumber(detail.pe_forward, 2) : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Price to Book (P/B)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.pb_ratio != null ? formatNumber(detail.pb_ratio, 2) : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Price to Sales (P/S)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.ps_ratio != null ? formatNumber(detail.ps_ratio, 2) : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">PEG Ratio</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.peg_ratio != null ? formatNumber(detail.peg_ratio, 2) : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Enterprise Value (EV)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.ev_fmt || inr(detail.ev)}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">EV / EBITDA</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.ev_to_ebitda != null ? formatNumber(detail.ev_to_ebitda, 2) : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Beta (Volatility vs Market)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.beta != null ? formatNumber(detail.beta, 2) : "—"}</dd>
                  </div>
                </dl>
              </div>

              {/* Profitability & Financial Health */}
              <div className="rounded border border-[#E8EBED] bg-white p-5">
                <h4 className="text-sm font-semibold text-[#2F363F]">Profitability &amp; Financial Health</h4>
                <dl className="mt-4 divide-y divide-[#E8EBED] text-sm">
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Return on Equity (ROE)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.roe != null ? `${formatNumber(detail.roe * 100, 2)}%` : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Return on Assets (ROA)</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.roa != null ? `${formatNumber(detail.roa * 100, 2)}%` : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Operating Margin</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.operating_margin != null ? `${formatNumber(detail.operating_margin * 100, 2)}%` : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Net Profit Margin</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.profit_margin != null ? `${formatNumber(detail.profit_margin * 100, 2)}%` : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Debt to Equity</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.debt_to_equity != null ? `${formatNumber(detail.debt_to_equity, 2)}%` : "—"}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Total Debt</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.total_debt_fmt || inr(detail.total_debt)}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Total Cash &amp; Equiv.</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.total_cash_fmt || inr(detail.total_cash)}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Free Cash Flow</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.free_cashflow_fmt || inr(detail.free_cashflow)}</dd>
                  </div>
                  <div className="flex justify-between py-2.5">
                    <dt className="text-[#81878C]">Dividend Yield</dt>
                    <dd className="font-medium text-[#2F363F]">{detail.dividend_yield != null ? `${formatNumber(detail.dividend_yield * 100, 2)}%` : "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          )}

          {/* Tab 2: Financials & Trends */}
          {tab === "financials" && (
            <div className="space-y-6">
              {/* Annual Financials Table */}
              <div className="rounded border border-[#E8EBED] bg-white p-5">
                <h4 className="text-sm font-semibold text-[#2F363F]">Annual Revenue &amp; Net Earnings Trend</h4>
                {detail.earnings_history.length > 0 ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[#E8EBED] text-xs text-[#81878C]">
                          <th className="py-2.5 pr-4">Fiscal Year</th>
                          <th className="py-2.5 pr-4 text-right">Revenue</th>
                          <th className="py-2.5 pr-4 text-right">Net Profit</th>
                          <th className="py-2.5 text-right">Net Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8EBED]">
                        {detail.earnings_history.map((y) => {
                          const margin = y.revenue && y.earnings ? (y.earnings / y.revenue) * 100 : null;
                          return (
                            <tr key={String(y.year)}>
                              <td className="py-3 pr-4 font-medium text-[#2F363F]">FY {y.year}</td>
                              <td className="py-3 pr-4 text-right">{inr(y.revenue)}</td>
                              <td className="py-3 pr-4 text-right font-medium">{inr(y.earnings)}</td>
                              <td className="py-3 text-right text-[#535B62]">{margin != null ? `${formatNumber(margin, 2)}%` : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-[#81878C]">Annual statements details not published in current report.</p>
                )}
              </div>

              {/* Quarterly Trend if available */}
              {detail.quarterly_earnings.length > 0 && (
                <div className="rounded border border-[#E8EBED] bg-white p-5">
                  <h4 className="text-sm font-semibold text-[#2F363F]">Recent Quarterly Performance</h4>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[#E8EBED] text-xs text-[#81878C]">
                          <th className="py-2.5 pr-4">Quarter</th>
                          <th className="py-2.5 pr-4 text-right">Revenue</th>
                          <th className="py-2.5 text-right">Net Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8EBED]">
                        {detail.quarterly_earnings.map((q) => (
                          <tr key={q.date}>
                            <td className="py-3 pr-4 font-medium text-[#2F363F]">{q.date}</td>
                            <td className="py-3 pr-4 text-right">{inr(q.revenue)}</td>
                            <td className="py-3 text-right font-medium">{inr(q.earnings)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Ownership & Consensus */}
          {tab === "ownership" && (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Shareholding Pattern */}
              <div className="rounded border border-[#E8EBED] bg-white p-5">
                <h4 className="text-sm font-semibold text-[#2F363F]">Shareholding Pattern</h4>
                <div className="mt-4">
                  {/* Segmented bar */}
                  <div className="flex h-4 w-full overflow-hidden rounded bg-[#E8EBED]">
                    {detail.shareholding.promoter_pct != null && (
                      <div
                        style={{ width: `${detail.shareholding.promoter_pct}%` }}
                        className="bg-[#1F7AE0]"
                        title={`Promoters: ${detail.shareholding.promoter_pct}%`}
                      />
                    )}
                    {detail.shareholding.institutions_pct != null && (
                      <div
                        style={{ width: `${detail.shareholding.institutions_pct}%` }}
                        className="bg-[#1EA672]"
                        title={`Institutions: ${detail.shareholding.institutions_pct}%`}
                      />
                    )}
                    <div className="flex-1 bg-[#D5D9DD]" title="Public / Others" />
                  </div>

                  <dl className="mt-5 space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-2 text-[#535B62]">
                        <span className="h-3 w-3 rounded-sm bg-[#1F7AE0]" />
                        Promoters &amp; Insiders
                      </dt>
                      <dd className="font-semibold text-[#2F363F]">
                        {detail.shareholding.promoter_pct != null ? `${detail.shareholding.promoter_pct}%` : "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-2 text-[#535B62]">
                        <span className="h-3 w-3 rounded-sm bg-[#1EA672]" />
                        Institutions (FII / DII / MFs)
                      </dt>
                      <dd className="font-semibold text-[#2F363F]">
                        {detail.shareholding.institutions_pct != null ? `${detail.shareholding.institutions_pct}%` : "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-2 text-[#535B62]">
                        <span className="h-3 w-3 rounded-sm bg-[#D5D9DD]" />
                        Public Float &amp; Others
                      </dt>
                      <dd className="font-semibold text-[#2F363F]">
                        {detail.shareholding.promoter_pct != null && detail.shareholding.institutions_pct != null
                          ? `${formatNumber(Math.max(0, 100 - detail.shareholding.promoter_pct - detail.shareholding.institutions_pct), 2)}%`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* Analyst Research Consensus */}
              <div className="rounded border border-[#E8EBED] bg-white p-5">
                <h4 className="text-sm font-semibold text-[#2F363F]">Analyst Consensus &amp; Target Price</h4>
                <div className="mt-4">
                  {detail.analyst.recommendation ? (
                    <div className="inline-block rounded bg-[#E8F8F1] px-3 py-1 text-sm font-semibold text-[#0E6240]">
                      {detail.analyst.recommendation.toUpperCase()}
                    </div>
                  ) : (
                    <span className="text-sm text-[#81878C]">Rating not specified</span>
                  )}
                  {detail.analyst.opinions_count != null && (
                    <span className="ml-3 text-xs text-[#81878C]">
                      ({detail.analyst.opinions_count} analyst evaluations)
                    </span>
                  )}

                  <dl className="mt-5 divide-y divide-[#E8EBED] text-sm">
                    <div className="flex justify-between py-2.5">
                      <dt className="text-[#81878C]">Mean Target Price</dt>
                      <dd className="font-semibold text-[#1F7AE0]">{inr(detail.analyst.target_mean)}</dd>
                    </div>
                    <div className="flex justify-between py-2.5">
                      <dt className="text-[#81878C]">Implied Upside vs CMP</dt>
                      <dd className={`font-semibold ${tone(detail.analyst.upside_pct)}`}>
                        {pct(detail.analyst.upside_pct)}
                      </dd>
                    </div>
                    <div className="flex justify-between py-2.5">
                      <dt className="text-[#81878C]">High Target Estimate</dt>
                      <dd className="font-medium text-[#2F363F]">{inr(detail.analyst.target_high)}</dd>
                    </div>
                    <div className="flex justify-between py-2.5">
                      <dt className="text-[#81878C]">Low Target Estimate</dt>
                      <dd className="font-medium text-[#2F363F]">{inr(detail.analyst.target_low)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: About & Leadership */}
          {tab === "profile" && (
            <div className="space-y-6">
              {/* Business Description */}
              <div className="rounded border border-[#E8EBED] bg-white p-5">
                <h4 className="text-sm font-semibold text-[#2F363F]">Company Overview</h4>
                <p className="mt-3 text-sm leading-relaxed text-[#535B62]">
                  {expandSummary || !detail.profile.summary || detail.profile.summary.length < 350
                    ? detail.profile.summary || "Company profile summary not provided."
                    : `${detail.profile.summary.slice(0, 350)}… `}
                  {detail.profile.summary && detail.profile.summary.length >= 350 && (
                    <button
                      onClick={() => setExpandSummary(!expandSummary)}
                      className="ml-1 font-medium text-[#1F7AE0] hover:underline"
                    >
                      {expandSummary ? "Show less" : "Read more"}
                    </button>
                  )}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[#E8EBED] pt-4 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-[#81878C]">Headquarters</span>
                    <div className="mt-1 font-medium text-[#2F363F]">
                      {[detail.profile.city, detail.profile.country].filter(Boolean).join(", ") || "—"}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#81878C]">Full-Time Staff</span>
                    <div className="mt-1 font-medium text-[#2F363F]">
                      {detail.profile.employees != null ? formatNumber(detail.profile.employees, 0) : "—"}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#81878C]">Sector</span>
                    <div className="mt-1 font-medium text-[#2F363F]">{detail.profile.sector || "—"}</div>
                  </div>
                  <div>
                    <span className="text-[#81878C]">Website</span>
                    <div className="mt-1 font-medium text-[#1F7AE0]">
                      {detail.profile.website ? (
                        <a href={detail.profile.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          Visit ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Key Executives */}
              {detail.profile.officers.length > 0 && (
                <div className="rounded border border-[#E8EBED] bg-white p-5">
                  <h4 className="text-sm font-semibold text-[#2F363F]">Key Executives &amp; Management</h4>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[#E8EBED] text-xs text-[#81878C]">
                          <th className="py-2.5 pr-4">Executive Name</th>
                          <th className="py-2.5 pr-4">Title / Designation</th>
                          <th className="py-2.5 text-right">Age</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8EBED]">
                        {detail.profile.officers.map((o) => (
                          <tr key={o.name}>
                            <td className="py-3 pr-4 font-medium text-[#2F363F]">{o.name}</td>
                            <td className="py-3 pr-4 text-[#535B62]">{o.title || "—"}</td>
                            <td className="py-3 text-right text-[#81878C]">{o.age ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-[#81878C]">
            Data source: Yahoo Finance &amp; public filings. Descriptive research metrics for analytical review.
          </p>
        </div>
      ) : null}
    </div>
  );
}
