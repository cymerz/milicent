/**
 * Milicent React Entrypoint & Trading Workstation Router
 */

import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { DashboardPayload } from "@protocol/contracts.ts";
import {
  studioApi,
  useLiveMarketSocket,
  type MarketTickPayload,
} from "@frontend/sdk.ts";
import { StudioFrame } from "@frontend/layout/StudioFrame.tsx";
import { CommandDeckScreen } from "@frontend/screens/CommandDeckScreen.tsx";
import { MarketScannerScreen } from "@frontend/screens/MarketScannerScreen.tsx";
import { StockWorkbenchScreen } from "@frontend/screens/StockWorkbenchScreen.tsx";
import { AuditLedgerScreen } from "@frontend/screens/AuditLedgerScreen.tsx";
import { BacktestLabScreen } from "@frontend/screens/BacktestLabScreen.tsx";
import { OperationsScreen } from "@frontend/screens/OperationsScreen.tsx";
import "@frontend/styles.css";

function StudioApp() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [livePrices, setLivePrices] = useState<
    Record<string, { price: number; changePct: number }>
  >({});

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await studioApi.getDashboard();
      setDashboard(data);
    } catch {
      // keep existing state cleanly
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const handleMarketTick = useCallback(
    (tick: MarketTickPayload) => {
      setLivePrices((prev) => ({ ...prev, ...tick.quotes }));
      if (tick.updatedCount > 0) {
        void refreshDashboard();
      }
    },
    [refreshDashboard]
  );

  const { connected: wsConnected } = useLiveMarketSocket(handleMarketTick);

  return (
    <StudioFrame
      macro={dashboard?.outlook.macro ?? null}
      marketOpen={dashboard?.scheduler.marketOpen ?? false}
      pipelineRunning={dashboard?.scheduler.pipelineRunning ?? false}
      wsConnected={wsConnected}
      watchlist={dashboard?.watchlist ?? []}
    >
      <Routes>
        <Route
          path="/"
          element={
            <CommandDeckScreen
              dashboard={dashboard}
              loading={loading}
              livePrices={livePrices}
              onRefresh={() => void refreshDashboard()}
            />
          }
        />
        <Route path="/scanner" element={<MarketScannerScreen />} />
        <Route path="/workbench" element={<StockWorkbenchScreen />} />
        <Route path="/ledger" element={<AuditLedgerScreen />} />
        <Route path="/backtest" element={<BacktestLabScreen />} />
        <Route path="/operations" element={<OperationsScreen />} />
        <Route path="/admin" element={<OperationsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StudioFrame>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <BrowserRouter>
        <StudioApp />
      </BrowserRouter>
    </React.StrictMode>
  );
}
