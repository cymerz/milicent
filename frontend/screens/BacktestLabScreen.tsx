/**
 * Strategy Backtest Screen (/backtest):
 * Walk-forward daily OHLC simulation comparing Fixed SL/TP vs Trailing Stop
 * with Net Edge Hero Callout, Dual Equity Curve, Delta Matrix, and 3-state trade log.
 */

import React, { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BacktestPayload, BacktestTrade } from "@protocol/contracts.ts";
import { formatIdr, formatPct, studioApi } from "@frontend/sdk.ts";

function DualEquityCurveSvg({
  curve,
}: {
  curve: BacktestPayload["equityCurve"];
}) {
  const gradId = useId();
  const geo = useMemo(() => {
    if (curve.length < 2) return null;
    const width = 760;
    const height = 260;
    const padL = 52;
    const padR = 16;
    const padT = 18;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const vals = curve.flatMap((c) => [c.baselineEquity, c.trailingEquity]);
    const minV = Math.min(...vals, 95);
    const maxV = Math.max(...vals, 105);
    const span = Math.max(1, maxV - minV);

    const xOf = (i: number) => padL + (i / (curve.length - 1)) * plotW;
    const yOf = (v: number) => padT + ((maxV - v) / span) * plotH;

    const basePts = curve.map((c, i) => `${xOf(i).toFixed(1)},${yOf(c.baselineEquity).toFixed(1)}`).join(" ");
    const trailPts = curve.map((c, i) => `${xOf(i).toFixed(1)},${yOf(c.trailingEquity).toFixed(1)}`).join(" ");
    const bottomY = (padT + plotH).toFixed(1);
    const trailArea = `${xOf(0).toFixed(1)},${bottomY} ${trailPts} ${xOf(curve.length - 1).toFixed(1)},${bottomY}`;

    return { width, height, padL, padR, padT, padB, plotW, plotH, minV, maxV, yOf, basePts, trailPts, trailArea };
  }, [curve]);

  if (!geo) {
    return (
      <div className="h-60 flex items-center justify-center term-well px-4 text-center text-[15px] text-ink-muted">
        Run a simulation across a date range with historical signals to display the equity curve.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${geo.width} ${geo.height}`}
      role="img"
      aria-label="Equity Curve comparing Fixed SL/TP and Trailing Stop"
      className="w-full h-64"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--bull)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--bull)" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {[0, 0.5, 1].map((r) => {
        const y = geo.padT + geo.plotH * r;
        const val = geo.maxV - (geo.maxV - geo.minV) * r;
        return (
          <g key={r}>
            <line
              x1={geo.padL}
              x2={geo.width - geo.padR}
              y1={y}
              y2={y}
              stroke="var(--border-subtle)"
              strokeWidth="1"
            />
            <text x={6} y={y + 4} fontSize="12" fill="var(--ink-muted)" className="num">
              {val.toFixed(0)}
            </text>
          </g>
        );
      })}

      <line
        x1={geo.padL}
        x2={geo.width - geo.padR}
        y1={geo.yOf(100)}
        y2={geo.yOf(100)}
        stroke="var(--ink-muted)"
        strokeOpacity="0.45"
        strokeDasharray="3 3"
      />

      <polygon fill={`url(#${gradId})`} points={geo.trailArea} />
      <polyline
        fill="none"
        stroke="var(--ink-secondary)"
        strokeWidth="2.2"
        strokeDasharray="5 3"
        points={geo.basePts}
      />
      <polyline fill="none" stroke="var(--bull)" strokeWidth="2.6" points={geo.trailPts} />
    </svg>
  );
}

export function BacktestLabScreen() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(ninetyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [ticker, setTicker] = useState("");
  const [feePct, setFeePct] = useState(0.2);
  const [slippagePct, setSlippagePct] = useState(0.1);
  const [trailingActivationPct, setTrailingActivationPct] = useState(5.0);
  const [trailingDistancePct, setTrailingDistancePct] = useState(3.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestPayload | null>(null);

  const execute = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await studioApi.runBacktest({
        startDate,
        endDate,
        ticker: ticker.trim().toUpperCase() || undefined,
        feePct,
        slippagePct,
        trailingActivationPct,
        trailingDistancePct,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void execute();
  };

  const b = result?.baseline.metrics;
  const tr = result?.trailing.metrics;
  const netReturnEdge = b && tr ? tr.totalReturnPct - b.totalReturnPct : null;

  const comparisonRows = useMemo(() => {
    if (!b || !tr) return [];
    const formatDelta = (delta: number, unit = "%", invertGood = false) => {
      const prefix = delta > 0 ? "+" : "";
      const isGood = invertGood ? delta < 0 : delta > 0;
      const cls = delta === 0 ? "text-ink-muted" : isGood ? "text-bull" : "text-bear";
      return { text: `${prefix}${delta.toFixed(2)}${unit}`, cls };
    };

    const returnDelta = formatDelta(tr.totalReturnPct - b.totalReturnPct);
    const winRateDelta =
      tr.winRatePct !== null && b.winRatePct !== null
        ? formatDelta(tr.winRatePct - b.winRatePct)
        : { text: "-", cls: "text-ink-muted" };
    const pfDelta =
      tr.profitFactor !== null && b.profitFactor !== null
        ? formatDelta(tr.profitFactor - b.profitFactor, "x")
        : { text: "-", cls: "text-ink-muted" };
    const avgDelta =
      tr.avgReturnPct !== null && b.avgReturnPct !== null
        ? formatDelta(tr.avgReturnPct - b.avgReturnPct)
        : { text: "-", cls: "text-ink-muted" };
    const ddDelta = formatDelta(tr.maxDrawdownPct - b.maxDrawdownPct, "%", true);

    return [
      {
        label: "Total Return",
        base: formatPct(b.totalReturnPct),
        trail: formatPct(tr.totalReturnPct),
        delta: returnDelta,
        trailHighlight: tr.totalReturnPct >= 0 ? "text-bull" : "text-bear",
      },
      {
        label: "Win Rate",
        base: b.winRatePct !== null ? `${b.winRatePct.toFixed(1)}%` : "-",
        trail: tr.winRatePct !== null ? `${tr.winRatePct.toFixed(1)}%` : "-",
        delta: winRateDelta,
      },
      {
        label: "Profit Factor",
        base: b.profitFactor !== null ? String(b.profitFactor) : "-",
        trail: tr.profitFactor !== null ? String(tr.profitFactor) : "-",
        delta: pfDelta,
      },
      {
        label: "Avg Return",
        base: b.avgReturnPct !== null ? formatPct(b.avgReturnPct) : "-",
        trail: tr.avgReturnPct !== null ? formatPct(tr.avgReturnPct) : "-",
        delta: avgDelta,
      },
      {
        label: "Max Drawdown",
        base: `-${b.maxDrawdownPct}%`,
        trail: `-${tr.maxDrawdownPct}%`,
        delta: ddDelta,
        trailHighlight: "text-bear",
      },
      {
        label: "Filled / Signals",
        base: `${b.filledTrades} / ${b.totalSignals}`,
        trail: `${tr.filledTrades} / ${tr.totalSignals}`,
        delta: { text: `${tr.filledTrades - b.filledTrades}`, cls: "text-ink-muted" },
      },
      {
        label: "Wins / Losses",
        base: `${b.wins} / ${b.losses}`,
        trail: `${tr.wins} / ${tr.losses}`,
        delta: { text: `${tr.wins - b.wins} W`, cls: tr.wins >= b.wins ? "text-bull" : "text-bear" },
      },
    ];
  }, [b, tr]);

  const renderTradeCard = (trItem: BacktestTrade, i: number) => (
    <div
      key={`${trItem.ticker}-${trItem.signalDate}-${i}`}
      className="p-4 space-y-2.5 text-sm bg-surface"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/workbench?ticker=${trItem.ticker}`)}
            className="min-h-[44px] lg:h-8 lg:min-h-0 px-2.5 rounded-md bg-subtle border border-line hover:border-accent-border hover:text-accent font-display text-base font-extrabold text-ink"
          >
            {trItem.ticker}
          </button>
          <span className="num text-[13px] text-ink-muted">{trItem.signalDate}</span>
        </div>
        <span
          className={`num text-[15px] font-bold ${
            (trItem.netReturnPct ?? 0) > 0
              ? "text-bull"
              : (trItem.netReturnPct ?? 0) < 0
                ? "text-bear"
                : "text-ink-muted"
          }`}
        >
          {formatPct(trItem.netReturnPct)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[13px] text-ink-secondary num py-2 border-y border-line">
        <span>Entry {formatIdr(trItem.entryPrice)}</span>
        <span>Exit {formatIdr(trItem.exitPrice)}</span>
        <span>{trItem.holdingDays}d</span>
      </div>
      <div className="text-[13px] text-ink-muted capitalize">
        Outcome: <span className="text-ink-secondary font-semibold">{trItem.outcome.replace(/_/g, " ")}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink">
            Strategy Backtest
          </h1>
          <p className="text-[15px] text-ink-secondary">
            Walk-forward daily OHLC simulation after IDX broker commissions and slippage.
          </p>
        </div>
      </div>

      {/* Parameter Form */}
      <form
        onSubmit={handleSubmit}
        className="desk-sheet p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3.5 items-end"
      >
        <div className="space-y-1.5">
          <label htmlFor="bt-start-date" className="block text-sm font-medium text-ink-secondary">
            Start Date
          </label>
          <input
            id="bt-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bt-end-date" className="block text-sm font-medium text-ink-secondary">
            End Date
          </label>
          <input
            id="bt-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bt-ticker-input" className="block text-sm font-medium text-ink-secondary">
            Emiten
          </label>
          <input
            id="bt-ticker-input"
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="All IDX signals"
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] font-display font-bold uppercase placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:text-ink-muted"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bt-fee-input" className="block text-sm font-medium text-ink-secondary">
            Fee %
          </label>
          <input
            id="bt-fee-input"
            type="number"
            step={0.05}
            value={feePct}
            onChange={(e) => setFeePct(Number(e.target.value))}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bt-slip-input" className="block text-sm font-medium text-ink-secondary">
            Slippage %
          </label>
          <input
            id="bt-slip-input"
            type="number"
            step={0.05}
            value={slippagePct}
            onChange={(e) => setSlippagePct(Number(e.target.value))}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bt-trail-act" className="block text-sm font-medium text-ink-secondary">
            Trail Trigger %
          </label>
          <input
            id="bt-trail-act"
            type="number"
            step={0.5}
            value={trailingActivationPct}
            onChange={(e) => setTrailingActivationPct(Number(e.target.value))}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="bt-trail-dist" className="block text-sm font-medium text-ink-secondary">
            Trail Distance %
          </label>
          <input
            id="bt-trail-dist"
            type="number"
            step={0.5}
            value={trailingDistancePct}
            onChange={(e) => setTrailingDistancePct(Number(e.target.value))}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary disabled:opacity-50 text-sm font-semibold"
        >
          {loading ? "Running..." : "Run Simulation"}
        </button>
      </form>

      {/* Loading State */}
      {loading && !result && (
        <div className="desk-sheet p-5 text-[15px] text-ink-secondary" role="status" aria-live="polite">
          Running walk-forward strategy simulation...
        </div>
      )}

      {/* Error State */}
      {error && (
        <div role="alert" className="desk-sheet border-bear-border bg-bear-bg p-5 space-y-3 text-[15px]">
          <div className="font-semibold text-bear">Backtest failed: {error}</div>
          <button
            type="button"
            onClick={() => void execute()}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {result && b && tr && (
        <>
          {/* Net Edge Hero Callout */}
          <section
            aria-label="Simulation headline summary"
            className="desk-sheet p-5 grid grid-cols-1 sm:grid-cols-3 gap-5 divide-y sm:divide-y-0 sm:divide-x divide-line"
          >
            <div>
              <div className="text-[13px] font-medium text-ink-muted">Fixed SL/TP Return</div>
              <div className="font-display text-2xl font-extrabold text-ink num mt-0.5">
                {formatPct(b.totalReturnPct)}
              </div>
            </div>
            <div className="pt-3 sm:pt-0 sm:pl-5">
              <div className="text-[13px] font-medium text-ink-muted">
                Trailing Stop Return (+{trailingActivationPct}%)
              </div>
              <div
                className={`font-display text-2xl font-extrabold num mt-0.5 ${
                  tr.totalReturnPct >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {formatPct(tr.totalReturnPct)}
              </div>
            </div>
            <div className="pt-3 sm:pt-0 sm:pl-5">
              <div className="text-[13px] font-medium text-ink-muted">Trailing Stop Net Edge</div>
              <div
                className={`font-display text-2xl font-extrabold num mt-0.5 ${
                  (netReturnEdge ?? 0) >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                {netReturnEdge !== null ? formatPct(netReturnEdge) : "-"}
              </div>
            </div>
          </section>

          {/* Row 1: Dual Equity Curve + Delta Table */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <section className="xl:col-span-7 desk-sheet p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-ink">
                  Cumulative Equity: Trailing Stop vs Fixed SL/TP (Base = 100)
                </h2>
                <div className="flex flex-wrap items-center gap-4 text-[13px] text-ink-secondary">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-5 border-t-2 border-dashed border-ink-secondary inline-block" aria-hidden="true" />
                    <span>Fixed SL/TP (dashed)</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-5 border-t-2 border-bull inline-block" aria-hidden="true" />
                    <span>Trailing Stop (solid)</span>
                  </span>
                </div>
              </div>
              <DualEquityCurveSvg curve={result.equityCurve} />
            </section>

            <section aria-labelledby="bt-compare-heading" className="xl:col-span-5 desk-sheet overflow-hidden">
              <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
                <h2 id="bt-compare-heading" className="font-display text-lg font-bold text-ink">
                  Strategy Performance Delta
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[15px] text-left whitespace-nowrap">
                  <thead className="bg-subtle text-ink-muted text-[13px] font-semibold border-b border-line">
                    <tr>
                      <th className="px-4 py-3">Metric</th>
                      <th className="px-3 py-3 text-right">Fixed SL/TP</th>
                      <th className="px-3 py-3 text-right">Trailing Stop</th>
                      <th className="px-4 py-3 text-right">Net Edge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {comparisonRows.map((row) => (
                      <tr key={row.label} className="hover:bg-hover-bg transition-colors">
                        <td className="px-4 py-3 font-medium text-ink">{row.label}</td>
                        <td className="px-3 py-3 text-right num text-ink-secondary">{row.base}</td>
                        <td
                          className={`px-3 py-3 text-right num font-bold ${
                            row.trailHighlight ?? "text-ink"
                          }`}
                        >
                          {row.trail}
                        </td>
                        <td className={`px-4 py-3 text-right num font-bold ${row.delta.cls}`}>
                          {row.delta.text}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Row 2: Simulated Trades Log */}
          <section className="desk-sheet overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line">
              <h2 className="font-display text-lg font-bold text-ink">
                Simulated Trades ({result.trailing.trades.length})
              </h2>
            </div>

            {result.trailing.trades.length === 0 ? (
              <div className="p-6 text-center text-[15px] text-ink-muted">
                No BUY signals found in the selected date range. Adjust dates or leave Emiten blank to test all signals.
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-[15px] text-left whitespace-nowrap">
                    <thead className="bg-subtle text-ink-muted text-[13px] font-semibold border-b border-line">
                      <tr>
                        <th className="px-4 py-3">Signal Date</th>
                        <th className="px-3 py-3">Emiten</th>
                        <th className="px-3 py-3 text-right">Entry</th>
                        <th className="px-3 py-3 text-right">Exit</th>
                        <th className="px-3 py-3">Outcome</th>
                        <th className="px-3 py-3 text-right">Hold</th>
                        <th className="px-4 py-3 text-right">Net Return</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {result.trailing.trades.map((trItem, i) => (
                        <tr
                          key={`${trItem.ticker}-${trItem.signalDate}-${i}`}
                          className="hover:bg-hover-bg transition-colors"
                        >
                          <td className="px-4 py-3.5 num text-ink-muted">{trItem.signalDate}</td>
                          <td className="px-3 py-3.5">
                            <button
                              type="button"
                              onClick={() => navigate(`/workbench?ticker=${trItem.ticker}`)}
                              className="font-display text-base font-extrabold text-ink hover:text-accent"
                            >
                              {trItem.ticker}
                            </button>
                          </td>
                          <td className="px-3 py-3.5 text-right num text-ink font-medium">
                            {formatIdr(trItem.entryPrice)}
                          </td>
                          <td className="px-3 py-3.5 text-right num text-ink font-medium">
                            {formatIdr(trItem.exitPrice)}
                          </td>
                          <td className="px-3 py-3.5">
                            <span className="px-2.5 py-0.5 rounded-md bg-subtle border border-line text-ink-secondary text-[13px] font-medium capitalize">
                              {trItem.outcome.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 text-right num text-ink-secondary">
                            {trItem.holdingDays}d
                          </td>
                          <td
                            className={`px-4 py-3.5 text-right num font-bold ${
                              (trItem.netReturnPct ?? 0) > 0
                                ? "text-bull"
                                : (trItem.netReturnPct ?? 0) < 0
                                  ? "text-bear"
                                  : "text-ink-muted"
                            }`}
                          >
                            {formatPct(trItem.netReturnPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tablet 2-Column Reflow */}
                <div className="hidden sm:grid sm:grid-cols-2 lg:hidden gap-3 p-3 bg-canvas">
                  {result.trailing.trades.map((trItem, i) => (
                    <div
                      key={`${trItem.ticker}-${trItem.signalDate}-${i}`}
                      className="desk-sheet overflow-hidden"
                    >
                      {renderTradeCard(trItem, i)}
                    </div>
                  ))}
                </div>

                {/* Mobile 1-Column Reflow */}
                <div className="sm:hidden divide-y divide-line">
                  {result.trailing.trades.map(renderTradeCard)}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
