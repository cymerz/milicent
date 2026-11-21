
/**
 * Quantitative Technical, Bandarmology Flow, Scoring & IDX80/LQ45 Screener Engine
 */

import {
  calculateDailyTurnover,
  getIdxAutoRejectionLimits,
  normalizeTicker,
} from "@protocol/idx-rules.ts";
import { roundToIdxTick } from "@protocol/idx-rules.ts";
import type {
  BollingerSnapshot,
  FlowStatus,
  FundamentalSnapshot,
  MacroContext,
  MacdSnapshot,
  PriceBar,
  QuantBreakdown,
  RelativeStrengthStatus,
  ScreenerItem,
  ScreenerPayload,
  SetupType,
  StochRsiSnapshot,
  TechnicalSnapshot,
  TrendState,
} from "@protocol/contracts.ts";
import { getCache, getFundamentalsMap, getWatchlist, setCache } from "./persistence.ts";
import { fetchPriceHistory, fetchQuotesBatch, getMacroContext } from "./market-gateway.ts";

// ============================================================================
// Core Technical Indicators & Swing Pivot Levels
// ============================================================================

export function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length < period || period <= 0) return [];
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const out = [ema];
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number | null {
  if (highs.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    const pc = closes[i - 1] ?? 0;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return calculateSMA(tr, period);
}

export function calculateRSI(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

export function calculateVWAP(
  bars: PriceBar[],
  period = 20
): { vwap: number | null; priceToVwapPct: number | null } {
  if (bars.length === 0) return { vwap: null, priceToVwapPct: null };
  const slice = bars.slice(-period);
  let tpVol = 0;
  let volSum = 0;

  for (const b of slice) {
    const tp = (b.high + b.low + b.close) / 3;
    tpVol += tp * b.volume;
    volSum += b.volume;
  }
  if (volSum <= 0) return { vwap: null, priceToVwapPct: null };

  const vwap = roundToIdxTick(tpVol / volSum, "nearest");
  const lastClose = slice[slice.length - 1]!.close;
  const priceToVwapPct = Number((((lastClose - vwap) / vwap) * 100).toFixed(2));
  return { vwap, priceToVwapPct };
}

export function calculateMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): MacdSnapshot | null {
  if (closes.length < slow + signal) return null;
  const fastEma = calculateEMASeries(closes, fast);
  const slowEma = calculateEMASeries(closes, slow);
  const offset = slow - fast;

  const macdLine = slowEma.map((s, i) => fastEma[i + offset]! - s);
  const sigLine = calculateEMASeries(macdLine, signal);
  if (sigLine.length === 0) return null;

  const currM = macdLine[macdLine.length - 1]!;
  const currS = sigLine[sigLine.length - 1]!;
  const prevM = macdLine[macdLine.length - 2] ?? currM;
  const prevS = sigLine[sigLine.length - 2] ?? currS;

  let trend: MacdSnapshot["trend"] = "NEUTRAL";
  if (currM > currS && prevM <= prevS) trend = "BULLISH_CROSS";
  else if (currM < currS && prevM >= prevS) trend = "BEARISH_CROSS";
  else if (currM > currS) trend = "BULLISH";
  else if (currM < currS) trend = "BEARISH";

  return {
    macd: Number(currM.toFixed(2)),
    signal: Number(currS.toFixed(2)),
    histogram: Number((currM - currS).toFixed(2)),
    trend,
  };
}

export function detectTrend(
  closes: number[],
  sma20: number | null,
  sma50: number | null
): { trend: TrendState; trendStrength: number } {
  if (closes.length < 20) return { trend: "SIDEWAYS", trendStrength: 50 };
  const curr = closes[closes.length - 1] ?? 0;
  const prev20 = closes[closes.length - 20] ?? curr;
  const pct = prev20 > 0 ? ((curr - prev20) / prev20) * 100 : 0;

  let trend: TrendState = "SIDEWAYS";
  let strength = 50;
  if (pct > 5) {
    trend = "BULLISH";
    strength = Math.min(50 + pct * 2, 100);
  } else if (pct < -5) {
    trend = "BEARISH";
    strength = Math.min(50 + Math.abs(pct) * 2, 100);
  }

  if (sma20 && sma50 && curr > sma20 && sma20 > sma50) {
    trend = "BULLISH";
    strength = Math.min(strength + 10, 100);
  } else if (sma20 && sma50 && curr < sma20 && sma20 < sma50) {
    trend = "BEARISH";
    strength = Math.min(strength + 10, 100);
  }
  return { trend, trendStrength: Math.round(strength) };
}

function clusterLevels(levels: number[], dir: "asc" | "desc"): number[] {
  const sorted = [...levels].sort((a, b) => (dir === "asc" ? a - b : b - a));
  const out: number[] = [];
  for (const lvl of sorted) {
    const rounded = roundToIdxTick(lvl, dir === "asc" ? "ceil" : "floor");
    if (rounded > 0 && !out.some((c) => Math.abs(c - rounded) / rounded <= 0.015)) {
      out.push(rounded);
    }
  }
  return out;
}

export function findSwingPivotSupports(bars: PriceBar[], currentPrice: number): number[] {
  if (bars.length < 5) {
    const lows = bars.map((b) => b.low).filter((l) => l < currentPrice);
    return lows.length > 0 ? [roundToIdxTick(Math.min(...lows), "floor")] : [];
  }

  const pivots: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const cand = bars[i]!.low;
    let ok = true;
    for (let j = i - 2; j <= i + 2; j++) {
      if (j !== i && bars[j]!.low < cand) {
        ok = false;
        break;
      }
    }
    if (ok && cand < currentPrice) pivots.push(cand);
  }

  const highestMajor = pivots.length > 0 ? Math.max(...pivots) : 0;
  if (highestMajor < currentPrice * 0.965) {
    const pullback = bars
      .slice(-5)
      .map((b) => b.low)
      .filter((l) => l <= currentPrice * 0.988 && l >= currentPrice * 0.95);
    if (pullback.length > 0) pivots.push(Math.max(...pullback));
  }

  if (pivots.length === 0) {
    const below = bars.map((b) => b.low).filter((l) => l < currentPrice);
    if (below.length > 0) pivots.push(Math.min(...below));
  }

  return clusterLevels(pivots, "desc").slice(0, 3);
}

export function findSwingPivotResistances(bars: PriceBar[], currentPrice: number): number[] {
  if (bars.length < 5) {
    const highs = bars.map((b) => b.high).filter((h) => h > currentPrice);
    return highs.length > 0 ? [roundToIdxTick(Math.max(...highs), "ceil")] : [];
  }

  const pivots: number[] = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const cand = bars[i]!.high;
    let ok = true;
    for (let j = i - 2; j <= i + 2; j++) {
      if (j !== i && bars[j]!.high > cand) {
        ok = false;
        break;
      }
    }
    if (ok && cand > currentPrice) pivots.push(cand);
  }

  if (pivots.length === 0) {
    const above = bars.map((b) => b.high).filter((h) => h > currentPrice);
    if (above.length > 0) pivots.push(Math.max(...above));
  }

  return clusterLevels(pivots, "asc").slice(0, 3);
}

// ============================================================================
// Bandarmology Flow, Bollinger Squeeze, StochRSI & Candlesticks
// ============================================================================

export function calculateAccumulationFlow(bars: PriceBar[]): {
  status: FlowStatus;
  flowRatio: number;
} {
  if (bars.length < 5) return { status: "NEUTRAL", flowRatio: 1.0 };
  const recent = bars.slice(-5);
  let upVol = 0;
  let downVol = 0;

  for (let i = 0; i < recent.length; i++) {
    const bar = recent[i]!;
    const prevClose = i > 0 ? recent[i - 1]!.close : bar.open;
    if (bar.close > prevClose) upVol += bar.volume;
    else if (bar.close < prevClose) downVol += bar.volume;
  }

  const flowRatio =
    downVol > 0 ? Number((upVol / downVol).toFixed(2)) : upVol > 0 ? 3.0 : 1.0;
  const status: FlowStatus =
    flowRatio >= 1.25 ? "ACCUMULATION" : flowRatio <= 0.8 ? "DISTRIBUTION" : "NEUTRAL";
  return { status, flowRatio };
}

export function calculateChaikinMoneyFlow(bars: PriceBar[], period = 20): number | null {
  if (bars.length < Math.min(period, 5) || period <= 0) return null;
  const slice = bars.slice(-period);
  let mfv = 0;
  let vol = 0;

  for (const b of slice) {
    const range = b.high - b.low;
    const mult = range > 0 ? (b.close - b.low - (b.high - b.close)) / range : 0;
    mfv += mult * b.volume;
    vol += b.volume;
  }
  return vol > 0 ? Number((mfv / vol).toFixed(3)) : null;
}

export function calculateOBVAnalysis(
  bars: PriceBar[],
  lookback = 20
): { trend: "RISING" | "FALLING" | "FLAT"; divergence: "BULLISH_DIV" | "BEARISH_DIV" | "NONE" } {
  if (bars.length < 10) return { trend: "FLAT", divergence: "NONE" };

  const obv: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const curr = bars[i]!;
    const prevObv = obv[i - 1]!;
    obv.push(
      curr.close > prev.close
        ? prevObv + curr.volume
        : curr.close < prev.close
          ? prevObv - curr.volume
          : prevObv
    );
  }

  const recentWin = obv.slice(-Math.min(lookback, obv.length));
  const mean20 = recentWin.reduce((s, v) => s + v, 0) / recentWin.length;
  const recent5 = obv.slice(-5);
  const mean5 = recent5.reduce((s, v) => s + v, 0) / recent5.length;
  const last = obv[obv.length - 1]!;

  let trend: "RISING" | "FALLING" | "FLAT" = "FLAT";
  if (mean5 > mean20 && last >= mean5 * 0.99) trend = "RISING";
  else if (mean5 < mean20 && last <= mean5 * 1.01) trend = "FALLING";

  let divergence: "BULLISH_DIV" | "BEARISH_DIV" | "NONE" = "NONE";
  if (bars.length >= 11) {
    const baseIdx = bars.length - 11;
    const baseClose = bars[baseIdx]!.close;
    const lastClose = bars[bars.length - 1]!.close;
    const pricePct = baseClose > 0 ? ((lastClose - baseClose) / baseClose) * 100 : 0;
    const obvDelta = last - obv[baseIdx]!;
    if (pricePct <= -2 && obvDelta > 0) divergence = "BULLISH_DIV";
    else if (pricePct >= 2 && obvDelta < 0) divergence = "BEARISH_DIV";
  }

  return { trend, divergence };
}

export function calculateBollingerBands(
  closes: number[],
  period = 20,
  mult = 2
): BollingerSnapshot | null {
  if (closes.length < period || period <= 0) return null;

  const bandAt = (endIdx: number) => {
    const win = closes.slice(endIdx - period + 1, endIdx + 1);
    const mean = win.reduce((s, v) => s + v, 0) / period;
    const std = Math.sqrt(win.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / period);
    const upper = mean + mult * std;
    const lower = mean - mult * std;
    const bw = mean > 0 ? ((upper - lower) / mean) * 100 : 0;
    return { upper, middle: mean, lower, bw };
  };

  const curr = bandAt(closes.length - 1);
  if (curr.middle <= 0) return null;

  const last = closes[closes.length - 1]!;
  const span = curr.upper - curr.lower;
  const percentB = span > 0 ? Number(((last - curr.lower) / span).toFixed(2)) : 0.5;

  let minBw = curr.bw;
  for (let i = Math.max(period - 1, closes.length - 60); i < closes.length; i++) {
    const b = bandAt(i).bw;
    if (b < minBw) minBw = b;
  }

  return {
    upper: Number(curr.upper.toFixed(2)),
    middle: Number(curr.middle.toFixed(2)),
    lower: Number(curr.lower.toFixed(2)),
    bandwidthPct: Number(curr.bw.toFixed(2)),
    percentB,
    isSqueeze: curr.bw < 6.0 || (minBw > 0 && curr.bw <= minBw * 1.15),
  };
}

export function calculateStochRSI(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3
): StochRsiSnapshot | null {
  if (closes.length < rsiPeriod + stochPeriod + smoothK + smoothD) return null;

  const rsiSeries: number[] = [];
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= rsiPeriod; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let ag = gains / rsiPeriod;
  let al = losses / rsiPeriod;
  rsiSeries.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));

  for (let i = rsiPeriod + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    ag = (ag * (rsiPeriod - 1) + (diff >= 0 ? diff : 0)) / rsiPeriod;
    al = (al * (rsiPeriod - 1) + (diff < 0 ? Math.abs(diff) : 0)) / rsiPeriod;
    rsiSeries.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }

  const rawStoch: number[] = [];
  for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
    const w = rsiSeries.slice(i - stochPeriod + 1, i + 1);
    const lo = Math.min(...w);
    const hi = Math.max(...w);
    rawStoch.push(hi > lo ? ((rsiSeries[i]! - lo) / (hi - lo)) * 100 : 50);
  }

  const sma = (arr: number[], p: number) =>
    arr.slice(p - 1).map((_, idx) => arr.slice(idx, idx + p).reduce((s, v) => s + v, 0) / p);

  const kArr = sma(rawStoch, smoothK);
  const dArr = sma(kArr, smoothD);
  if (kArr.length < 2 || dArr.length < 2) return null;

  const k = kArr[kArr.length - 1]!;
  const d = dArr[dArr.length - 1]!;
  const pk = kArr[kArr.length - 2]!;
  const pd = dArr[dArr.length - 2]!;

  let state: StochRsiSnapshot["state"] = "NEUTRAL";
  if (k > d && pk <= pd && k < 35) state = "OVERSOLD_CROSS";
  else if (k < d && pk >= pd && k > 70) state = "OVERBOUGHT_CROSS";
  else if (k < 25) state = "OVERSOLD";
  else if (k > 80) state = "OVERBOUGHT";

  return { k: Number(k.toFixed(1)), d: Number(d.toFixed(1)), state };
}

export function detectCandlestickPattern(bars: PriceBar[]): string {
  if (bars.length < 2) return "NONE";
  const curr = bars[bars.length - 1]!;
  const prev = bars[bars.length - 2]!;
  const range = curr.high - curr.low;
  if (range <= 0) return "NONE";

  const body = Math.abs(curr.close - curr.open);
  const upper = curr.high - Math.max(curr.open, curr.close);
  const lower = Math.min(curr.open, curr.close) - curr.low;
  const isBull = curr.close > curr.open;
  const prevBody = Math.abs(prev.close - prev.open);
  const prevBull = prev.close > prev.open;

  if (bars.length >= 3) {
    const first = bars[bars.length - 3]!;
    if (
      first.close < first.open &&
      Math.abs(first.close - first.open) > (first.high - first.low) * 0.4 &&
      prevBody <= (prev.high - prev.low) * 0.35 &&
      isBull &&
      curr.close > (first.open + first.close) / 2
    ) {
      return "MORNING_STAR";
    }
  }
  if (
    isBull &&
    !prevBull &&
    prevBody > 0 &&
    curr.open <= prev.close &&
    curr.close >= prev.open &&
    body > prevBody
  ) {
    return "BULLISH_ENGULFING";
  }
  if (
    !isBull &&
    prevBull &&
    prevBody > 0 &&
    curr.open >= prev.close &&
    curr.close <= prev.open &&
    body > prevBody
  ) {
    return "BEARISH_ENGULFING";
  }
  if (
    lower >= body * 2 &&
    upper <= body * 0.6 &&
    body / range <= 0.35 &&
    (isBull || curr.close >= curr.low + range * 0.6)
  ) {
    return "HAMMER_PINBAR";
  }
  if (
    upper >= body * 2 &&
    lower <= body * 0.6 &&
    body / range <= 0.35 &&
    (!isBull || curr.close <= curr.high - range * 0.6)
  ) {
    return "SHOOTING_STAR";
  }
  if (isBull && body / range >= 0.78 && curr.high - curr.close <= range * 0.1) {
    return "BREAKOUT_MARUBOZU";
  }
  if (body / range <= 0.1) return "DOJI_INDECISION";
  return "NONE";
}

export function computeRelativeStrength(
  bars: PriceBar[],
  ihsgReturn20dPct: number
): { diffPct: number; rating: number; status: RelativeStrengthStatus } {
  if (bars.length < 21) {
    return { diffPct: 0, rating: 50, status: "INLINE" };
  }
  const curr = bars[bars.length - 1]!.close;
  const prev20 = bars[bars.length - 21]!.close;
  const stockRet = prev20 > 0 ? ((curr - prev20) / prev20) * 100 : 0;
  const diffPct = Number((stockRet - ihsgReturn20dPct).toFixed(2));
  const rating = Math.max(1, Math.min(99, Math.round(50 + diffPct * 2.5)));
  const status: RelativeStrengthStatus =
    diffPct >= 2.5 ? "OUTPERFORMING" : diffPct <= -2.5 ? "LAGGING" : "INLINE";
  return { diffPct, rating, status };
}

export function buildTechnicalSnapshot(
  ticker: string,
  history: PriceBar[],
  currentPrice: number,
  ihsgReturn20dPct = 0
): TechnicalSnapshot {
  const cleanTicker = normalizeTicker(ticker);
  if (history.length === 0) {
    return {
      ticker: cleanTicker,
      currentPrice,
      trend: "SIDEWAYS",
      trendStrength: 50,
      sma20: null,
      sma50: null,
      sma200: null,
      ema20: null,
      ema50: null,
      vwap20: null,
      priceToVwapPct: null,
      macd: null,
      bollinger: null,
      stochRsi: null,
      rsi14: null,
      atr14: null,
      volatilityPercent: 0,
      high3Month: currentPrice,
      low3Month: currentPrice,
      high52Week: currentPrice,
      low52Week: currentPrice,
      supports: [],
      resistances: [],
      cmf20: null,
      obvTrend: "FLAT",
      obvDivergence: "NONE",
      accumulationStatus: "NEUTRAL",
      volumeFlowRatio: 1,
      volumeRatio: 1,
      dailyTurnover: 0,
      candlestickPattern: "NONE",
      araLimit: null,
      arbLimit: null,
      rsDiff20dPct: 0,
      rsRating: 50,
      rsStatus: "INLINE",
    };
  }

  const closes = history.map((b) => b.close);
  const highs = history.map((b) => b.high);
  const lows = history.map((b) => b.low);
  const vols = history.map((b) => b.volume);

  const recent3m = history.slice(-63);
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);
  const ema20Arr = calculateEMASeries(closes, 20);
  const ema50Arr = calculateEMASeries(closes, 50);

  const { trend, trendStrength } = detectTrend(closes, sma20, sma50);
  const { vwap, priceToVwapPct } = calculateVWAP(history, 20);
  const atr14 = calculateATR(highs, lows, closes, 14);
  const avgVol20 = calculateSMA(vols, 20) ?? 0;
  const lastVol = vols[vols.length - 1] ?? 0;

  const { status: accumulationStatus, flowRatio: volumeFlowRatio } =
    calculateAccumulationFlow(history);
  const obv = calculateOBVAnalysis(history, 20);
  const rs = computeRelativeStrength(history, ihsgReturn20dPct);
  const prevClose = history.length >= 2 ? history[history.length - 2]!.close : currentPrice;
  const { ara, arb } = getIdxAutoRejectionLimits(prevClose);

  return {
    ticker: cleanTicker,
    currentPrice,
    trend,
    trendStrength,
    sma20: sma20 ? Number(sma20.toFixed(0)) : null,
    sma50: sma50 ? Number(sma50.toFixed(0)) : null,
    sma200: sma200 ? Number(sma200.toFixed(0)) : null,
    ema20: ema20Arr.length > 0 ? Number(ema20Arr[ema20Arr.length - 1]!.toFixed(0)) : null,
    ema50: ema50Arr.length > 0 ? Number(ema50Arr[ema50Arr.length - 1]!.toFixed(0)) : null,
    vwap20: vwap,
    priceToVwapPct,
    macd: calculateMACD(closes),
    bollinger: calculateBollingerBands(closes, 20, 2),
    stochRsi: calculateStochRSI(closes),
    rsi14: calculateRSI(closes, 14),
    atr14: atr14 ? Number(atr14.toFixed(0)) : null,
    volatilityPercent:
      atr14 && currentPrice > 0 ? Number(((atr14 / currentPrice) * 100).toFixed(2)) : 0,
    high3Month: Math.max(...recent3m.map((b) => b.high)),
    low3Month: Math.min(...recent3m.map((b) => b.low)),
    high52Week: Math.max(...highs),
    low52Week: Math.min(...lows),
    supports: findSwingPivotSupports(recent3m, currentPrice),
    resistances: findSwingPivotResistances(recent3m, currentPrice),
    cmf20: calculateChaikinMoneyFlow(history, 20),
    obvTrend: obv.trend,
    obvDivergence: obv.divergence,
    accumulationStatus,
    volumeFlowRatio,
    volumeRatio: avgVol20 > 0 ? Number((lastVol / avgVol20).toFixed(2)) : 1,
    dailyTurnover: calculateDailyTurnover(currentPrice, avgVol20),
    candlestickPattern: detectCandlestickPattern(history),
    araLimit: ara > 0 ? ara : null,
    arbLimit: arb > 0 ? arb : null,
    rsDiff20dPct: rs.diffPct,
    rsRating: rs.rating,
    rsStatus: rs.status,
  };
}

// ============================================================================
// Multi-Factor Quant Scorer & Setup Trade Plan Anchor
// ============================================================================

export interface QuantPlanAnchor {
  entryPrice: number;
  stopLoss: number;
  targetPrice1: number;
  targetPrice: number;
  riskRewardRatio: number;
}

export interface QuantEvaluation {
  scores: QuantBreakdown;
  setupType: SetupType;
  plan: QuantPlanAnchor;
}

const BULL_PATTERNS = new Set([
  "BULLISH_ENGULFING",
  "HAMMER_PINBAR",
  "MORNING_STAR",
  "BREAKOUT_MARUBOZU",
]);
const BEAR_PATTERNS = new Set(["BEARISH_ENGULFING", "SHOOTING_STAR"]);

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function scoreQuantTechnical(t: TechnicalSnapshot): number {
  let score = 50;
  if (t.trend === "BULLISH") score += 15;
  else if (t.trend === "BEARISH") score -= 12;

  if (t.sma200 && t.currentPrice > t.sma200) score += 8;

  if (t.macd) {
    if (t.macd.trend === "BULLISH_CROSS") score += 12;
    else if (t.macd.trend === "BULLISH" || t.macd.histogram > 0) score += 7;
    else if (t.macd.trend === "BEARISH_CROSS") score -= 12;
  }

  if (t.rsi14 !== null) {
    if (t.rsi14 >= 40 && t.rsi14 <= 65) score += 6;
    else if (t.rsi14 <= 35) score += 5;
    else if (t.rsi14 > 75) score -= 15;
  }

  if (t.stochRsi?.state === "OVERSOLD_CROSS") score += 8;
  else if (t.stochRsi?.state === "OVERBOUGHT_CROSS") score -= 6;

  if (t.bollinger?.isSqueeze) score += 6;
  if (BULL_PATTERNS.has(t.candlestickPattern)) score += 8;
  else if (BEAR_PATTERNS.has(t.candlestickPattern)) score -= 10;

  if (t.rsStatus === "OUTPERFORMING") score += 10;
  else if (t.rsStatus === "LAGGING") score -= 8;

  return clamp(Math.round(score), 0, 100);
}

export function scoreQuantBandarmology(t: TechnicalSnapshot): number {
  let score = 50;
  if (t.cmf20 !== null) {
    if (t.cmf20 >= 0.15) score += 22;
    else if (t.cmf20 >= 0.05) score += 12;
    else if (t.cmf20 <= -0.1) score -= 20;
  }

  if (t.volumeFlowRatio >= 1.3) score += 15;
  else if (t.volumeFlowRatio <= 0.7) score -= 18;

  if (t.obvDivergence === "BULLISH_DIV") score += 15;
  else if (t.obvDivergence === "BEARISH_DIV") score -= 15;

  if (t.obvTrend === "RISING") score += 6;
  else if (t.obvTrend === "FALLING") score -= 6;

  return clamp(Math.round(score), 0, 100);
}

export function scoreQuantFundamental(f: FundamentalSnapshot | null): number {
  if (!f) return 50;
  const hasAny =
    f.roe !== null ||
    f.peRatio !== null ||
    f.pbRatio !== null ||
    f.revenueGrowth !== null ||
    f.dividendYield !== null ||
    f.debtToEquity !== null;
  if (!hasAny) return 50;

  let score = 50;
  if (f.roe !== null) {
    if (f.roe >= 0.15) score += 18;
    else if (f.roe >= 0.1) score += 10;
    else if (f.roe < 0) score -= 20;
  }
  if (f.peRatio !== null) {
    if (f.peRatio > 0 && f.peRatio <= 12) score += 12;
    else if (f.peRatio > 12 && f.peRatio <= 20) score += 6;
    else if (f.peRatio > 40 || f.peRatio < 0) score -= 12;
  }
  if (f.pbRatio !== null) {
    if (f.pbRatio > 0 && f.pbRatio <= 1.5) score += 8;
    else if (f.pbRatio > 5) score -= 8;
  }
  if (f.revenueGrowth !== null) {
    if (f.revenueGrowth > 0.1) score += 10;
    else if (f.revenueGrowth < -0.1) score -= 10;
  }
  if (f.dividendYield !== null && f.dividendYield >= 0.04) score += 8;

  const isFinancial = (f.sector ?? "").toLowerCase().includes("financial");
  if (!isFinancial && f.debtToEquity !== null && f.debtToEquity > 200) score -= 12;

  return clamp(Math.round(score), 0, 100);
}

export function classifySetupType(t: TechnicalSnapshot): SetupType {
  if (t.trend === "BULLISH" && t.volumeRatio >= 1.25 && (t.cmf20 ?? 0) >= 0) {
    return "BREAKOUT";
  }

  const hasSilentFlow =
    (t.cmf20 ?? 0) >= 0.06 || t.obvDivergence === "BULLISH_DIV" || t.volumeFlowRatio >= 1.25;
  if ((t.bollinger?.isSqueeze || t.trend === "SIDEWAYS") && hasSilentFlow) {
    return "SILENT_ACCUMULATION";
  }

  if (
    t.trend === "BULLISH" &&
    ((t.priceToVwapPct ?? 99) <= 2.0 || (t.rsi14 ?? 50) <= 58)
  ) {
    return "PULLBACK";
  }

  if (
    t.trend === "BEARISH" &&
    (t.accumulationStatus === "ACCUMULATION" ||
      (t.cmf20 ?? 0) > 0 ||
      t.obvDivergence === "BULLISH_DIV")
  ) {
    return "CONTRARIAN_BOUNCE";
  }

  return "NONE";
}

export function buildQuantTradePlan(t: TechnicalSnapshot, setup: SetupType): QuantPlanAnchor {
  const price = Math.max(1, t.currentPrice);
  const nearestSup = t.supports.find((s) => s > 0 && s < price);
  const vwap = t.vwap20 && t.vwap20 > 0 ? t.vwap20 : null;

  let rawEntry = price * 0.98;
  if (setup === "BREAKOUT") {
    rawEntry = vwap && vwap >= price * 0.98 && vwap <= price ? vwap : price * 0.99;
  } else if (nearestSup && nearestSup >= price * 0.955) {
    rawEntry = nearestSup;
  } else if (vwap && vwap >= price * 0.96 && vwap < price) {
    rawEntry = vwap;
  }
  const entryPrice = roundToIdxTick(rawEntry, "nearest");

  const atr = t.atr14 && t.atr14 > 0 ? t.atr14 : entryPrice * 0.03;
  const minStopDist = Math.max(atr * 1.1, entryPrice * 0.035);
  const structFloor =
    nearestSup && nearestSup < entryPrice * 0.97 ? nearestSup * 0.985 : entryPrice - minStopDist;
  const stopLoss = Math.max(
    1,
    roundToIdxTick(Math.min(entryPrice - minStopDist, structFloor), "floor")
  );

  const risk = Math.max(1, entryPrice - stopLoss);
  const nextRes = t.resistances.find((r) => r > entryPrice * 1.03);
  const minTp2 = entryPrice + risk * 2.1;
  const targetPrice = roundToIdxTick(nextRes && nextRes >= minTp2 ? nextRes : minTp2, "ceil");

  const rawTp1 = Math.min(entryPrice + risk * 1.2, targetPrice - (targetPrice - entryPrice) * 0.2);
  let targetPrice1 = roundToIdxTick(Math.max(entryPrice * 1.015, rawTp1), "ceil");
  if (targetPrice1 >= targetPrice) {
    targetPrice1 = roundToIdxTick((entryPrice + targetPrice) / 2, "nearest");
  }

  return {
    entryPrice,
    stopLoss,
    targetPrice1,
    targetPrice,
    riskRewardRatio: Number(((targetPrice - entryPrice) / risk).toFixed(2)),
  };
}

export function evaluateQuant(
  tech: TechnicalSnapshot,
  fund: FundamentalSnapshot | null
): QuantEvaluation {
  const technical = scoreQuantTechnical(tech);
  const bandarmology = scoreQuantBandarmology(tech);
  const fundamental = scoreQuantFundamental(fund);
  const composite = clamp(
    Math.round(technical * 0.4 + bandarmology * 0.35 + fundamental * 0.25),
    0,
    100
  );
  const setupType = classifySetupType(tech);
  return {
    scores: { technical, bandarmology, fundamental, composite },
    setupType,
    plan: buildQuantTradePlan(tech, setupType),
  };
}

// ============================================================================
// Liquid IDX80/LQ45 Universe & Screener Scanner
// ============================================================================

export interface UniverseTicker {
  ticker: string;
  companyName: string;
  sector: string;
}

export const IDX_LIQUID_UNIVERSE: UniverseTicker[] = [
  { ticker: "BBCA", companyName: "Bank Central Asia Tbk", sector: "Financial Services" },
  { ticker: "BBRI", companyName: "Bank Rakyat Indonesia Tbk", sector: "Financial Services" },
  { ticker: "BMRI", companyName: "Bank Mandiri Tbk", sector: "Financial Services" },
  { ticker: "BBNI", companyName: "Bank Negara Indonesia Tbk", sector: "Financial Services" },
  { ticker: "BRIS", companyName: "Bank Syariah Indonesia Tbk", sector: "Financial Services" },
  { ticker: "ARTO", companyName: "Bank Jago Tbk", sector: "Financial Services" },
  { ticker: "BTPS", companyName: "Bank BTPN Syariah Tbk", sector: "Financial Services" },
  { ticker: "BBTN", companyName: "Bank Tabungan Negara Tbk", sector: "Financial Services" },
  { ticker: "BNGA", companyName: "Bank CIMB Niaga Tbk", sector: "Financial Services" },
  { ticker: "TLKM", companyName: "Telkom Indonesia Tbk", sector: "Communication Services" },
  { ticker: "ISAT", companyName: "Indosat Ooredoo Hutchison Tbk", sector: "Communication Services" },
  { ticker: "EXCL", companyName: "XL Axiata Tbk", sector: "Communication Services" },
  { ticker: "ASII", companyName: "Astra International Tbk", sector: "Industrials" },
  { ticker: "UNTR", companyName: "United Tractors Tbk", sector: "Energy" },
  { ticker: "ADRO", companyName: "Alamtri Resources Indonesia Tbk", sector: "Energy" },
  { ticker: "AADI", companyName: "Adaro Andalan Indonesia Tbk", sector: "Energy" },
  { ticker: "PTBA", companyName: "Bukit Asam Tbk", sector: "Energy" },
  { ticker: "ITMG", companyName: "Indo Tambangraya Megah Tbk", sector: "Energy" },
  { ticker: "PGAS", companyName: "Perusahaan Gas Negara Tbk", sector: "Utilities" },
  { ticker: "MEDC", companyName: "Medco Energi Internasional Tbk", sector: "Energy" },
  { ticker: "AKRA", companyName: "AKR Corporindo Tbk", sector: "Energy" },
  { ticker: "ELSA", companyName: "Elnusa Tbk", sector: "Energy" },
  { ticker: "ANTM", companyName: "Aneka Tambang Tbk", sector: "Basic Materials" },
  { ticker: "MDKA", companyName: "Merdeka Copper Gold Tbk", sector: "Basic Materials" },
  { ticker: "INCO", companyName: "Vale Indonesia Tbk", sector: "Basic Materials" },
  { ticker: "AMMN", companyName: "Amman Mineral Internasional Tbk", sector: "Basic Materials" },
  { ticker: "MBMA", companyName: "Merdeka Battery Materials Tbk", sector: "Basic Materials" },
  { ticker: "NCKL", companyName: "Trimegah Bangun Persada Tbk", sector: "Basic Materials" },
  { ticker: "TINS", companyName: "Timah Tbk", sector: "Basic Materials" },
  { ticker: "BRMS", companyName: "Bumi Resources Minerals Tbk", sector: "Basic Materials" },
  { ticker: "HRUM", companyName: "Harum Energy Tbk", sector: "Energy" },
  { ticker: "ICBP", companyName: "Indofood CBP Sukses Makmur Tbk", sector: "Consumer Defensive" },
  { ticker: "INDF", companyName: "Indofood Sukses Makmur Tbk", sector: "Consumer Defensive" },
  { ticker: "MYOR", companyName: "Mayora Indah Tbk", sector: "Consumer Defensive" },
  { ticker: "AMRT", companyName: "Sumber Alfaria Trijaya Tbk", sector: "Consumer Defensive" },
  { ticker: "ACES", companyName: "Aspirasi Hidup Indonesia Tbk", sector: "Consumer Cyclical" },
  { ticker: "MAPI", companyName: "Mitra Adiperkasa Tbk", sector: "Consumer Cyclical" },
  { ticker: "KLBF", companyName: "Kalbe Farma Tbk", sector: "Healthcare" },
  { ticker: "MIKA", companyName: "Mitra Keluarga Karyasehat Tbk", sector: "Healthcare" },
  { ticker: "HEAL", companyName: "Medikaloka Hermina Tbk", sector: "Healthcare" },
  { ticker: "SIDO", companyName: "Industri Jamu Sido Muncul Tbk", sector: "Consumer Defensive" },
  { ticker: "GOTO", companyName: "GoTo Gojek Tokopedia Tbk", sector: "Technology" },
  { ticker: "BUKA", companyName: "Bukalapak.com Tbk", sector: "Technology" },
  { ticker: "SMGR", companyName: "Semen Indonesia Tbk", sector: "Basic Materials" },
  { ticker: "INTP", companyName: "Indocement Tunggal Prakarsa Tbk", sector: "Basic Materials" },
  { ticker: "JSMR", companyName: "Jasa Marga Tbk", sector: "Industrials" },
  { ticker: "CTRA", companyName: "Ciputra Development Tbk", sector: "Real Estate" },
  { ticker: "BSDE", companyName: "Bumi Serpong Damai Tbk", sector: "Real Estate" },
  { ticker: "SMRA", companyName: "Summarecon Agung Tbk", sector: "Real Estate" },
  { ticker: "PWON", companyName: "Pakuwon Jati Tbk", sector: "Real Estate" },
  { ticker: "CPIN", companyName: "Charoen Pokphand Indonesia Tbk", sector: "Consumer Defensive" },
  { ticker: "JPFA", companyName: "Japfa Comfeed Indonesia Tbk", sector: "Consumer Defensive" },
  { ticker: "BRPT", companyName: "Barito Pacific Tbk", sector: "Basic Materials" },
  { ticker: "TPIA", companyName: "Chandra Asri Pacific Tbk", sector: "Basic Materials" },
  { ticker: "PGEO", companyName: "Pertamina Geothermal Energy Tbk", sector: "Utilities" },
  { ticker: "CUAN", companyName: "Petrindo Jaya Kreasi Tbk", sector: "Energy" },
  { ticker: "INKP", companyName: "Indah Kiat Pulp & Paper Tbk", sector: "Basic Materials" },
  { ticker: "TKIM", companyName: "Pabrik Kertas Tjiwi Kimia Tbk", sector: "Basic Materials" },
  { ticker: "ASSA", companyName: "Adi Sarana Armada Tbk", sector: "Industrials" },
  { ticker: "TAPG", companyName: "Triputra Agro Persada Tbk", sector: "Consumer Defensive" },
  { ticker: "DSNG", companyName: "Dharma Satya Nusantara Tbk", sector: "Consumer Defensive" },
  { ticker: "LSIP", companyName: "PP London Sumatra Indonesia Tbk", sector: "Consumer Defensive" },
];

export function getScreenerUniverse(watchlist: string[]): UniverseTicker[] {
  const map = new Map<string, UniverseTicker>();
  for (const u of IDX_LIQUID_UNIVERSE) {
    map.set(u.ticker, u);
  }
  for (const w of watchlist) {
    const clean = normalizeTicker(w);
    if (clean && !map.has(clean)) {
      map.set(clean, { ticker: clean, companyName: clean, sector: "Watchlist" });
    }
  }
  return Array.from(map.values());
}

const SCREENER_CACHE_KEY = "screener:v1";
const SCREENER_TTL_MS = 15 * 60 * 1000;
const MIN_LIQUID_TURNOVER = 1_000_000_000;

export function evaluateScreenerStock(params: {
  meta: UniverseTicker;
  price: number;
  changePct: number;
  history: PriceBar[];
  fundamental: FundamentalSnapshot | null;
  macro: MacroContext;
  isWatchlisted: boolean;
}): ScreenerItem | null {
  const { meta, price, changePct, history, fundamental, macro, isWatchlisted } = params;
  if (!Number.isFinite(price) || price <= 0 || history.length < 20) return null;

  const tech = buildTechnicalSnapshot(meta.ticker, history, price, macro.ihsgReturn20dPct);
  if (!isWatchlisted && tech.dailyTurnover > 0 && tech.dailyTurnover < MIN_LIQUID_TURNOVER) {
    return null;
  }

  const quant = evaluateQuant(tech, fundamental);
  return {
    ticker: meta.ticker,
    companyName: fundamental?.companyName ?? meta.companyName,
    sector: fundamental?.sector ?? meta.sector,
    price,
    changePct: Number(changePct.toFixed(2)),
    dailyTurnover: tech.dailyTurnover,
    setupType: quant.setupType,
    quantScore: quant.scores.composite,
    technicalScore: quant.scores.technical,
    bandarmologyScore: quant.scores.bandarmology,
    fundamentalScore: quant.scores.fundamental,
    trend: tech.trend,
    rsi14: tech.rsi14,
    cmf20: tech.cmf20,
    obvDivergence: tech.obvDivergence,
    volumeRatio: tech.volumeRatio,
    bollingerSqueeze: Boolean(tech.bollinger?.isSqueeze),
    candlestickPattern: tech.candlestickPattern,
    rsRating: tech.rsRating,
    rsStatus: tech.rsStatus,
    entryPrice: quant.plan.entryPrice,
    stopLoss: quant.plan.stopLoss,
    targetPrice1: quant.plan.targetPrice1,
    targetPrice: quant.plan.targetPrice,
    riskRewardRatio: quant.plan.riskRewardRatio,
    isWatchlisted,
  };
}

export async function runScreener(opts: {
  forceRefresh?: boolean;
  setupFilter?: string;
  sectorFilter?: string;
  trendFilter?: string;
  minScore?: number;
  limit?: number;
} = {}): Promise<ScreenerPayload> {
  const {
    forceRefresh = false,
    setupFilter = "ALL",
    sectorFilter = "ALL",
    trendFilter = "ALL",
    minScore = 0,
    limit = 65,
  } = opts;

  let payload: ScreenerPayload;
  let cached = false;

  const cachedData = !forceRefresh ? getCache<ScreenerPayload>(SCREENER_CACHE_KEY) : null;
  if (cachedData) {
    payload = cachedData;
    cached = true;
  } else {
    const watchlist = getWatchlist();
    const watchlistSet = new Set(watchlist);
    const universe = getScreenerUniverse(watchlist);

    const [macro, quotesMap] = await Promise.all([
      getMacroContext(forceRefresh),
      fetchQuotesBatch(universe.map((u) => u.ticker)),
    ]);
    const fundMap = getFundamentalsMap(universe.map((u) => u.ticker));

    const items: ScreenerItem[] = [];
    const chunkSize = 6;
    for (let i = 0; i < universe.length; i += chunkSize) {
      const batch = universe.slice(i, i + chunkSize);
      const batchResults = await Promise.all(
        batch.map(async (meta) => {
          try {
            const histRes = await fetchPriceHistory(meta.ticker, "1y");
            if (!histRes.success || !histRes.data || histRes.data.length < 20) return null;

            const lastBar = histRes.data[histRes.data.length - 1]!;
            const prevBar = histRes.data[histRes.data.length - 2];
            const fallbackPct =
              prevBar && prevBar.close > 0
                ? ((lastBar.close - prevBar.close) / prevBar.close) * 100
                : 0;

            const q = quotesMap.get(meta.ticker);
            const price = q?.data?.regularMarketPrice ?? lastBar.close;
            const changePct = q?.data?.regularMarketChangePercent ?? fallbackPct;

            return evaluateScreenerStock({
              meta,
              price,
              changePct,
              history: histRes.data,
              fundamental: fundMap.get(meta.ticker) ?? null,
              macro,
              isWatchlisted: watchlistSet.has(meta.ticker),
            });
          } catch {
            return null;
          }
        })
      );

      for (const item of batchResults) {
        if (item) items.push(item);
      }
      if (i + chunkSize < universe.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    items.sort((a, b) => {
      const rankA = (a.setupType !== "NONE" ? 100 : 0) + a.quantScore;
      const rankB = (b.setupType !== "NONE" ? 100 : 0) + b.quantScore;
      return rankB - rankA || b.bandarmologyScore - a.bandarmologyScore;
    });

    payload = {
      macro,
      items,
      scannedCount: universe.length,
      generatedAt: new Date().toISOString(),
      cached: false,
    };
    setCache(SCREENER_CACHE_KEY, payload, SCREENER_TTL_MS);
  }

  const filtered = payload.items
    .filter((i) => i.quantScore >= minScore)
    .filter((i) => !setupFilter || setupFilter === "ALL" || i.setupType === setupFilter)
    .filter((i) => !sectorFilter || sectorFilter === "ALL" || i.sector === sectorFilter)
    .filter((i) => !trendFilter || trendFilter === "ALL" || i.trend === trendFilter)
    .slice(0, Math.max(1, limit));

  return { ...payload, items: filtered, cached };
}
