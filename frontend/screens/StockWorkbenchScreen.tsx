/**
 * Stock Terminal Screen (/workbench):
 * Editorial Quote Masthead with Visual IDX ARA/ARB Daily Range Track paired with 8:4 layout:
 * Left: Interactive 65D Candlestick Chart + IDX Execution Blueprint + KeyStats Magazine Tabs.
 * Right: Circular Conviction Score Ring + 4-Pillar Bars + Stockbit Buy Order Pad.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TickerAnalysisPayload } from "@protocol/contracts.ts";
import {
  formatCompactIdr,
  formatIdr,
  formatNumber,
  formatPct,
  isAdminUnlocked,
  studioApi,
} from "@frontend/sdk.ts";
import {
  ActionBadge,
  InteractiveLotSizer,
  PriceStructureSvg,
  RiskRewardRuler,
  ScoreRingSvg,
  SetupBadge,
} from "@frontend/visuals/TradingWidgets.tsx";

const QUICK_TICKERS = [
  "BBCA",
  "BBRI",
  "BMRI",
  "TLKM",
  "ASII",
  "ADRO",
  "ANTM",
  "BRIS",
  "AMMN",
  "PGEO",
];

type BreakdownTab = "fundamentals" | "flow" | "technical" | "news";

export function StockWorkbenchScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTicker = (searchParams.get("ticker") || "BBCA").toUpperCase();

  const [inputTicker, setInputTicker] = useState(initialTicker);
  const [skipAi, setSkipAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TickerAnalysisPayload | null>(null);
  const [activeTab, setActiveTab] = useState<BreakdownTab>("fundamentals");

  const runAnalysis = useCallback(
    async (ticker: string, force = false, quantOnly = skipAi) => {
      const clean = ticker.trim().toUpperCase().replace(/\.JK$/i, "");
      if (!clean) return;
      setLoading(true);
      setError(null);
      try {
        const res = await studioApi.analyzeTicker({
          ticker: clean,
          force,
          skipAi: quantOnly,
        });
        setPayload(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [skipAi]
  );

  useEffect(() => {
    const paramTicker = (searchParams.get("ticker") || "BBCA").toUpperCase();
    setInputTicker(paramTicker);
    void runAnalysis(paramTicker, false, skipAi);
  }, [searchParams, runAnalysis, skipAi]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = inputTicker.trim().toUpperCase().replace(/\.JK$/i, "");
    if (!clean) return;
    setSearchParams({ ticker: clean });
    void runAnalysis(clean, false, skipAi);
  };

  const handleRefreshLive = async () => {
    if (!payload?.ticker) return;
    if (isAdminUnlocked()) {
      await studioApi.purgeAnalysisCache(payload.ticker).catch(() => {});
    }
    void runAnalysis(payload.ticker, true, skipAi);
  };

  const a = payload?.analysis;
  const t = payload?.technical;
  const f = payload?.fundamentals;

  const breakdownTabs: Array<{ id: BreakdownTab; label: string }> = [
    { id: "fundamentals", label: "KeyStats" },
    { id: "flow", label: "Bandarmology Flow" },
    { id: "technical", label: "Technicals" },
    { id: "news", label: "News & Sentiment" },
  ];

  const pillarRows = a
    ? [
        { label: "Technical Structure", score: Math.round(a.technicalScore), tone: "bg-bull" },
        { label: "Bandarmology Flow", score: Math.round(a.quantScores.bandarmology), tone: "bg-bull" },
        { label: "Fundamental Quality", score: Math.round(a.fundamentalScore), tone: "bg-accent-solid" },
        { label: "News Sentiment", score: Math.round(a.sentimentScore), tone: "bg-warn" },
      ]
    : [];

  const araSpan = payload
    ? Math.max(1, payload.autoReject.ara - payload.autoReject.arb)
    : 1;
  const araMarkerPct = payload
    ? Math.max(0, Math.min(100, ((payload.currentPrice - payload.autoReject.arb) / araSpan) * 100))
    : 50;

  return (
    <div className="space-y-5">
      {/* Top Quick Switcher Bar */}
      <div className="desk-sheet p-4 flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="workbench-ticker-input" className="text-sm font-semibold text-ink-secondary">
            Emiten
          </label>
          <input
            id="workbench-ticker-input"
            type="text"
            value={inputTicker}
            onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
            placeholder="BBCA"
            maxLength={8}
            className="w-28 min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] font-display font-bold uppercase"
          />

          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary disabled:opacity-50 text-sm font-semibold"
          >
            {loading ? "Loading..." : "Load Ticker"}
          </button>

          <button
            type="button"
            disabled={loading || !payload}
            onClick={() => void handleRefreshLive()}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-3.5 term-btn-secondary disabled:opacity-50 text-sm font-medium"
          >
            Refresh Live
          </button>

          <label
            htmlFor="workbench-skip-ai"
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-3 rounded-md term-well inline-flex items-center gap-2 text-sm font-medium text-ink-secondary hover:text-ink"
          >
            <input
              id="workbench-skip-ai"
              type="checkbox"
              checked={skipAi}
              onChange={(e) => setSkipAi(e.target.checked)}
              className="w-4 h-4 rounded accent-[var(--accent)]"
            />
            <span>Quant Fast Mode</span>
          </label>
        </form>

        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_TICKERS.map((sym) => {
            const active = payload?.ticker === sym;
            return (
              <button
                key={sym}
                type="button"
                onClick={() => setSearchParams({ ticker: sym })}
                className={`min-h-[44px] lg:h-9 lg:min-h-0 px-2.5 rounded-md text-[13px] font-bold transition-colors ${
                  active ? "term-btn-primary" : "term-btn-secondary"
                }`}
              >
                {sym}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading State */}
      {loading && !payload && (
        <div className="desk-sheet p-6 space-y-2" role="status" aria-live="polite">
          <h1 className="font-display text-2xl font-bold text-ink">
            Loading {inputTicker} Terminal Data...
          </h1>
          <p className="text-[15px] text-ink-secondary">
            Fetching OHLC bars, Bandarmology flow, KeyStats fundamentals, and Indonesian news sentiment.
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div role="alert" className="desk-sheet border-bear-border bg-bear-bg p-5 space-y-3 text-[15px]">
          {!payload && !loading && (
            <h1 className="font-display text-2xl font-bold text-ink">Stock Terminal</h1>
          )}
          <div className="font-semibold text-bear">
            Failed to analyze {inputTicker}: {error}
          </div>
          <button
            type="button"
            onClick={() => void runAnalysis(inputTicker, true, skipAi)}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Retry Load
          </button>
        </div>
      )}

      {/* Loaded Stock Terminal */}
      {payload && t && (
        <>
          {/* Editorial Quote Masthead */}
          <section
            aria-label="Emiten quote masthead"
            className="desk-sheet p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-5 items-center"
          >
            <div className="md:col-span-7 space-y-2 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink">
                  {payload.ticker}
                </h1>
                {a && (
                  <>
                    <ActionBadge action={a.action} />
                    <SetupBadge setup={a.setupType} />
                  </>
                )}
              </div>
              <div className="text-[15px] text-ink-secondary flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold text-ink">{payload.companyName}</span>
                {payload.sector && <span>· {payload.sector}</span>}
              </div>
            </div>

            <div className="md:col-span-5 space-y-2.5">
              <div className="flex flex-wrap items-baseline md:justify-end gap-3">
                <span className="font-display text-3xl sm:text-4xl font-extrabold text-ink num">
                  {formatIdr(payload.currentPrice)}
                </span>
                <span
                  className={`num px-2.5 py-0.5 rounded-md border text-sm font-bold ${
                    payload.priceChangePct >= 0
                      ? "bg-bull-bg text-bull border-bull-border"
                      : "bg-bear-bg text-bear border-bear-border"
                  }`}
                >
                  {payload.priceChange >= 0 ? "+" : ""}
                  {payload.priceChange} ({formatPct(payload.priceChangePct)})
                </span>
              </div>

              {/* Visual IDX ARA / ARB Daily Band */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[12px] num font-medium">
                  <span className="text-bear">ARB {formatIdr(payload.autoReject.arb)}</span>
                  <span className="text-ink-muted">IDX Daily Band (±{payload.autoReject.pct}%)</span>
                  <span className="text-bull">ARA {formatIdr(payload.autoReject.ara)}</span>
                </div>
                <div className="relative h-2 rounded-full bg-subtle border border-line">
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-ink border-2 border-accent-solid"
                    style={{ left: `calc(${araMarkerPct}% - 6px)` }}
                    title={`Last ${formatIdr(payload.currentPrice)}`}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Main 8:4 Split */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Left 8 Cols: Chart + Blueprint + KeyStats */}
            <div className="xl:col-span-8 space-y-5">
              {/* 65D Chart */}
              <section className="desk-sheet p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-ink">
                    65-Day Price Structure vs Entry, Stop &amp; Targets
                  </h2>
                  <span className="text-[13px] text-ink-muted">Daily OHLC · SMA20 · VWAP20</span>
                </div>
                <PriceStructureSvg
                  bars={payload.recentBars}
                  sma20={t.sma20}
                  vwap20={t.vwap20}
                  entryPrice={a?.entryPrice}
                  stopLoss={a?.stopLoss}
                  targetPrice1={a?.targetPrice1}
                  targetPrice={a?.targetPrice}
                />
              </section>

              {/* IDX Execution Blueprint */}
              <section className="desk-sheet p-5 space-y-4">
                <h2 className="font-display text-lg font-bold text-ink">IDX Execution Blueprint</h2>
                {a ? (
                  <>
                    {a.guardrailReason && (
                      <div className="px-4 py-3 rounded-md border border-warn-border bg-warn-bg text-sm text-warn">
                        <strong>Risk guardrail:</strong> {a.guardrailReason}
                      </div>
                    )}

                    <RiskRewardRuler
                      stopLoss={a.stopLoss}
                      entryPrice={a.entryPrice}
                      currentPrice={payload.currentPrice}
                      targetPrice1={a.targetPrice1}
                      targetPrice={a.targetPrice}
                      showLabels={true}
                    />

                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-4 pt-3 border-t border-line text-[13px]">
                      <div>
                        <div className="text-ink-muted">Entry ({a.orderType})</div>
                        <div className="num text-base font-bold text-accent mt-0.5">
                          {formatIdr(a.entryPrice)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted">Stop Loss</div>
                        <div className="num text-base font-bold text-bear mt-0.5">
                          {formatIdr(a.stopLoss)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted">Target 1</div>
                        <div className="num text-base font-bold text-bull mt-0.5">
                          {formatIdr(a.targetPrice1)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted">Target 2</div>
                        <div className="num text-base font-bold text-bull mt-0.5">
                          {formatIdr(a.targetPrice)}
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted">Net R:R</div>
                        <div className="num text-base font-bold text-ink mt-0.5">
                          {a.riskRewardRatio.toFixed(2)}x
                        </div>
                      </div>
                      <div>
                        <div className="text-ink-muted">Max Hold</div>
                        <div className="num text-base font-bold text-ink mt-0.5">
                          {a.maxHoldDays}d
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="term-well p-4 text-[15px] text-ink-secondary">
                    Trade plan is unavailable for this ticker. Quantitative metrics remain displayed below.
                  </div>
                )}
              </section>

              {/* KeyStats Magazine Tabs */}
              <section className="desk-sheet p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-bold text-ink">
                    KeyStats &amp; Thesis Breakdown
                  </h2>
                  {a && (
                    <span className="num text-sm font-semibold text-ink-muted">
                      {activeTab === "fundamentals"
                        ? `Fundamental ${a.fundamentalScore}/100`
                        : activeTab === "flow"
                          ? `Flow ${a.quantScores.bandarmology}/100`
                          : activeTab === "technical"
                            ? `Technical ${a.technicalScore}/100`
                            : `Sentiment ${a.sentimentScore}/100`}
                    </span>
                  )}
                </div>

                <div
                  role="tablist"
                  aria-label="Stockbit KeyStats and research tabs"
                  className="flex flex-wrap border-b border-line gap-1"
                >
                  {breakdownTabs.map((tab) => {
                    const selected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setActiveTab(tab.id)}
                        className={`min-h-[44px] lg:h-10 lg:min-h-0 px-4 border-b-[3px] text-[15px] transition-colors ${
                          selected
                            ? "border-b-accent-solid text-ink font-semibold"
                            : "border-b-transparent text-ink-secondary hover:text-ink font-medium"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <div role="tabpanel" className="space-y-4 pt-1">
                  {activeTab === "fundamentals" && (
                    <>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 text-[15px]">
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Market Cap</dt>
                          <dd className="num text-base font-bold text-ink">{formatCompactIdr(f?.marketCap)}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">P/E · Forward P/E</dt>
                          <dd className="num text-base font-bold text-ink">
                            {formatNumber(f?.peRatio, 2)}x · {formatNumber(f?.forwardPe, 2)}x
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Price to Book (P/B)</dt>
                          <dd className="num text-base font-bold text-ink">{formatNumber(f?.pbRatio, 2)}x</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Return on Equity (ROE)</dt>
                          <dd className="num text-base font-bold text-ink">
                            {f?.roe !== null && f?.roe !== undefined ? `${(f.roe * 100).toFixed(1)}%` : "-"}
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Debt / Equity</dt>
                          <dd className="num text-base font-bold text-ink">{formatNumber(f?.debtToEquity, 1)}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Dividend Yield</dt>
                          <dd className="num text-base font-bold text-ink">
                            {f?.dividendYield !== null && f?.dividendYield !== undefined
                              ? `${(f.dividendYield * 100).toFixed(2)}%`
                              : "-"}
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Revenue Growth</dt>
                          <dd className="num text-base font-bold text-ink">
                            {f?.revenueGrowth !== null && f?.revenueGrowth !== undefined
                              ? `${(f.revenueGrowth * 100).toFixed(1)}%`
                              : "-"}
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Profit Margin</dt>
                          <dd className="num text-base font-bold text-ink">
                            {f?.profitMargin !== null && f?.profitMargin !== undefined
                              ? `${(f.profitMargin * 100).toFixed(1)}%`
                              : "-"}
                          </dd>
                        </div>
                      </dl>
                      {a && (
                        <p className="text-[15px] text-ink-secondary leading-relaxed max-w-[68ch]">
                          {a.fundamentalSummary}
                        </p>
                      )}
                    </>
                  )}

                  {activeTab === "flow" && (
                    <>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 text-[15px]">
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Flow Status</dt>
                          <dd className="text-base font-bold text-ink">{t.accumulationStatus}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">5D Volume Flow Ratio</dt>
                          <dd className="num text-base font-bold text-ink">{t.volumeFlowRatio.toFixed(2)}x</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">CMF (20)</dt>
                          <dd className="num text-base font-bold text-ink">{formatNumber(t.cmf20, 3)}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">OBV Divergence</dt>
                          <dd className="text-base font-bold text-ink">{t.obvDivergence}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Relative Strength vs IHSG</dt>
                          <dd className="num text-base font-bold text-ink">
                            {t.rsRating} ({formatPct(t.rsDiff20dPct)})
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Daily Turnover</dt>
                          <dd className="num text-base font-bold text-ink">{formatCompactIdr(t.dailyTurnover)}</dd>
                        </div>
                      </dl>
                      {a && (
                        <p className="text-[15px] text-ink-secondary leading-relaxed max-w-[68ch]">
                          {a.analysisSummary}
                        </p>
                      )}
                    </>
                  )}

                  {activeTab === "technical" && (
                    <>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 text-[15px]">
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Primary Trend</dt>
                          <dd className="text-base font-bold text-ink">{t.trend}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">RSI (14)</dt>
                          <dd className="num text-base font-bold text-ink">{formatNumber(t.rsi14, 1)}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">SMA20 / SMA50</dt>
                          <dd className="num text-base font-bold text-ink">
                            {formatIdr(t.sma20)} / {formatIdr(t.sma50)}
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">VWAP20 / ATR14</dt>
                          <dd className="num text-base font-bold text-ink">
                            {formatIdr(t.vwap20)} / {formatIdr(t.atr14)}
                          </dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">MACD State</dt>
                          <dd className="text-base font-bold text-ink">{t.macd?.trend ?? "-"}</dd>
                        </div>
                        <div className="py-2.5 border-b border-line flex justify-between gap-2">
                          <dt className="text-ink-muted">Candle Pattern</dt>
                          <dd className="text-base font-bold text-ink text-right">{t.candlestickPattern}</dd>
                        </div>
                      </dl>
                      {a && (
                        <p className="text-[15px] text-ink-secondary leading-relaxed max-w-[68ch]">
                          {a.technicalSummary}
                        </p>
                      )}
                    </>
                  )}

                  {activeTab === "news" && (
                    <div className="space-y-3">
                      {a && (
                        <p className="text-[15px] text-ink-secondary leading-relaxed max-w-[68ch]">
                          {a.newsSummary}
                        </p>
                      )}
                      {payload.relevantNews.length === 0 ? (
                        <div className="term-well p-4 text-[15px] text-ink-muted">
                          No recent IDX financial news matched {payload.ticker}.
                        </div>
                      ) : (
                        <div className="divide-y divide-line text-sm">
                          {payload.relevantNews.map((n, idx) => (
                            <div key={idx} className="py-3 flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <div className="text-[15px] font-medium text-ink leading-snug">{n.title}</div>
                                <span className="inline-block px-2 py-0.5 rounded bg-subtle border border-line text-xs text-ink-muted">
                                  {n.portal}
                                </span>
                              </div>
                              <span
                                className={`num font-bold px-2.5 py-0.5 rounded-md border shrink-0 text-[13px] ${
                                  n.sentiment > 0.1
                                    ? "bg-bull-bg text-bull border-bull-border"
                                    : n.sentiment < -0.1
                                      ? "bg-bear-bg text-bear border-bear-border"
                                      : "bg-subtle text-ink-muted border-line"
                                }`}
                              >
                                {n.sentiment >= 0 ? "+" : ""}
                                {n.sentiment.toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right 4 Cols: Conviction Score Ring + Buy Order Pad */}
            <div className="xl:col-span-4 space-y-5">
              {a && (
                <section aria-label="Composite conviction and pillar scores" className="desk-sheet p-5 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-lg font-bold text-ink">Conviction Matrix</h2>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-subtle border border-line text-ink-secondary">
                      {a.mode === "HYBRID" ? "Hybrid LLM + Quant" : "Quant Fallback"}
                    </span>
                  </div>

                  <div className="flex items-center gap-5">
                    <ScoreRingSvg score={a.overallScore} label="Composite" />
                    <div className="flex-1 space-y-2.5">
                      {pillarRows.map((row) => (
                        <div key={row.label} className="space-y-1">
                          <div className="flex items-center justify-between text-[13px]">
                            <span className="text-ink-secondary font-medium">{row.label}</span>
                            <span className="num font-bold text-ink">{row.score}</span>
                          </div>
                          <div className="h-2 rounded-full bg-subtle border border-line overflow-hidden">
                            <div
                              className={`h-full rounded-full ${row.tone}`}
                              style={{ width: `${Math.max(3, Math.min(100, row.score))}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-line text-[13px] text-ink-muted flex items-center justify-between gap-2">
                    <span>Evaluation Model</span>
                    <span className="font-semibold text-ink-secondary truncate">{a.modelUsed}</span>
                  </div>
                </section>
              )}

              {a ? (
                <InteractiveLotSizer
                  entryPrice={a.entryPrice}
                  stopLoss={a.stopLoss}
                  targetPrice1={a.targetPrice1}
                  targetPrice={a.targetPrice}
                  suggestedRiskPct={a.positionSizing.suggestedRiskPct}
                />
              ) : (
                <div className="desk-sheet p-5 text-[15px] text-ink-muted">
                  Order calculator activates once entry and stop-loss levels are computed.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
