/**
 * Stock Screener (/scanner):
 * Automated IDX80/LQ45 quantitative screener featuring a live setup distribution bar,
 * directional Bandarmology CMF flow bars, and 3-state responsive reflow.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ScreenerItem, ScreenerPayload } from "@protocol/contracts.ts";
import {
  formatCompactIdr,
  formatIdr,
  formatPct,
  studioApi,
  useAdminSession,
} from "@frontend/sdk.ts";
import { CmfFlowBar, SetupBadge } from "@frontend/visuals/TradingWidgets.tsx";
import { GlassSelect } from "@frontend/visuals/GlassControls.tsx";
import { SvgIcon } from "@frontend/layout/StudioFrame.tsx";

type SortKey =
  | "quantScore"
  | "bandarmologyScore"
  | "rsRating"
  | "riskRewardRatio"
  | "changePct"
  | "dailyTurnover";

const SETUP_SEGMENTS = [
  { value: "ALL", label: "All Setups", colorCls: "bg-ink-muted" },
  { value: "BREAKOUT", label: "Breakout", colorCls: "bg-bull" },
  { value: "PULLBACK", label: "Pullback", colorCls: "bg-accent-solid" },
  { value: "SILENT_ACCUMULATION", label: "Accumulation", colorCls: "bg-warn" },
  { value: "CONTRARIAN_BOUNCE", label: "Contrarian", colorCls: "bg-bear" },
];

const TREND_OPTIONS = [
  { value: "ALL", label: "All Trends" },
  { value: "BULLISH", label: "Bullish" },
  { value: "SIDEWAYS", label: "Sideways" },
  { value: "BEARISH", label: "Bearish" },
];

export function MarketScannerScreen() {
  const navigate = useNavigate();
  const adminUnlocked = useAdminSession();

  const [data, setData] = useState<ScreenerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [setupFilter, setSetupFilter] = useState("ALL");
  const [trendFilter, setTrendFilter] = useState("ALL");
  const [minScore, setMinScore] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>("quantScore");
  const [sortDesc, setSortDesc] = useState(true);

  const loadScreener = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await studioApi.getScreener({ refresh });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScreener(false);
  }, [loadScreener]);

  const toggleWatchlist = async (item: ScreenerItem) => {
    if (!adminUnlocked) return;
    setWatchlistError(null);
    try {
      if (item.isWatchlisted) await studioApi.removeWatchlist(item.ticker);
      else await studioApi.addWatchlist(item.ticker);
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((x) =>
                x.ticker === item.ticker ? { ...x, isWatchlisted: !x.isWatchlisted } : x
              ),
            }
          : prev
      );
    } catch (err) {
      setWatchlistError(err instanceof Error ? err.message : "Failed to update watchlist.");
    }
  };

  const setupCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: data?.items.length ?? 0,
      BREAKOUT: 0,
      PULLBACK: 0,
      SILENT_ACCUMULATION: 0,
      CONTRARIAN_BOUNCE: 0,
    };
    if (data) {
      for (const item of data.items) {
        if (counts[item.setupType] !== undefined) {
          counts[item.setupType] = (counts[item.setupType] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toUpperCase();
    return data.items
      .filter((i) => !q || i.ticker.includes(q) || i.companyName.toUpperCase().includes(q))
      .filter((i) => setupFilter === "ALL" || i.setupType === setupFilter)
      .filter((i) => trendFilter === "ALL" || i.trend === trendFilter)
      .filter((i) => i.quantScore >= minScore)
      .sort((a, b) => {
        const diff = a[sortBy] - b[sortBy];
        return sortDesc ? -diff : diff;
      });
  }, [data, query, setupFilter, trendFilter, minScore, sortBy, sortDesc]);

  const hasActiveFilters =
    query.trim() !== "" || setupFilter !== "ALL" || trendFilter !== "ALL" || minScore > 0;

  const resetFilters = () => {
    setQuery("");
    setSetupFilter("ALL");
    setTrendFilter("ALL");
    setMinScore(0);
  };

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDesc((d) => !d);
    else {
      setSortBy(key);
      setSortDesc(true);
    }
  };

  const renderSortLabel = (key: SortKey, text: string) => {
    const active = sortBy === key;
    const dir = active ? (sortDesc ? " ↓" : " ↑") : "";
    return `${text}${dir}`;
  };

  const totalItems = Math.max(1, data?.items.length ?? 0);

  const renderCard = (item: ScreenerItem) => (
    <article key={item.ticker} className="p-4 space-y-3 text-sm bg-surface">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {adminUnlocked && (
            <button
              type="button"
              onClick={() => void toggleWatchlist(item)}
              aria-pressed={item.isWatchlisted}
              aria-label={
                item.isWatchlisted
                  ? `Remove ${item.ticker} from watchlist`
                  : `Add ${item.ticker} to watchlist`
              }
              className={`min-h-[44px] min-w-[44px] lg:h-8 lg:w-8 lg:min-h-0 lg:min-w-0 inline-flex items-center justify-center rounded-md term-well shrink-0 ${
                item.isWatchlisted ? "text-warn" : "text-ink-muted hover:text-warn"
              }`}
            >
              <SvgIcon.Star filled={item.isWatchlisted} />
            </button>
          )}
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/workbench?ticker=${item.ticker}`)}
              className="min-h-[44px] lg:h-8 lg:min-h-0 px-2.5 rounded-md bg-subtle border border-line hover:border-accent-border hover:text-accent font-display text-base font-extrabold text-ink"
            >
              {item.ticker}
            </button>
            <div className="text-[13px] text-ink-muted truncate mt-1">{item.companyName}</div>
          </div>
        </div>

        <div className="text-right shrink-0 num">
          <div className="font-bold text-[15px] text-ink">{formatIdr(item.price)}</div>
          <div className={`text-[13px] font-semibold ${item.changePct >= 0 ? "text-bull" : "text-bear"}`}>
            {formatPct(item.changePct)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <SetupBadge setup={item.setupType} />
        <span
          className={`font-semibold ${
            item.trend === "BULLISH"
              ? "text-bull"
              : item.trend === "BEARISH"
                ? "text-bear"
                : "text-ink-muted"
          }`}
        >
          {item.trend === "BULLISH"
            ? "Bullish"
            : item.trend === "BEARISH"
              ? "Bearish"
              : "Sideways"}
        </span>
        <span className="num font-bold px-2.5 py-0.5 rounded-md bg-subtle border border-line text-ink ml-auto">
          Quant {item.quantScore}
        </span>
      </div>

      <div className="py-2.5 border-y border-line grid grid-cols-2 gap-3 items-center">
        <div>
          <div className="text-[12px] text-ink-muted mb-1">Bandarmology CMF(20)</div>
          <CmfFlowBar cmf20={item.cmf20} score={item.bandarmologyScore} />
        </div>
        <div className="num text-[13px] text-right">
          <div className="text-ink-muted">Entry / R:R</div>
          <div className="font-semibold text-accent">{formatIdr(item.entryPrice)}</div>
          <div className="font-bold text-ink">{item.riskRewardRatio.toFixed(2)}x</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="num text-[13px] text-ink-muted">
          Turnover {formatCompactIdr(item.dailyTurnover)}
        </span>
        <button
          type="button"
          onClick={() => navigate(`/workbench?ticker=${item.ticker}`)}
          className="min-h-[44px] lg:h-9 lg:min-h-0 px-3.5 term-btn-secondary text-sm font-semibold"
        >
          Analyze
        </button>
      </div>
    </article>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink">
              Stock Screener
            </h1>
            {data && (
              <span className="num text-sm font-medium text-ink-muted">
                {data.scannedCount} IDX equities scanned · {rows.length} matching
              </span>
            )}
          </div>
          <p className="text-[15px] text-ink-secondary">
            Rank liquid IDX80 setups by quantitative structure, Bandarmology flow, and net reward-to-risk.
          </p>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={() => void loadScreener(true)}
          className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary disabled:opacity-50 text-sm font-semibold"
        >
          {loading ? "Scanning IDX80..." : "Rescan IDX80"}
        </button>
      </div>

      {/* Admin Watchlist Error */}
      {watchlistError && (
        <div
          role="alert"
          className="desk-sheet border-bear-border bg-bear-bg p-4 flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          <span className="text-bear font-semibold">{watchlistError}</span>
          <button
            type="button"
            onClick={() => setWatchlistError(null)}
            className="min-h-[44px] lg:h-8 lg:min-h-0 px-3 term-btn-secondary text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Setup Distribution & Filter Bar */}
      <section aria-label="Screener filters and setup distribution" className="desk-sheet p-4 sm:p-5 space-y-4">
        {/* Proportional Setup Breakdown Bar */}
        {data && data.items.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-semibold text-ink-secondary">Universe Setup Mix</span>
              <span className="num text-ink-muted">{data.items.length} qualified candidates</span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden flex bg-subtle border border-line gap-px">
              {SETUP_SEGMENTS.filter((s) => s.value !== "ALL").map((seg) => {
                const count = setupCounts[seg.value] ?? 0;
                if (count === 0) return null;
                const pct = (count / totalItems) * 100;
                return (
                  <div
                    key={seg.value}
                    title={`${seg.label}: ${count}`}
                    className={`${seg.colorCls} h-full`}
                    style={{ width: `${pct}%` }}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Setup Preset Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Setup preset"
            className="inline-flex flex-wrap gap-1.5"
          >
            {SETUP_SEGMENTS.map((seg) => {
              const active = setupFilter === seg.value;
              const count = setupCounts[seg.value] ?? 0;
              return (
                <button
                  key={seg.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSetupFilter(seg.value)}
                  className={`min-h-[44px] lg:h-9 lg:min-h-0 px-3 rounded-md text-sm border transition-colors inline-flex items-center gap-2 ${
                    active
                      ? "bg-accent-tint border-accent-border text-accent font-semibold"
                      : "bg-subtle border-line text-ink-secondary hover:text-ink font-medium"
                  }`}
                >
                  {seg.value !== "ALL" && (
                    <span className={`w-2 h-2 rounded-full ${seg.colorCls}`} aria-hidden="true" />
                  )}
                  <span>{seg.label}</span>
                  <span className="num text-xs opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="min-h-[44px] lg:h-9 lg:min-h-0 px-3.5 term-btn-secondary text-sm font-medium"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Inputs Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-line items-end">
          <div className="space-y-1.5">
            <label htmlFor="scanner-query-input" className="block text-sm font-medium text-ink-secondary">
              Emiten or Company
            </label>
            <input
              id="scanner-query-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="BBCA or Bank Central Asia"
              className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] placeholder:text-ink-muted"
            />
          </div>

          <GlassSelect
            id="scanner-trend-select"
            label="Trend"
            value={trendFilter}
            options={TREND_OPTIONS}
            onChange={setTrendFilter}
          />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="scanner-score-range" className="font-medium text-ink-secondary">
                Min Quant Score
              </label>
              <span className="num font-bold text-ink">{minScore}</span>
            </div>
            <div className="min-h-[44px] lg:h-10 lg:min-h-0 flex items-center">
              <input
                id="scanner-score-range"
                type="range"
                min={0}
                max={85}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full term-slider"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="desk-sheet border-bear-border bg-bear-bg p-5 space-y-3 text-[15px]"
        >
          <div className="font-semibold text-bear">Screener scan failed: {error}</div>
          <button
            type="button"
            onClick={() => void loadScreener(true)}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Retry Scan
          </button>
        </div>
      )}

      {/* Results Matrix */}
      <div className="desk-sheet overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center text-[15px] text-ink-secondary" role="status" aria-live="polite">
            Scanning IDX80 equities and computing technical and Bandarmology flow scores...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-[15px] font-semibold text-ink">
              {data && data.items.length > 0
                ? "No IDX equities match the active filters."
                : "No screener results available yet. Run a scan to populate the board."}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-medium"
                >
                  Reset Filters
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadScreener(true)}
                className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
              >
                Rescan IDX80
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-[15px] text-left whitespace-nowrap">
                <thead className="bg-subtle text-ink-muted text-[13px] font-semibold border-b border-line">
                  <tr>
                    {adminUnlocked && <th className="px-3 py-3 w-11 text-center">Pin</th>}
                    <th className="px-4 py-3">Emiten</th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("changePct")}
                        className="h-8 px-1 font-semibold hover:text-ink"
                      >
                        {renderSortLabel("changePct", "Last & %Chg")}
                      </button>
                    </th>
                    <th className="px-3 py-3">Setup &amp; Trend</th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("quantScore")}
                        className="h-8 px-1 font-semibold hover:text-ink"
                      >
                        {renderSortLabel("quantScore", "Quant Score")}
                      </button>
                    </th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => handleSort("bandarmologyScore")}
                        className="h-8 px-1 font-semibold hover:text-ink"
                      >
                        {renderSortLabel("bandarmologyScore", "Bandarmology Flow")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("rsRating")}
                        className="h-8 px-1 font-semibold hover:text-ink"
                      >
                        {renderSortLabel("rsRating", "RS / RSI14")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("dailyTurnover")}
                        className="h-8 px-1 font-semibold hover:text-ink"
                      >
                        {renderSortLabel("dailyTurnover", "Turnover")}
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">Trade Plan</th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort("riskRewardRatio")}
                        className="h-8 px-1 font-semibold hover:text-ink"
                      >
                        {renderSortLabel("riskRewardRatio", "Net R:R")}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((item) => {
                    const barColor =
                      item.quantScore >= 72
                        ? "bg-bull"
                        : item.quantScore >= 58
                          ? "bg-accent-solid"
                          : "bg-ink-muted";
                    return (
                      <tr key={item.ticker} className="hover:bg-hover-bg transition-colors">
                        {adminUnlocked && (
                          <td className="px-3 py-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => void toggleWatchlist(item)}
                              aria-pressed={item.isWatchlisted}
                              aria-label={
                                item.isWatchlisted
                                  ? `Remove ${item.ticker} from watchlist`
                                  : `Add ${item.ticker} to watchlist`
                              }
                              className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition-colors ${
                                item.isWatchlisted
                                  ? "text-warn hover:bg-subtle"
                                  : "text-ink-muted hover:text-warn hover:bg-subtle"
                              }`}
                            >
                              <SvgIcon.Star filled={item.isWatchlisted} />
                            </button>
                          </td>
                        )}
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={() => navigate(`/workbench?ticker=${item.ticker}`)}
                            className="font-display text-base font-extrabold text-ink hover:text-accent transition-colors text-left"
                          >
                            {item.ticker}
                          </button>
                          <div className="text-[13px] text-ink-muted truncate max-w-[175px]">
                            {item.companyName}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right num">
                          <div className="font-bold text-ink">{formatIdr(item.price)}</div>
                          <div className={`text-[13px] font-semibold ${item.changePct >= 0 ? "text-bull" : "text-bear"}`}>
                            {formatPct(item.changePct)}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 space-y-1">
                          <div>
                            <SetupBadge setup={item.setupType} />
                          </div>
                          <div
                            className={`text-[13px] font-semibold ${
                              item.trend === "BULLISH"
                                ? "text-bull"
                                : item.trend === "BEARISH"
                                  ? "text-bear"
                                  : "text-ink-muted"
                            }`}
                          >
                            {item.trend === "BULLISH"
                              ? "Bullish"
                              : item.trend === "BEARISH"
                                ? "Bearish"
                                : "Sideways"}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right num">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <span className="w-12 h-2 rounded-full bg-subtle border border-line overflow-hidden hidden xl:inline-block">
                              <span
                                className={`block h-full rounded-full ${barColor}`}
                                style={{ width: `${Math.min(100, Math.max(4, item.quantScore))}%` }}
                              />
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-md text-[13px] font-bold border ${
                                item.quantScore >= 72
                                  ? "bg-bull-bg text-bull border-bull-border"
                                  : item.quantScore >= 58
                                    ? "bg-accent-tint text-accent border-accent-border"
                                    : "bg-subtle text-ink-secondary border-line"
                              }`}
                            >
                              {item.quantScore}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <CmfFlowBar cmf20={item.cmf20} score={item.bandarmologyScore} />
                        </td>
                        <td className="px-3 py-3.5 text-right num">
                          <div className="text-ink font-semibold">RS {item.rsRating}</div>
                          <div className="text-[13px] text-ink-muted">
                            RSI {item.rsi14 !== null ? item.rsi14.toFixed(0) : "-"}
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right num text-sm text-ink-secondary">
                          {formatCompactIdr(item.dailyTurnover)}
                        </td>
                        <td className="px-3 py-3.5 text-right num text-[13px]">
                          <div className="text-accent font-semibold">{formatIdr(item.entryPrice)}</div>
                          <div>
                            <span className="text-bear">{item.stopLoss}</span> /{" "}
                            <span className="text-bull">{item.targetPrice}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-right num font-bold text-ink">
                          {item.riskRewardRatio.toFixed(2)}x
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => navigate(`/workbench?ticker=${item.ticker}`)}
                            className="h-9 px-3 term-btn-secondary text-[13px] font-semibold"
                          >
                            Analyze
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tablet 2-Column Reflow */}
            <div className="hidden sm:grid sm:grid-cols-2 lg:hidden gap-3 p-3 bg-canvas">
              {rows.map((item) => (
                <div key={item.ticker} className="desk-sheet overflow-hidden">
                  {renderCard(item)}
                </div>
              ))}
            </div>

            {/* Mobile 1-Column Reflow */}
            <div className="sm:hidden divide-y divide-line">
              {rows.map(renderCard)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
