/**
 * Canonical Domain Contracts Shared Across Backend Engine & React Trading Studio
 */

export type SetupType =
  | "BREAKOUT"
  | "PULLBACK"
  | "CONTRARIAN_BOUNCE"
  | "SILENT_ACCUMULATION"
  | "NONE";

export type SignalAction = "BUY" | "WAIT" | "HOLD" | "AVOID";
export type SignalStatus =
  | "pending"
  | "entry_hit"
  | "target_hit"
  | "sl_hit"
  | "expired"
  | "cancelled";
export type OrderType = "LIMIT" | "MARKET";
export type TrendState = "BULLISH" | "BEARISH" | "SIDEWAYS";
export type MacroRegime = "RISK_ON" | "NEUTRAL" | "CAUTIOUS" | "RISK_OFF";
export type FlowStatus = "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
export type RelativeStrengthStatus = "OUTPERFORMING" | "INLINE" | "LAGGING";

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjustedClose: number;
}

export interface MacdSnapshot {
  macd: number;
  signal: number;
  histogram: number;
  trend: "BULLISH_CROSS" | "BEARISH_CROSS" | "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface BollingerSnapshot {
  upper: number;
  middle: number;
  lower: number;
  bandwidthPct: number;
  percentB: number;
  isSqueeze: boolean;
}

export interface StochRsiSnapshot {
  k: number;
  d: number;
  state: "OVERSOLD_CROSS" | "OVERBOUGHT_CROSS" | "OVERSOLD" | "OVERBOUGHT" | "NEUTRAL";
}

export interface TechnicalSnapshot {
  ticker: string;
  currentPrice: number;
  trend: TrendState;
  trendStrength: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  vwap20: number | null;
  priceToVwapPct: number | null;
  macd: MacdSnapshot | null;
  bollinger: BollingerSnapshot | null;
  stochRsi: StochRsiSnapshot | null;
  rsi14: number | null;
  atr14: number | null;
  volatilityPercent: number;
  high3Month: number;
  low3Month: number;
  high52Week: number;
  low52Week: number;
  supports: number[];
  resistances: number[];
  cmf20: number | null;
  obvTrend: "RISING" | "FALLING" | "FLAT";
  obvDivergence: "BULLISH_DIV" | "BEARISH_DIV" | "NONE";
  accumulationStatus: FlowStatus;
  volumeFlowRatio: number;
  volumeRatio: number;
  dailyTurnover: number;
  candlestickPattern: string;
  araLimit: number | null;
  arbLimit: number | null;
  rsDiff20dPct: number;
  rsRating: number;
  rsStatus: RelativeStrengthStatus;
}

export interface FundamentalSnapshot {
  ticker: string;
  companyName: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  peRatio: number | null;
  forwardPe: number | null;
  pbRatio: number | null;
  psRatio: number | null;
  pegRatio: number | null;
  roe: number | null;
  roa: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  dividendYield: number | null;
  totalRevenue: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  netIncome: number | null;
  financialCurrency: string | null;
}

export interface MacroContext {
  ihsgPrice: number | null;
  ihsgChangePct: number | null;
  ihsgTrend: TrendState;
  ihsgRsi14: number | null;
  ihsgSma20: number | null;
  ihsgSma50: number | null;
  ihsgReturn20dPct: number;
  usdIdrRate: number | null;
  usdIdrChange5dPct: number | null;
  regime: MacroRegime;
  regimeScore: number;
  summary: string;
  updatedAt: string;
}

export interface QuantBreakdown {
  technical: number;
  bandarmology: number;
  fundamental: number;
  composite: number;
}

export interface PositionSizingSummary {
  suggestedRiskPct: number;
  maxAllocationPct: number;
  lotsPer100M: number;
}

export interface SignalRecord {
  id: number;
  ticker: string;
  companyName: string;
  sector: string | null;
  signalDate: string;
  action: SignalAction;
  setupType: SetupType;
  orderType: OrderType;
  entryPrice: number;
  stopLoss: number;
  targetPrice1: number;
  targetPrice: number;
  currentPrice: number | null;
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
  unrealizedPnlPct: number | null;
  daysHeld: number;
  riskPercent: number;
  rewardPercent: number;
  riskRewardRatio: number;
}

export interface SkippedSignalRecord {
  ticker: string;
  companyName: string;
  sector: string | null;
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  overallScore: number;
  guardrailReason: string | null;
  summary: string;
  updatedAt: string;
}

export interface SignalStatsSummary {
  totalActive: number;
  pending: number;
  entryHit: number;
  closedToday: number;
  totalClosed: number;
  winRate: number | null;
  avgReturn: number | null;
  bestPick: { ticker: string; returnPct: number } | null;
  worstPick: { ticker: string; returnPct: number } | null;
}

export interface MarketOutlook {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  bullishSignals: string[];
  bearishSignals: string[];
  headlines: Array<{ title: string; sentiment: "positive" | "negative" | "neutral"; source: string }>;
  macro: MacroContext;
  generatedAt: string;
}

export interface DashboardPayload {
  date: string;
  todaySignals: SignalRecord[];
  activePositions: SignalRecord[];
  skippedSignals: SkippedSignalRecord[];
  stats: SignalStatsSummary;
  outlook: MarketOutlook;
  watchlist: string[];
  scheduler: {
    running: boolean;
    marketOpen: boolean;
    pipelineRunning: boolean;
  };
}

export interface ScreenerItem {
  ticker: string;
  companyName: string;
  sector: string | null;
  price: number;
  changePct: number;
  dailyTurnover: number;
  setupType: SetupType;
  quantScore: number;
  technicalScore: number;
  bandarmologyScore: number;
  fundamentalScore: number;
  trend: TrendState;
  rsi14: number | null;
  cmf20: number | null;
  obvDivergence: "BULLISH_DIV" | "BEARISH_DIV" | "NONE";
  volumeRatio: number;
  bollingerSqueeze: boolean;
  candlestickPattern: string;
  rsRating: number;
  rsStatus: RelativeStrengthStatus;
  entryPrice: number;
  stopLoss: number;
  targetPrice1: number;
  targetPrice: number;
  riskRewardRatio: number;
  isWatchlisted: boolean;
}

export interface ScreenerPayload {
  macro: MacroContext;
  items: ScreenerItem[];
  scannedCount: number;
  generatedAt: string;
  cached: boolean;
}

export interface TickerAnalysisPayload {
  ticker: string;
  companyName: string;
  sector: string | null;
  currentPrice: number;
  priceChange: number;
  priceChangePct: number;
  autoReject: { ara: number; arb: number; pct: number };
  fundamentals: FundamentalSnapshot | null;
  technical: TechnicalSnapshot;
  macro: MacroContext;
  recentBars: PriceBar[];
  relevantNews: Array<{ title: string; portal: string; sentiment: number; publishedAt: string | null }>;
  analysis: {
    action: SignalAction;
    confidence: number;
    entryPrice: number;
    stopLoss: number;
    targetPrice1: number;
    targetPrice: number;
    riskRewardRatio: number;
    maxHoldDays: number;
    orderType: OrderType;
    setupType: SetupType;
    overallScore: number;
    sentimentScore: number;
    fundamentalScore: number;
    technicalScore: number;
    quantScores: QuantBreakdown;
    positionSizing: PositionSizingSummary;
    analysisSummary: string;
    newsSummary: string;
    fundamentalSummary: string;
    technicalSummary: string;
    guardrailReason: string | null;
    mode: "HYBRID" | "QUANT_FALLBACK";
    modelUsed: string;
  } | null;
  cached: boolean;
  analyzedAt: string;
}

export interface HistoryPayload {
  items: SignalRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  stats: SignalStatsSummary;
}

export interface BacktestRequest {
  startDate: string;
  endDate: string;
  ticker?: string;
  feePct: number;
  slippagePct: number;
  trailingActivationPct: number;
  trailingDistancePct: number;
}

export interface BacktestTrade {
  ticker: string;
  signalDate: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  outcome: "target_hit" | "sl_hit" | "trailing_sl_hit" | "expired" | "unfilled";
  entryDate: string | null;
  exitDate: string | null;
  exitPrice: number | null;
  netReturnPct: number | null;
  holdingDays: number;
}

export interface BacktestMetrics {
  totalSignals: number;
  filledTrades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  avgReturnPct: number | null;
  totalReturnPct: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
}

export interface BacktestPayload {
  options: BacktestRequest;
  baseline: { metrics: BacktestMetrics; trades: BacktestTrade[] };
  trailing: { metrics: BacktestMetrics; trades: BacktestTrade[] };
  equityCurve: Array<{ date: string; baselineEquity: number; trailingEquity: number }>;
}

export interface AppSettings {
  scheduler: {
    enabled: boolean;
    morningHour: number;
    morningMinute: number;
    eveningHour: number;
    eveningMinute: number;
    nextRun: string | null;
  };
  recommendation: {
    minOverallScore: number;
    bearishMinOverallScore: number;
    minSentiment: number;
    minRiskRewardHighScore: number;
    minRiskRewardStandardScore: number;
    maxRecommendationsPerRun: number;
  };
  anomaly: {
    priceChangePct: number;
    volumeMultiplier: number;
  };
  models: {
    baseUrl: string;
    filterModel: string;
    decisionModel: string;
    configured: boolean;
  };
  runtime: {
    schedulerRunning: boolean;
    marketOpen: boolean;
    pipelineRunning: boolean;
    telegramConfigured: boolean;
  };
  watchlist: string[];
  adminProtected: boolean;
}

export interface PipelineLogEvent {
  timestamp: string;
  level: "step" | "info" | "success" | "warn" | "error";
  message: string;
  step?: number;
  totalSteps?: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  timestamp: string;
}
