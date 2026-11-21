/**
 * Thesis Forge:
 * - OpenAI-Compatible Antigravity LLM Client (filter/decision model routing, Zod retry & 429 backoff)
 * - Hybrid Quant + AI Stock Prompt Builder
 * - Hard Risk Guardrails (SL floor, R:R gate, Contrarian Swing vs Downtrend Avoid, RSI>75, Low-Vol Fakeout, Distribution, Anti-ARA)
 * - Deterministic Quant Fallback when LLM proxy is offline
 */

import OpenAI from "openai";
import { z } from "zod";
import {
  computeIdxPositionSizing,
  getIdxAutoRejectionLimits,
  roundToIdxTick,
  suggestRiskProfile,
} from "@protocol/idx-rules.ts";
import type {
  FundamentalSnapshot,
  MacroContext,
  OrderType,
  PositionSizingSummary,
  QuantBreakdown,
  SetupType,
  SignalAction,
  TechnicalSnapshot,
} from "@protocol/contracts.ts";
import { evaluateQuant, type QuantEvaluation } from "./quant-radar.ts";

// ============================================================================
// LLM Client & Model Routing
// ============================================================================

export type LLMRole = "default" | "filter" | "decision";

export interface GenerateJsonOptions<T> {
  prompt: string;
  systemInstruction: string;
  schema: z.ZodType<T>;
  role?: LLMRole;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface GenerateJsonResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  modelUsed: string;
  tokensUsed: number;
}

const DEFAULT_MODEL = "gemini-3-flash";
const MAX_ATTEMPTS = 3;

export function resolveModelForRole(
  role: LLMRole = "default",
  env: Record<string, string | undefined> = process.env
): string {
  const base = env.OPENAI_MODEL?.trim() || env.ANTIGRAVITY_MODEL?.trim() || DEFAULT_MODEL;
  if (role === "filter") {
    return env.OPENAI_FILTER_MODEL?.trim() || env.ANTIGRAVITY_FILTER_MODEL?.trim() || base;
  }
  if (role === "decision") {
    return env.OPENAI_DECISION_MODEL?.trim() || env.ANTIGRAVITY_DECISION_MODEL?.trim() || base;
  }
  return base;
}

export function getLlmBaseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL?.trim() ||
    process.env.ANTIGRAVITY_BASE_URL?.trim() ||
    "http://127.0.0.1:8045/v1"
  ).replace(/\/+$/, "");
}

function getApiKey(): string {
  return (
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTIGRAVITY_API_KEY?.trim() ||
    "dummy-key"
  );
}

export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  const firstObj = candidate.indexOf("{");
  const lastObj = candidate.lastIndexOf("}");
  if (firstObj !== -1 && lastObj > firstObj) {
    return candidate.slice(firstObj, lastObj + 1);
  }
  const firstArr = candidate.indexOf("[");
  const lastArr = candidate.lastIndexOf("]");
  if (firstArr !== -1 && lastArr > firstArr) {
    return candidate.slice(firstArr, lastArr + 1);
  }
  return candidate;
}

function isRateLimitError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "status" in err) {
    if ((err as { status?: number }).status === 429) return true;
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted")
  );
}

function isUnreachableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("unable to connect") ||
    msg.includes("connection error") ||
    msg.includes("fetch failed")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateJson<T>(
  opts: GenerateJsonOptions<T>
): Promise<GenerateJsonResult<T>> {
  const model = opts.model?.trim() || resolveModelForRole(opts.role ?? "default");
  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS);
  const client = new OpenAI({
    apiKey: getApiKey(),
    baseURL: getLlmBaseUrl(),
    timeout: opts.timeoutMs ?? 25_000,
    maxRetries: 0,
  });

  let lastError = "Unknown LLM error";
  let currentPrompt = opts.prompt;
  let totalTokens = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: opts.temperature ?? 0.2,
        messages: [
          { role: "system", content: opts.systemInstruction },
          { role: "user", content: currentPrompt },
        ],
      });

      totalTokens += completion.usage?.total_tokens ?? 0;
      const content = completion.choices[0]?.message?.content ?? "";
      if (!content.trim()) throw new Error("Empty LLM completion");

      const parsedJson = JSON.parse(extractJsonString(content)) as unknown;
      const validated = opts.schema.safeParse(parsedJson);
      if (!validated.success) {
        const issues = validated.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new Error(`Schema mismatch: ${issues}`);
      }

      return {
        success: true,
        data: validated.data,
        error: null,
        modelUsed: model,
        tokensUsed: totalTokens,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (isUnreachableError(err)) {
        break;
      }
      if (attempt < maxAttempts) {
        const delayMs = isRateLimitError(err) ? 2000 * attempt : 600 * attempt;
        if (lastError.startsWith("Schema mismatch") || err instanceof SyntaxError) {
          currentPrompt = `${opts.prompt}\n\nIMPORTANT FIX REQUIRED FROM PREVIOUS ATTEMPT:\nYour JSON failed validation (${lastError}). Respond ONLY with strictly valid raw JSON matching all required fields.`;
        }
        await sleep(delayMs);
      }
    }
  }

  return {
    success: false,
    data: null,
    error: lastError,
    modelUsed: model,
    tokensUsed: totalTokens,
  };
}

export async function checkLlmConnectivity(): Promise<{
  ok: boolean;
  baseUrl: string;
  model: string;
}> {
  const baseUrl = getLlmBaseUrl();
  const model = resolveModelForRole("decision");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      signal: controller.signal,
    });
    return { ok: res.ok, baseUrl, model };
  } catch {
    return { ok: false, baseUrl, model };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Hybrid Analyzer & Guardrails
// ============================================================================

export interface TickerNewsContext {
  mentionCount: number;
  weightedSentiment: number;
  score0to100: number;
  catalysts: string[];
  headlines: Array<{ title: string; portal: string; sentiment: number; publishedAt: string | null }>;
}

export interface RiskThresholdsConfig {
  highScoreRR: number;
  standardScoreRR: number;
}

export interface HybridAnalysisInput {
  ticker: string;
  currentPrice: number;
  previousClose: number;
  priceChangePct: number;
  technical: TechnicalSnapshot;
  fundamental: FundamentalSnapshot | null;
  macro: MacroContext | null;
  news: TickerNewsContext | null;
  activeSignalContext?: {
    entryPrice: number;
    stopLoss: number;
    targetPrice1: number;
    targetPrice: number;
    signalDate: string;
  } | null;
}

export interface HybridAnalysisOutput {
  ticker: string;
  action: SignalAction;
  confidence: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice1: number;
  targetPrice: number;
  riskRewardRatio: number;
  maxHoldDays: number;
  setupType: SetupType;
  orderType: OrderType;
  sentimentScore: number;
  fundamentalScore: number;
  technicalScore: number;
  overallScore: number;
  quant: QuantBreakdown;
  sizing: PositionSizingSummary;
  newsSummary: string;
  fundamentalSummary: string;
  technicalSummary: string;
  analysisSummary: string;
  guardrailReason: string | null;
  mode: "HYBRID" | "QUANT_FALLBACK";
  modelUsed: string;
}

const AiStockResponseSchema = z.object({
  action: z.enum(["BUY", "WAIT", "HOLD", "AVOID"]),
  confidence: z.number().min(1).max(10),
  entryPrice: z.number().positive(),
  stopLoss: z.number().positive(),
  targetPrice1: z.number().positive().optional(),
  targetPrice: z.number().positive(),
  maxHoldDays: z.number().int().min(3).max(45).default(14),
  setupType: z
    .enum(["BREAKOUT", "PULLBACK", "CONTRARIAN_BOUNCE", "SILENT_ACCUMULATION", "NONE"])
    .default("PULLBACK"),
  orderType: z.enum(["LIMIT", "MARKET"]).default("LIMIT"),
  scores: z.object({
    sentiment: z.number().min(0).max(100),
    fundamental: z.number().min(0).max(100),
    technical: z.number().min(0).max(100),
    overall: z.number().min(0).max(100),
  }),
  reasoning: z.object({
    news: z.string(),
    fundamental: z.string(),
    technical: z.string(),
    summary: z.string(),
  }),
});

export type RawAiStockDecision = z.infer<typeof AiStockResponseSchema>;

const SYSTEM_INSTRUCTION = `You are a senior IDX (Indonesia Stock Exchange / IHSG) swing & position trading strategist.
Your job is to evaluate technical structure, institutional flow, macro regime, fundamentals, and news catalysts to produce disciplined IDX trade plans.

Core Rules:
1. Entry Price Discipline:
   - Default to a "LIMIT" pullback entry 1.5%-4% BELOW currentPrice aligned with SMA20, VWAP20, or key support.
   - NEVER lazily copy currentPrice unless orderType is "MARKET" on a confirmed high-volume breakout (Volume Ratio >= 1.3x) OR price is already sitting directly on support (within 1%).
   - When action is WAIT, HOLD, or AVOID, still output the ideal disciplined pullback entryPrice to wait for.
2. Risk Control & IDX Tick Alignment:
   - Stop loss MUST sit at least max(1.0 * ATR14, 3%) below entryPrice and below structural support.
   - Target >= 2.0x R:R to main swing targetPrice, plus partial profit targetPrice1 (~1.25x risk).
   - Respect IDX tick increments (<200: 1, 200-<500: 2, 500-<2000: 5, 2000-<5000: 10, >=5000: 25).
3. Contrarian Swing Rule:
   - In a BEARISH trend, do NOT blindly return AVOID if institutional flow is ACCUMULATING (flow >= 1.0x or CMF >= 0.05), momentum is shifting (MACD hist > 0 or RSI <= 35), and R:R >= 2.0x — evaluate fairly as a contrarian swing.
   - Reject falling knives with heavy distribution!
4. Respond ONLY with strictly valid JSON matching all required fields, with crisp Bahasa Indonesia explanations matching your exact price levels.`;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function fmtOpt(v: number | null | undefined, digits = 2): string {
  return v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(digits) : "N/A";
}

export function buildStockPrompt(input: HybridAnalysisInput, quant: QuantEvaluation): string {
  const t = input.technical;
  const f = input.fundamental;
  const m = input.macro;
  const limits = getIdxAutoRejectionLimits(input.previousClose || input.currentPrice);

  const newsLines =
    input.news && input.news.headlines.length > 0
      ? input.news.headlines
          .map((h) => `- [${h.portal}] ${h.title} (sent=${h.sentiment.toFixed(2)})`)
          .join("\n")
      : "- Tidak ada berita emiten terbaru yang signifikan dalam beberapa hari terakhir.";

  const activeBlock = input.activeSignalContext
    ? `\nACTIVE POSITION: Entry Rp ${input.activeSignalContext.entryPrice}, SL Rp ${input.activeSignalContext.stopLoss}, TP1 Rp ${input.activeSignalContext.targetPrice1}, TP2 Rp ${input.activeSignalContext.targetPrice} (since ${input.activeSignalContext.signalDate})`
    : "";

  const ihsgLine =
    m && m.ihsgPrice !== null && m.ihsgChangePct !== null
      ? `${m.ihsgPrice.toFixed(0)} (${m.ihsgChangePct >= 0 ? "+" : ""}${m.ihsgChangePct.toFixed(2)}%)`
      : "N/A";
  const fxLine = m && m.usdIdrRate !== null ? `Rp ${m.usdIdrRate.toFixed(0)}` : "N/A";

  return `ANALYZE IDX TICKER: ${input.ticker}
CURRENT PRICE: Rp ${input.currentPrice} (Prev Close: Rp ${input.previousClose}, Daily Change: ${input.priceChangePct >= 0 ? "+" : ""}${input.priceChangePct.toFixed(2)}%, ARA: Rp ${limits.ara} / ARB: Rp ${limits.arb})

MACRO REGIME: ${m?.regime ?? "NEUTRAL"} (Score ${m?.regimeScore ?? 50}/100) | IHSG: ${ihsgLine} | USD/IDR: ${fxLine}

TECHNICAL & BANDARMOLOGY FLOW:
- Trend: ${t.trend} (Strength ${t.trendStrength}) | 3M Range: Rp ${t.low3Month} - Rp ${t.high3Month}
- SMA20: Rp ${fmtOpt(t.sma20, 0)} | SMA50: Rp ${fmtOpt(t.sma50, 0)} | EMA20: Rp ${fmtOpt(t.ema20, 0)}
- VWAP20: Rp ${fmtOpt(t.vwap20, 0)} (Distance: ${fmtOpt(t.priceToVwapPct, 2)}%) | ATR14: Rp ${fmtOpt(t.atr14, 0)}
- RSI14: ${fmtOpt(t.rsi14, 1)} | StochRSI: ${t.stochRsi?.state ?? "N/A"} | MACD Hist: ${fmtOpt(t.macd?.histogram, 2)} (${t.macd?.trend ?? "N/A"})
- 20D Vol Ratio: ${fmtOpt(t.volumeRatio, 2)}x | Daily Turnover: Rp ${(t.dailyTurnover / 1e9).toFixed(1)}B | BB Squeeze: ${t.bollinger?.isSqueeze ? "YES" : "NO"}
- 5D Institutional Flow: ${fmtOpt(t.volumeFlowRatio, 2)}x | CMF20: ${fmtOpt(t.cmf20, 3)} | OBV: ${t.obvTrend} (${t.obvDivergence}) | Status: ${t.accumulationStatus}
- Relative Strength vs IHSG: ${t.rsDiff20dPct >= 0 ? "+" : ""}${t.rsDiff20dPct.toFixed(2)}% (RS ${t.rsRating}, ${t.rsStatus})
- Supports: ${t.supports.map((s) => `Rp ${s}`).join(", ") || "N/A"} | Resistances: ${t.resistances.map((r) => `Rp ${r}`).join(", ") || "N/A"}

FUNDAMENTAL:
- Sector: ${f?.sector ?? "N/A"} | Market Cap: ${f?.marketCap ? `Rp ${(f.marketCap / 1e12).toFixed(2)}T` : "N/A"}
- P/E: ${fmtOpt(f?.peRatio, 2)}x | P/B: ${fmtOpt(f?.pbRatio, 2)}x | ROE: ${f?.roe !== null && f?.roe !== undefined ? `${(f.roe * 100).toFixed(1)}%` : "N/A"} | D/E: ${fmtOpt(f?.debtToEquity, 1)}
- Div Yield: ${f?.dividendYield !== null && f?.dividendYield !== undefined ? `${(f.dividendYield * 100).toFixed(2)}%` : "N/A"} | Rev Growth: ${f?.revenueGrowth !== null && f?.revenueGrowth !== undefined ? `${(f.revenueGrowth * 100).toFixed(1)}%` : "N/A"}

QUANT ANCHOR:
- Setup: ${quant.setupType} | Composite: ${quant.scores.composite}/100 (Tech ${quant.scores.technical}, Flow ${quant.scores.bandarmology}, Fund ${quant.scores.fundamental})
- Plan: Entry Rp ${quant.plan.entryPrice}, SL Rp ${quant.plan.stopLoss}, TP1 Rp ${quant.plan.targetPrice1}, TP2 Rp ${quant.plan.targetPrice} (R:R ${quant.plan.riskRewardRatio.toFixed(2)}x)

RECENT NEWS (Score ${input.news?.score0to100 ?? 50}/100, mentions=${input.news?.mentionCount ?? 0}):
${newsLines}${activeBlock}

Respond strictly as JSON:
{
  "action": "BUY" | "WAIT" | "HOLD" | "AVOID",
  "confidence": 1..10,
  "entryPrice": number,
  "stopLoss": number,
  "targetPrice1": number,
  "targetPrice": number,
  "maxHoldDays": number,
  "setupType": "BREAKOUT" | "PULLBACK" | "CONTRARIAN_BOUNCE" | "SILENT_ACCUMULATION" | "NONE",
  "orderType": "LIMIT" | "MARKET",
  "scores": { "sentiment": 0..100, "fundamental": 0..100, "technical": 0..100, "overall": 0..100 },
  "reasoning": { "news": "...", "fundamental": "...", "technical": "...", "summary": "..." }
}`;
}

export function applyHybridGuardrails(
  input: HybridAnalysisInput,
  quant: QuantEvaluation,
  rawDecision: RawAiStockDecision,
  thresholds: RiskThresholdsConfig = { highScoreRR: 1.5, standardScoreRR: 2.0 },
  mode: "HYBRID" | "QUANT_FALLBACK" = "HYBRID",
  modelUsed = "quant"
): HybridAnalysisOutput {
  const t = input.technical;
  const araInfo = getIdxAutoRejectionLimits(input.previousClose || input.currentPrice);

  // 1. Stop Loss floor: at least max(1.0 * ATR14, 3%) below entry
  const entry = roundToIdxTick(rawDecision.entryPrice, "nearest");
  const minSlDist = Math.max(t.atr14 ? t.atr14 * 1.0 : 0, entry * 0.03);
  const rawMaxStop = entry - minSlDist;
  const finalStopLoss = Math.max(
    1,
    roundToIdxTick(Math.min(rawDecision.stopLoss, rawMaxStop), "floor")
  );
  const finalTargetPrice = roundToIdxTick(rawDecision.targetPrice, "ceil");

  // 2. Partial Profit Target TP1 strictly between Entry and TP2
  let finalTargetPrice1: number;
  if (
    rawDecision.targetPrice1 !== undefined &&
    rawDecision.targetPrice1 > entry &&
    rawDecision.targetPrice1 < finalTargetPrice
  ) {
    finalTargetPrice1 = roundToIdxTick(rawDecision.targetPrice1, "ceil");
  } else {
    const riskDist = Math.max(1, entry - finalStopLoss);
    const mid = Math.min(entry + riskDist * 1.25, (entry + finalTargetPrice) / 2);
    finalTargetPrice1 = roundToIdxTick(Math.max(entry + 1, mid), "ceil");
  }
  if (finalTargetPrice1 >= finalTargetPrice) {
    finalTargetPrice1 = roundToIdxTick((entry + finalTargetPrice) / 2, "nearest");
  }

  // 3. Score blending (preserve low LLM conviction < 55)
  const rawOverall = clamp(Math.round(rawDecision.scores.overall), 0, 100);
  const overallScore =
    rawOverall < 55
      ? rawOverall
      : clamp(Math.round(rawOverall * 0.65 + quant.scores.composite * 0.35), 0, 100);

  const technicalScore = clamp(
    Math.round(
      rawDecision.scores.technical * 0.5 +
        (quant.scores.technical * 0.6 + quant.scores.bandarmology * 0.4) * 0.5
    ),
    0,
    100
  );
  const fundamentalScore = clamp(
    Math.round(rawDecision.scores.fundamental * 0.5 + quant.scores.fundamental * 0.5),
    0,
    100
  );
  const sentimentScore = clamp(Math.round(rawDecision.scores.sentiment), 0, 100);

  // 4. Risk:Reward Ratio Gate
  const risk = entry - finalStopLoss;
  const reward = finalTargetPrice - entry;
  const riskRewardRatio = risk > 0 && reward > 0 ? Math.round((reward / risk) * 100) / 100 : 0;
  const minRequiredRR = overallScore >= 75 ? thresholds.highScoreRR : thresholds.standardScoreRR;

  let action: SignalAction = rawDecision.action;
  let guardrailReason: string | null = null;

  if (action === "BUY" && riskRewardRatio < minRequiredRR) {
    action = "WAIT";
    guardrailReason = `R:R ${riskRewardRatio.toFixed(1)}x < ${minRequiredRR.toFixed(1)}x`;
  }

  // 5. Heavy Distribution Flag
  const isHeavyDistribution =
    t.accumulationStatus === "DISTRIBUTION" &&
    (t.volumeFlowRatio <= 0.6 || (t.volumeRatio > 1.2 && t.volumeFlowRatio <= 0.75));

  // 6. Bearish Trend Guardrail: Contrarian Swing vs Downgrade
  if (action === "BUY" && t.trend === "BEARISH") {
    const hasAccumulation =
      t.accumulationStatus === "ACCUMULATION" ||
      t.volumeFlowRatio >= 1.0 ||
      (t.cmf20 !== null && t.cmf20 >= 0.05) ||
      t.obvDivergence === "BULLISH_DIV";

    const hasMomentumShift =
      (t.macd !== null && t.macd.histogram > 0) ||
      t.macd?.trend === "BULLISH" ||
      t.macd?.trend === "BULLISH_CROSS" ||
      (t.rsi14 !== null && t.rsi14 <= 35) ||
      (t.priceToVwapPct !== null && t.priceToVwapPct >= -1.5 && t.priceToVwapPct <= 2.5);

    const isStrongContrarian =
      overallScore >= 65 && riskRewardRatio >= 2.0 && hasAccumulation && hasMomentumShift;

    if (!isStrongContrarian) {
      if (overallScore >= 55 && !isHeavyDistribution) {
        action = "WAIT";
        guardrailReason = "Bearish Trend (Menunggu Konfirmasi Reversal)";
      } else {
        action = "AVOID";
        guardrailReason = isHeavyDistribution
          ? "Heavy Distribution in Downtrend"
          : "Bearish Trend (Falling Knife Risk)";
      }
    }
  }

  // 7. RSI Overbought (> 75)
  if (action === "BUY" && t.rsi14 !== null && t.rsi14 > 75) {
    action = "WAIT";
    guardrailReason = `RSI Overbought (${t.rsi14.toFixed(0)})`;
  }

  // 8. Low-Volume Fakeout Near 3M High
  if (
    action === "BUY" &&
    t.high3Month > 0 &&
    input.currentPrice >= t.high3Month * 0.98 &&
    t.volumeRatio < 1.0
  ) {
    action = "WAIT";
    guardrailReason = `Breakout Volume Rendah (${t.volumeRatio.toFixed(2)}x)`;
  }

  // 9. Heavy Distribution Block
  if (action === "BUY" && isHeavyDistribution && overallScore < 85) {
    action = "WAIT";
    guardrailReason = `Heavy Distribution (${t.volumeFlowRatio.toFixed(2)}x flow)`;
  }

  // 10. Anti-ARA Chasing / Extended Spike
  const nearAra = araInfo.ara > 0 && input.currentPrice >= araInfo.ara * 0.97;
  if (action === "BUY" && (input.priceChangePct >= 15 || nearAra)) {
    action = "WAIT";
    guardrailReason = "Extended Spike / Mendekati ARA";
  }

  const setupType =
    rawDecision.setupType && rawDecision.setupType !== "NONE"
      ? rawDecision.setupType
      : quant.setupType;

  const profile = suggestRiskProfile(overallScore, input.macro?.regime ?? "NEUTRAL", t.trend);
  const sized = computeIdxPositionSizing({
    entryPrice: entry,
    stopLoss: finalStopLoss,
    targetPrice: finalTargetPrice,
    targetPrice1: finalTargetPrice1,
    capitalIdr: 100_000_000,
    riskPct: profile.suggestedRiskPct,
    maxAllocPct: profile.maxAllocationPct,
  });

  const sizing: PositionSizingSummary = {
    suggestedRiskPct: profile.suggestedRiskPct,
    maxAllocationPct: profile.maxAllocationPct,
    lotsPer100M: sized.lots,
  };

  return {
    ticker: input.ticker,
    action,
    confidence: clamp(Math.round(rawDecision.confidence), 1, 10),
    entryPrice: entry,
    stopLoss: finalStopLoss,
    targetPrice1: finalTargetPrice1,
    targetPrice: finalTargetPrice,
    riskRewardRatio,
    maxHoldDays: rawDecision.maxHoldDays,
    setupType,
    orderType: rawDecision.orderType,
    sentimentScore,
    fundamentalScore,
    technicalScore,
    overallScore,
    quant: quant.scores,
    sizing,
    newsSummary: rawDecision.reasoning.news,
    fundamentalSummary: rawDecision.reasoning.fundamental,
    technicalSummary: rawDecision.reasoning.technical,
    analysisSummary: rawDecision.reasoning.summary,
    guardrailReason,
    mode,
    modelUsed,
  };
}

export function buildQuantFallbackDecision(
  input: HybridAnalysisInput,
  quant: QuantEvaluation
): RawAiStockDecision {
  const sentiment = input.news?.score0to100 ?? 50;
  const overall = clamp(Math.round(quant.scores.composite * 0.8 + sentiment * 0.2), 20, 92);

  let action: SignalAction = "WAIT";
  if (overall >= 68 && quant.plan.riskRewardRatio >= 1.8) {
    action = "BUY";
  } else if (overall < 45 || (input.technical.trend === "BEARISH" && overall < 58)) {
    action = "AVOID";
  }

  const orderType: OrderType =
    quant.setupType === "BREAKOUT" && input.technical.volumeRatio >= 1.3 ? "MARKET" : "LIMIT";

  return {
    action,
    confidence: clamp(Math.round(overall / 10), 2, 9),
    entryPrice: quant.plan.entryPrice,
    stopLoss: quant.plan.stopLoss,
    targetPrice1: quant.plan.targetPrice1,
    targetPrice: quant.plan.targetPrice,
    maxHoldDays: quant.setupType === "BREAKOUT" ? 10 : 16,
    setupType: quant.setupType,
    orderType,
    scores: {
      sentiment,
      fundamental: quant.scores.fundamental,
      technical: Math.round((quant.scores.technical + quant.scores.bandarmology) / 2),
      overall,
    },
    reasoning: {
      news:
        input.news && input.news.catalysts.length > 0
          ? `Sentimen berita ${sentiment}/100: ${input.news.catalysts.join(", ")}.`
          : "Belum ada katalis berita material; evaluasi menggunakan skor quant.",
      fundamental: input.fundamental
        ? `Valuasi P/E ${fmtOpt(input.fundamental.peRatio, 1)}x, P/B ${fmtOpt(input.fundamental.pbRatio, 2)}x, ROE ${input.fundamental.roe !== null ? `${(input.fundamental.roe * 100).toFixed(1)}%` : "N/A"}.`
        : "Data fundamental belum lengkap dari Yahoo Finance.",
      technical: `Trend ${input.technical.trend}, RSI14 ${fmtOpt(input.technical.rsi14, 1)}, Flow 5D ${fmtOpt(input.technical.volumeFlowRatio, 2)}x (${input.technical.accumulationStatus}), VWAP20 Rp ${fmtOpt(input.technical.vwap20, 0)}.`,
      summary: `Quant fallback (${quant.setupType}): disiplin ${orderType} entry Rp ${quant.plan.entryPrice}, SL Rp ${quant.plan.stopLoss}, TP1 Rp ${quant.plan.targetPrice1}, TP2 Rp ${quant.plan.targetPrice} (R:R ${quant.plan.riskRewardRatio.toFixed(2)}x).`,
    },
  };
}

export async function analyzeTickerHybrid(
  input: HybridAnalysisInput,
  options: {
    thresholds?: RiskThresholdsConfig;
    skipAi?: boolean;
    modelOverride?: string;
    timeoutMs?: number;
    maxAttempts?: number;
  } = {}
): Promise<HybridAnalysisOutput> {
  const quant = evaluateQuant(input.technical, input.fundamental);
  const thresholds = options.thresholds ?? { highScoreRR: 1.5, standardScoreRR: 2.0 };

  if (!options.skipAi) {
    const prompt = buildStockPrompt(input, quant);
    const aiRes = await generateJson({
      role: "decision",
      model: options.modelOverride,
      temperature: 0.2,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxAttempts: options.maxAttempts ?? 2,
      schema: AiStockResponseSchema,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
    });

    if (aiRes.success && aiRes.data) {
      return applyHybridGuardrails(
        input,
        quant,
        aiRes.data,
        thresholds,
        "HYBRID",
        aiRes.modelUsed
      );
    }
  }

  const fallbackDecision = buildQuantFallbackDecision(input, quant);
  return applyHybridGuardrails(
    input,
    quant,
    fallbackDecision,
    thresholds,
    "QUANT_FALLBACK",
    resolveModelForRole("decision")
  );
}
