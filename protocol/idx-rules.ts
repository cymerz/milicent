/**
 * Official IDX (Bursa Efek Indonesia) Market Rules:
 * - Tick fraction tiers & rounding
 * - ARA / ARB Auto-Rejection limits (Rp 50 board floor)
 * - Ticker symbol normalization
 * - IDX lot position sizing & broker fee calculation
 */

export const IDX_SUFFIX = ".JK";
export const BUY_FEE_RATE = 0.0015; // 0.15% standard IDX buy broker commission
export const SELL_FEE_RATE = 0.0025; // 0.25% standard IDX sell commission + PPh 0.1%
export const SHARES_PER_LOT = 100;

export function normalizeTicker(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (!upper) return "";
  if (upper.startsWith("^") || upper.includes("=")) {
    return upper;
  }
  return upper.replace(/\.JK$/i, "");
}

export function isValidIdxEquityTicker(raw: string): boolean {
  const clean = normalizeTicker(raw);
  return /^[A-Z]{4}$/.test(clean);
}

export function toYahooSymbol(raw: string): string {
  const upper = raw.trim().toUpperCase();
  if (!upper) return "";
  if (upper.startsWith("^") || upper.includes("=") || upper.endsWith(IDX_SUFFIX)) {
    return upper;
  }
  return `${normalizeTicker(upper)}${IDX_SUFFIX}`;
}

export function getIdxTickSize(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2000) return 5;
  if (price < 5000) return 10;
  return 25;
}

export function roundToIdxTick(
  price: number,
  mode: "nearest" | "floor" | "ceil" = "nearest"
): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const tick = getIdxTickSize(price);
  if (mode === "floor") return Math.floor(price / tick) * tick;
  if (mode === "ceil") return Math.ceil(price / tick) * tick;
  return Math.round(price / tick) * tick;
}

export function calculateDailyTurnover(price: number, avgVolume20: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(avgVolume20) || price <= 0 || avgVolume20 <= 0) {
    return 0;
  }
  return price * avgVolume20;
}

export function getIdxAutoRejectionLimits(previousClose: number): {
  ara: number;
  arb: number;
  pct: number;
} {
  if (!Number.isFinite(previousClose) || previousClose <= 0) {
    return { ara: 0, arb: 0, pct: 0 };
  }

  let pctRatio = 0.2;
  if (previousClose <= 200) pctRatio = 0.35;
  else if (previousClose <= 5000) pctRatio = 0.25;

  const ara = roundToIdxTick(previousClose * (1 + pctRatio), "floor");
  const rawArb = previousClose * (1 - pctRatio);
  const arb =
    previousClose < 50
      ? Math.max(1, Math.ceil(rawArb))
      : Math.max(50, roundToIdxTick(rawArb, "ceil"));

  return { ara, arb, pct: Math.round(pctRatio * 100) };
}

export interface PositionSizingInput {
  capitalIdr: number;
  riskPct: number;
  maxAllocPct?: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice1?: number | null;
  targetPrice: number;
}

export interface PositionSizingResult {
  lots: number;
  shares: number;
  grossBuyIdr: number;
  totalCostIdr: number;
  allocationPct: number;
  netSlLossIdr: number;
  netSlLossPct: number;
  netTp1ProfitIdr: number | null;
  netTp2ProfitIdr: number;
  riskRewardRatio: number;
}

export function suggestRiskProfile(
  overallScore: number,
  macroRegime?: "RISK_ON" | "NEUTRAL" | "CAUTIOUS" | "RISK_OFF",
  trend?: "BULLISH" | "BEARISH" | "SIDEWAYS"
): { suggestedRiskPct: number; maxAllocationPct: number } {
  let suggestedRiskPct = 1.0;
  if (macroRegime === "RISK_OFF" || trend === "BEARISH") {
    suggestedRiskPct = 0.5;
  } else if (overallScore >= 78 && macroRegime === "RISK_ON" && trend === "BULLISH") {
    suggestedRiskPct = 1.5;
  }
  return { suggestedRiskPct, maxAllocationPct: 25 };
}

export function computeIdxPositionSizing(input: PositionSizingInput): PositionSizingResult {
  const {
    capitalIdr,
    riskPct,
    maxAllocPct = 25,
    entryPrice,
    stopLoss,
    targetPrice1,
    targetPrice,
  } = input;

  if (capitalIdr <= 0 || entryPrice <= 0 || stopLoss <= 0 || entryPrice <= stopLoss) {
    return {
      lots: 0,
      shares: 0,
      grossBuyIdr: 0,
      totalCostIdr: 0,
      allocationPct: 0,
      netSlLossIdr: 0,
      netSlLossPct: 0,
      netTp1ProfitIdr: null,
      netTp2ProfitIdr: 0,
      riskRewardRatio: 0,
    };
  }

  const clampedRiskPct = Math.max(0.1, Math.min(5, riskPct));
  const clampedAllocPct = Math.max(5, Math.min(50, maxAllocPct));
  const riskPerShare = entryPrice - stopLoss;
  const maxRiskBudget = capitalIdr * (clampedRiskPct / 100);

  const lotsByRisk = Math.floor(maxRiskBudget / (riskPerShare * SHARES_PER_LOT));
  const lotsByCap = Math.floor(
    (capitalIdr * (clampedAllocPct / 100)) / (entryPrice * SHARES_PER_LOT)
  );
  const affordableLots = Math.floor(
    capitalIdr / (entryPrice * SHARES_PER_LOT * (1 + BUY_FEE_RATE))
  );

  const lots = Math.max(0, Math.min(affordableLots, Math.max(1, Math.min(lotsByRisk, lotsByCap))));
  const shares = lots * SHARES_PER_LOT;
  const grossBuyIdr = shares * entryPrice;
  const buyFee = grossBuyIdr * BUY_FEE_RATE;
  const totalCostIdr = Math.round(grossBuyIdr + buyFee);
  const allocationPct = Number(((totalCostIdr / capitalIdr) * 100).toFixed(1));

  const netSlLossIdr = Math.round(
    shares * riskPerShare + buyFee + shares * stopLoss * SELL_FEE_RATE
  );
  const netSlLossPct = Number(((netSlLossIdr / capitalIdr) * 100).toFixed(2));

  const tp1 = targetPrice1 && targetPrice1 > entryPrice ? targetPrice1 : null;
  const netTp1ProfitIdr = tp1
    ? Math.round(
        shares * 0.5 * (tp1 - entryPrice) - buyFee * 0.5 - shares * 0.5 * tp1 * SELL_FEE_RATE
      )
    : null;
  const netTp2ProfitIdr = Math.round(
    shares * (targetPrice - entryPrice) - buyFee - shares * targetPrice * SELL_FEE_RATE
  );
  const riskRewardRatio = Number(((targetPrice - entryPrice) / riskPerShare).toFixed(2));

  return {
    lots,
    shares,
    grossBuyIdr,
    totalCostIdr,
    allocationPct,
    netSlLossIdr,
    netSlLossPct,
    netTp1ProfitIdr,
    netTp2ProfitIdr,
    riskRewardRatio,
  };
}
