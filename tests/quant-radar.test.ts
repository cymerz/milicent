import { describe, expect, it } from "bun:test";
import type { PriceBar } from "@protocol/contracts.ts";
import {
  buildTechnicalSnapshot,
  calculateChaikinMoneyFlow,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateVWAP,
  evaluateQuant,
} from "@backend/quant-radar.ts";
import {
  isSafeExternalHttpUrl,
  isValidArticleUrl,
  matchTickersInArticle,
  stripNewsBoilerplate,
} from "@backend/media-pulse.ts";

function makeUptrendBars(count = 70, startPrice = 4000): PriceBar[] {
  const bars: PriceBar[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    const open = price;
    const close = Math.round(price + (i % 5 === 0 ? -15 : 35));
    const high = Math.max(open, close) + 25;
    const low = Math.min(open, close) - 20;
    const volume = close > open ? 15_000_000 : 7_000_000;
    bars.push({
      date: day,
      open,
      high,
      low,
      close,
      volume,
      adjustedClose: close,
    });
    price = close;
  }
  return bars;
}

describe("Quant Radar & Media Pulse Token Matching", () => {
  it("computes core technicals, VWAP, CMF20 and full Quant trade plan", () => {
    const bars = makeUptrendBars(75, 4200);
    const lastClose = bars[bars.length - 1]!.close;

    expect(calculateSMA(bars.map((b) => b.close), 20)).not.toBeNull();
    expect(calculateRSI(bars.map((b) => b.close), 14)).toBeGreaterThan(50);
    expect(calculateMACD(bars.map((b) => b.close))).not.toBeNull();

    const { vwap } = calculateVWAP(bars, 20);
    expect(vwap).toBeGreaterThan(4000);

    const cmf = calculateChaikinMoneyFlow(bars, 20);
    expect(cmf).not.toBeNull();
    expect(cmf!).toBeGreaterThan(0);

    const tech = buildTechnicalSnapshot("BBCA", bars, lastClose, 1.5);
    expect(tech.trend).toBe("BULLISH");
    expect(tech.accumulationStatus).toBe("ACCUMULATION");

    const q = evaluateQuant(tech, {
      ticker: "BBCA",
      companyName: "Bank Central Asia Tbk",
      sector: "Financial Services",
      industry: "Banks",
      marketCap: 1e15,
      peRatio: 11.5,
      forwardPe: 10.5,
      pbRatio: 2.1,
      psRatio: 5.0,
      pegRatio: 1.2,
      roe: 0.21,
      roa: 0.04,
      profitMargin: 0.45,
      debtToEquity: 10,
      currentRatio: 1.5,
      dividendYield: 0.045,
      totalRevenue: 100e12,
      revenueGrowth: 0.12,
      earningsGrowth: 0.14,
      netIncome: 50e12,
      financialCurrency: "IDR",
    });

    expect(q.scores.composite).toBeGreaterThanOrEqual(65);
    expect(q.plan.entryPrice).toBeLessThanOrEqual(lastClose);
    expect(q.plan.stopLoss).toBeLessThan(q.plan.entryPrice);
    expect(q.plan.targetPrice1).toBeGreaterThan(q.plan.entryPrice);
    expect(q.plan.targetPrice).toBeGreaterThan(q.plan.targetPrice1);
    expect(q.plan.riskRewardRatio).toBeGreaterThanOrEqual(1.8);
  });

  it("matches IDX tickers strictly without substring or boilerplate false positives", () => {
    const dirty =
      "Saham BBCA Melesat Setelah Cakra Membeli BBRI. BACA JUGA: Prospek Saham ADRO & ANTM Hari Ini!";
    expect(stripNewsBoilerplate(dirty)).not.toContain("ADRO");

    const matches = matchTickersInArticle(
      "BBCA Catat Net Buy Asing Rp 500 Miliar",
      "Emiten Cakra mencatat kenaikan dan BBRI menguat secara teknikal, sementara Main belum bergerak. Namun saham MAIN mulai ramai dibahas. BACA JUGA: ADRO meroket"
    );

    const matchedTickers = matches.map((m) => m.ticker);
    expect(matchedTickers).toContain("BBCA");
    expect(matchedTickers).toContain("BBRI");
    expect(matchedTickers).toContain("MAIN");
    expect(matchedTickers).not.toContain("AKRA"); // must NOT match "Cakra"
    expect(matchedTickers).not.toContain("ADRO"); // stripped inside "BACA JUGA:"
    expect(matches[0]?.ticker).toBe("BBCA");
    expect(matches[0]?.inHeadline).toBe(true);

    // Ambiguous ticker without stock context in plain prose must NOT match
    const proseOnly = matchTickersInArticle(
      "Berita Ekonomi Hari Ini",
      "Perusahaan fokus pada bisnis MAIN agar FAST dan GOOD untuk jangka panjang."
    );
    expect(proseOnly.length).toBe(0);
  });

  it("validates crawler article URLs strictly against domain spoofing and SSRF targets", () => {
    const base = "https://investasi.kontan.co.id";
    expect(
      isValidArticleUrl("/news/bbca-catat-laba", base)
    ).toBe("https://investasi.kontan.co.id/news/bbca-catat-laba");
    expect(
      isValidArticleUrl("https://sub.investasi.kontan.co.id/news/item", base)
    ).toBe("https://sub.investasi.kontan.co.id/news/item");

    // Host spoofing via substring match must fail
    expect(isValidArticleUrl("https://evil-investasi.kontan.co.id/news/a", base)).toBeNull();
    expect(isValidArticleUrl("https://investasi.kontan.co.id.attacker.com/news/a", base)).toBeNull();

    // Non-HTTP protocols and internal/SSRF destinations must fail
    expect(isValidArticleUrl("javascript:alert(1)", base)).toBeNull();
    expect(isValidArticleUrl("file:///etc/passwd", base)).toBeNull();
    expect(isSafeExternalHttpUrl("http://127.0.0.1:8045/v1/models")).toBeNull();
    expect(isSafeExternalHttpUrl("http://localhost:3001/api/settings")).toBeNull();
    expect(isSafeExternalHttpUrl("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(isSafeExternalHttpUrl("https://www.cnbcindonesia.com/market")?.hostname).toBe(
      "www.cnbcindonesia.com"
    );
  });
});
