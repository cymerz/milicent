/**
 * Signal Track Record (/ledger):
 * Full-width paginated accountability log with editorial summary strip,
 * visual Win/Loss ratio indicator, custom TerminalSelect filters, and 3-state reflow.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { HistoryPayload, SignalRecord } from "@protocol/contracts.ts";
import { formatIdr, formatPct, studioApi } from "@frontend/sdk.ts";
import { ActionBadge, SetupBadge, StatusBadge } from "@frontend/visuals/TradingWidgets.tsx";
import { GlassSelect } from "@frontend/visuals/GlassControls.tsx";

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "entry_hit", label: "Active" },
  { value: "target_hit", label: "Target Hit" },
  { value: "sl_hit", label: "Stopped Out" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export function AuditLedgerScreen() {
  const navigate = useNavigate();
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ticker, setTicker] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const loadHistory = useCallback(
    async (
      targetPage: number,
      overrides?: { ticker?: string; status?: string; startDate?: string; endDate?: string }
    ) => {
      setLoading(true);
      setError(null);
      try {
        const activeTicker = overrides ? overrides.ticker : ticker;
        const activeStatus = overrides ? overrides.status : status;
        const activeStart = overrides ? overrides.startDate : startDate;
        const activeEnd = overrides ? overrides.endDate : endDate;

        const res = await studioApi.getHistory({
          page: targetPage,
          pageSize: 20,
          ticker: activeTicker?.trim().toUpperCase() || undefined,
          status: activeStatus || undefined,
          startDate: activeStart || undefined,
          endDate: activeEnd || undefined,
        });
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [ticker, status, startDate, endDate]
  );

  useEffect(() => {
    void loadHistory(page);
  }, [page, loadHistory]);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    void loadHistory(1);
  };

  const hasFilters = Boolean(ticker.trim() || status || startDate || endDate);

  const handleResetFilters = () => {
    setTicker("");
    setStatus("");
    setStartDate("");
    setEndDate("");
    setPage(1);
    void loadHistory(1, { ticker: "", status: "", startDate: "", endDate: "" });
  };

  const renderCard = (sig: SignalRecord) => (
    <article key={sig.id} className="p-4 space-y-3 text-sm bg-surface">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/workbench?ticker=${sig.ticker}`)}
            className="min-h-[44px] lg:h-8 lg:min-h-0 px-2.5 rounded-md bg-subtle border border-line hover:border-accent-border hover:text-accent font-display text-base font-extrabold text-ink"
          >
            {sig.ticker}
          </button>
          <div className="text-[13px] text-ink-muted mt-1 truncate">
            {sig.companyName} · <span className="num">{sig.signalDate}</span>
          </div>
        </div>
        <div className="text-right shrink-0 num">
          {sig.profitLossPct !== null ? (
            <div className={`text-[15px] font-bold ${sig.profitLossPct >= 0 ? "text-bull" : "text-bear"}`}>
              {formatPct(sig.profitLossPct)}
            </div>
          ) : (
            <div className="text-ink-muted">-</div>
          )}
          {sig.exitPrice && (
            <div className="text-[13px] text-ink-muted">{formatIdr(sig.exitPrice)}</div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ActionBadge action={sig.action} />
        <SetupBadge setup={sig.setupType} />
        <StatusBadge status={sig.status} />
        <span className="num text-[13px] font-bold px-2.5 py-0.5 rounded-md bg-subtle border border-line text-ink ml-auto">
          Score {Math.round(sig.overallScore)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 num text-[13px] pt-2.5 border-t border-line">
        <div>
          <div className="text-ink-muted">Entry</div>
          <div className="font-semibold text-ink">{formatIdr(sig.entryPrice)}</div>
        </div>
        <div>
          <div className="text-ink-muted">SL / TP2</div>
          <div>
            <span className="text-bear font-medium">{sig.stopLoss}</span> /{" "}
            <span className="text-bull font-medium">{sig.targetPrice}</span>
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink">
            Signal Track Record
          </h1>
          <p className="text-[15px] text-ink-secondary">
            Full audit log of published BUY signals, fill status, and realized net returns.
          </p>
        </div>
        {data && (
          <span className="num text-sm font-medium text-ink-muted">
            {data.pagination.total} recorded signals
          </span>
        )}
      </div>

      {/* 4-Cell Editorial Accountability Strip */}
      {data && (
        <section
          aria-label="Historical signal accountability summary"
          className="desk-sheet grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-line overflow-hidden"
        >
          <div className="p-5">
            <div className="text-[13px] font-medium text-ink-muted">Recorded Signals</div>
            <div className="font-display text-2xl font-extrabold text-ink num mt-1">
              {data.pagination.total}
            </div>
          </div>

          <div className="p-5 space-y-2">
            <div className="text-[13px] font-medium text-ink-muted">Closed Win Rate</div>
            <div className="font-display text-2xl font-extrabold text-bull num">
              {data.stats.winRate !== null ? `${data.stats.winRate.toFixed(1)}%` : "-"}
            </div>
            {data.stats.winRate !== null && (
              <div className="h-2 rounded-full bg-bear-bg border border-line overflow-hidden">
                <div
                  className="h-full bg-bull"
                  style={{ width: `${Math.max(0, Math.min(100, data.stats.winRate))}%` }}
                />
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="text-[13px] font-medium text-ink-muted">Average Realized Return</div>
            <div
              className={`font-display text-2xl font-extrabold num mt-1 ${
                data.stats.avgReturn === null
                  ? "text-ink-muted"
                  : data.stats.avgReturn >= 0
                    ? "text-bull"
                    : "text-bear"
              }`}
            >
              {data.stats.avgReturn !== null ? formatPct(data.stats.avgReturn) : "-"}
            </div>
          </div>

          <div className="p-5">
            <div className="text-[13px] font-medium text-ink-muted">Best / Worst Closed Trade</div>
            <div className="num text-[15px] font-bold mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-bull">
                {data.stats.bestPick
                  ? `${data.stats.bestPick.ticker} ${formatPct(data.stats.bestPick.returnPct)}`
                  : "-"}
              </span>
              <span className="text-ink-muted">/</span>
              <span className="text-bear">
                {data.stats.worstPick
                  ? `${data.stats.worstPick.ticker} ${formatPct(data.stats.worstPick.returnPct)}`
                  : "-"}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Filter Form */}
      <form
        onSubmit={handleFilterSubmit}
        className="desk-sheet p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5 items-end"
      >
        <div className="space-y-1.5">
          <label htmlFor="ledger-ticker-input" className="block text-sm font-medium text-ink-secondary">
            Emiten
          </label>
          <input
            id="ledger-ticker-input"
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="BBCA"
            maxLength={6}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] font-display font-bold uppercase placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:text-ink-muted"
          />
        </div>

        <GlassSelect
          id="ledger-status-select"
          label="Lifecycle Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={setStatus}
        />

        <div className="space-y-1.5">
          <label htmlFor="ledger-start-date" className="block text-sm font-medium text-ink-secondary">
            From Date
          </label>
          <input
            id="ledger-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="ledger-end-date" className="block text-sm font-medium text-ink-secondary">
            To Date
          </label>
          <input
            id="ledger-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
          />
        </div>

        <div className="flex items-center gap-2 lg:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary disabled:opacity-50 text-sm font-semibold"
          >
            Filter Record
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-medium"
            >
              Reset
            </button>
          )}
        </div>
      </form>

      {/* Error State */}
      {error && (
        <div role="alert" className="desk-sheet border-bear-border bg-bear-bg p-5 space-y-3 text-[15px]">
          <div className="font-semibold text-bear">Failed to load track record: {error}</div>
          <button
            type="button"
            onClick={() => void loadHistory(page)}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {/* Results */}
      <div className="desk-sheet overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center text-[15px] text-ink-secondary" role="status" aria-live="polite">
            Loading signal track record...
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-[15px] font-semibold text-ink">
              {hasFilters
                ? "No historical signals match these filters."
                : "No signals have been logged in the track record yet."}
            </p>
            {hasFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-medium"
              >
                Reset Filters
              </button>
            )}
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
                    <th className="px-3 py-3">Action</th>
                    <th className="px-3 py-3">Setup</th>
                    <th className="px-3 py-3 text-right">Entry</th>
                    <th className="px-3 py-3 text-right">SL / TP2</th>
                    <th className="px-3 py-3 text-right">Score</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Exit &amp; Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((sig) => (
                    <tr key={sig.id} className="hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3.5 num text-ink-secondary">{sig.signalDate}</td>
                      <td className="px-3 py-3.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/workbench?ticker=${sig.ticker}`)}
                          className="font-display text-base font-extrabold text-ink hover:text-accent transition-colors text-left"
                        >
                          {sig.ticker}
                        </button>
                        <div className="text-[13px] text-ink-muted truncate max-w-[165px]">
                          {sig.companyName}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        <ActionBadge action={sig.action} />
                      </td>
                      <td className="px-3 py-3.5">
                        <SetupBadge setup={sig.setupType} />
                      </td>
                      <td className="px-3 py-3.5 text-right num font-semibold text-ink">
                        {formatIdr(sig.entryPrice)}
                      </td>
                      <td className="px-3 py-3.5 text-right num text-[13px]">
                        <span className="text-bear">{sig.stopLoss}</span> /{" "}
                        <span className="text-bull">{sig.targetPrice}</span>
                      </td>
                      <td className="px-3 py-3.5 text-right num font-bold text-ink">
                        {Math.round(sig.overallScore)}
                      </td>
                      <td className="px-3 py-3.5">
                        <StatusBadge status={sig.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right num">
                        {sig.profitLossPct !== null ? (
                          <span
                            className={`font-bold ${
                              sig.profitLossPct >= 0 ? "text-bull" : "text-bear"
                            }`}
                          >
                            {formatPct(sig.profitLossPct)}
                          </span>
                        ) : (
                          <span className="text-ink-muted">-</span>
                        )}
                        {sig.exitPrice && (
                          <div className="text-[13px] text-ink-muted">{formatIdr(sig.exitPrice)}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tablet 2-Column Reflow */}
            <div className="hidden sm:grid sm:grid-cols-2 lg:hidden gap-3 p-3 bg-canvas">
              {data.items.map((sig) => (
                <div key={sig.id} className="desk-sheet overflow-hidden">
                  {renderCard(sig)}
                </div>
              ))}
            </div>

            {/* Mobile 1-Column Reflow */}
            <div className="sm:hidden divide-y divide-line">
              {data.items.map(renderCard)}
            </div>
          </>
        )}

        {/* Pagination */}
        {data && data.pagination.totalPages > 1 && (
          <div className="px-4 py-3.5 border-t border-line flex items-center justify-between gap-3 text-sm">
            <span className="text-ink-secondary num font-medium">
              Page {data.pagination.page} of {data.pagination.totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[44px] lg:h-9 lg:min-h-0 px-3.5 term-btn-secondary disabled:opacity-40 text-sm font-semibold"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-[44px] lg:h-9 lg:min-h-0 px-3.5 term-btn-secondary disabled:opacity-40 text-sm font-semibold"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
