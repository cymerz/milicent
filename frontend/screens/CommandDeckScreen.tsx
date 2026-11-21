/**
 * Market Pulse Screen (/):
 * Editorial IDX Trading Workstation Overview featuring:
 * - Asymmetric 3-Column Hero: Semicircular Regime Dial + Human Macro Takeaway + IHSG/USDIDR/RSI Readouts + Track Record
 * - Dual-Column Catalysts vs Risk Briefing
 * - Split-Pane Active/Today Signal Desk (with Quick-Launch Bluechip Desk when empty) + Guardrail Radar
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DashboardPayload, MarketOutlook } from "@protocol/contracts.ts";
import { formatIdr, formatPct } from "@frontend/sdk.ts";
import {
  MacroRegimeGaugeSvg,
  SignalTicketCard,
} from "@frontend/visuals/TradingWidgets.tsx";
import { RegimeBadge } from "@frontend/layout/StudioFrame.tsx";

interface CommandDeckProps {
  dashboard: DashboardPayload | null;
  loading: boolean;
  livePrices: Record<string, { price: number; changePct: number }>;
  onRefresh: () => void;
}

type SignalDeskTab = "active" | "today";

const QUICK_LAUNCH_TICKERS = [
  "BBCA",
  "BBRI",
  "BMRI",
  "TLKM",
  "ASII",
  "ADRO",
  "ANTM",
  "BRIS",
];

function buildReadableMacroTakeaway(outlook: MarketOutlook): string {
  const raw = outlook.summary.trim();
  if (raw && !raw.startsWith("Regime ")) {
    return raw;
  }

  const m = outlook.macro;
  const trendPhrase =
    m.ihsgTrend === "BULLISH"
      ? "in an upward trend"
      : m.ihsgTrend === "BEARISH"
        ? "under downward pressure"
        : "moving sideways";

  const ihsgPart = m.ihsgPrice
    ? `IHSG is ${trendPhrase} near ${Math.round(m.ihsgPrice).toLocaleString("en-US")} (${formatPct(m.ihsgReturn20dPct)} over 20 days)`
    : `IHSG momentum is ${m.ihsgTrend.toLowerCase()}`;

  const fxPart =
    m.usdIdrRate && m.usdIdrChange5dPct !== null
      ? `, while USD/IDR stands at Rp ${Math.round(m.usdIdrRate).toLocaleString("en-US")} (${formatPct(m.usdIdrChange5dPct)} over 5 days).`
      : ".";

  const stancePart =
    m.regime === "RISK_ON"
      ? " Breadth supports selective swing entries on confirmed breakouts and pullbacks."
      : m.regime === "RISK_OFF"
        ? " Capital preservation takes priority; require tight stops and top-tier relative strength."
        : m.regime === "CAUTIOUS"
          ? " Keep position sizing selective until index momentum and currency pressure stabilize."
          : " Focus on liquid IDX80 setups showing clear institutional accumulation.";

  return `${ihsgPart}${fxPart}${stancePart}`;
}

export function CommandDeckScreen({
  dashboard,
  loading,
  livePrices,
  onRefresh,
}: CommandDeckProps) {
  const navigate = useNavigate();
  const [deskTab, setDeskTab] = useState<SignalDeskTab>("active");
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [showAllSkipped, setShowAllSkipped] = useState(false);
  const [expandedSkippedTicker, setExpandedSkippedTicker] = useState<string | null>(null);

  if (loading && !dashboard) {
    return (
      <div className="space-y-5" role="status" aria-live="polite">
        <div className="desk-sheet p-6 space-y-2">
          <h1 className="font-display text-2xl font-bold text-ink">Loading Market Pulse</h1>
          <p className="text-[15px] text-ink-secondary">
            Fetching IHSG macro regime, active signals, and verified performance metrics...
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-8 h-56 desk-sheet" />
          <div className="lg:col-span-4 h-56 desk-sheet" />
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="desk-sheet p-6 space-y-3 border-bear-border bg-bear-bg" role="alert">
        <h1 className="font-display text-2xl font-bold text-ink">Unable to Load Market Pulse</h1>
        <p className="text-[15px] text-ink-secondary">
          Ensure the backend service is running and reachable, then retry loading market data.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="min-h-[44px] lg:h-10 lg:min-h-0 px-5 term-btn-primary text-sm font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const { outlook, stats, activePositions, todaySignals, skippedSignals } = dashboard;
  const macro = outlook.macro;
  const macroTakeaway = buildReadableMacroTakeaway(outlook);

  const sentimentLabel =
    outlook.sentiment === "bullish"
      ? "Bullish Bias"
      : outlook.sentiment === "bearish"
        ? "Bearish Bias"
        : "Neutral Bias";

  const sentimentCls =
    outlook.sentiment === "bullish"
      ? "bg-bull-bg text-bull border border-bull-border"
      : outlook.sentiment === "bearish"
        ? "bg-bear-bg text-bear border border-bear-border"
        : "bg-subtle text-ink-secondary border border-line";

  const visibleSignals = deskTab === "active" ? activePositions : todaySignals;
  const ihsgRsi = macro.ihsgRsi14 !== null ? Math.max(0, Math.min(100, macro.ihsgRsi14)) : null;

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink">
              Market Pulse
            </h1>
            <span className="num text-sm font-medium text-ink-muted">
              Session {dashboard.date}
            </span>
            {dashboard.scheduler.pipelineRunning && (
              <span className="px-2.5 py-0.5 rounded-md bg-accent-tint border border-accent-border text-xs font-semibold text-accent">
                Scan in progress
              </span>
            )}
          </div>
          <p className="text-[15px] text-ink-secondary">
            Daily IHSG macro regime, active swing executions, and filtered setups.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh Data"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/workbench")}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Open Terminal
          </button>
        </div>
      </div>

      {/* Band 1: Asymmetric 3-Column Editorial Hero */}
      <section
        aria-label="Macro regime dial, IHSG telemetry, and signal accountability"
        className="desk-sheet grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-line overflow-hidden"
      >
        {/* Col 1: Semicircular Regime Dial + Human Takeaway */}
        <div className="lg:col-span-5 p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ink">Market Regime</h2>
            <div className="flex items-center gap-2">
              <RegimeBadge regime={macro.regime} />
              <span className={`px-2.5 py-0.5 rounded-md text-[13px] font-semibold ${sentimentCls}`}>
                {sentimentLabel}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <MacroRegimeGaugeSvg score={macro.regimeScore} regime={macro.regime} />
            <p className="text-[15px] text-ink-secondary leading-relaxed flex-1">
              {macroTakeaway}
            </p>
          </div>
        </div>

        {/* Col 2: Live IHSG + RSI Bar + USD/IDR */}
        <div className="lg:col-span-4 p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-muted">IHSG Composite</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                  macro.ihsgTrend === "BULLISH"
                    ? "bg-bull-bg text-bull border-bull-border"
                    : macro.ihsgTrend === "BEARISH"
                      ? "bg-bear-bg text-bear border-bear-border"
                      : "bg-subtle text-ink-secondary border-line"
                }`}
              >
                {macro.ihsgTrend === "BULLISH"
                  ? "Uptrend"
                  : macro.ihsgTrend === "BEARISH"
                    ? "Downtrend"
                    : "Sideways"}
              </span>
            </div>

            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-3xl sm:text-4xl font-extrabold text-ink num">
                {macro.ihsgPrice ? Math.round(macro.ihsgPrice).toLocaleString("en-US") : "-"}
              </span>
              <span
                className={`num text-sm font-bold ${
                  macro.ihsgReturn20dPct >= 0 ? "text-bull" : "text-bear"
                }`}
              >
                20D {formatPct(macro.ihsgReturn20dPct)}
              </span>
            </div>

            {ihsgRsi !== null && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-ink-muted">IHSG RSI (14)</span>
                  <span className="num font-semibold text-ink">{ihsgRsi.toFixed(1)}</span>
                </div>
                <div className="relative h-2 rounded-full bg-subtle border border-line">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-accent-solid"
                    style={{ width: `${ihsgRsi}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-line space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-muted">USD / IDR Spot</span>
              {macro.usdIdrChange5dPct !== null && (
                <span
                  className={`num text-[13px] font-semibold ${
                    macro.usdIdrChange5dPct <= 0 ? "text-bull" : "text-bear"
                  }`}
                >
                  5D {formatPct(macro.usdIdrChange5dPct)}
                </span>
              )}
            </div>
            <div className="font-display text-2xl font-extrabold text-ink num">
              {macro.usdIdrRate ? `Rp ${Math.round(macro.usdIdrRate).toLocaleString("en-US")}` : "-"}
            </div>
          </div>
        </div>

        {/* Col 3: Open Typographic Track Record */}
        <div className="lg:col-span-3 p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ink">Track Record</h2>
            <button
              type="button"
              onClick={() => navigate("/ledger")}
              className="text-sm font-semibold text-accent hover:underline py-1"
            >
              View All
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[13px] text-ink-muted">Win Rate</div>
              <div className="font-display text-2xl font-extrabold text-bull num mt-0.5">
                {stats.winRate !== null ? `${stats.winRate.toFixed(1)}%` : "-"}
              </div>
            </div>
            <div>
              <div className="text-[13px] text-ink-muted">Avg Return</div>
              <div
                className={`font-display text-2xl font-extrabold num mt-0.5 ${
                  stats.avgReturn === null
                    ? "text-ink-muted"
                    : stats.avgReturn >= 0
                      ? "text-bull"
                      : "text-bear"
                }`}
              >
                {stats.avgReturn !== null ? formatPct(stats.avgReturn) : "-"}
              </div>
            </div>
          </div>

          <dl className="divide-y divide-line border-t border-line text-sm">
            <div className="py-2 flex items-center justify-between gap-2">
              <dt className="text-ink-muted">Active Orders</dt>
              <dd className="num font-semibold text-ink">
                {stats.totalActive} ({stats.entryHit} live)
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-2">
              <dt className="text-ink-muted">Closed Trades</dt>
              <dd className="num font-semibold text-ink">{stats.totalClosed}</dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-2">
              <dt className="text-ink-muted">Best / Worst</dt>
              <dd className="num font-semibold flex items-center gap-1.5">
                <span className="text-bull">
                  {stats.bestPick ? `${stats.bestPick.ticker} ${formatPct(stats.bestPick.returnPct)}` : "-"}
                </span>
                <span className="text-ink-muted">/</span>
                <span className="text-bear">
                  {stats.worstPick ? `${stats.worstPick.ticker} ${formatPct(stats.worstPick.returnPct)}` : "-"}
                </span>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Band 2: Dual-Column Catalysts vs Risk Briefing */}
      <section aria-label="Session catalysts and risk factors" className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-bull-border bg-bull-bg/50 p-5 space-y-2.5">
          <h2 className="font-display text-base font-bold text-bull">Bullish Tailwinds</h2>
          {outlook.bullishSignals.length === 0 ? (
            <p className="text-[15px] text-ink-secondary">
              No positive macro catalysts recorded in the latest snapshot.
            </p>
          ) : (
            <ul className="space-y-1.5 text-[15px] text-ink">
              {outlook.bullishSignals.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-bull mt-2 shrink-0" aria-hidden="true" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-bear-border bg-bear-bg/50 p-5 space-y-2.5">
          <h2 className="font-display text-base font-bold text-bear">Risk Factors</h2>
          {outlook.bearishSignals.length === 0 ? (
            <p className="text-[15px] text-ink-secondary">
              No elevated macro risks recorded in the latest snapshot.
            </p>
          ) : (
            <ul className="space-y-1.5 text-[15px] text-ink">
              {outlook.bearishSignals.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-bear mt-2 shrink-0" aria-hidden="true" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Band 3: Signal Floor + Guardrail Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section aria-labelledby="signal-desk-heading" className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-1">
            <div className="flex items-center gap-4">
              <h2 id="signal-desk-heading" className="font-display text-lg font-bold text-ink">
                Signal Desk
              </h2>
              <div role="tablist" aria-label="Signal view selector" className="flex items-center gap-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={deskTab === "active"}
                  onClick={() => setDeskTab("active")}
                  className={`min-h-[44px] lg:h-10 lg:min-h-0 px-3 border-b-2 text-[15px] transition-colors ${
                    deskTab === "active"
                      ? "border-b-accent-solid text-ink font-semibold"
                      : "border-b-transparent text-ink-secondary hover:text-ink font-medium"
                  }`}
                >
                  Active Signals ({activePositions.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={deskTab === "today"}
                  onClick={() => setDeskTab("today")}
                  className={`min-h-[44px] lg:h-10 lg:min-h-0 px-3 border-b-2 text-[15px] transition-colors ${
                    deskTab === "today"
                      ? "border-b-accent-solid text-ink font-semibold"
                      : "border-b-transparent text-ink-secondary hover:text-ink font-medium"
                  }`}
                >
                  Today&apos;s Signals ({todaySignals.length})
                </button>
              </div>
            </div>
            <span className="text-[13px] text-ink-muted">Live quotes during IDX hours</span>
          </div>

          {visibleSignals.length === 0 ? (
            <div className="desk-sheet p-6 space-y-5">
              <div className="space-y-1.5">
                <h3 className="font-display text-lg font-bold text-ink">
                  {deskTab === "active"
                    ? "No active BUY positions or pending limit orders right now"
                    : "No new BUY signals published for today's session"}
                </h3>
                <p className="text-[15px] text-ink-secondary max-w-[65ch]">
                  Screen IDX80 stocks for institutional accumulation or jump straight into any bluechip chart below.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => navigate("/scanner")}
                  className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
                >
                  Scan IDX80 Screener
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/workbench")}
                  className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-semibold"
                >
                  Open Stock Terminal
                </button>
              </div>

              <div className="pt-4 border-t border-line space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Quick Chart Jump
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUICK_LAUNCH_TICKERS.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => navigate(`/workbench?ticker=${sym}`)}
                      className="min-h-[44px] lg:h-9 lg:min-h-0 px-3 rounded-md term-well hover:border-accent-border hover:text-accent font-display text-sm font-bold text-ink transition-colors"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {visibleSignals.map((sig) => (
                <SignalTicketCard
                  key={`${deskTab}-${sig.id}`}
                  signal={sig}
                  livePrice={livePrices[sig.ticker]?.price}
                />
              ))}
            </div>
          )}
        </section>

        {/* Right: Guardrail Radar */}
        <aside className="lg:col-span-4 desk-sheet overflow-hidden self-start">
          <div className="p-4 sm:px-5 sm:py-4 flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-ink">Guardrail Radar</h2>
                <span className="num px-2 py-0.5 rounded-md text-xs font-bold bg-warn-bg text-warn border border-warn-border">
                  {skippedSignals.length}
                </span>
              </div>
              <p className="text-[13px] text-ink-muted mt-0.5">
                Setups paused by R:R or macro regime rules
              </p>
            </div>

            <button
              type="button"
              aria-expanded={showWatchlist}
              aria-controls="filtered-watchlist-panel"
              onClick={() => setShowWatchlist((s) => !s)}
              className="min-h-[44px] lg:h-9 lg:min-h-0 px-3 term-btn-secondary text-xs font-semibold shrink-0"
            >
              {showWatchlist ? "Hide" : "Show"}
            </button>
          </div>

          {showWatchlist && (
            <div id="filtered-watchlist-panel" className="border-t border-line">
              {skippedSignals.length === 0 ? (
                <div className="p-5 text-[15px] text-ink-muted">
                  No stocks held back by risk filters in the latest run.
                </div>
              ) : (
                <>
                  <div className="max-h-[560px] overflow-y-auto divide-y divide-line">
                    {(showAllSkipped ? skippedSignals : skippedSignals.slice(0, 6)).map((item) => {
                      const distPct =
                        item.entryPrice > 0
                          ? ((item.currentPrice - item.entryPrice) / item.entryPrice) * 100
                          : null;
                      const isExpanded = expandedSkippedTicker === item.ticker;
                      const reason = item.guardrailReason?.trim() || "Criteria not yet met";

                      return (
                        <div key={item.ticker} className="px-4 py-2.5 space-y-1 hover:bg-hover-bg transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => navigate(`/workbench?ticker=${item.ticker}`)}
                                  className="min-h-[44px] lg:h-7 lg:min-h-0 px-2 rounded-md bg-subtle border border-line hover:border-accent-border hover:text-accent font-display text-[15px] font-extrabold text-ink transition-colors shrink-0"
                                >
                                  {item.ticker}
                                </button>
                                <span className="num px-1.5 py-0.5 rounded bg-subtle border border-line text-[12px] font-bold text-ink shrink-0">
                                  {Math.round(item.overallScore)}
                                </span>
                                <span className="text-[13px] text-ink-muted truncate">
                                  {item.companyName}
                                </span>
                              </div>
                            </div>

                            <div className="num text-right shrink-0 leading-tight">
                              <div className="text-sm font-bold text-ink">
                                {formatIdr(item.currentPrice)}
                              </div>
                              <div className="text-[12px] text-accent">
                                Entry {formatIdr(item.entryPrice)}
                                {distPct !== null ? ` (${formatPct(distPct, 1)})` : ""}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 flex items-center gap-2 text-[12px]">
                              <span className="num shrink-0 text-ink-muted">
                                SL <span className="text-bear font-medium">{item.stopLoss}</span> / TP{" "}
                                <span className="text-bull font-medium">{item.targetPrice}</span>
                              </span>
                              <span className="text-ink-secondary truncate" title={reason}>
                                {reason}
                              </span>
                            </div>

                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`skipped-detail-${item.ticker}`}
                              onClick={() =>
                                setExpandedSkippedTicker((prev) =>
                                  prev === item.ticker ? null : item.ticker,
                                )
                              }
                              className="min-h-[44px] lg:h-7 lg:min-h-0 px-2 rounded-md border border-line hover:border-line-strong text-xs font-semibold text-ink-secondary hover:text-ink transition-colors shrink-0"
                            >
                              {isExpanded ? "Hide" : "Why"}
                            </button>
                          </div>

                          {isExpanded && (
                            <div
                              id={`skipped-detail-${item.ticker}`}
                              className="pt-1.5 mt-1 border-t border-line/60 text-[13px] text-ink-secondary space-y-1 leading-relaxed"
                            >
                              <div>
                                <span className="font-semibold text-ink">Guardrail:</span> {reason}
                              </div>
                              {item.summary && (
                                <div className="text-ink-muted">{item.summary}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {skippedSignals.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllSkipped((s) => !s)}
                      className="w-full min-h-[44px] lg:h-9 lg:min-h-0 px-4 border-t border-line bg-subtle/50 hover:bg-hover-bg text-xs font-semibold text-accent transition-colors"
                    >
                      {showAllSkipped
                        ? "Show top 6"
                        : `Show all (${skippedSignals.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
