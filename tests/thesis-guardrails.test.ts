import { describe, expect, it } from "bun:test";
import type { TechnicalSnapshot } from "@protocol/contracts.ts";
import { evaluateQuant } from "@backend/quant-radar.ts";
import {
  applyHybridGuardrails,
  type HybridAnalysisInput,
  type RawAiStockDecision,
} from "@backend/thesis-forge.ts";

function makeTech(overrides: Partial<TechnicalSnapshot> = {}): TechnicalSnapshot {
  return {
    ticker: "TEST",
    currentPrice: 5000,
    trend: "BULLISH",
    trendStrength: 75,
    sma20: 4900,
    sma50: 4700,
    sma200: 4500,
    ema20: 4920,
    ema50: 4720,
    vwap20: 4950,
    priceToVwapPct: 1.0,
    macd: { macd: 45, signal: 30, histogram: 15, trend: "BULLISH" },
    bollinger: { upper: 5200, middle: 4900, lower: 4600, bandwidthPct: 12, percentB: 0.65, isSqueeze: false },
    stochRsi: { k: 60, d: 55, state: "NEUTRAL" },
    rsi14: 56,
    atr14: 180,
    volatilityPercent: 3.6,
    high3Month: 5600,
    low3Month: 4400,
    high52Week: 6000,
    low52Week: 4000,
    supports: [4800, 4650],
    resistances: [5500, 5800],
    cmf20: 0.12,
    obvTrend: "RISING",
    obvDivergence: "NONE",
    accumulationStatus: "ACCUMULATION",
    volumeFlowRatio: 1.35,
    volumeRatio: 1.25,
    dailyTurnover: 50_000_000_000,
    candlestickPattern: "NONE",
    araLimit: 6000,
    arbLimit: 4000,
    rsDiff20dPct: 4.5,
    rsRating: 61,
    rsStatus: "OUTPERFORMING",
    ...overrides,
  };
}

function makeRawDecision(overrides: Partial<RawAiStockDecision> = {}): RawAiStockDecision {
  return {
    action: "BUY",
    confidence: 8,
    entryPrice: 4900,
    stopLoss: 4650,
    targetPrice1: 5200,
    targetPrice: 5500,
    maxHoldDays: 14,
    setupType: "PULLBACK",
    orderType: "LIMIT",
    scores: { sentiment: 70, fundamental: 80, technical: 75, overall: 78 },
    reasoning: {
      news: "Berita positif",
      fundamental: "Valuasi menarik",
      technical: "Pullback ke support",
      summary: "Layak BUY pullback",
    },
    ...overrides,
  };
}

function makeInput(tech: TechnicalSnapshot, priceChangePct = 1.2): HybridAnalysisInput {
  return {
    ticker: tech.ticker,
    currentPrice: tech.currentPrice,
    previousClose: tech.currentPrice,
    priceChangePct,
    technical: tech,
    fundamental: null,
    macro: null,
    news: null,
  };
}

describe("Thesis Forge Hybrid Risk Guardrails", () => {
  it("widens tight noise-bait stops to max(1.0*ATR, 3%) and downgrades poor R:R", () => {
    const tech = makeTech({ currentPrice: 5000, atr14: 250 }); // 1*ATR = 250 > 3% (150)
    const quant = evaluateQuant(tech, null);
    const out = applyHybridGuardrails(
      makeInput(tech),
      quant,
      makeRawDecision({ entryPrice: 5000, stopLoss: 4925, targetPrice: 5200 }) // SL widened to 4750 -> reward 200 / risk 250 = 0.8x
    );

    expect(out.stopLoss).toBeLessThanOrEqual(4750);
    expect(out.action).toBe("WAIT");
    expect(out.guardrailReason).toContain("R:R");
  });

  it("never inflates low AI conviction (< 55) with higher Quant score", () => {
    const tech = makeTech();
    const quant = evaluateQuant(tech, null);
    const out = applyHybridGuardrails(
      makeInput(tech),
      quant,
      makeRawDecision({
        action: "WAIT",
        scores: { sentiment: 40, fundamental: 50, technical: 45, overall: 42 },
      })
    );
    expect(out.overallScore).toBe(42);
  });

  it("approves Contrarian Swing BUY in BEARISH trend only with accumulation + momentum + >=2x R:R, else downgrades", () => {
    // Case A: Strong contrarian setup -> retained as BUY
    const contrarianTech = makeTech({
      trend: "BEARISH",
      accumulationStatus: "ACCUMULATION",
      volumeFlowRatio: 1.3,
      cmf20: 0.09,
      macd: { macd: 10, signal: -5, histogram: 15, trend: "BULLISH_CROSS" },
      rsi14: 44,
    });
    const qA = evaluateQuant(contrarianTech, null);
    const approved = applyHybridGuardrails(
      makeInput(contrarianTech),
      qA,
      makeRawDecision({
        entryPrice: 4900,
        stopLoss: 4650,
        targetPrice: 5500, // 600 / 250 = 2.4x R:R
        scores: { sentiment: 72, fundamental: 82, technical: 65, overall: 75 },
      })
    );
    expect(approved.action).toBe("BUY");

    // Case B: Falling knife with heavy distribution -> downgraded to AVOID
    const knifeTech = makeTech({
      trend: "BEARISH",
      accumulationStatus: "DISTRIBUTION",
      volumeFlowRatio: 0.45,
      cmf20: -0.18,
      macd: { macd: -50, signal: -20, histogram: -30, trend: "BEARISH" },
      rsi14: 42,
    });
    const qB = evaluateQuant(knifeTech, null);
    const rejected = applyHybridGuardrails(
      makeInput(knifeTech),
      qB,
      makeRawDecision({
        scores: { sentiment: 45, fundamental: 60, technical: 40, overall: 50 },
      })
    );
    expect(rejected.action).toBe("AVOID");
  });

  it("blocks overbought RSI (>75), low-volume 3M high breakouts, heavy distribution & near-ARA spikes", () => {
    const overbought = makeTech({ rsi14: 79 });
    expect(
      applyHybridGuardrails(makeInput(overbought), evaluateQuant(overbought, null), makeRawDecision()).action
    ).toBe("WAIT");

    const fakeout = makeTech({ currentPrice: 5580, high3Month: 5600, volumeRatio: 0.72 });
    expect(
      applyHybridGuardrails(makeInput(fakeout), evaluateQuant(fakeout, null), makeRawDecision()).action
    ).toBe("WAIT");

    const dist = makeTech({ accumulationStatus: "DISTRIBUTION", volumeFlowRatio: 0.5 });
    expect(
      applyHybridGuardrails(
        makeInput(dist),
        evaluateQuant(dist, null),
        makeRawDecision({ scores: { sentiment: 65, fundamental: 70, technical: 65, overall: 70 } })
      ).action
    ).toBe("WAIT");

    const nearAra = makeTech({ currentPrice: 5900, araLimit: 6000 });
    expect(
      applyHybridGuardrails(makeInput(nearAra, 17.5), evaluateQuant(nearAra, null), makeRawDecision()).action
    ).toBe("WAIT");
  });
});
