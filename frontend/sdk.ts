/**
 * Frontend REST SDK, Live WebSocket/SSE Hooks, Theme State & IDX Formatters
 */

import { useEffect, useState } from "react";
import type {
  ApiEnvelope,
  AppSettings,
  BacktestPayload,
  BacktestRequest,
  DashboardPayload,
  HistoryPayload,
  MarketOutlook,
  PipelineLogEvent,
  ScreenerPayload,
  TickerAnalysisPayload,
} from "@protocol/contracts.ts";

// ============================================================================
// Admin Password Session Store
// ============================================================================

const ADMIN_PW_KEY = "senti_v2_admin_pw";
const ADMIN_UNLOCKED_KEY = "senti_v2_admin_unlocked";
const ADMIN_EVENT = "senti-admin-change";

export function getStoredAdminPassword(): string {
  try {
    return sessionStorage.getItem(ADMIN_PW_KEY) ?? "";
  } catch {
    return "";
  }
}

export function hasStoredAdminPassword(): boolean {
  return getStoredAdminPassword().length > 0;
}

export function setStoredAdminPassword(pw: string): void {
  try {
    if (pw.trim()) sessionStorage.setItem(ADMIN_PW_KEY, pw.trim());
    else sessionStorage.removeItem(ADMIN_PW_KEY);
  } catch {
    // ignore storage failures
  }
}

export function isAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_UNLOCKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAdminUnlocked(unlocked: boolean): void {
  try {
    if (unlocked) sessionStorage.setItem(ADMIN_UNLOCKED_KEY, "1");
    else sessionStorage.removeItem(ADMIN_UNLOCKED_KEY);
    window.dispatchEvent(new Event(ADMIN_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function clearAdminSession(): void {
  setStoredAdminPassword("");
  setAdminUnlocked(false);
}

export function useAdminSession(): boolean {
  const [unlocked, setUnlocked] = useState<boolean>(isAdminUnlocked);

  useEffect(() => {
    const sync = () => setUnlocked(isAdminUnlocked());
    window.addEventListener(ADMIN_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ADMIN_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return unlocked;
}

// ============================================================================
// HTTP Request Wrapper
// ============================================================================

async function requestApi<T>(
  url: string,
  init: RequestInit = {},
  includeAdminHeader = false
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (includeAdminHeader) {
    const pw = getStoredAdminPassword();
    if (pw) headers.set("X-Admin-Password", pw);
  }

  const res = await fetch(url, { ...init, headers });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !json.success || json.data === null) {
    if (res.status === 401 && includeAdminHeader && url !== "/api/admin/verify") {
      clearAdminSession();
    }
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.data;
}

export const studioApi = {
  getDashboard(): Promise<DashboardPayload> {
    return requestApi<DashboardPayload>("/api/dashboard");
  },
  getOutlook(): Promise<MarketOutlook> {
    return requestApi<MarketOutlook>("/api/outlook");
  },
  getScreener(params: {
    refresh?: boolean;
    setup?: string;
    sector?: string;
    trend?: string;
    minScore?: number;
  } = {}): Promise<ScreenerPayload> {
    const sp = new URLSearchParams();
    if (params.refresh) sp.set("refresh", "1");
    if (params.setup && params.setup !== "ALL") sp.set("setup", params.setup);
    if (params.sector && params.sector !== "ALL") sp.set("sector", params.sector);
    if (params.trend && params.trend !== "ALL") sp.set("trend", params.trend);
    if (params.minScore && params.minScore > 0) sp.set("minScore", String(params.minScore));
    const qs = sp.toString();
    return requestApi<ScreenerPayload>(`/api/screener${qs ? `?${qs}` : ""}`, {}, true);
  },
  analyzeTicker(params: {
    ticker: string;
    force?: boolean;
    skipAi?: boolean;
    model?: string;
  }): Promise<TickerAnalysisPayload> {
    return requestApi<TickerAnalysisPayload>(
      "/api/analyze",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
      true
    );
  },
  purgeAnalysisCache(ticker?: string): Promise<{ cleared: number; scope: string }> {
    return requestApi<{ cleared: number; scope: string }>(
      "/api/analyze/purge",
      {
        method: "POST",
        body: JSON.stringify(ticker ? { ticker } : {}),
      },
      true
    );
  },
  getHistory(params: {
    page?: number;
    pageSize?: number;
    ticker?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<HistoryPayload> {
    const sp = new URLSearchParams();
    if (params.page) sp.set("page", String(params.page));
    if (params.pageSize) sp.set("pageSize", String(params.pageSize));
    if (params.ticker) sp.set("ticker", params.ticker);
    if (params.status) sp.set("status", params.status);
    if (params.startDate) sp.set("startDate", params.startDate);
    if (params.endDate) sp.set("endDate", params.endDate);
    const qs = sp.toString();
    return requestApi<HistoryPayload>(`/api/history${qs ? `?${qs}` : ""}`);
  },
  runBacktest(params: Partial<BacktestRequest>): Promise<BacktestPayload> {
    return requestApi<BacktestPayload>(
      "/api/backtest",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
      true
    );
  },
  verifyAdmin(): Promise<{ authenticated: boolean; adminProtected: boolean }> {
    return requestApi<{ authenticated: boolean; adminProtected: boolean }>(
      "/api/admin/verify",
      { method: "POST" },
      true
    );
  },
  getSettings(): Promise<AppSettings> {
    return requestApi<AppSettings>("/api/settings", {}, true);
  },
  patchSettings(patch: Record<string, unknown>): Promise<unknown> {
    return requestApi(
      "/api/settings",
      { method: "PATCH", body: JSON.stringify(patch) },
      true
    );
  },
  addWatchlist(ticker: string): Promise<{ watchlist: string[]; added: string }> {
    return requestApi(
      "/api/watchlist",
      { method: "POST", body: JSON.stringify({ ticker }) },
      true
    );
  },
  removeWatchlist(ticker: string): Promise<{ watchlist: string[]; removed: string }> {
    return requestApi(
      `/api/watchlist?ticker=${encodeURIComponent(ticker)}`,
      { method: "DELETE" },
      true
    );
  },
  triggerPipeline(
    schedule: "morning" | "evening" | "manual" = "manual",
    options: { forceRefresh?: boolean } = {}
  ): Promise<{
    started: boolean;
    schedule: string;
    forceRefresh: boolean;
  }> {
    return requestApi(
      "/api/pipeline/run",
      {
        method: "POST",
        body: JSON.stringify({
          schedule,
          forceRefresh: Boolean(options.forceRefresh),
        }),
      },
      true
    );
  },
  toggleScheduler(action: "start" | "stop"): Promise<{ running: boolean }> {
    return requestApi(`/api/scheduler/${action}`, { method: "POST" }, true);
  },
};

// ============================================================================
// Live WebSocket, SSE Logs & Theme Hooks
// ============================================================================

export interface MarketTickPayload {
  quotes: Record<string, { price: number; changePct: number }>;
  updatedCount: number;
  anomalies: Array<{ ticker: string; price: number; changePct: number; volumeRatio: number }>;
}

export function useLiveMarketSocket(
  onTick: (tick: MarketTickPayload) => void
): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const clearHeartbeat = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close(1000, "unmount");
          return;
        }
        setConnected(true);
        clearHeartbeat();
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
      };

      socket.onclose = () => {
        clearHeartbeat();
        setConnected(false);
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };

      socket.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data as string) as {
            type?: string;
            payload?: MarketTickPayload;
          };
          if (parsed.type === "market_tick" && parsed.payload) {
            onTick(parsed.payload);
          }
        } catch {
          // ignore malformed frames
        }
      };
    };

    // Defer initial connection slightly so StrictMode double-mount does not abort mid-handshake
    startTimer = setTimeout(connect, 50);

    return () => {
      disposed = true;
      if (startTimer) clearTimeout(startTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearHeartbeat();
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "unmount");
        } else if (ws.readyState === WebSocket.CONNECTING) {
          const pending = ws;
          pending.onopen = () => pending.close(1000, "unmount");
        }
      }
    };
  }, [onTick]);

  return { connected };
}

export function usePipelineLogsStream(enabled = true): PipelineLogEvent[] {
  const [logs, setLogs] = useState<PipelineLogEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let abortCtrl: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (cancelled) return;
      abortCtrl = new AbortController();
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      const pw = getStoredAdminPassword();
      if (pw) headers["X-Admin-Password"] = pw;

      try {
        const res = await fetch("/api/logs", {
          headers,
          signal: abortCtrl.signal,
        });

        if (res.status === 401) {
          clearAdminSession();
          return;
        }
        if (!res.ok || !res.body) {
          if (res.status === 503) return;
          if (!cancelled) {
            retryTimer = setTimeout(() => void connect(), 4000);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawFrame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const line of rawFrame.split("\n")) {
              if (line.startsWith("data:")) {
                const payload = line.slice(5).trim();
                if (payload) {
                  try {
                    const parsed = JSON.parse(payload) as PipelineLogEvent;
                    setLogs((prev) => [...prev.slice(-150), parsed]);
                  } catch {
                    // ignore non-JSON frame
                  }
                }
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // stream aborted or disconnected
      }

      if (!cancelled) {
        retryTimer = setTimeout(() => void connect(), 3000);
      }
    };

    const startTimer = setTimeout(() => {
      void connect();
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      if (retryTimer) clearTimeout(retryTimer);
      abortCtrl?.abort();
    };
  }, [enabled]);

  return logs;
}

export function useThemeMode(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("senti_theme");
      return saved ? saved === "dark" : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("senti_theme", dark ? "dark" : "light");
    } catch {
      // ignore
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

// ============================================================================
// IDX Formatting Utilities
// ============================================================================

export function formatIdr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return `Rp ${Math.round(n).toLocaleString("en-US")}`;
}

export function formatNumber(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

export function formatPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${n.toFixed(digits)}%`;
}

export function formatCompactIdr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}Rp ${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}Rp ${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}Rp ${(abs / 1e6).toFixed(1)}M`;
  return `${sign}Rp ${Math.round(abs).toLocaleString("en-US")}`;
}
