/**
 * Media Pulse:
 * - 14 Indonesian Capital Market Portal Configs
 * - Polite Concurrent HTML Fetcher (with Cloudflare Proxy & System Curl WAF Fallback)
 * - Cheerio Article Parser + SHA-256 Deduplication into SQLite
 * - Strict Case-Sensitive IDX Ticker Matcher (anti substring false-positives)
 * - Batched Filter LLM + Lexical Sentiment Catalyst Extractor
 */

import * as cheerio from "cheerio";
import crypto from "crypto";
import { z } from "zod";
import { IDX_LIQUID_UNIVERSE } from "./quant-radar.ts";
import {
  getMentionSentiment,
  getRecentNewsArticles,
  insertNewsArticle,
  insertNewsMentions,
  isNewsDuplicate,
} from "./persistence.ts";
import { generateJson } from "./thesis-forge.ts";

// ============================================================================
// Portal Configurations (14 IDX Portals)
// ============================================================================

export interface NewsPortalConfig {
  id: string;
  name: string;
  baseUrl: string;
  listingUrl: string;
  articleLinkSelector: string;
  titleSelector: string;
  contentSelector: string;
  dateSelector?: string;
  removeSelectors?: string[];
  useProxy?: boolean;
  disableProxyFallback?: boolean;
  maxArticles: number;
}

export const NEWS_PORTALS: NewsPortalConfig[] = [
  {
    id: "cnbc-indonesia",
    name: "CNBC Indonesia",
    baseUrl: "https://www.cnbcindonesia.com",
    listingUrl: "https://www.cnbcindonesia.com/market",
    articleLinkSelector: "article a[href*='/market/'], .list a[href*='/market/'], h2 a",
    titleSelector: "h1, .jdl h1, meta[property='og:title']",
    contentSelector: ".detail_text, article .content, article",
    dateSelector: ".date, time[datetime]",
    removeSelectors: [".lihat-juga", ".baca-juga", ".bacajuga", ".parallax", "script", "style"],
    maxArticles: 12,
  },
  {
    id: "bisnis-market",
    name: "Bisnis Market",
    baseUrl: "https://market.bisnis.com",
    listingUrl: "https://market.bisnis.com",
    articleLinkSelector: "a[href*='market.bisnis.com/read/'], .artTitle a, h2 a, h4 a",
    titleSelector: "h1.detailsTitleCaption, h1, meta[property='og:title']",
    contentSelector: ".detailsContent, article, .description",
    dateSelector: ".detailsAttributeDates, time[datetime], .date",
    removeSelectors: [".baca-juga", ".bacajuga", ".related", "script", "style"],
    disableProxyFallback: true,
    maxArticles: 10,
  },
  {
    id: "kabar-bursa",
    name: "Kabar Bursa",
    baseUrl: "https://www.kabarbursa.com",
    listingUrl: "https://www.kabarbursa.com/market",
    articleLinkSelector: "article a[href*='kabarbursa.com'], h2 a, h3 a",
    titleSelector: "h1, .entry-title",
    contentSelector: ".entry-content, article .content, article",
    dateSelector: "time[datetime], .published, .date",
    removeSelectors: [".baca-juga", ".related-posts", "script", "style"],
    maxArticles: 10,
  },
  {
    id: "detik-finance",
    name: "Detik Finance",
    baseUrl: "https://finance.detik.com",
    listingUrl: "https://finance.detik.com/bursa-dan-valas",
    articleLinkSelector: "article a[href*='/bursa-dan-valas/'], .media__link, h3 a",
    titleSelector: "h1.detail__title, h1",
    contentSelector: ".detail__body-text, article",
    dateSelector: ".detail__date, time[datetime]",
    removeSelectors: [".lihatjuga", ".sisip", ".paradetail", "table.linksisip", "script", "style"],
    maxArticles: 10,
  },
  {
    id: "katadata-bursa",
    name: "Katadata Bursa",
    baseUrl: "https://katadata.co.id",
    listingUrl: "https://katadata.co.id/finansial/bursa",
    articleLinkSelector: "article a[href*='katadata.co.id'], .content-title a, h2 a",
    titleSelector: "h1.detail-title, h1",
    contentSelector: ".detail-body, article .content, article",
    dateSelector: ".detail-date, time[datetime]",
    removeSelectors: [".baca-juga", ".bacajuga", ".related", "script", "style"],
    maxArticles: 10,
  },
  {
    id: "kontan-investasi",
    name: "Kontan Insight",
    baseUrl: "https://investasi.kontan.co.id",
    listingUrl: "https://investasi.kontan.co.id",
    articleLinkSelector: "a[href*='investasi.kontan.co.id/news/'], .list-berita h1 a, h2 a",
    titleSelector: "h1.detail-desk, h1",
    contentSelector: ".tmpt-desk-kon, .detail-berita, article",
    dateSelector: ".fs14, time[datetime], .date",
    removeSelectors: [".baca-juga", ".track-ga", "script", "style"],
    maxArticles: 12,
  },
  {
    id: "stockbit-snips",
    name: "Stockbit Snips",
    baseUrl: "https://snips.stockbit.com",
    listingUrl: "https://snips.stockbit.com/snips-terbaru",
    articleLinkSelector: "a[href*='/snips-terbaru/'], h2 a, article a",
    titleSelector: "h1, .entry-title",
    contentSelector: ".sqs-block-content, .entry-content, article",
    dateSelector: "time[datetime], .Blog-meta-item--date",
    removeSelectors: [".related", "script", "style"],
    maxArticles: 8,
  },
  {
    id: "kompas-cuan",
    name: "Kompas Money",
    baseUrl: "https://money.kompas.com",
    listingUrl: "https://money.kompas.com/cuan",
    articleLinkSelector: "a[href*='money.kompas.com/read/'], .article__link, h3 a",
    titleSelector: "h1.read__title, h1",
    contentSelector: ".read__content, article",
    dateSelector: ".read__time, time[datetime]",
    removeSelectors: [".inner-link-baca-juga", ".bacajuga", ".read__bacajuga", "script", "style"],
    maxArticles: 10,
  },
  {
    id: "investor-id",
    name: "Investor ID",
    baseUrl: "https://investor.id",
    listingUrl: "https://investor.id/market-and-corporate",
    articleLinkSelector: "a[href*='/market/'], a[href*='/market-and-corporate/'], h3 a, h4 a",
    titleSelector: "h1, .article-title",
    contentSelector: ".article-content, .detail-content, article",
    dateSelector: "time[datetime], .date, .article-date",
    removeSelectors: [".baca-juga", ".related", "script", "style"],
    useProxy: true,
    maxArticles: 10,
  },
  {
    id: "bloomberg-technoz",
    name: "Bloomberg Technoz",
    baseUrl: "https://www.bloombergtechnoz.com",
    listingUrl: "https://www.bloombergtechnoz.com/kanal/market",
    articleLinkSelector: "a[href*='/detail-news/'], h2 a, h3 a, article a",
    titleSelector: "h1, .detail-title",
    contentSelector: ".detail-text, .article-body, article",
    dateSelector: "time[datetime], .date",
    removeSelectors: [".baca-juga", ".related-article", "script", "style"],
    maxArticles: 10,
  },
  {
    id: "bisnis-ekonomi",
    name: "Bisnis Ekonomi",
    baseUrl: "https://ekonomi.bisnis.com",
    listingUrl: "https://ekonomi.bisnis.com",
    articleLinkSelector: "a[href*='ekonomi.bisnis.com/read/'], .artTitle a, h2 a",
    titleSelector: "h1.detailsTitleCaption, h1",
    contentSelector: ".detailsContent, article",
    dateSelector: ".detailsAttributeDates, time[datetime]",
    removeSelectors: [".baca-juga", ".bacajuga", "script", "style"],
    disableProxyFallback: true,
    maxArticles: 8,
  },
  {
    id: "sindonews-ekbis",
    name: "SindoNews Ekbis",
    baseUrl: "https://ekbis.sindonews.com",
    listingUrl: "https://ekbis.sindonews.com/bursa",
    articleLinkSelector: "a[href*='ekbis.sindonews.com/read/'], .title-news a, h2 a",
    titleSelector: "h1, .detail-title",
    contentSelector: "#content, .detail-desc, article",
    dateSelector: ".detail-date-artikel, time[datetime]",
    removeSelectors: [".baca-juga", ".lihat-juga", "script", "style"],
    maxArticles: 10,
  },
  {
    id: "idx-channel",
    name: "IDX Channel",
    baseUrl: "https://www.idxchannel.com",
    listingUrl: "https://www.idxchannel.com/market-news",
    articleLinkSelector: "a[href*='idxchannel.com/market-news/'], .title-capt a, h2 a",
    titleSelector: "h1, .title-detail",
    contentSelector: "#article-detail, .read--content, article",
    dateSelector: ".author-date, time[datetime]",
    removeSelectors: [".baca-juga", ".lihat-juga", "script", "style"],
    maxArticles: 12,
  },
  {
    id: "idn-financials",
    name: "IDN Financials",
    baseUrl: "https://www.idnfinancials.com",
    listingUrl: "https://www.idnfinancials.com/news",
    articleLinkSelector: "a[href*='idnfinancials.com/news/'], h2 a, h3 a",
    titleSelector: "h1, .title",
    contentSelector: ".article-content, .content, article",
    dateSelector: "time[datetime], [data-date], .date",
    removeSelectors: [".related-news", "script", "style"],
    maxArticles: 10,
  },
];

// ============================================================================
// Strict Token Matcher & Lexical Sentiment
// ============================================================================

const EXTRA_IDX_TICKERS = [
  "AALI", "ADHI", "ADMF", "AGII", "AGRO", "APEX", "APLN", "ARCI", "ARKO", "ASRI",
  "AUTO", "AVIA", "BBYB", "BDMN", "BELI", "BESS", "BFIN", "BIPI", "BIRD", "BMTR",
  "BNLI", "BOSS", "BREN", "BSSR", "BULL", "BWPT", "BYAN", "CBDK", "CBRE", "CDIA",
  "CFIN", "CGAS", "CLEO", "CMRY", "CSRA", "DCII", "DEWA", "DILD", "DKFT", "DMAS",
  "DMMX", "DOID", "DSSA", "DVLA", "EAST", "EDGE", "EMTK", "ENRG", "ERAA", "ESSA",
  "FAPA", "FAST", "GEMS", "GGRM", "GJTL", "GOOD", "GTSI", "HITS", "HMSP", "HRTA",
  "IMPC", "INDY", "INET", "KAEF", "KEEN", "KIJA", "KKGI", "KPIG", "LEAD", "LPKR",
  "MAIN", "MAPA", "MAPB", "MARK", "MBAP", "MCAS", "MCOL", "MEGA", "MGRO", "MLPT",
  "MNCN", "MTDL", "MTEL", "MYOH", "NFCX", "NICL", "NISP", "NSSS", "PANI", "PANR",
  "PJAA", "PNBN", "POWR", "PRDA", "PSAB", "PTPP", "PTRO", "PYFA", "PZZA", "RAJA",
  "RALS", "RATU", "RIGS", "ROTI", "RUIS", "SAME", "SCMA", "SGRO", "SHIP", "SILO",
  "SIMP", "SIPD", "SMDR", "SMMT", "SMSM", "SOCI", "SOLA", "SRTG", "SSMS", "STAA",
  "TBLA", "TBIG", "TCPI", "TGRA", "TMAS", "TOBA", "TOWR", "TPMA", "TSPC", "ULTJ",
  "UNVR", "WEGE", "WIFI", "WIKA", "WINS", "WMUU", "WOOD",
];

const AMBIGUOUS_TICKERS = new Set([
  "ACES", "AUTO", "BEST", "BIRD", "BULL", "CASH", "EAST", "EDGE",
  "FAST", "GOOD", "LEAD", "MAIN", "MARK", "MEGA", "SAME", "SHIP",
  "WIFI", "WOOD",
]);

export const KNOWN_IDX_TICKERS: Set<string> = new Set([
  ...IDX_LIQUID_UNIVERSE.map((u) => u.ticker),
  ...EXTRA_IDX_TICKERS,
]);

const BOILERPLATE_PATTERNS = [
  /BACA JUGA\s*:?[^\n]*/gi,
  /LIHAT JUGA\s*:?[^\n]*/gi,
  /SIMAK JUGA\s*:?[^\n]*/gi,
  /ADVERTISEMENT[^\n]*/gi,
];

export interface TickerMatch {
  ticker: string;
  inHeadline: boolean;
  count: number;
  snippet: string;
}

export function stripNewsBoilerplate(text: string): string {
  let cleaned = text;
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTickerMatchesInText(text: string, allowedTickers: Set<string>): Map<string, number> {
  const counts = new Map<string, number>();
  const tokenRegex = /(?<![\p{L}\p{N}_])([A-Z]{4})(?:\.[Jj][Kk])?(?![\p{L}\p{N}_])/gu;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const ticker = match[1];
    if (!ticker || !allowedTickers.has(ticker)) continue;

    if (AMBIGUOUS_TICKERS.has(ticker)) {
      const start = Math.max(0, match.index - 28);
      const end = Math.min(text.length, match.index + ticker.length + 18);
      const win = text.slice(start, end);
      const hasContext = new RegExp(
        `\\(${ticker}\\)|${ticker}\\.JK|\\b(?:saham|emiten|kode|PT|tbk|IPO)\\b`,
        "i"
      ).test(win);
      if (!hasContext) continue;
    }

    counts.set(ticker, (counts.get(ticker) ?? 0) + 1);
  }
  return counts;
}

export function extractSnippet(text: string, ticker: string, maxLen = 280): string {
  const clean = stripNewsBoilerplate(text);
  const regex = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegex(ticker)}(?:\\.[Jj][Kk])?(?![\\p{L}\\p{N}_])`
  );
  const match = regex.exec(clean);
  if (!match) return clean.slice(0, maxLen);

  const idx = match.index;
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(clean.length, idx + half);
  if (start > 0) {
    const space = clean.indexOf(" ", start);
    if (space !== -1 && space < idx) start = space + 1;
  }
  if (end < clean.length) {
    const space = clean.lastIndexOf(" ", end);
    if (space > idx) end = space;
  }
  return `${start > 0 ? "..." : ""}${clean.slice(start, end).trim()}${end < clean.length ? "..." : ""}`;
}

export function matchTickersInArticle(
  title: string,
  content: string,
  extraTickers: string[] = []
): TickerMatch[] {
  const allowed = new Set(KNOWN_IDX_TICKERS);
  for (const t of extraTickers) {
    const clean = t.replace(/\.JK$/i, "").trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(clean)) allowed.add(clean);
  }

  const cleanTitle = stripNewsBoilerplate(title);
  const cleanContent = stripNewsBoilerplate(content);
  const headlineCounts = findTickerMatchesInText(cleanTitle, allowed);
  const bodyCounts = findTickerMatchesInText(cleanContent, allowed);

  const combined = new Map<string, TickerMatch>();
  for (const ticker of new Set([...headlineCounts.keys(), ...bodyCounts.keys()])) {
    const inHeadline = (headlineCounts.get(ticker) ?? 0) > 0;
    const count = (headlineCounts.get(ticker) ?? 0) + (bodyCounts.get(ticker) ?? 0);
    const sourceText = inHeadline ? `${cleanTitle}. ${cleanContent}` : cleanContent || cleanTitle;
    combined.set(ticker, {
      ticker,
      inHeadline,
      count,
      snippet: extractSnippet(sourceText, ticker),
    });
  }

  return Array.from(combined.values()).sort((a, b) => {
    if (a.inHeadline !== b.inHeadline) return a.inHeadline ? -1 : 1;
    return b.count - a.count;
  });
}

const BULLISH_WORDS = [
  "melesat", "melonjak", "menguat", "rebound", "breakout", "akumulasi", "net buy",
  "laba naik", "untung", "ekspansi", "dividen", "buyback", "rekomendasi beli",
  "target harga naik", "prospek cerah", "cuan", "reli", "terbang", "sentimen positif",
];

const BEARISH_WORDS = [
  "anjlok", "ambruk", "melemah", "koreksi", "tertekan", "net sell", "distribusi",
  "rugi", "utang", "gagal bayar", "arb", "suspend", "suspensi", "pkpu", "pailit",
  "divestasi", "downgrade", "sentimen negatif", "terjungkal", "longsor",
];

export function scoreLexicalSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of BULLISH_WORDS) {
    if (lower.includes(w)) score += 0.22;
  }
  for (const w of BEARISH_WORDS) {
    if (lower.includes(w)) score -= 0.25;
  }
  return Math.max(-1, Math.min(1, Math.round(score * 100) / 100));
}

// ============================================================================
// Web Scraper & HTML Parser
// ============================================================================

export interface CrawledArticle {
  id: number;
  url: string;
  title: string;
  content: string;
  portal: string;
  publishedAt: string | null;
}

export interface CrawlSummary {
  articles: CrawledArticle[];
  portalsSucceeded: number;
  portalsFailed: number;
  newCount: number;
  duplicateCount: number;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

const SKIP_URL_PATTERNS = [
  "/tag/", "/tags/", "/category/", "/kategori/", "/author/", "/penulis/",
  "/page/", "/search", "/login", "/register", "/video", "/foto", "#", "javascript:",
];

const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECT_HOPS = 3;

function isPrivateOrLocalHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  // Reject IPv6 literals and bare IPv4 literals (external news portals must use public DNS domains)
  if (host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return true;
  }
  return false;
}

export function isSafeExternalHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (isPrivateOrLocalHostname(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchViaCurl(url: string, timeoutMs: number): Promise<string | null> {
  const safeUrl = isSafeExternalHttpUrl(url);
  if (!safeUrl) return null;

  const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
  const maxSecs = Math.max(2, Math.ceil(timeoutMs / 1000)).toString();
  const args = [
    curlCmd,
    "-s",
    "-L",
    "--compressed",
    "--max-time",
    maxSecs,
    "--proto",
    "=http,https",
    "--proto-redir",
    "=http,https",
    "--max-redirs",
    String(MAX_REDIRECT_HOPS),
    "--max-filesize",
    String(MAX_ARTICLE_BYTES),
    "-H",
    `User-Agent: ${DEFAULT_HEADERS["User-Agent"]}`,
    "-H",
    `Accept-Language: ${DEFAULT_HEADERS["Accept-Language"]}`,
    "--",
    safeUrl.toString(),
  ];
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0 || text.length < 200 || text.length > MAX_ARTICLE_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, portal: NewsPortalConfig, timeoutMs = 12_000): Promise<string | null> {
  const initialSafe = isSafeExternalHttpUrl(url);
  if (!initialSafe) return null;

  const proxyBase = (process.env.CRAWLER_PROXY_URL || process.env.NEWS_PROXY_URL)?.trim();
  const proxyToken = process.env.CRAWLER_PROXY_TOKEN?.trim();
  const useProxy = Boolean(portal.useProxy && !portal.disableProxyFallback && proxyBase);

  let targetUrl = initialSafe.toString();
  if (useProxy && proxyBase) {
    try {
      const w = new URL(proxyBase);
      w.searchParams.set("url", initialSafe.toString());
      if (proxyToken) w.searchParams.set("token", proxyToken);
      targetUrl = w.toString();
    } catch {
      targetUrl = `${proxyBase}${encodeURIComponent(initialSafe.toString())}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (useProxy) {
      const res = await fetch(targetUrl, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal,
        redirect: "follow",
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length >= 200 && text.length <= MAX_ARTICLE_BYTES) return text;
      }
    } else {
      let currentUrl = targetUrl;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const res = await fetch(currentUrl, {
          headers: DEFAULT_HEADERS,
          signal: controller.signal,
          redirect: "manual",
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) break;
          let resolvedNext: URL;
          try {
            resolvedNext = new URL(location, currentUrl);
          } catch {
            break;
          }
          const safeNext = isSafeExternalHttpUrl(resolvedNext.toString());
          if (!safeNext) return null;
          currentUrl = safeNext.toString();
          continue;
        }
        if (res.ok) {
          const text = await res.text();
          if (text.length >= 200 && text.length <= MAX_ARTICLE_BYTES) return text;
        }
        break;
      }
    }
  } catch {
    // Fallback to curl when Cloudflare TLS blocks native fetch
  } finally {
    clearTimeout(timer);
  }

  return await fetchViaCurl(initialSafe.toString(), timeoutMs);
}

export function isValidArticleUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const baseParsed = new URL(baseUrl);
    const parsed = new URL(rawUrl, baseParsed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;

    parsed.hash = "";
    const resolved = parsed.toString();
    const lower = resolved.toLowerCase();
    if (SKIP_URL_PATTERNS.some((p) => lower.includes(p))) return null;

    const baseHost = baseParsed.hostname.toLowerCase().replace(/^www\./, "");
    const targetHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!baseHost || !targetHost) return null;
    if (isPrivateOrLocalHostname(targetHost)) return null;
    if (targetHost !== baseHost && !targetHost.endsWith(`.${baseHost}`)) return null;

    if (resolved.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, "")) return null;
    return resolved;
  } catch {
    return null;
  }
}

export function extractArticleLinks(html: string, portal: NewsPortalConfig): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: string[] = [];

  $(portal.articleLinkSelector).each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const valid = isValidArticleUrl(href, portal.baseUrl);
    if (!valid || seen.has(valid)) return;
    seen.add(valid);
    links.push(valid);
  });

  return links.slice(0, portal.maxArticles);
}

const INDONESIAN_MONTHS: Record<string, number> = {
  januari: 0, jan: 0, februari: 1, feb: 1, maret: 2, mar: 2,
  april: 3, apr: 3, mei: 4, may: 4, juni: 5, jun: 5,
  juli: 6, jul: 6, agustus: 7, agu: 7, aug: 7,
  september: 8, sep: 8, oktober: 9, okt: 9, oct: 9,
  november: 10, nov: 10, desember: 11, des: 11, dec: 11,
};

function parseArticleDate($: cheerio.CheerioAPI, selector?: string): Date | null {
  const metaTime =
    $("meta[property='article:published_time']").attr("content") ||
    $("meta[name='publishdate']").attr("content");
  if (metaTime) {
    const d = new Date(metaTime);
    if (!Number.isNaN(d.getTime())) return d;
  }

  if (!selector) return null;
  for (const sel of selector.split(",").map((s) => s.trim())) {
    const el = $(sel).first();
    const attrDate = el.attr("datetime") || el.attr("data-date");
    if (attrDate) {
      const d = new Date(attrDate);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const text = el.text().trim();
    const idMatch = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (idMatch?.[1] && idMatch[2] && idMatch[3]) {
      const m = INDONESIAN_MONTHS[idMatch[2].toLowerCase()];
      if (m !== undefined) {
        const d = new Date(Number(idMatch[3]), m, Number(idMatch[1]));
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      const d = new Date(isoMatch[0]);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

export function parseArticleHtml(
  html: string,
  portal: NewsPortalConfig
): { title: string; content: string; publishedAt: Date | null } | null {
  const $ = cheerio.load(html);
  for (const rem of portal.removeSelectors ?? []) {
    $(rem).remove();
  }

  let title = "";
  for (const sel of portal.titleSelector.split(",").map((s) => s.trim())) {
    const el = $(sel).first();
    const txt = sel.startsWith("meta") ? el.attr("content")?.trim() : el.text().trim();
    if (txt && txt.length > 10) {
      title = stripNewsBoilerplate(txt);
      break;
    }
  }
  if (!title) {
    const ogTitle =
      $("meta[property='og:title']").attr("content")?.trim() || $("h1").first().text().trim();
    if (ogTitle && ogTitle.length > 10) title = stripNewsBoilerplate(ogTitle);
  }
  if (!title) return null;

  let content = "";
  const contentSelectors = [
    ...portal.contentSelector.split(",").map((s) => s.trim()),
    "article",
  ];
  for (const sel of contentSelectors) {
    const container = $(sel).first();
    if (container.length === 0) continue;
    const paragraphs: string[] = [];
    container.find("p").each((_, p) => {
      const txt = $(p).text().trim();
      if (txt.length > 24) paragraphs.push(txt);
    });
    const candidate = paragraphs.length > 0 ? paragraphs.join("\n") : container.text().trim();
    const cleaned = stripNewsBoilerplate(candidate);
    if (cleaned.length >= 120) {
      content = cleaned.slice(0, 6000);
      break;
    }
  }

  if (!content) {
    content = stripNewsBoilerplate($("meta[name='description']").attr("content") || title);
  }

  return { title, content, publishedAt: parseArticleDate($, portal.dateSelector) };
}

function hashArticleContent(title: string, content: string): string {
  const normalized = `${title.toLowerCase()}::${content.slice(0, 400).toLowerCase()}`
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function crawlSinglePortal(
  portal: NewsPortalConfig,
  onLog?: (msg: string) => void
): Promise<{ articles: CrawledArticle[]; duplicates: number; ok: boolean }> {
  const listingHtml = await fetchHtml(portal.listingUrl, portal);
  if (!listingHtml) {
    onLog?.(`[MediaPulse] ${portal.name}: halaman indeks tidak dapat diakses`);
    return { articles: [], duplicates: 0, ok: false };
  }

  const urls = extractArticleLinks(listingHtml, portal);
  const articles: CrawledArticle[] = [];
  let duplicates = 0;

  for (let i = 0; i < urls.length; i += 3) {
    const batch = urls.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(async (url) => {
        if (isNewsDuplicate(url, "__url_only_probe__")) {
          return { dup: true as const };
        }
        const html = await fetchHtml(url, portal, 10_000);
        if (!html) return null;
        const parsed = parseArticleHtml(html, portal);
        if (!parsed) return null;

        const contentHash = hashArticleContent(parsed.title, parsed.content);
        if (isNewsDuplicate(url, contentHash)) {
          return { dup: true as const };
        }

        const insertedId = insertNewsArticle({
          url,
          title: parsed.title,
          content: parsed.content,
          portal: portal.name,
          publishedAt: parsed.publishedAt,
          contentHash,
        });
        if (!insertedId) return { dup: true as const };

        return {
          dup: false as const,
          article: {
            id: insertedId,
            url,
            title: parsed.title,
            content: parsed.content,
            portal: portal.name,
            publishedAt: parsed.publishedAt ? parsed.publishedAt.toISOString() : null,
          },
        };
      })
    );

    for (const r of results) {
      if (!r) continue;
      if (r.dup) duplicates++;
      else articles.push(r.article);
    }
  }

  onLog?.(`[MediaPulse] ${portal.name}: +${articles.length} baru (${duplicates} duplikat)`);
  return { articles, duplicates, ok: true };
}

export async function crawlAllPortals(
  onLog?: (msg: string) => void,
  maxPortals?: number
): Promise<CrawlSummary> {
  const portals = maxPortals ? NEWS_PORTALS.slice(0, maxPortals) : NEWS_PORTALS;
  const articles: CrawledArticle[] = [];
  let portalsSucceeded = 0;
  let portalsFailed = 0;
  let duplicateCount = 0;

  for (let i = 0; i < portals.length; i += 4) {
    const batch = portals.slice(i, i + 4);
    const settled = await Promise.all(batch.map((p) => crawlSinglePortal(p, onLog)));
    for (const res of settled) {
      if (res.ok) portalsSucceeded++;
      else portalsFailed++;
      duplicateCount += res.duplicates;
      articles.push(...res.articles);
    }
  }

  return {
    articles,
    portalsSucceeded,
    portalsFailed,
    newCount: articles.length,
    duplicateCount,
  };
}

// ============================================================================
// Batched News Sentiment Extraction & Ticker Aggregation
// ============================================================================

export interface ExtractedTickerSentiment {
  articleId: number;
  ticker: string;
  sentiment: number;
  catalyst: string;
  confidence: number;
  inHeadline: boolean;
  snippet: string;
  portal: string;
  title: string;
  publishedAt: string | null;
}

export interface TickerNewsSummary {
  ticker: string;
  mentionCount: number;
  headlineHits: number;
  weightedSentiment: number;
  score0to100: number;
  catalysts: string[];
  headlines: Array<{ title: string; portal: string; sentiment: number; publishedAt: string | null }>;
}

const ExtractionResponseSchema = z.object({
  items: z.array(
    z.object({
      articleId: z.number(),
      ticker: z.string(),
      sentiment: z.number().min(-1).max(1),
      catalyst: z.string().default("Market news"),
      confidence: z.number().min(1).max(10).default(6),
    })
  ),
});

export async function extractNewsSentiments(
  articles: CrawledArticle[],
  watchlistTickers: string[] = [],
  onLog?: (msg: string) => void
): Promise<ExtractedTickerSentiment[]> {
  const candidates: Array<{
    article: CrawledArticle;
    ticker: string;
    inHeadline: boolean;
    snippet: string;
  }> = [];

  for (const article of articles) {
    const matches = matchTickersInArticle(article.title, article.content, watchlistTickers);
    for (const m of matches.slice(0, 4)) {
      candidates.push({ article, ticker: m.ticker, inHeadline: m.inHeadline, snippet: m.snippet });
    }
  }

  if (candidates.length === 0) return [];

  const results: ExtractedTickerSentiment[] = [];
  const batchSize = 14;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const promptLines = batch.map(
      (c, idx) =>
        `${idx + 1}. [articleId=${c.article.id}] [ticker=${c.ticker}] [${c.article.portal}] Title: ${c.article.title}\n   Snippet: ${c.snippet}`
    );

    const aiRes = await generateJson({
      role: "filter",
      temperature: 0.1,
      timeoutMs: 30_000,
      schema: ExtractionResponseSchema,
      systemInstruction: `Evaluate Indonesian (IDX) stock news sentiment strictly.
Return sentiment (-1.0 bearish to +1.0 bullish), concise 3-6 word catalyst phrase, and confidence (1-10).
Respond ONLY as valid JSON: {"items":[{"articleId":1,"ticker":"BBCA","sentiment":0.4,"catalyst":"Foreign net buy & dividend","confidence":8}]}`,
      prompt: `Evaluate these ${batch.length} IDX news mentions:\n\n${promptLines.join("\n\n")}`,
    });

    const aiMap = new Map<string, { sentiment: number; catalyst: string; confidence: number }>();
    if (aiRes.success && aiRes.data) {
      for (const item of aiRes.data.items) {
        aiMap.set(`${item.articleId}:${item.ticker.toUpperCase()}`, {
          sentiment: item.sentiment,
          catalyst: item.catalyst,
          confidence: item.confidence,
        });
      }
    } else if (i === 0) {
      onLog?.(
        `[MediaPulse] Filter LLM tidak aktif (${aiRes.error ?? "offline"}) — fallback lexical sentiment`
      );
    }

    const dbRows: Array<{ articleId: number; ticker: string; sentiment: number; relevance: number }> =
      [];

    for (const c of batch) {
      const key = `${c.article.id}:${c.ticker}`;
      const aiItem = aiMap.get(key);
      const sentiment =
        aiItem?.sentiment ?? scoreLexicalSentiment(`${c.article.title} ${c.snippet}`);
      const confidence = aiItem?.confidence ?? (c.inHeadline ? 7 : 5);
      const catalyst =
        aiItem?.catalyst ?? (c.inHeadline ? c.article.title.slice(0, 72) : "Berita emiten");

      dbRows.push({
        articleId: c.article.id,
        ticker: c.ticker,
        sentiment,
        relevance: Math.min(1, confidence / 10),
      });

      results.push({
        articleId: c.article.id,
        ticker: c.ticker,
        sentiment,
        catalyst,
        confidence,
        inHeadline: c.inHeadline,
        snippet: c.snippet,
        portal: c.article.portal,
        title: c.article.title,
        publishedAt: c.article.publishedAt,
      });
    }

    insertNewsMentions(dbRows);
  }

  return results;
}

export function aggregateTickerNews(
  mentions: ExtractedTickerSentiment[]
): Map<string, TickerNewsSummary> {
  const byTicker = new Map<string, ExtractedTickerSentiment[]>();
  for (const m of mentions) {
    const arr = byTicker.get(m.ticker) ?? [];
    arr.push(m);
    byTicker.set(m.ticker, arr);
  }

  const summaries = new Map<string, TickerNewsSummary>();
  for (const [ticker, list] of byTicker.entries()) {
    let weightedSum = 0;
    let totalWeight = 0;
    let headlineHits = 0;
    const catalysts: string[] = [];

    for (const item of list) {
      const w = (item.inHeadline ? 1.5 : 1.0) * (item.confidence / 10);
      weightedSum += item.sentiment * w;
      totalWeight += w;
      if (item.inHeadline) headlineHits++;
      if (item.catalyst && !catalysts.includes(item.catalyst)) {
        catalysts.push(item.catalyst);
      }
    }

    const weightedSentiment = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const score0to100 = Math.max(
      10,
      Math.min(95, Math.round(52 + weightedSentiment * 38 + Math.min(headlineHits, 3) * 2))
    );

    summaries.set(ticker, {
      ticker,
      mentionCount: list.length,
      headlineHits,
      weightedSentiment: Math.round(weightedSentiment * 100) / 100,
      score0to100,
      catalysts: catalysts.slice(0, 4),
      headlines: list.slice(0, 5).map((item) => ({
        title: item.title,
        portal: item.portal,
        sentiment: item.sentiment,
        publishedAt: item.publishedAt,
      })),
    });
  }

  return summaries;
}

export function collectLocalNewsForTicker(ticker: string, days = 5): TickerNewsSummary | null {
  const articles = getRecentNewsArticles(days);
  const headlines: TickerNewsSummary["headlines"] = [];
  let sum = 0;
  let headlineHits = 0;

  for (const a of articles) {
    const matches = matchTickersInArticle(a.title, a.content ?? "", [ticker]);
    const hit = matches.find((m) => m.ticker === ticker);
    if (!hit) continue;

    const storedSent = getMentionSentiment(a.id, ticker);
    const sentiment = storedSent ?? scoreLexicalSentiment(`${a.title} ${hit.snippet}`);
    sum += sentiment;
    if (hit.inHeadline) headlineHits++;
    headlines.push({
      title: a.title,
      portal: a.portal,
      sentiment,
      publishedAt: a.publishedAt,
    });
  }

  if (headlines.length === 0) return null;
  const avg = sum / headlines.length;
  return {
    ticker,
    mentionCount: headlines.length,
    headlineHits,
    weightedSentiment: Math.round(avg * 100) / 100,
    score0to100: Math.max(
      10,
      Math.min(95, Math.round(52 + avg * 38 + Math.min(headlineHits, 3) * 2))
    ),
    catalysts: headlines.slice(0, 3).map((h) => h.title.slice(0, 68)),
    headlines: headlines.slice(0, 5),
  };
}
