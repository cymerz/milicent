/**
 * Milicent HTTP, SSE & WebSocket Server Gateway
 * Exports `routeRequest` cleanly for tests and launches Bun.serve when executed directly.
 */

import crypto from "crypto";
import path from "path";
import { z } from "zod";
import {
  getIdxAutoRejectionLimits,
  isValidIdxEquityTicker,
  normalizeTicker,
} from "@protocol/idx-rules.ts";
import type {
  AppSettings,
  BacktestRequest,
  DashboardPayload,
  HistoryPayload,
  MarketOutlook,
  PipelineLogEvent,
  ScreenerPayload,
  TickerAnalysisPayload,
} from "@protocol/contracts.ts";
import {
  addWatchlistTicker,
  getActiveSignals,
  getActiveTickers,
  getCache,
  getDb,
  getSignalHistory,
  getSignalsByDate,
  getSkippedSignals,
  getStoredSettings,
  getWatchlist,
  patchStoredSettings,
  purgeCacheByPrefix,
  removeWatchlistTicker,
  savePriceBars,
  setCache,
  upsertFundamental,
  computeSignalStats,
} from "./persistence.ts";
import {
  fetchFundamentals,
  fetchPriceHistory,
  fetchQuote,
  fetchQuotesBatch,
  getMacroContext,
  getWibDateString,
  loadFallbackEnv,
} from "./market-gateway.ts";
import { buildTechnicalSnapshot, runScreener } from "./quant-radar.ts";
import { collectLocalNewsForTicker } from "./media-pulse.ts";
import {
  analyzeTickerHybrid,
  checkLlmConnectivity,
  getLlmBaseUrl,
  resolveModelForRole,
} from "./thesis-forge.ts";
import { runBacktestSimulation } from "./execution-desk.ts";
import {
  computeNextScheduledRunIso,
  getRecentPipelineLogs,
  getSchedulerStatus,
  isPipelineRunning,
  registerWsClient,
  runPipeline,
  startScheduler,
  stopScheduler,
  subscribePipelineLogs,
  unregisterWsClient,
} from "./workflow-daemon.ts";

const BASE_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Password",
  Vary: "Origin",
};

function getAllowedCorsOrigins(requestUrl?: URL): Set<string> {
  const configured = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
  if (configured.trim()) {
    const set = new Set(
      configured
        .split(",")
        .map((s) => s.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    );
    if (requestUrl) set.add(requestUrl.origin);
    return set;
  }

  const port = Number(process.env.PORT) || 3001;
  const set = new Set<string>([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  if (requestUrl) set.add(requestUrl.origin);
  return set;
}

function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("Origin")?.trim();
  if (!origin) return BASE_CORS_HEADERS;

  let reqUrl: URL | undefined;
  try {
    reqUrl = new URL(req!.url);
  } catch {
    // ignore malformed URL
  }

  const allowed = getAllowedCorsOrigins(reqUrl);
  if (allowed.has(origin.replace(/\/+$/, ""))) {
    return {
      ...BASE_CORS_HEADERS,
      "Access-Control-Allow-Origin": origin,
    };
  }
  return BASE_CORS_HEADERS;
}

function applyCorsHeaders(res: Response, req: Request): Response {
  const cors = getCorsHeaders(req);
  for (const [k, v] of Object.entries(cors)) {
    res.headers.set(k, v);
  }
  return res;
}

const PUBLIC_DIR = path.resolve(process.cwd(), "dist/client");
const ANALYZE_CACHE_PREFIX = "analyze:v2:";
const ANALYZE_CACHE_TTL_MS = 20 * 60 * 1000;

export function resolveStaticAssetPath(
  pathname: string,
  publicDir: string = PUBLIC_DIR
): string | null {
  if (pathname.includes("\0")) return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0")) return null;

  const relInput = decodedPath === "/" ? "index.html" : decodedPath.replace(/^[/\\]+/, "");
  const resolvedRoot = path.resolve(publicDir);
  const candidatePath = path.resolve(resolvedRoot, relInput);
  const relFromPublic = path.relative(resolvedRoot, candidatePath);
  if (!relFromPublic || relFromPublic.startsWith("..") || path.isAbsolute(relFromPublic)) {
    return null;
  }
  return candidatePath;
}

function jsonOk<T>(data: T, status = 200): Response {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      error: null,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: { "Content-Type": "application/json", ...BASE_CORS_HEADERS },
    }
  );
}

function jsonErr(error: string, status = 400): Response {
  return new Response(
    JSON.stringify({
      success: false,
      data: null,
      error,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: { "Content-Type": "application/json", ...BASE_CORS_HEADERS },
    }
  );
}

function sha256(val: string): Buffer {
  return crypto.createHash("sha256").update(val).digest();
}

function isAdminAuthConfigured(): boolean {
  const pw = process.env.ADMIN_PASSWORD?.trim();
  return Boolean(pw && pw.length > 0 && pw !== "change_me");
}

function isInsecureLocalAllowed(): boolean {
  return process.env.ALLOW_INSECURE_LOCAL?.trim() === "true";
}

function extractSuppliedAdminPassword(req: Request): string {
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const headerPw = req.headers.get("X-Admin-Password")?.trim() ?? "";
  return bearer || headerPw;
}

const MAX_ADMIN_AUTH_FAILURES = 5;
const ADMIN_AUTH_LOCKOUT_MS = 5 * 60_000;

function hasValidAdminHeader(req: Request): boolean {
  if (!isAdminAuthConfigured()) {
    return isInsecureLocalAllowed();
  }
  const ip = getClientKey(req);
  if (isRateLimited(`admin-fail:${ip}`, MAX_ADMIN_AUTH_FAILURES, ADMIN_AUTH_LOCKOUT_MS)) {
    return false;
  }
  const supplied = extractSuppliedAdminPassword(req);
  if (!supplied) return false;
  const expected = process.env.ADMIN_PASSWORD!.trim();
  return crypto.timingSafeEqual(sha256(supplied), sha256(expected));
}

function requireAdminAuth(req: Request): Response | null {
  if (!isAdminAuthConfigured()) {
    if (isInsecureLocalAllowed()) return null;
    return jsonErr(
      "ADMIN_PASSWORD belum dikonfigurasi (atau masih bernilai 'change_me'). Set ADMIN_PASSWORD di .env untuk membuka akses admin.",
      503
    );
  }
  const ip = getClientKey(req);
  const failBucket = `admin-fail:${ip}`;
  if (isRateLimited(failBucket, MAX_ADMIN_AUTH_FAILURES, ADMIN_AUTH_LOCKOUT_MS)) {
    return jsonErr("Terlalu banyak percobaan password admin gagal. Tunggu 5 menit.", 429);
  }
  const supplied = extractSuppliedAdminPassword(req);
  if (!supplied) return jsonErr("Admin authentication required", 401);
  const expected = process.env.ADMIN_PASSWORD!.trim();
  if (!crypto.timingSafeEqual(sha256(supplied), sha256(expected))) {
    recordRateHit(failBucket, ADMIN_AUTH_LOCKOUT_MS);
    return jsonErr("Password admin tidak sesuai", 401);
  }
  clearRateBucket(failBucket);
  return null;
}

// ============================================================================
// In-Memory Rate Limiter & Refresh Cooldown Guard
// ============================================================================

const rateBuckets = new Map<string, number[]>();
const cooldownStamps = new Map<string, number>();
const MAX_SSE_CLIENTS = 5;
let activeSseClients = 0;

export function resetRateLimitersForTests(): void {
  rateBuckets.clear();
  cooldownStamps.clear();
}

function getClientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "local";
}

function isRateLimited(bucketKey: string, maxHits: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = rateBuckets.get(bucketKey);
  if (!prev || prev.length === 0) return false;
  const active = prev.filter((t) => now - t < windowMs);
  if (active.length !== prev.length) {
    if (active.length === 0) rateBuckets.delete(bucketKey);
    else rateBuckets.set(bucketKey, active);
  }
  return active.length >= maxHits;
}

function recordRateHit(bucketKey: string, windowMs: number): number {
  const now = Date.now();
  if (rateBuckets.size > 500) {
    for (const [k, stamps] of rateBuckets.entries()) {
      if (stamps.every((t) => now - t > windowMs)) rateBuckets.delete(k);
    }
  }
  const prev = rateBuckets.get(bucketKey) ?? [];
  const active = prev.filter((t) => now - t < windowMs);
  active.push(now);
  rateBuckets.set(bucketKey, active);
  return active.length;
}

function clearRateBucket(bucketKey: string): void {
  rateBuckets.delete(bucketKey);
}

function checkRateLimit(bucketKey: string, maxHits: number, windowMs: number): boolean {
  if (isRateLimited(bucketKey, maxHits, windowMs)) return false;
  recordRateHit(bucketKey, windowMs);
  return true;
}

function checkCooldown(cooldownKey: string, cooldownMs: number): boolean {
  const now = Date.now();
  if (cooldownStamps.size > 500) {
    for (const [k, ts] of cooldownStamps.entries()) {
      if (now - ts > 10 * 60_000) cooldownStamps.delete(k);
    }
  }
  const last = cooldownStamps.get(cooldownKey) ?? 0;
  if (now - last < cooldownMs) return false;
  cooldownStamps.set(cooldownKey, now);
  return true;
}

async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleDashboard(): Promise<Response> {
  const today = getWibDateString();
  const [macro, activeQuotes] = await Promise.all([
    getMacroContext(false),
    fetchQuotesBatch(getActiveTickers()).catch(() => new Map()),
  ]);

  const livePrices = new Map<string, number>();
  for (const [ticker, outcome] of activeQuotes.entries()) {
    if (outcome.success && outcome.data?.regularMarketPrice) {
      livePrices.set(ticker, outcome.data.regularMarketPrice);
    }
  }

  const todaySignals = getSignalsByDate(today);
  const activePositions = getActiveSignals(livePrices);
  const skippedSignals = getSkippedSignals();
  const stats = computeSignalStats();
  const watchlist = getWatchlist();
  const scheduler = getSchedulerStatus();

  const outlook: MarketOutlook = getCache<MarketOutlook>("outlook:v1") ?? {
    summary: `Regime ${macro.regime} (${macro.regimeScore}/100) · ${macro.summary}`,
    sentiment:
      macro.regime === "RISK_ON"
        ? "bullish"
        : macro.regime === "RISK_OFF"
          ? "bearish"
          : "neutral",
    bullishSignals: macro.ihsgTrend === "BULLISH" ? ["IHSG tren jangka pendek positif"] : [],
    bearishSignals: macro.ihsgTrend === "BEARISH" ? ["IHSG tren melemah, jaga batas risiko"] : [],
    headlines: [],
    macro,
    generatedAt: new Date().toISOString(),
  };

  const payload: DashboardPayload = {
    date: today,
    todaySignals,
    activePositions,
    skippedSignals,
    stats,
    outlook,
    watchlist,
    scheduler: {
      running: scheduler.running,
      marketOpen: scheduler.marketOpen,
      pipelineRunning: isPipelineRunning(),
    },
  };
  return jsonOk(payload);
}

async function handleHistory(url: URL): Promise<Response> {
  const pageRaw = Number(url.searchParams.get("page") || "1");
  const sizeRaw = Number(url.searchParams.get("pageSize") || "25");
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(sizeRaw) ? Math.max(5, Math.min(100, Math.floor(sizeRaw))) : 25;

  const ticker = url.searchParams.get("ticker") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const startDate = url.searchParams.get("startDate") || undefined;
  const endDate = url.searchParams.get("endDate") || undefined;

  const res = getSignalHistory({ page, pageSize, ticker, status, startDate, endDate });
  const payload: HistoryPayload = {
    items: res.items,
    pagination: {
      page,
      pageSize,
      total: res.total,
      totalPages: Math.max(1, Math.ceil(res.total / pageSize)),
    },
    stats: res.stats,
  };
  return jsonOk(payload);
}

async function handleOutlook(): Promise<Response> {
  const cached = getCache<MarketOutlook>("outlook:v1");
  if (cached) return jsonOk(cached);
  const macro = await getMacroContext(false);
  const outlook: MarketOutlook = {
    summary: `Regime ${macro.regime} · ${macro.summary}`,
    sentiment: macro.regime === "RISK_ON" ? "bullish" : macro.regime === "RISK_OFF" ? "bearish" : "neutral",
    bullishSignals: [],
    bearishSignals: [],
    headlines: [],
    macro,
    generatedAt: new Date().toISOString(),
  };
  return jsonOk(outlook);
}

async function handleScreener(req: Request, url: URL): Promise<Response> {
  const forceRefresh = url.searchParams.get("refresh") === "1";
  if (forceRefresh && !hasValidAdminHeader(req)) {
    const ip = getClientKey(req);
    if (!checkRateLimit(`screener:${ip}`, 4, 60_000) || !checkCooldown("screener:refresh", 45_000)) {
      return jsonErr("Refresh screener terlalu sering. Coba lagi dalam beberapa detik.", 429);
    }
  }
  const setupFilter = url.searchParams.get("setup")?.toUpperCase() || "ALL";
  const sectorFilter = url.searchParams.get("sector") || "ALL";
  const trendFilter = url.searchParams.get("trend")?.toUpperCase() || "ALL";
  const minScoreRaw = Number(url.searchParams.get("minScore") || "0");
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0;

  const payload: ScreenerPayload = await runScreener({
    forceRefresh,
    setupFilter,
    sectorFilter,
    trendFilter,
    minScore,
    limit: 80,
  });
  return jsonOk(payload);
}

async function handleAnalyze(req: Request): Promise<Response> {
  const body = await readJsonBody<{
    ticker?: string;
    force?: boolean;
    skipAi?: boolean;
    model?: string;
  }>(req);

  const ticker = normalizeTicker(body.ticker ?? "");
  if (!isValidIdxEquityTicker(ticker)) {
    return jsonErr("Kode emiten IDX tidak valid (wajib 4 huruf, contoh: BBCA, BBRI, ADRO)", 400);
  }

  let resolvedModelOverride: string | undefined;
  if (body.model && body.model.trim()) {
    const candidateModel = body.model.trim();
    const allowedModels = new Set([
      resolveModelForRole("default"),
      resolveModelForRole("filter"),
      resolveModelForRole("decision"),
    ]);
    if (!allowedModels.has(candidateModel)) {
      const denied = requireAdminAuth(req);
      if (denied) {
        return jsonErr("Admin authentication required for custom model override", 403);
      }
      if (!/^[a-zA-Z0-9._:/-]{1,80}$/.test(candidateModel)) {
        return jsonErr("Format nama model tidak valid", 400);
      }
    }
    resolvedModelOverride = candidateModel;
  }

  const isAdmin = hasValidAdminHeader(req);
  const cacheKey = `${ANALYZE_CACHE_PREFIX}${ticker}${body.skipAi ? ":quant" : ""}`;
  if (!body.force) {
    const cached = getCache<TickerAnalysisPayload>(cacheKey);
    if (cached) {
      return jsonOk({ ...cached, cached: true });
    }
  } else if (!isAdmin && !checkCooldown(`analyze:force:${ticker}`, 30_000)) {
    return jsonErr(`Refresh analisis ${ticker} terlalu cepat. Tunggu 30 detik sebelum refresh ulang.`, 429);
  }

  if (!isAdmin) {
    const ip = getClientKey(req);
    if (!checkRateLimit(`analyze:${ip}`, 12, 60_000)) {
      return jsonErr("Batas request analisis live tercapai (maks 12/menit). Silakan tunggu sebentar.", 429);
    }
  }

  const [quoteOutcome, histOutcome, macro, fundOutcome] = await Promise.all([
    fetchQuote(ticker),
    fetchPriceHistory(ticker, "6mo"),
    getMacroContext(false),
    fetchFundamentals(ticker),
  ]);

  if (!quoteOutcome.success || !quoteOutcome.data?.regularMarketPrice) {
    return jsonErr(`Harga live untuk ${ticker}.JK tidak ditemukan (${quoteOutcome.error ?? "no data"})`, 404);
  }
  if (!histOutcome.success || !histOutcome.data || histOutcome.data.length < 25) {
    return jsonErr(`Riwayat harga ${ticker} belum memadai untuk analisis teknikal`, 422);
  }

  const q = quoteOutcome.data;
  const currentPrice = q.regularMarketPrice!;
  const previousClose = q.regularMarketPreviousClose ?? currentPrice;
  const priceChange = q.regularMarketChange ?? currentPrice - previousClose;
  const priceChangePct =
    q.regularMarketChangePercent ??
    (previousClose > 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);

  savePriceBars(ticker, histOutcome.data);
  const fundamental = fundOutcome.success ? fundOutcome.data : null;
  if (fundamental) upsertFundamental(fundamental);

  const technical = buildTechnicalSnapshot(
    ticker,
    histOutcome.data,
    currentPrice,
    macro.ihsgReturn20dPct
  );
  const newsSummary = collectLocalNewsForTicker(ticker, 5);
  const activeSig = getActiveSignals().find((s) => s.ticker === ticker);
  const settings = getStoredSettings();

  const result = await analyzeTickerHybrid(
    {
      ticker,
      currentPrice,
      previousClose,
      priceChangePct,
      technical,
      fundamental,
      macro,
      news: newsSummary,
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
      skipAi: Boolean(body.skipAi),
      modelOverride: resolvedModelOverride,
    }
  );

  const payload: TickerAnalysisPayload = {
    ticker,
    companyName: fundamental?.companyName ?? q.shortName ?? q.longName ?? ticker,
    sector: fundamental?.sector ?? null,
    currentPrice,
    priceChange: Number(priceChange.toFixed(0)),
    priceChangePct: Number(priceChangePct.toFixed(2)),
    autoReject: getIdxAutoRejectionLimits(previousClose || currentPrice),
    fundamentals: fundamental,
    technical,
    macro,
    recentBars: histOutcome.data.slice(-65),
    relevantNews: (newsSummary?.headlines ?? []).map((h) => ({
      title: h.title,
      portal: h.portal,
      sentiment: h.sentiment,
      publishedAt: h.publishedAt,
    })),
    analysis: {
      action: result.action,
      confidence: result.confidence,
      entryPrice: result.entryPrice,
      stopLoss: result.stopLoss,
      targetPrice1: result.targetPrice1,
      targetPrice: result.targetPrice,
      riskRewardRatio: result.riskRewardRatio,
      maxHoldDays: result.maxHoldDays,
      orderType: result.orderType,
      setupType: result.setupType,
      overallScore: result.overallScore,
      sentimentScore: result.sentimentScore,
      fundamentalScore: result.fundamentalScore,
      technicalScore: result.technicalScore,
      quantScores: result.quant,
      positionSizing: result.sizing,
      analysisSummary: result.analysisSummary,
      newsSummary: result.newsSummary,
      fundamentalSummary: result.fundamentalSummary,
      technicalSummary: result.technicalSummary,
      guardrailReason: result.guardrailReason,
      mode: result.mode,
      modelUsed: result.modelUsed,
    },
    cached: false,
    analyzedAt: new Date().toISOString(),
  };

  setCache(cacheKey, payload, ANALYZE_CACHE_TTL_MS);
  return jsonOk(payload);
}

async function handleAnalyzePurge(req: Request): Promise<Response> {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  const body = await readJsonBody<{ ticker?: string }>(req);
  if (body.ticker) {
    const clean = normalizeTicker(body.ticker);
    if (!isValidIdxEquityTicker(clean)) return jsonErr("Ticker tidak valid", 400);
    const cleared = purgeCacheByPrefix(`${ANALYZE_CACHE_PREFIX}${clean}`);
    return jsonOk({ cleared, scope: clean });
  }
  const cleared = purgeCacheByPrefix(ANALYZE_CACHE_PREFIX);
  return jsonOk({ cleared, scope: "ALL" });
}

async function handleBacktest(req: Request): Promise<Response> {
  if (!hasValidAdminHeader(req)) {
    const ip = getClientKey(req);
    if (!checkRateLimit(`backtest:${ip}`, 10, 60_000)) {
      return jsonErr("Terlalu banyak simulasi backtest dalam 1 menit. Coba lagi sebentar.", 429);
    }
  }

  const body = await readJsonBody<Partial<BacktestRequest>>(req);
  const today = getWibDateString();
  const defaultStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let ticker: string | undefined;
  if (body.ticker && body.ticker.trim()) {
    const normalized = normalizeTicker(body.ticker);
    if (!isValidIdxEquityTicker(normalized)) {
      return jsonErr("Kode emiten IDX pada filter backtest tidak valid", 400);
    }
    ticker = normalized;
  }
  const reqParams: BacktestRequest = {
    startDate: body.startDate || defaultStart,
    endDate: body.endDate || today,
    ticker,
    feePct: body.feePct ?? 0.2,
    slippagePct: body.slippagePct ?? 0.1,
    trailingActivationPct: body.trailingActivationPct ?? 5.0,
    trailingDistancePct: body.trailingDistancePct ?? 3.5,
  };

  const result = await runBacktestSimulation(reqParams);
  return jsonOk(result);
}

const PatchSettingsSchema = z.object({
  scheduler: z
    .object({
      enabled: z.boolean().optional(),
      morningHour: z.number().int().min(0).max(23).optional(),
      morningMinute: z.number().int().min(0).max(59).optional(),
      eveningHour: z.number().int().min(0).max(23).optional(),
      eveningMinute: z.number().int().min(0).max(59).optional(),
    })
    .optional(),
  recommendation: z
    .object({
      minOverallScore: z.number().min(30).max(95).optional(),
      bearishMinOverallScore: z.number().min(40).max(95).optional(),
      minSentiment: z.number().min(0).max(100).optional(),
      minRiskRewardHighScore: z.number().min(1.0).max(5.0).optional(),
      minRiskRewardStandardScore: z.number().min(1.0).max(5.0).optional(),
      maxRecommendationsPerRun: z.number().int().min(1).max(30).optional(),
    })
    .optional(),
  anomaly: z
    .object({
      priceChangePct: z.number().min(1).max(35).optional(),
      volumeMultiplier: z.number().min(1.1).max(20).optional(),
    })
    .optional(),
});

async function handleGetSettings(req: Request): Promise<Response> {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  const settings = getStoredSettings();
  const watchlist = getWatchlist();
  const scheduler = getSchedulerStatus();
  const llm = await checkLlmConnectivity();

  const payload: AppSettings = {
    scheduler: {
      ...settings.scheduler,
      nextRun: computeNextScheduledRunIso(),
    },
    recommendation: settings.recommendation,
    anomaly: settings.anomaly,
    models: {
      baseUrl: getLlmBaseUrl(),
      filterModel: resolveModelForRole("filter"),
      decisionModel: resolveModelForRole("decision"),
      configured: llm.ok,
    },
    runtime: {
      schedulerRunning: scheduler.running,
      marketOpen: scheduler.marketOpen,
      pipelineRunning: isPipelineRunning(),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    },
    watchlist,
    adminProtected: isAdminAuthConfigured(),
  };

  return jsonOk(payload);
}

function handleAdminVerify(req: Request): Response {
  const denied = requireAdminAuth(req);
  if (denied) return denied;
  return jsonOk({ authenticated: true, adminProtected: isAdminAuthConfigured() });
}

async function handlePatchSettings(req: Request): Promise<Response> {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  const body = await readJsonBody(req);
  const parsed = PatchSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonErr(parsed.error.issues.map((i) => i.message).join("; "), 400);
  }

  const merged = patchStoredSettings(parsed.data);
  if (parsed.data.scheduler?.enabled === true) startScheduler();
  if (parsed.data.scheduler?.enabled === false) stopScheduler();

  return jsonOk(merged);
}

async function handleAddWatchlist(req: Request): Promise<Response> {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  const body = await readJsonBody<{ ticker?: string }>(req);
  const ticker = normalizeTicker(body.ticker ?? "");
  if (!isValidIdxEquityTicker(ticker)) {
    return jsonErr("Ticker tidak valid (wajib 4 huruf IDX)", 400);
  }

  addWatchlistTicker(ticker);
  return jsonOk({ watchlist: getWatchlist(), added: ticker });
}

function handleDeleteWatchlist(req: Request, url: URL): Response {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  const ticker = normalizeTicker(url.searchParams.get("ticker") ?? "");
  if (!ticker) return jsonErr("Parameter ticker diperlukan", 400);

  removeWatchlistTicker(ticker);
  return jsonOk({ watchlist: getWatchlist(), removed: ticker });
}

async function handlePipelineRun(req: Request): Promise<Response> {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  if (isPipelineRunning()) {
    return jsonErr("Pipeline sudah sedang berjalan", 409);
  }

  const body = await readJsonBody<{
    schedule?: "morning" | "evening" | "manual";
    forceRefresh?: boolean;
  }>(req);
  const schedule = body.schedule ?? "manual";
  const forceRefresh = Boolean(body.forceRefresh);
  void runPipeline(schedule, { forceRefresh });
  return jsonOk({ started: true, schedule, forceRefresh });
}

function handleSchedulerStart(req: Request): Response {
  const denied = requireAdminAuth(req);
  if (denied) return denied;
  startScheduler();
  return jsonOk(getSchedulerStatus());
}

function handleSchedulerStop(req: Request): Response {
  const denied = requireAdminAuth(req);
  if (denied) return denied;
  stopScheduler();
  return jsonOk(getSchedulerStatus());
}

function handleLogsSse(req: Request): Response {
  const denied = requireAdminAuth(req);
  if (denied) return denied;

  if (activeSseClients >= MAX_SSE_CLIENTS) {
    return jsonErr("Terlalu banyak koneksi log stream aktif (maksimum 5)", 429);
  }

  activeSseClients++;
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let released = false;
      const sendEvent = (evt: PipelineLogEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          cleanup?.();
        }
      };

      // Flush initial comment frame immediately so proxies and Bun do not time out an idle stream
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
      } catch {
        // stream closed
      }

      for (const evt of getRecentPipelineLogs()) {
        sendEvent(evt);
      }

      const unsubscribe = subscribePipelineLogs(sendEvent);
      const pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          cleanup?.();
        }
      }, 10_000);

      cleanup = () => {
        if (released) return;
        released = true;
        activeSseClients = Math.max(0, activeSseClients - 1);
        unsubscribe();
        clearInterval(pingTimer);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...BASE_CORS_HEADERS,
    },
  });
}

// ============================================================================
// Central Router & Entrypoint
// ============================================================================

async function dispatchApiRoute(req: Request, url: URL): Promise<Response> {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/dashboard") return await handleDashboard();
  if (req.method === "GET" && pathname === "/api/history") return await handleHistory(url);
  if (req.method === "GET" && pathname === "/api/outlook") return await handleOutlook();
  if (req.method === "GET" && pathname === "/api/screener") {
    return await handleScreener(req, url);
  }
  if (req.method === "POST" && pathname === "/api/analyze") return await handleAnalyze(req);
  if (req.method === "POST" && pathname === "/api/analyze/purge") {
    return await handleAnalyzePurge(req);
  }
  if (req.method === "POST" && pathname === "/api/backtest") return await handleBacktest(req);
  if (req.method === "POST" && pathname === "/api/admin/verify") {
    return handleAdminVerify(req);
  }
  if (req.method === "GET" && pathname === "/api/settings") {
    return await handleGetSettings(req);
  }
  if (req.method === "PATCH" && pathname === "/api/settings") {
    return await handlePatchSettings(req);
  }
  if (req.method === "POST" && pathname === "/api/watchlist") {
    return await handleAddWatchlist(req);
  }
  if (req.method === "DELETE" && pathname === "/api/watchlist") {
    return handleDeleteWatchlist(req, url);
  }
  if (req.method === "POST" && pathname === "/api/pipeline/run") {
    return await handlePipelineRun(req);
  }
  if (req.method === "POST" && pathname === "/api/scheduler/start") {
    return handleSchedulerStart(req);
  }
  if (req.method === "POST" && pathname === "/api/scheduler/stop") {
    return handleSchedulerStop(req);
  }
  if (req.method === "GET" && pathname === "/api/logs") return handleLogsSse(req);

  return jsonErr(`Route not found: ${req.method} ${pathname}`, 404);
}

export async function routeRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin")?.trim();
    const cors = getCorsHeaders(req);
    if (origin && !("Access-Control-Allow-Origin" in cors)) {
      return new Response(null, { status: 403, headers: cors });
    }
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  const { pathname } = url;

  if (pathname === "/health" || pathname === "/api/health") {
    getDb();
    return applyCorsHeaders(jsonOk({ status: "healthy", version: "2.0.0" }), req);
  }

  if (pathname.startsWith("/api/")) {
    try {
      const apiRes = await dispatchApiRoute(req, url);
      return applyCorsHeaders(apiRes, req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[API Error] ${req.method} ${pathname}:`, msg);
      return applyCorsHeaders(jsonErr(msg, 500), req);
    }
  }

  // Static production frontend assets + SPA fallback
  const candidatePath = resolveStaticAssetPath(pathname);
  if (!candidatePath) {
    return jsonErr("Invalid or forbidden asset path", 403);
  }

  const file = Bun.file(candidatePath);
  if (await file.exists()) {
    return new Response(file);
  }

  const indexFile = Bun.file(path.join(PUBLIC_DIR, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(
    "Milicent API Server running. Build client with `bun run build` or run Vite dev server.",
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}

if (import.meta.main) {
  loadFallbackEnv();
  getDb();
  if (getStoredSettings().scheduler.enabled) {
    startScheduler();
  }

  const host = process.env.HOST?.trim() || "127.0.0.1";
  const port = Number(process.env.PORT) || 3001;
  const server = Bun.serve({
    hostname: host,
    port,
    maxRequestBodySize: 256 * 1024,
    idleTimeout: 255,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (srv.upgrade(req)) return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return routeRequest(req);
    },
    websocket: {
      idleTimeout: 240,
      sendPings: true,
      open(ws) {
        registerWsClient(ws);
        ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));
      },
      message() {
        // Ignore heartbeats
      },
      close(ws) {
        unregisterWsClient(ws);
      },
    },
  });

  console.log(`Milicent Engine listening on http://${server.hostname}:${server.port}`);

  const shutdown = () => {
    stopScheduler();
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
