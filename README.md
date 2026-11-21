# Milicent

Hybrid quantitative and AI equity signal workstation for the Indonesia Stock Exchange (IDX / IHSG), built with Bun, TypeScript, React, Tailwind CSS, and SQLite.

## Capabilities

- **6-Stage WIB Trading Pipeline**: Classifies IHSG and USD/IDR macro regimes, synchronizes active signal lifecycles against live prices, crawls 14 Indonesian market news portals, screens IDX80/LQ45 candidates, runs Hybrid Quant + LLM evaluation with hard risk guardrails, and stores curated signals and watchtower radar records.
- **IDX Market Rules Engine**: Enforces official BEI tick fractions across all 5 price tiers, ARA/ARB auto-rejection limits (with the Rp 50 floor), fee-aware lot sizing, and strict 4-letter IDX ticker validation.
- **Quantitative Technicals & Flow**: Computes RSI, MACD, SMA/EMA, ATR, 20-day VWAP, Chaikin Money Flow (CMF20), and accumulation/distribution structure, with a deterministic quantitative fallback when the LLM endpoint is offline.
- **Hard Risk Guardrails**: Applies ATR-based stop-loss floors, minimum risk-to-reward gates, contrarian swing checks in bearish trends, overbought/fakeout filters, and anti-ARA spike guards.
- **Walk-Forward Backtest Lab**: Compares baseline static exits against two-stage TP1 breakeven lock + trailing stop rules with fee and slippage modeling.
- **Live Operations Console**: Password-gated admin console for WIB scheduler control, manual/fresh pipeline runs, risk threshold tuning, watchlist management, and live SSE pipeline logs.
- **Optional Telegram Alerts**: Sends BUY signals, position transitions (Entry, TP1, TP2, Trailing SL, Stop Loss), and intraday anomaly alerts with chat ID allowlist support.

## Project Structure

```text
backend/      Bun HTTP/WS/SSE gateway, SQLite persistence, Yahoo Finance & news crawler,
              quant engine, LLM thesis forge, execution desk, and WIB scheduler daemon
frontend/     React + Vite workstation UI (Command Deck, Market Scanner, Stock Workbench,
              Audit Ledger, Backtest Lab, and Engine Admin Console)
protocol/     Shared TypeScript contracts and BEI/IDX market rule utilities
scripts/      Development runner and production build script
tests/        Unit and integration tests (Bun test runner)
```

## Prerequisites

- [Bun](https://bun.sh/) v1.1+
- An OpenAI-compatible LLM API endpoint (optional: the engine falls back to deterministic quantitative scoring if the LLM endpoint is unreachable)

## Quick Start

1. Install dependencies:

   ```bash
   bun install
   ```

2. Create your environment file from the template:

   ```bash
   cp .env.example .env
   ```

3. Set a strong `ADMIN_PASSWORD` and your OpenAI-compatible API settings in `.env`.

4. Start the development server (backend API on `127.0.0.1:3001`, Vite frontend on `localhost:3000`):

   ```bash
   bun run dev
   ```

## Docker Deployment

Build and run Milicent in production mode with persistent SQLite storage:

```bash
cp .env.example .env
# Edit .env: set ADMIN_PASSWORD, CORS_ORIGINS (your reverse proxy domain), and OPENAI_* settings
docker compose up -d --build
```

The container listens on `0.0.0.0:3001` internally and publishes only to `127.0.0.1:3001` on the host, ready to sit behind Nginx, Caddy, or Cloudflare Tunnel. If your LLM proxy runs on the Docker host machine, set `OPENAI_BASE_URL=http://host.docker.internal:8045/v1` in `.env`.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Run backend API and Vite dev server concurrently |
| `bun run dev:server` | Run backend gateway in watch mode |
| `bun run dev:web` | Run Vite frontend dev server only |
| `bun run build` | Build frontend (`dist/client`) and backend bundle (`dist/server.js`) |
| `bun run start` | Start production server from `dist/server.js` |
| `bun run typecheck` | Run TypeScript strict type checking (`tsc --noEmit`) |
| `bun run test` | Run all unit and integration tests (`bun test tests/`) |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `http://127.0.0.1:8045/v1` | OpenAI-compatible API base URL |
| `OPENAI_API_KEY` | `dummy-key` | API key for the LLM endpoint |
| `OPENAI_MODEL` | `gemini-3-flash` | Default model ID |
| `OPENAI_FILTER_MODEL` | `OPENAI_MODEL` | Model ID for news sentiment extraction |
| `OPENAI_DECISION_MODEL` | `OPENAI_MODEL` | Model ID for hybrid stock thesis decisions |
| `HOST` | `127.0.0.1` | Bind address for the HTTP/WebSocket server |
| `PORT` | `3001` | Server listen port |
| `MILICENT_DB_PATH` | `data/milicent.db` | SQLite database file path |
| `ADMIN_PASSWORD` | (required) | Admin console password (fails closed if unset or `change_me`) |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed CORS origins |
| `CRAWLER_PROXY_URL` | (empty) | Optional proxy URL for news/Yahoo requests |
| `CRAWLER_PROXY_TOKEN` | (empty) | Optional proxy authentication token |
| `YAHOO_USE_PROXY` | `false` | Route Yahoo Finance requests through `CRAWLER_PROXY_URL` |
| `TELEGRAM_BOT_TOKEN` | (empty) | Optional Telegram Bot API token |
| `TELEGRAM_POLLING` | `false` | Enable Telegram `/start`, `/stop`, `/signals` command polling |
| `TELEGRAM_ALLOWED_CHAT_IDS` | (empty) | Comma-separated numeric Telegram chat IDs allowed to access the bot |

## Security Defaults

- Server binds to `127.0.0.1` by default unless `HOST` is overridden.
- Admin endpoints (`/api/settings`, `/api/logs`, `/api/pipeline/run`, `/api/watchlist`, `/api/scheduler/*`, `/api/analyze/purge`) fail closed when `ADMIN_PASSWORD` is unset or left as `change_me`, and lock out repeated failed password attempts per IP.
- CORS restricts cross-origin access to configured `CORS_ORIGINS` (or local dev origins) rather than wildcard `*`.
- Telegram bot polling fails closed unless `TELEGRAM_ALLOWED_CHAT_IDS` is configured (or `ALLOW_OPEN_TELEGRAM_BOT=true` is explicitly enabled).

## Disclaimer

Milicent is a personal quantitative research and signal tracking tool. Nothing produced by this software constitutes financial or investment advice. You are solely responsible for your own trading decisions.

## License

This project is licensed under the [MIT License](./LICENSE).
