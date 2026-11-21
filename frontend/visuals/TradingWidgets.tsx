/**
 * Editorial IDX Trading Visuals & Custom Data Graphics:
 * - ActionBadge, SetupBadge, StatusBadge
 * - MacroRegimeGaugeSvg (Semicircular 4-zone IDX Macro Regime Dial)
 * - ScoreRingSvg (Circular Conviction Progress Ring)
 * - CmfFlowBar (Center-Zero Bandarmology Money Flow Bar)
 * - RiskRewardRuler (IDX Tick-Band & Price-Zone Ruler)
 * - PriceStructureSvg (Interactive 65D OHLC Candlestick & Volume Chart)
 * - InteractiveLotSizer (Stockbit Buy Order Pad with Risk/Reward Proportion Bar)
 * - SignalTicketCard (High-contrast execution ticket + 3-tab thesis inspector)
 */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { computeIdxPositionSizing } from "@protocol/idx-rules.ts";
import type {
  MacroContext,
  PriceBar,
  SetupType,
  SignalAction,
  SignalRecord,
  SignalStatus,
} from "@protocol/contracts.ts";
import { formatCompactIdr, formatIdr, formatPct } from "@frontend/sdk.ts";

// ============================================================================
// Semantic Matte Tags
// ============================================================================

export function ActionBadge({ action }: { action: SignalAction }) {
  const styles: Record<SignalAction, string> = {
    BUY: "bg-bull-bg text-bull border border-bull-border",
    WAIT: "bg-warn-bg text-warn border border-warn-border",
    HOLD: "bg-accent-tint text-accent border border-accent-border",
    AVOID: "bg-bear-bg text-bear border border-bear-border",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[13px] font-semibold ${styles[action]}`}>
      {action}
    </span>
  );
}

export function SetupBadge({ setup }: { setup: SetupType }) {
  const labels: Record<SetupType, string> = {
    BREAKOUT: "Breakout",
    PULLBACK: "Pullback",
    CONTRARIAN_BOUNCE: "Contrarian",
    SILENT_ACCUMULATION: "Accumulation",
    NONE: "Neutral",
  };
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[13px] font-medium bg-subtle text-ink-secondary border border-line">
      {labels[setup]}
    </span>
  );
}

export function StatusBadge({ status }: { status: SignalStatus }) {
  const cfg: Record<SignalStatus, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-warn-bg text-warn border border-warn-border" },
    entry_hit: { label: "Active", cls: "bg-accent-tint text-accent border border-accent-border" },
    target_hit: { label: "Target Hit", cls: "bg-bull-bg text-bull border border-bull-border" },
    sl_hit: { label: "Stopped Out", cls: "bg-bear-bg text-bear border border-bear-border" },
    expired: { label: "Expired", cls: "bg-subtle text-ink-muted border border-line" },
    cancelled: { label: "Cancelled", cls: "bg-subtle text-ink-muted border border-line" },
  };
  const c = cfg[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[13px] font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}

// ============================================================================
// Semicircular Market Regime Dial SVG
// ============================================================================

function arcSegmentPath(
  cx: number,
  cy: number,
  r: number,
  startPct: number,
  endPct: number
): string {
  const toRad = (pct: number) => Math.PI * (1 - pct / 100);
  const a1 = toRad(startPct);
  const a2 = toRad(endPct);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy - r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy - r * Math.sin(a2);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

export function MacroRegimeGaugeSvg({
  score,
  regime,
}: {
  score: number;
  regime: MacroContext["regime"];
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const deg = (clamped / 100) * 180 - 90;
  const scoreColor =
    regime === "RISK_ON"
      ? "var(--bull)"
      : regime === "RISK_OFF"
        ? "var(--bear)"
        : regime === "CAUTIOUS"
          ? "var(--warn)"
          : "var(--accent-text)";

  return (
    <div className="inline-flex flex-col items-center">
      <svg
        viewBox="0 0 220 124"
        width="220"
        height="124"
        role="img"
        aria-label={`Macro regime score ${clamped} out of 100 (${regime.replace("_", " ")})`}
        className="w-52 max-w-full h-auto"
      >
        {/* 4 Calibrated Regime Zones: Risk Off (0-30), Cautious (30-50), Neutral (50-70), Risk On (70-100) */}
        <path
          d={arcSegmentPath(110, 108, 82, 0, 29)}
          fill="none"
          stroke="var(--bear)"
          strokeWidth="12"
          strokeLinecap="round"
          opacity={regime === "RISK_OFF" ? 1 : 0.35}
        />
        <path
          d={arcSegmentPath(110, 108, 82, 31, 49)}
          fill="none"
          stroke="var(--warn)"
          strokeWidth="12"
          strokeLinecap="round"
          opacity={regime === "CAUTIOUS" ? 1 : 0.35}
        />
        <path
          d={arcSegmentPath(110, 108, 82, 51, 69)}
          fill="none"
          stroke="var(--ink-secondary)"
          strokeWidth="12"
          strokeLinecap="round"
          opacity={regime === "NEUTRAL" ? 0.95 : 0.3}
        />
        <path
          d={arcSegmentPath(110, 108, 82, 71, 100)}
          fill="none"
          stroke="var(--bull)"
          strokeWidth="12"
          strokeLinecap="round"
          opacity={regime === "RISK_ON" ? 1 : 0.35}
        />

        {/* Precision Outer Dial Pointer */}
        <g
          className="svg-meter-transition"
          style={{ transform: `rotate(${deg}deg)`, transformOrigin: "110px 108px" }}
        >
          <polygon points="105,36 115,36 110,16" fill="var(--ink-primary)" />
          <circle cx="110" cy="26" r="2.2" fill={scoreColor} />
        </g>

        {/* Central Big Readout */}
        <text
          x="110"
          y="94"
          textAnchor="middle"
          fill="var(--ink-primary)"
          fontSize="36"
          fontWeight="800"
          className="font-display num"
        >
          {clamped}
        </text>
        <text
          x="110"
          y="114"
          textAnchor="middle"
          fill="var(--ink-muted)"
          fontSize="12"
          fontWeight="600"
          className="num"
        >
          REGIME / 100
        </text>
      </svg>
    </div>
  );
}

// ============================================================================
// Circular Score Meter Ring SVG
// ============================================================================

export function ScoreRingSvg({
  score,
  label = "Score",
  size = 92,
}: {
  score: number;
  label?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - clamped / 100);
  const ringColor =
    clamped >= 72 ? "var(--bull)" : clamped >= 55 ? "var(--accent-text)" : "var(--warn)";

  return (
    <div className="inline-flex flex-col items-center shrink-0">
      <svg
        viewBox="0 0 92 92"
        width={size}
        height={size}
        role="img"
        aria-label={`${label}: ${clamped} out of 100`}
      >
        <circle
          cx="46"
          cy="46"
          r={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth="8"
        />
        <circle
          cx="46"
          cy="46"
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 46 46)"
          className="svg-meter-transition"
        />
        <text
          x="46"
          y="48"
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--ink-primary)"
          fontSize="24"
          fontWeight="800"
          className="font-display num"
        >
          {clamped}
        </text>
      </svg>
      <span className="text-[12px] font-semibold text-ink-muted -mt-1">{label}</span>
    </div>
  );
}

// ============================================================================
// Center-Zero Bandarmology CMF Flow Bar
// ============================================================================

export function CmfFlowBar({
  cmf20,
  score,
}: {
  cmf20: number | null;
  score?: number;
}) {
  const val = cmf20 ?? 0;
  const clamped = Math.max(-0.35, Math.min(0.35, val));
  const widthPct = Math.round((Math.abs(clamped) / 0.35) * 50);
  const positive = val >= 0;

  return (
    <div className="space-y-1 min-w-[116px]">
      <div className="flex items-center justify-between gap-2 text-[13px] num">
        {score !== undefined && <span className="font-semibold text-ink">{score}</span>}
        <span className={`font-semibold ml-auto ${positive ? "text-bull" : "text-bear"}`}>
          {cmf20 !== null ? `${cmf20 >= 0 ? "+" : ""}${cmf20.toFixed(2)}` : "-"}
        </span>
      </div>
      <div
        aria-label={`Chaikin Money Flow ${cmf20 !== null ? cmf20.toFixed(2) : "unavailable"}`}
        className="relative h-2 rounded-full bg-subtle border border-line overflow-hidden"
      >
        <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" aria-hidden="true" />
        {cmf20 !== null && (
          <div
            className={`absolute inset-y-0 ${positive ? "bg-bull rounded-r-full" : "bg-bear rounded-l-full"}`}
            style={{
              left: positive ? "50%" : `${50 - widthPct}%`,
              width: `${Math.max(3, widthPct)}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// IDX Tick-Band & Price-Zone Ruler
// ============================================================================

interface RiskRewardRulerProps {
  stopLoss: number;
  entryPrice: number;
  currentPrice?: number | null;
  targetPrice1?: number | null;
  targetPrice: number;
  showLabels?: boolean;
}

export function RiskRewardRuler({
  stopLoss,
  entryPrice,
  currentPrice,
  targetPrice1,
  targetPrice,
  showLabels = false,
}: RiskRewardRulerProps) {
  const prices = [stopLoss, entryPrice, targetPrice];
  if (currentPrice && currentPrice > 0) prices.push(currentPrice);
  if (targetPrice1 && targetPrice1 > 0) prices.push(targetPrice1);

  const minP = Math.min(...prices) * 0.985;
  const maxP = Math.max(...prices) * 1.015;
  const span = Math.max(1, maxP - minP);
  const toPct = (p: number) => Math.max(0, Math.min(100, ((p - minP) / span) * 100));

  const slPct = toPct(stopLoss);
  const entryPct = toPct(entryPrice);
  const tp1Pct = targetPrice1 ? toPct(targetPrice1) : null;
  const tp2Pct = toPct(targetPrice);
  const curPct = currentPrice && currentPrice > 0 ? toPct(currentPrice) : null;

  const summaryLabel = `Price ruler: Stop Loss ${formatIdr(stopLoss)}, Entry ${formatIdr(entryPrice)}, ${
    currentPrice ? `Current ${formatIdr(currentPrice)}, ` : ""
  }Target 2 ${formatIdr(targetPrice)}`;

  return (
    <div className="space-y-2" role="group" aria-label={summaryLabel}>
      <div className="relative h-2.5 rounded-full bg-subtle border border-line overflow-visible">
        <div
          className="absolute top-0 bottom-0 bg-bear-bg rounded-l-full"
          style={{ left: `${slPct}%`, width: `${Math.max(1, entryPct - slPct)}%` }}
        />
        <div
          className="absolute top-0 bottom-0 bg-bull-bg rounded-r-full"
          style={{ left: `${entryPct}%`, width: `${Math.max(1, tp2Pct - entryPct)}%` }}
        />
        <div
          title={`Stop Loss: ${formatIdr(stopLoss)}`}
          className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-bear"
          style={{ left: `${slPct}%` }}
        />
        <div
          title={`Entry: ${formatIdr(entryPrice)}`}
          className="absolute -top-1 -bottom-1 w-0.5 bg-accent-solid"
          style={{ left: `calc(${entryPct}% - 1px)` }}
        />
        {tp1Pct !== null && (
          <div
            title={`Target 1: ${formatIdr(targetPrice1)}`}
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-bull"
            style={{ left: `${tp1Pct}%` }}
          />
        )}
        <div
          title={`Target 2: ${formatIdr(targetPrice)}`}
          className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-bull"
          style={{ left: `${tp2Pct}%` }}
        />
        {curPct !== null && (
          <div
            title={`Current Price: ${formatIdr(currentPrice)}`}
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rotate-45 bg-ink border-2 border-accent-solid"
            style={{ left: `calc(${curPct}% - 7px)` }}
          />
        )}
      </div>

      {showLabels && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] num">
          <span className="text-bear font-semibold">SL {formatIdr(stopLoss)}</span>
          <span className="text-accent font-semibold">Entry {formatIdr(entryPrice)}</span>
          {targetPrice1 && targetPrice1 > 0 && (
            <span className="text-ink-secondary font-medium">TP1 {formatIdr(targetPrice1)}</span>
          )}
          <span className="text-bull font-semibold">TP2 {formatIdr(targetPrice)}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 65-Day OHLC Candlestick & Volume Chart (with interactive overlay toggles)
// ============================================================================

interface PriceStructureSvgProps {
  bars: PriceBar[];
  sma20?: number | null;
  vwap20?: number | null;
  entryPrice?: number;
  stopLoss?: number;
  targetPrice1?: number;
  targetPrice?: number;
}

export function PriceStructureSvg({
  bars,
  vwap20,
  entryPrice,
  stopLoss,
  targetPrice1,
  targetPrice,
}: PriceStructureSvgProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showSma, setShowSma] = useState(true);
  const [showLevels, setShowLevels] = useState(true);

  const chart = useMemo(() => {
    if (bars.length === 0) return null;
    const width = 800;
    const height = 320;
    const padL = 8;
    const padR = 104;
    const padT = 18;
    const padB = 50;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allPrices: number[] = [];
    let maxVol = 1;
    for (const b of bars) {
      allPrices.push(b.high, b.low);
      if (b.volume > maxVol) maxVol = b.volume;
    }
    if (showLevels) {
      if (entryPrice) allPrices.push(entryPrice);
      if (stopLoss) allPrices.push(stopLoss);
      if (targetPrice1) allPrices.push(targetPrice1);
      if (targetPrice) allPrices.push(targetPrice);
    }

    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const margin = Math.max(1, (rawMax - rawMin) * 0.08);
    const minP = rawMin - margin;
    const maxP = rawMax + margin;
    const pSpan = Math.max(1, maxP - minP);

    const yOf = (p: number) => padT + ((maxP - p) / pSpan) * plotH;
    const stepX = plotW / Math.max(1, bars.length);
    const candleW = Math.max(2, Math.min(8.5, stepX * 0.64));

    const smaPoints: string[] = [];
    for (let i = 19; i < bars.length; i++) {
      let sum = 0;
      for (let j = i - 19; j <= i; j++) sum += bars[j]!.close;
      const x = padL + i * stepX + stepX / 2;
      const y = yOf(sum / 20);
      smaPoints.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    return { width, height, padL, padR, padT, padB, plotW, plotH, minP, maxP, maxVol, yOf, stepX, candleW, smaPoints };
  }, [bars, entryPrice, stopLoss, targetPrice1, targetPrice, showLevels]);

  if (!chart || bars.length === 0) {
    return (
      <div className="h-60 flex items-center justify-center term-well px-4 text-center text-[15px] text-ink-muted">
        Daily OHLC price history is unavailable for this ticker.
      </div>
    );
  }

  const activeIdx = hoverIdx !== null ? hoverIdx : bars.length - 1;
  const hovered = bars[activeIdx];

  const levels = showLevels
    ? [
        targetPrice ? { label: "TP2", price: targetPrice, color: "var(--bull)" } : null,
        targetPrice1 ? { label: "TP1", price: targetPrice1, color: "var(--bull)" } : null,
        vwap20 ? { label: "VWAP", price: vwap20, color: "var(--ink-secondary)" } : null,
        entryPrice ? { label: "ENTRY", price: entryPrice, color: "var(--accent-text)" } : null,
        stopLoss ? { label: "SL", price: stopLoss, color: "var(--bear)" } : null,
      ].filter((x): x is { label: string; price: number; color: string } => x !== null)
    : [];

  const handleChartKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setHoverIdx((prev) => Math.max(0, (prev ?? bars.length - 1) - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setHoverIdx((prev) => Math.min(bars.length - 1, (prev ?? bars.length - 1) + 1));
    } else if (e.key === "Escape") {
      setHoverIdx(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-secondary">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 num">
          {hovered && (
            <>
              <span className="font-bold text-ink">{hovered.date}</span>
              <span>O {hovered.open.toLocaleString("en-US")}</span>
              <span>H {hovered.high.toLocaleString("en-US")}</span>
              <span>L {hovered.low.toLocaleString("en-US")}</span>
              <span className="font-bold text-ink">C {hovered.close.toLocaleString("en-US")}</span>
              <span className="text-ink-muted">
                Vol {(hovered.volume / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} lot
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={showSma}
            onClick={() => setShowSma((s) => !s)}
            className={`min-h-[36px] px-2.5 rounded-md text-[13px] font-semibold border transition-colors inline-flex items-center gap-1.5 ${
              showSma
                ? "bg-warn-bg text-warn border-warn-border"
                : "bg-subtle text-ink-muted border-line"
            }`}
          >
            <span className="w-2.5 h-0.5 bg-current inline-block" aria-hidden="true" />
            <span>SMA20</span>
          </button>

          <button
            type="button"
            aria-pressed={showLevels}
            onClick={() => setShowLevels((l) => !l)}
            className={`min-h-[36px] px-2.5 rounded-md text-[13px] font-semibold border transition-colors inline-flex items-center gap-1.5 ${
              showLevels
                ? "bg-accent-tint text-accent border-accent-border"
                : "bg-subtle text-ink-muted border-line"
            }`}
          >
            <span className="w-2.5 h-0.5 bg-current inline-block" aria-hidden="true" />
            <span>Trade Levels</span>
          </button>
        </div>
      </div>

      <div
        tabIndex={0}
        onKeyDown={handleChartKeyDown}
        aria-label={`Price candlestick chart covering ${bars.length} trading days. Use left and right arrow keys to inspect bars.`}
        className="term-well p-3"
      >
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label="OHLC Candlestick Chart with Entry, Stop Loss, and Target Levels"
          className="w-full h-72 sm:h-80 select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
            const y = chart.padT + chart.plotH * ratio;
            const p = chart.maxP - (chart.maxP - chart.minP) * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={chart.padL}
                  x2={chart.width - chart.padR}
                  y1={y}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeWidth="1"
                />
                <text
                  x={chart.width - chart.padR + 8}
                  y={y + 4}
                  fontSize="12"
                  fill="var(--ink-muted)"
                  className="num"
                >
                  {Math.round(p).toLocaleString("en-US")}
                </text>
              </g>
            );
          })}

          {bars.map((b, i) => {
            const x = chart.padL + i * chart.stepX + (chart.stepX - chart.candleW) / 2;
            const vH = (b.volume / chart.maxVol) * 32;
            const up = b.close >= b.open;
            return (
              <rect
                key={`v-${b.date}`}
                x={x}
                y={chart.height - 14 - vH}
                width={chart.candleW}
                height={Math.max(1, vH)}
                fill={up ? "var(--bull)" : "var(--bear)"}
                opacity="0.28"
              />
            );
          })}

          {levels.map((lvl) => {
            const y = chart.yOf(lvl.price);
            if (y < chart.padT - 8 || y > chart.padT + chart.plotH + 8) return null;
            return (
              <g key={lvl.label}>
                <line
                  x1={chart.padL}
                  x2={chart.width - chart.padR}
                  y1={y}
                  y2={y}
                  stroke={lvl.color}
                  strokeWidth="1.25"
                  strokeDasharray={lvl.label === "VWAP" ? "2 3" : "5 3"}
                />
                <rect
                  x={chart.width - chart.padR + 4}
                  y={y - 11}
                  width="96"
                  height="22"
                  rx="4"
                  fill="var(--bg-surface-elevated)"
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                />
                <text
                  x={chart.width - chart.padR + 10}
                  y={y + 4}
                  fontSize="11.5"
                  fontWeight="600"
                  fill={lvl.color}
                  className="num"
                >
                  {lvl.label} {Math.round(lvl.price)}
                </text>
              </g>
            );
          })}

          {showSma && chart.smaPoints.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--warn)"
              strokeWidth="1.8"
              points={chart.smaPoints.join(" ")}
            />
          )}

          {bars.map((b, i) => {
            const cx = chart.padL + i * chart.stepX + chart.stepX / 2;
            const yHigh = chart.yOf(b.high);
            const yLow = chart.yOf(b.low);
            const yOpen = chart.yOf(b.open);
            const yClose = chart.yOf(b.close);
            const up = b.close >= b.open;
            const color = up ? "var(--bull)" : "var(--bear)";
            const topY = Math.min(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yOpen - yClose));
            const isSelected = i === activeIdx;

            return (
              <g
                key={b.date}
                onMouseEnter={() => setHoverIdx(i)}
                className="cursor-crosshair"
              >
                {isSelected && (
                  <line
                    x1={cx}
                    x2={cx}
                    y1={chart.padT}
                    y2={chart.padT + chart.plotH}
                    stroke="var(--border-strong)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}
                <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1.25" />
                <rect
                  x={cx - chart.candleW / 2}
                  y={topY}
                  width={chart.candleW}
                  height={bodyH}
                  fill={color}
                  rx="1"
                />
                <rect
                  x={chart.padL + i * chart.stepX}
                  y={chart.padT}
                  width={chart.stepX}
                  height={chart.plotH}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// Stockbit Buy Order Pad (IDX Lot Calculator)
// ============================================================================

interface InteractiveLotSizerProps {
  entryPrice: number;
  stopLoss: number;
  targetPrice1?: number | null;
  targetPrice: number;
  suggestedRiskPct?: number;
}

const CAPITAL_PRESETS = [
  { label: "25M", value: 25_000_000 },
  { label: "100M", value: 100_000_000 },
  { label: "500M", value: 500_000_000 },
];

const RISK_PRESETS = [0.5, 1.0, 1.5, 2.0];

export function InteractiveLotSizer({
  entryPrice,
  stopLoss,
  targetPrice1,
  targetPrice,
  suggestedRiskPct = 1.0,
}: InteractiveLotSizerProps) {
  const [capitalIdr, setCapitalIdr] = useState(100_000_000);
  const [riskPct, setRiskPct] = useState(suggestedRiskPct);
  const [maxAllocPct, setMaxAllocPct] = useState(25);

  const sizing = useMemo(
    () =>
      computeIdxPositionSizing({
        capitalIdr,
        riskPct,
        maxAllocPct,
        entryPrice,
        stopLoss,
        targetPrice1,
        targetPrice,
      }),
    [capitalIdr, riskPct, maxAllocPct, entryPrice, stopLoss, targetPrice1, targetPrice]
  );

  const totalOutcomeSpan = Math.max(1, sizing.netSlLossIdr + Math.max(0, sizing.netTp2ProfitIdr));
  const riskBarPct = Math.round((sizing.netSlLossIdr / totalOutcomeSpan) * 100);
  const rewardBarPct = 100 - riskBarPct;

  return (
    <section aria-label="IDX Order Calculator" className="desk-sheet p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">IDX Order Calculator</h2>
          <p className="text-[13px] text-ink-muted mt-0.5">
            1 lot = 100 shares · Fee 0.15% buy, 0.25% sell
          </p>
        </div>
        <span className="num text-[13px] font-bold px-2.5 py-1 rounded-md bg-accent-tint border border-accent-border text-accent shrink-0">
          R:R {sizing.riskRewardRatio.toFixed(2)}x
        </span>
      </div>

      {/* Hero Order Size */}
      <div className="term-well p-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-ink-muted">Recommended Order</div>
          <div className="font-display text-3xl font-extrabold text-ink num mt-0.5">
            {sizing.lots.toLocaleString("en-US")} Lots
          </div>
        </div>
        <div className="text-right num text-sm text-ink-secondary">
          <div className="font-semibold text-ink">{sizing.shares.toLocaleString("en-US")} shares</div>
          <div className="text-ink-muted">{sizing.allocationPct}% of capital</div>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4 text-[15px]">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="lot-capital-input" className="text-sm font-medium text-ink-secondary">
              Portfolio Capital (IDR)
            </label>
            <div className="flex items-center gap-1.5">
              {CAPITAL_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={capitalIdr === preset.value}
                  onClick={() => setCapitalIdr(preset.value)}
                  className={`min-h-[44px] lg:h-8 lg:min-h-0 px-2.5 rounded-md text-[13px] num font-semibold transition-colors ${
                    capitalIdr === preset.value ? "term-btn-primary" : "term-btn-secondary"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <input
            id="lot-capital-input"
            type="number"
            min={1_000_000}
            step={5_000_000}
            value={capitalIdr}
            onChange={(e) => setCapitalIdr(Math.max(1_000_000, Number(e.target.value) || 0))}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num font-semibold"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label htmlFor="lot-risk-range" className="font-medium text-ink-secondary">
              Risk per Trade
            </label>
            <div className="flex items-center gap-1.5">
              {RISK_PRESETS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={riskPct === r}
                  onClick={() => setRiskPct(r)}
                  className={`min-h-[44px] lg:h-8 lg:min-h-0 px-2.5 rounded-md text-[13px] num font-semibold transition-colors ${
                    riskPct === r
                      ? "bg-accent-tint border border-accent-border text-accent"
                      : "term-btn-secondary"
                  }`}
                >
                  {r}%
                </button>
              ))}
            </div>
          </div>
          <input
            id="lot-risk-range"
            type="range"
            min={0.25}
            max={3.0}
            step={0.25}
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value))}
            className="w-full term-slider my-1.5"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <label htmlFor="lot-alloc-range" className="font-medium text-ink-secondary">
              Max Position Allocation
            </label>
            <span className="num font-bold text-ink">{maxAllocPct}%</span>
          </div>
          <input
            id="lot-alloc-range"
            type="range"
            min={10}
            max={50}
            step={5}
            value={maxAllocPct}
            onChange={(e) => setMaxAllocPct(Number(e.target.value))}
            className="w-full term-slider my-1.5"
          />
        </div>
      </div>

      {/* Visual Risk vs Reward Ratio Bar */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[13px] font-medium">
          <span className="text-bear">SL Risk ({riskBarPct}%)</span>
          <span className="text-bull">TP2 Upside ({rewardBarPct}%)</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden flex bg-subtle border border-line">
          <div className="bg-bear h-full" style={{ width: `${riskBarPct}%` }} />
          <div className="bg-bull h-full" style={{ width: `${rewardBarPct}%` }} />
        </div>
      </div>

      {/* Fee-Adjusted Order Ledger */}
      <dl className="divide-y divide-line border-t border-line pt-1 text-sm">
        <div className="py-2.5 flex items-center justify-between gap-2">
          <dt className="text-ink-muted">Gross + Buy Fee</dt>
          <dd className="num font-semibold text-ink">{formatIdr(sizing.totalCostIdr)}</dd>
        </div>
        <div className="py-2.5 flex items-center justify-between gap-2">
          <dt className="text-ink-muted">Net Loss at SL</dt>
          <dd className="num font-semibold text-bear">
            -{formatCompactIdr(sizing.netSlLossIdr)} (-{sizing.netSlLossPct}%)
          </dd>
        </div>
        <div className="py-2.5 flex items-center justify-between gap-2">
          <dt className="text-ink-muted">Net Profit at TP1 (50%)</dt>
          <dd className="num font-semibold text-bull">
            {sizing.netTp1ProfitIdr !== null ? `+${formatCompactIdr(sizing.netTp1ProfitIdr)}` : "-"}
          </dd>
        </div>
        <div className="py-2.5 flex items-center justify-between gap-2">
          <dt className="text-ink-muted">Net Profit at TP2</dt>
          <dd className="num font-semibold text-bull">+{formatCompactIdr(sizing.netTp2ProfitIdr)}</dd>
        </div>
      </dl>
    </section>
  );
}

// ============================================================================
// Editorial Signal Ticket Card
// ============================================================================

type ThesisTab = "technical" | "fundamental" | "news";

export function SignalTicketCard({
  signal,
  livePrice,
}: {
  signal: SignalRecord;
  livePrice?: number;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ThesisTab>("technical");

  const effectivePrice = livePrice ?? signal.currentPrice;
  const livePnlPct =
    effectivePrice && signal.entryPrice > 0
      ? ((effectivePrice - signal.entryPrice) / signal.entryPrice) * 100
      : signal.unrealizedPnlPct;

  const entryDeltaLabel = useMemo(() => {
    if (!effectivePrice || signal.entryPrice <= 0) return null;
    const diffPct = ((effectivePrice - signal.entryPrice) / signal.entryPrice) * 100;
    if (Math.abs(diffPct) <= 0.6) {
      return { text: "In Entry Zone", cls: "bg-bull-bg text-bull border border-bull-border" };
    }
    return {
      text: `${formatPct(diffPct, 1)} vs Entry`,
      cls: "bg-subtle text-ink-secondary border border-line",
    };
  }, [effectivePrice, signal.entryPrice]);

  const tabs: Array<{ id: ThesisTab; label: string; score: number; content: string }> = [
    {
      id: "technical",
      label: "Technical",
      score: Math.round(signal.technicalScore),
      content: signal.technicalSummary,
    },
    {
      id: "fundamental",
      label: "Fundamental",
      score: Math.round(signal.fundamentalScore),
      content: signal.fundamentalSummary,
    },
    {
      id: "news",
      label: "Sentiment",
      score: Math.round(signal.sentimentScore),
      content: signal.newsSummary,
    },
  ];

  const currentTab = tabs.find((t) => t.id === activeTab) ?? tabs[0]!;

  return (
    <article className="desk-sheet p-5 space-y-4 transition-colors hover:border-line-strong">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => navigate(`/workbench?ticker=${signal.ticker}`)}
              className="min-h-[44px] lg:h-9 lg:min-h-0 px-2.5 rounded-md bg-subtle border border-line hover:border-accent-border hover:text-accent font-display text-lg font-extrabold text-ink transition-colors"
            >
              {signal.ticker}
            </button>
            <ActionBadge action={signal.action} />
            <SetupBadge setup={signal.setupType} />
            <StatusBadge status={signal.status} />
            {entryDeltaLabel && (
              <span className={`num px-2.5 py-0.5 rounded-md text-[13px] font-semibold ${entryDeltaLabel.cls}`}>
                {entryDeltaLabel.text}
              </span>
            )}
          </div>
          <div className="text-sm text-ink-muted truncate">
            {signal.companyName} {signal.sector ? `· ${signal.sector}` : ""} ·{" "}
            <span className="num">{signal.signalDate}</span>
          </div>
        </div>

        <span className="num shrink-0 px-3 py-1 rounded-md bg-accent-tint border border-accent-border text-accent text-sm font-bold">
          Score {Math.round(signal.overallScore)}
        </span>
      </div>

      {/* Price Zone Ruler */}
      <RiskRewardRuler
        stopLoss={signal.stopLoss}
        entryPrice={signal.entryPrice}
        currentPrice={effectivePrice}
        targetPrice1={signal.targetPrice1}
        targetPrice={signal.targetPrice}
        showLabels={false}
      />

      {/* Open Hairline Execution Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 py-3 border-y border-line text-[13px]">
        <div>
          <div className="text-ink-muted">Entry ({signal.orderType})</div>
          <div className="num text-[15px] font-bold text-ink mt-0.5">
            {formatIdr(signal.entryPrice)}
          </div>
        </div>
        <div>
          <div className="text-ink-muted">Stop Loss</div>
          <div className="num text-[15px] font-bold text-bear mt-0.5">
            {formatIdr(signal.stopLoss)}
          </div>
        </div>
        <div>
          <div className="text-ink-muted">Target 1</div>
          <div className="num text-[15px] font-bold text-bull mt-0.5">
            {formatIdr(signal.targetPrice1)}
          </div>
        </div>
        <div>
          <div className="text-ink-muted">Target 2</div>
          <div className="num text-[15px] font-bold text-bull mt-0.5">
            {formatIdr(signal.targetPrice)}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <div className="text-ink-muted">R:R · P&amp;L</div>
          <div className="num text-[15px] font-bold mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-ink">{signal.riskRewardRatio.toFixed(2)}x</span>
            {livePnlPct !== null && (
              <span className={livePnlPct >= 0 ? "text-bull" : "text-bear"}>
                {formatPct(livePnlPct)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Thesis Summary */}
      <p className="text-[15px] text-ink-secondary leading-relaxed max-w-[65ch]">
        {signal.analysisSummary}
      </p>

      {/* Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[13px] text-ink-muted num">Max hold {signal.maxHoldDays}d</span>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
            className="min-h-[44px] lg:h-9 lg:min-h-0 px-3.5 term-btn-secondary text-sm font-medium"
          >
            {expanded ? "Hide Thesis" : "Inspect Thesis"}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/workbench?ticker=${signal.ticker}`)}
            className="min-h-[44px] lg:h-9 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Open Terminal
          </button>
        </div>
      </div>

      {/* Expandable 3-Tab Thesis Inspector */}
      {expanded && (
        <div className="pt-2 border-t border-line space-y-3">
          <div
            role="tablist"
            aria-label={`${signal.ticker} analysis tabs`}
            className="flex border-b border-line gap-2"
          >
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[44px] lg:h-9 lg:min-h-0 px-3 border-b-2 text-sm transition-colors inline-flex items-center gap-1.5 ${
                    selected
                      ? "border-b-accent-solid text-ink font-semibold"
                      : "border-b-transparent text-ink-secondary hover:text-ink font-medium"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="num text-ink-muted">{tab.score}</span>
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            className="text-[15px] text-ink-secondary leading-relaxed max-w-[65ch]"
          >
            {currentTab.content}
          </div>
        </div>
      )}
    </article>
  );
}
