/**
 * Execution Desk:
 * - Two-Stage Active Signal State Machine (pending -> entry_hit -> TP1 breakeven+0.5% -> +5% trailing stop -> target_hit/sl_hit/expired/cancelled)
 * - Intraday Anomaly Detection
 * - Walk-Forward Backtester & Equity Curve Engine (Baseline vs Trailing Stop)
 * - Telegram Notifier & Command Poller
 */

import { roundToIdxTick } from "@protocol/idx-rules.ts";
import type {
  BacktestMetrics,
  BacktestPayload,
  BacktestRequest,
  BacktestTrade,
  PriceBar,
  SignalRecord,
} from "@protocol/contracts.ts";
import { getWibDateString, fetchPriceHistory } from "./market-gateway.ts";
import {
  getActiveSignals,
  getActiveTelegramChatIds,
  getSignalsForBacktest,
  getStoredPriceBars,
  getStoredSettings,
  markSignalTp1Hit,
  updateSignalStatus,
  updateSignalStopLoss,
  upsertTelegramUser,
} from "./persistence.ts";

// ============================================================================
// Telegram Bot & Command Poller
// ============================================================================

function getTelegramToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token && token.length > 10 ? token : null;
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getAllowedTelegramChatIds(): Set<number> | null {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n !== 0);
  return ids.length > 0 ? new Set(ids) : null;
}

export function isTelegramChatAuthorized(chatId: number): boolean {
  if (!Number.isSafeInteger(chatId) || chatId === 0) return false;
  const allowlist = getAllowedTelegramChatIds();
  if (allowlist) return allowlist.has(chatId);
  return process.env.ALLOW_OPEN_TELEGRAM_BOT?.trim() === "true";
}

export async function sendTelegramMessage(
  chatId: number | string,
  html: string
): Promise<boolean> {
  const token = getTelegramToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function broadcastTelegramAlert(html: string): Promise<number> {
  const token = getTelegramToken();
  if (!token) return 0;
  const chatIds = getActiveTelegramChatIds().filter((cid) => isTelegramChatAuthorized(cid));
  let sent = 0;
  for (const cid of chatIds) {
    if (await sendTelegramMessage(cid, html)) sent++;
  }
  return sent;
}

export async function notifyNewBuySignals(signals: SignalRecord[]): Promise<void> {
  if (signals.length === 0 || !getTelegramToken()) return;
  const lines = signals.map((s) => {
    const rr =
      s.entryPrice > s.stopLoss
        ? ((s.targetPrice - s.entryPrice) / (s.entryPrice - s.stopLoss)).toFixed(2)
        : "N/A";
    const ticker = escapeTelegramHtml(s.ticker);
    const setupType = escapeTelegramHtml(s.setupType);
    const orderType = escapeTelegramHtml(s.orderType);
    return [
      `🟢 <b>${ticker}</b> [${setupType}] · Score <b>${s.overallScore}</b>/100`,
      `   Order: ${orderType} @ <b>Rp ${s.entryPrice.toLocaleString("id-ID")}</b>`,
      `   SL: Rp ${s.stopLoss.toLocaleString("id-ID")} | TP1: Rp ${s.targetPrice1.toLocaleString("id-ID")} | TP2: Rp ${s.targetPrice.toLocaleString("id-ID")} (R:R ${rr}x)`,
    ].join("\n");
  });
  await broadcastTelegramAlert(
    `📈 <b>MILICENT IDX · SINYAL BUY BARU</b>\n\n${lines.join("\n\n")}`
  );
}

export async function notifySignalTransition(
  ticker: string,
  kind: "ENTRY" | "TP1" | "TP2" | "SL" | "TRAIL" | "CANCEL" | "ANOMALY",
  price: number,
  detail: string
): Promise<void> {
  if (!getTelegramToken()) return;
  const icons: Record<typeof kind, string> = {
    ENTRY: "📍",
    TP1: "✅",
    TP2: "🎯",
    TRAIL: "🛡️",
    SL: "🛑",
    CANCEL: "⚠️",
    ANOMALY: "⚡",
  };
  const safeTicker = escapeTelegramHtml(ticker);
  const safeKind = escapeTelegramHtml(kind);
  const safeDetail = escapeTelegramHtml(detail);
  await broadcastTelegramAlert(
    `${icons[kind]} <b>${safeTicker}</b> (${safeKind}) @ Rp ${price.toLocaleString("id-ID")}\n${safeDetail}`
  );
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; username?: string; first_name?: string };
    text?: string;
  };
}

export async function processTelegramUpdate(upd: TelegramUpdate): Promise<void> {
  const msg = upd.message;
  if (!msg?.text) return;
  const chatId = Number(msg.chat.id);
  const cmd = msg.text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

  if (!isTelegramChatAuthorized(chatId)) {
    if (cmd === "/start" || cmd === "/stop" || cmd === "/signals") {
      await sendTelegramMessage(
        chatId,
        "⛔ Akses ditolak. Bot ini privat: tambahkan Chat ID Anda ke TELEGRAM_ALLOWED_CHAT_IDS di .env."
      );
    }
    return;
  }

  if (cmd === "/start") {
    upsertTelegramUser({
      chatId,
      username: msg.chat.username,
      firstName: msg.chat.first_name,
      isActive: true,
    });
    await sendTelegramMessage(
      chatId,
      "👋 Selamat datang di <b>Milicent IDX</b>! Notifikasi sinyal IDX harian & alert aktif.\nPerintah: /signals · /stop"
    );
  } else if (cmd === "/stop") {
    upsertTelegramUser({ chatId, isActive: false });
    await sendTelegramMessage(
      chatId,
      "🔕 Notifikasi sinyal dihentikan. Ketik /start kapan saja untuk aktifkan kembali."
    );
  } else if (cmd === "/signals") {
    const active = getActiveSignals();
    if (active.length === 0) {
      await sendTelegramMessage(chatId, "Belum ada sinyal aktif saat ini.");
    } else {
      const list = active
        .slice(0, 10)
        .map(
          (s) =>
            `• <b>${escapeTelegramHtml(s.ticker)}</b> [${escapeTelegramHtml(s.status)}] Entry ${s.entryPrice} | SL ${s.stopLoss} | TP1 ${s.targetPrice1} | TP2 ${s.targetPrice}`
        )
        .join("\n");
      await sendTelegramMessage(chatId, `📊 <b>Sinyal Aktif (${active.length})</b>\n\n${list}`);
    }
  }
}

class TelegramPollerService {
  private running = false;
  private offset = 0;

  isEnabled(): boolean {
    return (
      Boolean(getTelegramToken()) &&
      process.env.TELEGRAM_POLLING === "true" &&
      (getAllowedTelegramChatIds() !== null || process.env.ALLOW_OPEN_TELEGRAM_BOT?.trim() === "true")
    );
  }

  start(): void {
    if (!this.isEnabled() || this.running) return;
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const token = getTelegramToken();
      if (!token) break;
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${this.offset}`
        );
        if (res.status === 409) {
          await new Promise((r) => setTimeout(r, 15_000));
          continue;
        }
        if (res.ok) {
          const payload = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
          for (const upd of payload.result ?? []) {
            this.offset = Math.max(this.offset, upd.update_id + 1);
            await processTelegramUpdate(upd);
          }
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

export const telegramPoller = new TelegramPollerService();

// ============================================================================
// Active Signal State Machine & Anomaly Monitor
// ============================================================================

export interface LiveQuoteInput {
  price: number;
  high?: number;
  low?: number;
  volume?: number;
  changePct?: number;
  avgVolume20?: number;
}

export type SignalTransition =
  | { type: "NONE" }
  | { type: "ENTRY_HIT"; price: number }
  | { type: "CANCEL_GAP_DOWN"; exitPrice: number; reason: string }
  | { type: "SL_HIT"; exitPrice: number; profitLossPct: number }
  | { type: "TP2_HIT"; exitPrice: number; profitLossPct: number }
  | { type: "TP1_HIT"; breakevenSl: number; price: number }
  | { type: "TRAIL_SL"; newStopLoss: number; price: number }
  | { type: "EXPIRED"; exitPrice: number; profitLossPct: number };

function calcPnlPct(entry: number, exit: number): number {
  if (entry <= 0) return 0;
  return Number((((exit - entry) / entry) * 100).toFixed(2));
}

function tradingDaysElapsed(fromDate: string, toDate: string): number {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  const diffDays = Math.floor((end - start) / 86400000);
  return Math.max(0, Math.round((diffDays * 5) / 7));
}

export function evaluateSignalTransition(
  signal: SignalRecord,
  quote: LiveQuoteInput,
  todayWib = getWibDateString()
): SignalTransition {
  if (!Number.isFinite(quote.price) || quote.price <= 0) return { type: "NONE" };
  if (signal.status !== "pending" && signal.status !== "entry_hit") return { type: "NONE" };

  const price = quote.price;
  const high = Math.max(price, quote.high ?? price);
  const low = Math.min(price, quote.low ?? price);

  // Stage 1: Pending Order (waiting for fill)
  if (signal.status === "pending") {
    // Gap-down straight below stop-loss without reaching limit entry
    if (
      signal.orderType === "LIMIT" &&
      high < signal.entryPrice &&
      low <= signal.stopLoss
    ) {
      return {
        type: "CANCEL_GAP_DOWN",
        exitPrice: price,
        reason: `Gap-down open ke Rp ${low} (< SL Rp ${signal.stopLoss}) sebelum LIMIT entry Rp ${signal.entryPrice} terisi`,
      };
    }

    const pendingDays = tradingDaysElapsed(signal.signalDate, todayWib);
    if (pendingDays >= 5) {
      return {
        type: "EXPIRED",
        exitPrice: price,
        profitLossPct: 0,
      };
    }

    const limitTouched =
      low <= signal.entryPrice &&
      (high >= signal.entryPrice || price > signal.stopLoss);
    if (signal.orderType === "MARKET" || limitTouched) {
      return { type: "ENTRY_HIT", price: signal.orderType === "MARKET" ? price : signal.entryPrice };
    }
    return { type: "NONE" };
  }

  // Stage 2: Entered Position (tracking SL / TP1 breakeven / +5% trailing / TP2 / MaxHold)
  if (low <= signal.stopLoss) {
    return {
      type: "SL_HIT",
      exitPrice: signal.stopLoss,
      profitLossPct: calcPnlPct(signal.entryPrice, signal.stopLoss),
    };
  }

  if (high >= signal.targetPrice) {
    return {
      type: "TP2_HIT",
      exitPrice: signal.targetPrice,
      profitLossPct: calcPnlPct(signal.entryPrice, signal.targetPrice),
    };
  }

  if (!signal.tp1HitDate && signal.targetPrice1 > signal.entryPrice && high >= signal.targetPrice1) {
    const breakevenSl = roundToIdxTick(
      Math.max(signal.stopLoss, signal.entryPrice * 1.005),
      "ceil"
    );
    return {
      type: "TP1_HIT",
      breakevenSl,
      price: high,
    };
  }

  if (high >= signal.entryPrice * 1.05) {
    const candidateTrail = roundToIdxTick(high * 0.965, "floor");
    const minValidTrail = roundToIdxTick(signal.entryPrice * 1.01, "ceil");
    const targetTrail = Math.max(candidateTrail, minValidTrail);
    if (targetTrail > signal.stopLoss && targetTrail < price) {
      return {
        type: "TRAIL_SL",
        newStopLoss: targetTrail,
        price,
      };
    }
  }

  const heldDays = tradingDaysElapsed(signal.entryHitDate ?? signal.signalDate, todayWib);
  if (signal.maxHoldDays > 0 && heldDays >= signal.maxHoldDays) {
    return {
      type: "EXPIRED",
      exitPrice: price,
      profitLossPct: calcPnlPct(signal.entryPrice, price),
    };
  }

  return { type: "NONE" };
}

export interface TrackerSyncSummary {
  checkedCount: number;
  updatedCount: number;
  entriesFilled: string[];
  tp1Hits: string[];
  tp2Hits: string[];
  slHits: string[];
  trailingUpdates: string[];
  cancelled: string[];
  expired: string[];
  anomalies: Array<{ ticker: string; price: number; changePct: number; volumeRatio: number }>;
}

const recentAnomalyAlerts = new Map<string, number>();

export async function syncActiveSignals(
  quotesMap: Map<string, LiveQuoteInput>,
  notify = true,
  todayWib = getWibDateString()
): Promise<TrackerSyncSummary> {
  const priceMap = new Map<string, number>();
  for (const [ticker, q] of quotesMap.entries()) {
    priceMap.set(ticker, q.price);
  }

  const active = getActiveSignals(priceMap);
  const settings = getStoredSettings();

  const summary: TrackerSyncSummary = {
    checkedCount: active.length,
    updatedCount: 0,
    entriesFilled: [],
    tp1Hits: [],
    tp2Hits: [],
    slHits: [],
    trailingUpdates: [],
    cancelled: [],
    expired: [],
    anomalies: [],
  };

  for (const sig of active) {
    const quote = quotesMap.get(sig.ticker);
    if (!quote) continue;

    const volRatio =
      quote.volume && quote.avgVolume20 && quote.avgVolume20 > 0
        ? quote.volume / quote.avgVolume20
        : 1;
    const changePct = quote.changePct ?? 0;
    if (
      Math.abs(changePct) >= settings.anomaly.priceChangePct &&
      volRatio >= settings.anomaly.volumeMultiplier
    ) {
      summary.anomalies.push({
        ticker: sig.ticker,
        price: quote.price,
        changePct,
        volumeRatio: Number(volRatio.toFixed(2)),
      });
      const lastAlert = recentAnomalyAlerts.get(sig.ticker) ?? 0;
      if (notify && Date.now() - lastAlert > 60 * 60 * 1000) {
        recentAnomalyAlerts.set(sig.ticker, Date.now());
        await notifySignalTransition(
          sig.ticker,
          "ANOMALY",
          quote.price,
          `Lonjakan ${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}% dengan volume ${volRatio.toFixed(1)}x`
        );
      }
    }

    const transition = evaluateSignalTransition(sig, quote, todayWib);
    switch (transition.type) {
      case "ENTRY_HIT":
        updateSignalStatus(sig.id, "entry_hit", undefined, undefined, todayWib);
        summary.entriesFilled.push(sig.ticker);
        summary.updatedCount++;
        if (notify) {
          await notifySignalTransition(
            sig.ticker,
            "ENTRY",
            transition.price,
            `Order ${sig.orderType} terisi — SL Rp ${sig.stopLoss.toLocaleString("id-ID")}, TP1 Rp ${sig.targetPrice1.toLocaleString("id-ID")}`
          );
        }
        break;
      case "CANCEL_GAP_DOWN":
        updateSignalStatus(sig.id, "cancelled", transition.exitPrice, 0, todayWib);
        summary.cancelled.push(sig.ticker);
        summary.updatedCount++;
        if (notify) {
          await notifySignalTransition(sig.ticker, "CANCEL", transition.exitPrice, transition.reason);
        }
        break;
      case "SL_HIT":
        updateSignalStatus(sig.id, "sl_hit", transition.exitPrice, transition.profitLossPct, todayWib);
        summary.slHits.push(sig.ticker);
        summary.updatedCount++;
        if (notify) {
          await notifySignalTransition(
            sig.ticker,
            "SL",
            transition.exitPrice,
            `Stop Loss tersentuh (${transition.profitLossPct.toFixed(2)}%)`
          );
        }
        break;
      case "TP2_HIT":
        updateSignalStatus(sig.id, "target_hit", transition.exitPrice, transition.profitLossPct, todayWib);
        summary.tp2Hits.push(sig.ticker);
        summary.updatedCount++;
        if (notify) {
          await notifySignalTransition(
            sig.ticker,
            "TP2",
            transition.exitPrice,
            `Target utama tercapai! PnL +${transition.profitLossPct.toFixed(2)}%`
          );
        }
        break;
      case "TP1_HIT":
        markSignalTp1Hit(sig.id, transition.breakevenSl, todayWib);
        summary.tp1Hits.push(sig.ticker);
        summary.updatedCount++;
        if (notify) {
          await notifySignalTransition(
            sig.ticker,
            "TP1",
            transition.price,
            `TP1 tercapai — SL dikunci breakeven Rp ${transition.breakevenSl.toLocaleString("id-ID")}`
          );
        }
        break;
      case "TRAIL_SL":
        updateSignalStopLoss(sig.id, transition.newStopLoss);
        summary.trailingUpdates.push(sig.ticker);
        summary.updatedCount++;
        if (notify) {
          await notifySignalTransition(
            sig.ticker,
            "TRAIL",
            transition.price,
            `Trailing Stop naik ke Rp ${transition.newStopLoss.toLocaleString("id-ID")}`
          );
        }
        break;
      case "EXPIRED":
        updateSignalStatus(sig.id, "expired", transition.exitPrice, transition.profitLossPct, todayWib);
        summary.expired.push(sig.ticker);
        summary.updatedCount++;
        break;
      default:
        break;
    }
  }

  return summary;
}

// ============================================================================
// Walk-Forward Backtester & Equity Curve
// ============================================================================

export function simulateSignalTrade(
  signal: Pick<
    SignalRecord,
    "ticker" | "signalDate" | "orderType" | "entryPrice" | "stopLoss" | "targetPrice" | "maxHoldDays"
  >,
  bars: PriceBar[],
  rule: "baseline" | "trailing",
  opts: Pick<
    BacktestRequest,
    "feePct" | "slippagePct" | "trailingActivationPct" | "trailingDistancePct"
  >
): BacktestTrade {
  const futureBars = bars.filter((b) => b.date >= signal.signalDate);
  if (futureBars.length === 0) {
    return {
      ticker: signal.ticker,
      signalDate: signal.signalDate,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      targetPrice: signal.targetPrice,
      outcome: "unfilled",
      entryDate: null,
      exitDate: null,
      exitPrice: null,
      netReturnPct: null,
      holdingDays: 0,
    };
  }

  let entryIdx = -1;
  let actualEntry = signal.entryPrice;
  const maxWaitBars = Math.min(3, futureBars.length);

  for (let i = 0; i < maxWaitBars; i++) {
    const b = futureBars[i]!;
    if (signal.orderType === "MARKET") {
      entryIdx = i;
      actualEntry = b.open;
      break;
    }
    if (b.low <= signal.entryPrice && b.high >= signal.entryPrice) {
      entryIdx = i;
      actualEntry = signal.entryPrice;
      break;
    }
    if (b.open < signal.entryPrice && b.open > signal.stopLoss) {
      entryIdx = i;
      actualEntry = b.open;
      break;
    }
  }

  if (entryIdx === -1) {
    return {
      ticker: signal.ticker,
      signalDate: signal.signalDate,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      targetPrice: signal.targetPrice,
      outcome: "unfilled",
      entryDate: null,
      exitDate: null,
      exitPrice: null,
      netReturnPct: null,
      holdingDays: 0,
    };
  }

  const entrySlippage = actualEntry * (1 + opts.slippagePct / 100);
  let activeStop = signal.stopLoss;
  let peakHigh = entrySlippage;
  let exitDate = futureBars[entryIdx]!.date;
  let exitPrice = futureBars[entryIdx]!.close;
  let outcome: BacktestTrade["outcome"] = "expired";

  const endIdx = Math.min(futureBars.length - 1, entryIdx + signal.maxHoldDays);
  for (let i = entryIdx + 1; i <= endIdx; i++) {
    const b = futureBars[i]!;
    if (b.low <= activeStop) {
      outcome = activeStop > signal.stopLoss ? "trailing_sl_hit" : "sl_hit";
      exitDate = b.date;
      exitPrice = activeStop * (1 - opts.slippagePct / 100);
      break;
    }
    if (b.high >= signal.targetPrice) {
      outcome = "target_hit";
      exitDate = b.date;
      exitPrice = signal.targetPrice;
      break;
    }
    if (rule === "trailing" && b.high > peakHigh) {
      peakHigh = b.high;
      const gainPct = ((peakHigh - entrySlippage) / entrySlippage) * 100;
      if (gainPct >= opts.trailingActivationPct) {
        activeStop = Math.max(
          activeStop,
          entrySlippage,
          peakHigh * (1 - opts.trailingDistancePct / 100)
        );
      }
    }
    if (i === endIdx) {
      outcome = "expired";
      exitDate = b.date;
      exitPrice = b.close;
    }
  }

  const grossRet = ((exitPrice - entrySlippage) / entrySlippage) * 100;
  const netReturnPct = Number((grossRet - opts.feePct * 2).toFixed(2));
  const holdingDays = Math.max(
    1,
    Math.round(
      (Date.parse(`${exitDate}T00:00:00Z`) - Date.parse(`${futureBars[entryIdx]!.date}T00:00:00Z`)) /
        86400000
    )
  );

  return {
    ticker: signal.ticker,
    signalDate: signal.signalDate,
    entryPrice: Number(entrySlippage.toFixed(0)),
    stopLoss: Number(activeStop.toFixed(0)),
    targetPrice: signal.targetPrice,
    outcome,
    entryDate: futureBars[entryIdx]!.date,
    exitDate,
    exitPrice: Number(exitPrice.toFixed(0)),
    netReturnPct,
    holdingDays,
  };
}

export function computeMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const filled = trades.filter((t) => t.outcome !== "unfilled" && t.netReturnPct !== null);
  const wins = filled.filter((t) => t.netReturnPct! > 0);
  const losses = filled.filter((t) => t.netReturnPct! <= 0);

  const grossWin = wins.reduce((s, t) => s + t.netReturnPct!, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netReturnPct!, 0));
  const totalReturnPct = Number(filled.reduce((s, t) => s + t.netReturnPct!, 0).toFixed(2));

  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  for (const t of filled) {
    equity *= 1 + t.netReturnPct! / 100;
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    totalSignals: trades.length,
    filledTrades: filled.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: filled.length > 0 ? Number(((wins.length / filled.length) * 100).toFixed(1)) : null,
    avgReturnPct: filled.length > 0 ? Number((totalReturnPct / filled.length).toFixed(2)) : null,
    totalReturnPct,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : null,
    maxDrawdownPct: Number(maxDd.toFixed(2)),
  };
}

export async function runBacktestSimulation(options: BacktestRequest): Promise<BacktestPayload> {
  const signals = getSignalsForBacktest(options.startDate, options.endDate, options.ticker);
  const barsByTicker = new Map<string, PriceBar[]>();

  for (const ticker of new Set(signals.map((s) => s.ticker))) {
    const res = await fetchPriceHistory(ticker, "1y");
    if (res.success && res.data && res.data.length > 0) {
      barsByTicker.set(ticker, res.data);
    } else {
      barsByTicker.set(ticker, getStoredPriceBars(ticker));
    }
  }

  const baselineTrades = signals.map((s) =>
    simulateSignalTrade(s, barsByTicker.get(s.ticker) ?? [], "baseline", options)
  );
  const trailingTrades = signals.map((s) =>
    simulateSignalTrade(s, barsByTicker.get(s.ticker) ?? [], "trailing", options)
  );

  let baseEq = 100;
  let trailEq = 100;
  const equityCurve = [{ date: options.startDate, baselineEquity: 100, trailingEquity: 100 }];

  for (let i = 0; i < baselineTrades.length; i++) {
    const bt = baselineTrades[i]!;
    const tt = trailingTrades[i]!;
    if (bt.netReturnPct !== null) baseEq *= 1 + bt.netReturnPct / 100;
    if (tt.netReturnPct !== null) trailEq *= 1 + tt.netReturnPct / 100;
    equityCurve.push({
      date: bt.exitDate ?? bt.signalDate,
      baselineEquity: Number(baseEq.toFixed(2)),
      trailingEquity: Number(trailEq.toFixed(2)),
    });
  }

  return {
    options,
    baseline: { metrics: computeMetrics(baselineTrades), trades: baselineTrades },
    trailing: { metrics: computeMetrics(trailingTrades), trades: trailingTrades },
    equityCurve,
  };
}
