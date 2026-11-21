/**
 * Studio Frame:
 * Two-Tier Editorial Trading Masthead featuring a Deep-Ink Live Market Tape,
 * Full-Width Architectural Underline Navigation, Mobile Menu Sheet & Bottom Nav,
 * and Ctrl+K Emiten Command Dialog.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { MacroContext } from "@protocol/contracts.ts";
import { formatPct, useAdminSession, useThemeMode } from "@frontend/sdk.ts";

// ============================================================================
// Financial SVG Icons (1.75px stroke)
// ============================================================================

export const SvgIcon = {
  Deck: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <path d="M5 5v10M5 7.5h2.5v5H5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 3.5v13M8.8 6h2.4v7.5H8.8z" strokeLinejoin="round" />
      <path d="M15 6.5v9M13.8 9h2.4v4h-2.4z" strokeLinejoin="round" />
    </svg>
  ),
  Radar: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <path d="M3 5.5h14M3 10h10M3 14.5h6" strokeLinecap="round" />
      <path d="M13 14.5l2 2 3-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Microscope: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M5.5 13l3-3.5 2.5 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Ledger: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 7.5h14M7.5 7.5V17" strokeLinecap="round" />
    </svg>
  ),
  Backtest: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <path d="M3 16.5V3.5M3 16.5h14" strokeLinecap="round" />
      <path d="M5.5 13l3.5-4 3 2 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Control: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <path d="M3 6h14M3 14h14" strokeLinecap="round" />
      <circle cx="7" cy="6" r="2" fill="var(--bg-surface)" />
      <circle cx="13" cy="14" r="2" fill="var(--bg-surface)" />
    </svg>
  ),
  Search: (props: { className?: string }) => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className={props.className ?? "w-4 h-4"}
    >
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2L17 17" strokeLinecap="round" />
    </svg>
  ),
  Sun: () => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="w-4 h-4"
    >
      <circle cx="10" cy="10" r="3.2" />
      <path
        d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  Moon: () => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="w-4 h-4"
    >
      <path
        d="M16.2 12.6A6.5 6.5 0 017.4 3.8a6.8 6.8 0 108.8 8.8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Star: ({ filled }: { filled?: boolean }) => (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="w-4 h-4"
    >
      <path
        d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Close: () => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="w-4 h-4"
    >
      <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
    </svg>
  ),
  Menu: () => (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="w-4 h-4"
    >
      <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
    </svg>
  ),
};

// ============================================================================
// Macro Regime Badge
// ============================================================================

export function RegimeBadge({ regime }: { regime: MacroContext["regime"] }) {
  const cfg: Record<MacroContext["regime"], { label: string; cls: string }> = {
    RISK_ON: {
      label: "Risk On",
      cls: "bg-bull-bg text-bull border border-bull-border",
    },
    NEUTRAL: {
      label: "Neutral",
      cls: "bg-accent-tint text-accent border border-accent-border",
    },
    CAUTIOUS: {
      label: "Cautious",
      cls: "bg-warn-bg text-warn border border-warn-border",
    },
    RISK_OFF: {
      label: "Risk Off",
      cls: "bg-bear-bg text-bear border border-bear-border",
    },
  };
  const item = cfg[regime];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-[13px] font-semibold ${item.cls}`}>
      {item.label}
    </span>
  );
}

// ============================================================================
// Routes & Quick Tickers
// ============================================================================

const PRIMARY_ROUTES = [
  { to: "/", label: "Market Pulse", shortLabel: "Pulse", Icon: SvgIcon.Deck, end: true },
  { to: "/scanner", label: "Screener", shortLabel: "Screener", Icon: SvgIcon.Radar, end: false },
  { to: "/workbench", label: "Terminal", shortLabel: "Terminal", Icon: SvgIcon.Microscope, end: false },
  { to: "/ledger", label: "Track Record", shortLabel: "Record", Icon: SvgIcon.Ledger, end: false },
  { to: "/backtest", label: "Backtest", shortLabel: "Backtest", Icon: SvgIcon.Backtest, end: false },
];

const ADMIN_ROUTE = {
  to: "/admin",
  label: "Engine Admin",
  shortLabel: "Admin",
  Icon: SvgIcon.Control,
  end: false,
};

const POPULAR_IDX_TICKERS = [
  "BBCA",
  "BBRI",
  "BMRI",
  "TLKM",
  "ASII",
  "ADRO",
  "ANTM",
  "BRIS",
  "AMMN",
  "PGEO",
];

// ============================================================================
// Main Studio Frame
// ============================================================================

interface StudioFrameProps {
  macro: MacroContext | null;
  marketOpen?: boolean;
  pipelineRunning?: boolean;
  wsConnected?: boolean;
  watchlist?: string[];
  children: React.ReactNode;
}

export function StudioFrame({
  macro,
  marketOpen = false,
  pipelineRunning = false,
  wsConnected = false,
  watchlist = [],
  children,
}: StudioFrameProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { dark, toggle } = useThemeMode();
  const adminUnlocked = useAdminSession();

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");

  const mobileMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const mobileCloseBtnRef = useRef<HTMLButtonElement | null>(null);
  const cmdTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cmdInputRef = useRef<HTMLInputElement | null>(null);

  const allRoutes = useMemo(() => [...PRIMARY_ROUTES, ADMIN_ROUTE], []);

  useEffect(() => {
    setCmdOpen(false);
    setMobileDrawerOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!cmdOpen) return;
    const t = setTimeout(() => cmdInputRef.current?.focus(), 10);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCmdOpen(false);
        cmdTriggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cmdOpen]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const t = setTimeout(() => mobileCloseBtnRef.current?.focus(), 10);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileDrawerOpen(false);
        mobileMenuBtnRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileDrawerOpen]);

  const closeCmdPalette = () => {
    setCmdOpen(false);
    cmdTriggerRef.current?.focus();
  };

  const closeMobileDrawer = () => {
    setMobileDrawerOpen(false);
    mobileMenuBtnRef.current?.focus();
  };

  const cleanTypedTicker = cmdQuery.trim().toUpperCase().replace(/\.JK$/i, "");

  const filteredRoutes = useMemo(() => {
    if (!cleanTypedTicker) return allRoutes;
    const qLower = cmdQuery.trim().toLowerCase();
    return allRoutes.filter((r) => r.label.toLowerCase().includes(qLower));
  }, [cleanTypedTicker, cmdQuery, allRoutes]);

  const filteredTickers = useMemo(() => {
    if (!cleanTypedTicker) return POPULAR_IDX_TICKERS;
    return POPULAR_IDX_TICKERS.filter((t) => t.includes(cleanTypedTicker));
  }, [cleanTypedTicker]);

  const handleCmdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanTypedTicker) return;
    setCmdQuery("");
    setCmdOpen(false);
    navigate(`/workbench?ticker=${encodeURIComponent(cleanTypedTicker)}`);
  };

  const openTickerInWorkbench = (ticker: string) => {
    setCmdQuery("");
    setCmdOpen(false);
    setMobileDrawerOpen(false);
    navigate(`/workbench?ticker=${encodeURIComponent(ticker)}`);
  };

  const regimeLabel =
    macro?.regime === "RISK_ON"
      ? "Risk On"
      : macro?.regime === "RISK_OFF"
        ? "Risk Off"
        : macro?.regime === "CAUTIOUS"
          ? "Cautious"
          : "Neutral";

  const ihsgDelta =
    macro?.ihsgChangePct !== null && macro?.ihsgChangePct !== undefined
      ? { label: formatPct(macro.ihsgChangePct), up: macro.ihsgChangePct >= 0 }
      : macro?.ihsgPrice
        ? { label: `20D ${formatPct(macro.ihsgReturn20dPct)}`, up: macro.ihsgReturn20dPct >= 0 }
        : null;

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      {/* Skip Link */}
      <a
        href="#main-workspace"
        className="sr-only focus:not-sr-only fixed top-2 left-2 z-50 px-3.5 py-2 rounded-md bg-primary text-primary-fg font-semibold text-sm"
      >
        Skip to main content
      </a>

      {/* Tier 1: Live Deep-Ink IDX Market Tape */}
      <div className="bg-tape text-tape-ink border-b border-tape-border">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-8 min-h-[38px] py-1.5 flex items-center justify-between gap-4 text-[13px]">
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
            <span className="inline-flex items-center gap-2 font-semibold shrink-0">
              <span
                aria-hidden="true"
                className={`w-2 h-2 rounded-full ${marketOpen ? "bg-[#2EE8A5]" : "bg-[#9AA8BC]"}`}
              />
              <span>{marketOpen ? "IDX Open" : "IDX Closed"}</span>
            </span>

            <div className="flex items-center gap-2 num shrink-0">
              <span className="text-tape-muted font-medium">IHSG</span>
              <span className="font-bold text-tape-ink">
                {macro?.ihsgPrice ? Math.round(macro.ihsgPrice).toLocaleString("en-US") : "-"}
              </span>
              {ihsgDelta && (
                <span className={`font-semibold ${ihsgDelta.up ? "text-[#2EE8A5]" : "text-[#FF7585]"}`}>
                  {ihsgDelta.label}
                </span>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-2 num shrink-0 pl-4 border-l border-tape-border">
              <span className="text-tape-muted font-medium">USD/IDR</span>
              <span className="font-bold text-tape-ink">
                {macro?.usdIdrRate ? Math.round(macro.usdIdrRate).toLocaleString("en-US") : "-"}
              </span>
              {macro?.usdIdrChange5dPct !== null && macro?.usdIdrChange5dPct !== undefined && (
                <span
                  className={`font-semibold ${
                    macro.usdIdrChange5dPct <= 0 ? "text-[#2EE8A5]" : "text-[#FF7585]"
                  }`}
                >
                  {formatPct(macro.usdIdrChange5dPct)}
                </span>
              )}
            </div>

            {macro && (
              <div className="hidden md:flex items-center gap-2 num shrink-0 pl-4 border-l border-tape-border">
                <span className="text-tape-muted font-medium">Regime</span>
                <span className="font-bold text-tape-ink">{macro.regimeScore}/100</span>
                <span
                  className={`font-semibold ${
                    macro.regime === "RISK_ON"
                      ? "text-[#2EE8A5]"
                      : macro.regime === "RISK_OFF"
                        ? "text-[#FF7585]"
                        : macro.regime === "CAUTIOUS"
                          ? "text-[#FCD34D]"
                          : "text-tape-ink"
                  }`}
                >
                  {regimeLabel}
                </span>
              </div>
            )}

            {pipelineRunning && (
              <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded bg-[#0A291E] text-[#2EE8A5] border border-[#1B6E50] text-[12px] font-semibold">
                Scan Running
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <span className="hidden lg:inline-flex items-center gap-1.5 text-tape-muted text-[12px]">
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-[#2EE8A5]" : "bg-[#FCD34D]"}`}
              />
              <span>{wsConnected ? "Live Stream" : "Snapshot"}</span>
            </span>

            <NavLink
              to="/admin"
              className="text-[13px] font-medium text-tape-muted hover:text-tape-ink transition-colors py-1"
            >
              {adminUnlocked ? "Engine Admin (Unlocked)" : "Engine Admin"}
            </NavLink>
          </div>
        </div>
      </div>

      {/* Tier 2: Main Editorial Masthead */}
      <header className="sticky top-0 z-30 h-16 bg-surface border-b border-line">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-8 h-full flex items-center justify-between gap-4">
          {/* Left: Mobile Menu + Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              ref={mobileMenuBtnRef}
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-expanded={mobileDrawerOpen}
              aria-controls="mobile-nav-sheet"
              className="lg:hidden min-h-[44px] px-3 term-btn-secondary inline-flex items-center gap-2 text-sm font-semibold"
            >
              <SvgIcon.Menu />
              <span>Menu</span>
            </button>

            <NavLink to="/" className="inline-flex items-baseline gap-2 py-1">
              <span className="font-display text-[22px] font-extrabold tracking-tight text-ink">
                Milicent
              </span>
              <span className="text-sm font-bold text-accent">/ IDX</span>
            </NavLink>
          </div>

          {/* Center: Architectural Underline Navigation */}
          <nav aria-label="Primary navigation" className="hidden lg:flex items-center h-full gap-1">
            {PRIMARY_ROUTES.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `h-full px-4 inline-flex items-center text-[15px] border-b-[3px] transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-b-accent-solid text-ink font-semibold"
                      : "border-b-transparent text-ink-secondary hover:text-ink font-medium"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Right: Emiten Quick Search + Theme Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              ref={cmdTriggerRef}
              type="button"
              onClick={() => setCmdOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={cmdOpen}
              aria-label="Search IDX emiten (Ctrl+K)"
              className="min-h-[44px] lg:h-10 lg:min-h-0 min-w-[44px] px-3 sm:px-3.5 term-input inline-flex items-center justify-center sm:justify-start gap-2.5 text-sm text-ink-secondary hover:text-ink"
            >
              <SvgIcon.Search className="w-4 h-4 shrink-0 text-ink-muted" />
              <span className="hidden sm:inline">Search BBCA, TLKM...</span>
              <kbd className="hidden xl:inline-flex items-center px-1.5 py-0.5 rounded bg-subtle border border-line text-[12px] text-ink-muted num">
                Ctrl+K
              </kbd>
            </button>

            <button
              type="button"
              onClick={toggle}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="min-h-[44px] lg:h-10 lg:min-h-0 min-w-[44px] px-2.5 sm:px-3 term-btn-secondary inline-flex items-center justify-center gap-2 text-sm font-medium"
            >
              {dark ? <SvgIcon.Sun /> : <SvgIcon.Moon />}
              <span className="hidden sm:inline">{dark ? "Light" : "Dark"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-workspace" className="flex-1 w-full max-w-[1440px] mx-auto px-4 lg:px-8 py-6 sm:py-7">
        <div key={location.pathname} className="reveal-in">
          {children}
        </div>
      </main>

      {/* Footer Landmark */}
      <footer className="border-t border-line bg-surface">
        <div className="max-w-[1440px] mx-auto px-4 lg:px-8 py-4 pb-24 lg:pb-5 flex flex-wrap items-center justify-between gap-3 text-[13px] text-ink-muted">
          <span>
            IDX Execution Reference: 1 lot equals 100 shares. Net sizing accounts for 0.15% buy fee, 0.25% sell fee, and BEI price fractions.
          </span>
          <div className="flex items-center gap-5 font-medium">
            <NavLink to="/scanner" className="hover:text-ink py-1">
              Screener
            </NavLink>
            <NavLink to="/ledger" className="hover:text-ink py-1">
              Track Record
            </NavLink>
            <NavLink to="/admin" className="hover:text-ink py-1">
              Engine Admin
            </NavLink>
          </div>
        </div>
      </footer>

      {/* Mobile Fixed Bottom Navigation */}
      <nav
        aria-label="Mobile primary navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5">
          {PRIMARY_ROUTES.map(({ to, shortLabel, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `min-h-[54px] flex flex-col items-center justify-center gap-0.5 border-t-[3px] text-[12px] transition-colors ${
                  isActive
                    ? "border-t-accent-solid text-accent font-semibold bg-accent-tint/40"
                    : "border-t-transparent text-ink-secondary hover:text-ink font-medium"
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate max-w-full px-1">{shortLabel}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Mobile Navigation & Market Sheet */}
      {mobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60"
            aria-hidden="true"
            onClick={closeMobileDrawer}
          />
          <div
            id="mobile-nav-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation and market menu"
            className="relative z-10 w-80 max-w-[88vw] h-full bg-surface border-r border-line flex flex-col overflow-y-auto"
          >
            <div className="h-16 px-4 border-b border-line flex items-center justify-between">
              <div className="inline-flex items-baseline gap-1.5">
                <span className="font-display text-xl font-extrabold text-ink">Milicent</span>
                <span className="text-xs font-bold text-accent">/ IDX</span>
              </div>
              <button
                ref={mobileCloseBtnRef}
                type="button"
                onClick={closeMobileDrawer}
                aria-label="Close navigation menu"
                className="min-h-[44px] min-w-[44px] rounded-md term-btn-secondary inline-flex items-center justify-center"
              >
                <SvgIcon.Close />
              </button>
            </div>

            <div className="p-4 border-b border-line space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-ink-muted uppercase tracking-wider">
                  Market Tape
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[12px] font-semibold border ${
                    marketOpen
                      ? "bg-bull-bg text-bull border-bull-border"
                      : "bg-subtle text-ink-secondary border-line"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full ${marketOpen ? "bg-bull" : "bg-ink-muted"}`}
                  />
                  <span>{marketOpen ? "IDX Open" : "IDX Closed"}</span>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 num text-sm">
                <div className="term-well p-3">
                  <div className="text-[12px] text-ink-muted">IHSG</div>
                  <div className="font-display text-lg font-bold text-ink">
                    {macro?.ihsgPrice ? Math.round(macro.ihsgPrice).toLocaleString("en-US") : "-"}
                  </div>
                  {ihsgDelta && (
                    <div className={`text-[12px] font-semibold ${ihsgDelta.up ? "text-bull" : "text-bear"}`}>
                      {ihsgDelta.label}
                    </div>
                  )}
                </div>

                <div className="term-well p-3">
                  <div className="text-[12px] text-ink-muted">USD/IDR</div>
                  <div className="font-display text-lg font-bold text-ink">
                    {macro?.usdIdrRate ? Math.round(macro.usdIdrRate).toLocaleString("en-US") : "-"}
                  </div>
                  {macro && <div className="mt-1"><RegimeBadge regime={macro.regime} /></div>}
                </div>
              </div>
            </div>

            <nav aria-label="Sheet navigation" className="p-3 space-y-4 flex-1">
              <div className="space-y-1">
                <div className="px-3 py-1 text-[12px] font-semibold tracking-wider text-ink-muted uppercase">
                  Workspaces
                </div>
                {allRoutes.map(({ to, label, Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setMobileDrawerOpen(false)}
                    className={({ isActive }) =>
                      `min-h-[44px] px-3 rounded-md flex items-center gap-3 text-[15px] transition-colors ${
                        isActive
                          ? "bg-accent-tint text-accent font-semibold"
                          : "text-ink-secondary hover:text-ink hover:bg-hover-bg font-medium"
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>

              {watchlist.length > 0 && (
                <div className="px-1 pt-3 border-t border-line space-y-2">
                  <div className="px-2 text-[12px] font-semibold tracking-wider text-ink-muted uppercase">
                    Watchlist
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {watchlist.slice(0, 9).map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => openTickerInWorkbench(sym)}
                        className="min-h-[44px] px-2 rounded-md term-well hover:border-accent-border hover:text-accent text-sm num font-bold text-ink"
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </nav>

            <div className="p-4 border-t border-line">
              <button
                type="button"
                onClick={toggle}
                className="w-full min-h-[44px] px-3 term-btn-secondary inline-flex items-center justify-between text-sm font-semibold"
              >
                <span>{dark ? "Switch to Light Mode" : "Switch to Dark Mode"}</span>
                {dark ? <SvgIcon.Sun /> : <SvgIcon.Moon />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emiten Command Dialog (Ctrl+K) */}
      {cmdOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
          <div
            className="fixed inset-0 bg-black/65"
            aria-hidden="true"
            onClick={closeCmdPalette}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cmdk-label"
            className="relative z-10 w-full max-w-lg term-popover overflow-hidden"
          >
            <form onSubmit={handleCmdSubmit} className="p-4 border-b border-line space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label id="cmdk-label" htmlFor="cmdk-input" className="text-sm font-semibold text-ink">
                  Jump to IDX emiten or workspace
                </label>
                <button
                  type="button"
                  onClick={closeCmdPalette}
                  aria-label="Close quick jump"
                  className="min-h-[44px] min-w-[44px] lg:h-9 lg:w-9 lg:min-h-0 lg:min-w-0 term-btn-secondary inline-flex items-center justify-center"
                >
                  <SvgIcon.Close />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SvgIcon.Search className="w-4 h-4 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={cmdInputRef}
                    id="cmdk-input"
                    type="text"
                    value={cmdQuery}
                    onChange={(e) => setCmdQuery(e.target.value)}
                    placeholder="Type 4-letter ticker (BBCA, TLKM)..."
                    maxLength={24}
                    className="w-full min-h-[44px] lg:h-10 lg:min-h-0 pl-9 pr-3 term-input text-[15px] num uppercase placeholder:normal-case placeholder:text-ink-muted"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!cleanTypedTicker}
                  className="min-h-[44px] lg:h-10 lg:min-h-0 px-4 term-btn-primary disabled:opacity-40 text-sm font-semibold shrink-0"
                >
                  Open Terminal
                </button>
              </div>
            </form>

            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {cleanTypedTicker && /^[A-Z]{2,6}$/.test(cleanTypedTicker) && (
                <button
                  type="button"
                  onClick={() => openTickerInWorkbench(cleanTypedTicker)}
                  className="w-full min-h-[44px] lg:h-10 px-3.5 rounded-md bg-accent-tint border border-accent-border text-accent text-[15px] font-semibold flex items-center justify-between"
                >
                  <span>Analyze {cleanTypedTicker} in Terminal</span>
                  <span className="num text-xs">Enter</span>
                </button>
              )}

              {watchlist.length > 0 && !cleanTypedTicker && (
                <div className="space-y-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
                    Saved Watchlist
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {watchlist.map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => openTickerInWorkbench(sym)}
                        className="min-h-[44px] lg:h-9 lg:min-h-0 px-3 rounded-md bg-accent-tint border border-accent-border text-accent text-sm font-bold transition-colors"
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
                  IDX Liquid Bluechips
                </div>
                <div className="flex flex-wrap gap-2">
                  {filteredTickers.map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => openTickerInWorkbench(sym)}
                      className="min-h-[44px] lg:h-9 lg:min-h-0 px-3 rounded-md term-well hover:border-accent-border hover:text-accent text-sm font-bold text-ink transition-colors"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-3 border-t border-line">
                <div className="text-[12px] font-semibold uppercase tracking-wider text-ink-muted">
                  Workspaces
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredRoutes.map(({ to, label, Icon }) => (
                    <button
                      key={to}
                      type="button"
                      onClick={() => {
                        setCmdOpen(false);
                        navigate(to);
                      }}
                      className="min-h-[44px] lg:h-10 lg:min-h-0 px-3 rounded-md term-well hover:bg-hover-bg text-left text-[15px] font-medium text-ink flex items-center gap-2.5 transition-colors"
                    >
                      <Icon className="w-4 h-4 text-accent shrink-0" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
