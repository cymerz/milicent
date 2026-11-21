import { beforeEach, describe, expect, it } from "bun:test";
import type { PriceBar, SignalRecord } from "@protocol/contracts.ts";
import {
  addWatchlistTicker,
  getCache,
  getActiveTelegramChatIds,
  getStoredSettings,
  getWatchlist,
  patchStoredSettings,
  purgeCacheByPrefix,
  removeWatchlistTicker,
  resetDatabaseForTests,
  setCache,
  upsertSignal,
} from "@backend/persistence.ts";
import {
  computeMetrics,
  escapeTelegramHtml,
  evaluateSignalTransition,
  isTelegramChatAuthorized,
  processTelegramUpdate,
  simulateSignalTrade,
  syncActiveSignals,
} from "@backend/execution-desk.ts";
import {
  resetRateLimitersForTests,
  resolveStaticAssetPath,
  routeRequest,
} from "@backend/main.ts";

describe("SQLite Persistence, Signal Lifecycle, Backtester & HTTP Gateway", () => {
  beforeEach(() => {
    resetDatabaseForTests(":memory:");
    resetRateLimitersForTests();
  });

  it("manages kv_cache TTL expiry, prefix purge, watchlist, and settings in SQLite", () => {
    setCache("analyze:v2:BBCA", { score: 82 }, 60_000);
    setCache("analyze:v2:BBRI", { score: 75 }, 60_000);
    setCache("expired:item", { stale: true }, -10);

    expect(getCache<{ score: number }>("analyze:v2:BBCA")?.score).toBe(82);
    expect(getCache("expired:item")).toBeNull();
    expect(purgeCacheByPrefix("analyze:v2:")).toBe(2);
    expect(getCache("analyze:v2:BBCA")).toBeNull();

    addWatchlistTicker("bbca.jk");
    addWatchlistTicker("TLKM");
    expect(getWatchlist()).toEqual(["BBCA", "TLKM"]);
    removeWatchlistTicker("BBCA");
    expect(getWatchlist()).toEqual(["TLKM"]);

    patchStoredSettings({ recommendation: { minOverallScore: 70 } });
    expect(getStoredSettings().recommendation.minOverallScore).toBe(70);
  });

  it("runs full signal lifecycle: pending -> entry_hit -> TP1 breakeven lock -> +5% trailing SL -> target_hit & gap-down cancel", async () => {
    const sig: SignalRecord = upsertSignal({
      ticker: "BBCA",
      signalDate: "2026-03-10",
      action: "BUY",
      setupType: "PULLBACK",
      orderType: "LIMIT",
      entryPrice: 5000,
      stopLoss: 4750,
      targetPrice1: 5250,
      targetPrice: 5600,
      maxHoldDays: 14,
      sentimentScore: 70,
      fundamentalScore: 80,
      technicalScore: 76,
      overallScore: 77,
      analysisSummary: "Test signal",
      newsSummary: "News ok",
      fundamentalSummary: "Fund ok",
      technicalSummary: "Tech ok",
    });

    // Step 1: Pending LIMIT order gets filled
    const t1 = evaluateSignalTransition(sig, { price: 5000, high: 5050, low: 4975 }, "2026-03-10");
    expect(t1.type).toBe("ENTRY_HIT");

    const syncEntry = await syncActiveSignals(
      new Map([["BBCA", { price: 5000, high: 5050, low: 4975 }]]),
      false,
      "2026-03-10"
    );
    expect(syncEntry.entriesFilled).toContain("BBCA");

    // Step 2: Price rallies past TP1 (5250) -> locks SL to breakeven + 0.5%
    const syncTp1 = await syncActiveSignals(
      new Map([["BBCA", { price: 5275, high: 5275, low: 5000 }]]),
      false,
      "2026-03-11"
    );
    expect(syncTp1.tp1Hits).toContain("BBCA");

    // Step 3: Price surges +8% to 5400 -> ratchets trailing stop upward
    const syncTrail = await syncActiveSignals(
      new Map([["BBCA", { price: 5400, high: 5425, low: 5250 }]]),
      false,
      "2026-03-12"
    );
    expect(syncTrail.trailingUpdates).toContain("BBCA");

    // Gap-down cancel scenario on pending LIMIT order
    const gapSig = upsertSignal({
      ticker: "ADRO",
      signalDate: "2026-03-11",
      action: "BUY",
      setupType: "PULLBACK",
      orderType: "LIMIT",
      entryPrice: 2500,
      stopLoss: 2350,
      targetPrice1: 2680,
      targetPrice: 2900,
      maxHoldDays: 14,
      sentimentScore: 60,
      fundamentalScore: 70,
      technicalScore: 65,
      overallScore: 66,
      analysisSummary: "Gap test",
      newsSummary: "-",
      fundamentalSummary: "-",
      technicalSummary: "-",
    });
    const gapRes = evaluateSignalTransition(gapSig, { price: 2320, high: 2380, low: 2310 }, "2026-03-11");
    expect(gapRes.type).toBe("CANCEL_GAP_DOWN");
  });

  it("simulates walk-forward trades cleanly and serves /health & /api/settings", async () => {
    const bars: PriceBar[] = [
      { date: "2026-03-01", open: 5050, high: 5100, low: 4980, close: 5000, volume: 1000, adjustedClose: 5000 },
      { date: "2026-03-02", open: 5025, high: 5300, low: 5000, close: 5275, volume: 1200, adjustedClose: 5275 },
      { date: "2026-03-03", open: 5275, high: 5625, low: 5250, close: 5600, volume: 1500, adjustedClose: 5600 },
    ];
    const trade = simulateSignalTrade(
      {
        ticker: "BBCA",
        signalDate: "2026-03-01",
        orderType: "LIMIT",
        entryPrice: 5000,
        stopLoss: 4750,
        targetPrice: 5600,
        maxHoldDays: 10,
      },
      bars,
      "trailing",
      { feePct: 0.2, slippagePct: 0.0, trailingActivationPct: 5, trailingDistancePct: 3 }
    );

    expect(trade.outcome).toBe("target_hit");
    expect(trade.netReturnPct).toBeCloseTo(11.6, 1);

    const metrics = computeMetrics([trade]);
    expect(metrics.wins).toBe(1);
    expect(metrics.winRatePct).toBe(100);

    const healthRes = await routeRequest(new Request("http://localhost/health"));
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { success: boolean; data: { status: string } };
    expect(healthJson.success).toBe(true);
    expect(healthJson.data.status).toBe("healthy");
  });

  it("enforces fail-closed admin auth on settings, logs, cache purge, and custom model override", async () => {
    const prevPw = process.env.ADMIN_PASSWORD;
    const prevAllow = process.env.ALLOW_INSECURE_LOCAL;
    try {
      process.env.ADMIN_PASSWORD = "change_me";
      delete process.env.ALLOW_INSECURE_LOCAL;

      // Fail-closed 503 when ADMIN_PASSWORD is 'change_me'
      const unconfiguredRes = await routeRequest(new Request("http://localhost/api/settings"));
      expect(unconfiguredRes.status).toBe(503);

      // Configured admin secret -> 401 without header
      process.env.ADMIN_PASSWORD = "unit-test-strong-secret";

      const noAuthSettings = await routeRequest(new Request("http://localhost/api/settings"));
      expect(noAuthSettings.status).toBe(401);

      const noAuthLogs = await routeRequest(new Request("http://localhost/api/logs"));
      expect(noAuthLogs.status).toBe(401);

      const noAuthPurge = await routeRequest(
        new Request("http://localhost/api/analyze/purge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
      );
      expect(noAuthPurge.status).toBe(401);

      const customModelDenied = await routeRequest(
        new Request("http://localhost/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "BBCA", model: "expensive-custom-model-x" }),
        })
      );
      expect(customModelDenied.status).toBe(403);

      // Authorized admin passes verify & purge
      const okVerify = await routeRequest(
        new Request("http://localhost/api/admin/verify", {
          method: "POST",
          headers: { "X-Admin-Password": "unit-test-strong-secret" },
        })
      );
      expect(okVerify.status).toBe(200);

      setCache("analyze:v2:BBCA", { score: 80 }, 60_000);
      const okPurge = await routeRequest(
        new Request("http://localhost/api/analyze/purge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Password": "unit-test-strong-secret",
          },
          body: JSON.stringify({ ticker: "BBCA" }),
        })
      );
      expect(okPurge.status).toBe(200);
      expect(getCache("analyze:v2:BBCA")).toBeNull();
    } finally {
      if (prevPw === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prevPw;
      if (prevAllow === undefined) delete process.env.ALLOW_INSECURE_LOCAL;
      else process.env.ALLOW_INSECURE_LOCAL = prevAllow;
    }
  });

  it("enforces strict CORS origins, admin brute-force lockout, static path safety, and Telegram access/HTML escaping", async () => {
    const prevPw = process.env.ADMIN_PASSWORD;
    const prevCors = process.env.CORS_ORIGINS;
    const prevTgAllowed = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
    const prevTgOpen = process.env.ALLOW_OPEN_TELEGRAM_BOT;

    try {
      process.env.ADMIN_PASSWORD = "unit-test-strong-secret";
      delete process.env.CORS_ORIGINS;

      // Disallowed third-party origin must not get ACAO and preflight returns 403
      const evilPreflight = await routeRequest(
        new Request("http://localhost/api/health", {
          method: "OPTIONS",
          headers: { Origin: "https://evil.example" },
        })
      );
      expect(evilPreflight.status).toBe(403);
      expect(evilPreflight.headers.get("Access-Control-Allow-Origin")).toBeNull();

      const evilGet = await routeRequest(
        new Request("http://localhost/health", {
          headers: { Origin: "https://evil.example" },
        })
      );
      expect(evilGet.headers.get("Access-Control-Allow-Origin")).toBeNull();

      // Allowed frontend origin receives matching ACAO + Vary: Origin
      const devCorsGet = await routeRequest(
        new Request("http://localhost/health", {
          headers: { Origin: "http://localhost:3000" },
        })
      );
      expect(devCorsGet.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(devCorsGet.headers.get("Vary")).toBe("Origin");

      // Brute-force wrong password attempts lock out IP with 429
      for (let i = 0; i < 5; i++) {
        const failRes = await routeRequest(
          new Request("http://localhost/api/admin/verify", {
            method: "POST",
            headers: {
              "X-Forwarded-For": "203.0.113.10",
              "X-Admin-Password": `wrong-${i}`,
            },
          })
        );
        expect(failRes.status).toBe(401);
      }
      const lockedRes = await routeRequest(
        new Request("http://localhost/api/admin/verify", {
          method: "POST",
          headers: {
            "X-Forwarded-For": "203.0.113.10",
            "X-Admin-Password": "unit-test-strong-secret",
          },
        })
      );
      expect(lockedRes.status).toBe(429);

      // Static asset resolution rejects traversal and sibling prefix paths
      expect(resolveStaticAssetPath("/assets/app.js", "/tmp/public")).not.toBeNull();
      expect(resolveStaticAssetPath("/%2e%2e/public-secret/key.txt", "/tmp/public")).toBeNull();
      expect(resolveStaticAssetPath("/../.env", "/tmp/public")).toBeNull();

      // Backslash-encoded traversal bypasses WhatWG URL normalization and must be blocked with 403
      const encodedBackslashRes = await routeRequest(
        new Request("http://localhost/..%5cpackage.json")
      );
      expect(encodedBackslashRes.status).toBe(403);

      // Standard URL dot-segment normalization stays confined inside PUBLIC_DIR (never leaks root package.json)
      const normalizedDotRes = await routeRequest(
        new Request("http://localhost/%2e%2e/package.json")
      );
      expect(await normalizedDotRes.text()).not.toContain('"senti-v2"');

      // Telegram fails closed when TELEGRAM_ALLOWED_CHAT_IDS is unset
      delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
      delete process.env.ALLOW_OPEN_TELEGRAM_BOT;
      expect(isTelegramChatAuthorized(999111)).toBe(false);
      await processTelegramUpdate({
        update_id: 1,
        message: { chat: { id: 999111, username: "intruder" }, text: "/start" },
      });
      expect(getActiveTelegramChatIds()).toEqual([]);

      // Allowlisted chat ID can subscribe
      process.env.TELEGRAM_ALLOWED_CHAT_IDS = "123456";
      expect(isTelegramChatAuthorized(123456)).toBe(true);
      expect(isTelegramChatAuthorized(999111)).toBe(false);
      await processTelegramUpdate({
        update_id: 2,
        message: { chat: { id: 123456, username: "owner" }, text: "/start" },
      });
      expect(getActiveTelegramChatIds()).toEqual([123456]);

      // HTML escaping neutralizes markup injection in Telegram messages
      expect(escapeTelegramHtml("SL <script> & > \"test\"")).toBe(
        "SL &lt;script&gt; &amp; &gt; &quot;test&quot;"
      );
    } finally {
      if (prevPw === undefined) delete process.env.ADMIN_PASSWORD;
      else process.env.ADMIN_PASSWORD = prevPw;
      if (prevCors === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prevCors;
      if (prevTgAllowed === undefined) delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
      else process.env.TELEGRAM_ALLOWED_CHAT_IDS = prevTgAllowed;
      if (prevTgOpen === undefined) delete process.env.ALLOW_OPEN_TELEGRAM_BOT;
      else process.env.ALLOW_OPEN_TELEGRAM_BOT = prevTgOpen;
    }
  });
});
