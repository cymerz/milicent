/**
 * Engine Admin Screen (/admin and /operations):
 * Strictly gated behind Admin Sign In (POST /api/admin/verify).
 * Scheduler controls, pipeline trigger, signal parameters, priority watchlist,
 * and pausable live SSE pipeline event stream (monospace reserved strictly for logs).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, PipelineLogEvent } from "@protocol/contracts.ts";
import {
  clearAdminSession,
  getStoredAdminPassword,
  setAdminUnlocked,
  setStoredAdminPassword,
  studioApi,
  useAdminSession,
  usePipelineLogsStream,
} from "@frontend/sdk.ts";

export function OperationsScreen() {
  const unlocked = useAdminSession();

  // Sign-In Form State
  const [passwordInput, setPasswordInput] = useState(getStoredAdminPassword);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Admin Console State
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [newWatchTicker, setNewWatchTicker] = useState("");
  const [streamPaused, setStreamPaused] = useState(false);
  const [pausedSnapshot, setPausedSnapshot] = useState<PipelineLogEvent[]>([]);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  const [minScore, setMinScore] = useState(65);
  const [bearishMinScore, setBearishMinScore] = useState(72);
  const [minSentiment, setMinSentiment] = useState(45);
  const [rrHigh, setRrHigh] = useState(1.5);
  const [rrStandard, setRrStandard] = useState(2.0);
  const [maxRecs, setMaxRecs] = useState(5);
  const [morningHour, setMorningHour] = useState(8);
  const [morningMinute, setMorningMinute] = useState(15);
  const [eveningHour, setEveningHour] = useState(18);
  const [eveningMinute, setEveningMinute] = useState(15);
  const [anomPct, setAnomPct] = useState(5);
  const [anomVol, setAnomVol] = useState(3);

  const liveLogs = usePipelineLogsStream(unlocked && !streamPaused);
  const visibleLogs = streamPaused ? pausedSnapshot : liveLogs;

  useEffect(() => {
    if (streamPaused) return;
    const el = logsContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleLogs.length, streamPaused]);

  const toggleLogStream = () => {
    setStreamPaused((prev) => {
      if (!prev) {
        setPausedSnapshot(liveLogs);
      }
      return !prev;
    });
  };

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await studioApi.getSettings();
      setSettings(s);
      setMinScore(s.recommendation.minOverallScore);
      setBearishMinScore(s.recommendation.bearishMinOverallScore);
      setMinSentiment(s.recommendation.minSentiment);
      setRrHigh(s.recommendation.minRiskRewardHighScore);
      setRrStandard(s.recommendation.minRiskRewardStandardScore);
      setMaxRecs(s.recommendation.maxRecommendationsPerRun);
      setMorningHour(s.scheduler.morningHour);
      setMorningMinute(s.scheduler.morningMinute);
      setEveningHour(s.scheduler.eveningHour);
      setEveningMinute(s.scheduler.eveningMinute);
      setAnomPct(s.anomaly.priceChangePct);
      setAnomVol(s.anomaly.volumeMultiplier);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setLoadError(text);
      setMsg({ type: "err", text });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (unlocked) {
      void loadSettings();
    }
  }, [unlocked, loadSettings]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setStoredAdminPassword(passwordInput);
    try {
      await studioApi.verifyAdmin();
      setAdminUnlocked(true);
    } catch (err) {
      clearAdminSession();
      setAuthError(err instanceof Error ? err.message : "Invalid admin password");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    clearAdminSession();
    setPasswordInput("");
    setSettings(null);
    setMsg(null);
  };

  // Guest Gate View
  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto mt-8 sm:mt-14 desk-sheet p-6 space-y-4">
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-extrabold text-ink">Admin Sign In</h1>
          <p className="text-[15px] text-ink-secondary">
            Enter your admin password to unlock pipeline schedules, risk guardrails, and priority watchlist editing.
          </p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="admin-login-pw" className="block text-sm font-medium text-ink-secondary">
              Admin Password
            </label>
            <input
              id="admin-login-pw"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter admin password..."
              autoComplete="current-password"
              className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] placeholder:text-ink-muted"
            />
          </div>

          {authError && (
            <div role="alert" className="p-3 rounded-md border border-bear-border bg-bear-bg text-sm font-semibold text-bear">
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={authLoading}
            className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary disabled:opacity-50 text-sm font-semibold"
          >
            {authLoading ? "Verifying..." : "Unlock Console"}
          </button>
        </form>
      </div>
    );
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await studioApi.patchSettings({
        scheduler: { morningHour, morningMinute, eveningHour, eveningMinute },
        recommendation: {
          minOverallScore: minScore,
          bearishMinOverallScore: bearishMinScore,
          minSentiment,
          minRiskRewardHighScore: rrHigh,
          minRiskRewardStandardScore: rrStandard,
          maxRecommendationsPerRun: maxRecs,
        },
        anomaly: { priceChangePct: anomPct, volumeMultiplier: anomVol },
      });
      setMsg({ type: "ok", text: "Settings saved." });
      await loadSettings();
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handlePipeline = async (forceRefresh = false) => {
    setMsg(null);
    try {
      await studioApi.triggerPipeline("manual", { forceRefresh });
      setMsg({
        type: "ok",
        text: forceRefresh
          ? "Fresh pipeline started (news checkpoint & screener cache bypassed). Monitor progress in the stream below."
          : "Scan pipeline started. Monitor progress in the stream below.",
      });
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSchedulerToggle = async () => {
    if (!settings) return;
    setMsg(null);
    try {
      const action = settings.runtime.schedulerRunning ? "stop" : "start";
      await studioApi.toggleScheduler(action);
      await loadSettings();
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleAddWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWatchTicker.trim()) return;
    setMsg(null);
    try {
      await studioApi.addWatchlist(newWatchTicker.trim());
      setNewWatchTicker("");
      await loadSettings();
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRemoveWatchlist = async (ticker: string) => {
    setMsg(null);
    try {
      await studioApi.removeWatchlist(ticker);
      await loadSettings();
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  if (loading && !settings) {
    return (
      <div className="desk-sheet p-5 space-y-1.5 text-[15px] text-ink-secondary" role="status" aria-live="polite">
        <h1 className="font-display text-2xl font-extrabold text-ink">Engine Admin</h1>
        <p>Loading Engine Admin Console...</p>
      </div>
    );
  }

  if (loadError && !settings) {
    return (
      <div className="desk-sheet border-bear-border bg-bear-bg p-5 space-y-3 text-[15px]" role="alert">
        <h1 className="font-display text-2xl font-extrabold text-ink">Engine Admin</h1>
        <div className="font-semibold text-bear">Failed to load admin settings: {loadError}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSettings()}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-medium"
          >
            Lock Session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink">Engine Admin</h1>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void handleSchedulerToggle()}
            className={`min-h-[44px] lg:h-10 lg:min-h-0 px-4 rounded-md border text-sm font-semibold transition-colors ${
              settings?.runtime.schedulerRunning
                ? "bg-bear-bg text-bear border-bear-border hover:opacity-90"
                : "bg-bull-bg text-bull border-bull-border hover:opacity-90"
            }`}
          >
            {settings?.runtime.schedulerRunning ? "Stop Scheduler" : "Start Scheduler"}
          </button>

          <button
            type="button"
            onClick={() => void handlePipeline(false)}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold"
          >
            Run Scan Pipeline
          </button>

          <button
            type="button"
            onClick={() => void handlePipeline(true)}
            title="Bypass news checkpoint and screener cache"
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-semibold"
          >
            Fresh Run
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-secondary text-sm font-medium"
          >
            Lock Session
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {msg && (
        <div
          role={msg.type === "err" ? "alert" : "status"}
          className={`desk-sheet p-4 flex flex-wrap items-center justify-between gap-3 text-[15px] ${
            msg.type === "ok"
              ? "border-bull-border bg-bull-bg text-bull"
              : "border-bear-border bg-bear-bg text-bear"
          }`}
        >
          <span className="font-semibold">{msg.text}</span>
          <button
            type="button"
            onClick={() => setMsg(null)}
            className="min-h-[44px] lg:h-8 lg:min-h-0 px-3 term-btn-secondary text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Runtime Health Ribbon */}
      {settings && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[15px]">
          <div className="desk-sheet p-5 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Engine Status
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`px-2.5 py-0.5 rounded-md border text-[13px] font-semibold ${
                  settings.models.configured
                    ? "bg-bull-bg text-bull border-bull-border"
                    : "bg-warn-bg text-warn border-warn-border"
                }`}
              >
                {settings.models.configured ? "LLM + Quant Online" : "Quantitative Fallback"}
              </span>
              <span className="font-semibold text-ink">{settings.models.decisionModel}</span>
            </div>
            <div className="text-[13px] text-ink-muted truncate">{settings.models.baseUrl}</div>
          </div>

          <div className="desk-sheet p-5 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Schedule &amp; Notifications
            </div>
            <div className="font-semibold text-ink">
              {settings.runtime.schedulerRunning ? "Scheduler Active" : "Scheduler Stopped"} ·{" "}
              {settings.runtime.telegramConfigured ? "Telegram Connected" : "Telegram Disabled"}
            </div>
            <div className="num text-[13px] text-ink-muted">
              Next Run: {settings.scheduler.nextRun ?? "Disabled"}
            </div>
          </div>
        </div>
      )}

      {/* 8:4 Settings & Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <form onSubmit={handleSaveSettings} className="lg:col-span-8 desk-sheet p-5 space-y-4">
          <h2 className="font-display text-lg font-bold text-ink">Signal &amp; Schedule Settings</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="cfg-min-score" className="block text-sm font-medium text-ink-secondary">
                Min Score (Bull/Sideways)
              </label>
              <input
                id="cfg-min-score"
                type="number"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-bear-score" className="block text-sm font-medium text-ink-secondary">
                Min Score (Bearish)
              </label>
              <input
                id="cfg-bear-score"
                type="number"
                value={bearishMinScore}
                onChange={(e) => setBearishMinScore(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-min-sent" className="block text-sm font-medium text-ink-secondary">
                Min Sentiment (0-100)
              </label>
              <input
                id="cfg-min-sent"
                type="number"
                value={minSentiment}
                onChange={(e) => setMinSentiment(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-rr-high" className="block text-sm font-medium text-ink-secondary">
                Min R:R (Score &gt;= 75)
              </label>
              <input
                id="cfg-rr-high"
                type="number"
                step={0.1}
                value={rrHigh}
                onChange={(e) => setRrHigh(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-rr-std" className="block text-sm font-medium text-ink-secondary">
                Min R:R (Standard)
              </label>
              <input
                id="cfg-rr-std"
                type="number"
                step={0.1}
                value={rrStandard}
                onChange={(e) => setRrStandard(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-max-recs" className="block text-sm font-medium text-ink-secondary">
                Max Signals / Run
              </label>
              <input
                id="cfg-max-recs"
                type="number"
                value={maxRecs}
                onChange={(e) => setMaxRecs(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] num"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-line grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
            <div className="space-y-1.5">
              <label htmlFor="cfg-morn-hr" className="block text-sm font-medium text-ink-secondary">
                Morning Hr (WIB)
              </label>
              <input
                id="cfg-morn-hr"
                type="number"
                min={0}
                max={23}
                value={morningHour}
                onChange={(e) => setMorningHour(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-morn-min" className="block text-sm font-medium text-ink-secondary">
                Morning Min
              </label>
              <input
                id="cfg-morn-min"
                type="number"
                min={0}
                max={59}
                value={morningMinute}
                onChange={(e) => setMorningMinute(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-eve-hr" className="block text-sm font-medium text-ink-secondary">
                Evening Hr (WIB)
              </label>
              <input
                id="cfg-eve-hr"
                type="number"
                min={0}
                max={23}
                value={eveningHour}
                onChange={(e) => setEveningHour(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-eve-min" className="block text-sm font-medium text-ink-secondary">
                Evening Min
              </label>
              <input
                id="cfg-eve-min"
                type="number"
                min={0}
                max={59}
                value={eveningMinute}
                onChange={(e) => setEveningMinute(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-anom-pct" className="block text-sm font-medium text-ink-secondary">
                Price Alert %
              </label>
              <input
                id="cfg-anom-pct"
                type="number"
                step={0.5}
                value={anomPct}
                onChange={(e) => setAnomPct(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cfg-anom-vol" className="block text-sm font-medium text-ink-secondary">
                Volume Spike (x)
              </label>
              <input
                id="cfg-anom-vol"
                type="number"
                step={0.5}
                value={anomVol}
                onChange={(e) => setAnomVol(Number(e.target.value))}
                className="w-full min-h-[44px] lg:h-10 lg:min-h-0 px-2.5 term-input text-[15px] num"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] lg:h-10 lg:min-h-0 px-5 term-btn-primary disabled:opacity-50 text-sm font-semibold"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </form>

        {/* Priority Watchlist Editor */}
        <div className="lg:col-span-4 desk-sheet p-5 space-y-4">
          <h2 className="font-display text-lg font-bold text-ink">
            Priority Watchlist ({settings?.watchlist.length ?? 0})
          </h2>

          <form onSubmit={handleAddWatchlist} className="space-y-1.5">
            <label htmlFor="watchlist-add-input" className="block text-sm font-medium text-ink-secondary">
              Add 4-letter IDX emiten
            </label>
            <div className="flex items-center gap-2">
              <input
                id="watchlist-add-input"
                type="text"
                value={newWatchTicker}
                onChange={(e) => setNewWatchTicker(e.target.value.toUpperCase())}
                placeholder="BREN"
                maxLength={8}
                className="flex-1 min-w-0 min-h-[44px] lg:h-10 lg:min-h-0 px-3 term-input text-[15px] font-display font-bold uppercase placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:text-ink-muted"
              />
              <button
                type="submit"
                className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary text-sm font-semibold shrink-0"
              >
                Add
              </button>
            </div>
          </form>

          <div className="flex flex-wrap gap-2 pt-1">
            {settings?.watchlist.length === 0 ? (
              <span className="text-[15px] text-ink-muted">No watchlist tickers configured.</span>
            ) : (
              settings?.watchlist.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-md term-well pl-3 pr-1 text-ink font-display text-sm font-bold"
                >
                  <span>{t}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveWatchlist(t)}
                    aria-label={`Remove ${t} from watchlist`}
                    className="min-h-[44px] min-w-[44px] lg:h-8 lg:w-8 lg:min-h-0 lg:min-w-0 inline-flex items-center justify-center rounded text-ink-muted hover:text-bear transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Live SSE Pipeline Logs (monospace strictly here) */}
      <section className="rounded-lg border border-tape-border bg-tape text-tape-ink overflow-hidden">
        <div className="px-5 py-3 border-b border-tape-border flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-3">
            <h2 className="font-display font-bold text-tape-ink">Pipeline Event Stream</h2>
            <span className="num text-tape-muted">{visibleLogs.length} events</span>
          </div>
          <button
            type="button"
            aria-pressed={streamPaused}
            onClick={toggleLogStream}
            className="min-h-[44px] lg:h-8 lg:min-h-0 px-3 rounded-md border border-[#5F6C80] bg-[#181C23] text-[#F8FAFC] hover:bg-[#222834] text-[13px] font-semibold"
          >
            {streamPaused ? "Resume Stream" : "Pause Stream"}
          </button>
        </div>
        <div ref={logsContainerRef} className="p-4 h-60 overflow-y-auto font-mono text-[13px] space-y-1.5">
          {visibleLogs.length === 0 ? (
            <div className="text-tape-muted">
              Waiting for pipeline log stream. Click Run Scan Pipeline to start an analysis run.
            </div>
          ) : (
            visibleLogs.map((l, idx) => {
              const color =
                l.level === "error"
                  ? "text-[#FF7585]"
                  : l.level === "warn"
                    ? "text-[#FCD34D]"
                    : l.level === "success"
                      ? "text-[#2EE8A5]"
                      : l.level === "step"
                        ? "text-[#38BDF8] font-semibold"
                        : "text-[#D5DDE8]";
              return (
                <div key={idx} className="leading-relaxed">
                  <span className="text-tape-muted mr-2">{l.timestamp.slice(11, 19)}</span>
                  {l.step !== undefined && (
                    <span className="text-[#D5DDE8] mr-2">
                      [Step {l.step}/{l.totalSteps ?? 6}]
                    </span>
                  )}
                  <span className={color}>{l.message}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
