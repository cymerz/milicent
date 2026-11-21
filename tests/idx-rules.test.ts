import { describe, expect, it } from "bun:test";
import {
  calculateDailyTurnover,
  computeIdxPositionSizing,
  getIdxAutoRejectionLimits,
  getIdxTickSize,
  isValidIdxEquityTicker,
  normalizeTicker,
  roundToIdxTick,
  suggestRiskProfile,
  toYahooSymbol,
} from "@protocol/idx-rules.ts";

describe("IDX Market Rules & Position Sizing", () => {
  it("resolves official BEI tick size across all 5 price tiers", () => {
    expect(getIdxTickSize(120)).toBe(1);
    expect(getIdxTickSize(199)).toBe(1);
    expect(getIdxTickSize(200)).toBe(2);
    expect(getIdxTickSize(498)).toBe(2);
    expect(getIdxTickSize(500)).toBe(5);
    expect(getIdxTickSize(1995)).toBe(5);
    expect(getIdxTickSize(2000)).toBe(10);
    expect(getIdxTickSize(4990)).toBe(10);
    expect(getIdxTickSize(5000)).toBe(25);
    expect(getIdxTickSize(9850)).toBe(25);
  });

  it("rounds floor, ceil, and nearest strictly to valid IDX tick fractions", () => {
    expect(roundToIdxTick(5173, "nearest")).toBe(5175);
    expect(roundToIdxTick(5173, "floor")).toBe(5150);
    expect(roundToIdxTick(5173, "ceil")).toBe(5175);
    expect(roundToIdxTick(312, "floor")).toBe(312);
    expect(roundToIdxTick(313, "ceil")).toBe(314);
    expect(roundToIdxTick(1492, "nearest")).toBe(1490);
  });

  it("calculates ARA/ARB auto-rejection bounds with Rp 50 floor", () => {
    const lowTier = getIdxAutoRejectionLimits(150);
    expect(lowTier.pct).toBe(35);
    expect(lowTier.ara).toBe(202);
    expect(lowTier.arb).toBe(98);

    const pennyFloor = getIdxAutoRejectionLimits(60);
    expect(pennyFloor.arb).toBe(50);

    const midTier = getIdxAutoRejectionLimits(2000);
    expect(midTier.pct).toBe(25);
    expect(midTier.ara).toBe(2500);
    expect(midTier.arb).toBe(1500);

    const blueChip = getIdxAutoRejectionLimits(9000);
    expect(blueChip.pct).toBe(20);
    expect(blueChip.ara).toBe(10800);
    expect(blueChip.arb).toBe(7200);
  });

  it("normalizes symbols and validates 4-letter IDX equity tickers", () => {
    expect(normalizeTicker("bbca.jk")).toBe("BBCA");
    expect(normalizeTicker(" BBRI ")).toBe("BBRI");
    expect(normalizeTicker("^JKSE")).toBe("^JKSE");
    expect(toYahooSymbol("adro")).toBe("ADRO.JK");
    expect(toYahooSymbol("USDIDR=X")).toBe("USDIDR=X");
    expect(isValidIdxEquityTicker("BBCA.JK")).toBe(true);
    expect(isValidIdxEquityTicker("BAD")).toBe(false);
    expect(calculateDailyTurnover(5000, 10_000_000)).toBe(50_000_000_000);
  });

  it("computes fee-aware IDX lot sizing respecting risk & allocation caps", () => {
    const res = computeIdxPositionSizing({
      capitalIdr: 100_000_000,
      riskPct: 1.0, // max loss budget = Rp 1,000,000
      maxAllocPct: 25,
      entryPrice: 5000,
      stopLoss: 4750, // risk per share = 250 => 25,000 per lot => 40 lots by risk, capped at 50 lots by 25M alloc
      targetPrice1: 5300,
      targetPrice: 5600,
    });

    expect(res.lots).toBe(40);
    expect(res.shares).toBe(4000);
    expect(res.grossBuyIdr).toBe(20_000_000);
    expect(res.totalCostIdr).toBe(20_030_000); // includes 0.15% buy fee (30k)
    expect(res.netSlLossIdr).toBeGreaterThan(1_000_000); // risk + buy & sell fees
    expect(res.netTp1ProfitIdr).toBeGreaterThan(0);
    expect(res.netTp2ProfitIdr).toBeGreaterThan(2_000_000);
    expect(res.riskRewardRatio).toBe(2.4);

    expect(suggestRiskProfile(82, "RISK_ON", "BULLISH").suggestedRiskPct).toBe(1.5);
    expect(suggestRiskProfile(70, "RISK_OFF", "BEARISH").suggestedRiskPct).toBe(0.5);
  });
});
