/**
 * Market Data Gateway:
 * - Fallback .env loader & WIB (Asia/Jakarta, UTC+7) IDX Session Clock
 * - Yahoo Finance direct fetch with cookie/crumb recovery & v8 chart synthesis fallback
 * - Quote, batch quotes, OHLCV chart history (persisted in SQLite)
 * - Dual-currency USD/IDR fundamental normalizer
 * - Live IHSG (^JKSE) & USD/IDR Macro Regime classifier (cached 15m in SQLite)
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import YahooFinance from "yahoo-finance2";
import { getCrumbClear } from "yahoo-finance2/lib/getCrumb";
import { normalizeTicker, toYahooSymbol } from "@protocol/idx-rules.ts";
import type {
  FundamentalSnapshot,
  MacroContext,
  MacroRegime,
  PriceBar,
  TrendState,
} from "@protocol/contracts.ts";
import { getCache, savePriceBars, setCache, upsertFundamental } from "./persistence.ts";

// ============================================================================
// Environment & WIB Market Hours
// ============================================================================

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function loadFallbackEnv(): void {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        const rawVal = line.slice(eqIdx + 1).trim();
        const val =
          (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
          (rawVal.startsWith("'") && rawVal.endsWith("'"))
            ? rawVal.slice(1, -1)
            : rawVal.replace(/\s+#.*$/, "").trim();
        if (key && (!process.env[key] || process.env[key]!.trim() === "")) {
          process.env[key] = val;
        }
      }
      break;
    } catch {
      // Ignore unreadable env files
    }
  }
}

loadFallbackEnv();

export function getWibTimeParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
} {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth() + 1,
    day: wib.getUTCDate(),
    dayOfWeek: wib.getUTCDay(),
    hour: wib.getUTCHours(),
    minute: wib.getUTCMinutes(),
  };
}

export function getWibDateString(date: Date = new Date()): string {
  const p = getWibTimeParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isIdxMarketOpen(date: Date = new Date()): boolean {
  const { dayOfWeek, hour, minute } = getWibTimeParts(date);
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const mins = hour * 60 + minute;
  const session1Start = 9 * 60;
  const session1End = dayOfWeek === 5 ? 11 * 60 + 30 : 12 * 60;
  const session2Start = dayOfWeek === 5 ? 14 * 60 : 13 * 60 + 30;
  const session2End = 16 * 60;

  return (
    (mins >= session1Start && mins <= session1End) ||
    (mins >= session2Start && mins <= session2End)
  );
}

// ============================================================================
// Yahoo Finance Fetch & Crumb Recovery
// ============================================================================

export const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface RawChartQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjclose?: number | null;
}

export interface RawChartData {
  quotes: RawChartQuote[];
  meta?: Record<string, unknown>;
}

export interface RawQuoteData {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketPreviousClose?: number;
  regularMarketVolume?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  averageDailyVolume10Day?: number;
  marketState?: string;
}

export interface FetchOutcome<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface YahooSummaryPayload {
  price?: { shortName?: string; longName?: string; currency?: string };
  summaryProfile?: { sector?: string; industry?: string };
  summaryDetail?: {
    marketCap?: number;
    trailingPE?: number;
    forwardPE?: number;
    priceToBook?: number;
    dividendYield?: number;
    currency?: string;
  };
  financialData?: {
    financialCurrency?: string;
    totalRevenue?: number;
    currentRatio?: number;
    debtToEquity?: number;
    returnOnEquity?: number;
    returnOnAssets?: number;
    profitMargins?: number;
    revenueGrowth?: number;
    earningsGrowth?: number;
  };
  defaultKeyStatistics?: {
    netIncomeToCommon?: number;
    priceToSalesTrailing12Months?: number;
    priceToBook?: number;
    trailingPE?: number;
    forwardPE?: number;
    pegRatio?: number;
    debtToEquity?: number;
  };
}

export async function resetYahooCrumb(yahooFinanceInstance: unknown): Promise<void> {
  try {
    const cookieJar = (yahooFinanceInstance as { _opts?: { cookieJar?: unknown } })?._opts
      ?.cookieJar;
    if (cookieJar) {
      await getCrumbClear(cookieJar as never);
    }
  } catch {
    // Non-fatal
  }
}

type FetchInit = NonNullable<Parameters<typeof globalThis.fetch>[1]>;

function normalizeHeaders(initHeaders?: FetchInit["headers"]): Record<string, string> {
  const headers: Record<string, string> = {};
  if (initHeaders instanceof Headers) {
    initHeaders.forEach((v, k) => {
      headers[k] = v;
    });
  } else if (Array.isArray(initHeaders)) {
    for (const [k, v] of initHeaders) {
      if (k && v !== undefined) headers[String(k)] = String(v);
    }
  } else if (initHeaders) {
    Object.assign(headers, initHeaders);
  }

  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
    headers["User-Agent"] = YAHOO_USER_AGENT;
  }
  return headers;
}

async function singleYahooFetch(
  targetUrl: string,
  init: FetchInit | undefined,
  headers: Record<string, string>,
  useProxy: boolean
): Promise<Response> {
  const requestUrl =
    useProxy && process.env.CRAWLER_PROXY_URL && process.env.CRAWLER_PROXY_TOKEN
      ? (() => {
          const w = new URL(process.env.CRAWLER_PROXY_URL!);
          w.searchParams.set("url", targetUrl);
          w.searchParams.set("token", process.env.CRAWLER_PROXY_TOKEN!);
          return w.toString();
        })()
      : targetUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(requestUrl, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
      signal: init?.signal ?? controller.signal,
      redirect: useProxy ? "follow" : (init?.redirect ?? "follow"),
    });

    if (init?.redirect === "manual" && response.status >= 300 && response.status < 400) {
      return response;
    }
    if (targetUrl.includes("fc.yahoo.com") && response.headers.getSetCookie?.()?.length) {
      return response;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export const yahooCustomFetch: typeof globalThis.fetch = Object.assign(
  async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1]
  ): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = normalizeHeaders(init?.headers);
    const forceProxy =
      process.env.YAHOO_USE_PROXY === "true" &&
      Boolean(process.env.CRAWLER_PROXY_URL && process.env.CRAWLER_PROXY_TOKEN);

    const isBootstrap =
      init?.redirect === "manual" &&
      !url.includes("getcrumb") &&
      (url.includes("finance.yahoo.com/quote") || url.includes("fc.yahoo.com"));

    try {
      const res = await singleYahooFetch(url, init, headers, forceProxy);
      if (isBootstrap) {
        const cookies = res.headers.getSetCookie?.() ?? [];
        const loc = res.headers.get("location") ?? "";
        if (cookies.length === 0 && !loc.includes("guce.yahoo")) {
          throw new Error("Yahoo bootstrap missing Set-Cookie");
        }
      }
      return res;
    } catch (err) {
      if (isBootstrap) {
        const fcRes = await singleYahooFetch(
          "https://fc.yahoo.com",
          { redirect: "manual" },
          headers,
          false
        );
        if ((fcRes.headers.getSetCookie?.() ?? []).length > 0) {
          return fcRes;
        }
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  },
  globalThis.fetch
);

export function buildQuoteFromChart(
  yahooTicker: string,
  chart: RawChartData
): RawQuoteData | null {
  const bars = (chart.quotes ?? []).filter(
    (q): q is RawChartQuote & { open: number; high: number; low: number; close: number } =>
      q.close != null && q.open != null && q.high != null && q.low != null
  );
  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : undefined;
  const meta = chart.meta ?? {};

  const price =
    (typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : undefined) ??
    last?.close;
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;

  const previousClose =
    prev?.close ??
    (typeof meta.regularMarketPreviousClose === "number"
      ? meta.regularMarketPreviousClose
      : undefined) ??
    (typeof meta.chartPreviousClose === "number" ? meta.chartPreviousClose : undefined) ??
    price;
  const change =
    typeof meta.fulldayChange === "number" ? meta.fulldayChange : price - previousClose;
  const changePercent =
    typeof meta.regularMarketChangePercent === "number"
      ? meta.regularMarketChangePercent
      : previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : 0;

  const vols = bars.slice(-10).map((b) => b.volume ?? 0);
  const avgVol10 = vols.length > 0 ? vols.reduce((s, v) => s + v, 0) / vols.length : 0;

  return {
    symbol: typeof meta.symbol === "string" ? meta.symbol : yahooTicker,
    shortName: typeof meta.shortName === "string" ? meta.shortName : yahooTicker,
    longName: typeof meta.longName === "string" ? meta.longName : yahooTicker,
    regularMarketPrice: price,
    regularMarketOpen: last?.open ?? price,
    regularMarketDayHigh:
      typeof meta.regularMarketDayHigh === "number"
        ? meta.regularMarketDayHigh
        : (last?.high ?? price),
    regularMarketDayLow:
      typeof meta.regularMarketDayLow === "number"
        ? meta.regularMarketDayLow
        : (last?.low ?? price),
    regularMarketPreviousClose: previousClose,
    regularMarketVolume:
      typeof meta.regularMarketVolume === "number"
        ? meta.regularMarketVolume
        : (last?.volume ?? 0),
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    averageDailyVolume10Day: avgVol10,
    marketState: "CLOSED",
  };
}

const yahoo = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  fetch: yahooCustomFetch,
});

const quoteCache = new Map<string, { ts: number; res: FetchOutcome<RawQuoteData> }>();
const QUOTE_TTL_MS = 15_000;

function validQuote(q: unknown): q is RawQuoteData {
  return (
    Boolean(q) &&
    typeof q === "object" &&
    typeof (q as RawQuoteData).regularMarketPrice === "number" &&
    (q as RawQuoteData).regularMarketPrice! > 0
  );
}

export async function fetchQuote(ticker: string): Promise<FetchOutcome<RawQuoteData>> {
  const symbol = toYahooSymbol(ticker);
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.ts < QUOTE_TTL_MS) return hit.res;

  let lastErr = `No quote for ${symbol}`;
  for (let i = 0; i < 2; i++) {
    try {
      const q = await yahoo.quote(symbol);
      if (validQuote(q)) {
        const out: FetchOutcome<RawQuoteData> = { success: true, data: q, error: null };
        quoteCache.set(symbol, { ts: Date.now(), res: out });
        return out;
      }
      await resetYahooCrumb(yahoo);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await resetYahooCrumb(yahoo);
    }
  }

  if (!symbol.includes("=")) {
    const chartRes = await fetchChartHistory(symbol, "1mo");
    if (chartRes.success && chartRes.data) {
      const synthesized = buildQuoteFromChart(symbol, chartRes.data);
      if (synthesized) {
        const out: FetchOutcome<RawQuoteData> = { success: true, data: synthesized, error: null };
        quoteCache.set(symbol, { ts: Date.now(), res: out });
        return out;
      }
    }
  }

  return { success: false, data: null, error: lastErr };
}

export async function fetchQuoteSummary(
  ticker: string
): Promise<FetchOutcome<YahooSummaryPayload>> {
  const symbol = toYahooSymbol(ticker);
  const modules = [
    "price",
    "summaryProfile",
    "summaryDetail",
    "financialData",
    "defaultKeyStatistics",
  ] as const;

  let lastErr = `No summary for ${symbol}`;
  for (let i = 0; i < 2; i++) {
    try {
      const summary = await yahoo.quoteSummary(symbol, { modules: [...modules] });
      return { success: true, data: summary as YahooSummaryPayload, error: null };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await resetYahooCrumb(yahoo);
    }
  }
  return { success: false, data: null, error: lastErr };
}

export async function fetchChartHistory(
  ticker: string,
  period: "1mo" | "3mo" | "6mo" | "1y" = "1y"
): Promise<FetchOutcome<RawChartData>> {
  const symbol = toYahooSymbol(ticker);
  const start = new Date();
  if (period === "1mo") start.setMonth(start.getMonth() - 1);
  else if (period === "3mo") start.setMonth(start.getMonth() - 3);
  else if (period === "6mo") start.setMonth(start.getMonth() - 6);
  else start.setFullYear(start.getFullYear() - 1);

  try {
    const chart = await yahoo.chart(symbol, {
      period1: start,
      period2: new Date(),
      interval: "1d",
    });
    return { success: true, data: chart as RawChartData, error: null };
  } catch (err) {
    return { success: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchQuotesBatch(
  tickers: string[]
): Promise<Map<string, FetchOutcome<RawQuoteData>>> {
  const map = new Map<string, FetchOutcome<RawQuoteData>>();
  const uniqueNormalized = [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
  const chunkSize = 5;
  for (let i = 0; i < uniqueNormalized.length; i += chunkSize) {
    const batch = uniqueNormalized.slice(i, i + chunkSize);
    await Promise.all(
      batch.map(async (key) => {
        map.set(key, await fetchQuote(key));
      })
    );
    if (i + chunkSize < uniqueNormalized.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  return map;
}

export async function fetchPriceHistory(
  ticker: string,
  period: "1mo" | "3mo" | "6mo" | "1y" = "1y"
): Promise<FetchOutcome<PriceBar[]>> {
  const res = await fetchChartHistory(ticker, period);
  if (!res.success || !res.data?.quotes) {
    return { success: false, data: null, error: res.error ?? "No price history" };
  }

  const bars: PriceBar[] = res.data.quotes
    .filter(
      (r): r is typeof r & { open: number; high: number; low: number; close: number } =>
        r.date != null && r.open != null && r.high != null && r.low != null && r.close != null
    )
    .map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? 0,
      adjustedClose: r.adjclose ?? r.close,
    }));

  if (bars.length === 0) {
    return { success: false, data: null, error: "Empty chart bars" };
  }
  savePriceBars(ticker, bars);
  return { success: true, data: bars, error: null };
}

// ============================================================================
// Fundamentals & USD/IDR Normalization
// ============================================================================

const DEFAULT_USD_IDR = 16200;
let fxCache: { rate: number; ts: number } | null = null;

async function getUsdIdrRate(): Promise<number> {
  if (fxCache && Date.now() - fxCache.ts < 3600_000) return fxCache.rate;
  try {
    const q = await fetchQuote("USDIDR=X");
    const rate = q.data?.regularMarketPrice;
    if (q.success && rate && rate > 10000 && rate < 25000) {
      fxCache = { rate, ts: Date.now() };
      return rate;
    }
  } catch {
    // Fallback
  }
  return fxCache?.rate ?? DEFAULT_USD_IDR;
}

const RATIO_CEILINGS: Record<string, number> = {
  peRatio: 1000,
  forwardPe: 1000,
  pbRatio: 100,
  psRatio: 200,
  pegRatio: 50,
};

export function sanitizeRatio(field: keyof typeof RATIO_CEILINGS, val: number | null): number | null {
  if (val === null || !Number.isFinite(val)) return null;
  const ceiling = RATIO_CEILINGS[field];
  if (ceiling !== undefined && val > ceiling) return null;
  return val;
}

export function normalizeDualCurrencyRatio(
  rawRatio: number | null,
  isUsdReportingIdrTrading: boolean,
  rate: number
): number | null {
  if (rawRatio == null || !Number.isFinite(rawRatio)) return null;
  if (isUsdReportingIdrTrading && rawRatio > 50 && rate > 0) {
    return rawRatio / rate;
  }
  return rawRatio;
}

export function transformToFundamentalSnapshot(
  ticker: string,
  summary: YahooSummaryPayload,
  usdIdrRate?: number
): FundamentalSnapshot {
  const price = summary.price ?? {};
  const profile = summary.summaryProfile ?? {};
  const detail = summary.summaryDetail ?? {};
  const fin = summary.financialData ?? {};
  const stats = summary.defaultKeyStatistics ?? {};

  const finCurr = fin.financialCurrency?.toUpperCase() ?? null;
  const pxCurr = (price.currency ?? detail.currency ?? "IDR").toUpperCase();
  const isDual = finCurr === "USD" && pxCurr === "IDR";

  let fx = usdIdrRate ?? DEFAULT_USD_IDR;
  if (isDual) {
    const mc = detail.marketCap ?? null;
    const pe = detail.trailingPE ?? stats.trailingPE ?? null;
    const ni = stats.netIncomeToCommon ?? null;
    if (mc && pe && ni && mc > 0 && pe > 0 && ni > 0) {
      const implied = mc / (pe * ni);
      if (implied >= 10000 && implied <= 25000) fx = implied;
    }
  }

  const rawPb = detail.priceToBook ?? stats.priceToBook ?? null;
  const rawPs = stats.priceToSalesTrailing12Months ?? null;

  return {
    ticker: normalizeTicker(ticker),
    companyName: price.shortName ?? price.longName ?? normalizeTicker(ticker),
    sector: profile.sector ?? null,
    industry: profile.industry ?? null,
    marketCap: detail.marketCap ?? null,
    peRatio: sanitizeRatio("peRatio", detail.trailingPE ?? stats.trailingPE ?? null),
    forwardPe: sanitizeRatio("forwardPe", detail.forwardPE ?? stats.forwardPE ?? null),
    pbRatio: sanitizeRatio("pbRatio", normalizeDualCurrencyRatio(rawPb, isDual, fx)),
    psRatio: sanitizeRatio("psRatio", normalizeDualCurrencyRatio(rawPs, isDual, fx)),
    pegRatio: sanitizeRatio("pegRatio", stats.pegRatio ?? null),
    roe: fin.returnOnEquity ?? null,
    roa: fin.returnOnAssets ?? null,
    profitMargin: fin.profitMargins ?? null,
    debtToEquity: fin.debtToEquity ?? stats.debtToEquity ?? null,
    currentRatio: fin.currentRatio ?? null,
    dividendYield: detail.dividendYield ?? null,
    totalRevenue: fin.totalRevenue ?? null,
    revenueGrowth: fin.revenueGrowth ?? null,
    earningsGrowth: fin.earningsGrowth ?? null,
    netIncome: stats.netIncomeToCommon ?? null,
    financialCurrency: finCurr ?? pxCurr,
  };
}

export async function fetchFundamentals(
  ticker: string
): Promise<FetchOutcome<FundamentalSnapshot>> {
  const res = await fetchQuoteSummary(ticker);
  if (!res.success || !res.data) {
    return { success: false, data: null, error: res.error ?? "No summary" };
  }

  let fx: number | undefined;
  if (res.data.financialData?.financialCurrency?.toUpperCase() === "USD") {
    fx = await getUsdIdrRate();
  }

  const snap = transformToFundamentalSnapshot(ticker, res.data, fx);
  upsertFundamental(snap);
  return { success: true, data: snap, error: null };
}

// ============================================================================
// Macro Regime Classifier (^JKSE & USDIDR=X)
// ============================================================================

const MACRO_CACHE_KEY = "macro:v1";
const MACRO_TTL_MS = 15 * 60 * 1000;

function localSma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function localRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let ag = gains / period;
  let al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    ag = (ag * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    al = (al * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (al === 0) return 100;
  return Number((100 - 100 / (1 + ag / al)).toFixed(1));
}

function localTrend(closes: number[], sma20: number | null, sma50: number | null): TrendState {
  if (closes.length < 20) return "SIDEWAYS";
  const curr = closes[closes.length - 1] ?? 0;
  const prev20 = closes[closes.length - 20] ?? curr;
  const pct = prev20 > 0 ? ((curr - prev20) / prev20) * 100 : 0;
  let trend: TrendState = pct > 5 ? "BULLISH" : pct < -5 ? "BEARISH" : "SIDEWAYS";
  if (sma20 && sma50 && curr > sma20 && sma20 > sma50) trend = "BULLISH";
  else if (sma20 && sma50 && curr < sma20 && sma20 < sma50) trend = "BEARISH";
  return trend;
}

export function classifyMacroRegime(params: {
  ihsgTrend: TrendState;
  ihsgRsi14: number | null;
  usdIdrChange5dPct: number | null;
}): { regime: MacroRegime; regimeScore: number } {
  const { ihsgTrend, ihsgRsi14, usdIdrChange5dPct } = params;
  const fx5d = usdIdrChange5dPct ?? 0;

  let score = 55;
  if (ihsgTrend === "BULLISH") score += 20;
  else if (ihsgTrend === "BEARISH") score -= 20;

  if (ihsgRsi14 !== null) {
    if (ihsgRsi14 >= 55) score += 10;
    else if (ihsgRsi14 < 40) score -= 12;
  }

  if (fx5d <= -0.5) score += 8;
  else if (fx5d >= 1.0) score -= 12;

  const regimeScore = Math.max(0, Math.min(100, Math.round(score)));

  if (ihsgTrend === "BEARISH" && ((ihsgRsi14 !== null && ihsgRsi14 < 40) || fx5d > 1.0)) {
    return { regime: "RISK_OFF", regimeScore };
  }
  if (ihsgTrend === "BEARISH" || fx5d > 1.2) {
    return { regime: "CAUTIOUS", regimeScore };
  }
  if (ihsgTrend === "BULLISH" && fx5d < 0.8) {
    return { regime: "RISK_ON", regimeScore };
  }
  return { regime: "NEUTRAL", regimeScore };
}

export async function getMacroContext(forceRefresh = false): Promise<MacroContext> {
  if (!forceRefresh) {
    const cached = getCache<MacroContext>(MACRO_CACHE_KEY);
    if (cached) return cached;
  }

  try {
    const [ihsgQ, ihsgH, fxH] = await Promise.all([
      fetchQuote("^JKSE"),
      fetchChartHistory("^JKSE", "6mo"),
      fetchChartHistory("USDIDR=X", "1mo"),
    ]);

    const ihsgCloses = (ihsgH.data?.quotes ?? [])
      .map((q) => q.close)
      .filter((c): c is number => typeof c === "number" && c > 0);

    const ihsgPrice =
      ihsgQ.data?.regularMarketPrice ??
      (ihsgCloses.length > 0 ? ihsgCloses[ihsgCloses.length - 1]! : null);
    const ihsgChangePct =
      ihsgQ.data?.regularMarketChangePercent !== undefined
        ? Number(ihsgQ.data.regularMarketChangePercent.toFixed(2))
        : null;

    const ihsgSma20 = localSma(ihsgCloses, 20);
    const ihsgSma50 = localSma(ihsgCloses, 50);
    const ihsgRsi14 = localRsi(ihsgCloses, 14);
    const ihsgTrend = localTrend(ihsgCloses, ihsgSma20, ihsgSma50);

    let ihsgReturn20dPct = 0;
    if (ihsgCloses.length >= 21) {
      const curr = ihsgCloses[ihsgCloses.length - 1]!;
      const prev20 = ihsgCloses[ihsgCloses.length - 21]!;
      if (prev20 > 0) ihsgReturn20dPct = Number((((curr - prev20) / prev20) * 100).toFixed(2));
    }

    const fxCloses = (fxH.data?.quotes ?? [])
      .map((q) => q.close)
      .filter((c): c is number => typeof c === "number" && c > 1000);
    const usdIdrRate = fxCloses.length > 0 ? Number(fxCloses[fxCloses.length - 1]!.toFixed(0)) : null;
    let usdIdrChange5dPct: number | null = null;
    if (fxCloses.length >= 6) {
      const curr = fxCloses[fxCloses.length - 1]!;
      const prev5 = fxCloses[fxCloses.length - 6]!;
      if (prev5 > 0) usdIdrChange5dPct = Number((((curr - prev5) / prev5) * 100).toFixed(2));
    }

    const { regime, regimeScore } = classifyMacroRegime({
      ihsgTrend,
      ihsgRsi14,
      usdIdrChange5dPct,
    });

    const summary =
      `IHSG ${ihsgPrice ? ihsgPrice.toFixed(0) : "N/A"} (${ihsgTrend}, 20D ${ihsgReturn20dPct >= 0 ? "+" : ""}${ihsgReturn20dPct.toFixed(1)}%)` +
      ` · USD/IDR ${usdIdrRate ? usdIdrRate.toLocaleString("id-ID") : "N/A"}` +
      `${usdIdrChange5dPct !== null ? ` (${usdIdrChange5dPct >= 0 ? "+" : ""}${usdIdrChange5dPct.toFixed(2)}% 5D)` : ""}`;

    const ctx: MacroContext = {
      ihsgPrice,
      ihsgChangePct,
      ihsgTrend,
      ihsgRsi14,
      ihsgSma20: ihsgSma20 ? Number(ihsgSma20.toFixed(0)) : null,
      ihsgSma50: ihsgSma50 ? Number(ihsgSma50.toFixed(0)) : null,
      ihsgReturn20dPct,
      usdIdrRate,
      usdIdrChange5dPct,
      regime,
      regimeScore,
      summary,
      updatedAt: new Date().toISOString(),
    };
    setCache(MACRO_CACHE_KEY, ctx, MACRO_TTL_MS);
    return ctx;
  } catch {
    return {
      ihsgPrice: null,
      ihsgChangePct: null,
      ihsgTrend: "SIDEWAYS",
      ihsgRsi14: null,
      ihsgSma20: null,
      ihsgSma50: null,
      ihsgReturn20dPct: 0,
      usdIdrRate: null,
      usdIdrChange5dPct: null,
      regime: "NEUTRAL",
      regimeScore: 50,
      summary: "IHSG & USD/IDR offline (NEUTRAL fallback)",
      updatedAt: new Date().toISOString(),
    };
  }
}
