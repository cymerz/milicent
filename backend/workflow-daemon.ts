/**
 * Workflow Daemon:
 * - Resumable 6-Stage WIB Trading Pipeline (checkpoints stored in SQLite kv_cache)
 * - SSE Log Broadcaster for Studio Operations Console
 * - WIB Cron Scheduler + 15s Intraday Market Monitor + WebSocket Hub
 */

import type { ServerWebSocket } from "bun";
import type {
  MarketOutlook,
  PipelineLogEvent,
  SignalRecord,
} from "@protocol/contracts.ts";
import {
  clearSkippedSignals,
  completeJobRun,
  failJobRun,
  getActiveSignals,
  getActiveTickers,
  getCache,
  getRecentNewsArticles,
  getStoredSettings,
  getWatchlist,
  hasJobRunToday,
  purgeCacheByPrefix,
  savePriceBars,
  setCache,
  startJobRun,
  upsertFundamental,
  upsertSignal,
  upsertSkippedSignal,
} from "./persistence.ts";
import {
  fetchFundamentals,
  fetchPriceHistory,
  fetchQuotesBatch,
  getMacroContext,
  getWibDateString,
  getWibTimeParts,
  isIdxMarketOpen,
} from "./market-gateway.ts";
import { buildTechnicalSnapshot, runScreener } from "./quant-radar.ts";
import {
  aggregateTickerNews,
  crawlAllPortals,
  extractNewsSentiments,
  type TickerNewsSummary,
} from "./media-pulse.ts";
import { analyzeTickerHybrid, checkLlmConnectivity } from "./thesis-forge.ts";
import {
  notifyNewBuySignals,
  syncActiveSignals,
  telegramPoller,
  type LiveQuoteInput,
} from "./execution-desk.ts";

// ============================================================================
// SSE Log Bus
// ============================================================================

type LogListener = (evt: PipelineLogEvent) => void;
const listeners = new Set<LogListener>();
const recentLogs: PipelineLogEvent[] = [];
let pipelineActive = false;

export function isPipelineRunning(): boolean {
  return pipelineActive;
}

export function getRecentPipelineLogs(): PipelineLogEvent[] {
  return [...recentLogs];
}

export function subscribePipelineLogs(fn: LogListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitPipelineLog(
  level: PipelineLogEvent["level"],
  message: string,
  step?: number,
  totalSteps = 6
): void {
  const evt: PipelineLogEvent = {
    timestamp: new Date().toISOString(),
    level,
    message,
    step,
    totalSteps,
  };
  recentLogs.push(evt);
  if (recentLogs.length > 200) recentLogs.shift();
  for (const fn of listeners) {
    try {
      fn(evt);
    } catch {
      // ignore closed SSE listener
    }
  }
}

// ============================================================================
// 6-Stage Resumable Hybrid Pipeline
// ============================================================================

export interface PipelineRunResult {
  success: boolean;
  runDate: string;
  schedule: "morning" | "evening" | "manual";
  articlesProcessed: number;
  tickersEvaluated: number;
  buySignalsGenerated: number;
  skippedCount: number;
  error?: string;
}

export interface RunPipelineOptions {
  forceRefresh?: boolean;
}

export async function runPipeline(
  schedule: "morning" | "evening" | "manual" = "manual",
  options: RunPipelineOptions = {}
): Promise<PipelineRunResult> {
  if (pipelineActive) {
    return {
      success: false,
      runDate: getWibDateString(),
      schedule,
      articlesProcessed: 0,
      tickersEvaluated: 0,
      buySignalsGenerated: 0,
      skippedCount: 0,
      error: "Pipeline sudah sedang berjalan",
    };
  }

  pipelineActive = true;
  const runDate = getWibDateString();
  const jobId =
    schedule === "morning" || schedule === "evening"
      ? startJobRun(schedule, runDate)
      : null;
  const checkpointKey = `pipeline:ckpt:${runDate}:${schedule}`;
  const forceRefresh = Boolean(options.forceRefresh);
  const settings = getStoredSettings();

  try {
    if (forceRefresh) {
      purgeCacheByPrefix(`${checkpointKey}:`);
    }
    emitPipelineLog(
      "step",
      `Memulai pipeline ${schedule.toUpperCase()}${forceRefresh ? " [FRESH]" : ""} (${runDate})`,
      1
    );

    // Stage 1: Macro Regime
    const macro = await getMacroContext(true);
    emitPipelineLog(
      "info",
      `Macro Regime: ${macro.regime} (${macro.regimeScore}/100) · ${macro.summary}`,
      1
    );

    // Stage 2: Sync Active Tracked Signals
    emitPipelineLog("step", "Sinkronisasi posisi & sinyal aktif terhadap harga live", 2);
    const activeTickers = getActiveTickers();
    if (activeTickers.length > 0) {
      const activeQuotes = await fetchQuotesBatch(activeTickers);
      const quoteInputs = new Map<string, LiveQuoteInput>();
      for (const [ticker, outcome] of activeQuotes.entries()) {
        if (!outcome.success || !outcome.data?.regularMarketPrice) continue;
        quoteInputs.set(ticker, {
          price: outcome.data.regularMarketPrice,
          high: outcome.data.regularMarketDayHigh,
          low: outcome.data.regularMarketDayLow,
          volume: outcome.data.regularMarketVolume,
          changePct: outcome.data.regularMarketChangePercent,
          avgVolume20: outcome.data.averageDailyVolume10Day,
        });
      }
      const syncRes = await syncActiveSignals(quoteInputs, true);
      emitPipelineLog(
        "info",
        `Sync ${syncRes.checkedCount} posisi aktif: ${syncRes.updatedCount} transisi (Entry=${syncRes.entriesFilled.length}, TP1=${syncRes.tp1Hits.length}, TP2=${syncRes.tp2Hits.length}, SL=${syncRes.slHits.length}, Trail=${syncRes.trailingUpdates.length})`,
        2
      );
    }

    // Stage 3: Crawl 14 IDX News Portals & Extract Catalyst Sentiments (kv_cache resumable)
    emitPipelineLog("step", "Mengumpulkan & mengekstrak sentimen berita 14 portal IDX", 3);
    const watchlist = getWatchlist();
    let newsMap = new Map<string, TickerNewsSummary>();
    let totalArticles = 0;

    const cachedNews = forceRefresh
      ? null
      : getCache<{
          totalArticles: number;
          entries: Array<[string, TickerNewsSummary]>;
        }>(`${checkpointKey}:news`);

    if (cachedNews) {
      totalArticles = cachedNews.totalArticles;
      newsMap = new Map(cachedNews.entries);
      emitPipelineLog(
        "info",
        `Resume checkpoint berita: ${totalArticles} artikel, ${newsMap.size} emiten`,
        3
      );
    } else {
      const crawl = await crawlAllPortals((m) => emitPipelineLog("info", m, 3));
      const poolArticles =
        crawl.articles.length > 0
          ? crawl.articles
          : getRecentNewsArticles(3).map((a) => ({
              id: a.id,
              url: a.url,
              title: a.title,
              content: a.content ?? "",
              portal: a.portal,
              publishedAt: a.publishedAt,
            }));

      totalArticles = poolArticles.length;
      const extracted = await extractNewsSentiments(poolArticles, watchlist, (m) =>
        emitPipelineLog("warn", m, 3)
      );
      newsMap = aggregateTickerNews(extracted);
      setCache(
        `${checkpointKey}:news`,
        { totalArticles, entries: Array.from(newsMap.entries()) },
        6 * 60 * 60 * 1000
      );
      emitPipelineLog(
        "info",
        `Ekstraksi berita selesai: ${totalArticles} artikel diproses -> ${newsMap.size} emiten terdeteksi`,
        3
      );
    }

    // Stage 4: Quant Screener + Watchlist + News Catalysts Merge
    emitPipelineLog("step", "Menyaring kandidat dari Screener IDX80/LQ45, Watchlist & Berita", 4);
    const screenerRes = await runScreener({ forceRefresh });
    const candidateTickers = new Set<string>(watchlist);

    for (const [ticker, summary] of newsMap.entries()) {
      if (summary.headlineHits > 0 || summary.score0to100 >= 58) {
        candidateTickers.add(ticker);
      }
    }
    for (const item of screenerRes.items.slice(0, 12)) {
      candidateTickers.add(item.ticker);
    }

    const candidates = Array.from(candidateTickers).slice(0, 20);
    emitPipelineLog(
      "info",
      `${candidates.length} emiten lolos ke tahap evaluasi Hybrid Quant+AI: ${candidates.join(", ")}`,
      4
    );

    // Stage 5: Deep Hybrid Quant + AI Decision + Guardrails
    emitPipelineLog("step", "Menjalankan Hybrid AI + Hard Risk Guardrails pada kandidat", 5);
    const llmStatus = await checkLlmConnectivity();
    if (!llmStatus.ok) {
      emitPipelineLog(
        "warn",
        `LLM offline (${llmStatus.baseUrl}), menjalankan evaluasi cepat via Quant Fallback`,
        5
      );
    } else {
      emitPipelineLog(
        "info",
        `LLM aktif (${llmStatus.model}), mengambil quote live ${candidates.length} kandidat...`,
        5
      );
    }

    const candidateQuotes = await fetchQuotesBatch(candidates);
    const validQuotes = Array.from(candidateQuotes.values()).filter(
      (q) => q.success && (q.data?.regularMarketPrice ?? 0) > 0
    ).length;
    emitPipelineLog(
      "info",
      `${validQuotes}/${candidates.length} quote siap, mengevaluasi ${candidates.length} kandidat...`,
      5
    );

    const activeSignalsByTicker = new Map(getActiveSignals().map((s) => [s.ticker, s]));

    clearSkippedSignals();
    const newBuySignals: SignalRecord[] = [];
    let skippedCount = 0;
    let completedCount = 0;
    let cursor = 0;

    const evaluateCandidate = async (ticker: string): Promise<void> => {
      try {
        const qOutcome = candidateQuotes.get(ticker);
        const q = qOutcome?.success ? qOutcome.data : null;
        const currentPrice = q?.regularMarketPrice ?? 0;
        if (!q || currentPrice <= 0) {
          skippedCount++;
          completedCount++;
          emitPipelineLog(
            "info",
            `[${completedCount}/${candidates.length}] ${ticker}: dilewati (quote tidak tersedia)`,
            5
          );
          return;
        }

        const [histRes, fundOutcome] = await Promise.all([
          fetchPriceHistory(ticker, "6mo"),
          fetchFundamentals(ticker),
        ]);

        if (!histRes.success || !histRes.data || histRes.data.length < 35) {
          skippedCount++;
          completedCount++;
          emitPipelineLog(
            "info",
            `[${completedCount}/${candidates.length}] ${ticker}: dilewati (riwayat harga < 35 bar)`,
            5
          );
          return;
        }
        savePriceBars(ticker, histRes.data);

        const tech = buildTechnicalSnapshot(
          ticker,
          histRes.data,
          currentPrice,
          macro.ihsgReturn20dPct
        );
        const fund = fundOutcome.success ? fundOutcome.data : null;
        if (fund) upsertFundamental(fund);

        const activeSig = activeSignalsByTicker.get(ticker);
        const previousClose = q.regularMarketPreviousClose ?? currentPrice;
        const priceChangePct =
          q.regularMarketChangePercent ??
          (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);

        const analysis = await analyzeTickerHybrid(
          {
            ticker,
            currentPrice,
            previousClose,
            priceChangePct,
            technical: tech,
            fundamental: fund,
            macro,
            news: newsMap.get(ticker) ?? null,
            activeSignalContext: activeSig
              ? {
                  entryPrice: activeSig.entryPrice,
                  stopLoss: activeSig.stopLoss,
                  targetPrice1: activeSig.targetPrice1,
                  targetPrice: activeSig.targetPrice,
                  signalDate: activeSig.signalDate,
                }
              : null,
          },
          {
            thresholds: {
              highScoreRR: settings.recommendation.minRiskRewardHighScore,
              standardScoreRR: settings.recommendation.minRiskRewardStandardScore,
            },
            skipAi: !llmStatus.ok,
            timeoutMs: 25_000,
            maxAttempts: 2,
          }
        );

        const minScore =
          tech.trend === "BEARISH"
            ? settings.recommendation.bearishMinOverallScore
            : settings.recommendation.minOverallScore;

        const qualifies =
          analysis.action === "BUY" &&
          analysis.overallScore >= minScore &&
          analysis.sentimentScore >= settings.recommendation.minSentiment &&
          newBuySignals.length < settings.recommendation.maxRecommendationsPerRun;

        if (qualifies) {
          const stored = upsertSignal({
            ticker: analysis.ticker,
            signalDate: runDate,
            action: analysis.action,
            setupType: analysis.setupType,
            orderType: analysis.orderType,
            entryPrice: analysis.entryPrice,
            stopLoss: analysis.stopLoss,
            targetPrice1: analysis.targetPrice1,
            targetPrice: analysis.targetPrice,
            maxHoldDays: analysis.maxHoldDays,
            sentimentScore: analysis.sentimentScore,
            fundamentalScore: analysis.fundamentalScore,
            technicalScore: analysis.technicalScore,
            overallScore: analysis.overallScore,
            analysisSummary: analysis.analysisSummary,
            newsSummary: analysis.newsSummary,
            fundamentalSummary: analysis.fundamentalSummary,
            technicalSummary: analysis.technicalSummary,
          });
          newBuySignals.push(stored);
          completedCount++;
          emitPipelineLog(
            "success",
            `[${completedCount}/${candidates.length}] BUY ${ticker} (${analysis.setupType}) @ Rp ${analysis.entryPrice} | Score ${analysis.overallScore} | R:R ${analysis.riskRewardRatio}x [${analysis.mode}]`,
            5
          );
        } else {
          skippedCount++;
          const guardrailReason =
            analysis.guardrailReason ??
            (analysis.action !== "BUY"
              ? `Action ${analysis.action}`
              : analysis.overallScore < minScore
                ? `Score ${analysis.overallScore} < threshold ${minScore}`
                : analysis.sentimentScore < settings.recommendation.minSentiment
                  ? `Sentiment ${analysis.sentimentScore} < ${settings.recommendation.minSentiment}`
                  : "Kuota sinyal harian penuh");

          upsertSkippedSignal({
            ticker: analysis.ticker,
            companyName: fund?.companyName ?? q.shortName ?? ticker,
            sector: fund?.sector ?? null,
            currentPrice,
            entryPrice: analysis.entryPrice,
            stopLoss: analysis.stopLoss,
            targetPrice: analysis.targetPrice,
            overallScore: analysis.overallScore,
            guardrailReason,
            summary: analysis.analysisSummary,
          });
          completedCount++;
          emitPipelineLog(
            "info",
            `[${completedCount}/${candidates.length}] ${ticker}: ${analysis.action} (Score ${analysis.overallScore}, ${guardrailReason}) [${analysis.mode}]`,
            5
          );
        }
      } catch (err) {
        skippedCount++;
        completedCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        emitPipelineLog(
          "warn",
          `[${completedCount}/${candidates.length}] ${ticker}: gagal dievaluasi (${errMsg})`,
          5
        );
      }
    };

    const workerCount = Math.min(3, candidates.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (cursor < candidates.length) {
          const idx = cursor++;
          const ticker = candidates[idx];
          if (ticker) {
            await evaluateCandidate(ticker);
          }
        }
      })
    );

    // Stage 6: Market Outlook Synthesis & Telegram Alerts
    emitPipelineLog("step", "Menyusun Market Outlook & mengirim notifikasi Telegram", 6);
    const allHeadlines = Array.from(newsMap.values())
      .flatMap((n) => n.headlines)
      .slice(0, 6)
      .map((h) => ({
        title: h.title,
        sentiment: (h.sentiment >= 0.15
          ? "positive"
          : h.sentiment <= -0.15
            ? "negative"
            : "neutral") as "positive" | "negative" | "neutral",
        source: h.portal,
      }));

    const outlookSentiment: MarketOutlook["sentiment"] =
      macro.regime === "RISK_ON"
        ? "bullish"
        : macro.regime === "RISK_OFF"
          ? "bearish"
          : "neutral";

    const outlook: MarketOutlook = {
      generatedAt: new Date().toISOString(),
      macro,
      sentiment: outlookSentiment,
      summary: `Regime ${macro.regime} (${macro.regimeScore}/100) · ${macro.summary}. Evaluasi ${candidates.length} kandidat menghasilkan ${newBuySignals.length} sinyal BUY terkurasi dan ${skippedCount} emiten dalam watchtower guardrail.`,
      bullishSignals: [
        macro.ihsgTrend === "BULLISH" ? "Tren IHSG berada di fase BULLISH di atas SMA20" : "",
        newBuySignals.length > 0
          ? `${newBuySignals.length} emiten lolos verifikasi R:R & akumulasi institusi`
          : "",
      ].filter(Boolean),
      bearishSignals: [
        macro.ihsgTrend === "BEARISH" ? "Tekanan tren IHSG memerlukan entry selektif di support" : "",
        (macro.usdIdrChange5dPct ?? 0) > 0.8
          ? `Pelemahan Rupiah (+${macro.usdIdrChange5dPct?.toFixed(2)}% 5D) berpotensi menahan inflow asing`
          : "",
      ].filter(Boolean),
      headlines: allHeadlines,
    };
    setCache("outlook:v1", outlook, 24 * 60 * 60 * 1000);

    await notifyNewBuySignals(newBuySignals);
    if (jobId !== null) {
      completeJobRun(jobId, {
        articles: totalArticles,
        tickers: candidates.length,
        signals: newBuySignals.length,
      });
    }
    purgeCacheByPrefix(`${checkpointKey}:`);

    emitPipelineLog(
      "success",
      `Pipeline selesai: ${newBuySignals.length} sinyal BUY, ${skippedCount} watchtower/skip.`,
      6
    );

    return {
      success: true,
      runDate,
      schedule,
      articlesProcessed: totalArticles,
      tickersEvaluated: candidates.length,
      buySignalsGenerated: newBuySignals.length,
      skippedCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jobId !== null) failJobRun(jobId, message);
    emitPipelineLog("error", `Pipeline gagal: ${message}`);
    return {
      success: false,
      runDate,
      schedule,
      articlesProcessed: 0,
      tickersEvaluated: 0,
      buySignalsGenerated: 0,
      skippedCount: 0,
      error: message,
    };
  } finally {
    pipelineActive = false;
  }
}

// ============================================================================
// WIB Scheduler, Live Monitor & WebSocket Broadcast Hub
// ============================================================================

const wsClients = new Set<ServerWebSocket<unknown>>();
let cronTimer: ReturnType<typeof setInterval> | null = null;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let schedulerActive = false;
let lastMonitorAt: string | null = null;

export function registerWsClient(ws: ServerWebSocket<unknown>): void {
  wsClients.add(ws);
}

export function unregisterWsClient(ws: ServerWebSocket<unknown>): void {
  wsClients.delete(ws);
}

export function broadcastWsEvent(type: string, payload: unknown): void {
  if (wsClients.size === 0) return;
  const frame = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of wsClients) {
    try {
      client.send(frame);
    } catch {
      wsClients.delete(client);
    }
  }
}

async function runMarketMonitorTick(): Promise<void> {
  if (!isIdxMarketOpen()) return;
  const tickers = Array.from(new Set([...getActiveTickers(), ...getWatchlist()]));
  if (tickers.length === 0) return;

  try {
    const quotes = await fetchQuotesBatch(tickers);
    const quoteInputs = new Map<string, LiveQuoteInput>();
    const serializedQuotes: Record<string, { price: number; changePct: number }> = {};

    for (const [ticker, outcome] of quotes.entries()) {
      if (!outcome.success || !outcome.data?.regularMarketPrice) continue;
      const q = outcome.data;
      quoteInputs.set(ticker, {
        price: q.regularMarketPrice!,
        high: q.regularMarketDayHigh,
        low: q.regularMarketDayLow,
        volume: q.regularMarketVolume,
        changePct: q.regularMarketChangePercent,
        avgVolume20: q.averageDailyVolume10Day,
      });
      serializedQuotes[ticker] = {
        price: q.regularMarketPrice!,
        changePct: Number((q.regularMarketChangePercent ?? 0).toFixed(2)),
      };
    }

    const syncRes = await syncActiveSignals(quoteInputs, true);
    lastMonitorAt = new Date().toISOString();

    broadcastWsEvent("market_tick", {
      quotes: serializedQuotes,
      updatedCount: syncRes.updatedCount,
      anomalies: syncRes.anomalies,
    });
  } catch (err) {
    console.warn("[Monitor]", err instanceof Error ? err.message : String(err));
  }
}

async function checkCronSchedule(): Promise<void> {
  const settings = getStoredSettings();
  if (!settings.scheduler.enabled) return;

  const { dayOfWeek, hour, minute } = getWibTimeParts();
  if (dayOfWeek === 0 || dayOfWeek === 6) return;

  const isMorningWindow =
    hour === settings.scheduler.morningHour &&
    minute >= settings.scheduler.morningMinute &&
    minute <= settings.scheduler.morningMinute + 4;

  if (isMorningWindow && !hasJobRunToday("morning")) {
    emitPipelineLog("info", "Jadwal analisis pagi WIB terpicu otomatis");
    await runPipeline("morning");
    return;
  }

  const isEveningWindow =
    hour === settings.scheduler.eveningHour &&
    minute >= settings.scheduler.eveningMinute &&
    minute <= settings.scheduler.eveningMinute + 4;

  if (isEveningWindow && !hasJobRunToday("evening")) {
    emitPipelineLog("info", "Jadwal rekap sore WIB terpicu otomatis");
    await runPipeline("evening");
  }
}

export function computeNextScheduledRunIso(): string | null {
  const s = getStoredSettings().scheduler;
  if (!s.enabled) return null;
  const nowWib = getWibTimeParts();
  const currMins = nowWib.hour * 60 + nowWib.minute;
  const morningMins = s.morningHour * 60 + s.morningMinute;
  const eveningMins = s.eveningHour * 60 + s.eveningMinute;

  const hhMm = (h: number, m: number) =>
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} WIB`;

  if (currMins < morningMins) return `Hari ini ${hhMm(s.morningHour, s.morningMinute)}`;
  if (currMins < eveningMins) return `Hari ini ${hhMm(s.eveningHour, s.eveningMinute)}`;
  return `Besok ${hhMm(s.morningHour, s.morningMinute)}`;
}

export function startScheduler(): void {
  if (schedulerActive) return;
  schedulerActive = true;
  telegramPoller.start();

  cronTimer = setInterval(() => {
    void checkCronSchedule();
  }, 60_000);

  monitorTimer = setInterval(() => {
    void runMarketMonitorTick();
  }, 15_000);
}

export function stopScheduler(): void {
  schedulerActive = false;
  if (cronTimer) clearInterval(cronTimer);
  if (monitorTimer) clearInterval(monitorTimer);
  cronTimer = null;
  monitorTimer = null;
  telegramPoller.stop();
}

export function getSchedulerStatus(): {
  running: boolean;
  marketOpen: boolean;
  wsClients: number;
  lastMonitorAt: string | null;
} {
  return {
    running: schedulerActive,
    marketOpen: isIdxMarketOpen(),
    wsClients: wsClients.size,
    lastMonitorAt,
  };
}
