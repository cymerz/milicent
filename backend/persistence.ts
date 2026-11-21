/**
 * Unified SQLite Persistence Engine (WAL Mode, Schema Init & Repositories)
 *
 * Single data store for signals, skipped guardrails, fundamentals, OHLCV bars,
 * news articles/mentions, TTL kv_cache, settings, watchlist, job runs, and Telegram users.
 * Supports lazy initialization and `resetDatabaseForTests(":memory:")` for isolated tests.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { normalizeTicker } from "@protocol/idx-rules.ts";
import type {
  AppSettings,
  FundamentalSnapshot,
  OrderType,
  PriceBar,
  SetupType,
  SignalAction,
  SignalRecord,
  SignalStatsSummary,
  SignalStatus,
  SkippedSignalRecord,
} from "@protocol/contracts.ts";

let dbInstance: Database | null = null;
let overrideDbPath: string | null = null;

function wibDateString(date: Date = new Date()): string {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function initSchema(conn: Database): void {
  conn.exec("PRAGMA foreign_keys = ON");

  conn.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      signal_date DATE NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('BUY', 'WAIT', 'HOLD', 'AVOID')),
      setup_type TEXT NOT NULL DEFAULT 'NONE',
      order_type TEXT NOT NULL DEFAULT 'LIMIT' CHECK(order_type IN ('LIMIT', 'MARKET')),
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target_price_1 REAL NOT NULL,
      target_price REAL NOT NULL,
      max_hold_days INTEGER NOT NULL,
      sentiment_score REAL NOT NULL,
      fundamental_score REAL NOT NULL,
      technical_score REAL NOT NULL,
      overall_score REAL NOT NULL,
      analysis_summary TEXT NOT NULL,
      news_summary TEXT NOT NULL,
      fundamental_summary TEXT NOT NULL,
      technical_summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'entry_hit', 'target_hit', 'sl_hit', 'expired', 'cancelled')),
      entry_hit_date DATE,
      tp1_hit_date DATE,
      exit_date DATE,
      exit_price REAL,
      profit_loss_pct REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ticker, signal_date)
    )
  `);
  conn.exec("CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(signal_date)");
  conn.exec("CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status)");

  conn.exec(`
    CREATE TABLE IF NOT EXISTS skipped_signals (
      ticker TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      sector TEXT,
      current_price REAL NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL NOT NULL,
      target_price REAL NOT NULL,
      overall_score REAL NOT NULL,
      guardrail_reason TEXT,
      summary TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS fundamentals (
      ticker TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      sector TEXT,
      industry TEXT,
      market_cap REAL,
      pe_ratio REAL,
      forward_pe REAL,
      pb_ratio REAL,
      ps_ratio REAL,
      peg_ratio REAL,
      roe REAL,
      roa REAL,
      profit_margin REAL,
      debt_to_equity REAL,
      current_ratio REAL,
      dividend_yield REAL,
      total_revenue REAL,
      revenue_growth REAL,
      earnings_growth REAL,
      net_income REAL,
      financial_currency TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS price_bars (
      ticker TEXT NOT NULL,
      date DATE NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      PRIMARY KEY(ticker, date)
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS news_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      portal TEXT NOT NULL,
      published_at DATETIME,
      crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      content_hash TEXT UNIQUE NOT NULL
    )
  `);
  conn.exec("CREATE INDEX IF NOT EXISTS idx_news_crawled ON news_articles(crawled_at)");

  conn.exec(`
    CREATE TABLE IF NOT EXISTS news_mentions (
      article_id INTEGER NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
      ticker TEXT NOT NULL,
      sentiment REAL NOT NULL,
      relevance REAL NOT NULL,
      PRIMARY KEY(article_id, ticker)
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS kv_cache (
      cache_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS watchlist (
      ticker TEXT PRIMARY KEY,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      chat_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  conn.exec(`
    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule TEXT NOT NULL CHECK(schedule IN ('morning', 'evening')),
      run_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
      articles_count INTEGER NOT NULL DEFAULT 0,
      tickers_count INTEGER NOT NULL DEFAULT 0,
      signals_count INTEGER NOT NULL DEFAULT 0,
      error_msg TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      UNIQUE(schedule, run_date)
    )
  `);
}

export function getDb(): Database {
  if (dbInstance) return dbInstance;
  const resolvedPath =
    overrideDbPath ??
    process.env.MILICENT_DB_PATH ??
    process.env.SENTI_DB_PATH ??
    join(process.cwd(), "data/milicent.db");
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }
  const conn = new Database(resolvedPath, { create: true });
  if (resolvedPath !== ":memory:") {
    conn.exec("PRAGMA journal_mode = WAL");
  }
  initSchema(conn);
  dbInstance = conn;
  return dbInstance;
}

export function resetDatabaseForTests(customPath = ":memory:"): Database {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
  overrideDbPath = customPath;
  return getDb();
}

// ============================================================================
// KV Cache with TTL
// ============================================================================

export function getCache<T>(key: string): T | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT value_json, expires_at FROM kv_cache WHERE cache_key = $key")
      .get({ $key: key }) as { value_json: string; expires_at: number } | null;

    if (!row) return null;
    if (Date.now() > row.expires_at) {
      db.prepare("DELETE FROM kv_cache WHERE cache_key = $key").run({ $key: key });
      return null;
    }
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  try {
    const db = getDb();
    const expiresAt = Date.now() + ttlMs;
    db.prepare(`
      INSERT INTO kv_cache (cache_key, value_json, expires_at)
      VALUES ($key, $val, $exp)
      ON CONFLICT(cache_key) DO UPDATE SET
        value_json = excluded.value_json,
        expires_at = excluded.expires_at
    `).run({ $key: key, $val: JSON.stringify(value), $exp: expiresAt });
  } catch {
    // Non-fatal
  }
}

export function purgeCacheByPrefix(prefix: string): number {
  const res = getDb()
    .prepare("DELETE FROM kv_cache WHERE cache_key LIKE $pattern")
    .run({ $pattern: `${prefix}%` });
  return res.changes;
}

// ============================================================================
// Settings & Watchlist
// ============================================================================

export interface StoredSettings {
  scheduler: {
    enabled: boolean;
    morningHour: number;
    morningMinute: number;
    eveningHour: number;
    eveningMinute: number;
  };
  recommendation: AppSettings["recommendation"];
  anomaly: AppSettings["anomaly"];
}

export function getDefaultStoredSettings(): StoredSettings {
  return {
    scheduler: {
      enabled: true,
      morningHour: 8,
      morningMinute: 15,
      eveningHour: 18,
      eveningMinute: 15,
    },
    recommendation: {
      minOverallScore: 65,
      bearishMinOverallScore: 72,
      minSentiment: 45,
      minRiskRewardHighScore: 1.5,
      minRiskRewardStandardScore: 2.0,
      maxRecommendationsPerRun: 5,
    },
    anomaly: {
      priceChangePct: Number(process.env.ANOMALY_PRICE_CHANGE_PCT ?? 5.0),
      volumeMultiplier: Number(process.env.ANOMALY_VOLUME_MULTIPLIER ?? 3.0),
    },
  };
}

export function getStoredSettings(): StoredSettings {
  const defaults = getDefaultStoredSettings();
  const row = getDb()
    .prepare("SELECT value_json FROM settings WHERE key = 'app_settings'")
    .get() as { value_json: string } | null;

  if (!row) return defaults;
  try {
    const parsed = JSON.parse(row.value_json) as Partial<StoredSettings>;
    return {
      scheduler: { ...defaults.scheduler, ...parsed.scheduler },
      recommendation: { ...defaults.recommendation, ...parsed.recommendation },
      anomaly: { ...defaults.anomaly, ...parsed.anomaly },
    };
  } catch {
    return defaults;
  }
}

export function patchStoredSettings(
  patch: Partial<{
    scheduler: Partial<StoredSettings["scheduler"]>;
    recommendation: Partial<StoredSettings["recommendation"]>;
    anomaly: Partial<StoredSettings["anomaly"]>;
  }>
): StoredSettings {
  const curr = getStoredSettings();
  const next: StoredSettings = {
    scheduler: { ...curr.scheduler, ...patch.scheduler },
    recommendation: { ...curr.recommendation, ...patch.recommendation },
    anomaly: { ...curr.anomaly, ...patch.anomaly },
  };
  getDb()
    .prepare(`
      INSERT INTO settings (key, value_json) VALUES ('app_settings', $val)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `)
    .run({ $val: JSON.stringify(next) });
  return next;
}

export function getWatchlist(): string[] {
  const rows = getDb()
    .prepare("SELECT ticker FROM watchlist ORDER BY ticker ASC")
    .all() as Array<{ ticker: string }>;
  return rows.map((r) => r.ticker);
}

export function addWatchlistTicker(rawTicker: string): boolean {
  const clean = normalizeTicker(rawTicker);
  if (!clean) return false;
  const res = getDb()
    .prepare("INSERT OR IGNORE INTO watchlist (ticker) VALUES ($ticker)")
    .run({ $ticker: clean });
  return res.changes > 0;
}

export function removeWatchlistTicker(rawTicker: string): boolean {
  const clean = normalizeTicker(rawTicker);
  const res = getDb()
    .prepare("DELETE FROM watchlist WHERE ticker = $ticker")
    .run({ $ticker: clean });
  return res.changes > 0;
}

// ============================================================================
// Fundamentals & Price Bars
// ============================================================================

export function upsertFundamental(f: FundamentalSnapshot): void {
  try {
    getDb()
      .prepare(`
        INSERT INTO fundamentals (
          ticker, company_name, sector, industry, market_cap,
          pe_ratio, forward_pe, pb_ratio, ps_ratio, peg_ratio,
          roe, roa, profit_margin, debt_to_equity, current_ratio, dividend_yield,
          total_revenue, revenue_growth, earnings_growth, net_income, financial_currency
        ) VALUES (
          $ticker, $companyName, $sector, $industry, $marketCap,
          $peRatio, $forwardPe, $pbRatio, $psRatio, $pegRatio,
          $roe, $roa, $profitMargin, $debtToEquity, $currentRatio, $dividendYield,
          $totalRevenue, $revenueGrowth, $earningsGrowth, $netIncome, $financialCurrency
        )
        ON CONFLICT(ticker) DO UPDATE SET
          company_name = excluded.company_name, sector = excluded.sector, industry = excluded.industry,
          market_cap = excluded.market_cap, pe_ratio = excluded.pe_ratio, forward_pe = excluded.forward_pe,
          pb_ratio = excluded.pb_ratio, ps_ratio = excluded.ps_ratio, peg_ratio = excluded.peg_ratio,
          roe = excluded.roe, roa = excluded.roa, profit_margin = excluded.profit_margin,
          debt_to_equity = excluded.debt_to_equity, current_ratio = excluded.current_ratio,
          dividend_yield = excluded.dividend_yield, total_revenue = excluded.total_revenue,
          revenue_growth = excluded.revenue_growth, earnings_growth = excluded.earnings_growth,
          net_income = excluded.net_income, financial_currency = excluded.financial_currency,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run({
        $ticker: normalizeTicker(f.ticker),
        $companyName: f.companyName,
        $sector: f.sector,
        $industry: f.industry,
        $marketCap: f.marketCap,
        $peRatio: f.peRatio,
        $forwardPe: f.forwardPe,
        $pbRatio: f.pbRatio,
        $psRatio: f.psRatio,
        $pegRatio: f.pegRatio,
        $roe: f.roe,
        $roa: f.roa,
        $profitMargin: f.profitMargin,
        $debtToEquity: f.debtToEquity,
        $currentRatio: f.currentRatio,
        $dividendYield: f.dividendYield,
        $totalRevenue: f.totalRevenue,
        $revenueGrowth: f.revenueGrowth,
        $earningsGrowth: f.earningsGrowth,
        $netIncome: f.netIncome,
        $financialCurrency: f.financialCurrency,
      });
  } catch {
    // Non-fatal
  }
}

export function getFundamentalsMap(tickers: string[]): Map<string, FundamentalSnapshot> {
  const map = new Map<string, FundamentalSnapshot>();
  if (tickers.length === 0) return map;

  const normalized = [...new Set(tickers.map(normalizeTicker))];
  const placeholders = normalized.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`
      SELECT
        ticker, company_name as companyName, sector, industry, market_cap as marketCap,
        pe_ratio as peRatio, forward_pe as forwardPe, pb_ratio as pbRatio,
        ps_ratio as psRatio, peg_ratio as pegRatio, roe, roa, profit_margin as profitMargin,
        debt_to_equity as debtToEquity, current_ratio as currentRatio,
        dividend_yield as dividendYield, total_revenue as totalRevenue,
        revenue_growth as revenueGrowth, earnings_growth as earningsGrowth,
        net_income as netIncome, financial_currency as financialCurrency
      FROM fundamentals WHERE ticker IN (${placeholders})
    `)
    .all(...normalized) as FundamentalSnapshot[];

  for (const row of rows) {
    map.set(row.ticker, row);
  }
  return map;
}

export function savePriceBars(ticker: string, bars: PriceBar[]): void {
  if (bars.length === 0) return;
  try {
    const db = getDb();
    const clean = normalizeTicker(ticker);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO price_bars (ticker, date, open, high, low, close, volume)
      VALUES ($ticker, $date, $open, $high, $low, $close, $volume)
    `);
    db.transaction(() => {
      for (const b of bars) {
        stmt.run({
          $ticker: clean,
          $date: b.date,
          $open: b.open,
          $high: b.high,
          $low: b.low,
          $close: b.close,
          $volume: Math.round(b.volume),
        });
      }
    })();
  } catch {
    // Non-fatal
  }
}

export function getStoredPriceBars(ticker: string): PriceBar[] {
  const rows = getDb()
    .prepare(`
      SELECT date, open, high, low, close, volume
      FROM price_bars
      WHERE ticker = $ticker
      ORDER BY date ASC
    `)
    .all({ $ticker: normalizeTicker(ticker) }) as Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  return rows.map((r) => ({ ...r, adjustedClose: r.close }));
}

// ============================================================================
// Signals, Skipped Signals & History Repository
// ============================================================================

export interface SignalInsertInput {
  ticker: string;
  signalDate: string;
  action: SignalAction;
  setupType: SetupType;
  orderType: OrderType;
  entryPrice: number;
  stopLoss: number;
  targetPrice1: number;
  targetPrice: number;
  maxHoldDays: number;
  sentimentScore: number;
  fundamentalScore: number;
  technicalScore: number;
  overallScore: number;
  analysisSummary: string;
  newsSummary: string;
  fundamentalSummary: string;
  technicalSummary: string;
}

interface SignalRow {
  id: number;
  ticker: string;
  signalDate: string;
  action: SignalAction;
  setupType: SetupType;
  orderType: OrderType;
  entryPrice: number;
  stopLoss: number;
  targetPrice1: number;
  targetPrice: number;
  maxHoldDays: number;
  sentimentScore: number;
  fundamentalScore: number;
  technicalScore: number;
  overallScore: number;
  analysisSummary: string;
  newsSummary: string;
  fundamentalSummary: string;
  technicalSummary: string;
  status: SignalStatus;
  entryHitDate: string | null;
  tp1HitDate: string | null;
  exitDate: string | null;
  exitPrice: number | null;
  profitLossPct: number | null;
  companyName: string | null;
  sector: string | null;
}

const SELECT_SIGNAL_COLS = `
  s.id, s.ticker, s.signal_date as signalDate, s.action,
  s.setup_type as setupType, s.order_type as orderType,
  s.entry_price as entryPrice, s.stop_loss as stopLoss,
  s.target_price_1 as targetPrice1, s.target_price as targetPrice,
  s.max_hold_days as maxHoldDays, s.sentiment_score as sentimentScore,
  s.fundamental_score as fundamentalScore, s.technical_score as technicalScore,
  s.overall_score as overallScore, s.analysis_summary as analysisSummary,
  s.news_summary as newsSummary, s.fundamental_summary as fundamentalSummary,
  s.technical_summary as technicalSummary, s.status,
  s.entry_hit_date as entryHitDate, s.tp1_hit_date as tp1HitDate,
  s.exit_date as exitDate, s.exit_price as exitPrice, s.profit_loss_pct as profitLossPct,
  f.company_name as companyName, f.sector as sector
`;

function mapSignalRow(row: SignalRow, currentPrice?: number): SignalRecord {
  const daysHeld = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(`${row.signalDate}T00:00:00Z`)) / 86400000)
  );
  const riskPercent =
    row.entryPrice > 0 ? ((row.entryPrice - row.stopLoss) / row.entryPrice) * 100 : 0;
  const rewardPercent =
    row.entryPrice > 0 ? ((row.targetPrice - row.entryPrice) / row.entryPrice) * 100 : 0;
  const riskRewardRatio = riskPercent > 0 ? rewardPercent / riskPercent : 0;
  const unrealizedPnlPct =
    row.status === "entry_hit" && currentPrice !== undefined && row.entryPrice > 0
      ? Number((((currentPrice - row.entryPrice) / row.entryPrice) * 100).toFixed(2))
      : null;

  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.companyName ?? row.ticker,
    sector: row.sector ?? null,
    signalDate: row.signalDate,
    action: row.action,
    setupType: row.setupType,
    orderType: row.orderType,
    entryPrice: row.entryPrice,
    stopLoss: row.stopLoss,
    targetPrice1: row.targetPrice1,
    targetPrice: row.targetPrice,
    currentPrice: currentPrice ?? row.exitPrice ?? null,
    maxHoldDays: row.maxHoldDays,
    sentimentScore: row.sentimentScore,
    fundamentalScore: row.fundamentalScore,
    technicalScore: row.technicalScore,
    overallScore: row.overallScore,
    analysisSummary: row.analysisSummary,
    newsSummary: row.newsSummary,
    fundamentalSummary: row.fundamentalSummary,
    technicalSummary: row.technicalSummary,
    status: row.status,
    entryHitDate: row.entryHitDate,
    tp1HitDate: row.tp1HitDate,
    exitDate: row.exitDate,
    exitPrice: row.exitPrice,
    profitLossPct: row.profitLossPct,
    unrealizedPnlPct,
    daysHeld,
    riskPercent: Number(riskPercent.toFixed(2)),
    rewardPercent: Number(rewardPercent.toFixed(2)),
    riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
  };
}

export function upsertSignal(input: SignalInsertInput): SignalRecord {
  const db = getDb();
  const cleanTicker = normalizeTicker(input.ticker);
  db.prepare(`
    INSERT INTO signals (
      ticker, signal_date, action, setup_type, order_type,
      entry_price, stop_loss, target_price_1, target_price, max_hold_days,
      sentiment_score, fundamental_score, technical_score, overall_score,
      analysis_summary, news_summary, fundamental_summary, technical_summary
    ) VALUES (
      $ticker, $signalDate, $action, $setupType, $orderType,
      $entryPrice, $stopLoss, $targetPrice1, $targetPrice, $maxHoldDays,
      $sentimentScore, $fundamentalScore, $technicalScore, $overallScore,
      $analysisSummary, $newsSummary, $fundamentalSummary, $technicalSummary
    )
    ON CONFLICT(ticker, signal_date) DO UPDATE SET
      action = excluded.action, setup_type = excluded.setup_type, order_type = excluded.order_type,
      entry_price = excluded.entry_price, stop_loss = excluded.stop_loss,
      target_price_1 = excluded.target_price_1, target_price = excluded.target_price,
      max_hold_days = excluded.max_hold_days, sentiment_score = excluded.sentiment_score,
      fundamental_score = excluded.fundamental_score, technical_score = excluded.technical_score,
      overall_score = excluded.overall_score, analysis_summary = excluded.analysis_summary,
      news_summary = excluded.news_summary, fundamental_summary = excluded.fundamental_summary,
      technical_summary = excluded.technical_summary
  `).run({
    $ticker: cleanTicker,
    $signalDate: input.signalDate,
    $action: input.action,
    $setupType: input.setupType,
    $orderType: input.orderType,
    $entryPrice: input.entryPrice,
    $stopLoss: input.stopLoss,
    $targetPrice1: input.targetPrice1,
    $targetPrice: input.targetPrice,
    $maxHoldDays: input.maxHoldDays,
    $sentimentScore: input.sentimentScore,
    $fundamentalScore: input.fundamentalScore,
    $technicalScore: input.technicalScore,
    $overallScore: input.overallScore,
    $analysisSummary: input.analysisSummary,
    $newsSummary: input.newsSummary,
    $fundamentalSummary: input.fundamentalSummary,
    $technicalSummary: input.technicalSummary,
  });

  const row = db
    .prepare(
      `SELECT ${SELECT_SIGNAL_COLS} FROM signals s LEFT JOIN fundamentals f ON s.ticker = f.ticker WHERE s.ticker = $ticker AND s.signal_date = $date LIMIT 1`
    )
    .get({ $ticker: cleanTicker, $date: input.signalDate }) as SignalRow;

  return mapSignalRow(row);
}

export function getSignalsByDate(date: string = wibDateString()): SignalRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_SIGNAL_COLS} FROM signals s LEFT JOIN fundamentals f ON s.ticker = f.ticker WHERE s.signal_date = $date ORDER BY s.overall_score DESC`
    )
    .all({ $date: date }) as SignalRow[];
  return rows.map((r) => mapSignalRow(r));
}

export function getActiveSignals(priceMap?: Map<string, number>): SignalRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_SIGNAL_COLS} FROM signals s LEFT JOIN fundamentals f ON s.ticker = f.ticker WHERE s.status IN ('pending', 'entry_hit') ORDER BY s.signal_date DESC, s.overall_score DESC`
    )
    .all() as SignalRow[];
  return rows.map((r) => mapSignalRow(r, priceMap?.get(r.ticker)));
}

export function getActiveTickers(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT ticker FROM signals WHERE status IN ('pending', 'entry_hit')")
    .all() as Array<{ ticker: string }>;
  return rows.map((r) => r.ticker);
}

export function updateSignalStatus(
  id: number,
  status: SignalStatus,
  exitPrice?: number,
  profitLossPct?: number,
  today = wibDateString()
): void {
  const db = getDb();
  if (status === "entry_hit") {
    db.prepare(
      "UPDATE signals SET status = $status, entry_hit_date = COALESCE(entry_hit_date, $date) WHERE id = $id"
    ).run({ $id: id, $status: status, $date: today });
    return;
  }
  if (
    status === "target_hit" ||
    status === "sl_hit" ||
    status === "expired" ||
    status === "cancelled"
  ) {
    db.prepare(
      "UPDATE signals SET status = $status, exit_date = $date, exit_price = $exitPrice, profit_loss_pct = $pnl WHERE id = $id"
    ).run({
      $id: id,
      $status: status,
      $date: today,
      $exitPrice: exitPrice ?? null,
      $pnl: profitLossPct ?? null,
    });
  }
}

export function updateSignalStopLoss(id: number, stopLoss: number): void {
  getDb()
    .prepare("UPDATE signals SET stop_loss = $sl WHERE id = $id")
    .run({ $id: id, $sl: stopLoss });
}

export function markSignalTp1Hit(id: number, breakevenSl: number, today = wibDateString()): void {
  getDb()
    .prepare(`
      UPDATE signals
      SET tp1_hit_date = COALESCE(tp1_hit_date, $date),
          stop_loss = MAX(stop_loss, $sl)
      WHERE id = $id
    `)
    .run({ $id: id, $date: today, $sl: breakevenSl });
}

export function getSignalHistory(params: {
  page: number;
  pageSize: number;
  ticker?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): { items: SignalRecord[]; total: number; stats: SignalStatsSummary } {
  const db = getDb();
  let where = " WHERE 1=1";
  const q: Record<string, string | number> = {};
  if (params.ticker) {
    where += " AND s.ticker = $ticker";
    q.$ticker = normalizeTicker(params.ticker);
  }
  if (params.status) {
    where += " AND s.status = $status";
    q.$status = params.status;
  }
  if (params.startDate) {
    where += " AND s.signal_date >= $startDate";
    q.$startDate = params.startDate;
  }
  if (params.endDate) {
    where += " AND s.signal_date <= $endDate";
    q.$endDate = params.endDate;
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM signals s ${where}`)
    .get(q) as { total: number };
  const rows = db
    .prepare(
      `SELECT ${SELECT_SIGNAL_COLS} FROM signals s LEFT JOIN fundamentals f ON s.ticker = f.ticker ${where} ORDER BY s.signal_date DESC, s.overall_score DESC LIMIT $limit OFFSET $offset`
    )
    .all({
      ...q,
      $limit: params.pageSize,
      $offset: (params.page - 1) * params.pageSize,
    }) as SignalRow[];

  return {
    items: rows.map((r) => mapSignalRow(r)),
    total: countRow.total,
    stats: computeSignalStats(params.startDate, params.endDate),
  };
}

export function computeSignalStats(startDate?: string, endDate?: string): SignalStatsSummary {
  const db = getDb();
  const active = db
    .prepare("SELECT status FROM signals WHERE status IN ('pending', 'entry_hit')")
    .all() as Array<{ status: string }>;
  const today = wibDateString();
  const closedTodayRow = db
    .prepare(
      "SELECT COUNT(*) as c FROM signals WHERE exit_date = $today AND status IN ('target_hit', 'sl_hit', 'expired')"
    )
    .get({ $today: today }) as { c: number };

  let dateFilter = "";
  const qp: Record<string, string> = {};
  if (startDate) {
    dateFilter += " AND signal_date >= $startDate";
    qp.$startDate = startDate;
  }
  if (endDate) {
    dateFilter += " AND signal_date <= $endDate";
    qp.$endDate = endDate;
  }

  const closedEntered = db
    .prepare(
      `SELECT ticker, profit_loss_pct as pnl FROM signals WHERE status IN ('target_hit', 'sl_hit', 'expired') AND entry_hit_date IS NOT NULL AND profit_loss_pct IS NOT NULL ${dateFilter}`
    )
    .all(qp) as Array<{ ticker: string; pnl: number }>;

  let winRate: number | null = null;
  let avgReturn: number | null = null;
  let bestPick: { ticker: string; returnPct: number } | null = null;
  let worstPick: { ticker: string; returnPct: number } | null = null;

  if (closedEntered.length > 0) {
    const wins = closedEntered.filter((r) => r.pnl > 0).length;
    winRate = Number(((wins / closedEntered.length) * 100).toFixed(1));
    avgReturn = Number(
      (closedEntered.reduce((s, r) => s + r.pnl, 0) / closedEntered.length).toFixed(2)
    );
    const sorted = [...closedEntered].sort((a, b) => b.pnl - a.pnl);
    bestPick = { ticker: sorted[0]!.ticker, returnPct: sorted[0]!.pnl };
    worstPick = {
      ticker: sorted[sorted.length - 1]!.ticker,
      returnPct: sorted[sorted.length - 1]!.pnl,
    };
  }

  return {
    totalActive: active.length,
    pending: active.filter((r) => r.status === "pending").length,
    entryHit: active.filter((r) => r.status === "entry_hit").length,
    closedToday: closedTodayRow.c,
    totalClosed: closedEntered.length,
    winRate,
    avgReturn,
    bestPick,
    worstPick,
  };
}

export function getSignalsForBacktest(
  startDate: string,
  endDate: string,
  ticker?: string
): SignalRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_SIGNAL_COLS} FROM signals s LEFT JOIN fundamentals f ON s.ticker = f.ticker WHERE s.signal_date >= $startDate AND s.signal_date <= $endDate AND s.action = 'BUY' AND ($ticker IS NULL OR s.ticker = $ticker) ORDER BY s.signal_date ASC, s.id ASC`
    )
    .all({
      $startDate: startDate,
      $endDate: endDate,
      $ticker: ticker ? normalizeTicker(ticker) : null,
    }) as SignalRow[];
  return rows.map((r) => mapSignalRow(r));
}

export function clearSkippedSignals(): void {
  getDb().prepare("DELETE FROM skipped_signals").run();
}

export function upsertSkippedSignal(item: Omit<SkippedSignalRecord, "updatedAt">): void {
  getDb()
    .prepare(`
      INSERT INTO skipped_signals (ticker, company_name, sector, current_price, entry_price, stop_loss, target_price, overall_score, guardrail_reason, summary)
      VALUES ($ticker, $companyName, $sector, $currentPrice, $entryPrice, $stopLoss, $targetPrice, $overallScore, $guardrailReason, $summary)
      ON CONFLICT(ticker) DO UPDATE SET
        company_name = excluded.company_name, sector = excluded.sector, current_price = excluded.current_price,
        entry_price = excluded.entry_price, stop_loss = excluded.stop_loss, target_price = excluded.target_price,
        overall_score = excluded.overall_score, guardrail_reason = excluded.guardrail_reason,
        summary = excluded.summary, updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      $ticker: normalizeTicker(item.ticker),
      $companyName: item.companyName,
      $sector: item.sector,
      $currentPrice: item.currentPrice,
      $entryPrice: item.entryPrice,
      $stopLoss: item.stopLoss,
      $targetPrice: item.targetPrice,
      $overallScore: item.overallScore,
      $guardrailReason: item.guardrailReason,
      $summary: item.summary,
    });
}

export function getSkippedSignals(): SkippedSignalRecord[] {
  return getDb()
    .prepare(`
      SELECT ticker, company_name as companyName, sector, current_price as currentPrice,
        entry_price as entryPrice, stop_loss as stopLoss, target_price as targetPrice,
        overall_score as overallScore, guardrail_reason as guardrailReason,
        summary, updated_at as updatedAt
      FROM skipped_signals ORDER BY overall_score DESC
    `)
    .all() as SkippedSignalRecord[];
}

// ============================================================================
// News Articles, Mentions, Job Runs & Telegram Subscribers
// ============================================================================

export interface StoredNewsArticle {
  id: number;
  url: string;
  title: string;
  content: string | null;
  portal: string;
  publishedAt: string | null;
  crawledAt: string;
  contentHash: string;
}

export function isNewsDuplicate(url: string, contentHash: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM news_articles WHERE url = $url OR content_hash = $hash LIMIT 1")
    .get({ $url: url, $hash: contentHash });
  return row !== null;
}

export function insertNewsArticle(article: {
  url: string;
  title: string;
  content: string | null;
  portal: string;
  publishedAt: Date | null;
  contentHash: string;
}): number | null {
  const res = getDb()
    .prepare(`
      INSERT OR IGNORE INTO news_articles (url, title, content, portal, published_at, content_hash)
      VALUES ($url, $title, $content, $portal, $publishedAt, $hash)
    `)
    .run({
      $url: article.url,
      $title: article.title,
      $content: article.content,
      $portal: article.portal,
      $publishedAt: article.publishedAt?.toISOString() ?? null,
      $hash: article.contentHash,
    });
  return res.changes > 0 ? Number(res.lastInsertRowid) : null;
}

export function getRecentNewsArticles(days = 3): StoredNewsArticle[] {
  return getDb()
    .prepare(`
      SELECT id, url, title, content, portal, published_at as publishedAt,
             crawled_at as crawledAt, content_hash as contentHash
      FROM news_articles
      WHERE crawled_at >= datetime('now', $days)
      ORDER BY COALESCE(published_at, crawled_at) DESC
    `)
    .all({ $days: `-${days} days` }) as StoredNewsArticle[];
}

export function insertNewsMentions(
  mentions: Array<{ articleId: number; ticker: string; sentiment: number; relevance: number }>
): void {
  if (mentions.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO news_mentions (article_id, ticker, sentiment, relevance)
    VALUES ($articleId, $ticker, $sentiment, $relevance)
  `);
  db.transaction(() => {
    for (const m of mentions) {
      stmt.run({
        $articleId: m.articleId,
        $ticker: normalizeTicker(m.ticker),
        $sentiment: m.sentiment,
        $relevance: m.relevance,
      });
    }
  })();
}

export function getMentionSentiment(articleId: number, ticker: string): number | null {
  const row = getDb()
    .prepare("SELECT sentiment FROM news_mentions WHERE article_id = $aid AND ticker = $t LIMIT 1")
    .get({ $aid: articleId, $t: normalizeTicker(ticker) }) as { sentiment: number } | null;
  return row ? row.sentiment : null;
}

export function startJobRun(
  schedule: "morning" | "evening",
  runDate = wibDateString()
): number {
  const db = getDb();
  db.prepare(`
    INSERT INTO job_runs (schedule, run_date, status)
    VALUES ($schedule, $runDate, 'running')
    ON CONFLICT(schedule, run_date) DO UPDATE SET
      status = 'running', started_at = CURRENT_TIMESTAMP, completed_at = NULL, error_msg = NULL
  `).run({ $schedule: schedule, $runDate: runDate });

  const row = db
    .prepare("SELECT id FROM job_runs WHERE schedule = $schedule AND run_date = $runDate LIMIT 1")
    .get({ $schedule: schedule, $runDate: runDate }) as { id: number };
  return row.id;
}

export function completeJobRun(
  id: number,
  stats: { articles: number; tickers: number; signals: number }
): void {
  getDb()
    .prepare(`
      UPDATE job_runs
      SET status = 'completed', articles_count = $a, tickers_count = $t, signals_count = $s, completed_at = CURRENT_TIMESTAMP
      WHERE id = $id
    `)
    .run({ $id: id, $a: stats.articles, $t: stats.tickers, $s: stats.signals });
}

export function failJobRun(id: number, errorMsg: string): void {
  getDb()
    .prepare(
      "UPDATE job_runs SET status = 'failed', error_msg = $err, completed_at = CURRENT_TIMESTAMP WHERE id = $id"
    )
    .run({ $id: id, $err: errorMsg });
}

export function hasJobRunToday(schedule: "morning" | "evening"): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 FROM job_runs WHERE schedule = $s AND run_date = $d AND status = 'completed' LIMIT 1"
    )
    .get({ $s: schedule, $d: wibDateString() });
  return row !== null;
}

export function upsertTelegramUser(user: {
  chatId: number;
  username?: string;
  firstName?: string;
  isActive?: boolean;
}): void {
  getDb()
    .prepare(`
      INSERT INTO telegram_users (chat_id, username, first_name, is_active)
      VALUES ($cid, $uname, $fname, $active)
      ON CONFLICT(chat_id) DO UPDATE SET
        username = excluded.username, first_name = excluded.first_name,
        is_active = excluded.is_active, updated_at = CURRENT_TIMESTAMP
    `)
    .run({
      $cid: user.chatId,
      $uname: user.username ?? null,
      $fname: user.firstName ?? null,
      $active: user.isActive === false ? 0 : 1,
    });
}

export function getActiveTelegramChatIds(): number[] {
  const rows = getDb()
    .prepare("SELECT chat_id as chatId FROM telegram_users WHERE is_active = 1")
    .all() as Array<{ chatId: number }>;
  return rows.map((r) => r.chatId);
}
